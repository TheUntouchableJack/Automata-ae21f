// ===== Venue categories — single source of truth =====
//
// Loaded by BOTH the customer app (customer-app/social.html) and the owner's
// venue admin (app/venues.html). It exists because those two surfaces used to
// disagree, and the disagreement silently emptied the app:
//
//   - The feed pills sent plurals ('bars', 'clubs', 'restaurants', 'lounges')
//     while venues.category stores singulars ('bar', 'club', ...). Five of the
//     seven pills could never match a row.
//   - The "All" pill sent the literal string 'all', so get_venue_feed filtered
//     WHERE category = 'all' and returned nothing at all.
//
// Both bugs were invisible in testing because the app falls back to hardcoded
// demo venues (which happened to use the plural forms) whenever the DB returns
// zero rows. Keep the slugs here identical to the values stored in
// venues.category — see migration 20260225000001_social_venue_discovery.sql.
//
// The "All" case is deliberately NOT in this list. It is the absence of a
// filter, not a category, and it must reach the RPC as SQL NULL. Use
// normalizeCategory() for that conversion rather than re-deriving it.
(function (global) {
    'use strict';

    // slug MUST match venues.category. labelKey MUST exist in i18n/*.json.
    var VENUE_CATEGORIES = [
        { slug: 'nightlife',   label: 'Nightlife',   labelKey: 'social.catNightlife' },
        { slug: 'bar',         label: 'Bars',        labelKey: 'social.catBars' },
        { slug: 'club',        label: 'Clubs',       labelKey: 'social.catClubs' },
        { slug: 'restaurant',  label: 'Restaurants', labelKey: 'social.catRestaurants' },
        { slug: 'lounge',      label: 'Lounges',     labelKey: 'social.catLounges' },
        { slug: 'rooftop',     label: 'Rooftop',     labelKey: 'social.catRooftop' },
        { slug: 'event_space', label: 'Event Space', labelKey: 'social.catEventSpace' }
    ];

    // The value the "All" pill carries in the DOM.
    var ALL_CATEGORY = 'all';

    // DOM value -> RPC argument. Anything meaning "no filter" becomes null so
    // get_venue_feed's `(p_category IS NULL OR ...)` short-circuits correctly.
    function normalizeCategory(value) {
        if (!value || value === ALL_CATEGORY) return null;
        return value;
    }

    // In the reader's language when i18n is loaded (Jay's board, 2026-10-14:
    // the names were English in all 8 languages on every card, result and
    // venue page). I18n.t() returns the KEY on a miss, so a missing
    // translation — or a page without i18n, like an early paint — falls back
    // to the English name rather than printing "social.catBars".
    function categoryLabel(slug) {
        for (var i = 0; i < VENUE_CATEGORIES.length; i++) {
            var c = VENUE_CATEGORIES[i];
            if (c.slug !== slug) continue;
            var i18n = global.I18n;
            var t = i18n && typeof i18n.t === 'function' ? i18n.t(c.labelKey) : null;
            return (typeof t === 'string' && t && t !== c.labelKey) ? t : c.label;
        }
        return slug || '';
    }

    function isValidCategory(slug) {
        return VENUE_CATEGORIES.some(function (c) { return c.slug === slug; });
    }

    global.VENUE_CATEGORIES = VENUE_CATEGORIES;
    global.ALL_CATEGORY = ALL_CATEGORY;
    global.normalizeCategory = normalizeCategory;
    global.categoryLabel = categoryLabel;
    global.isValidCategory = isValidCategory;
})(window);
