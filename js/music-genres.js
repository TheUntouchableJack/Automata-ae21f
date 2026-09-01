// ===== Music genres — single source of truth =====
//
// Loaded by BOTH the customer app (customer-app/social.html) and the owner's
// venue admin (app/venues.html), exactly like /js/venue-categories.js. It is a
// separate controlled vocabulary and NOT a use of venues.tags: tags are
// freeform owner text ("ocean view", "hookah") with no constraint behind them,
// so filtering on them would match whatever anyone happened to type.
//
// ⚠️ The slugs here MUST match the venues_music_genres_valid CHECK constraint
// in migration 20260901000001_venue_genres_and_presence.sql character for
// character. A slug that exists here and not there fails the write with a
// 23514 the owner cannot act on; a slug that exists there and not here is a
// genre no one can ever select.
//
// The "All" case is deliberately NOT in this list, for the same reason it is
// absent from VENUE_CATEGORIES: it is the absence of a filter, not a genre, and
// it must reach get_venue_feed as SQL NULL. Use normalizeGenre() for that
// conversion rather than re-deriving it — passing the literal string 'all' is
// the bug that silently emptied the category feed once already.
(function (global) {
    'use strict';

    // slug MUST match the DB CHECK. labelKey MUST exist in i18n/*.json.
    var MUSIC_GENRES = [
        { slug: 'house',       label: 'House',       labelKey: 'social.genreHouse' },
        { slug: 'techno',      label: 'Techno',      labelKey: 'social.genreTechno' },
        { slug: 'hip_hop',     label: 'Hip-Hop',     labelKey: 'social.genreHipHop' },
        { slug: 'rnb',         label: 'R&B',         labelKey: 'social.genreRnb' },
        { slug: 'afrobeats',   label: 'Afrobeats',   labelKey: 'social.genreAfrobeats' },
        { slug: 'latin',       label: 'Latin',       labelKey: 'social.genreLatin' },
        { slug: 'reggaeton',   label: 'Reggaeton',   labelKey: 'social.genreReggaeton' },
        { slug: 'dancehall',   label: 'Dancehall',   labelKey: 'social.genreDancehall' },
        { slug: 'amapiano',    label: 'Amapiano',    labelKey: 'social.genreAmapiano' },
        { slug: 'disco',       label: 'Disco',       labelKey: 'social.genreDisco' },
        { slug: 'funk_soul',   label: 'Funk & Soul', labelKey: 'social.genreFunkSoul' },
        { slug: 'rock',        label: 'Rock',        labelKey: 'social.genreRock' },
        { slug: 'pop',         label: 'Pop',         labelKey: 'social.genrePop' },
        { slug: 'jazz',        label: 'Jazz',        labelKey: 'social.genreJazz' },
        { slug: 'live_band',   label: 'Live Band',   labelKey: 'social.genreLiveBand' },
        { slug: 'open_format', label: 'Open Format', labelKey: 'social.genreOpenFormat' },
        { slug: 'edm',         label: 'EDM',         labelKey: 'social.genreEdm' },
        { slug: 'trance',      label: 'Trance',      labelKey: 'social.genreTrance' },
        { slug: 'dj_set',      label: 'DJ Set',      labelKey: 'social.genreDjSet' }
    ];

    // The value the "All" genre pill carries in the DOM.
    var ALL_GENRE = 'all';

    // DOM value -> RPC argument. Anything meaning "no filter" becomes null so
    // get_venue_feed's `(p_genre IS NULL OR ...)` short-circuits correctly.
    function normalizeGenre(value) {
        if (!value || value === ALL_GENRE) return null;
        return value;
    }

    function genreLabel(slug) {
        for (var i = 0; i < MUSIC_GENRES.length; i++) {
            if (MUSIC_GENRES[i].slug === slug) return MUSIC_GENRES[i].label;
        }
        return slug || '';
    }

    function isValidGenre(slug) {
        return MUSIC_GENRES.some(function (g) { return g.slug === slug; });
    }

    // Drops anything the CHECK constraint would reject, and de-duplicates.
    // Both surfaces build their list from chip taps, so a stale slug can only
    // arrive from data written before a slug was renamed — better to save the
    // valid subset than to fail the whole write.
    function sanitizeGenres(list) {
        if (!Array.isArray(list)) return [];
        var seen = {};
        return list.filter(function (slug) {
            if (!isValidGenre(slug) || seen[slug]) return false;
            seen[slug] = true;
            return true;
        });
    }

    global.MUSIC_GENRES = MUSIC_GENRES;
    global.ALL_GENRE = ALL_GENRE;
    global.normalizeGenre = normalizeGenre;
    global.genreLabel = genreLabel;
    global.isValidGenre = isValidGenre;
    global.sanitizeGenres = sanitizeGenres;
})(window);
