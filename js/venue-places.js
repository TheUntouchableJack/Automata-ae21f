// ===== Nominatim place lookup — one client, two surfaces =====
//
// Extracted from the copy that was inlined in app/venues.html so the owner
// admin and the customer app's mobile "Add venue" flow share one queue, one
// rate limit and one set of parsing rules.
//
// Nominatim's usage policy allows roughly one request per second from a single
// source. The queue below is not politeness theatre: exceeding it earns a 429
// and then a block, which would take out venue creation on BOTH surfaces at
// once. Every call goes through runQueued(), including searchPlaces().
//
// ⚠️ There is deliberately NO countrycodes= filter. The inlined version pinned
// `countrycodes=us`, which is why it could never find ViibeView's only real
// venue — that one sits at 42.6633415, 2.9048665, in Perpignan, France. A
// US-only geocoder on a tenant whose venues are in Europe returns nothing, and
// returns it silently.
//
// No API key, no proxy, no CSP change: netlify.toml's connect-src already
// carries https://nominatim.openstreetmap.org. If OSM's POI coverage ever
// proves too thin, swapping in a Google Places edge-function proxy is a change
// to THIS FILE ONLY — that is the whole reason it exists as a seam.
(function (global) {
    'use strict';

    var ENDPOINT = 'https://nominatim.openstreetmap.org/search';
    var MIN_INTERVAL_MS = 1100;
    var TIMEOUT_MS = 10000;

    var queue = Promise.resolve();
    var lastCallAt = 0;

    // Serialises every request and spaces them out. A rejection inside `task`
    // must not poison the chain for the next caller, hence the .catch on the
    // stored queue handle rather than on the returned promise.
    function runQueued(fn) {
        var task = queue.then(function () {
            var wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
            var delay = wait > 0
                ? new Promise(function (r) { setTimeout(r, wait); })
                : Promise.resolve();
            return delay.then(function () {
                lastCallAt = Date.now();
                return fn();
            });
        });

        queue = task.catch(function () {});
        return task;
    }

    function fetchJson(url) {
        return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
            .then(function (res) { return res.json(); })
            .catch(function (err) {
                console.error('Nominatim request failed:', err);
                return null;
            });
    }

    /**
     * One best coordinate for a free-text address.
     * @returns {Promise<{lat:number, lng:number}|null>}
     */
    function geocodeAddress(text) {
        if (!text || !String(text).trim()) return Promise.resolve(null);

        return runQueued(function () {
            var url = ENDPOINT + '?q=' + encodeURIComponent(text) + '&format=json&limit=1';
            return fetchJson(url).then(function (data) {
                if (data && data.length > 0) {
                    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                }
                return null;
            });
        });
    }

    // Nominatim's `address` object is not a fixed shape — a bar in a village has
    // no `city`, a US address has `state` where a French one has `state` only
    // for the région. Fall through the plausible keys rather than reading one.
    function pickCity(addr) {
        return addr.city || addr.town || addr.village || addr.municipality
            || addr.suburb || addr.county || null;
    }

    function pickState(addr) {
        return addr.state || addr.province || addr.region || null;
    }

    // display_name is "The Bungalow, 101 Wilshire Blvd, Santa Monica, CA, …".
    // The POI's own name is the first segment; when Nominatim gives us a
    // structured `name` we prefer it, because the first segment of a plain
    // address result is a house number.
    function pickName(row, addr) {
        if (row.name) return row.name;
        var first = String(row.display_name || '').split(',')[0].trim();
        return first || addr.road || 'Unnamed place';
    }

    function pickStreet(addr) {
        var house = addr.house_number ? addr.house_number + ' ' : '';
        return addr.road ? (house + addr.road) : null;
    }

    /**
     * POI search. Returns rows shaped like the `venues` columns the callers
     * write, so neither surface has to know anything about Nominatim's JSON.
     *
     * @param {string} query
     * @param {{near?: {lat:number, lng:number}, limit?: number}} [opts]
     *        `near` biases results around a point WITHOUT excluding anything
     *        outside it (bounded=0) — someone standing in Perpignan searching
     *        for a club in Barcelona should still find it.
     * @returns {Promise<Array>} possibly empty; never rejects.
     */
    function searchPlaces(query, opts) {
        var options = opts || {};
        if (!query || String(query).trim().length < 2) return Promise.resolve([]);

        var limit = options.limit || 8;
        var url = ENDPOINT + '?q=' + encodeURIComponent(query)
            + '&format=json&addressdetails=1&limit=' + limit;

        var near = options.near;
        if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
            // viewbox is left,top,right,bottom. ~0.5° is roughly 55km of
            // latitude — a night out, not a country.
            var d = 0.5;
            url += '&viewbox=' + [
                (near.lng - d).toFixed(6), (near.lat + d).toFixed(6),
                (near.lng + d).toFixed(6), (near.lat - d).toFixed(6)
            ].join(',') + '&bounded=0';
        }

        return runQueued(function () {
            return fetchJson(url).then(function (data) {
                if (!Array.isArray(data)) return [];
                return data.map(function (row) {
                    var addr = row.address || {};
                    return {
                        name: pickName(row, addr),
                        address_line1: pickStreet(addr),
                        city: pickCity(addr),
                        state: pickState(addr),
                        postal_code: addr.postcode || null,
                        country: addr.country || null,
                        country_code: (addr.country_code || '').toUpperCase() || null,
                        lat: parseFloat(row.lat),
                        lng: parseFloat(row.lon),
                        osm_class: row.class || null,
                        osm_type: row.type || null,
                        display_name: row.display_name || ''
                    };
                }).filter(function (p) {
                    return Number.isFinite(p.lat) && Number.isFinite(p.lng);
                });
            });
        });
    }

    // OSM tags that map onto a nightlife venue, used to guess the category
    // select's initial value. A guess only — the owner can always change it,
    // and anything unrecognised falls back to the app's broadest category.
    var OSM_CATEGORY_MAP = {
        bar: 'bar',
        pub: 'bar',
        biergarten: 'bar',
        nightclub: 'club',
        restaurant: 'restaurant',
        fast_food: 'restaurant',
        cafe: 'restaurant',
        food_court: 'restaurant',
        events_venue: 'event_space',
        community_centre: 'event_space',
        theatre: 'event_space'
    };

    function guessCategory(place) {
        if (!place) return 'nightlife';
        return OSM_CATEGORY_MAP[place.osm_type] || 'nightlife';
    }

    global.VenuePlaces = {
        geocodeAddress: geocodeAddress,
        searchPlaces: searchPlaces,
        guessCategory: guessCategory
    };
})(window);
