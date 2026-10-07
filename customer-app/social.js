/**
 * Social Venue Discovery App
 * Customer-facing app for discovering venues via map + video feed
 */

// ===== Config =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        // SocialAuth.handleRecoveryLink() owns the auth URL end to end.
        //
        // Leaving the library's detector on means two consumers racing for the
        // same ONE-SHOT payload: detectSessionInUrl consumes the recovery
        // fragment and strips it after an awaited GET /auth/v1/user, so whether
        // our code still saw `type=recovery` came down to network latency. Some
        // testers got the New Password form; some silently landed on the feed.
        //
        // Safe here because recovery is the only URL-delivered auth this page
        // has: there is no signInWithOAuth, no signInWithOtp and no magic link
        // anywhere in customer-app/.
        // ⚠️ If any of those are ever added, this must be revisited —
        // handleRecoveryLink() would have to learn those payloads first, or
        // they will arrive and be thrown away silently.
        detectSessionInUrl: false

        // flowType stays implicit (the library default), deliberately. PKCE
        // stores its verifier in the REQUESTING browser's localStorage, which
        // breaks the ordinary request-on-phone / open-on-desktop path, and the
        // email template ({{ .ConfirmationURL }}) is project-wide and shared
        // with the owner app — an implicit-URL-against-pkce-client mismatch is
        // a hard throw, not a graceful fallback.
        //
        // persistSession / autoRefreshToken keep their defaults.
    }
});

// Bind before anything awaits: recovery must not wait on the customer_apps
// fetch in init(), which needs a network round trip it has no use for.
// SocialAuth.init() assigns the client again — both are idempotent.
SocialAuth.bindClient(supabaseClient);

// Deliberately NOT awaited here. The setSession round trip overlaps the
// customer_apps fetch below, and it is awaited once, at the point in init()
// where the result is actually applied. Correctness comes from the URL snapshot
// taken in social-auth.js, not from winning this race.
const recoveryOutcome = SocialAuth.handleRecoveryLink();

// `Cache-Control: max-age` written onto every venue-media object at upload time.
// One year, because EVERY path this app writes is timestamped — `members/{id}/
// {ts}-{name}`, `{org}/{venue}/{ts}-{name}`, `members/{id}/avatar-{ts}.jpg`, and
// the `-thumb.jpg` derived from those — so the bytes at a given URL are
// immutable by construction and a new upload is always a new URL.
//
// ⚠️ What would break this: a future migration adding an UPDATE policy on
// storage.objects for `venue-media` *together with* a stable (non-timestamped)
// path. That combination would let an overwrite pin stale bytes in browser
// caches for a year with no way to bust them. Keep paths timestamped.
//
// This governs the BROWSER only. It does not reduce Supabase CDN egress — the
// edge already holds these objects for days regardless (measured
// `cf-cache-status: HIT, age: 664473` against `max-age=3600`). The win here is
// repeat real-user views, nothing else.
//
// Existing objects keep the header they were uploaded with; there is no
// metadata-only API, so changing this only affects new uploads.
const MEDIA_CACHE_CONTROL = '31536000';

// ===== State =====
let currentApp = null;
let appFeatures = {};   // customer_apps.features — App Builder toggles
let appSettings = {};   // customer_apps.settings — video cap, default view, etc.
let appSlug = null;
let venues = [];
let usingDemoVenues = false;  // true when DEMO_VENUES stand in for an empty DB
let feedItems = [];
let feedOffset = 0;
let feedLoading = false;
let feedHasMore = true;
let activeCategory = null;
// Second, independent filter axis. Applied SERVER-SIDE for the feed (a
// get_venue_feed argument) and CLIENT-SIDE for the map pins, swim lane and
// search — the same split setCategory() already uses, for the same reason:
// the feed is paginated in the database and the venue list is not.
let activeGenre = null;
let activeTab = 'feed';
let userLocation = null;
let map = null;
let markers = [];
let selectedVenueId = null;
let searchTimeout = null;
let isOwner = false;
let ownerOrgId = null;
// Venues the signed-in user OWNS (venue_owners, assigned from the dashboard).
// An owner may delete posts at that venue and add flyers to it — nothing else.
// Presentation only: delete_social_post and add_venue_flyer re-check in SQL.
let ownedVenueIds = new Set();
let selectedPostFile = null;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;
let recordingStartTime = 0;
let recordedDurationSeconds = null;
let venuePageVenueId = null;
// The venue row currently rendered by the venue page. Held because the admin
// genre editor toggles against the CURRENT genre list and re-renders in place —
// re-reading get_venue_detail on every chip tap would be a round trip per tap.
let venuePageVenue = null;
let venuePageFeed = [];
let venuePageOffset = 0;
let venuePageHasMore = true;
let venuePageLoading = false;
let venuePageScrollHandler = null;

// The signed-in user's auth id. Needed on every feed card to decide whether the
// 3-dots menu offers Delete or Report, so it is cached rather than awaited
// inside the render loop.
let currentUserId = null;

// Venue the composer will attach the post to. null = an unattached Viibe,
// credited to its author. Set by openCreatePost(venueId).
let composerVenueId = null;

// Set when a signed-out visitor taps Create: the auth overlay opens first and
// the composer reopens by itself on success. A recording is never held across
// an email-confirmation redirect — the composer opens empty.
let pendingComposerVenueId;   // undefined = no pending intent (null is "no venue")
let hasPendingComposer = false;

// Sound is a user preference that survives navigation, not per-video state.
// One writer (applySoundState) so the observer, the tap-to-play handler and the
// speaker button cannot disagree.
let feedSoundOn = false;

// Hoisted so each renderFeed() disconnects the previous observer. They used to
// be created per render and never disconnected, so after five pages five
// observers fought over the same <video> elements.
let feedVideoObserver = null;
let venueVideoObserver = null;
// Rebuilt on every renderFeed() alongside feedVideoObserver — the sentinel it
// watches now lives inside the scroller and is destroyed by each render.
let feedScrollObserver = null;

// requestLocation() resolves asynchronously and used to call renderFeed()
// unconditionally, blowing away innerHTML and restarting every playing video.
let feedHasRendered = false;

// Map post pins (distinct from venue `markers`).
let postPins = [];
let postMarkers = [];
let previewPostId = null;

// Scroll chrome
let scrollChromeTicking = false;
let lastScrollY = 0;

// Which post the options sheet is acting on.
let optionsMediaId = null;

// ===== Phase 2: profiles, follows, discovery =====

// Which feed the Feed tab is showing: 'all' (get_venue_feed, anon-readable) or
// 'following' (get_following_feed, authenticated only). Lives beside
// activeCategory/activeGenre rather than inside them because it selects the RPC
// rather than an argument to it.
let feedMode = 'all';

// The member profile overlay. venuePage* has the same three-variable shape and
// for the same reasons: the page is a reused singleton node, so its content has
// to be cleared on close or the previous member's grid lingers.
let memberPageUserId = null;
let memberPageProfile = null;
let memberPagePosts = [];
let memberPageVenues = [];

// How many "Been to" rows sit inline on the profile before "See all" hands the
// rest to the people sheet. Six is two thumb-heights — enough to read as a list
// rather than a teaser, short enough not to push the post grid off the screen.
const MEMBER_VENUES_PREVIEW = 6;

// The signed-in user's own follow edges, as a Set of `${type}:${id}` keys.
//
// This is the ONE place the client knows what it follows, and it is read from
// the table with a plain .select() — social_follows keeps an own-rows SELECT
// policy precisely so this works without a new RPC and without adding an
// is_following column to get_venue_detail.
let followingKeys = new Set();
let followingLoaded = false;

// In-flight follow writes, keyed by followKey(). A double-tap otherwise races
// follow_target against unfollow_target and the later-resolving one wins,
// leaving followingKeys disagreeing with the table until the next reload.
const followInFlight = new Set();

// The follow a signed-out visitor tapped, held across the signup overlay so
// onSignedIn() can finish it. Mirrors hasPendingComposer/pendingComposerVenueId
// exactly — without it the tap is silently discarded and the button still reads
// "Follow" over a brand-new account.
let hasPendingFollow = false;
let pendingFollowType;
let pendingFollowId;

// People sheet: 'followers' | 'following' | 'discover', plus whose lists are
// being shown (null = the signed-in user's own).
let peopleSheetMode = 'followers';
let peopleSheetUserId = null;
let peopleSearchTimeout = null;

// Edit Profile: the avatar the form will save. `undefined` means "unchanged"
// has already been resolved into a concrete value by openEditProfile(), so this
// is always either a URL string or null (explicitly removed).
let editProfileAvatarUrl = null;
let editProfileAvatarFile = null;

// Avatars are downscaled to this longest edge before upload. A modern phone
// camera produces a 12MP JPEG; unresized, that is a multi-megabyte fetch on
// every feed card that member appears on.
const AVATAR_MAX_PX = 512;
const AVATAR_QUALITY = 0.82;

// ===== Body scroll lock =====
//
// ⚠️ This exists because of a REAL new bug, not for tidiness. Phase 2 is the
// first time two full-screen overlays can coexist: a feed card inside
// #venue-page links to its author's #member-page. Every close path in this file
// used to write `document.body.style.overflow = ''` unconditionally, so closing
// the INNER overlay unlocked the body underneath the outer one — the page behind
// the venue page would start scrolling while the venue page was still open.
//
// Keyed rather than counted: a close handler that runs twice (a backdrop click
// plus a button click) must not decrement a counter it only incremented once.
// Set semantics make both lock and unlock idempotent.
const bodyScrollLocks = new Set();

function lockBodyScroll(key) {
    bodyScrollLocks.add(key);
    document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(key) {
    bodyScrollLocks.delete(key);
    if (bodyScrollLocks.size === 0) document.body.style.overflow = '';
}

// Venue picker (composer). The sheet is a filtered view over `venues`, so the
// only state it needs is the query the user has typed.
let venuePickerQuery = '';

// Mobile venue admin (org members only). `placeResults` is the last Nominatim
// response; `pendingPlace` is the row the owner tapped, held while they confirm
// and classify it.
let placeResults = [];
let pendingPlace = null;
let pendingPlaceGenres = [];

// The two-tap "save it hidden" confirmation for a venue with no coordinates.
// First Save warns; second Save writes is_active:false. Same two-choice
// contract as app/venues.html's showCoordsRequiredModal(), with no new markup.
// Reset in openAddVenue() and startManualVenue() so the confirmation cannot
// carry over from a previous venue the owner already dealt with.
let coordlessSaveConfirmed = false;
let placeSearchTimeout = null;

// PWA install. `deferredInstallPrompt` is Chrome's beforeinstallprompt event,
// captured and stashed — it can only be used once, and only from inside a user
// gesture.
//
// ⚠️ The listener for it is registered at the BOTTOM of this file, at parse
// time, not inside setupInstallPrompt(). Chrome fires beforeinstallprompt as
// soon as its install criteria are met, which can be before init() has
// finished awaiting the app row, the venues and the first feed page — and the
// event does not replay for a listener that registers late. Missing it means
// the Add button silently falls through to the iOS instructions on Android.
let deferredInstallPrompt = null;
// Flips true once setupInstallPrompt() has run, so an event that arrives first
// is stashed rather than dropped and the banner appears when the UI is ready.
let installUiReady = false;
// Same contract, for #signup-banner.
let signupUiReady = false;

// Cached answer to "is there a session?", because the bottom banners are
// decided from the parse-time beforeinstallprompt handler, which is synchronous
// and cannot await SocialAuth.isSignedIn().
//
// Written by renderProfileIdentity(), whose whole job is reflecting the session
// in the UI and which already awaits getSession(). It runs at init():444, long
// before installUiReady/signupUiReady flip at the tail of setupEventListeners(),
// so no banner can be shown while this is still stale.
let isMemberSignedIn = false;

const FEED_PAGE_SIZE = 20;
const SOUND_PREF_KEY = 'viibe_sound_on';
const INSTALL_DISMISSED_KEY = 'viibe_install_dismissed';
// The signup banner shares the install banner's slot and its rules, but keeps
// its own key: dismissing one must not silence the other.
const SIGNUP_BANNER_DISMISSED_KEY = 'viibe_signup_banner_dismissed';
// How long a dismissal sticks. Long enough that the banner is not nagging,
// short enough that someone who dismissed it in a hurry sees it again.
const INSTALL_DISMISS_DAYS = 14;
// "Here tonight" counts posts from the last 4 hours (see the here_now
// expression in migration 20260901000001). Nothing client-side recomputes it;
// this is only here so the copy and the SQL cannot drift silently.
const HERE_NOW_WINDOW_HOURS = 4;
// How close a venue has to be before the composer preselects it. A night out,
// not a country — see defaultComposerVenueId().
const NEAREST_VENUE_RADIUS_MILES = 25;
const REPORT_REASONS = [
    { value: 'inappropriate', key: 'social.reportInappropriate', label: 'Inappropriate content' },
    { value: 'spam',          key: 'social.reportSpam',          label: 'Spam or misleading' },
    { value: 'harassment',    key: 'social.reportHarassment',    label: 'Harassment or bullying' },
    { value: 'other',         key: 'social.reportOther',         label: 'Something else' }
];

// ===== Demo Venues (for preview when DB has no venues) =====
const DEMO_VENUES = [
    {
        id: 'demo-1',
        name: 'Skyline Rooftop Lounge',
        handle: 'skylinela',
        category: 'rooftop',
        latitude: 34.0195,
        longitude: -118.4912,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '1550 Ocean Ave',
        postal_code: '90401',
        average_rating: 4.6,
        review_count: 128,
        is_featured: true,
        description: 'Elevated cocktails with panoramic ocean views. Live DJ sets every Friday & Saturday.',
        tags: ['rooftop', 'cocktails', 'ocean view', 'live dj'],
        music_genres: ['house', 'open_format', 'dj_set'],
        phone: '(310) 555-0101',
        website: 'https://example.com',
        hours: {
            monday: { open: '16:00', close: '00:00' },
            tuesday: { open: '16:00', close: '00:00' },
            wednesday: { open: '16:00', close: '00:00' },
            thursday: { open: '16:00', close: '01:00' },
            friday: { open: '15:00', close: '02:00' },
            saturday: { open: '12:00', close: '02:00' },
            sunday: { open: '12:00', close: '22:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-2',
        name: 'Velvet Underground',
        handle: 'velvetdtla',
        category: 'club',
        latitude: 34.0407,
        longitude: -118.2468,
        city: 'Los Angeles',
        state: 'CA',
        address_line1: '420 S Main St',
        postal_code: '90013',
        average_rating: 4.3,
        review_count: 256,
        description: 'Downtown LA\'s premier underground club. House & techno nights.',
        tags: ['club', 'techno', 'house music', 'downtown'],
        music_genres: ['techno', 'house'],
        hours: {
            monday: null,
            tuesday: null,
            wednesday: { open: '21:00', close: '02:00' },
            thursday: { open: '21:00', close: '02:00' },
            friday: { open: '22:00', close: '04:00' },
            saturday: { open: '22:00', close: '04:00' },
            sunday: null
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-3',
        name: 'The Golden Bear',
        handle: 'goldenbear',
        category: 'bar',
        latitude: 34.0259,
        longitude: -118.4961,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '306 Santa Monica Blvd',
        postal_code: '90401',
        average_rating: 4.1,
        review_count: 89,
        description: 'Craft cocktails and local brews in a cozy neighborhood setting.',
        tags: ['craft cocktails', 'beer', 'casual'],
        music_genres: ['rock', 'funk_soul'],
        hours: {
            monday: { open: '17:00', close: '00:00' },
            tuesday: { open: '17:00', close: '00:00' },
            wednesday: { open: '17:00', close: '00:00' },
            thursday: { open: '17:00', close: '01:00' },
            friday: { open: '16:00', close: '02:00' },
            saturday: { open: '14:00', close: '02:00' },
            sunday: { open: '14:00', close: '22:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-4',
        name: 'Nobu Malibu',
        handle: 'nobumalibu',
        category: 'restaurant',
        latitude: 34.0381,
        longitude: -118.6923,
        city: 'Malibu',
        state: 'CA',
        address_line1: '22706 Pacific Coast Hwy',
        postal_code: '90265',
        average_rating: 4.8,
        review_count: 412,
        is_featured: true,
        description: 'World-renowned Japanese cuisine with oceanfront dining.',
        tags: ['japanese', 'sushi', 'fine dining', 'oceanfront'],
        music_genres: ['jazz'],
        phone: '(310) 555-0104',
        website: 'https://example.com',
        hours: {
            monday: { open: '17:00', close: '22:00' },
            tuesday: { open: '17:00', close: '22:00' },
            wednesday: { open: '17:00', close: '22:00' },
            thursday: { open: '17:00', close: '22:00' },
            friday: { open: '17:00', close: '23:00' },
            saturday: { open: '12:00', close: '23:00' },
            sunday: { open: '12:00', close: '21:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-5',
        name: 'Dusk Lounge',
        handle: 'dusklounge',
        category: 'lounge',
        latitude: 34.0093,
        longitude: -118.4974,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '2000 Main St',
        postal_code: '90405',
        average_rating: 4.4,
        review_count: 67,
        description: 'Ambient lounge with craft cocktails, hookah, and weekend live music.',
        tags: ['lounge', 'hookah', 'live music', 'cocktails'],
        music_genres: ['live_band', 'rnb', 'latin'],
        hours: {
            monday: null,
            tuesday: { open: '18:00', close: '00:00' },
            wednesday: { open: '18:00', close: '00:00' },
            thursday: { open: '18:00', close: '01:00' },
            friday: { open: '17:00', close: '02:00' },
            saturday: { open: '17:00', close: '02:00' },
            sunday: { open: '16:00', close: '23:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    }
];

// ===== Initialization =====

// The app is reachable two ways:
//   /customer-app/social.html?slug=viibeview   — slug in the query string
//   /a/viibeview/social                        — the pretty URL
//
// The pretty URL is a SERVER-SIDE rewrite (netlify.toml 200 rewrite in prod,
// the customer-app-rewrite middleware in Vite). Both rewrite the request path
// internally but leave the browser's address bar on /a/viibeview/social — so
// window.location.search is empty and the ?slug the rewrite appended is
// invisible to client JS. Reading only the query param meant every visit to
// the pretty URL bailed out with "App not found".
function resolveAppSlug() {
    const fromQuery = new URLSearchParams(window.location.search).get('slug');
    if (fromQuery) return fromQuery;

    // /a/{slug}[/social|/app|/checkin]
    const match = window.location.pathname.match(/^\/a\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function init() {
    appSlug = resolveAppSlug();

    if (!appSlug) {
        showEmptyState('App not found');
        return;
    }

    try {
        // Load app data. is_published matters as much as is_active: the venues
        // and venue_media RLS policies both require is_published = true, so an
        // unpublished app used to load a full shell with zero venues and then
        // silently fall back to the hardcoded demo data.
        const { data: app, error } = await supabaseClient
            .from('customer_apps')
            .select('*')
            .eq('slug', appSlug)
            .eq('is_active', true)
            .eq('is_published', true)
            .maybeSingle();

        if (error || !app) {
            showEmptyState('App not found');
            return;
        }

        currentApp = app;
        appFeatures = app.features || {};
        appSettings = app.settings || {};
        applyBranding(app);
        applyFeatureFlags();
        document.title = `${app.name} - Social`;

        // Before the feed paints, and before the four awaits below. The intro
        // overlay covers everything while venues and posts load behind it, so
        // a first-time visitor reads the intro instead of watching a shimmer.
        //
        // Order matters: the stored answers hydrate FIRST, so a member who
        // cleared the onboarded flag but kept their picks sees them selected.
        loadStoredPreferences();
        maybeShowOnboarding();

        // Needs appSettings, which was assigned three lines up: the tenant's
        // feed_radius_default is the fallback when this device has no choice
        // stored. Must also run before the first renderFilterPills(), which
        // paints the distance chip's label from it.
        loadRadiusPreference();

        SocialAuth.init({
            supabaseClient,
            appId: app.id,
            appSlug,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: SUPABASE_ANON_KEY
        });

        // The pill row must exist before anything reads or highlights it. It
        // renders empty until loadVenues() runs, because the chips are derived
        // from the venue set; loadVenues() re-renders it.
        renderFilterPills();

        // The country <select> has to exist before the signup form can be
        // opened, and the overlay can be opened from the very first tap.
        renderCountrySelect();

        loadSoundPreference();

        setupAuthListeners();

        // Sits between these two calls deliberately.
        //
        // AFTER setupAuthListeners(): #reset-form's submit handler and the eye
        // toggles have to exist before the view is shown, or pressing Enter in
        // the password field does a native GET submit and throws the page away.
        //
        // BEFORE renderProfileIdentity(): that reads the session, which this
        // may have just created from the recovery tokens.
        applyRecoveryOutcome(await recoveryOutcome);

        await renderProfileIdentity();

        // renderProfileIdentity() is what loads the member row, so this is the
        // first point at which the account's saved answers are known.
        await syncPreferencesWithMember();

        // Check if viewer is the business owner
        await checkOwnerAccess();

        // What this user follows, for every Follow button on the page. Must run
        // AFTER checkOwnerAccess(), which is what sets currentUserId.
        await loadFollowingState();

        // Request geolocation
        requestLocation();

        // Load venues for map
        await loadVenues();

        // The chip row exists now, so a saved preference can pick its opening
        // filter. Must run BEFORE the first loadFeed() or the app paints an
        // unfiltered feed and then visibly re-filters it.
        seedFilterFromPreferences();
        renderFilterPills();

        // Post pins double as the map's default centre, so they are loaded up
        // front rather than lazily with the map tab.
        await loadPostPins();

        // Load initial feed
        await loadFeed();

        // ⚠️ Load-bearing: if the preference-seeded filter came back empty, this
        // drops back to All. A blank opening feed caused by a choice made weeks
        // ago is indistinguishable from a broken app.
        await clearPreferenceSeedIfEmpty();

        // Setup event listeners
        setupEventListeners();

        // A recording that outlived its upload gets a second chance (#11).
        // Last, and not awaited by anything above it: it reads IndexedDB and
        // must never be on the critical path to a painted feed.
        refreshDraftBanner();

    } catch (err) {
        console.error('Init error:', err);
        showEmptyState('Something went wrong');
    }
}

// ===== Branding =====
function applyBranding(app) {
    const branding = app.branding || {};
    const primary = branding.primary_color || '#6366f1';
    const secondary = branding.secondary_color || '#1e293b';

    document.documentElement.style.setProperty('--app-primary', primary);
    document.documentElement.style.setProperty('--app-secondary', secondary);

    // Match the browser/OS chrome to the tenant's brand. The static manifest
    // can't do this per-tenant, but the meta tag can.
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', primary);

    // Header — show the app's own name ("ViibeView"), not the generic app-type
    // label. This was hardcoded to 'Social App', so no white-label app ever
    // showed its own brand in its own header.
    const appName = document.getElementById('header-app-name');
    const appLogo = document.getElementById('header-logo-img');
    const logoFallback = document.getElementById('header-logo-fallback');
    if (appName) {
        appName.textContent = app.name || 'Discover';
        // Stop i18n from overwriting the brand name on the next pass
        appName.removeAttribute('data-i18n');
    }
    if (logoFallback) logoFallback.textContent = (app.name || 'R').charAt(0).toUpperCase();
    if (appLogo && branding.logo_url) {
        appLogo.src = branding.logo_url;
        appLogo.style.display = 'block';
        if (logoFallback) logoFallback.style.display = 'none';
    }

    // Auth splash carries the same identity as the header
    const splashName = document.getElementById('auth-splash-name');
    const splashLogo = document.getElementById('auth-splash-logo');
    if (splashName) splashName.textContent = app.name || '';
    if (splashLogo) {
        if (branding.logo_url) {
            splashLogo.innerHTML = `<img src="${escapeHtml(branding.logo_url)}" alt="">`;
        } else {
            splashLogo.textContent = (app.name || 'R').charAt(0).toUpperCase();
        }
    }

    // Optional looping splash video from branding; the scrim keeps text legible
    // whether or not one is configured.
    const splashVideo = document.getElementById('auth-splash-video');
    if (splashVideo) {
        if (branding.splash_video_url) {
            splashVideo.src = branding.splash_video_url;
        } else {
            splashVideo.style.display = 'none';
        }
    }
}

// ===== Feature Flags =====
// customer_apps.features is written by the App Builder and the seed script but
// was never read here, so every toggle in the builder was purely cosmetic.
function applyFeatureFlags() {
    const enabled = (key) => appFeatures[key] !== false; // default on

    const toggles = [
        ['map_enabled', '[data-tab="map"]'],
        ['search_enabled', '[data-tab="search"]'],
        ['feed_enabled', '[data-tab="feed"]']
    ];

    toggles.forEach(([key, selector]) => {
        if (enabled(key)) return;
        document.querySelectorAll(selector).forEach(el => { el.style.display = 'none'; });
    });

    // One row carries both axes now, so it rides on the one flag. A tenant
    // that switched categories off was not asking for a music filter instead.
    if (!enabled('categories_enabled')) {
        const pills = document.getElementById('filter-pills');
        if (pills) pills.style.display = 'none';
    }
}

// Show the filter row only on the tabs where it filters something.
function updatePillVisibility() {
    const pills = document.getElementById('filter-pills');
    if (pills && appFeatures.categories_enabled !== false) {
        pills.style.display = CATEGORY_TABS.includes(activeTab) ? '' : 'none';
    }
    pinFilterPills();
}

// Max recording length, in seconds. Read from the app row so the App Builder
// value is authoritative; falls back to the SOW's 15s for ViibeView.
function maxVideoDuration() {
    const v = parseInt(appSettings.video_max_duration, 10);
    return Number.isFinite(v) && v > 0 ? v : 15;
}

// ===== Onboarding + preferences (#1, #2) =====
//
// Three intro panels and a "what are you into?" picker, shown ONCE per device
// on first open — to everyone, signed in or not. Anonymous browsing is a
// supported mode here, so gating the intro behind an account would mean most
// first-time visitors never saw it.
//
// Device-level (localStorage) is the correct scope for "have I seen the
// intro?". The ANSWERS are a different question: they follow the account once
// there is one, so a second device inherits them instead of asking again.
//
// ⚠️ What a preference DOES: it orders the filter chips and seeds the initially
// active one. It does NOT hard-filter the feed. availableFilters() derives the
// chip row from the venues the tenant actually has, so a member who picks
// "Rooftop" in a city with no rooftop venue would otherwise open the app on a
// permanently empty feed with nothing on screen explaining why.

const ONBOARDED_KEY = 'viibeview_onboarded_v1';
const PREFS_KEY = 'viibeview_prefs_v1';
const ONBOARDING_PANELS = 4;

let preferredCategories = [];
let preferredGenres = [];
let onboardingIndex = 0;
let onboardingScrollTicking = false;

// The seed is one-shot per page load. Without this guard, every
// refreshFilterPills() (an owner tapping a venue genre, a phone adding a venue)
// would shove a member who had deliberately tapped "All" back onto their
// preference mid-scroll.
let preferenceFilterSeeded = false;
// True only between the seed and the first loadFeed() that follows it, so the
// empty-feed fallback below can never fire against a filter the member chose.
let preferenceSeedPending = false;

function hasOnboarded() {
    try {
        return localStorage.getItem(ONBOARDED_KEY) === '1';
    } catch (err) {
        // Storage disabled (Safari private browsing, a locked-down profile).
        // We cannot remember the dismissal, so treat it as already seen: an
        // intro that reappears on EVERY page load is worse than one never shown.
        return true;
    }
}

function loadStoredPreferences() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
        if (!parsed || typeof parsed !== 'object') return;
        preferredCategories = Array.isArray(parsed.categories) ? parsed.categories : [];
        preferredGenres = Array.isArray(parsed.genres) ? parsed.genres : [];
    } catch (err) {
        // Corrupt or unavailable storage is not worth failing the app boot over.
    }
}

function writeStoredPreferences() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
            categories: preferredCategories,
            genres: preferredGenres
        }));
    } catch (err) {
        // See hasOnboarded(): storage is best-effort here.
    }
}

// Preferred slugs first, in the order they were picked; everything else keeps
// the shared vocabulary's order so the row does not reshuffle when a venue is
// edited. Array#sort has been stable since ES2019, which is what makes the
// "equal rank -> 0" branch below safe.
//
// ⚠️ Explicit comparisons, not `ra - rb`: two unranked entries are both
// Infinity and Infinity - Infinity is NaN, which no comparator should return.
function orderByPreference(list, preferred) {
    if (!preferred || !preferred.length) return list;
    const rank = new Map(preferred.map((slug, i) => [slug, i]));
    return list.slice().sort((a, b) => {
        const ra = rank.has(a.slug) ? rank.get(a.slug) : Infinity;
        const rb = rank.has(b.slug) ? rank.get(b.slug) : Infinity;
        if (ra === rb) return 0;
        return ra < rb ? -1 : 1;
    });
}

// The onboarding picker offers the FULL vocabularies, not availableFilters().
// Two reasons: it runs before loadVenues() has resolved, and a preference is
// about the person, not about which venues this tenant happens to have tonight.
function renderOnboardingChips() {
    const groups = [
        ['category', 'onboarding-categories', window.VENUE_CATEGORIES || [], preferredCategories],
        ['genre', 'onboarding-genres', window.MUSIC_GENRES || [], preferredGenres]
    ];

    groups.forEach(([kind, containerId, vocabulary, selected]) => {
        const box = document.getElementById(containerId);
        if (!box) return;
        box.innerHTML = vocabulary.map(item => {
            const on = selected.includes(item.slug);
            return `
                <button type="button" class="onboarding-chip"
                        aria-pressed="${on ? 'true' : 'false'}"
                        data-ob-kind="${kind}" data-ob-slug="${escapeHtml(item.slug)}"
                        data-i18n="${item.labelKey}">${escapeHtml(item.label)}</button>
            `;
        }).join('');
    });

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function toggleOnboardingChip(kind, slug) {
    const list = kind === 'category' ? preferredCategories : preferredGenres;
    const at = list.indexOf(slug);
    if (at === -1) list.push(slug); else list.splice(at, 1);
    renderOnboardingChips();
}

function renderOnboardingDots() {
    const dots = document.getElementById('onboarding-dots');
    if (!dots) return;
    dots.innerHTML = Array.from({ length: ONBOARDING_PANELS }, (_, i) =>
        `<span class="onboarding-dot${i === onboardingIndex ? ' active' : ''}"></span>`
    ).join('');
}

// `scroll: false` is for the case where the TRACK moved first (a swipe) and we
// are only catching the dots up — scrolling back would fight the gesture.
//
// The button label is written into textContent as well as data-i18n: I18n.t()
// returns the KEY when a translation is missing and applyTranslations() then
// leaves the node alone, so a node that is not pre-filled keeps the old label.
function setOnboardingIndex(index, { scroll = true } = {}) {
    onboardingIndex = Math.max(0, Math.min(ONBOARDING_PANELS - 1, index));

    const track = document.getElementById('onboarding-track');
    if (track && scroll) {
        track.scrollTo({ left: track.clientWidth * onboardingIndex, behavior: 'smooth' });
    }

    renderOnboardingDots();

    const next = document.getElementById('onboarding-next');
    if (next) {
        const last = onboardingIndex === ONBOARDING_PANELS - 1;
        next.setAttribute('data-i18n', last ? 'social.obDone' : 'social.obContinue');
        next.textContent = last ? 'Show me' : 'Continue';
    }

    // The back chevron, from panel 2 on.
    const back = document.getElementById('onboarding-back');
    if (back) back.style.visibility = onboardingIndex > 0 ? 'visible' : 'hidden';

    // The picker panel is dark, not a photo; the overlay tracks which it is on.
    document.getElementById('onboarding-overlay')
        ?.classList.toggle('on-picker', onboardingIndex === ONBOARDING_PANELS - 1);

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// First open on this device: show the intro once.
function maybeShowOnboarding() {
    if (hasOnboarded()) return;
    showOnboarding();
}

// The onboarding photos (Jay's design) are exported from Figma into
// customer-app/img/onboarding/{1,2,3}.jpg. Until they exist the panels show a
// solid --app-secondary background — flip this to true in the same deploy
// that adds the files, or every first open logs three 404s.
const ONBOARDING_PHOTOS_READY = false;

let onboardingWired = false;

/**
 * Shows the intro. `force` skips the per-device flag: a NEW ACCOUNT always
 * sees it, even on a browser that dismissed it before (Jay, 2026-10-06 — a
 * fresh signup on Tester 1's phone got no onboarding at all, because
 * viibeview_onboarded_v1 is per-browser and signup never looked again).
 *
 * ⚠️ This owns its own listeners rather than waiting for setupEventListeners(),
 * which runs at the END of init() behind four awaits. Wiring them there would
 * leave Skip and Next dead for as long as the venue and feed queries take —
 * on a slow connection, the entire time the intro is on screen. They are wired
 * ONCE: a forced second showing must not double every handler.
 */
function showOnboarding({ force = false } = {}) {
    if (!force && hasOnboarded()) return;

    const overlay = document.getElementById('onboarding-overlay');
    const track = document.getElementById('onboarding-track');
    if (!overlay || !track) return;
    if (overlay.classList.contains('visible')) return;

    if (ONBOARDING_PHOTOS_READY) {
        overlay.querySelectorAll('[data-ob-photo]').forEach(panel => {
            panel.style.backgroundImage = `url('${panel.dataset.obPhoto}')`;
        });
    }

    renderOnboardingChips();
    overlay.classList.add('visible');
    lockBodyScroll('onboarding');
    track.scrollLeft = 0;
    setOnboardingIndex(0, { scroll: false });

    if (onboardingWired) return;
    onboardingWired = true;

    document.getElementById('onboarding-skip')
        ?.addEventListener('click', () => finishOnboarding());

    document.getElementById('onboarding-next')?.addEventListener('click', () => {
        if (onboardingIndex >= ONBOARDING_PANELS - 1) finishOnboarding();
        else setOnboardingIndex(onboardingIndex + 1);
    });

    document.getElementById('onboarding-back')?.addEventListener('click', () => {
        if (onboardingIndex > 0) setOnboardingIndex(onboardingIndex - 1);
    });

    // Delegated: the chips are re-rendered on every tap.
    document.getElementById('onboarding-categories')?.addEventListener('click', onOnboardingChipClick);
    document.getElementById('onboarding-genres')?.addEventListener('click', onOnboardingChipClick);

    track.addEventListener('scroll', () => {
        if (onboardingScrollTicking) return;
        onboardingScrollTicking = true;
        requestAnimationFrame(() => {
            onboardingScrollTicking = false;
            const width = track.clientWidth || 1;
            const index = Math.round(track.scrollLeft / width);
            if (index !== onboardingIndex) setOnboardingIndex(index, { scroll: false });
        });
    }, { passive: true });
}

function onOnboardingChipClick(event) {
    const chip = event.target.closest('.onboarding-chip');
    if (!chip) return;
    toggleOnboardingChip(chip.dataset.obKind, chip.dataset.obSlug);
}

// Skip and Finish are the same path deliberately: skipping means "no
// preferences", which is a valid answer and the default one. The only
// difference is that Finish usually has chips selected.
function finishOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.remove('visible');
    unlockBodyScroll('onboarding');

    try {
        localStorage.setItem(ONBOARDED_KEY, '1');
    } catch (err) {
        // See hasOnboarded(). Nothing to do; the intro simply may reappear.
    }

    writeStoredPreferences();
    persistPreferences();

    // init() may already have loaded venues and painted the feed behind the
    // overlay, in which case the seed never got a chance to run. Do it now.
    if (venues.length && !preferenceFilterSeeded) {
        seedFilterFromPreferences();
        renderFilterPills();
        if (preferenceSeedPending) {
            loadFeed(false).then(clearPreferenceSeedIfEmpty);
        }
    } else {
        renderFilterPills();
    }
}

// Writes the current answers to the member row. Best-effort by design: the
// localStorage copy is what drives this session either way, and a visitor who
// is signed in but has no member row yet (mid-signup) correctly gets
// "Join this app first" back, which is not worth interrupting them for.
//
// ⚠️ Checks BOTH `error` and `success: false`. This RPC returns failure in its
// result row without setting PostgREST's error — the same shape that made
// submitPost() report success on a failed post.
async function persistPreferences() {
    if (!currentApp) return;
    if (!(await SocialAuth.isSignedIn())) return;

    const { data, error } = await supabaseClient.rpc('set_member_preferences', {
        p_app_id: currentApp.id,
        p_categories: preferredCategories,
        p_genres: preferredGenres
    });

    if (error) {
        console.warn('Failed to save preferences:', error.message);
        return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.success === false) {
        console.warn('Failed to save preferences:', row.error_message);
    }
}

// Reconciles device and account. Which side wins is decided by the member row:
//
//   member row has answers -> they win, and a second device inherits them
//   member row is empty    -> this device's onboarding answers are pushed up
//
// That ordering is what makes "merge into the member row on signup" work
// without a member who has already chosen being overwritten by a fresh
// device's blank slate.
async function syncPreferencesWithMember() {
    const member = SocialAuth.getMember ? SocialAuth.getMember() : null;
    if (!member) return;

    const remoteCategories = Array.isArray(member.preferred_categories) ? member.preferred_categories : [];
    const remoteGenres = Array.isArray(member.preferred_genres) ? member.preferred_genres : [];

    if (remoteCategories.length || remoteGenres.length) {
        preferredCategories = remoteCategories;
        preferredGenres = remoteGenres;
        writeStoredPreferences();
        // The intro may still be on screen on a second device — repaint so the
        // chips arrive pre-selected rather than asking a returning member to
        // answer a question they already answered.
        if (document.getElementById('onboarding-overlay')?.classList.contains('visible')) {
            renderOnboardingChips();
        }
        return;
    }

    if (preferredCategories.length || preferredGenres.length) {
        await persistPreferences();
    }
}

// Sets activeCategory/activeGenre BEFORE the first loadFeed(), so the app does
// not paint an unfiltered feed and then visibly re-filter it.
//
// Only ever picks a chip that availableFilters() actually offers — a preference
// for a category this tenant has no venue in is silently ignored rather than
// becoming a filter that matches nothing.
function seedFilterFromPreferences() {
    if (preferenceFilterSeeded) return;
    preferenceFilterSeeded = true;

    if (activeCategory || activeGenre || feedMode === 'following') return;
    if (!preferredCategories.length && !preferredGenres.length) return;

    const { categories, genres } = availableFilters();
    const category = preferredCategories.find(slug => categories.some(c => c.slug === slug)) || null;
    const genre = category
        ? null
        : (preferredGenres.find(slug => genres.some(g => g.slug === slug)) || null);

    if (!category && !genre) return;

    activeCategory = category;
    activeGenre = genre;
    preferenceSeedPending = true;
}

// ⚠️ The empty-feed fallback, and the reason the seed is safe at all.
// availableFilters() proves the CATEGORY exists; it proves nothing about
// anything having been POSTED under it. Opening the app on a blank feed because
// of a preference the member set once, weeks ago, is indistinguishable from the
// app being broken — so if the seeded filter returns nothing, drop straight
// back to All.
async function clearPreferenceSeedIfEmpty() {
    if (!preferenceSeedPending) return;
    preferenceSeedPending = false;
    if (feedItems.length) return;

    activeCategory = null;
    activeGenre = null;
    renderFilterPills();
    await loadFeed(false);
}

// ===== Session =====

// ⚠️ The reload is load-bearing beyond convenience: it is what rebuilds the
// bottom banner slot signed-out. Anything that turns this into an in-place
// teardown must also call refreshBottomBanners().
async function handleLogout() {
    await SocialAuth.signOut();
    window.location.reload();
}

// Swaps the Settings tab between its signed-out invitation and the real card.
// Browsing is deliberately anonymous — an account is only needed to post,
// follow, or keep a profile — so this is a prompt, never a wall.
async function renderProfileIdentity() {
    const signedOut = document.getElementById('profile-signed-out');
    const signedIn = document.getElementById('profile-signed-in');
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');

    const session = await SocialAuth.getSession();

    // The bottom banner slot is decided synchronously from a browser event
    // handler, so it reads this rather than awaiting the session itself.
    isMemberSignedIn = !!session;

    if (!session) {
        if (signedOut) signedOut.style.display = '';
        if (signedIn) signedIn.style.display = 'none';
        return;
    }

    const member = await SocialAuth.loadMember();
    const email = member?.email || session.user?.email || '';
    const meta = session.user?.user_metadata || {};
    const displayName =
        member?.display_name ||
        [member?.first_name, member?.last_name].filter(Boolean).join(' ') ||
        [meta.first_name, meta.last_name].filter(Boolean).join(' ') ||
        (email ? email.split('@')[0] : 'Member');

    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = email;
    if (signedOut) signedOut.style.display = 'none';
    if (signedIn) signedIn.style.display = '';

    // Avatar. app_members.avatar_url has existed since the original loyalty
    // schema and nothing wrote it until update_social_profile shipped.
    //
    // The markup's SVG placeholder is stashed on first paint and restored when
    // the avatar is removed — otherwise "Remove photo" would leave a broken
    // <img> behind, which is the same shape of bug as a stale venue page.
    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) {
        if (avatarEl.dataset.placeholder === undefined) {
            avatarEl.dataset.placeholder = avatarEl.innerHTML;
        }
        avatarEl.innerHTML = member?.avatar_url
            ? `<img src="${escapeHtml(member.avatar_url)}" alt="">`
            : avatarEl.dataset.placeholder;
    }

    // The follower counts moved to the Me tab, which fetches them every time
    // it opens (loadMeTab). They used to be painted here, at boot, sign-in and
    // profile save only — so a follow made in between left "0 Following" on
    // screen until a reload (Jay, 2026-10-06). If the Me tab is the one
    // showing, it is repainted with the new identity too.
    if (activeTab === 'me') loadMeTab();
}

// ===== Follow state =====
//
// What the signed-in user follows, as `${type}:${id}` keys. Read with a plain
// .select(): social_follows keeps an own-rows SELECT policy (migration
// 20260903000001 §3) exactly so the client can answer "am I following this?"
// without a round trip per button and without get_venue_detail growing an
// is_following column.
function followKey(type, id) {
    return `${type}:${id}`;
}

function isFollowing(type, id) {
    return followingKeys.has(followKey(type, id));
}

async function loadFollowingState({ force = false } = {}) {
    if (followingLoaded && !force) return;
    if (!currentApp || !currentUserId) {
        followingKeys = new Set();
        followingLoaded = false;
        return;
    }

    const { data, error } = await supabaseClient
        .from('social_follows')
        .select('followee_user_id, followee_venue_id')
        .eq('app_id', currentApp.id)
        .eq('follower_user_id', currentUserId);

    if (error) {
        // Non-fatal: every follow button falls back to "Follow", and tapping it
        // is idempotent server-side (ON CONFLICT DO NOTHING), so the worst case
        // is a button that says the wrong thing until the next load.
        //
        // ⚠️ Empty, not stale. Keeping the previous Set would paint "Following"
        // from a session that may have ended — and nothing retries, so that lie
        // survives for the rest of the page's life. An empty Set is wrong in the
        // recoverable direction: the button says "Follow", and tapping it is a
        // no-op server-side if the edge already exists.
        console.warn('Failed to load follow state:', error.message);
        followingKeys = new Set();
        followingLoaded = false;
        return;
    }

    followingKeys = new Set((data || []).map(row => row.followee_user_id
        ? followKey('user', row.followee_user_id)
        : followKey('venue', row.followee_venue_id)));
    followingLoaded = true;
}

// Follow / unfollow, shared by the venue page button and the member profile
// button. Optimistic, then reconciled — the same posture toggleVenueGenre()
// takes, and for the same reason: a button that stays lit over a rejected write
// is the same class of lie as a "Posted!" toast over a post that never existed.
//
// ⚠️ Family A RPC. A SECURITY DEFINER function returning success:false does NOT
// set PostgREST's `error` field (20260828000002:29-32), so this checks
// data[0].success. Testing only `error` would report a follow that never landed.
async function toggleFollow(type, id) {
    if (!currentApp || !id) return;

    // Hand the intent to requireAccount BEFORE it opens the overlay, so
    // onSignedIn() can finish the tap on the account that is about to exist.
    if (!(await requireAccount('Create an account to follow', {
        pendingFollow: { type, id },
    }))) return;

    // requireAccount() only guarantees a session; currentUserId is set by
    // checkOwnerAccess(), which onSignedIn() runs. Read it again rather than
    // assuming, so the first follow after a fresh signup is not a no-op.
    if (!currentUserId) await checkOwnerAccess();

    const key = followKey(type, id);

    // ⚠️ Second tap while the first write is open is dropped, not queued. The
    // two RPCs are opposites; resolving out of order leaves followingKeys and
    // the table disagreeing, and the optimistic rollback below then "restores"
    // a state that was never true.
    if (followInFlight.has(key)) return;
    followInFlight.add(key);

    const wasFollowing = followingKeys.has(key);

    if (wasFollowing) followingKeys.delete(key); else followingKeys.add(key);
    repaintFollowButtons();

    try {
        const { data, error } = await supabaseClient.rpc(
            wasFollowing ? 'unfollow_target' : 'follow_target',
            { p_app_id: currentApp.id, p_target_type: type, p_target_id: id }
        );

        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row || row.success === false) {
            if (wasFollowing) followingKeys.add(key); else followingKeys.delete(key);
            showToast(row?.error_message || error?.message || 'Could not update that');
            return;
        }

        // The server's follower count is authoritative — it excludes soft-deleted
        // members, which the client cannot see and therefore cannot compute.
        if (memberPageProfile && type === 'user' && memberPageUserId === id) {
            memberPageProfile.follower_count = row.follower_count ?? memberPageProfile.follower_count;
            renderMemberStats();
        }

        // Both RPCs return it; the venue page only started rendering a count in
        // 20260922000001, so this arm used to be thrown away.
        if (type === 'venue' && venuePageVenue && venuePageVenueId === id
            && row.follower_count !== null && row.follower_count !== undefined) {
            venuePageVenue.follower_count = row.follower_count;
            renderVenueFollowerCount();
        }

        // My own Following count changed. The Me tab refetches on every open,
        // but it can be the tab UNDER the overlay this follow happened in, and
        // closing the overlay must not reveal a stale number.
        refreshMeCounts();
    } finally {
        // In a finally: an exception from the RPC layer would otherwise wedge
        // this key permanently and the button would never respond again.
        followInFlight.delete(key);
        repaintFollowButtons();
    }
}

// Every visible follow control, repainted from followingKeys. One writer, so
// the venue page's button and the member page's button cannot disagree.
function repaintFollowButtons() {
    const memberBtn = document.getElementById('member-page-follow-btn');
    // Not on your own profile: that slot is Edit profile (renderMemberProfile).
    if (memberBtn && memberPageUserId && memberPageUserId !== currentUserId) {
        paintFollowButton(memberBtn, isFollowing('user', memberPageUserId),
            followInFlight.has(followKey('user', memberPageUserId)));
    }

    const venueBtn = document.getElementById('venue-page-follow-btn');
    if (venueBtn && venuePageVenueId) {
        paintFollowButton(venueBtn, isFollowing('venue', venuePageVenueId),
            followInFlight.has(followKey('venue', venuePageVenueId)));
    }
}

// `busy` sets the disabled attribute, which is what finally activates the
// .follow-btn:disabled rule that has been sitting in social.css unreachable —
// no CSS change is needed here.
function paintFollowButton(btn, following, busy = false) {
    btn.classList.toggle('following', following);
    btn.disabled = !!busy;
    btn.setAttribute('data-i18n', following ? 'social.followingState' : 'social.follow');
    btn.textContent = following ? 'Following' : 'Follow';
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// The venue follower count writes into its OWN span and nothing else.
//
// ⚠️ Deliberately NOT a re-render of #venue-page-identity: that block owns the
// avatar, name, rating, here-now badge and distance, and rebuilding all of it
// to change one number is the repaintVenueGenres() mistake — an outerHTML swap
// that throws away every piece of state the surrounding markup was holding.
function renderVenueFollowerCount() {
    const el = document.getElementById('venue-page-followers');
    if (!el) return;

    const count = venuePageVenue?.follower_count;
    if (count === null || count === undefined) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }

    // Reuses `social.followers`, the key the member profile's stat row already
    // ships in all 8 locales — no new key, so no TRANSLATION_VERSION bump is
    // owed by this phase.
    el.style.display = '';
    el.innerHTML = `<strong>${escapeHtml(String(count))}</strong> `
        + `<span data-i18n="social.followers">Followers</span>`;
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// ===== Auth Overlay =====

function showAuth(view = 'splash') {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    setAuthView(view);
    overlay.classList.add('visible');
    lockBodyScroll('auth');
}

function hideAuth() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    unlockBodyScroll('auth');
}

// Maps the result of SocialAuth.handleRecoveryLink() onto the overlay. This is
// the only thing that decides whether the reset view opens on page load.
function applyRecoveryOutcome(outcome) {
    switch (outcome?.status) {
        case 'ready':
            showAuth('reset');
            break;

        case 'expired':
        case 'failed':
            // Show the panel, not an error string. The raw GoTrue wording
            // ("Auth session missing!", "Email link is invalid or has expired")
            // is what a tester was handed, and it tells them nothing about what
            // to do next.
            console.warn('Password recovery link rejected:', outcome.code || outcome.status, outcome.detail || '');
            showAuth('reset');
            setResetMode('expired');
            break;

        default:
            // 'signed-in' and 'none'. Leave the overlay shut — browsing without
            // an account is this app's front door and must stay that way.
            break;
    }
}

// #auth-view-reset holds two panels: the form, and the "this link is spent"
// message. One view rather than two so the header, close button and the
// [data-auth-view] back-stack behave identically either way.
function setResetMode(mode) {
    const form = document.getElementById('reset-form');
    const expired = document.getElementById('reset-expired');
    if (form) form.style.display = mode === 'expired' ? 'none' : '';
    if (expired) expired.style.display = mode === 'expired' ? '' : 'none';
}

function setAuthView(view) {
    ['splash', 'login', 'signup', 'forgot', 'reset'].forEach(v => {
        const el = document.getElementById(`auth-view-${v}`);
        if (el) el.style.display = v === view ? '' : 'none';
    });

    // Reset to the form every time the view is entered. Without this, the
    // signed-in "Change Password" button inherits whatever panel a failed
    // recovery landing left behind — telling someone with a perfectly good
    // session that their link has expired.
    if (view === 'reset') setResetMode('form');

    clearAuthErrors();

    // Autofocus the first real input, but not on the splash (no form there)
    // and not on touch, where it yanks the keyboard open unprompted.
    if (view !== 'splash' && !('ontouchstart' in window)) {
        const first = document.querySelector(`#auth-view-${view} input`);
        if (first) setTimeout(() => first.focus(), 50);
    }
}

function clearAuthErrors() {
    document.querySelectorAll('.auth-field-error, .auth-form-error, .auth-form-success')
        .forEach(el => { el.textContent = ''; el.style.display = 'none'; });
    document.querySelectorAll('.auth-field input.invalid')
        .forEach(el => el.classList.remove('invalid'));
}

function setFieldError(fieldId, message) {
    const el = document.getElementById(`${fieldId}-error`);
    const input = document.getElementById(fieldId);
    if (el) {
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
    }
    if (input) input.classList.toggle('invalid', !!message);
    return !message;
}

function setFormMessage(formId, message, kind = 'error') {
    const el = document.getElementById(`${formId}-${kind === 'error' ? 'error' : 'success'}`);
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
}

function setSubmitting(buttonId, busy, busyLabel) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    if (busy) {
        btn.dataset.label = btn.textContent;
        btn.textContent = busyLabel || 'Please wait…';
        btn.disabled = true;
    } else {
        if (btn.dataset.label) btn.textContent = btn.dataset.label;
        btn.disabled = false;
    }
}

function renderStrengthMeter(meterId, password) {
    const meter = document.getElementById(meterId);
    if (!meter) return;
    const score = SocialAuth.passwordStrength(password);
    [...meter.children].forEach((bar, i) => {
        bar.className = i < score ? `filled s${score}` : '';
    });
}

// Gate used by anything that needs an account (posting now; following and
// profile editing from Phase 2). Returns true when the caller may proceed.
//
// `pendingVenueId` records what the visitor was trying to do so onSignedIn()
// can finish it. Auth first, composer second — deliberately, so a recording is
// never held across an email-confirmation redirect that discards the page.
async function requireAccount(reason, { pendingVenueId, pendingFollow } = {}) {
    if (await SocialAuth.isSignedIn()) return true;

    if (pendingVenueId !== undefined) {
        pendingComposerVenueId = pendingVenueId;
        hasPendingComposer = true;
    }

    if (pendingFollow && pendingFollow.type && pendingFollow.id) {
        pendingFollowType = pendingFollow.type;
        pendingFollowId = pendingFollow.id;
        hasPendingFollow = true;
    }

    if (reason) showToast(reason);
    showAuth('signup');
    return false;
}

// ===== Signup: country dial codes =====

// Populated from /js/country-dial-codes.js, which is the full ISO list. A
// <select> rather than a search widget: 240 options is nothing for a native
// picker, and there is no custom dropdown to build, style or make accessible.
function renderCountrySelect() {
    const select = document.getElementById('signup-country');
    if (!select) return;

    const countries = window.COUNTRY_DIAL_CODES || [];
    if (countries.length === 0) {
        // The dataset failed to load. Leave a working +1 rather than an empty
        // select that silently posts no dial code at all.
        select.innerHTML = '<option value="US" data-dial="1">United States (US) +1</option>';
        return;
    }

    // Label is "France (FR) +33", and the list is ordered by country name.
    //
    // The name leads deliberately. A native <select> does type-ahead against
    // the option text FROM THE FIRST CHARACTER, so a label starting with the
    // flag emoji (as this did) makes every option begin with the same class of
    // character — typing "f" for France jumped nowhere, and the only way to
    // find a country was to already know its dial code and scan 240 numbers.
    // With the name first, typing "fra" lands on France. The ISO code is kept
    // because it is what people recognise on sight (FR, US, GB), and the dial
    // code trails because it is the one part nobody searches by.
    select.innerHTML = countries.map(c => `
        <option value="${escapeHtml(c.iso)}" data-dial="${escapeHtml(c.dial)}">${escapeHtml(c.name)} (${escapeHtml(c.iso)}) +${escapeHtml(c.dial)}</option>
    `).join('');

    const defaultIso = window.defaultCountryIso ? window.defaultCountryIso('US') : 'US';
    select.value = defaultIso;
    if (!select.value) select.value = 'US';
}

// Calling code for the currently selected country, without the '+'.
function selectedDialCode() {
    const select = document.getElementById('signup-country');
    const option = select?.selectedOptions?.[0];
    return option?.dataset.dial || SocialAuth.NANP_DIAL;
}

// ===== Auth Wiring =====

function setupAuthListeners() {
    // View switching — every element carrying data-auth-view
    document.querySelectorAll('[data-auth-view]').forEach(el => {
        el.addEventListener('click', () => setAuthView(el.dataset.authView));
    });

    // Show/hide password
    document.querySelectorAll('[data-toggle-password]').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.togglePassword);
            if (!input) return;
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
            btn.classList.toggle('active', !showing);
        });
    });

    // Entry points from the Profile tab
    document.getElementById('profile-signup-btn')?.addEventListener('click', () => showAuth('signup'));
    document.getElementById('profile-login-btn')?.addEventListener('click', () => showAuth('login'));
    document.getElementById('me-signup-btn')?.addEventListener('click', () => showAuth('signup'));
    document.getElementById('me-login-btn')?.addEventListener('click', () => showAuth('login'));
    // "Browse without an account" abandons whatever the overlay interrupted.
    // Without this, a visitor who taps Create, backs out, and signs in an hour
    // later from the Profile tab gets a composer they never asked for.
    // Cleared HERE and not in hideAuth(), which the successful-auth paths call
    // immediately before onSignedIn() — the one moment the intent must survive.
    document.getElementById('auth-browse-btn')?.addEventListener('click', () => {
        hasPendingComposer = false;
        pendingComposerVenueId = undefined;
        hasPendingFollow = false;
        pendingFollowType = undefined;
        pendingFollowId = undefined;
        hideAuth();
    });

    // Live formatting + strength feedback.
    // The (310) 555-0101 mask is a North American convention and applies to +1
    // only — running it over a French or Nigerian number produces something the
    // user cannot recognise as their own phone.
    const phoneInput = document.getElementById('signup-phone');
    phoneInput?.addEventListener('input', () => {
        if (selectedDialCode() === SocialAuth.NANP_DIAL) {
            phoneInput.value = SocialAuth.formatPhone(phoneInput.value);
        }
    });

    // Switching country re-applies (or drops) the mask on what is already typed.
    document.getElementById('signup-country')?.addEventListener('change', () => {
        if (!phoneInput) return;
        const digits = phoneInput.value.replace(/\D/g, '');
        phoneInput.value = selectedDialCode() === SocialAuth.NANP_DIAL
            ? SocialAuth.formatPhone(digits)
            : digits;
        setFieldError('signup-phone', null);
    });

    const signupPassword = document.getElementById('signup-password');
    signupPassword?.addEventListener('input', () => renderStrengthMeter('signup-strength', signupPassword.value));

    const resetPassword = document.getElementById('reset-password');
    resetPassword?.addEventListener('input', () => renderStrengthMeter('reset-strength', resetPassword.value));

    // Validate email format on blur — SOW calls this out specifically
    document.getElementById('signup-email')?.addEventListener('blur', (e) => {
        setFieldError('signup-email', SocialAuth.validateEmail(e.target.value));
    });

    document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
    document.getElementById('signup-form')?.addEventListener('submit', handleSignupSubmit);
    document.getElementById('forgot-form')?.addEventListener('submit', handleForgotSubmit);
    document.getElementById('reset-form')?.addEventListener('submit', handleResetSubmit);
    document.getElementById('contact-form')?.addEventListener('submit', handleContactSubmit);

    document.getElementById('change-password-btn')?.addEventListener('click', () => showAuth('reset'));
    document.getElementById('delete-account-btn')?.addEventListener('click', confirmDeleteAccount);

    // The reset view is the one place a recovery link can drop someone who
    // never opened the overlay themselves, and it had no exit at all — every
    // other view has a back arrow or a "browse without an account". Without
    // this the app is simply stuck behind the password form.
    document.getElementById('reset-close')?.addEventListener('click', hideAuth);

    ['contact-us-btn', 'contact-us-btn-out'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', openContactSheet);
    });
    document.getElementById('contact-close')?.addEventListener('click', closeContactSheet);
    document.getElementById('contact-backdrop')?.addEventListener('click', closeContactSheet);

    // Arriving from a password-recovery email is NOT decided here any more.
    // Sniffing window.location at this point raced supabase-js for the same
    // one-shot fragment and lost about as often as it won. init() now applies
    // SocialAuth.handleRecoveryLink(), which reads a snapshot taken before any
    // client existed — see applyRecoveryOutcome().
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    setSubmitting('login-submit', true, 'Logging in…');
    const result = await SocialAuth.signIn({ email, password });
    setSubmitting('login-submit', false);

    if (!result.ok) {
        setFormMessage('login-form', result.error);
        return;
    }

    hideAuth();
    await onSignedIn();
    showToast('Welcome back');
}

async function handleSignupSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const firstName = document.getElementById('signup-first-name').value;
    const lastName = document.getElementById('signup-last-name').value;
    const email = document.getElementById('signup-email').value;
    const phone = document.getElementById('signup-phone').value;
    const dialCode = selectedDialCode();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;
    const acceptedTerms = document.getElementById('signup-terms').checked;

    // Field-level errors first, so the user sees exactly which input to fix
    // rather than one generic message at the bottom of the form.
    let valid = true;
    valid = setFieldError('signup-first-name', firstName.trim() ? null : 'Enter your first name') && valid;
    valid = setFieldError('signup-email', SocialAuth.validateEmail(email)) && valid;
    // Phone is required now: it is how a venue reaches someone about a Viibe,
    // and how Royal AI can text a member at all.
    valid = setFieldError('signup-phone', SocialAuth.validatePhone(phone, { required: true, dial: dialCode })) && valid;
    valid = setFieldError('signup-password', SocialAuth.validatePassword(password)) && valid;
    valid = setFieldError('signup-confirm', SocialAuth.validatePasswordMatch(password, confirmPassword)) && valid;
    valid = setFieldError('signup-terms', acceptedTerms ? null : 'Accept the Terms & Conditions to continue') && valid;
    if (!valid) return;

    setSubmitting('signup-submit', true, 'Creating account…');
    const result = await SocialAuth.signUp({
        email, password, confirmPassword, firstName, lastName, phone, dialCode, acceptedTerms
    });
    setSubmitting('signup-submit', false);

    if (!result.ok) {
        // Field-tagged errors land on their own input, not in the footer:
        // 'email' (already registered, bad format) and 'password' come from the
        // social-signup function; 'phone' comes from linkMembership, where
        // app_members' UNIQUE(app_id, phone) is now reachable.
        if (result.field && document.getElementById(`signup-${result.field}`)) {
            setFieldError(`signup-${result.field}`, result.error);
        } else if (/already registered/i.test(result.error)) {
            setFieldError('signup-email', result.error);
        } else {
            setFormMessage('signup-form', result.error);
        }
        return;
    }

    // No needsConfirmation branch any more. Signup goes through the
    // social-signup edge function, which creates the account pre-confirmed and
    // then signs in — so by the time we get here there is a real session.
    // Being bounced to the login form to wait for an email was the single
    // worst step in this flow, and a mistyped address made it unrecoverable.
    hideAuth();
    await onSignedIn();
    showToast('Welcome to ViibeView');

    // A new account always gets the intro, whatever this browser saw before.
    showOnboarding({ force: true });
}

async function handleForgotSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const email = document.getElementById('forgot-email').value;
    if (!setFieldError('forgot-email', SocialAuth.validateEmail(email))) return;

    setSubmitting('forgot-submit', true, 'Sending…');
    const result = await SocialAuth.requestPasswordReset(email);
    setSubmitting('forgot-submit', false);

    if (!result.ok) {
        setFormMessage('forgot-form', result.error);
        return;
    }

    // Deliberately unconditional — confirming whether an address is registered
    // would make this form an account-enumeration oracle.
    setFormMessage('forgot-form', 'If that email has an account, a reset link is on its way.', 'success');
}

async function handleResetSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const password = document.getElementById('reset-password').value;
    const confirmPassword = document.getElementById('reset-confirm').value;

    let valid = true;
    valid = setFieldError('reset-password', SocialAuth.validatePassword(password)) && valid;
    valid = setFieldError('reset-confirm', SocialAuth.validatePasswordMatch(password, confirmPassword)) && valid;
    if (!valid) return;

    setSubmitting('reset-submit', true, 'Updating…');
    const result = await SocialAuth.updatePassword({ password, confirmPassword });
    setSubmitting('reset-submit', false);

    if (!result.ok) {
        // There is no session to update against — the link was spent before the
        // password was typed, or it expired while the form sat open. An error
        // under the submit button would just invite a retry that cannot work,
        // so swap to the panel that offers a fresh link.
        if (result.code === 'no_session') setResetMode('expired');
        setFormMessage('reset-form', result.error);
        return;
    }

    // handleRecoveryLink() already scrubbed the landing payload, but the
    // signed-in "Change Password" path never had one — and a stale fragment
    // from any other source must not survive a successful change either.
    // history.state passed through: the back-navigation guard lives in it.
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    hideAuth();
    await onSignedIn();
    showToast('Password updated');
}

// Runs after any successful sign-in / sign-up.
async function onSignedIn() {
    await SocialAuth.loadMember({ force: true });

    // The merge point. A visitor who answered the onboarding picker while
    // signed out has those answers in localStorage only — this is what carries
    // them onto the account they just created.
    await syncPreferencesWithMember();

    await checkOwnerAccess();
    await loadFollowingState({ force: true });

    // ⚠️ The venue / member page is still mounted UNDERNEATH the auth overlay,
    // painted from a followingKeys that was empty for the whole signed-out
    // session. Reloading the state without repainting leaves a correct Set
    // behind a stale label — which is exactly what "I signed up and it still
    // says Follow" looked like. Must come after checkOwnerAccess(), which is
    // what sets currentUserId and therefore what loadFollowingState() needs.
    repaintFollowButtons();

    await renderProfileIdentity();

    // The Following chip only exists for a signed-in visitor, and
    // checkOwnerAccess() has just set currentUserId — so the row has to be
    // rebuilt or the chip does not appear until the next reload.
    renderFilterPills();

    // The feed cards render Delete vs Report from currentUserId, which was null
    // for the whole signed-out session.
    if (feedHasRendered) renderFeed();

    // The bottom banner slot belongs to whichever prompt fits the session, and
    // the session just changed under a page that is already painted. Swap the
    // signup banner for the install one immediately: waiting for the two-visit
    // rule would leave the slot empty for the rest of a session in which the
    // visitor just told us they are staying.
    refreshBottomBanners({ justSignedIn: true });

    // refreshDraftBanner() returns early when signed out, so a draft saved
    // before a session expired only becomes offerable now.
    refreshDraftBanner();

    // Finish what the visitor was doing when the overlay interrupted them.
    if (hasPendingFollow) {
        const type = pendingFollowType;
        const id = pendingFollowId;
        hasPendingFollow = false;
        pendingFollowType = undefined;
        pendingFollowId = undefined;
        // Not awaited: the follow is a side effect of the signup, not something
        // the rest of onSignedIn() depends on, and toggleFollow() repaints on
        // its own. Deliberately before the composer — a pending follow cannot
        // coexist with a pending composer, but if both were somehow set, the
        // composer is the one that opens a sheet and should win the foreground.
        toggleFollow(type, id);
    }

    if (hasPendingComposer) {
        const venueId = pendingComposerVenueId;
        hasPendingComposer = false;
        pendingComposerVenueId = undefined;
        openCreatePost(venueId);
    }
}

// ===== Contact Us =====

function openContactSheet() {
    const sheet = document.getElementById('contact-sheet');
    const backdrop = document.getElementById('contact-backdrop');
    if (!sheet || !backdrop) return;

    clearAuthErrors();
    const emailInput = document.getElementById('contact-email');
    const member = SocialAuth.getMember();
    if (emailInput && member?.email) emailInput.value = member.email;

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('contact');
}

function closeContactSheet() {
    document.getElementById('contact-sheet')?.classList.remove('visible');
    document.getElementById('contact-backdrop')?.classList.remove('visible');
    unlockBodyScroll('contact');
}

async function handleContactSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const email = document.getElementById('contact-email').value;
    const message = document.getElementById('contact-message').value;

    let valid = true;
    valid = setFieldError('contact-email', SocialAuth.validateEmail(email)) && valid;
    valid = setFieldError('contact-message', message.trim().length >= 10 ? null : 'Tell us a little more (at least 10 characters)') && valid;
    if (!valid) return;

    setSubmitting('contact-submit', true, 'Sending…');
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/contact-inquiry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                type: 'support',   // one of contact-inquiry's known TYPE_SUBJECTS
                name: [SocialAuth.getMember()?.first_name, SocialAuth.getMember()?.last_name]
                    .filter(Boolean).join(' ') || 'App member',
                email: email.trim(),
                message: message.trim(),
                source: `${currentApp?.slug || 'social'}-app`
            })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Could not send your message');
        }

        document.getElementById('contact-form').reset();
        setFormMessage('contact-form', 'Thanks — we will get back to you shortly.', 'success');
        setTimeout(closeContactSheet, 2200);
    } catch (err) {
        setFormMessage('contact-form', err.message || 'Could not send your message. Try again.');
    } finally {
        setSubmitting('contact-submit', false);
    }
}

// ===== Delete Account =====

function confirmDeleteAccount() {
    showConfirm({
        title: 'Delete your account?',
        body: 'This permanently removes your account and your posts. It cannot be undone.',
        acceptLabel: 'Delete Account',
        onAccept: async () => {
            showToast('Deleting your account…');
            const result = await SocialAuth.deleteAccount();
            if (!result.ok) {
                showToast(result.error);
                return;
            }
            window.location.reload();
        }
    });
}

function showConfirm({ title, body, acceptLabel, onAccept }) {
    const dialog = document.getElementById('confirm-dialog');
    const backdrop = document.getElementById('confirm-backdrop');
    if (!dialog || !backdrop) return;

    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = body;

    const accept = document.getElementById('confirm-accept');
    const cancel = document.getElementById('confirm-cancel');
    accept.textContent = acceptLabel;

    const close = () => {
        dialog.classList.remove('visible');
        backdrop.classList.remove('visible');
        unlockBodyScroll('confirm');
        // Replacing the nodes drops every listener — no accumulation across opens
        accept.replaceWith(accept.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
    };

    accept.addEventListener('click', async () => { close(); await onAccept(); });
    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', close, { once: true });

    dialog.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('confirm');
}

// ===== Owner Access Check =====
//
// This no longer gates the create button — posting is open to any signed-in
// member. What it still establishes is (a) who the viewer is, so a feed card
// can offer Delete instead of Report, and (b) ownerOrgId, which the owner
// upload path still needs for the {orgId}/{venueId}/ storage prefix.
async function checkOwnerAccess() {
    isOwner = false;
    ownerOrgId = null;
    ownedVenueIds = new Set();

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        currentUserId = session?.user?.id || null;
        if (!session) return;

        // Per-venue ownership. RLS returns only this user's own rows.
        const { data: owned } = await supabaseClient
            .from('venue_owners')
            .select('venue_id')
            .eq('user_id', session.user.id);
        ownedVenueIds = new Set((owned || []).map(r => r.venue_id));

        // Check if this user is an org member for the current app's organization
        const { data: membership } = await supabaseClient
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', session.user.id)
            .eq('organization_id', currentApp.organization_id)
            .maybeSingle();

        if (membership) {
            isOwner = true;
            ownerOrgId = membership.organization_id;
        }
    } catch (e) {
        // Not an owner — that's fine, they post through the member path
    }

    applyOwnerAffordances();
}

// The admin-only entry points. Called from checkOwnerAccess() rather than
// rendered conditionally, because that runs both at startup and again after
// sign-in — an org member who signs in mid-session must get the button without
// a reload, and a member who signs out must lose it.
//
// This is presentation only. The actual authority is the "Org members can
// manage venues" RLS policy, which is FOR ALL and tests for an
// organization_members row; hiding a button is not a security control and is
// not relied on as one.
function applyOwnerAffordances() {
    ['add-venue-btn', 'search-add-venue-btn', 'app-settings-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isOwner ? '' : 'none';
    });

    // The open venue page's "Add flyer", for a sign-in that happened on top of it.
    const flyerBtn = document.getElementById('venue-page-flyer-btn');
    if (flyerBtn) flyerBtn.style.display = canManageVenue(venuePageVenueId) ? '' : 'none';
}

// Org members manage every venue; an owner manages theirs.
function canManageVenue(venueId) {
    return isOwner || (!!venueId && ownedVenueIds.has(venueId));
}

// ===== Geolocation =====
function requestLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };

            // Re-render for distances ONLY when it costs nothing. This used to
            // fire unconditionally, and since renderFeed() replaces innerHTML
            // it tore down every <video> mid-playback the moment the GPS
            // permission resolved — which on a cold start is a few seconds
            // after the user has started scrolling.
            if (!feedHasRendered || activeTab !== 'feed') renderFeed();

            // Deliberately NOT recentring the map here. The default centre is
            // now the most recent post (see initMap), and this would fight it
            // whenever geolocation resolved after the map mounted.
            // #center-on-me-btn still does it, explicitly, on request.
            renderVenueSwimLane();

            // ⚠️ The distance filter is SUPPRESSED until there is a fix — see
            // loadFeed(). A member whose device remembers "5 mi" therefore gets
            // an unfiltered first paint, and without this the chip would sit
            // there reading "5 mi" over a feed that is not filtered at all.
            // Only reload when a radius is actually waiting on the fix.
            if (feedRadiusMiles !== null) {
                renderFilterPills();
                loadFeed(false);
            }
        },
        (err) => {
            console.warn('Geolocation denied:', err.message);
            showLocationBanner();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
}

// ===== Venues =====
async function loadVenues() {
    if (!currentApp) return;

    const { data, error } = await supabaseClient.rpc('get_venues_for_map', {
        p_app_id: currentApp.id
    });

    if (error) {
        console.error('Failed to load venues:', error);
        showToast('Failed to load venues. Pull down to retry.');
        return;
    }

    venues = data || [];

    // Fall back to sample venues so the app is explorable before any real ones
    // exist — but SAY SO. Silently swapping in fake data is what hid both the
    // broken category filter and the fact that this app has no venues at all:
    // everything looked populated and working.
    usingDemoVenues = venues.length === 0;
    if (usingDemoVenues) {
        // COPY, not the array itself. `venues` is pushed to when an org member
        // adds a venue from their phone, and assigning the const DEMO_VENUES
        // directly would make that push mutate the demo data for the rest of
        // the session — a sixth "sample" venue that is actually real.
        venues = [...DEMO_VENUES];
        showSampleDataNotice();
    }

    // The chips are derived from this list, so they are rebuilt on every load
    // rather than once at startup.
    renderFilterPills();
}

// Shown only while DEMO_VENUES are standing in for real data.
function showSampleDataNotice() {
    if (document.getElementById('sample-data-notice')) return;

    // This notice takes precedence — drop the location banner if it beat us here
    // (geolocation resolves independently of the venue fetch, so either can win).
    document.getElementById('location-banner')?.remove();

    const notice = document.createElement('div');
    notice.id = 'sample-data-notice';
    notice.className = 'sample-data-notice';
    notice.innerHTML = `
        <span>Showing sample venues — none have been added yet</span>
        <button class="sample-data-notice-close" type="button" aria-label="Dismiss">&times;</button>
    `;
    notice.querySelector('.sample-data-notice-close')
        .addEventListener('click', () => notice.remove());

    insertBelowFilterRows(notice);
}

// Notice bars sit BELOW the sticky filter row, never above or inside it.
function insertBelowFilterRows(node) {
    const anchor = document.getElementById('filter-pills');
    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(node, anchor.nextSibling);
    } else {
        document.body.appendChild(node);
    }
}

function getVenueById(id) {
    return venues.find(v => v.id === id);
}

// A venue id that create_social_post will actually accept.
//
// ⚠️ DEMO_VENUES ids are the strings 'demo-1'..'demo-5', not UUIDs. Posting to
// one fails create_social_post's venue-belongs-to-app check
// (20260828000002:114-124) — and fails it as success:false, which is the shape
// that used to be swallowed silently. The picker, the composer default and the
// "here tonight" badge all exclude them.
function isDemoVenueId(id) {
    return String(id || '').startsWith('demo-');
}

function realVenues() {
    return venues.filter(v => !isDemoVenueId(v.id));
}

function venueGenres(venue) {
    return Array.isArray(venue?.music_genres) ? venue.music_genres : [];
}

// The client-side half of the two filter axes. The feed applies both in SQL;
// the map pins, swim lane and search list apply them here, over the `venues`
// array that get_venues_for_map already returned.
function venueMatchesFilters(venue) {
    if (!venue) return false;
    if (activeCategory && venue.category !== activeCategory) return false;
    if (activeGenre && !venueGenres(venue).includes(activeGenre)) return false;
    return true;
}

function filteredVenues() {
    return venues.filter(venueMatchesFilters);
}

// ===== Feed =====
async function loadFeed(append = false) {
    if (feedLoading) return;
    // feedHasMore only gates pagination. It used to gate fresh loads too, so
    // once a feed ran out (or came back empty on first load) every subsequent
    // category change was silently dropped — the filter looked dead.
    if (append && !feedHasMore) return;
    feedLoading = true;

    if (!append) {
        feedOffset = 0;
        feedItems = [];
        feedHasMore = true;
    }

    // ⚠️ First load only. The shimmer now OVERLAYS the scroller (it would
    // otherwise squeeze the panels as a flex sibling), so showing it while
    // paginating would blank the Viibe the user is watching mid-scroll.
    showFeedLoading(!append);

    // Two RPCs, one identical RETURNS TABLE, one renderFeedCard(). They are
    // separate functions rather than a p_following argument on get_venue_feed
    // because a merged function could not have an honest grant footer —
    // browsing must be anon-executable and a Following feed cannot be. See the
    // header of migration 20260903000004.
    //
    // ⚠️ Belt and braces on the mode: get_following_feed_v3 returns zero rows
    // for a null auth.uid(), which would read as "nobody you follow has posted"
    // rather than "you are signed out". Falling back to the public feed here
    // means signing out can never strand the tab on an unexplainable empty
    // state, even if a chip survived the sign-out.
    //
    // ⚠️ _v3 (migration 20260907000002) — SIBLINGS of the v2 pair, not
    // replacements. get_venue_feed / get_following_feed are still installed and
    // untouched, which makes rollback these two identifiers and nothing else.
    // v3 adds distance, a server-side TTL and video-only; the RETURNS TABLE is
    // byte-identical, so renderFeedCard() did not change with it.
    const useFollowing = feedMode === 'following' && !!currentUserId;
    const rpcName = useFollowing ? 'get_following_feed_v3' : 'get_venue_feed_v3';

    // ⚠️ Coordinates come from the CACHED userLocation and are never awaited
    // here. getCurrentCoords() can block for up to 10 seconds behind a
    // permission dialog, and loadFeed() runs on every chip tap.
    //
    // ⚠️ No fix means NO RADIUS, not radius-with-null-coords. A denied or
    // still-pending location permission must never produce an empty feed —
    // the RPC guards this too, but the client must not be the thing that
    // asks for an impossible filter in the first place.
    const coords = userLocation;
    const radius = coords ? feedRadiusMiles : null;

    // Named arguments, so a parameter landing in the middle of the signature
    // does not shift anything. activeCategory and activeGenre are already
    // normalized to null by normalizeCategory()/normalizeGenre() — the literal
    // strings 'all' would filter on a value no row has and empty the feed
    // silently.
    const { data, error } = await supabaseClient.rpc(rpcName, {
        p_app_id: currentApp.id,
        p_category: activeCategory,
        p_genre: activeGenre,
        p_lat: coords ? coords.lat : null,
        p_lng: coords ? coords.lng : null,
        p_radius_miles: radius,
        p_limit: FEED_PAGE_SIZE,
        p_offset: feedOffset
    });

    feedLoading = false;
    showFeedLoading(false);

    if (error) {
        console.error('Failed to load feed:', error);
        // ⚠️ An error on a FRESH load must not leave the previous filter's
        // panels on screen — that reads as the new chip having no effect. The
        // empty state is at least honest about there being nothing to show.
        if (!append) {
            feedItems = [];
            renderFeed();
        }
        return;
    }

    if (!data || data.length < FEED_PAGE_SIZE) {
        feedHasMore = false;
    }

    if (append) {
        feedItems = [...feedItems, ...data];
    } else {
        feedItems = data || [];
    }

    feedOffset += (data || []).length;
    renderFeed();
}

function renderFeed() {
    const container = document.getElementById('feed-container');
    const emptyState = document.getElementById('feed-empty');
    if (!container) return;

    if (feedItems.length === 0) {
        container.innerHTML = '';
        // The scroller is a fixed-height flex child. Left in flow while empty it
        // would take the whole viewport and push the empty state below the fold.
        container.style.display = 'none';
        renderFeedEmptyState();
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    container.style.display = '';

    // ⚠️ The sentinel is rendered INSIDE the scroller, and therefore has to be
    // re-created on every render because this line replaces the container's
    // children. An IntersectionObserver rooted on #feed-container cannot see a
    // sentinel that lives outside it, and the failure is silent: pagination
    // just stops and the feed looks like it ran out.
    container.innerHTML =
        feedItems.map(item => renderFeedCard(item)).join('')
        + '<div class="load-more-trigger" id="load-more-trigger"></div>';

    // Both observers are rooted on the container and both are rebuilt here, for
    // the same reason: their targets were destroyed by the line above.
    setupVideoObserver();
    setupInfiniteScroll();
    refreshSoundButtons();
    feedHasRendered = true;
}

// The Feed tab's empty state says different things depending on why it is
// empty. "Check back later for venue content" is wrong and unhelpful when the
// real answer is "you do not follow anyone yet" — and the fix for that is one
// tap away, so the empty state carries it.
//
// The English strings are written into textContent as well as the data-i18n
// key: I18n.t() returns the KEY when a translation is missing, and
// applyTranslations() then leaves the node alone — so a node that is not
// pre-filled would keep the previous mode's copy.
function renderFeedEmptyState() {
    const empty = document.getElementById('feed-empty');
    if (!empty) return;

    const following = feedMode === 'following';

    // A live distance scope wins the explanation even in Following mode. It is
    // the narrowest of the three filters, the likeliest cause of "nothing here",
    // and the only one with a one-tap fix — which is the test that matters,
    // because an unexplained empty feed is indistinguishable from a broken app.
    const scoped = feedRadiusMiles !== null && !!userLocation;

    const title = empty.querySelector('h3');
    const body = empty.querySelector('p');

    let titleKey, titleText, bodyKey, bodyText, ctaKey, ctaText, ctaAction;

    if (scoped) {
        titleKey = 'social.emptyNearbyTitle';
        titleText = 'Nothing nearby right now';
        bodyKey = 'social.emptyNearbyBody';
        bodyText = `No Viibes within ${feedRadiusMiles} ${feedRadiusMiles === 1 ? 'mile' : 'miles'} of you.`;
        ctaKey = 'social.showAnyDistance';
        ctaText = 'Show any distance';
        ctaAction = () => setRadius(null);
    } else if (following) {
        titleKey = 'social.emptyFollowingTitle';
        titleText = 'Nothing from your follows yet';
        bodyKey = 'social.emptyFollowingBody';
        bodyText = 'Follow some people and venues to fill this up.';
        ctaKey = 'social.discoverMembers';
        ctaText = 'Discover Members';
        ctaAction = () => openPeopleSheet('discover');
    } else {
        // The home feed clears at 7am Pacific, so an empty feed is the normal
        // morning state, not an empty app (Jay, 2026-10-06).
        titleKey = 'social.emptyFeedTitle';
        titleText = 'No live posts available right now';
        bodyKey = 'social.emptyFeedBody';
        bodyText = 'Check back later for venue content';
    }

    // The English is written into textContent as well as the data-i18n key:
    // I18n.t() returns the KEY when a translation is missing and
    // applyTranslations() then leaves the node alone, so a node that is not
    // pre-filled would keep the PREVIOUS state's copy.
    //
    // ⚠️ The nearby body carries an interpolated radius, so it is not a static
    // key. translateOr() supplies the params and falls back to the English
    // built above rather than rendering the key name.
    if (title) {
        title.setAttribute('data-i18n', titleKey);
        title.textContent = titleText;
    }
    if (body) {
        if (scoped) {
            body.removeAttribute('data-i18n');
            body.textContent = translateOr('social.emptyNearbyBody', { miles: feedRadiusMiles }, bodyText);
        } else {
            body.setAttribute('data-i18n', bodyKey);
            body.textContent = bodyText;
        }
    }

    // Replaced rather than reconfigured: the CTA's action changes with the
    // state, and addEventListener on a reused node would stack handlers so one
    // tap fired every action this empty state has ever offered.
    document.getElementById('feed-empty-cta')?.remove();
    if (ctaAction) {
        const cta = document.createElement('button');
        cta.id = 'feed-empty-cta';
        cta.type = 'button';
        cta.className = 'auth-btn auth-btn-primary';
        cta.setAttribute('data-i18n', ctaKey);
        cta.textContent = ctaText;
        cta.addEventListener('click', ctaAction);
        empty.appendChild(cta);
    }

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Who a post is by.
//
// AUTHOR-FIRST. A post can carry a venue AND an author, and when it does, the
// person is the headline and the venue is the place they were — "Pahkie A / at
// The Blue Room", not "@blueroom" with the author nowhere on the card. The
// venue used to win that contest outright, which meant a post made at a venue
// had no route to its author at all even though the author's id, name and
// avatar were all sitting in the same payload.
//
// Before venue_id was nullable, submitPost() invented a "General" venue for
// every post so the NOT NULL could be satisfied — which is why Jay's test post
// reads "General" and links to a venue nobody created on purpose. Those posts
// have an author, so they now read as their author.
//
// `primary` says which of the three shapes this is, so renderFeedCard() does
// not re-derive the branch:
//   'author' — avatar+name are the member; optional "at {venue}" subtitle
//   'venue'  — no recorded author (venue-authored, or pre-UGC with a venue)
//   'none'   — pre-UGC with neither; inert, and must not look tappable
function postIdentity(item) {
    // display_name first: it is what the member chose for themselves in Edit
    // Profile. first/last are the signup fields and remain the fallback for
    // anyone who has not set one.
    const authorName = item.author_display_name
        || [item.author_first_name, item.author_last_name].filter(Boolean).join(' ');
    const userId = item.uploaded_by_user_id || null;

    // Two spellings of the same venue, deliberately. The handle is the right
    // headline for a venue-primary card — it is the venue's identity, the way
    // @blueroom is. It reads badly in prose, though: "at @blueroom" is not a
    // sentence, so the "at {venue}" subtitle takes the display name instead.
    const venueTitle = item.venue_handle ? `@${item.venue_handle}` : (item.venue_name || '');
    const venueLabel = item.venue_name || venueTitle;
    // get_venue_feed returns the venue's genres on every row, so the card
    // header can say what was playing without a second lookup.
    const venueGenres = Array.isArray(item.venue_music_genres) ? item.venue_music_genres : [];

    if (userId) {
        return {
            primary: 'author',
            title: authorName || 'Someone',
            imageUrl: item.author_avatar_url || null,
            letter: (authorName || '?').charAt(0).toUpperCase(),
            userId,
            // Carried even on an author-primary card: it is what the "at
            // {venue}" subtitle names and links to.
            venueId: item.venue_id || null,
            venueName: venueLabel,
            genres: item.venue_id ? venueGenres : []
        };
    }

    if (item.venue_id) {
        return {
            primary: 'venue',
            title: venueTitle,
            subtitle: [item.venue_name, item.venue_city].filter(Boolean).join(', '),
            imageUrl: item.venue_profile_image_url || null,
            letter: (item.venue_name || '?').charAt(0).toUpperCase(),
            userId: null,
            venueId: item.venue_id,
            venueName: venueLabel,
            genres: venueGenres
        };
    }

    // Pre-UGC: no venue AND no author. uploaded_by_user_id was never written
    // before the UGC release and no backfill is possible, so there is nothing
    // to link to. "Someone" beats a blank row.
    return {
        primary: 'none',
        title: 'Someone',
        imageUrl: null,
        letter: '?',
        userId: null,
        venueId: null,
        venueName: '',
        genres: []
    };
}

// The "at {venue}" subtitle sits INSIDE the clickable identity block, so its
// click must not also fire the parent's openMemberProfile. Nothing else in this
// file delegates on the feed container — every handler is an inline onclick —
// so taking the event explicitly is the local idiom (see toggleFeedSound).
function openVenueFromPost(event, venueId) {
    event.stopPropagation();
    openVenuePage(venueId);
}

// "at The Blue Room". I18n.t() returns the key when a translation is missing,
// so the English is built here rather than trusting the lookup.
function postedAtLabel(venueName) {
    const translated = window.I18n?.t
        ? window.I18n.t('social.postedAtVenue', { venue: venueName })
        : 'social.postedAtVenue';
    return translated === 'social.postedAtVenue' ? `at ${venueName}` : translated;
}

// The identity block of a post header, shared by the main feed and the venue
// page so the two cannot drift. `showVenue` is false on the venue page, where
// the whole page is already that one venue.
function postHeaderMarkup(identity, { showVenue = true } = {}) {
    const openIdentity = identity.primary === 'author'
        ? ` onclick="openMemberProfile('${escapeHtml(identity.userId)}')"`
        : identity.primary === 'venue'
            ? ` onclick="openVenuePage('${escapeHtml(identity.venueId)}')"`
            : '';

    // ⚠️ .feed-venue-info carries cursor:pointer unconditionally, so a header
    // with nothing to open still looks tappable without this class.
    const inert = identity.primary === 'none' ? ' feed-venue-info-inert' : '';

    let subtitle = '';
    if (identity.primary === 'author') {
        // Nested inside the clickable parent, hence openVenueFromPost's
        // stopPropagation — otherwise one tap opens the venue AND the profile.
        if (showVenue && identity.venueId && identity.venueName) {
            subtitle = `<div class="venue-location venue-location-link" onclick="openVenueFromPost(event, '${escapeHtml(identity.venueId)}')">${escapeHtml(postedAtLabel(identity.venueName))}</div>`;
        }
    } else if (identity.subtitle) {
        subtitle = `<div class="venue-location">${escapeHtml(identity.subtitle)}</div>`;
    }

    return `
        <div class="feed-venue-info${inert}"${openIdentity}>
            <div class="venue-avatar">
                ${identity.imageUrl
                    ? `<img src="${escapeHtml(identity.imageUrl)}" alt="">`
                    : `<div class="venue-avatar-placeholder">${escapeHtml(identity.letter)}</div>`}
            </div>
            <div class="venue-meta">
                <div class="venue-handle">${escapeHtml(identity.title)}</div>
                ${subtitle}
                ${genreChipsMarkup({ music_genres: identity.genres }, 2)}
            </div>
        </div>
    `;
}

// One Viibe, one full-height snap panel (#3, #12).
//
// This is a RE-LAYOUT, NOT A REDUCTION. Every affordance the bordered card
// carried is still here, moved onto the video instead of stacked around it:
// the author/venue identity block, the "at {venue}" link, the 3-dots options,
// the caption, the duration pill and the sound toggle — plus the here-tonight
// badge, which the card never had room for.
//
// ⚠️ The class is `.feed-panel`, and `.feed-card` is GONE from this surface.
//
// `.feed-card` now belongs to the MEMBER PROFILE (renderMemberList), not the
// venue page — they swapped in Phase 4: the venue page became a reels grid
// (`.member-grid`, renderVenuePageGrid) and the profile took the scrollable
// card list. The separation is the same and exists for the same reason: a
// change to the full-screen browse must not silently reshape a list of one
// person's or one venue's posts. Only the surface on the other side changed.
//
// The photo branch survives even though get_venue_feed_v3 filters to video.
// It is the rollback path: pointing loadFeed() back at get_venue_feed brings
// photos with it, and a renderer that could only draw video would then paint
// nothing, with no error.
function renderFeedCard(item) {
    const isVideo = item.media_type === 'video';
    const identity = postIdentity(item);

    return `
        <article class="feed-panel" data-media-id="${escapeHtml(item.id)}" data-venue-id="${escapeHtml(item.venue_id || '')}">
            <!-- The panel is a flex column: an opaque venue strip, then the
                 media. Jay, 2026-10-06: no author, caption or duration in the
                 home feed — the bottom strip is gone. The only control on the
                 video is the sound toggle, bottom-right, inside .feed-media. -->
            ${venueStripMarkup(item, identity)}

            <div class="feed-media" onclick="toggleVideoPlay(this)">
                ${isVideo ? `
                    <!-- preload is decided per post by videoPreloadMode(): "none"
                         when there is a poster to paint, "metadata" when there is
                         not. A NULL thumbnail_url has no poster, so a blanket
                         preload="none" would paint that post as black.
                         See videoPreloadMode() for why this stays per-post even
                         though the legacy NULLs have been backfilled. -->
                    <video data-src="${escapeHtml(item.url)}" poster="${escapeHtml(item.thumbnail_url || '')}"
                           playsinline muted preload="${videoPreloadMode(item)}" loop></video>
                    <button class="video-sound-btn feed-panel-sound" type="button" onclick="toggleFeedSound(event, this)"></button>
                ` : `
                    <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                `}
            </div>
        </article>
    `;
}

// The white strip above the video: the VENUE's photo, name and location.
//
// ⚠️ This is venue-primary, which INVERTS postIdentity()'s author-first logic —
// and it is forked at the CALL SITE rather than by adding a mode to
// postHeaderMarkup(). social.css:503 and the comment on renderFeedCard both
// warn that the browse surface and the post-list surfaces must not share a
// renderer, because a change made for one silently reshapes the other.
// The feed no longer shows the author at all (Jay, 2026-10-06); postHeaderMarkup()
// is still used, unchanged, by the post-list surfaces.
//
// No SQL is needed: get_venue_feed_v3 already returns venue_name, venue_handle,
// venue_city, venue_state and venue_profile_image_url on every row.
function venueStripMarkup(item, identity) {
    const name = item.venue_name || (item.venue_handle ? `@${item.venue_handle}` : '');
    const where = [item.venue_city, item.venue_state].filter(Boolean).join(', ');
    const venue = item.venue_id ? getVenueById(item.venue_id) : null;

    // ⚠️ An unattached Viibe has no venue at all. Rendering the strip anyway
    // gives it an empty white bar above the video — worse than the overlay it
    // replaced. Fall back to the author, who is the only identity such a post
    // has, and keep the strip's geometry so the panel still lays out the same.
    const hasVenue = !!(item.venue_id && name);
    const title = hasVenue ? name : identity.title;
    const subtitle = hasVenue ? where : '';
    const imageUrl = hasVenue ? item.venue_profile_image_url : identity.imageUrl;
    const letter = hasVenue ? (name.replace(/^@/, '') || '?')[0].toUpperCase() : identity.letter;

    const open = hasVenue
        ? ` onclick="openVenuePage('${escapeHtml(item.venue_id)}')"`
        : identity.userId
            ? ` onclick="openMemberProfile('${escapeHtml(identity.userId)}')"`
            : '';

    return `
        <header class="feed-panel-venue">
            <div class="feed-panel-venue-id${open ? '' : ' feed-venue-info-inert'}"${open}>
                <div class="venue-avatar">
                    ${imageUrl
                        ? `<img src="${escapeHtml(imageUrl)}" alt="">`
                        : `<div class="venue-avatar-placeholder">${escapeHtml(letter)}</div>`}
                </div>
                <div class="venue-meta">
                    <div class="venue-handle">${escapeHtml(title)}</div>
                    ${subtitle ? `<div class="venue-location">${escapeHtml(subtitle)}</div>` : ''}
                </div>
            </div>
            ${venue ? hereNowBadge(venue) : ''}
            <button class="feed-more-btn feed-panel-more" aria-label="Post options" onclick="showPostOptions('${escapeHtml(item.id)}')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
        </header>
    `;
}

function showFeedLoading(show) {
    const shimmer = document.getElementById('feed-shimmer');
    if (shimmer) shimmer.style.display = show ? 'block' : 'none';
}

// ===== Map =====

// Newest approved posts with a resolvable coordinate (post coords COALESCEd
// over venue coords). Non-fatal: the map still works with venue pins alone.
async function loadPostPins() {
    if (!currentApp) return;

    const { data, error } = await supabaseClient.rpc('get_recent_post_pins', {
        p_app_id: currentApp.id,
        p_limit: 200
    });

    if (error) {
        console.warn('Failed to load post pins:', error.message);
        postPins = [];
        return;
    }

    postPins = data || [];
}

function initMap() {
    if (map) return; // Already initialized

    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    // Centre priority: the most recent post, then the user, then a venue, then
    // Santa Monica. Opening the map should show you what was just posted —
    // "where I am standing" is one tap away on #center-on-me-btn, and a map
    // centred on an empty stretch of your own street shows nothing at all.
    const newestPost = postPins[0];
    const center = newestPost
        ? [newestPost.latitude, newestPost.longitude]
        : userLocation
            ? [userLocation.lat, userLocation.lng]
            : venues.length > 0
                ? [venues[0].latitude, venues[0].longitude]
                : [34.0195, -118.4912]; // Default: Santa Monica

    map = L.map('map-container', {
        zoomControl: false,
        attributionControl: false
    }).setView(center, 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    // Add attribution in a less intrusive way
    L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('&copy; <a href="https://openstreetmap.org">OSM</a>')
        .addTo(map);

    renderMapPins();
    renderPostPins();
    renderVenueSwimLane();
}

function renderMapPins() {
    if (!map) return;

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const shown = filteredVenues();

    shown.forEach((venue, index) => {
        if (!venue.latitude || !venue.longitude) return;

        const icon = L.divIcon({
            className: 'map-pin-wrapper',
            html: `<div class="map-pin ${venue.is_featured ? 'featured' : ''}"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        // Tapping a pin opens that venue's page (SOW: "tap a venue pin to open
        // its detail page"). It also records the selection first, so closing
        // the page returns you to the map with this venue still highlighted.
        const marker = L.marker([venue.latitude, venue.longitude], { icon })
            .addTo(map)
            .on('click', () => {
                selectVenueOnMap(venue);
                openVenuePage(venue.id);
            });

        markers.push(marker);
    });

    // Fit bounds if we have venues with valid coordinates.
    // Skipped when there are post pins: initMap deliberately centred on the
    // newest post, and fitting every venue would immediately throw that away.
    const geoVenues = shown.filter(v => v.latitude && v.longitude);
    if (geoVenues.length > 0 && !userLocation && postPins.length === 0) {
        const bounds = L.latLngBounds(geoVenues.map(v => [v.latitude, v.longitude]));
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

// Post pins, drawn alongside venue pins.
//
// ⚠️ The class MUST stay distinct from `.map-pin-wrapper`.
// viibeview-social.spec.js clicks `.map-pin-wrapper` and asserts the venue page
// opens; sharing the class would let that test hit a post pin and fail on a
// change that is otherwise correct.
function renderPostPins() {
    if (!map) return;

    postMarkers.forEach(m => map.removeLayer(m));
    postMarkers = [];

    visiblePostPins().forEach(pin => {
        if (!pin.latitude || !pin.longitude) return;

        const icon = L.divIcon({
            className: 'map-post-pin-wrapper',
            html: `<div class="map-post-pin"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });

        const marker = L.marker([pin.latitude, pin.longitude], { icon })
            .addTo(map)
            .on('click', () => openPostPreview(pin.id));

        postMarkers.push(marker);
    });
}

// Which posts get a pin of their own.
//
// ⚠️ Only posts with their OWN coordinates. get_recent_post_pins COALESCEs the
// post's fix over its venue's — right for the default centre, wrong for pins: a
// post with no fix inherits its venue's exactly, so the post pin lands on the
// venue pin, covers it, and eats its click. That is not hypothetical; it broke
// "tapping a map pin opens the venue page" the moment post pins shipped, and a
// venue with fifty posts would stack fifty pins on one point. Such a post is
// already represented by its venue pin and reachable through the venue page.
//
// Then the filter rule: pills filter venues, and a post inherits its venue's
// category and genres. A post with no venue has neither, so it shows under
// "All / All" only — the same rule get_venue_feed applies.
function visiblePostPins() {
    const located = postPins.filter(pin => pin.has_own_coords);
    if (!activeCategory && !activeGenre) return located;

    return located.filter(pin => {
        if (!pin.venue_id) return false;
        return venueMatchesFilters(getVenueById(pin.venue_id));
    });
}

// ===== Post preview (map pin tap) =====
// Layers over the map. No switchTab, no openVenuePage — the map stays mounted
// underneath so closing the preview returns you exactly where you were.
function openPostPreview(postId) {
    const pin = postPins.find(p => p.id === postId);
    if (!pin) return;

    const modal = document.getElementById('post-preview-modal');
    const backdrop = document.getElementById('post-preview-backdrop');
    const mediaEl = document.getElementById('post-preview-media');
    const infoEl = document.getElementById('post-preview-info');
    if (!modal || !backdrop || !mediaEl || !infoEl) return;

    previewPostId = postId;

    // Author-first, matching the feed card. display_name is what the member
    // chose for themselves; first/last are the signup fallback.
    const authorName = pin.author_display_name
        || [pin.author_first_name, pin.author_last_name].filter(Boolean).join(' ');
    const byline = authorName || (pin.venue_id ? (pin.venue_name || '') : 'Someone');

    // ⚠️ NOT a saving, just a removed contradiction. `autoplay` overrides
    // `preload` — the element fetches and plays regardless — so
    // preload="metadata" here only described the intent inaccurately. And the
    // intent is right: this modal opens because the user tapped a pin to watch
    // this specific video. It should download it.
    mediaEl.innerHTML = `
        <video src="${escapeHtml(pin.url)}" poster="${escapeHtml(pin.thumbnail_url || '')}"
               playsinline muted loop autoplay></video>
    `;

    // The byline opens the author's profile when there is one to open. Closing
    // the preview first: the member page is a full-screen overlay and would
    // otherwise stack on top of a still-playing video.
    const bylineMarkup = pin.uploaded_by_user_id
        ? `<div class="post-preview-byline post-preview-byline-link"
                onclick="closePostPreview(); openMemberProfile('${escapeHtml(pin.uploaded_by_user_id)}')">${escapeHtml(byline)}</div>`
        : `<div class="post-preview-byline">${escapeHtml(byline)}</div>`;

    infoEl.innerHTML = `
        ${bylineMarkup}
        ${pin.caption ? `<div class="post-preview-caption">${escapeHtml(pin.caption)}</div>` : ''}
        ${pin.venue_id
            ? `<button class="auth-btn auth-btn-primary post-preview-venue-btn" type="button"
                       onclick="closePostPreview(); openVenuePage('${escapeHtml(pin.venue_id)}')"
                       data-i18n="social.openVenue">Open venue</button>`
            : ''}
    `;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }

    modal.classList.add('visible');
    backdrop.classList.add('visible');
}

function closePostPreview() {
    const modal = document.getElementById('post-preview-modal');
    const backdrop = document.getElementById('post-preview-backdrop');
    const mediaEl = document.getElementById('post-preview-media');

    if (modal) modal.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    // Clearing the node stops the clip; a paused <video> left in the DOM keeps
    // its buffer and keeps downloading.
    if (mediaEl) mediaEl.innerHTML = '';
    previewPostId = null;
}

function selectVenueOnMap(venue) {
    selectedVenueId = venue.id;

    // Center map on selected venue
    if (map && venue.latitude && venue.longitude) {
        map.setView([venue.latitude, venue.longitude], map.getZoom(), { animate: true });
    }

    // Highlight the card in the swim lane and scroll to it
    const lane = document.getElementById('venue-swim-lane');
    if (!lane) return;

    lane.querySelectorAll('.swim-card').forEach(c => c.classList.remove('active'));
    const activeCard = lane.querySelector(`[data-venue-id="${venue.id}"]`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function renderVenueSwimLane() {
    const lane = document.getElementById('venue-swim-lane');
    if (!lane) return;

    // Only show venues with coordinates
    const geoVenues = filteredVenues().filter(v => v.latitude && v.longitude);

    if (geoVenues.length === 0) {
        lane.innerHTML = '';
        return;
    }

    lane.innerHTML = geoVenues.map(venue => {
        const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
        const distanceText = distance !== null ? ` &middot; ${distance.toFixed(1)} mi` : '';
        const isActive = venue.id === selectedVenueId;

        return `
            <div class="swim-card ${isActive ? 'active' : ''}" data-venue-id="${venue.id}" onclick="openVenuePage('${venue.id}')">
                <div class="swim-card-thumb">
                    ${venue.cover_image_url
                        ? `<img src="${venue.cover_image_url}" alt="">`
                        : `<div class="swim-card-thumb-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="swim-card-info">
                    <div class="swim-card-name">${escapeHtml(venue.name)}</div>
                    <div class="swim-card-address">${escapeHtml([venue.city, venue.state].filter(Boolean).join(', '))}${distanceText}</div>
                    ${genreChipsMarkup(venue, 2)}
                    <div class="swim-card-rating">
                        ${renderStars(venue.average_rating || 0)}
                        <span class="swim-card-rating-text">${venue.average_rating || 0}</span>
                        ${venue.review_count ? `<span class="swim-card-reviews">&middot; ${venue.review_count}</span>` : ''}
                        ${hereNowBadge(venue)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function centerOnMe() {
    if (!map || !userLocation) {
        // Request location again
        requestLocation();
        return;
    }
    map.setView([userLocation.lat, userLocation.lng], 14, { animate: true });
}

// ===== Recent Searches =====
// The markup and CSS for this shipped, but nothing ever wrote to it, so an
// empty "Recent Searches" heading rendered permanently under the search box.
const RECENT_SEARCHES_KEY = 'viibe_recent_searches';
const RECENT_SEARCHES_MAX = 5;

function getRecentSearches() {
    try {
        const raw = localStorage.getItem(`${RECENT_SEARCHES_KEY}_${appSlug}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function recordRecentSearch(venue) {
    if (!venue) return;
    try {
        const entry = { id: venue.id, name: venue.name, category: venue.category || '' };
        const existing = getRecentSearches().filter(v => v.id !== venue.id);
        const next = [entry, ...existing].slice(0, RECENT_SEARCHES_MAX);
        localStorage.setItem(`${RECENT_SEARCHES_KEY}_${appSlug}`, JSON.stringify(next));
        renderRecentSearches();
    } catch {
        // localStorage unavailable (private mode) — recents are non-essential
    }
}

function clearRecentSearches() {
    try {
        localStorage.removeItem(`${RECENT_SEARCHES_KEY}_${appSlug}`);
    } catch { /* no-op */ }
    renderRecentSearches();
}

function renderRecentSearches() {
    const wrap = document.getElementById('recent-searches');
    const list = document.getElementById('recent-searches-list');
    if (!wrap || !list) return;

    const recents = getRecentSearches();
    if (recents.length === 0) {
        wrap.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    wrap.style.display = '';
    list.innerHTML = recents.map(v => `
        <button class="recent-search-item" type="button" onclick="goToVenueOnMap('${v.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span class="recent-search-name">${escapeHtml(v.name)}</span>
            ${v.category ? `<span class="recent-search-category">${escapeHtml(categoryLabel(v.category))}</span>` : ''}
        </button>
    `).join('');
}

// ===== Search =====

// Shared by the Search tab and the map's floating search. Matches the display
// label as well as the raw slug, so typing "Bars" still finds a venue whose
// category column reads "bar" — and, now, so typing "techno" finds a venue by
// what it plays rather than only by what it is called.
function matchesQuery(v, q) {
    if (!v || !q) return false;
    const genres = venueGenres(v);
    const haystack = [
        v.name,
        v.handle,
        v.category,
        categoryLabel(v.category),
        v.city,
        ...genres,
        ...genres.map(g => genreLabel(g))
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
}

// ===== "Here tonight" =====
//
// here_now is a derived count from get_venues_for_map / get_venue_detail: the
// number of DISTINCT people who posted an approved Viibe at this venue in the
// last few hours. There is no check-in button — choosing a venue when you post
// IS the check-in — so nothing writes this and nothing can get out of sync.
//
// Hidden entirely at zero. A venue that says "0 here tonight" is advertising
// that it is empty, which is worse than saying nothing; and demo venues have no
// real posts behind them, so the number would be a fiction.
function hereNowCount(venue) {
    if (!venue || isDemoVenueId(venue.id)) return 0;
    const n = parseInt(venue.here_now, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function hereNowBadge(venue) {
    const n = hereNowCount(venue);
    if (!n) return '';
    return `<span class="here-now-badge"><span class="here-now-dot"></span>${n} <span data-i18n="social.hereTonight">here tonight</span></span>`;
}

// Read-only genre chips, for the feed card header / venue page / picker rows.
function genreChipsMarkup(venue, limit) {
    const genres = venueGenres(venue);
    if (genres.length === 0) return '';
    const shown = limit ? genres.slice(0, limit) : genres;
    return `<span class="genre-chip-row">${shown
        .map(g => `<span class="genre-chip">${escapeHtml(genreLabel(g))}</span>`)
        .join('')}</span>`;
}

// One template for both the browse list and the results list, so the two
// cannot drift. The second line reads venue.city/state, which get_venues_for_map
// only started returning in migration 20260828000003 — before that it was blank
// on every card and nobody noticed, because nothing errored.
function renderVenueCards(list) {
    return list.map(venue => {
        const distance = userLocation
            ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
            : null;
        const distanceText = distance !== null ? `${distance.toFixed(1)} mi` : '';
        const place = [venue.city, venue.state].filter(Boolean).join(', ');

        return `
            <div class="search-result-card" onclick="goToVenueOnMap('${escapeHtml(venue.id)}')">
                <div class="search-result-thumb">
                    ${venue.profile_image_url
                        ? `<img src="${escapeHtml(venue.profile_image_url)}" alt="">`
                        : `<div class="search-result-placeholder">${escapeHtml((venue.name || '?')[0])}</div>`}
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(venue.name)}</div>
                    <div class="search-result-meta">
                        <span class="search-result-category">${escapeHtml(categoryLabel(venue.category))}</span>
                        ${place ? `<span class="search-result-place">${escapeHtml(place)}</span>` : ''}
                        ${distanceText ? `<span class="search-result-distance">${distanceText}</span>` : ''}
                        ${hereNowBadge(venue)}
                    </div>
                    ${genreChipsMarkup(venue, 3)}
                </div>
            </div>
        `;
    }).join('');
}

// 'venues' | 'members'. The segmented control above the input.
let searchScope = 'venues';
let memberSearchSeq = 0;

function setSearchScope(scope) {
    if (scope !== 'venues' && scope !== 'members') return;
    searchScope = scope;

    document.querySelectorAll('.search-scope-btn').forEach(btn => {
        const on = btn.dataset.scope === scope;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const input = document.getElementById('search-input');
    if (input) {
        const [key, english] = scope === 'members'
            ? ['social.searchMembers', 'Search members...']
            : ['social.searchPlaceholder', 'Search venues, bars, clubs...'];
        input.setAttribute('data-i18n-placeholder', key);
        const translated = window.I18n?.t ? window.I18n.t(key) : key;
        input.placeholder = translated === key ? english : translated;
        input.setAttribute('aria-label', scope === 'members' ? 'Search members' : 'Search venues');
    }

    handleSearch((input?.value || '').trim());
}

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    const emptyHint = document.getElementById('search-empty');
    const recentsWrap = document.getElementById('recent-searches');
    if (!resultsContainer) return;

    if (searchScope === 'members') {
        searchMembers(query);
        return;
    }

    // A venue render supersedes any member search still in flight.
    memberSearchSeq++;

    // Below the 2-character threshold, browse. An empty tab that says "Search
    // for venues nearby" tells a first-time visitor nothing about what is in
    // here; the full venue list does. The hint is now reserved for the one case
    // it is actually true for — an app with no venues at all.
    if (!query || query.length < 2) {
        renderRecentSearches();

        if (venues.length === 0) {
            resultsContainer.innerHTML = '';
            if (emptyHint) emptyHint.style.display = '';
            return;
        }

        if (emptyHint) emptyHint.style.display = 'none';
        resultsContainer.innerHTML = `
            <h4 class="search-section-title" data-i18n="social.allVenues">All venues</h4>
            ${renderVenueCards(venues)}
        `;
        if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
            window.I18n.applyTranslations();
        }
        return;
    }

    // Searching — the "Search for venues nearby" hint and the recents list are
    // both noise now. The hint used to stay visible underneath the results.
    if (emptyHint) emptyHint.style.display = 'none';
    if (recentsWrap) recentsWrap.style.display = 'none';

    const q = query.toLowerCase();
    const results = venues.filter(v => matchesQuery(v, q));

    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">No venues found</div>';
        return;
    }

    resultsContainer.innerHTML = renderVenueCards(results);
}

/**
 * Search → Members. discover_members is anon-readable (20260903000003), so
 * this works signed out too. Under two characters it lists members to browse,
 * the same way the venue scope lists every venue.
 *
 * ⚠️ Stale-response guard: every keystroke is a round trip, and an earlier,
 * slower query landing last would paint results for text no longer in the box.
 */
async function searchMembers(query) {
    const resultsContainer = document.getElementById('search-results');
    const emptyHint = document.getElementById('search-empty');
    const recentsWrap = document.getElementById('recent-searches');
    if (!resultsContainer || !currentApp) return;

    // Recents are venue searches; the "no venues yet" hint is a venue state.
    if (emptyHint) emptyHint.style.display = 'none';
    if (recentsWrap) recentsWrap.style.display = 'none';

    const q = (query || '').trim();
    const seq = ++memberSearchSeq;

    const { data, error } = await supabaseClient.rpc('discover_members', {
        p_app_id: currentApp.id,
        p_query: q.length >= 2 ? q : null,
        p_limit: 50,
        p_offset: 0
    });

    if (seq !== memberSearchSeq || searchScope !== 'members') return;

    if (error) {
        console.error('Member search failed:', error);
        resultsContainer.innerHTML = '<div class="search-empty">Could not search members</div>';
        return;
    }

    // Never yourself — Me is its own tab.
    const rows = (data || []).filter(row => row.target_id !== currentUserId);

    if (rows.length === 0) {
        const key = 'social.noMembersFound';
        const translated = window.I18n?.t ? window.I18n.t(key) : key;
        resultsContainer.innerHTML =
            `<div class="search-empty">${escapeHtml(translated === key ? 'No members found' : translated)}</div>`;
        return;
    }

    resultsContainer.innerHTML = `
        <div class="search-members-list">
            ${rows.map(row => peopleRowMarkup(row, `openMemberProfile('${escapeHtml(row.target_id)}')`)).join('')}
        </div>
    `;
}

// Selecting a search result takes you to the venue's page. It used to only
// recentre the map and stop there, which is the broken navigation path the SOW
// calls out ("Map Search: Navigate to Venue Page from Results").
function goToVenueOnMap(venueId) {
    const venue = getVenueById(venueId);
    if (!venue) return;

    recordRecentSearch(venue);
    switchTab('map');
    setTimeout(() => {
        if (map && venue.latitude && venue.longitude) {
            map.setView([venue.latitude, venue.longitude], 15, { animate: true });
            selectVenueOnMap(venue);
        }
        openVenuePage(venueId);
    }, 300);
}

// ===== Venue Location Page =====

async function openVenuePage(venueId) {
    const page = document.getElementById('venue-page');
    const backdrop = document.getElementById('venue-page-backdrop');
    if (!page || !backdrop) return;

    venuePageVenueId = venueId;
    venuePageFeed = [];
    venuePageOffset = 0;
    venuePageHasMore = true;
    venuePageLoading = false;
    // ⚠️ Reset, or an expanded "Who's here" on one venue silently carries into
    // the next venue the visitor opens — and so does the previous venue's mix.
    resetVenueSections();
    venueCrowdMix = null;
    expandedVenuePostId = null;

    // Show page immediately (content loads inside)
    page.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('venue-page');

    // Load venue detail (use local data for demo venues)
    let venue;
    const localVenue = getVenueById(venueId);
    if (localVenue && String(venueId).startsWith('demo-')) {
        venue = localVenue;
    } else {
        const { data, error } = await supabaseClient.rpc('get_venue_detail', { p_venue_id: venueId });
        if (error || !data || (Array.isArray(data) && data.length === 0)) {
            // Fallback to local venue data if RPC fails
            if (localVenue) {
                venue = localVenue;
            } else {
                console.error('Failed to load venue:', error);
                showToast('Could not load venue');
                closeVenuePage();
                return;
            }
        } else {
            venue = Array.isArray(data) ? data[0] : data;
        }
    }

    venuePageVenue = venue;

    // Set header title
    const titleEl = document.getElementById('venue-page-title');
    if (titleEl) titleEl.textContent = venue.name;

    // Render hero
    const heroEl = document.getElementById('venue-page-hero');
    if (heroEl) {
        heroEl.innerHTML = venue.cover_image_url
            ? `<img src="${venue.cover_image_url}" alt="${escapeHtml(venue.name)}">`
            : `<div class="venue-page-hero-fallback">${(venue.name || '?')[0]}</div>`;
    }

    // Render identity
    const distance = userLocation && venue.latitude
        ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
        : null;
    const distanceText = distance !== null ? `${distance.toFixed(1)} mi away` : '';
    const locationParts = [venue.city, venue.state].filter(Boolean).join(', ');

    const identityEl = document.getElementById('venue-page-identity');
    if (identityEl) {
        identityEl.innerHTML = `
            <div class="venue-page-identity-row">
                <div class="venue-page-avatar">
                    ${venue.profile_image_url
                        ? `<img src="${venue.profile_image_url}" alt="">`
                        : `<div class="venue-page-avatar-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="venue-page-name-block">
                    <h2 class="venue-page-name">${escapeHtml(venue.name)}</h2>
                    ${venue.handle ? `<div class="venue-page-handle">@${escapeHtml(venue.handle)}</div>` : ''}
                </div>
            </div>
            <div class="venue-page-meta">
                ${venue.average_rating ? `
                    <div class="venue-page-rating">
                        ${renderStars(venue.average_rating)}
                        <span>${venue.average_rating}</span>
                        ${venue.review_count ? `<span style="color:#94a3b8">(${venue.review_count})</span>` : ''}
                    </div>
                ` : ''}
                ${venue.category ? `<span class="venue-page-category">${escapeHtml(categoryLabel(venue.category))}</span>` : ''}
                ${hereNowBadge(venue)}
                ${locationParts ? `
                    <span class="venue-page-location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        ${escapeHtml(locationParts)} ${distanceText ? `&middot; ${distanceText}` : ''}
                    </span>
                ` : ''}
            </div>
        `;
    }

    // Render action buttons
    const actionsEl = document.getElementById('venue-page-actions');
    if (actionsEl) {
        let actions = '';

        // Follow. This is what finally makes social.html:259 — "follow venues"
        // — true; that copy has been in the signed-out invitation since the
        // auth overlay shipped, with nothing behind it.
        //
        // Excluded for demo venues: their ids are the strings 'demo-1'..'demo-5',
        // not UUIDs, so follow_target's venue-belongs-to-app check rejects them
        // as success:false — the shape this app has historically swallowed.
        if (!isDemoVenueId(venue.id)) {
            actions += `<button class="venue-action-btn follow-btn" id="venue-page-follow-btn" type="button"
                onclick="toggleFollow('venue', '${escapeHtml(venue.id)}')"></button>`;
        }

        // Add flyer — org members and this venue's owners. Always rendered for
        // a real venue and shown/hidden by applyOwnerAffordances() too, so a
        // sign-in on top of the open page reveals it without a reopen.
        if (!isDemoVenueId(venue.id)) {
            actions += `<button class="venue-action-btn venue-flyer-btn" id="venue-page-flyer-btn" type="button"
                ${canManageVenue(venue.id) ? '' : 'style="display:none;"'} onclick="openFlyerPicker()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span data-i18n="social.addFlyer">Add flyer</span>
            </button>`;
        }

        // Navigate button (demo placeholder)
        actions += `<button class="venue-action-btn" onclick="showToast('Navigation coming soon')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Navigate
        </button>`;
        if (venue.address_line1) {
            const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent([venue.address_line1, venue.city, venue.state].filter(Boolean).join(', '))}`;
            actions += `<a class="venue-action-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Directions
            </a>`;
        }
        if (venue.phone) {
            actions += `<a class="venue-action-btn" href="tel:${venue.phone}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                Call
            </a>`;
        }
        if (venue.website) {
            actions += `<a class="venue-action-btn" href="${venue.website}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                Website
            </a>`;
        }
        if (venue.instagram_handle) {
            actions += `<a class="venue-action-btn" href="https://instagram.com/${venue.instagram_handle}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
                Instagram
            </a>`;
        }
        actionsEl.innerHTML = actions;
        actionsEl.style.display = actions ? 'flex' : 'none';

        // ⚠️ Before the repaint, not after. loadFollowingState() no-ops once
        // loaded, so on the happy path this costs nothing — but after a failed
        // load (which now empties the Set rather than keeping it stale) it is
        // the only thing that ever retries. Without it, one transient error at
        // boot means every Follow button lies for the rest of the session.
        await loadFollowingState();

        // The button ships with no label; repaintFollowButtons() is the single
        // writer of Follow/Following text so the two follow surfaces cannot
        // disagree about the same edge.
        repaintFollowButtons();
    }

    renderVenueFollowerCount();

    // Render address
    const addressEl = document.getElementById('venue-page-address');
    if (addressEl) {
        if (venue.address_line1) {
            const line2 = [venue.city, venue.state, venue.postal_code].filter(Boolean).join(', ');
            addressEl.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <div class="venue-page-address-text">
                    <div>${escapeHtml(venue.address_line1)}</div>
                    ${line2 ? `<div class="venue-page-address-line2">${escapeHtml(line2)}</div>` : ''}
                </div>
            `;
            addressEl.style.display = 'flex';
        } else {
            addressEl.style.display = 'none';
        }
    }

    // Render hours
    //
    // Shape decisions live in /js/venue-hours.js, loaded before this file. This
    // block used to do its own shape sniffing and understood only one of the
    // three shapes on disk: anything else fell through its per-day lookup and
    // rendered "Closed" seven days a week.
    //
    // Every branch escapes. Day values are owner-supplied DB content reaching a
    // public page — the previous version interpolated a raw string day value
    // straight into innerHTML.
    const hoursEl = document.getElementById('venue-page-hours');
    if (hoursEl) {
        const hours = window.VenueHours ? window.VenueHours.normalize(venue.hours) : null;

        if (hours && hours.kind === 'schedule') {
            const today = window.VenueHours.todayKey();

            let rows = '';
            window.VenueHours.DAYS.forEach(day => {
                const span = hours.days[day.key];
                let timeText = 'Closed';
                if (span) {
                    timeText = span.label
                        ? span.label
                        : `${window.VenueHours.formatTime(span.open)} – ${window.VenueHours.formatTime(span.close)}`;
                }
                rows += `<tr class="${day.key === today ? 'today' : ''}">`
                     +  `<td>${escapeHtml(day.label)}</td>`
                     +  `<td>${escapeHtml(timeText)}</td></tr>`;
            });

            hoursEl.innerHTML = `
                <h4 class="venue-page-hours-title">Hours</h4>
                <table class="venue-page-hours-table">${rows}</table>
            `;
            hoursEl.style.display = 'block';
        } else if (hours && hours.kind === 'text') {
            // Legacy free text typed into the old admin textarea. Render it
            // verbatim — it is what the owner actually wrote.
            hoursEl.innerHTML = `
                <h4 class="venue-page-hours-title">Hours</h4>
                <div class="venue-page-hours-text">${escapeHtml(hours.text)}</div>
            `;
            hoursEl.style.display = 'block';
        } else {
            // #venue-page is a reused singleton node, so stale hours from the
            // previously-opened venue linger unless the content is cleared too.
            hoursEl.innerHTML = '';
            hoursEl.style.display = 'none';
        }
    }

    // Render about — description, "tonight's sound", then the freeform tags.
    //
    // Genres sit ABOVE tags and are visually distinct from them on purpose:
    // they are a controlled vocabulary the app filters on, tags are whatever
    // the owner typed. Conflating the two is what would have happened had this
    // been built on venues.tags.
    const aboutEl = document.getElementById('venue-page-about');
    if (aboutEl) {
        let about = '';
        if (venue.description) {
            about += `<p class="venue-page-description">${escapeHtml(venue.description)}</p>`;
        }
        // Three collapsible sections. Sound first because it is the one that is
        // open by default and the one an owner edits; distance and crowd are
        // reference, not action.
        about += renderVenueGenreSection(venue);
        about += renderVenueDistanceSection(venue);
        about += renderVenueCrowdSection(venue);
        if (venue.tags && venue.tags.length > 0) {
            about += `<div class="venue-page-tags">${venue.tags.map(t => `<span class="venue-page-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        }
        aboutEl.innerHTML = about;
        aboutEl.style.display = about ? 'block' : 'none';

        if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
            window.I18n.applyTranslations();
        }
    }

    // Load venue feed
    await loadVenuePageFeed();

    // The crowd section reads two things the first paint could not have: the
    // recent-poster faces come from venuePageFeed (just loaded above) and the
    // gender mix from its own RPC. Repaint it once both have landed rather
    // than blocking the whole page on a section nobody has scrolled to.
    await loadVenueCrowdMix(venue.id);
    if (venuePageVenueId === venue.id) repaintVenueSection('crowd');

    // Setup infinite scroll
    const scrollEl = document.getElementById('venue-page-scroll');
    if (scrollEl) {
        venuePageScrollHandler = () => {
            if (venuePageLoading || !venuePageHasMore) return;
            const scrollBottom = scrollEl.scrollTop + scrollEl.clientHeight;
            if (scrollEl.scrollHeight - scrollBottom < 400) {
                loadVenuePageFeed(true);
            }
        };
        scrollEl.addEventListener('scroll', venuePageScrollHandler);
    }
}

// ===== Flyers (org members and venue owners) =====
//
// A flyer is an image on the venue page, pinned to the top and never expiring.
// The image is resized here (≤1600px, JPEG 0.85), uploaded to the member's own
// prefix, then recorded by add_venue_flyer — which re-checks the caller, the
// path, the object's owner and the URL. Nothing about the row is trusted from
// here. Desktop is allowed: a flyer is a file, not a recording.

const FLYER_MAX_PX = 1600;
const FLYER_QUALITY = 0.85;
let flyerUploading = false;

function openFlyerPicker() {
    if (!canManageVenue(venuePageVenueId)) return;
    document.getElementById('venue-flyer-input')?.click();
}

async function handleFlyerPick(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) input.value = '';   // picking the same file again must still fire
    const venueId = venuePageVenueId;
    if (!file || !venueId || !currentApp || flyerUploading) return;
    if (!currentUserId || !canManageVenue(venueId)) return;
    if (!file.type || !file.type.startsWith('image/')) {
        showToast('Choose an image for the flyer');
        return;
    }

    flyerUploading = true;
    const btn = document.getElementById('venue-page-flyer-btn');
    if (btn) btn.disabled = true;
    showToast('Uploading flyer…');

    let uploadedPath = null;
    try {
        const blob = await downscaleImage(file, FLYER_MAX_PX, FLYER_QUALITY);
        if (!blob) throw new Error('Could not read that image');

        const path = `members/${currentUserId}/flyer-${Date.now()}.jpg`;
        const { error: uploadError } = await supabaseClient.storage
            .from('venue-media')
            .upload(path, blob, { cacheControl: MEDIA_CACHE_CONTROL, upsert: false, contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        uploadedPath = path;

        const { data: urlData } = supabaseClient.storage.from('venue-media').getPublicUrl(path);
        const { error } = await supabaseClient.rpc('add_venue_flyer', {
            p_venue_id: venueId,
            p_storage_path: path,
            p_url: urlData.publicUrl,
            p_caption: null
        });
        if (error) throw error;
        uploadedPath = null;   // recorded — it is the row's file now

        showToast('Flyer added');
        if (venuePageVenueId === venueId) {
            expandedVenuePostId = null;
            await loadVenuePageFeed();
        }
    } catch (err) {
        console.error('Flyer upload failed:', err);
        showToast(err?.message || 'Could not add that flyer');
        // An upload no row points at is a file nothing will ever show. The
        // member-prefix DELETE policy lets the uploader remove their own.
        if (uploadedPath) {
            supabaseClient.storage.from('venue-media').remove([uploadedPath]).catch(() => {});
        }
    } finally {
        flyerUploading = false;
        if (btn) btn.disabled = false;
    }
}

// ===== Venue page collapsible sections =====
//
// No accordion existed in ViibeView — no <details>, no aria-expanded, no toggle
// helper anywhere. The vocabulary is ported from customer-app/app.css's FAQ
// (.faq-item / toggleFaq) and renamed, so the two surfaces stay recognisably
// the same pattern without sharing a stylesheet they do not otherwise share.
//
// ⚠️ COLLAPSE STATE LIVES HERE, NOT IN THE DOM.
//
// repaintVenueGenres() does `block.outerHTML = renderVenueGenreSection(...)`,
// which destroys and rebuilds the entire block — on EVERY genre chip tap. A
// state held in a CSS class on that element is therefore gone the moment
// someone changes what is playing: the section they had open snaps shut under
// their finger. renderVenueSection() reads this object, so the rebuilt block
// comes back already-open.
//
// openVenuePage() resets it, so an expanded "Who's here" on one venue does not
// leak into the next venue the visitor opens.
const VENUE_SECTION_DEFAULTS = { sound: true, distance: false, crowd: false };
let venueSectionsOpen = { ...VENUE_SECTION_DEFAULTS };

function resetVenueSections() {
    venueSectionsOpen = { ...VENUE_SECTION_DEFAULTS };
}

// The shared wrapper. `body` is already-escaped HTML from the caller.
function renderVenueSection(key, titleKey, titleText, body) {
    const open = !!venueSectionsOpen[key];
    return `
        <div class="venue-section${open ? ' open' : ''}" data-section="${escapeHtml(key)}">
            <button class="venue-section-head" type="button"
                    aria-expanded="${open ? 'true' : 'false'}"
                    onclick="toggleVenueSection('${escapeHtml(key)}')">
                <span data-i18n="${escapeHtml(titleKey)}">${escapeHtml(titleText)}</span>
                <svg class="venue-section-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6,9 12,15 18,9"/>
                </svg>
            </button>
            <div class="venue-section-body">${body}</div>
        </div>
    `;
}

// ⚠️ Toggles the CLASS and the module state, and re-renders NOTHING.
//
// Calling repaintVenueGenres() from here would be the trap this whole design
// exists to avoid: an outerHTML swap on every expand, throwing away focus and
// any in-progress interaction inside the body. The class does the visual work;
// the state object is only read on the next genuine rebuild.
function toggleVenueSection(key) {
    if (!Object.prototype.hasOwnProperty.call(venueSectionsOpen, key)) return;

    venueSectionsOpen[key] = !venueSectionsOpen[key];
    const open = venueSectionsOpen[key];

    const el = document.querySelector(`.venue-section[data-section="${key}"]`);
    if (!el) return;
    el.classList.toggle('open', open);
    el.querySelector('.venue-section-head')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ===== Tonight's sound (venue page) =====
//
// Read-only chips for everyone; for an org member, every genre in the
// vocabulary is rendered as a tappable chip that writes immediately.
//
// On "real time": there is no Supabase Realtime subscription anywhere in this
// repo and none is added here. A tap writes straight away and the next
// loadFeed()/loadVenues() picks it up, so a venue switching from hip-hop to
// house at 1am is reflected for the next person who opens or refreshes the
// app. A postgres_changes channel would add a new failure mode for a value
// that changes a handful of times a night.
function renderVenueGenreSection(venue) {
    const genres = venueGenres(venue);

    // Demo venues have no row behind them — an UPDATE would match nothing and
    // report success. Show what they "play" and nothing more.
    const editable = isOwner && !isDemoVenueId(venue.id);

    // ⚠️ KEEP returning '' here. A quiet venue with no genres and no owner
    // looking at it has nothing to show — and wrapping nothing in an accordion
    // gives every such venue an empty head that expands to a blank box. The
    // section must not exist at all, not merely be collapsed.
    if (!editable) {
        if (genres.length === 0) return '';
        return renderVenueSection('sound', 'social.tonightsSound', "Tonight's sound", `
            <div class="genre-chips">
                ${genres.map(g => `<span class="genre-chip on">${escapeHtml(genreLabel(g))}</span>`).join('')}
            </div>
        `);
    }

    const all = window.MUSIC_GENRES || [];
    return renderVenueSection('sound', 'social.tonightsSound', "Tonight's sound", `
        <p class="venue-page-genres-hint" data-i18n="social.tonightsSoundHint">Tap to change what is playing. Saves instantly.</p>
        <div class="genre-chips" id="venue-genre-chips">
            ${all.map(g => `
                <button class="genre-chip genre-chip-btn ${genres.includes(g.slug) ? 'on' : ''}"
                        type="button" aria-pressed="${genres.includes(g.slug) ? 'true' : 'false'}"
                        onclick="toggleVenueGenre('${escapeHtml(g.slug)}')"
                        data-i18n="${g.labelKey}">${escapeHtml(g.label)}</button>
            `).join('')}
        </div>
    `);
}

// ===== Distance from you (venue page) =====
//
// The Google Maps link already lives in the actions row; this section answers
// "how far is that?", which the actions row never did.
function renderVenueDistanceSection(venue) {
    let body;

    const miles = userLocation
        ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
        : null;

    if (miles === null) {
        // ⚠️ Not a blank section. With no fix we know nothing, and an empty
        // accordion body reads as a bug — so the body IS the thing that would
        // fix it. Wired to the same request path the location banner uses, so
        // there is one permission prompt in this app and not two.
        body = `
            <p class="venue-section-hint" data-i18n="social.distanceNeedsLocation">Turn on location to see how far this is.</p>
            <button class="venue-section-action" type="button" onclick="enableLocationForVenuePage()"
                    data-i18n="social.turnOnLocation">Turn on location</button>
        `;
    } else {
        const km = miles * 1.609344;
        body = `
            <p class="venue-distance-value">
                <strong>${miles.toFixed(1)} mi</strong>
                <span class="venue-distance-alt">${km.toFixed(1)} km</span>
            </p>
        `;
        if (venue.address_line1) {
            const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent([venue.address_line1, venue.city, venue.state].filter(Boolean).join(', '))}`;
            body += `<a class="venue-section-action" href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
                        data-i18n="social.openInMaps">Open in Maps</a>`;
        }
    }

    return renderVenueSection('distance', 'social.distanceFromYou', 'Distance from you', body);
}

// ===== Who's here (venue page) =====
//
// Three things, none of which needs a new query except the gender mix:
//   - here_now, already on get_venue_detail (distinct posters, last 4h)
//   - distinct recent-poster avatars, already on get_venue_page_feed
//   - the gender split bar, which has no data yet and says so
function renderVenueCrowdSection(venue) {
    const hereNow = Number(venue.here_now) || 0;

    let body = `
        <p class="venue-crowd-count">
            <strong>${hereNow}</strong>
            <span data-i18n="${hereNow === 1 ? 'social.personHereNow' : 'social.peopleHereNow'}">${hereNow === 1 ? 'person posting in the last 4 hours' : 'people posting in the last 4 hours'}</span>
        </p>
    `;

    // Distinct posters from the feed already in memory — deduped by author,
    // because one person posting six clips is one person, not six.
    const seen = new Set();
    const faces = [];
    for (const post of venuePageFeed) {
        if (!post.uploaded_by_user_id || seen.has(post.uploaded_by_user_id)) continue;
        seen.add(post.uploaded_by_user_id);
        faces.push(post);
        if (faces.length >= 8) break;
    }

    if (faces.length > 0) {
        body += `<div class="venue-crowd-faces">${faces.map(f => {
            const name = f.author_display_name || '';
            return f.author_avatar_url
                ? `<img class="venue-crowd-face" src="${escapeHtml(f.author_avatar_url)}" alt="${escapeHtml(name)}" loading="lazy">`
                : `<span class="venue-crowd-face venue-crowd-face-initial" aria-label="${escapeHtml(name)}">${escapeHtml((name || '?')[0])}</span>`;
        }).join('')}</div>`;
    }

    body += renderGenderMixBar(venueCrowdMix);

    return renderVenueSection('crowd', 'social.whosHere', "Who's here", body);
}

// A pure-CSS two-segment stacked bar. NO CHART LIBRARY.
//
// social.html ships none today — supabase-js, Leaflet, i18n and five small
// local modules — and ApexCharts is ~130KB into a PWA whose entire premise is a
// fast cold start. A flex bar with width:{pct}% plus role="img" and an
// aria-label summary is this, and is fully accessible, in twenty lines.
//
// `mix` is null until get_venue_crowd_mix returns rows, which it refuses to do
// below the suppression threshold. That null state is rendered honestly rather
// than as a 50/50 bar over no data.
function renderGenderMixBar(mix) {
    const total = mix ? (Number(mix.female_count) || 0) + (Number(mix.male_count) || 0) : 0;

    if (!mix || total === 0) {
        return `
            <div class="venue-gender-mix">
                <h5 class="venue-section-subhead" data-i18n="social.genderMix">Gender mix</h5>
                <p class="venue-section-hint" data-i18n="social.genderMixLocked">Gender mix unlocks once enough members share it.</p>
            </div>
        `;
    }

    const femalePct = Math.round((Number(mix.female_count) / total) * 100);
    const malePct = 100 - femalePct;
    const summary = `${femalePct}% women, ${malePct}% men, from ${total} members who shared it`;

    return `
        <div class="venue-gender-mix">
            <h5 class="venue-section-subhead" data-i18n="social.genderMix">Gender mix</h5>
            <div class="gender-bar" role="img" aria-label="${escapeHtml(summary)}">
                <span class="gender-bar-seg gender-bar-female" style="width:${femalePct}%"></span>
                <span class="gender-bar-seg gender-bar-male" style="width:${malePct}%"></span>
            </div>
            <p class="gender-bar-legend" aria-hidden="true">
                <span class="gender-bar-key gender-bar-female"></span>${femalePct}%
                <span class="gender-bar-key gender-bar-male"></span>${malePct}%
            </p>
        </div>
    `;
}

async function toggleVenueGenre(slug) {
    if (!venuePageVenue || !isValidGenre(slug)) return;
    if (isDemoVenueId(venuePageVenue.id)) return;

    const current = venueGenres(venuePageVenue);
    const next = current.includes(slug)
        ? current.filter(g => g !== slug)
        : sanitizeGenres([...current, slug]);

    // Optimistic: repaint first so a tap feels instant, then reconcile. On
    // failure the old list is restored, because a chip that stays lit over a
    // rejected write is the same class of lie as a "Posted!" toast over a post
    // that was never created.
    const previous = current;
    venuePageVenue.music_genres = next;
    repaintVenueGenres();

    const { error } = await supabaseClient
        .from('venues')
        .update({ music_genres: next })
        .eq('id', venuePageVenue.id);

    if (error) {
        venuePageVenue.music_genres = previous;
        repaintVenueGenres();
        // 42501 is RLS: an org member's session expired, or this is not their
        // org. 23514 is the CHECK constraint, i.e. music-genres.js has drifted
        // from the migration.
        console.error('Failed to save genres:', error);
        showToast(error.code === '42501'
            ? 'You do not have permission to edit this venue'
            : 'Could not save that. Try again.');
        return;
    }

    // Keep the map/search copy of this venue in step, so the genre pills and
    // the swim lane reflect the change without a reload.
    const cached = getVenueById(venuePageVenue.id);
    if (cached) cached.music_genres = next;

    // A genre this venue is the only holder of has just appeared or vanished
    // from the filter row.
    refreshFilterPills();

    renderVenueSwimLane();
    if (map) renderMapPins();
}

// Re-renders only the genre block, so an edit does not blow away the hours
// table or scroll the page.
//
// ⚠️ The selector had to move with the markup. `.venue-page-genres` no longer
// exists — the block is now `.venue-section[data-section="sound"]`, and a
// querySelector that still matched the old class would return null and make
// every genre tap silently fail to repaint (optimistic state applied, chip
// never lit, rollback on error invisible).
//
// This is still an outerHTML swap, which is why venueSectionsOpen exists:
// renderVenueGenreSection() reads it, so a section the visitor had expanded
// comes back expanded rather than snapping shut on every chip tap.
function repaintVenueGenres() {
    const aboutEl = document.getElementById('venue-page-about');
    const block = aboutEl?.querySelector('.venue-section[data-section="sound"]');
    if (!block || !venuePageVenue) return;

    block.outerHTML = renderVenueGenreSection(venuePageVenue);
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Re-asks for a fix from inside the venue page's distance section, then
// repaints only that section. Uses getCurrentCoords() — the same helper the
// radius sheet and the composer use — so there is one geolocation call site
// shape in this app and one permission prompt.
async function enableLocationForVenuePage() {
    const coords = await getCurrentCoords();

    if (!coords) {
        showToast(translateOr('social.locationBlocked', null,
            'Location is off. Turn it on in your browser settings to filter by distance.'));
        return;
    }

    // Open it: the visitor just asked for this number, so hiding it behind a
    // collapsed head would be the app ignoring what they did.
    venueSectionsOpen.distance = true;
    repaintVenueSection('distance');

    // The fix is new to the whole app, not just this page.
    renderVenueSwimLane();
}

// Swap one section in place. Same outerHTML mechanism as repaintVenueGenres,
// and safe for the same reason: renderVenueSection() reads venueSectionsOpen,
// so the replacement comes back in whatever state the visitor left it.
function repaintVenueSection(key) {
    const block = document.querySelector(`.venue-section[data-section="${key}"]`);
    if (!block || !venuePageVenue) return;

    const markup = key === 'distance' ? renderVenueDistanceSection(venuePageVenue)
                 : key === 'crowd'    ? renderVenueCrowdSection(venuePageVenue)
                 : key === 'sound'    ? renderVenueGenreSection(venuePageVenue)
                 : '';
    if (!markup) return;

    block.outerHTML = markup;
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// The all-time gender split for the venue currently open, or null.
//
// ⚠️ null is the NORMAL state, not an error. get_venue_crowd_mix returns ZERO
// ROWS below the suppression threshold, by design — see 20260922000005. The
// bar renders an honest locked state for null and must never fall back to a
// 50/50 split over no data.
let venueCrowdMix = null;

async function loadVenueCrowdMix(venueId) {
    venueCrowdMix = null;
    if (!currentApp || !venueId || isDemoVenueId(venueId)) return;

    const { data, error } = await supabaseClient.rpc('get_venue_crowd_mix', {
        p_app_id: currentApp.id,
        p_venue_id: venueId,
    });

    // Navigated away mid-flight — writing here would put one venue's mix on
    // another venue's page.
    if (venuePageVenueId !== venueId) return;

    if (error) {
        // Non-fatal and deliberately quiet: the locked state is the same thing
        // the visitor sees when there is genuinely not enough data, and it is
        // the honest answer either way.
        console.warn('Failed to load crowd mix:', error.message);
        return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    venueCrowdMix = row || null;
}

async function loadVenuePageFeed(append = false) {
    if (venuePageLoading || !venuePageVenueId) return;
    venuePageLoading = true;

    if (!append) {
        venuePageOffset = 0;
        venuePageFeed = [];
        venuePageHasMore = true;
    }

    // Skip DB query for demo venues (not real UUIDs)
    if (String(venuePageVenueId).startsWith('demo-')) {
        venuePageLoading = false;
        venuePageHasMore = false;
        venuePageFeed = [];
        renderVenuePageGrid();
        return;
    }

    const loadingEl = document.getElementById('venue-page-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    const pageSize = 20;
    // An RPC rather than a .from() select, because the card header needs the
    // author's display name and avatar — which live on app_members, not on
    // venue_media — and RLS on that table would not hand them to an anonymous
    // visitor. uploaded_by_user_id stays load-bearing: the options sheet
    // decides Delete vs Report from it.
    const { data, error } = await supabaseClient.rpc('get_venue_page_feed', {
        p_app_id: currentApp.id,
        p_venue_id: venuePageVenueId,
        p_limit: pageSize,
        p_offset: venuePageOffset
    });

    venuePageLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';

    if (error) {
        console.error('Failed to load venue feed:', error);
        venuePageHasMore = false;
        return;
    }

    if (!data || data.length < pageSize) {
        venuePageHasMore = false;
    }

    if (append) {
        venuePageFeed = [...venuePageFeed, ...data];
    } else {
        venuePageFeed = data || [];
    }

    venuePageOffset += (data || []).length;
    renderVenuePageGrid();
}

// The venue's posts as an Instagram-style reels grid.
//
// Renamed from renderVenuePageFeed(): this surface no longer renders a card
// stack. The `.feed-card` markup it used to own has moved to the member
// profile (renderMemberList), which is the inverse swap — the CSS at
// social.css:503+ stays exactly where it is and serves a different surface.
//
// ⚠️ NO IntersectionObserver AND NO AUTOPLAY ON THIS GRID. The comment that
// used to sit on renderMemberGrid() was right and the reasoning transfers
// wholesale: a popular venue holds dozens of clips, and forty <video> elements
// all calling play() is how a phone runs out of memory. Tiles are posters
// (thumbnail_url as <img loading="lazy">); a <video preload="metadata">
// fallback covers the legacy rows whose thumbnail_url is NULL and can never be
// backfilled. Hydration happens on TAP and nowhere else.
function renderVenuePageGrid() {
    const container = document.getElementById('venue-page-feed');
    if (!container) return;

    // Hide-when-empty. All three elements, not just the grid: a lone "Recent
    // Posts" header over a divider and nothing else is worse than the empty
    // state it replaced. #venue-page-empty is gone entirely — "show nothing
    // until there is something" makes it unreachable.
    const header = document.getElementById('venue-page-feed-header');
    const divider = document.getElementById('venue-page-feed-divider');
    const isEmpty = venuePageFeed.length === 0;

    container.style.display = isEmpty ? 'none' : '';
    if (header) header.style.display = isEmpty ? 'none' : '';
    if (divider) divider.style.display = isEmpty ? 'none' : '';

    if (isEmpty) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = venuePageFeed.map(item => reelsTileMarkup(item, {
        expanded: expandedVenuePostId === item.id,
        onTap: `openVenuePost('${escapeHtml(item.id)}')`
    })).join('');

    // ⚠️ setupVideoObserverIn() is deliberately NOT called here. See the
    // header comment. The observer now lives on the member profile, which is
    // the surface that renders full-width cards and therefore needs it.
    if (expandedVenuePostId) hydrateExpandedVenuePost();
    refreshSoundButtons();

    // The flyer badge carries data-i18n.
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Which grid tile is expanded to full width, or null. One at a time — the
// previous one collapses, which is what stops two clips playing at once
// without any new "pause everything else" bookkeeping.
let expandedVenuePostId = null;

function openVenuePost(id) {
    // Tapping the open tile closes it. Without this the only way out of an
    // expanded tile is to open a different one.
    expandedVenuePostId = (expandedVenuePostId === id) ? null : id;
    renderVenuePageGrid();
}

// Hydrate and play the one expanded tile. Reuses ensureVideoSrc and
// applySoundState unchanged — applySoundState stays the single writer of
// video.muted, so the grid inherits the sound toggle's state rather than
// inventing a second source of truth for it.
function hydrateExpandedVenuePost() {
    hydrateExpandedTileIn(document.getElementById('venue-page-feed'));
}

// Scoped to one grid: the venue page and the Me tab can each hold an expanded
// tile at once, and a document-wide lookup would hydrate the wrong one.
function hydrateExpandedTileIn(container) {
    const tile = container?.querySelector('.member-grid-tile.is-expanded');
    const video = tile?.querySelector('video[data-src]');
    if (!video) return;

    ensureVideoSrc(video);
    applySoundState(video);
    video.play().catch(() => {});
}

/**
 * One reels-grid tile. Shared by the venue page and the Me tab so the two
 * grids cannot drift into looking different.
 *
 * ⚠️ A <div role="button">, not a <button>. The expanded tile carries its own
 * sound and options buttons, and a <button> inside a <button> is not nestable
 * HTML: the parser closes the outer tile at the inner start tag and the inner
 * controls land OUTSIDE it, unpositioned.
 *
 * Collapsed tiles are posters only — no <video> unless there is no thumbnail.
 * See renderVenuePageGrid() for why.
 */
function reelsTileMarkup(item, { expanded = false, onTap = '' } = {}) {
    const isVideo = item.media_type === 'video';
    const label = item.caption || item.author_display_name || '';
    const id = escapeHtml(item.id);

    // The tile's media. Expanded tiles carry a real <video> with data-src so
    // the hydrate step can play it; collapsed ones carry a poster only.
    // Deliberately NOT the same element in both states: leaving a <video> in
    // every collapsed tile is the memory cost this grid exists to avoid,
    // thumbnail or no thumbnail.
    const media = !isVideo
        ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(label)}" loading="lazy">`
        : expanded
            ? `<video data-src="${escapeHtml(item.url)}" poster="${escapeHtml(item.thumbnail_url || '')}"
                      playsinline muted preload="${videoPreloadMode(item)}" loop></video>`
            : item.thumbnail_url
                ? `<img src="${escapeHtml(item.thumbnail_url)}" alt="${escapeHtml(label)}" loading="lazy">`
                // ⚠️ preload="metadata", NOT "none". Every post predating
                // thumbnail generation has thumbnail_url NULL with no possible
                // backfill, and "none" paints those tiles solid black.
                // metadata paints the first frame, which is the whole point of
                // the fallback.
                : `<video src="${escapeHtml(item.url)}" muted playsinline preload="metadata"></video>`;

    return `
        <div class="member-grid-tile${expanded ? ' is-expanded' : ''}${item.is_flyer ? ' is-flyer' : ''}"
             role="button" tabindex="0"
             data-media-id="${id}"
             aria-label="${escapeHtml(label)}"
             onclick="${onTap}"
             onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ${onTap}; }">
            ${media}
            ${item.is_flyer ? `<span class="flyer-badge" data-i18n="social.flyerBadge">Flyer</span>` : ''}
            ${expanded ? `
                <button class="feed-more-btn tile-more-btn" type="button" aria-label="Post options"
                        onclick="event.stopPropagation(); showPostOptions('${id}')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>` : ''}
            ${expanded && isVideo
                ? `<button class="video-sound-btn" type="button" onclick="toggleFeedSound(event, this)"></button>`
                : ''}
            ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
        </div>
    `;
}

// Same leak, same fix, for the venue page's own feed.
function setupVideoObserverIn(container) {
    if (venueVideoObserver) venueVideoObserver.disconnect();

    venueVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;
            if (entry.isIntersecting) {
                // ⚠️ Before play(). These cards carry data-src and no src, so
                // play() on a bare element rejects and the card stays a poster
                // forever. This observer used to call play() without ever
                // hydrating anything, which worked only because the src was
                // eager — the thing this change removed.
                ensureVideoSrc(video);
                applySoundState(video);
                // Autoplay blocked leaves the poster frame showing and the card
                // tappable, which is the whole affordance now.
                video.play().catch(() => {});
            } else {
                video.pause();
                video.muted = true;
            }
        });
    }, { threshold: 0.6 });

    container.querySelectorAll('.feed-media').forEach(el => {
        if (el.querySelector('video')) venueVideoObserver.observe(el);
    });

    // ⚠️ Seed the first card synchronously. Identical reasoning to
    // hydrateVideosAround(0) on the main feed: an IntersectionObserver that
    // never fires — a hidden tab at first paint, a stubbed environment, a
    // container that is display:none when this runs — would otherwise leave
    // EVERY card without a src, and the venue page would render as a column of
    // black rectangles with nothing in the console.
    //
    // Only the first: hydrating the rest is exactly the cost this change exists
    // to remove. Cards keep their src once hydrated (unlike the main feed's ±1
    // window) because this list is a venue's own posts, not an endless scroll.
    const firstVideo = container.querySelector('.feed-media video[data-src]');
    if (firstVideo) ensureVideoSrc(firstVideo);
}

function closeVenuePage() {
    const page = document.getElementById('venue-page');
    const backdrop = document.getElementById('venue-page-backdrop');
    if (page) page.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    unlockBodyScroll('venue-page');

    // Remove scroll listener
    const scrollEl = document.getElementById('venue-page-scroll');
    if (scrollEl && venuePageScrollHandler) {
        scrollEl.removeEventListener('scroll', venuePageScrollHandler);
        venuePageScrollHandler = null;
    }

    // ⚠️ CLEAR the grid, do not merely pause it. Mirrors closeMemberProfile()'s
    // reasoning: a paused <video> left in the DOM keeps its buffer and keeps
    // downloading. Pausing was enough when this surface held one hydrated card;
    // with a grid that can hold an expanded clip plus dozens of poster frames,
    // leaving the markup behind holds media for a page nobody is looking at.
    const pageEl = document.getElementById('venue-page-feed');
    if (pageEl) {
        pageEl.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });
        pageEl.innerHTML = '';
    }

    venuePageVenueId = null;
    venuePageVenue = null;
    venuePageFeed = [];
    venueCrowdMix = null;
    expandedVenuePostId = null;
}

// ===== Member Profile Page =====
//
// An overlay for OTHER people's profiles (and yours, when you tap your own
// name). Your own profile is also the Me tab, which has its own state — see
// loadMeTab(). This one stays an overlay because it opens from inside the
// venue page and the people sheet.
//
// Mirrors openVenuePage(): show the page FIRST, then fetch. A tap that appears
// to do nothing for 400ms reads as a broken button, and every failure path below
// closes the page again with a toast that says why.

async function openMemberProfile(userId) {
    const page = document.getElementById('member-page');
    const backdrop = document.getElementById('member-page-backdrop');
    if (!page || !backdrop || !userId || !currentApp) return;

    memberPageUserId = userId;
    memberPageProfile = null;
    memberPagePosts = [];
    memberPageVenues = [];

    page.classList.add('visible');
    backdrop.classList.add('visible');
    // Keyed, because this can open ON TOP of #venue-page — see lockBodyScroll().
    lockBodyScroll('member-page');

    // Reset the reused singleton's content, or the previously-opened member's
    // grid and bio show through while this one loads.
    setText('member-page-title', '');
    setText('member-page-name', '');
    setText('member-page-bio', '');
    const grid = document.getElementById('member-page-grid');
    if (grid) grid.innerHTML = '';
    const stats = document.getElementById('member-page-stats');
    if (stats) stats.innerHTML = '';
    const locEl = document.getElementById('member-page-location');
    if (locEl) locEl.style.display = 'none';
    // The venues section is a reused singleton like everything else here: leave
    // it painted and the previous member's venues show under this member's name
    // for as long as the fetch takes.
    const venuesEl = document.getElementById('member-page-venues');
    if (venuesEl) venuesEl.style.display = 'none';
    const venuesList = document.getElementById('member-page-venues-list');
    if (venuesList) venuesList.innerHTML = '';
    const avatar = document.getElementById('member-page-avatar');
    if (avatar) avatar.innerHTML = '';
    const privateEl = document.getElementById('member-page-private');
    if (privateEl) privateEl.style.display = 'none';
    const emptyEl = document.getElementById('member-page-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    const followBtn = document.getElementById('member-page-follow-btn');
    if (followBtn) followBtn.style.display = 'none';
    const scrollEl = document.getElementById('member-page-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    const { data, error } = await supabaseClient.rpc('get_member_profile', {
        p_app_id: currentApp.id,
        p_user_id: userId
    });

    // Zero rows means "no such member" — get_member_profile deliberately
    // returns a ROW with is_private for a private one, so an empty result here
    // is unambiguous.
    const profile = Array.isArray(data) ? data[0] : data;
    if (error || !profile) {
        if (error) console.error('Failed to load profile:', error);
        showToast('Could not open that profile');
        closeMemberProfile();
        return;
    }

    // A late-arriving response for a profile the user has already navigated
    // away from must not paint over the current one.
    if (memberPageUserId !== userId) return;

    memberPageProfile = profile;
    renderMemberProfile();

    if (profile.is_private && userId !== currentUserId) {
        if (privateEl) privateEl.style.display = 'flex';
        return;
    }

    // Both read from this member's posts, and both are gated server-side on the
    // same profile_public switch, so they either both return or both do not.
    // Not awaited in series — the grid is the slower of the two and there is no
    // reason for the venue list to queue behind it.
    await Promise.all([loadMemberPosts(), loadMemberVenues()]);
}

function closeMemberProfile() {
    document.getElementById('member-page')?.classList.remove('visible');
    document.getElementById('member-page-backdrop')?.classList.remove('visible');
    unlockBodyScroll('member-page');

    // Clearing the list stops any <video> that was decoding a poster frame; a
    // paused video left in the DOM keeps its buffer and keeps downloading.
    //
    // ⚠️ The observer has to go too, now that this surface owns it. An
    // IntersectionObserver still holding torn-down .feed-media elements is a
    // leak across every profile the visitor opens in a session — and on the
    // next open, setupVideoObserverIn() would disconnect only the most recent
    // one, because there is a single module-level handle.
    if (venueVideoObserver) {
        venueVideoObserver.disconnect();
        venueVideoObserver = null;
    }

    const grid = document.getElementById('member-page-grid');
    if (grid) grid.innerHTML = '';

    memberPageUserId = null;
    memberPageProfile = null;
    memberPagePosts = [];
    memberPageVenues = [];
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
}

function renderMemberProfile() {
    const p = memberPageProfile;
    if (!p) return;

    setText('member-page-title', p.display_name);
    setText('member-page-name', p.display_name);

    const bioEl = document.getElementById('member-page-bio');
    if (bioEl) {
        bioEl.textContent = p.bio || '';
        bioEl.style.display = p.bio ? '' : 'none';
    }

    // get_member_profile returns location NULL for a private profile viewed by
    // anyone else, on the same terms as the bio — so this needs no gate of its
    // own beyond "hide the element when there is nothing in it".
    const locEl = document.getElementById('member-page-location');
    if (locEl) {
        locEl.textContent = p.location || '';
        locEl.style.display = p.location ? '' : 'none';
    }

    const avatar = document.getElementById('member-page-avatar');
    if (avatar) {
        avatar.innerHTML = p.avatar_url
            ? `<img src="${escapeHtml(p.avatar_url)}" alt="">`
            : escapeHtml((p.display_name || '?').charAt(0).toUpperCase());
    }

    // ⚠️ A private profile viewed by someone else must not PAINT the stats, not
    // merely hide them. Each stat is a button carrying this member's uid inside
    // an inline openPeopleSheet('followers', '<uid>') — so hiding them after the
    // fact still writes the uid into the DOM and still leaves three working
    // routes into a profile the app has just said is private. The counts are
    // already server-suppressed to 0, which is its own tell: three tappable
    // zeroes under a padlock is a worse answer than no stats at all.
    const statsEl = document.getElementById('member-page-stats');
    const statsHidden = !!p.is_private && p.user_id !== currentUserId;
    if (statsHidden) {
        if (statsEl) {
            statsEl.innerHTML = '';
            statsEl.style.display = 'none';
        }
    } else {
        if (statsEl) statsEl.style.display = '';   // reused singleton — undo a prior hide
        renderMemberStats();
    }

    const followBtn = document.getElementById('member-page-follow-btn');
    if (followBtn) {
        // Your own profile gets Edit profile in the Follow slot.
        // social_follows_no_self would reject a self-follow, so a Follow
        // button here could only ever produce an error message.
        const isSelf = !!currentUserId && currentUserId === p.user_id;
        followBtn.style.display = '';
        if (isSelf) {
            paintEditProfileButton(followBtn);
        } else {
            followBtn.onclick = () => toggleFollow('user', p.user_id);
            paintFollowButton(followBtn, isFollowing('user', p.user_id));
        }
    }
}

function paintEditProfileButton(btn) {
    btn.classList.add('following');
    btn.disabled = false;
    btn.setAttribute('data-i18n', 'social.editProfile');
    btn.textContent = 'Edit Profile';
    btn.onclick = () => openEditProfile();
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Posts / Followers / Following. Followers and Following are buttons that open
// the people sheet — the whole point of the profile is being a route to them.
function renderMemberStats() {
    const el = document.getElementById('member-page-stats');
    const p = memberPageProfile;
    if (!el || !p) return;

    el.innerHTML = memberStatsMarkup(p);

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

/**
 * The three stat buttons for one get_member_profile row. Shared by the member
 * page and the Me tab, so the two cannot disagree about what a stat is or
 * where tapping it goes.
 */
function memberStatsMarkup(p) {
    const stat = (value, labelKey, label, onclick) => `
        <button class="member-stat" type="button" ${onclick ? `onclick="${onclick}"` : 'disabled'}>
            <span class="member-stat-value">${escapeHtml(String(value ?? 0))}</span>
            <span class="member-stat-label" data-i18n="${labelKey}">${escapeHtml(label)}</span>
        </button>
    `;

    const uid = escapeHtml(p.user_id);
    return stat(p.post_count, 'social.posts', 'Posts', null) +
        stat(p.follower_count, 'social.followers', 'Followers', `openPeopleSheet('followers', '${uid}')`) +
        stat(p.following_count, 'social.following', 'Following', `openPeopleSheet('following', '${uid}')`);
}

async function loadMemberPosts() {
    if (!memberPageUserId || !currentApp) return;

    const loadingEl = document.getElementById('member-page-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    const userId = memberPageUserId;
    const { data, error } = await supabaseClient.rpc('get_member_posts', {
        p_app_id: currentApp.id,
        p_user_id: userId,
        p_limit: 48,
        p_offset: 0
    });

    if (loadingEl) loadingEl.style.display = 'none';
    if (memberPageUserId !== userId) return;   // navigated away mid-flight

    if (error) {
        console.error('Failed to load member posts:', error);
        memberPagePosts = [];
    } else {
        memberPagePosts = data || [];
    }

    renderMemberList();
}

// A scrollable list of full-width cards — the inverse of what this function
// used to render, and of what the venue page now renders.
//
// Renamed from renderMemberGrid(). It takes over the `.feed-card` markup the
// venue page vacated, so social.css:503+ stays exactly where it is and simply
// serves a different surface.
//
// ⚠️ LAZY VIDEO IS REINSTATED HERE, and it is not optional. A profile with 24
// full-width autoplaying clips is precisely the failure the old grid comment
// was written to prevent — the risk did not go away when the layout changed,
// it MOVED. Cards carry data-src, preload comes from videoPreloadMode(), and
// the relocated setupVideoObserverIn() hydrates what scrolls into view.
function renderMemberList() {
    const list = document.getElementById('member-page-grid');
    const emptyEl = document.getElementById('member-page-empty');
    if (!list) return;

    if (memberPagePosts.length === 0) {
        list.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    list.innerHTML = memberPagePosts.map(post => {
        // 'image', not 'photo' — venue_media has never stored 'photo', so the
        // old check made every image a broken <video>.
        const isVideo = post.media_type !== 'image';
        // The VENUE, not the author — the whole page is already this member, so
        // the useful identity on each card is where it was shot. That is the
        // mirror of the venue page's old showVenue:false, and it is why the
        // cards route to openVenuePage rather than to a profile.
        const venueLink = post.venue_id
            ? `<button class="feed-card-venue-link" type="button"
                       onclick="closeMemberProfile(); openVenuePage('${escapeHtml(post.venue_id)}')">
                   ${escapeHtml(post.venue_name || 'View venue')}
               </button>`
            : '';

        return `
            <div class="feed-card" data-media-id="${escapeHtml(post.id)}">
                <div class="feed-card-header${venueLink ? '' : ' feed-card-header-compact'}">
                    ${venueLink}
                    <button class="feed-more-btn" aria-label="Post options" onclick="showPostOptions('${escapeHtml(post.id)}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                </div>
                <div class="feed-media" onclick="toggleVideoPlay(this)">
                    ${isVideo ? `
                        <!-- data-src, not src. See the function header: this is
                             the surface that can hold dozens of clips now, and a
                             plain src opens a connection per card on first
                             paint. preload stays per-post via videoPreloadMode()
                             because a NULL thumbnail_url has no poster to
                             paint and would render black at preload="none". -->
                        <video data-src="${escapeHtml(post.url)}" poster="${escapeHtml(post.thumbnail_url || '')}" playsinline muted preload="${videoPreloadMode(post)}" loop></video>
                        ${post.duration_seconds ? `<span class="video-duration">${formatDuration(post.duration_seconds)}</span>` : ''}
                        <button class="video-sound-btn" type="button" onclick="toggleFeedSound(event, this)"></button>
                    ` : `
                        <img src="${escapeHtml(post.url)}" alt="${escapeHtml(post.caption || '')}" loading="lazy">
                    `}
                </div>
                ${post.caption ? `<div class="feed-caption">${escapeHtml(post.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // The observer moved here from the venue page, where it is now actively
    // harmful (40 autoplaying tiles) and here is necessary.
    setupVideoObserverIn(list);
    refreshSoundButtons();
}

// ===== Me tab =====
//
// Your own profile as a tab. Its own state, deliberately separate from
// memberPage*: #member-page is a singleton overlay that can be open ON TOP of
// this tab showing someone else, and sharing state would let one repaint the
// other mid-flight.
//
// loadMeTab() refetches every time the tab opens. That is the fix for
// "0 Following" — the old Profile tab painted its counts at boot, sign-in and
// profile save only, so a follow made in between never showed up.

let meProfile = null;
let mePosts = [];
let meLoadSeq = 0;
let expandedMePostId = null;

async function loadMeTab() {
    const signedOut = document.getElementById('me-signed-out');
    const signedIn = document.getElementById('me-signed-in');

    const session = await SocialAuth.getSession();
    const userId = session?.user?.id || null;

    if (!userId || !currentApp) {
        meLoadSeq++;   // a late response for a signed-out session must not paint
        meProfile = null;
        mePosts = [];
        expandedMePostId = null;
        if (signedOut) signedOut.style.display = '';
        if (signedIn) signedIn.style.display = 'none';
        const grid = document.getElementById('me-grid');
        if (grid) grid.innerHTML = '';
        return;
    }

    if (signedOut) signedOut.style.display = 'none';
    if (signedIn) signedIn.style.display = '';

    // A different account from the one painted last: clear, don't flash it.
    if (meProfile && meProfile.user_id !== userId) {
        meProfile = null;
        mePosts = [];
        expandedMePostId = null;
    }

    const seq = ++meLoadSeq;
    renderMeTab();   // whatever is cached, immediately

    const loadingEl = document.getElementById('me-loading');
    if (loadingEl && mePosts.length === 0) loadingEl.style.display = 'block';

    const [profileRes, postsRes] = await Promise.all([
        supabaseClient.rpc('get_member_profile', { p_app_id: currentApp.id, p_user_id: userId }),
        supabaseClient.rpc('get_member_posts', {
            p_app_id: currentApp.id,
            p_user_id: userId,
            p_limit: 48,
            p_offset: 0
        })
    ]);

    // A newer load (or a sign-out) started while this one was in flight.
    if (seq !== meLoadSeq) return;
    if (loadingEl) loadingEl.style.display = 'none';

    const profile = Array.isArray(profileRes.data) ? profileRes.data[0] : profileRes.data;
    if (profileRes.error) console.error('Failed to load your profile:', profileRes.error);
    if (profile) meProfile = profile;

    if (postsRes.error) {
        console.error('Failed to load your posts:', postsRes.error);
    } else {
        mePosts = postsRes.data || [];
    }

    renderMeTab();
}

// Just the counts — after a follow, or a delete, from wherever it happened.
async function refreshMeCounts() {
    if (!meProfile || !currentApp) return;
    const userId = meProfile.user_id;
    const seq = meLoadSeq;

    const { data } = await supabaseClient.rpc('get_member_profile', {
        p_app_id: currentApp.id,
        p_user_id: userId
    });

    if (seq !== meLoadSeq || !meProfile || meProfile.user_id !== userId) return;
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) return;
    meProfile = profile;
    renderMeStats();
}

function renderMeTab() {
    const p = meProfile;

    setText('me-name', p?.display_name || '');

    const bioEl = document.getElementById('me-bio');
    if (bioEl) {
        bioEl.textContent = p?.bio || '';
        bioEl.style.display = p?.bio ? '' : 'none';
    }

    const locEl = document.getElementById('me-location');
    if (locEl) {
        locEl.textContent = p?.location || '';
        locEl.style.display = p?.location ? '' : 'none';
    }

    const avatar = document.getElementById('me-avatar');
    if (avatar) {
        avatar.innerHTML = p?.avatar_url
            ? `<img src="${escapeHtml(p.avatar_url)}" alt="">`
            : escapeHtml((p?.display_name || '?').charAt(0).toUpperCase());
    }

    renderMeStats();
    renderMeGrid();
}

function renderMeStats() {
    const el = document.getElementById('me-stats');
    if (!el) return;
    el.innerHTML = meProfile ? memberStatsMarkup(meProfile) : '';

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// The same reels grid as the venue page, through the same tile markup.
function renderMeGrid() {
    const grid = document.getElementById('me-grid');
    const emptyEl = document.getElementById('me-empty');
    if (!grid) return;

    if (mePosts.length === 0) {
        grid.innerHTML = '';
        grid.style.display = 'none';
        // "No posts yet" only once a load has answered — not while the first
        // fetch is still in flight.
        if (emptyEl) emptyEl.style.display = meProfile ? 'flex' : 'none';
        return;
    }

    grid.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';

    grid.innerHTML = mePosts.map(item => reelsTileMarkup(item, {
        expanded: expandedMePostId === item.id,
        onTap: `openMePost('${escapeHtml(item.id)}')`
    })).join('');

    if (expandedMePostId) hydrateExpandedTileIn(grid);
    refreshSoundButtons();

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function openMePost(id) {
    expandedMePostId = (expandedMePostId === id) ? null : id;
    renderMeGrid();
}

// ===== "Been to" — venues derived from posts =====
//
// Not a check-in log and not presented as one. Choosing a venue when you post
// IS the check-in in this app, so get_member_venues groups this member's posts
// by venue. That means no new write path, which is the point: record_member_visit
// was revoked from anon and authenticated in 20260903000005 as a points-forgery
// hole, and a "real" check-in button would be a request to re-open it.

/**
 * "3 Viibes · Aug 28".
 *
 * I18n.t() returns the KEY when a translation is missing, so the English is
 * built here rather than trusting the lookup — same shape as postedAtLabel().
 * Two keys rather than one because t() has no plural support (i18n.js:103): it
 * does `{param}` substitution and nothing else, so "1 Viibes" is the only thing
 * a single key can produce.
 *
 * The date is formatted client-side from last_posted_at, in the reader's own
 * locale and time zone. The `subtitle` the RPC returns is the same string in
 * English and UTC, and is what shows if this function is somehow not reached.
 */
function venueVisitLabel(count, lastPostedAt) {
    const n = Number(count) || 0;
    const date = lastPostedAt
        ? new Date(lastPostedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '';

    const key = n === 1 ? 'social.viibeAtVenue' : 'social.viibesAtVenue';
    const translated = window.I18n?.t
        ? window.I18n.t(key, { count: n, date })
        : key;
    if (translated !== key) return translated;

    const noun = n === 1 ? 'Viibe' : 'Viibes';
    return date ? `${n} ${noun} · ${date}` : `${n} ${noun}`;
}

/** Replaces the server's English subtitle with a localised one. */
function withVenueSubtitles(rows) {
    return (rows || []).map(row => ({
        ...row,
        subtitle: venueVisitLabel(row.visit_count, row.last_posted_at),
    }));
}

async function loadMemberVenues() {
    if (!memberPageUserId || !currentApp) return;

    const userId = memberPageUserId;
    const { data, error } = await supabaseClient.rpc('get_member_venues', {
        p_app_id: currentApp.id,
        p_user_id: userId,
        p_limit: 24,
        p_offset: 0
    });

    // A late response for a member the user has already navigated away from
    // must not paint over the current one — same guard as loadMemberPosts().
    if (memberPageUserId !== userId) return;

    if (error) {
        console.error('Failed to load member venues:', error);
        memberPageVenues = [];
    } else {
        memberPageVenues = withVenueSubtitles(data);
    }

    renderMemberVenues();
}

function renderMemberVenues() {
    const section = document.getElementById('member-page-venues');
    const list = document.getElementById('member-page-venues-list');
    const more = document.getElementById('member-page-venues-more');
    if (!section || !list) return;

    // No heading over nothing. A member who only posts unattached Viibes has no
    // venue history, and "Been to (empty)" states that as if it were a failure.
    if (memberPageVenues.length === 0) {
        section.style.display = 'none';
        list.innerHTML = '';
        if (more) more.style.display = 'none';
        return;
    }

    section.style.display = '';
    list.innerHTML = memberPageVenues
        .slice(0, MEMBER_VENUES_PREVIEW)
        .map(row => peopleRowMarkup(
            row,
            // NOT closePeopleSheet() — these rows live on the profile itself,
            // not in the sheet. The profile has to close for the same reason
            // the grid tiles close it: #member-page sits ABOVE #venue-page.
            `closeMemberProfile(); openVenuePage('${escapeHtml(row.target_id)}')`
        ))
        .join('');

    if (more) {
        const hasMore = memberPageVenues.length > MEMBER_VENUES_PREVIEW;
        more.style.display = hasMore ? '' : 'none';
        more.onclick = hasMore ? () => openPeopleSheet('venues', memberPageUserId) : null;
    }
}

// ===== People sheet — one sheet, three modes =====
//
// followers / following / discover. All three RPCs return the identical row
// shape (migration 20260903000003), so there is one renderer here rather than
// three that drift.

async function openPeopleSheet(mode, userId) {
    const sheet = document.getElementById('people-sheet');
    const backdrop = document.getElementById('people-backdrop');
    if (!sheet || !backdrop || !currentApp) return;

    peopleSheetMode = mode;
    // null means "the signed-in user's own lists".
    peopleSheetUserId = userId || currentUserId || null;

    if (mode !== 'discover' && !peopleSheetUserId) {
        // Followers/following of nobody. Reachable only from the Profile tab,
        // which is signed-out at that point.
        showAuth('signup');
        return;
    }

    const titles = {
        followers: ['social.followers', 'Followers'],
        following: ['social.following', 'Following'],
        discover:  ['social.discoverMembers', 'Discover Members'],
        venues:    ['social.beenTo', 'Been to']
    };
    const titleEl = document.getElementById('people-sheet-title');
    if (titleEl) {
        const [key, fallback] = titles[mode] || titles.discover;
        titleEl.setAttribute('data-i18n', key);
        titleEl.textContent = fallback;
    }

    // The search box belongs to discover only: followers and following are
    // lists, and a search field over nine rows is noise.
    const searchWrap = document.getElementById('people-sheet-search-wrap');
    const searchInput = document.getElementById('people-sheet-search');
    if (searchWrap) searchWrap.style.display = mode === 'discover' ? '' : 'none';
    if (searchInput && mode === 'discover') searchInput.value = '';

    const list = document.getElementById('people-list');
    if (list) list.innerHTML = '';
    setPeopleEmpty('');

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('people-sheet');

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }

    await loadPeople();
}

function closePeopleSheet() {
    document.getElementById('people-sheet')?.classList.remove('visible');
    document.getElementById('people-backdrop')?.classList.remove('visible');
    unlockBodyScroll('people-sheet');
    clearTimeout(peopleSearchTimeout);
}

function setPeopleEmpty(message) {
    const el = document.getElementById('people-empty');
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
}

async function loadPeople() {
    if (!currentApp) return;

    const mode = peopleSheetMode;
    const rpc = mode === 'discover'
        ? 'discover_members'
        : mode === 'venues' ? 'get_member_venues'
        : mode === 'following' ? 'get_member_following' : 'get_member_followers';

    const args = mode === 'discover'
        ? {
            p_app_id: currentApp.id,
            p_query: (document.getElementById('people-sheet-search')?.value || '').trim() || null,
            p_limit: 50,
            p_offset: 0
        }
        : {
            p_app_id: currentApp.id,
            p_user_id: peopleSheetUserId,
            p_limit: 50,
            p_offset: 0
        };

    const { data, error } = await supabaseClient.rpc(rpc, args);

    // A mode switch or a new keystroke landed while this was in flight.
    if (peopleSheetMode !== mode) return;

    if (error) {
        console.error('Failed to load people:', error);
        setPeopleEmpty('Could not load that list');
        return;
    }

    // get_member_venues is the one mode whose subtitle is generated rather than
    // stored, so it gets localised here before the shared renderer sees it.
    renderPeopleList(mode === 'venues' ? withVenueSubtitles(data) : (data || []));
}

function renderPeopleList(rows) {
    const list = document.getElementById('people-list');
    if (!list) return;

    if (rows.length === 0) {
        list.innerHTML = '';
        // These were hardcoded English. They are set as textContent by
        // setPeopleEmpty(), so data-i18n never reaches them — the lookup has to
        // happen here, with the English built in JS because I18n.t() returns the
        // KEY on a miss (same pattern as postedAtLabel).
        const empties = {
            discover:  ['social.noMembersFound', 'No members found'],
            // ⚠️ noVenuesVISITED, not noVenuesYet. The latter already exists and
            // says "No venues have been added yet" — the app-level empty state
            // for a tenant with no venues at all, which is a different sentence
            // in every one of the eight locales.
            venues:    ['social.noVenuesVisited', 'No venues yet'],
            following: ['social.notFollowingAnyone', 'Not following anyone yet'],
            followers: ['social.noFollowersYet', 'No followers yet'],
        };
        const [key, english] = empties[peopleSheetMode] || empties.followers;
        const translated = window.I18n?.t ? window.I18n.t(key) : key;
        setPeopleEmpty(translated === key ? english : translated);
        return;
    }
    setPeopleEmpty('');

    list.innerHTML = rows.map(row => {
        const isVenue = row.target_type === 'venue';
        // A venue row opens the venue page, a member row opens their profile.
        // Both close the sheet first: the sheet sits ABOVE #member-page in the
        // ladder, so leaving it open would cover the thing it just opened.
        //
        // A venue row ALSO closes the member page: #member-page (2700) sits
        // above #venue-page (2500), so the venue opened BEHIND the profile the
        // list came from (Jay, 2026-10-06).
        const onclick = isVenue
            ? `closePeopleSheet(); closeMemberProfile(); openVenuePage('${escapeHtml(row.target_id)}')`
            : `closePeopleSheet(); openMemberProfile('${escapeHtml(row.target_id)}')`;

        return peopleRowMarkup(row, onclick);
    }).join('');
}

/**
 * One row of a people/venue list.
 *
 * Extracted from renderPeopleList so the inline "Been to" list on the profile
 * and the same list inside the sheet cannot drift into looking different — they
 * are the same rows, and only what a tap DOES differs (the sheet closes itself;
 * the profile closes itself). `onclick` is therefore the caller's, not derived
 * here.
 */
function peopleRowMarkup(row, onclick) {
    const isVenue = row.target_type === 'venue';
    return `
        <button class="people-row" type="button" onclick="${onclick}">
            <span class="people-row-avatar ${isVenue ? 'venue' : ''}">
                ${row.avatar_url
                    ? `<img src="${escapeHtml(row.avatar_url)}" alt="">`
                    : escapeHtml((row.name || '?').charAt(0).toUpperCase())}
            </span>
            <span class="people-row-body">
                <span class="people-row-name">${escapeHtml(row.name)}</span>
                ${row.subtitle ? `<span class="people-row-meta">${escapeHtml(row.subtitle)}</span>` : ''}
            </span>
        </button>
    `;
}

// ===== Edit profile =====

async function openEditProfile() {
    if (!(await requireAccount('Create an account to set up a profile'))) return;

    const sheet = document.getElementById('edit-profile-sheet');
    const backdrop = document.getElementById('edit-profile-backdrop');
    if (!sheet || !backdrop) return;

    // force: the member row may have been edited in another tab, and a stale
    // cache here would silently revert whatever was changed there — this form
    // is a FULL write (see update_social_profile), not a patch.
    const member = await SocialAuth.loadMember({ force: true });

    const nameInput = document.getElementById('edit-profile-name');
    const bioInput = document.getElementById('edit-profile-bio');
    const locationInput = document.getElementById('edit-profile-location');
    const publicInput = document.getElementById('edit-profile-public');
    if (nameInput) nameInput.value = member?.display_name || '';
    if (bioInput) bioInput.value = member?.bio || '';
    // ⚠️ Prefilling this is not cosmetic. The save below is a FULL write, so a
    // location this form failed to load is a location the next Save deletes.
    // `location` reaches us because 20260904000003 added it to
    // get_social_member — it is NOT on the row otherwise.
    if (locationInput) locationInput.value = member?.location || '';
    if (publicInput) publicInput.checked = member?.profile_public !== false;

    editProfileAvatarUrl = member?.avatar_url || null;
    editProfileAvatarFile = null;
    renderEditProfileAvatar(editProfileAvatarUrl, member?.display_name);
    updateBioCount();

    setFormMessage('edit-profile', '');
    setFormMessage('edit-profile', '', 'success');
    setFieldError('edit-profile-name', null);

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('edit-profile');
}

function closeEditProfile() {
    document.getElementById('edit-profile-sheet')?.classList.remove('visible');
    document.getElementById('edit-profile-backdrop')?.classList.remove('visible');
    unlockBodyScroll('edit-profile');
    editProfileAvatarFile = null;
}

function renderEditProfileAvatar(url, name) {
    const el = document.getElementById('edit-profile-avatar-preview');
    if (!el) return;
    el.innerHTML = url
        ? `<img src="${escapeHtml(url)}" alt="">`
        : escapeHtml((name || '?').charAt(0).toUpperCase());
}

function updateBioCount() {
    const bio = document.getElementById('edit-profile-bio');
    const count = document.getElementById('edit-profile-bio-count');
    if (bio && count) count.textContent = bio.value.length;
}

/**
 * Downscales an image file to a square-ish JPEG no larger than maxPx on its
 * longest edge.
 *
 * None of this existed: generateThumbnail() is video-only. Without it an
 * unresized 12MP phone photo becomes a multi-megabyte fetch on every feed card
 * that member appears on, and on the venue page, and in every follower list.
 *
 * Resolves to null on any failure, and handleAvatarPick() treats that as "keep
 * the file as-is" rather than refusing the upload — a broken canvas must not
 * make a profile photo impossible.
 */
function downscaleImage(file, maxPx, quality) {
    return new Promise((resolve) => {
        let settled = false;
        let objectUrl = null;

        const finish = (blob) => {
            if (settled) return;
            settled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            resolve(blob || null);
        };

        try {
            const img = new Image();
            const timer = setTimeout(() => finish(null), 8000);

            img.onload = () => {
                try {
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) { clearTimeout(timer); finish(null); return; }

                    const scale = Math.min(1, maxPx / Math.max(w, h));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(w * scale));
                    canvas.height = Math.max(1, Math.round(h * scale));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(
                        (blob) => { clearTimeout(timer); finish(blob); },
                        'image/jpeg',
                        quality
                    );
                } catch {
                    clearTimeout(timer);
                    finish(null);
                }
            };

            img.onerror = () => { clearTimeout(timer); finish(null); };

            objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;
        } catch {
            finish(null);
        }
    });
}

async function handleAvatarPick(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (!/^image\//.test(file.type)) {
        setFormMessage('edit-profile', 'Choose an image file');
        return;
    }

    setFormMessage('edit-profile', '');
    const shrunk = await downscaleImage(file, AVATAR_MAX_PX, AVATAR_QUALITY);
    editProfileAvatarFile = shrunk || file;

    // Local preview from the blob, so the picker feels instant. The real URL
    // only exists after the upload in handleEditProfileSubmit().
    const previewUrl = URL.createObjectURL(editProfileAvatarFile);
    renderEditProfileAvatar(previewUrl);

    // The file input keeps its value, so re-picking the SAME file would not
    // fire `change` again. Reset it.
    event.target.value = '';
}

function removeEditProfileAvatar() {
    editProfileAvatarFile = null;
    editProfileAvatarUrl = null;
    renderEditProfileAvatar(null, document.getElementById('edit-profile-name')?.value);
}

async function handleEditProfileSubmit(e) {
    e.preventDefault();
    setFormMessage('edit-profile', '');
    setFormMessage('edit-profile', '', 'success');

    if (!currentApp) return;

    const displayName = document.getElementById('edit-profile-name')?.value || '';
    const bio = document.getElementById('edit-profile-bio')?.value || '';
    const location = document.getElementById('edit-profile-location')?.value || '';
    const isPublic = !!document.getElementById('edit-profile-public')?.checked;

    setSubmitting('edit-profile-save', true, 'Saving…');

    try {
        let avatarUrl = editProfileAvatarUrl;

        if (editProfileAvatarFile) {
            const session = await SocialAuth.getSession();
            const userId = session?.user?.id;
            if (!userId) throw new Error('Sign in to update your profile');

            // The EXISTING venue-media bucket, under the members/{uid}/ prefix
            // the member storage policy already permits (20260828000002:263-285)
            // and whose mime allowlist already includes image/jpeg. No new
            // bucket, no new policy, no CSP change — netlify.toml:41 already
            // has img-src 'self' data: https: blob:.
            //
            // ⚠️ Deliberately NOT the member-avatars bucket. Its policies are
            // unscoped (database/profile-visits-migration.sql:70-97): any
            // authenticated user can overwrite or delete any other member's
            // avatar there.
            const path = `members/${userId}/avatar-${Date.now()}.jpg`;
            const { error: uploadError } = await supabaseClient.storage
                .from('venue-media')
                .upload(path, editProfileAvatarFile, {
                    cacheControl: MEDIA_CACHE_CONTROL,
                    upsert: false,
                    contentType: 'image/jpeg'
                });

            if (uploadError) throw uploadError;

            avatarUrl = supabaseClient.storage
                .from('venue-media')
                .getPublicUrl(path).data.publicUrl;
        }

        // ⚠️ p_location goes on EVERY save, empty or not. update_social_profile
        // is a full write: omit the argument and its DEFAULT NULL clears the
        // stored value, so "I only changed my bio" would silently erase the
        // member's location.
        const { data, error } = await supabaseClient.rpc('update_social_profile', {
            p_app_id: currentApp.id,
            p_display_name: displayName,
            p_bio: bio,
            p_avatar_url: avatarUrl,
            p_profile_public: isPublic,
            p_location: location
        });

        // ⚠️ Family A: success:false does NOT set `error`. Checking only
        // `error` would show "Saved" over a rejected write.
        const row = Array.isArray(data) ? data[0] : data;
        if (error) throw error;
        if (!row || row.success === false) {
            throw new Error(row?.error_message || 'Could not save your profile');
        }

        editProfileAvatarUrl = avatarUrl;
        editProfileAvatarFile = null;

        await SocialAuth.loadMember({ force: true });
        await renderProfileIdentity();

        // The author name and avatar on every card come from the feed RPC, so
        // the change is only visible after a refetch.
        await loadFeed(false);

        closeEditProfile();
        showToast('Profile updated');
    } catch (err) {
        console.error('Profile save failed:', err);
        setFormMessage('edit-profile', err.message || 'Could not save your profile');
    } finally {
        setSubmitting('edit-profile-save', false);
    }
}

// ===== Tab Navigation =====
// Tabs the category filter actually applies to. Search has its own query and
// Me/Settings have no venue list, so showing the pills there was dead chrome that
// implied a filter which did nothing.
const CATEGORY_TABS = ['feed', 'map'];

function switchTab(tabId) {
    activeTab = tabId;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Show the pills only where they mean something
    updatePillVisibility();

    // Update views
    document.querySelectorAll('.tab-view').forEach(view => {
        view.classList.toggle('active', view.id === `tab-${tabId}`);
    });

    // Initialize or refresh map when switching to map tab
    if (tabId === 'map') {
        requestAnimationFrame(() => {
            if (!map) initMap();
            else map.invalidateSize();
        });
    }

    // The Search tab now opens on the browse list rather than an empty hint.
    if (tabId === 'search') {
        const input = document.getElementById('search-input');
        handleSearch((input?.value || '').trim());
    }

    // Me refetches on every open — the counts and posts are never older than
    // the last time you looked. Leaving it collapses the expanded tile, which
    // drops its <video> rather than leaving it playing behind another tab.
    if (tabId === 'me') {
        loadMeTab();
    } else if (expandedMePostId) {
        expandedMePostId = null;
        renderMeGrid();
    }

    // Chrome hiding is scoped to the feed: #map-container's height subtracts
    // var(--nav-height), so a hidden nav on the map tab would leave a dead
    // strip. Re-run on every tab change so leaving the feed mid-scroll restores
    // the nav rather than stranding it offscreen.
    updateScrollChrome();

    // Leaving Feed gives the back button something to do: return to Feed.
    syncBackGuard();
}

// ===== Scroll chrome =====
// One rAF-throttled window listener. Uses transform, never display: body has
// padding-bottom: calc(var(--nav-height) …), so removing the nav from flow
// would jump the page by the height of the nav on every scroll.
// ⚠️ The feed no longer scrolls on `window`. #feed-container is a fixed-height
// element scroller with scroll-snap, so this listens on the ELEMENT. A
// window-scroll listener here would fire only on the other tabs, and the
// symptom would be "back-to-top never appears" with nothing in the console.
function setupScrollChrome() {
    const container = document.getElementById('feed-container');
    container?.addEventListener('scroll', () => {
        if (scrollChromeTicking) return;
        scrollChromeTicking = true;
        requestAnimationFrame(() => {
            updateScrollChrome();
            scrollChromeTicking = false;
        });
    }, { passive: true });

    document.getElementById('back-to-top')?.addEventListener('click', () => {
        document.getElementById('feed-container')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// The bottom nav is now PINNED on the feed tab, and that is a deliberate
// reversal of the hide-on-scroll behaviour rather than an omission.
//
// Hide-on-scroll was written for a continuously scrolling card list, where the
// nav slid away as you read. In a one-panel-per-swipe feed EVERY gesture is a
// full-viewport scroll, so the nav would slide out and back on every single
// Viibe — read as flicker, not as chrome getting out of the way. The nav also
// no longer costs anything: the scroller is sized to sit above it, so it covers
// nothing.
//
// nav.classList.remove('hidden') is still issued unconditionally, because a
// nav left translated off-screen by an older session's state would otherwise
// stay there for the rest of the visit.
function updateScrollChrome() {
    const nav = document.querySelector('.bottom-nav');
    const backToTop = document.getElementById('back-to-top');
    const container = document.getElementById('feed-container');

    nav?.classList.remove('hidden');

    if (activeTab !== 'feed' || !container) {
        backToTop?.classList.remove('visible');
        lastScrollY = 0;
        return;
    }

    const y = container.scrollTop;
    // One panel is one viewport, so "past the first Viibe" is the honest
    // threshold and it needs no measurement of a child element.
    const threshold = container.clientHeight * 0.6;
    if (backToTop) backToTop.classList.toggle('visible', y > threshold);

    lastScrollY = y;
}

// ===== Filters =====
//
// ONE pill row, two axes. A chip is either a venue category or a music genre,
// and at most one is active at a time — tapping "Techno" clears "Clubs".
//
// That is the cost of a single row and it is deliberate: two stacked sticky
// rows ate roughly 90px of a phone screen before any content appeared, and
// combined filtering ("clubs playing techno") is not what people were reaching
// for. activeCategory and activeGenre both survive as state because the feed
// RPC and the client-side venue filter each take both; setFilter() just
// guarantees only one is ever non-null.

// Which chips to offer, derived from the venues this app actually has.
//
// Rendering all 8 categories and all 19 genres unconditionally meant 25 of 27
// chips returned an empty feed for a tenant with one nightlife venue — a filter
// bar that is mostly dead ends teaches people not to touch it. Admins populate
// this row implicitly, by setting a venue's category and music.
//
// Order is taken from the shared vocabularies, not from the venue data, so the
// row does not reshuffle when a venue is edited.
function availableFilters() {
    const cats = new Set();
    const genres = new Set();

    venues.forEach(v => {
        if (v.category) cats.add(v.category);
        venueGenres(v).forEach(g => genres.add(g));
    });

    // …then reordered so the member's onboarding picks lead their group. The
    // SET of chips is still decided by the venue data — a preference can move a
    // chip forward, never invent one that has no venues behind it.
    return {
        categories: orderByPreference(
            (window.VENUE_CATEGORIES || []).filter(c => cats.has(c.slug)),
            preferredCategories
        ),
        genres: orderByPreference(
            (window.MUSIC_GENRES || []).filter(g => genres.has(g.slug)),
            preferredGenres
        )
    };
}

function renderFilterPills() {
    const container = document.getElementById('filter-pills');
    if (!container) return;

    const { categories, genres } = availableFilters();
    const allActive = !activeCategory && !activeGenre;

    const chip = (kind, value, labelKey, label) => {
        const isActive = kind === 'category'
            ? activeCategory === value
            : activeGenre === value;
        return `
            <button class="pill ${isActive ? 'active' : ''}" role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    data-filter-kind="${kind}" data-filter-value="${escapeHtml(value)}"
                    data-i18n="${labelKey}">${escapeHtml(label)}</button>
        `;
    };

    // The Following chip leads the row, and only exists for a signed-in
    // visitor: it selects a different RPC (get_following_feed), which is
    // authenticated-only, so offering it signed out would be a chip that can
    // only ever return nothing.
    const followingActive = feedMode === 'following';
    const followingChip = currentUserId
        ? `<button class="pill ${followingActive ? 'active' : ''}" role="tab"
                   aria-selected="${followingActive ? 'true' : 'false'}"
                   data-filter-kind="following" data-filter-value="following"
                   data-i18n="social.following">Following</button>`
        : '';

    // Distance leads the row and is deliberately NOT role="tab": it is not one
    // of the mutually exclusive options, it is a scope that combines with them,
    // and it opens a sheet rather than selecting anything. The label carries the
    // current value so the row states the scope without the sheet being open.
    const distanceChip = `
        <button class="pill pill-distance ${feedRadiusMiles !== null ? 'active' : ''}" type="button"
                data-filter-kind="distance" data-filter-value="distance"
                aria-haspopup="dialog">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span>${escapeHtml(radiusChipLabel())}</span>
        </button>
    `;

    container.innerHTML = `
        ${distanceChip}
        ${followingChip}
        <button class="pill ${allActive && !followingActive ? 'active' : ''}" role="tab"
                aria-selected="${allActive && !followingActive ? 'true' : 'false'}"
                data-filter-kind="all" data-filter-value="all"
                data-i18n="social.catAll">All</button>
        ${categories.map(c => chip('category', c.slug, c.labelKey, c.label)).join('')}
        ${genres.length && categories.length
            ? '<span class="pill-divider" aria-hidden="true"></span>' : ''}
        ${genres.map(g => chip('genre', g.slug, g.labelKey, g.label)).join('')}
    `;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }

    pinFilterPills();
}

// The row sticks beneath the header, whose height varies with the safe-area
// inset, so the offset is measured rather than hardcoded.
function pinFilterPills() {
    const header = document.querySelector('.social-header');
    const pills = document.getElementById('filter-pills');
    if (!header || !pills) return;
    pills.style.top = `${header.offsetHeight}px`;
    sizeFeedViewport();
}

// ⚠️ The full-screen feed's height is MEASURED, not computed from constants.
//
// social.css carries a calc() fallback for first paint, and it subtracts a
// hardcoded 56px header + 44px pill row (the same arithmetic #map-container has
// always used). That is wrong the moment anything else lands in normal flow
// above the tab — the location banner, the sample-data notice, the draft
// recovery banner — and the symptom is the body becoming scrollable, which
// un-pins the "fixed" filter row (#4) by exactly the banner's height.
//
// Measuring the tab's own top removes both the constants and the whole class
// of bug.
function sizeFeedViewport() {
    const tab = document.getElementById('tab-feed');
    if (!tab || !tab.classList.contains('active')) return;

    const top = tab.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    const nav = document.querySelector('.bottom-nav');
    const navHeight = nav ? nav.offsetHeight : 0;
    const height = Math.max(240, Math.round(window.innerHeight - top - navHeight));

    // ⚠️ The guard is load-bearing, not an optimisation. Writing this height
    // changes the body's height, which is what a ResizeObserver on the body
    // fires on — an unconditional write is an infinite loop.
    if (Math.abs(parseFloat(tab.style.height) - height) < 1) return;
    tab.style.height = `${height}px`;
}

// Every in-flow notice, every rotation, every wrap of the pill row. Cheaper and
// far more reliable than remembering to re-measure at each of the dozen places
// that can insert or remove a banner.
function watchFeedViewport() {
    if (!window.ResizeObserver) return;
    new ResizeObserver(() => sizeFeedViewport()).observe(document.body);
}

// Called whenever the venue set changes — a venue added from a phone, or an
// admin toggling what a venue plays. Without this the new chip only appears on
// the next full reload.
//
// If the active filter's chip has just disappeared (its last venue changed
// category, say), the filter is cleared rather than left pointing at nothing.
function refreshFilterPills() {
    const { categories, genres } = availableFilters();

    // ⚠️ The Following chip is EXCLUDED from this check. It is not derived from
    // the venue set — it is always offered to a signed-in visitor — so asking
    // "is its chip still in the derived list?" answers no every time, and any
    // venue edit (an owner tapping a genre, a phone adding a venue) would
    // silently kick the user from Following back to All mid-scroll.
    const stillThere = feedMode === 'following'
        ? true
        : activeCategory
            ? categories.some(c => c.slug === activeCategory)
            : activeGenre
                ? genres.some(g => g.slug === activeGenre)
                : true;

    if (!stillThere) {
        activeCategory = null;
        activeGenre = null;
        loadFeed(false);
    }

    renderFilterPills();
}

function setFilter(kind, value) {
    // Distance is not a filter state of this row at all — it opens a sheet and
    // combines with whatever is already selected. Handled first so it can never
    // fall through and clear the active category.
    if (kind === 'distance') {
        openRadiusSheet();
        return;
    }

    // Following is a third state of the same row: it switches which RPC the
    // feed calls, and every other chip switches back. Category and genre still
    // apply on top of it — one shared pill row that stopped working when you
    // moved to Following would read as the filter being broken.
    if (kind === 'following') {
        feedMode = 'following';
        renderFilterPills();
        loadFeed(false);
        return;
    }
    feedMode = 'all';

    // "All" and any no-op value must reach the RPC as SQL NULL, never the
    // literal string — filtering on a value no row has empties the feed
    // silently, which this app has shipped twice already.
    if (kind === 'category') {
        activeCategory = window.normalizeCategory
            ? window.normalizeCategory(value)
            : (value && value !== 'all' ? value : null);
        activeGenre = null;
    } else if (kind === 'genre') {
        activeGenre = window.normalizeGenre
            ? window.normalizeGenre(value)
            : (value && value !== 'all' ? value : null);
        activeCategory = null;
    } else {
        activeCategory = null;
        activeGenre = null;
    }

    renderFilterPills();
    loadFeed(false);
    refreshVenueSurfaces();
}

// ===== Distance (#5) =====
//
// Distance is a SCOPE, not a category. It combines with whatever category or
// genre chip is active rather than replacing it, which is exactly why it is not
// a fourth kind of chip in the single-active row — one row where some chips are
// mutually exclusive and one is not cannot be read at a glance. It gets its own
// chip at the left of the row, and that chip opens a sheet.

const RADIUS_PREF_KEY = 'viibe_feed_radius';
// null = "Any". Also the sheet's row order.
const RADIUS_OPTIONS = [null, 1, 5, 25];

let feedRadiusMiles = null;

// Precedence: this device's last choice, then the tenant's configured default,
// then Any. The device wins because the owner sheet describes its value as
// "just the starting value — anyone can change it for themselves", and a
// default that overrode a deliberate choice on every reload would make that
// false.
//
// ⚠️ '' is the STORED form of "Any" and is not the same as an absent key. A
// truthiness check here would silently re-apply the tenant default to everyone
// who had explicitly chosen Any.
function loadRadiusPreference() {
    let stored = null;
    try {
        stored = localStorage.getItem(RADIUS_PREF_KEY);
    } catch (err) {
        // Storage unavailable; fall through to the tenant default.
    }

    if (stored !== null) {
        const parsed = parseFloat(stored);
        feedRadiusMiles = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        return;
    }

    const configured = parseFloat(appSettings.feed_radius_default);
    feedRadiusMiles = Number.isFinite(configured) && configured > 0 ? configured : null;
}

function writeRadiusPreference() {
    try {
        localStorage.setItem(RADIUS_PREF_KEY, feedRadiusMiles === null ? '' : String(feedRadiusMiles));
    } catch (err) {
        // Best-effort; the session still honours the choice.
    }
}

// I18n.t() returns the KEY when a translation is missing, so every label here
// falls back to written English rather than rendering "social.radiusMiles".
function translateOr(key, params, fallback) {
    const value = window.I18n && typeof window.I18n.t === 'function'
        ? window.I18n.t(key, params)
        : key;
    return value === key ? fallback : value;
}

function radiusOptionLabel(miles) {
    if (miles === null) return translateOr('social.radiusAny', null, 'Any distance');
    if (miles === 1) return translateOr('social.radius1', null, '1 mile');
    return translateOr('social.radiusMiles', { miles }, `${miles} miles`);
}

function radiusChipLabel() {
    if (feedRadiusMiles === null) return translateOr('social.distanceAnyShort', null, 'Any distance');
    return translateOr('social.distanceShort', { miles: feedRadiusMiles }, `${feedRadiusMiles} mi`);
}

function openRadiusSheet() {
    const sheet = document.getElementById('radius-sheet');
    const backdrop = document.getElementById('radius-backdrop');
    if (!sheet || !backdrop) return;

    renderRadiusOptions();
    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('radius');
}

function closeRadiusSheet() {
    document.getElementById('radius-sheet')?.classList.remove('visible');
    document.getElementById('radius-backdrop')?.classList.remove('visible');
    unlockBodyScroll('radius');
}

// ⚠️ With no location fix, every option except "Any" is a filter the server
// will refuse to apply — see migration 20260907000002 §1. Offering them anyway
// and quietly returning an unfiltered feed from a chip that reads "1 mi" is the
// silent-lie failure mode this codebase keeps producing, so the sheet says so
// and offers the permission prompt instead.
function renderRadiusOptions() {
    const body = document.getElementById('radius-body');
    if (!body) return;

    const noFix = !userLocation;
    const check = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const options = RADIUS_OPTIONS.map(value => {
        const active = feedRadiusMiles === value;
        const disabled = noFix && value !== null;
        return `
            <button type="button" class="radius-option${active ? ' active' : ''}"
                    ${disabled ? 'disabled' : ''}
                    data-radius="${value === null ? '' : value}">
                <span>${escapeHtml(radiusOptionLabel(value))}</span>
                ${active ? check : ''}
            </button>
        `;
    }).join('');

    body.innerHTML = noFix
        ? `<p class="radius-note" data-i18n="social.radiusNeedsLocation">Turn on location to filter by distance.</p>
           <button type="button" class="auth-btn auth-btn-ghost" id="radius-enable-location"
                   data-i18n="social.enableLocation">Use my location</button>
           ${options}`
        : options;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Re-asks for the fix. getCurrentCoords() resolves to null on denial AND on
// timeout, so a null answer gets a toast rather than a silent no-op — the user
// tapped a button and is owed a response either way.
async function enableLocationForRadius() {
    const btn = document.getElementById('radius-enable-location');
    if (btn) { btn.disabled = true; btn.textContent = translateOr('social.locating', null, 'Locating…'); }

    const coords = await getCurrentCoords();
    renderRadiusOptions();
    renderFilterPills();

    if (!coords) {
        showToast(translateOr('social.locationBlocked', null,
            'Location is off. Turn it on in your browser settings to filter by distance.'));
    }
}

function setRadius(value) {
    feedRadiusMiles = value;
    writeRadiusPreference();
    closeRadiusSheet();
    renderFilterPills();
    loadFeed(false);
}

// ===== App settings (org members only) =====
//
// ViibeView already carries org-member-only admin in-app on a phone (add a
// venue, venue genres). This is the same place, for the same reason: it keeps
// the change entirely out of the Royalty owner dashboard, where a bug would
// have a much larger blast radius.
//
// The authority is server-side. update_social_app_settings verifies org
// membership and merges an allow-list; hiding this menu item is presentation,
// not a security control.

function openAppSettings() {
    const sheet = document.getElementById('app-settings-sheet');
    const backdrop = document.getElementById('app-settings-backdrop');
    if (!sheet || !backdrop || !isOwner) return;

    const error = document.getElementById('app-settings-error');
    if (error) error.textContent = '';

    // Prefill from the LIVE app row — this is what the RPC merges into.
    selectWithFallback(document.getElementById('setting-post-ttl'), appSettings.post_ttl_hours,
        hours => translateOr('social.ttlHours', { hours }, `${hours} hours`));
    selectWithFallback(document.getElementById('setting-feed-radius'), appSettings.feed_radius_default,
        miles => translateOr('social.radiusMiles', { miles }, `${miles} miles`));

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('app-settings');
}

function closeAppSettings() {
    document.getElementById('app-settings-sheet')?.classList.remove('visible');
    document.getElementById('app-settings-backdrop')?.classList.remove('visible');
    unlockBodyScroll('app-settings');
}

// ⚠️ A stored value that is not one of the presets — written by a future admin
// screen, or by hand in the SQL editor — must NOT silently fall back to the
// first option. `select.value = '3'` against a list with no "3" leaves the
// select on "Never expire", and the next Save would then WRITE that, changing a
// setting nobody touched. Add the missing option instead.
function selectWithFallback(select, value, labelFor) {
    if (!select) return;
    const wanted = (value === null || value === undefined || value === '') ? '' : String(value);
    if (!Array.from(select.options).some(o => o.value === wanted)) {
        const option = document.createElement('option');
        option.value = wanted;
        option.textContent = labelFor(wanted);
        select.appendChild(option);
    }
    select.value = wanted;
}

async function saveAppSettings() {
    const errorEl = document.getElementById('app-settings-error');
    const ttlRaw = document.getElementById('setting-post-ttl')?.value ?? '';
    const radiusRaw = document.getElementById('setting-feed-radius')?.value ?? '';

    // '' is the explicit "no expiry" / "any distance" answer and is sent as JSON
    // null, which the RPC preserves. Omitting the key would mean "leave it
    // alone" and make the two states impossible to tell apart.
    const payload = {
        post_ttl_hours: ttlRaw === '' ? null : Number(ttlRaw),
        feed_radius_default: radiusRaw === '' ? null : Number(radiusRaw)
    };

    if (errorEl) errorEl.textContent = '';
    setSubmitting('app-settings-save', true, translateOr('social.saving', null, 'Saving…'));

    const { data, error } = await supabaseClient.rpc('update_social_app_settings', {
        p_app_id: currentApp.id,
        p_settings: payload
    });

    setSubmitting('app-settings-save', false);

    // ⚠️ BOTH branches. This RPC returns failure in its result row without
    // setting PostgREST's error — the same shape that let submitPost() report
    // success on a post that never landed.
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.success === false) {
        const message = error?.message || row?.error_message
            || translateOr('social.settingsFailed', null, 'Could not save settings');
        if (errorEl) errorEl.textContent = message;
        return;
    }

    // Keep the in-memory copies in step. currentApp.settings is what a re-open
    // of this sheet reads and appSettings is what loadRadiusPreference() reads;
    // leaving either stale means the sheet re-opens showing the value that was
    // just replaced.
    appSettings.post_ttl_hours = payload.post_ttl_hours;
    appSettings.feed_radius_default = payload.feed_radius_default;
    if (currentApp && currentApp.settings) {
        currentApp.settings.post_ttl_hours = payload.post_ttl_hours;
        currentApp.settings.feed_radius_default = payload.feed_radius_default;
    }

    closeAppSettings();
    showToast(translateOr('social.settingsSaved', null, 'Settings saved'));

    // The TTL change is visible immediately rather than on the next reload.
    loadFeed(false);
}

// The three client-side-filtered surfaces. Both pill rows go through here so
// they cannot fall out of step with each other.
function refreshVenueSurfaces() {
    if (!map) return;
    renderMapPins();
    renderPostPins();
    renderVenueSwimLane();
}

// ===== Sound =====
//
// Sound is a preference, not per-video state, and it is remembered per app.
// applySoundState() is the ONLY writer of video.muted outside the observer's
// "left the viewport" branch — muting an offscreen video is housekeeping, not
// a change of preference, so the two must not share a code path.

function loadSoundPreference() {
    try {
        feedSoundOn = localStorage.getItem(`${SOUND_PREF_KEY}_${appSlug}`) === '1';
    } catch {
        feedSoundOn = false;   // private mode; default to muted, like every feed
    }
}

function applySoundState(video) {
    if (!video) return;
    video.muted = !feedSoundOn;
}

function soundIconMarkup() {
    return feedSoundOn
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
}

function refreshSoundButtons() {
    const label = feedSoundOn ? 'Mute' : 'Unmute';
    document.querySelectorAll('.video-sound-btn').forEach(btn => {
        btn.innerHTML = soundIconMarkup();
        btn.setAttribute('aria-label', label);
        btn.classList.toggle('on', feedSoundOn);
    });
}

// Bound inline on the button so the unmute happens inside the user's own click
// handler. iOS Safari blocks play() on an unmuted video with no user gesture,
// and a gesture laundered through a promise or a timeout no longer counts.
function toggleFeedSound(event, btn) {
    if (event) event.stopPropagation();

    feedSoundOn = !feedSoundOn;
    try {
        localStorage.setItem(`${SOUND_PREF_KEY}_${appSlug}`, feedSoundOn ? '1' : '0');
    } catch { /* preference is non-essential */ }

    // Only the video the user is actually looking at gets the new state
    // applied immediately; the rest pick it up when the observer plays them.
    //
    // The button now sits INSIDE .feed-media on every surface (the feed's
    // bottom strip is gone, so it moved onto the video). .feed-panel is still
    // checked first: it is the widest scope on the main feed, and the panel
    // holds exactly one video. .feed-media covers the member list and the
    // expanded grid tile.
    const scope = btn ? (btn.closest('.feed-panel') || btn.closest('.feed-media')) : null;
    const video = scope ? scope.querySelector('video') : null;
    if (video) {
        // Same reason as toggleVideoPlay: on both surfaces a card outside the
        // hydration window holds only data-src, and play() on it rejects.
        // Un-muting a video is an explicit request to hear THIS one.
        ensureVideoSrc(video);
        applySoundState(video);
        if (video.paused) video.play().catch(() => { /* still blocked; play btn stays */ });
    }

    refreshSoundButtons();
}

// ===== Video Handling =====
// Tapping the frame plays/pauses. It does NOT change sound — that used to be
// an unconditional `video.muted = false`, which meant every tap-to-play blared
// audio regardless of what the user had chosen.
function toggleVideoPlay(mediaEl) {
    const video = mediaEl.querySelector('video');
    if (!video) return;

    // ⚠️ On the full-screen feed a video outside the hydration window has no
    // src at all, and play() on a src-less element rejects. Tapping a panel is
    // an explicit request for THIS video, so it gets one regardless of where
    // the observer thinks the window is.
    //
    // The venue page's cards now carry data-src too (renderVenuePageFeed),
    // so this is the tap path for both surfaces, not just the feed.
    ensureVideoSrc(video);

    if (video.paused) {
        // Pause all other videos
        document.querySelectorAll('.feed-media video').forEach(v => {
            if (v !== video) { v.pause(); v.muted = true; }
        });
        applySoundState(video);
        // Rejects when autoplay policy blocks it; this call came from a real
        // tap, so that is not expected here and there is nothing to fall back
        // to now that the button is gone — the frame IS the control.
        video.play().catch(() => {});
    } else {
        video.pause();
    }
}

// ===== Video performance (#9) =====
//
// The old feed rendered every card with a real `src` and preload="metadata":
// twenty metadata round trips per page, and twenty decoders held open, for the
// one video anyone was looking at.
//
// Two changes, and they are complementary rather than alternatives:
//   * preload="none" wherever there is a poster to paint instead;
//   * only the visible panel and its immediate neighbours hold a `src` at all.

// How many panels either side of the visible one keep a real src. 1 is the
// point: the next Viibe must be ready the instant the thumb moves, and nothing
// beyond that should be holding a buffer or a socket.
const VIDEO_HYDRATION_WINDOW = 1;

// ⚠️ preload="none" ONLY when there is a poster to paint in its place. A post
// with thumbnail_url NULL has nothing to show, and a blanket preload="none"
// would paint it as a black rectangle — which is why this is decided per post
// rather than set once on the element.
//
// This used to say no backfill was possible. That is true only FROM THE CLIENT:
// there is no UPDATE policy on storage.objects for `venue-media`, and the
// browser cannot re-derive a poster for a clip it never recorded. It is
// perfectly possible out-of-band — a poster generated with ffmpeg, PUT with the
// service-role key, and PATCHed onto venue_media.thumbnail_url. That is how the
// legacy NULLs were cleared on 2026-09-09.
//
// So this stays per-post anyway: generateThumbnail() is best-effort by design
// (it resolves null rather than failing a post), so a FUTURE post can still
// arrive with thumbnail_url NULL. The condition is about what a given row
// holds, not about an era.
function videoPreloadMode(item) {
    return item.thumbnail_url ? 'none' : 'metadata';
}

// A panel's video carries its URL in data-src and only gains a real src inside
// the hydration window. This is what bounds the cost of a long scroll.
function ensureVideoSrc(video) {
    if (!video || !video.dataset.src) return;
    if (video.getAttribute('src') !== video.dataset.src) {
        video.setAttribute('src', video.dataset.src);
    }
}

// ⚠️ Called directly after every render as well as from the observer. An
// IntersectionObserver that never fires — a hidden tab at first paint, a test
// environment where it is stubbed — would otherwise leave EVERY video without a
// src, and the feed would render as black panels with nothing in the console.
// The synchronous seed around index 0 is the floor under that.
function hydrateVideosAround(index) {
    document.querySelectorAll('#feed-container .feed-panel').forEach((panel, i) => {
        const video = panel.querySelector('video[data-src]');
        if (!video) return;

        if (Math.abs(i - index) <= VIDEO_HYDRATION_WINDOW) {
            ensureVideoSrc(video);
            return;
        }

        if (video.hasAttribute('src')) {
            video.pause();
            video.removeAttribute('src');
            // load() is required, not tidy-up: removeAttribute alone leaves the
            // element holding the decoded resource and its buffer, which is the
            // memory this whole mechanism exists to release.
            video.load();
        }
    });
}

// One observer for the main feed, rebuilt on every render. Rebuilding is fine;
// LEAKING is not — this used to create a new IntersectionObserver per
// renderFeed() and never disconnect the old one, so after five pages of
// infinite scroll five observers were racing to play and pause the same
// elements.
//
// ⚠️ root: container. The feed scrolls on #feed-container now, not on window.
// It observes .feed-panel (not .feed-media) because the panel is the snap unit
// and its index is what the hydration window is measured in.
function setupVideoObserver() {
    if (feedVideoObserver) feedVideoObserver.disconnect();

    const container = document.getElementById('feed-container');
    if (!container) return;

    feedVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const panel = entry.target;
            const video = panel.querySelector('video');

            if (!entry.isIntersecting) {
                if (video) { video.pause(); video.muted = true; }
                return;
            }

            // Recentre the window BEFORE trying to play: on a fast swipe this
            // panel can come into view before it has ever held a src.
            const panels = Array.from(container.querySelectorAll('.feed-panel'));
            hydrateVideosAround(panels.indexOf(panel));

            if (!video) return;
            // applySoundState is the SINGLE writer for muted/volume. Do not add
            // a second path here — see its own comment.
            applySoundState(video);
            // Autoplay blocked leaves the poster frame showing and the panel
            // tappable, which is the whole affordance.
            video.play().catch(() => {});
        });
    }, { root: container, threshold: 0.6 });

    container.querySelectorAll('.feed-panel').forEach(el => feedVideoObserver.observe(el));

    // The floor described above.
    hydrateVideosAround(0);
}

// ===== Infinite Scroll =====
// Observes the #load-more-trigger sentinel that already sat at the bottom of the
// feed unused. Replaces a window scroll listener doing scrollHeight arithmetic —
// the observer fires only when the sentinel is actually near the viewport, so it
// costs nothing while the user is on the Map or Search tabs.
// ⚠️ TWO things changed with the switch to an element scroller, and BOTH are
// silent failures if missed:
//
//   1. `root: container`. With the default viewport root the sentinel sits at
//      the bottom of a scroller whose own box never moves, so it is clipped out
//      of view forever and the callback never fires again after the first page.
//   2. This is called from renderFeed() on EVERY render, because the sentinel
//      is re-created by that render. Hence the disconnect — the old observer
//      would otherwise be left holding a detached node, and after five pages
//      five observers would each fire loadFeed(true) on the same sentinel.
//      That is the exact leak setupVideoObserver() was fixed for.
function setupInfiniteScroll() {
    const container = document.getElementById('feed-container');
    const trigger = document.getElementById('load-more-trigger');
    if (feedScrollObserver) feedScrollObserver.disconnect();
    if (!container || !trigger) return;

    feedScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            if (activeTab !== 'feed' || feedLoading || !feedHasMore) return;
            loadFeed(true);
        });
    }, { root: container, rootMargin: '400px' });

    feedScrollObserver.observe(trigger);
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = e.currentTarget.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    // Filter pills — delegated, because the chips are derived from the venue
    // set and so do not exist when this runs.
    const pillsContainer = document.getElementById('filter-pills');
    if (pillsContainer) {
        pillsContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.pill');
            if (pill) setFilter(pill.dataset.filterKind, pill.dataset.filterValue);
        });
    }

    // Distance sheet. Delegated on the body, which is re-rendered on every open
    // and whenever the location fix changes.
    document.getElementById('radius-close')?.addEventListener('click', closeRadiusSheet);
    document.getElementById('radius-backdrop')?.addEventListener('click', closeRadiusSheet);
    document.getElementById('radius-body')?.addEventListener('click', (e) => {
        if (e.target.closest('#radius-enable-location')) {
            enableLocationForRadius();
            return;
        }
        const option = e.target.closest('.radius-option');
        if (!option || option.disabled) return;
        // '' is the DOM spelling of "Any" — an empty data-radius must become
        // null, not NaN, or the chip label and the RPC argument both break.
        const raw = option.dataset.radius;
        setRadius(raw === '' ? null : parseFloat(raw));
    });

    // App settings (org members only; the button is hidden for everyone else
    // and update_social_app_settings re-checks membership server-side).
    document.getElementById('app-settings-btn')?.addEventListener('click', openAppSettings);
    document.getElementById('app-settings-close')?.addEventListener('click', closeAppSettings);
    document.getElementById('app-settings-backdrop')?.addEventListener('click', closeAppSettings);
    document.getElementById('app-settings-save')?.addEventListener('click', saveAppSettings);

    // Search scope: Venues | Members
    document.getElementById('search-scope')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.search-scope-btn');
        if (btn) setSearchScope(btn.dataset.scope);
    });

    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => handleSearch(e.target.value.trim()), 300);
        });
    }

    // Map search input + its clear button (the button shipped with no handler
    // and was permanently display:none, so it could never be used)
    const mapSearchInput = document.getElementById('map-search-input');
    const mapSearchClear = document.getElementById('map-search-clear');
    if (mapSearchInput) {
        mapSearchInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            if (mapSearchClear) mapSearchClear.style.display = value ? '' : 'none';
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => handleMapSearch(value), 300);
        });
    }
    if (mapSearchClear) {
        mapSearchClear.addEventListener('click', () => {
            if (mapSearchInput) mapSearchInput.value = '';
            mapSearchClear.style.display = 'none';
            const dropdown = document.getElementById('map-search-results');
            if (dropdown) dropdown.classList.remove('visible');
            if (mapSearchInput) mapSearchInput.focus();
        });
    }

    // Recent searches: clear all
    const recentsClear = document.getElementById('recent-searches-clear');
    if (recentsClear) {
        recentsClear.addEventListener('click', clearRecentSearches);
    }

    // Log out — the button existed but was bound to nothing at all
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Center on me button
    const centerBtn = document.getElementById('center-on-me-btn');
    if (centerBtn) {
        centerBtn.addEventListener('click', centerOnMe);
    }

    // Venue page back + backdrop
    const venuePageBack = document.getElementById('venue-page-back');
    if (venuePageBack) {
        venuePageBack.addEventListener('click', closeVenuePage);
    }
    const venuePageBackdrop = document.getElementById('venue-page-backdrop');
    if (venuePageBackdrop) {
        venuePageBackdrop.addEventListener('click', closeVenuePage);
    }

    // Create post button + modal.
    // Wrapped, not passed by reference: addEventListener hands the handler a
    // MouseEvent, which openCreatePost(venueId) would have taken as a venue id.
    const postBtn = document.querySelector('.post-btn');
    if (postBtn) {
        postBtn.addEventListener('click', () => openCreatePost());
    }

    // The "+" in the venue page header attaches that venue. Same handler the
    // old "Post here" button had; it just lives in the corner now, matching the
    // main header, instead of below the fold next to "Recent Posts".
    const venuePostBtn = document.getElementById('venue-page-post-btn');
    if (venuePostBtn) {
        venuePostBtn.addEventListener('click', () => openCreatePost(venuePageVenueId));
    }

    // Venue page: flyer picker (the button is rendered by openVenuePage)
    document.getElementById('venue-flyer-input')?.addEventListener('change', handleFlyerPick);

    // Member profile overlay
    document.getElementById('member-page-back')?.addEventListener('click', closeMemberProfile);
    document.getElementById('member-page-backdrop')?.addEventListener('click', closeMemberProfile);

    // People sheet (followers / following / discover)
    document.getElementById('people-sheet-close')?.addEventListener('click', closePeopleSheet);
    document.getElementById('people-backdrop')?.addEventListener('click', closePeopleSheet);
    document.getElementById('people-sheet-search')?.addEventListener('input', () => {
        // Debounced: unlike the venue picker this one hits the database on
        // every keystroke (discover_members runs a server-side ILIKE).
        clearTimeout(peopleSearchTimeout);
        peopleSearchTimeout = setTimeout(loadPeople, 300);
    });

    // Settings + Me tab entry points. Followers/Following live on the Me tab
    // now, painted by memberStatsMarkup() with their own inline handlers.
    document.getElementById('edit-profile-btn')?.addEventListener('click', openEditProfile);
    document.getElementById('me-edit-profile-btn')?.addEventListener('click', openEditProfile);

    // Edit profile sheet
    document.getElementById('edit-profile-close')?.addEventListener('click', closeEditProfile);
    document.getElementById('edit-profile-backdrop')?.addEventListener('click', closeEditProfile);
    document.getElementById('edit-profile-form')?.addEventListener('submit', handleEditProfileSubmit);
    document.getElementById('edit-profile-avatar-input')?.addEventListener('change', handleAvatarPick);
    document.getElementById('edit-profile-avatar-remove')?.addEventListener('click', removeEditProfileAvatar);
    document.getElementById('edit-profile-bio')?.addEventListener('input', updateBioCount);

    // Post options sheet
    document.getElementById('post-options-close')?.addEventListener('click', closePostOptions);
    document.getElementById('post-options-backdrop')?.addEventListener('click', closePostOptions);

    // Post preview (map pin)
    document.getElementById('post-preview-close')?.addEventListener('click', closePostPreview);
    document.getElementById('post-preview-backdrop')?.addEventListener('click', closePostPreview);

    const postBackdrop = document.getElementById('create-post-backdrop');
    if (postBackdrop) {
        postBackdrop.addEventListener('click', closeCreatePost);
    }

    const postCancelBtn = document.getElementById('create-post-cancel');
    if (postCancelBtn) {
        postCancelBtn.addEventListener('click', closeCreatePost);
    }

    const postSubmitBtn = document.getElementById('create-post-submit');
    if (postSubmitBtn) {
        postSubmitBtn.addEventListener('click', submitPost);
    }

    // Camera: tap placeholder to start camera
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    if (uploadPlaceholder) {
        uploadPlaceholder.addEventListener('click', (e) => {
            e.stopPropagation();
            startCamera();
        });
    }

    // Record button: tap to start/stop recording
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) {
        recordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }

    // Retake button
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) {
        retakeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retakeRecording();
        });
    }

    const captionInput = document.getElementById('post-caption');
    if (captionInput) {
        captionInput.addEventListener('input', () => {
            const countEl = document.getElementById('caption-count');
            if (countEl) countEl.textContent = captionInput.value.length;
        });
    }

    // Composer venue picker
    document.getElementById('create-post-venue')?.addEventListener('click', openVenuePicker);
    document.getElementById('venue-picker-close')?.addEventListener('click', closeVenuePicker);
    document.getElementById('venue-picker-backdrop')?.addEventListener('click', closeVenuePicker);

    const pickerFilter = document.getElementById('venue-picker-filter');
    if (pickerFilter) {
        // No debounce: this filters an in-memory array, it does not hit the
        // network. Debouncing would only add latency to typing.
        pickerFilter.addEventListener('input', (e) => {
            venuePickerQuery = e.target.value;
            renderVenuePickerList();
        });
    }

    // Add a venue (org members only — the buttons are hidden otherwise, and
    // openAddVenue() re-checks isOwner rather than trusting the DOM).
    ['add-venue-btn', 'search-add-venue-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', openAddVenue);
    });
    document.getElementById('add-venue-close')?.addEventListener('click', closeAddVenue);
    document.getElementById('add-venue-backdrop')?.addEventListener('click', closeAddVenue);
    document.getElementById('add-venue-back')?.addEventListener('click', () => showAddVenueStep('search'));
    document.getElementById('add-venue-save')?.addEventListener('click', saveNewVenue);
    document.getElementById('add-venue-manual-btn')?.addEventListener('click', startManualVenue);
    document.getElementById('add-venue-geocode-btn')?.addEventListener('click', geocodeVenueAddress);

    const placeInput = document.getElementById('place-search-input');
    if (placeInput) {
        // Debounced hard, and longer than the 300ms used elsewhere: every
        // keystroke that gets through is a request to a third party that
        // allows roughly one per second.
        placeInput.addEventListener('input', (e) => {
            clearTimeout(placeSearchTimeout);
            const value = e.target.value;
            placeSearchTimeout = setTimeout(() => runPlaceSearch(value), 600);
        });
        // Enter searches immediately — waiting out a debounce after an
        // explicit submit reads as the app ignoring you.
        placeInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(placeSearchTimeout);
            runPlaceSearch(e.target.value);
        });
    }

    // Infinite scroll is now (re)wired by renderFeed(), which owns the sentinel.
    // Kept here for the cold-start case where init()'s first loadFeed() resolved
    // before this ran, so that render's setupInfiniteScroll() found no listener
    // ordering problem — and for the empty-feed case, where renderFeed() returns
    // early and there is nothing to observe. Both are no-ops when the sentinel
    // is absent.
    setupInfiniteScroll();

    // Back-to-top, and the nav's pinned state. Listens on #feed-container.
    setupScrollChrome();

    // Keeps the snap scroller exactly the height of what is left of the
    // viewport, whatever else is in flow above it.
    watchFeedViewport();
    sizeFeedViewport();

    // Add to Home Screen, and the signup prompt that shares its slot
    setupInstallPrompt();
    setupSignupPrompt();

    // Upright-only recording.
    watchComposerOrientation();

    // Re-measure the sticky offsets when the header or the pill rows can change
    // height. Both rows wrap, so a rotation changes the genre row's offset.
    window.addEventListener('resize', pinFilterPills);
    window.addEventListener('orientationchange', pinFilterPills);
}

function handleMapSearch(query) {
    const dropdown = document.getElementById('map-search-results');
    if (!dropdown) return;

    if (!query || query.length < 2) {
        dropdown.classList.remove('visible');
        return;
    }

    const q = query.toLowerCase();
    const results = venues.filter(v => matchesQuery(v, q)).slice(0, 5);

    if (results.length === 0) {
        dropdown.innerHTML = '<div class="map-search-empty">No venues found</div>';
        dropdown.classList.add('visible');
        return;
    }

    dropdown.innerHTML = results.map(v => `
        <div class="map-search-result" onclick="goToVenueOnMap('${v.id}'); document.getElementById('map-search-results').classList.remove('visible');">
            <span class="map-search-name">${escapeHtml(v.name)}</span>
            <span class="map-search-category">${escapeHtml(categoryLabel(v.category))}</span>
        </div>
    `).join('');

    dropdown.classList.add('visible');
}

// ===== Post options (3-dots) =====
//
// This replaces showVenueOptions(), which was a two-line alias for
// openVenuePage() with no menu behind it — the 3-dots button looked like a menu
// and opened a venue page, which is why Jay reported it as "does nothing".

// The sheet is opened from three different lists, so the post is resolved from
// whichever one has it.
function findPostById(mediaId) {
    return feedItems.find(i => i.id === mediaId)
        || venuePageFeed.find(i => i.id === mediaId)
        || postPins.find(i => i.id === mediaId)
        || memberPagePosts.find(i => i.id === mediaId)
        || mePosts.find(i => i.id === mediaId)
        || null;
}

function showPostOptions(mediaId) {
    const sheet = document.getElementById('post-options-sheet');
    const backdrop = document.getElementById('post-options-backdrop');
    const body = document.getElementById('post-options-body');
    if (!sheet || !backdrop || !body) return;

    optionsMediaId = mediaId;
    renderPostOptionsMain();

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('post-options');
}

function closePostOptions() {
    document.getElementById('post-options-sheet')?.classList.remove('visible');
    document.getElementById('post-options-backdrop')?.classList.remove('visible');
    unlockBodyScroll('post-options');
    optionsMediaId = null;
}

function renderPostOptionsMain() {
    const body = document.getElementById('post-options-body');
    if (!body) return;

    const item = findPostById(optionsMediaId);

    // ⚠️ Every post that predates this release has uploaded_by_user_id = NULL —
    // the column has never been written. So for members, all pre-existing posts
    // (including Jay's test post) offer Report only; the isOwner branch is what
    // still lets Jay delete his own. No backfill is possible: the authorship was
    // never recorded, and guessing it would be worse than admitting it.
    //
    // An owner of the post's venue may delete it too (venue_owners).
    const canDelete = isOwner ||
        (!!currentUserId && !!item && item.uploaded_by_user_id === currentUserId) ||
        (!!item && !!item.venue_id && ownedVenueIds.has(item.venue_id));

    body.innerHTML = `
        ${canDelete ? `
            <button class="post-option post-option-danger" type="button" onclick="confirmDeletePost()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span data-i18n="social.deletePost">Delete post</span>
            </button>
        ` : `
            <button class="post-option" type="button" onclick="renderPostOptionsReasons()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                <span data-i18n="social.reportPost">Report post</span>
            </button>
        `}
        <button class="post-option post-option-cancel" type="button" onclick="closePostOptions()">
            <span data-i18n="social.cancel">Cancel</span>
        </button>
    `;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function renderPostOptionsReasons() {
    const body = document.getElementById('post-options-body');
    if (!body) return;

    body.innerHTML = `
        <p class="post-options-blurb" data-i18n="social.reportBlurb">What is wrong with this post?</p>
        ${REPORT_REASONS.map(r => `
            <button class="post-option" type="button" onclick="submitReport('${r.value}')">
                <span data-i18n="${r.key}">${escapeHtml(r.label)}</span>
            </button>
        `).join('')}
        <button class="post-option post-option-cancel" type="button" onclick="renderPostOptionsMain()">
            <span data-i18n="social.cancel">Cancel</span>
        </button>
    `;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function confirmDeletePost() {
    const mediaId = optionsMediaId;
    closePostOptions();

    showConfirm({
        title: 'Delete this post?',
        body: 'This removes the video permanently. It cannot be undone.',
        acceptLabel: 'Delete',
        onAccept: () => deletePost(mediaId)
    });
}

async function deletePost(mediaId) {
    if (!mediaId) return;

    const result = await requestPostDelete(mediaId);
    if (!result.ok) {
        showToast(result.message || 'Could not delete that post');
        return;
    }

    removePostEverywhere(mediaId);
    showToast('Post deleted');
}

/**
 * Deletes through the delete-social-post edge function, which authorizes and
 * deletes the row AS THE CALLER (delete_social_post) and then removes the files
 * through the Storage API. The RPC alone can no longer touch storage — Supabase
 * refuses a direct DELETE on its tables, and that refusal was rolling every
 * delete back (Jay's 403, 2026-10-06).
 *
 * Falls back to the RPC on a 404, i.e. the function is not deployed yet. That
 * deletes the row and leaves the files, which is still the fix for the user.
 */
async function requestPostDelete(mediaId) {
    const session = await SocialAuth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, message: 'You must be signed in' };

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-social-post`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ media_id: mediaId })
        });

        if (res.status !== 404) {
            const body = await res.json().catch(() => ({}));
            return (res.ok && body.success !== false)
                ? { ok: true }
                : { ok: false, message: body.error };
        }
    } catch (err) {
        return { ok: false, message: 'Could not reach the server. Try again.' };
    }

    const { data, error } = await supabaseClient.rpc('delete_social_post', {
        p_media_id: mediaId
    });

    // A SECURITY DEFINER function that returns success:false does NOT set
    // `error`. Checking only `error` here would report "Post deleted" over a
    // rejected delete and leave the card on screen until the next reload.
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.success === false) {
        return { ok: false, message: row?.error_message || error?.message };
    }
    return { ok: true };
}

// Drop it from every list that could still be showing it, rather than
// refetching — the feed is paginated and a reload would jump the scroll
// position back to the top. Five lists, and a post count on each profile that
// held it.
function removePostEverywhere(mediaId) {
    const inMember = memberPagePosts.some(i => i.id === mediaId);
    const inMe = mePosts.some(i => i.id === mediaId);

    feedItems = feedItems.filter(i => i.id !== mediaId);
    venuePageFeed = venuePageFeed.filter(i => i.id !== mediaId);
    postPins = postPins.filter(i => i.id !== mediaId);
    memberPagePosts = memberPagePosts.filter(i => i.id !== mediaId);
    mePosts = mePosts.filter(i => i.id !== mediaId);

    if (inMember && memberPageProfile) {
        memberPageProfile.post_count = Math.max(0, (Number(memberPageProfile.post_count) || 0) - 1);
        renderMemberStats();
    }
    if (inMe && meProfile) {
        meProfile.post_count = Math.max(0, (Number(meProfile.post_count) || 0) - 1);
    }
    if (expandedVenuePostId === mediaId) expandedVenuePostId = null;
    if (expandedMePostId === mediaId) expandedMePostId = null;

    renderFeed();
    if (venuePageVenueId) renderVenuePageGrid();
    if (map) renderPostPins();
    if (memberPageUserId) renderMemberList();
    renderMeStats();
    renderMeGrid();
}

async function submitReport(reason) {
    const mediaId = optionsMediaId;
    closePostOptions();
    if (!mediaId || !currentApp) return;

    // A signed-in reporter is recorded; a signed-out one is not. Reporting bad
    // content must never require an account, so the anon key is a valid bearer
    // here — report-content resolves identity only when the token is a real
    // user's.
    const session = await SocialAuth.getSession();
    const bearer = session?.access_token || SUPABASE_ANON_KEY;

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/report-content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${bearer}`
            },
            body: JSON.stringify({
                app_id: currentApp.id,
                media_id: mediaId,
                reason
            })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Could not send your report');
        }

        showToast('Thanks, we will review this.');
    } catch (err) {
        showToast(err.message || 'Could not send your report. Try again.');
    }
}

// ===== Utility Functions =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function calcDistance(lat1, lon1, lat2, lon2) {
    // Haversine formula — returns distance in miles
    //
    // ⚠️ Number.isFinite over the COERCED values, not a truthiness test. The
    // old guard was `if (!lat1 || !lon1 || !lat2 || !lon2) return null`, which
    // had two failure modes, both silent:
    //
    //   - longitude 0 is the prime meridian, which runs through London. A
    //     venue there returned "no distance" forever.
    //   - venues.latitude/longitude are DECIMAL, which PostgREST returns as
    //     STRINGS on some paths. "0" is truthy, so that one slipped through —
    //     but the arithmetic below then ran on strings, and (lat2 - lat1) on
    //     two strings coerces fine while Math.cos(lat1 * Math.PI / 180) does
    //     too. It worked by accident; it is now explicit.
    //
    // Fixing it here also corrects the venue-page distance line, the swim
    // lane, the search results and the per-result distance in runPlaceSearch —
    // every caller reads this one function.
    // ⚠️ REJECT null/undefined/'' BEFORE coercing. Number(null) is 0 and
    // Number('') is 0 — both perfectly finite — so a bare
    // `Number.isFinite(Number(x))` turns a genuinely missing coordinate into
    // the equator and happily returns a distance to it. That is a worse bug
    // than the truthiness check this replaced, because it is confidently
    // wrong rather than silently absent.
    const coord = v => {
        if (v === null || v === undefined || v === '') return NaN;
        return Number(v);
    };
    const a1 = coord(lat1), o1 = coord(lon1);
    const a2 = coord(lat2), o2 = coord(lon2);
    if (!Number.isFinite(a1) || !Number.isFinite(o1)
        || !Number.isFinite(a2) || !Number.isFinite(o2)) return null;
    lat1 = a1; lon1 = o1; lat2 = a2; lon2 = o2;

    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function formatTime(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return m ? `${hour12}:${m.toString().padStart(2, '0')} ${ampm}` : `${hour12} ${ampm}`;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    let html = '';
    for (let i = 0; i < full; i++) html += '<span class="star full">&#9733;</span>';
    if (half) html += '<span class="star half">&#9733;</span>';
    for (let i = 0; i < empty; i++) html += '<span class="star empty">&#9734;</span>';
    return html;
}

function showEmptyState(msg) {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Outfit,sans-serif;color:#64748b;">
            <div style="text-align:center;padding:20px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px;display:block;color:#94a3b8;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
                <p>${msg}</p>
            </div>
        </div>
    `;
}

// ===== Create Post =====

// getOrCreateDefaultVenue() and findAnyOwnedVenue() used to live here.
//
// They existed because venue_media.venue_id was NOT NULL, so every owner post
// needed *some* venue and the composer invented one named "General" — which is
// why the feed showed "General / General" linking to a venue nobody created on
// purpose. venue_id has been nullable since 20260828000001, and the composer
// now has an explicit venue picker, so both the invention and the fallback are
// gone. Owners choose a venue the same way everyone else does.

// requestLocation() runs at startup and is fire-and-forget, so userLocation is
// null both when permission was refused AND when the prompt is still open.
// Re-ask here rather than treating those as the same thing.
function getCurrentCoords() {
    if (userLocation) return Promise.resolve(userLocation);
    if (!navigator.geolocation) return Promise.resolve(null);

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                resolve(userLocation);
            },
            (err) => {
                console.warn('Geolocation unavailable for post:', err.message);
                resolve(null);
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    });
}

// The composer's opening venue selection, recomputed on EVERY openCreatePost()
// call rather than remembered — someone who posts from one bar and walks to the
// next must not get the first bar preselected an hour later.
//
//   opened from a venue page  -> that venue, preselected and changeable
//   otherwise, location known -> the nearest real venue
//   otherwise                 -> no venue; the picker opens sorted by name
//
// Uses the CACHED userLocation and deliberately does not re-prompt: opening the
// composer must not block for up to 10 seconds behind a permission dialog.
// submitPost() still calls getCurrentCoords() for the post's own fix, which is
// the place where waiting is justified.
function defaultComposerVenueId(explicitVenueId) {
    if (explicitVenueId) return explicitVenueId;
    if (!userLocation) return null;

    const candidates = realVenues().filter(v => v.latitude && v.longitude);
    if (candidates.length === 0) return null;

    let best = null;
    let bestDistance = Infinity;
    candidates.forEach(v => {
        const d = calcDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude);
        if (d !== null && d < bestDistance) {
            bestDistance = d;
            best = v;
        }
    });

    // ⚠️ "Nearest" is only a useful default if it is actually near. Without the
    // radius check, someone opening the composer in another city gets the
    // closest venue in the app PRESELECTED — so a post they never meant to
    // attach lands on a venue they have never been to, and inflates that
    // venue's "here tonight" count with a person who is 400 miles away.
    // Beyond the radius the composer defaults to no venue; every venue is
    // still one tap away in the picker.
    return best && bestDistance <= NEAREST_VENUE_RADIUS_MILES ? best.id : null;
}

/**
 * @param venueId  attach the post to this venue (from a venue page's "Post
 *                 here"), or omit to let the picker default to the nearest
 *                 one. Either way the selection is changeable, and "Don't
 *                 attach a venue" is always available — an unattached Viibe is
 *                 credited to its author and is a supported outcome.
 *                 There is no owner-only gate: any signed-in member can post,
 *                 and create_social_post re-checks membership server-side.
 */
async function openCreatePost(venueId) {
    const targetVenueId = venueId || null;

    // Signed-out visitors get the signup prompt, then the composer opens by
    // itself — the intent is remembered, the recording is not. Holding a
    // recording across an email-confirmation redirect is not possible, so the
    // composer deliberately reopens empty.
    if (!(await requireAccount('Create an account to post a Viibe', { pendingVenueId: targetVenueId }))) return;

    composerVenueId = defaultComposerVenueId(targetVenueId);
    venuePickerQuery = '';

    const modal = document.getElementById('create-post-modal');
    const backdrop = document.getElementById('create-post-backdrop');
    if (!modal || !backdrop) return;

    // Reset state
    selectedPostFile = null;
    recordedChunks = [];
    recordedDurationSeconds = null;
    stopCountdownUi();
    const caption = document.getElementById('post-caption');
    if (caption) caption.value = '';
    const countEl = document.getElementById('caption-count');
    if (countEl) countEl.textContent = '0';
    const preview = document.getElementById('upload-preview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    // ⚠️ Phones only, decided AFTER requireAccount — a desktop visitor still
    // gets the account prompt first, so "post" leads somewhere, and then this
    // panel instead of a camera. startCamera() re-checks, so nothing else can
    // reach getUserMedia on a desktop.
    const isPhone = isPhoneDevice();
    const placeholder = document.getElementById('upload-placeholder');
    if (placeholder) placeholder.style.display = isPhone ? 'flex' : 'none';
    const desktopBlock = document.getElementById('upload-desktop-block');
    if (desktopBlock) desktopBlock.style.display = isPhone ? 'none' : 'flex';
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.style.display = 'none';
    const controls = document.getElementById('recording-controls');
    if (controls) controls.style.display = 'none';
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'none';
    const uploadArea = document.getElementById('create-post-upload');
    if (uploadArea) uploadArea.classList.remove('camera-active');
    const submitBtn = document.getElementById('create-post-submit');
    if (submitBtn) submitBtn.disabled = true;
    const progress = document.getElementById('create-post-progress');
    if (progress) progress.style.display = 'none';
    const timer = document.getElementById('recording-timer');
    if (timer) { timer.textContent = '0:00'; timer.classList.remove('active'); }
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.remove('recording');

    renderComposerVenueRow();

    modal.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('create-post');

    applyComposerOrientation();
}

// The composer's venue row. ALWAYS visible now, and always a button.
//
// It used to be a read-only label, hidden entirely when composerVenueId was
// null — so a post made from the header + button had no way to name where it
// was, and there was no venue selector anywhere in the composer at all.
function renderComposerVenueRow() {
    const row = document.getElementById('create-post-venue');
    if (!row) return;

    const label = composerVenueId
        ? `<span data-i18n="social.postingTo">Posting to</span> <strong>${escapeHtml(composerVenueName())}</strong>`
        : `<span data-i18n="social.noVenueSelected">No venue &mdash; posting as yourself</span>`;

    row.innerHTML = `
        <span class="create-post-venue-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
        </span>
        <span class="create-post-venue-label">${label}</span>
        <span class="create-post-venue-change" data-i18n="social.change">Change</span>
    `;
    row.style.display = '';

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// `venues` is get_venues_for_map()'s output, which drops anything without
// coordinates — so a venue page can be open for a venue that is not in it. The
// page's own title is the authoritative name in that case.
function composerVenueName() {
    const venue = getVenueById(composerVenueId);
    if (venue?.name) return venue.name;
    if (composerVenueId && composerVenueId === venuePageVenueId) {
        return document.getElementById('venue-page-title')?.textContent || 'this venue';
    }
    return 'this venue';
}

// ===== Venue picker sheet =====

function openVenuePicker() {
    const sheet = document.getElementById('venue-picker-sheet');
    const backdrop = document.getElementById('venue-picker-backdrop');
    if (!sheet || !backdrop) return;

    const filter = document.getElementById('venue-picker-filter');
    if (filter) filter.value = venuePickerQuery;

    renderVenuePickerList();

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
}

function closeVenuePicker() {
    document.getElementById('venue-picker-sheet')?.classList.remove('visible');
    document.getElementById('venue-picker-backdrop')?.classList.remove('visible');
    // Deliberately NOT restoring body overflow: the composer is still open
    // underneath and owns it. Clearing it here would let the page behind the
    // composer scroll.
}

// Nearest-first when we know where the user is, alphabetical when we do not.
// Demo venues are excluded outright — see isDemoVenueId.
function pickableVenues() {
    const q = venuePickerQuery.trim().toLowerCase();
    const list = realVenues().filter(v => !q || matchesQuery(v, q));

    if (!userLocation) {
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return list
        .map(v => ({
            venue: v,
            distance: v.latitude && v.longitude
                ? calcDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude)
                : null
        }))
        // A venue with no coordinates sorts last rather than first, which is
        // what `null` would do in a naive numeric comparison.
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
        .map(entry => entry.venue);
}

function renderVenuePickerList() {
    const list = document.getElementById('venue-picker-list');
    if (!list) return;

    const options = pickableVenues();

    // "Don't attach a venue" is a first-class choice, not an escape hatch, so
    // it sits at the top of the list and is styled like the other rows.
    const noVenueRow = `
        <button class="venue-picker-row ${composerVenueId ? '' : 'selected'}" type="button"
                onclick="selectComposerVenue(null)">
            <span class="venue-picker-row-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
            </span>
            <span class="venue-picker-row-body">
                <span class="venue-picker-row-name" data-i18n="social.noVenue">Don't attach a venue</span>
                <span class="venue-picker-row-meta" data-i18n="social.noVenueHint">Posted as yourself</span>
            </span>
        </button>
    `;

    const rows = options.map(venue => {
        const distance = userLocation && venue.latitude && venue.longitude
            ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
            : null;
        const meta = [
            categoryLabel(venue.category),
            distance !== null ? `${distance.toFixed(1)} mi` : ''
        ].filter(Boolean).join(' · ');

        return `
            <button class="venue-picker-row ${venue.id === composerVenueId ? 'selected' : ''}" type="button"
                    onclick="selectComposerVenue('${escapeHtml(venue.id)}')">
                <span class="venue-picker-row-icon" aria-hidden="true">
                    ${venue.profile_image_url
                        ? `<img src="${escapeHtml(venue.profile_image_url)}" alt="">`
                        : escapeHtml((venue.name || '?')[0].toUpperCase())}
                </span>
                <span class="venue-picker-row-body">
                    <span class="venue-picker-row-name">${escapeHtml(venue.name)}</span>
                    <span class="venue-picker-row-meta">${escapeHtml(meta)}</span>
                    ${genreChipsMarkup(venue, 2)}
                </span>
                ${hereNowBadge(venue)}
            </button>
        `;
    }).join('');

    // An app with no real venues is a real state — ViibeView had exactly one
    // for months — and the picker has to say so rather than render an empty box.
    const emptyNote = options.length === 0
        ? `<p class="venue-picker-empty" data-i18n="${venuePickerQuery ? 'social.noVenuesMatch' : 'social.noVenuesYet'}">${
              venuePickerQuery ? 'No venues match that' : 'No venues have been added yet'
          }</p>`
        : '';

    list.innerHTML = noVenueRow + rows + emptyNote;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function selectComposerVenue(venueId) {
    composerVenueId = venueId || null;
    renderComposerVenueRow();
    closeVenuePicker();
}

// ===== Add a venue, from a phone (org members only) =====
//
// Why there is no Maps API here: the app is already Leaflet + raw OpenStreetMap
// tiles, and netlify.toml's connect-src already whitelists BOTH
// tile.openstreetmap.org and nominatim.openstreetmap.org. Nominatim's /search
// returns OSM POIs — bars, nightclubs and restaurants come back with a name, a
// structured address and coordinates. That is the whole "search maps, get a
// list, pick one" flow with zero new infrastructure and no key to leak.
//
// Google Places has better POI coverage but needs a key that must never reach
// the client, which would mean a new edge-function proxy. searchPlaces() in
// /js/venue-places.js is the single seam where that swap would happen, so it
// stays a one-file change if OSM coverage disappoints. Not built now.

function openAddVenue() {
    if (!isOwner) return;   // presentation guard; RLS is the real one

    const sheet = document.getElementById('add-venue-sheet');
    const backdrop = document.getElementById('add-venue-backdrop');
    if (!sheet || !backdrop) return;

    placeResults = [];
    pendingPlace = null;
    pendingPlaceGenres = [];
    coordlessSaveConfirmed = false;

    const input = document.getElementById('place-search-input');
    if (input) input.value = '';
    const results = document.getElementById('place-results');
    if (results) results.innerHTML = '';
    document.getElementById('add-venue-manual-btn')?.classList.remove('is-prominent');
    setFormMessage('add-venue', '');

    showAddVenueStep('search');

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    lockBodyScroll('add-venue');

    if (input && !('ontouchstart' in window)) setTimeout(() => input.focus(), 50);
}

function closeAddVenue() {
    document.getElementById('add-venue-sheet')?.classList.remove('visible');
    document.getElementById('add-venue-backdrop')?.classList.remove('visible');
    unlockBodyScroll('add-venue');
    pendingPlace = null;
}

function showAddVenueStep(step) {
    const search = document.getElementById('add-venue-step-search');
    const confirm = document.getElementById('add-venue-step-confirm');
    if (search) search.style.display = step === 'search' ? '' : 'none';
    if (confirm) confirm.style.display = step === 'confirm' ? '' : 'none';
}

async function runPlaceSearch(query) {
    const container = document.getElementById('place-results');
    if (!container) return;

    if (!query || query.trim().length < 2) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `<p class="place-results-status" data-i18n="social.searchingPlaces">Searching…</p>`;
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }

    // Biased around the user when we have a fix, but NOT bounded to it — an
    // owner in Perpignan adding their second venue in Barcelona must still
    // find it. See searchPlaces()'s viewbox handling.
    placeResults = await window.VenuePlaces.searchPlaces(query, { near: userLocation });

    if (placeResults.length === 0) {
        container.innerHTML = `<p class="place-results-status" data-i18n="social.noPlacesFound">Nothing found. Try the street name too.</p>`;
        // The dead end this phase exists to remove. The manual button is always
        // there; a zero-result search is the moment it stops being a quiet link
        // and becomes the primary action.
        document.getElementById('add-venue-manual-btn')?.classList.add('is-prominent');
        if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
            window.I18n.applyTranslations();
        }
        return;
    }

    document.getElementById('add-venue-manual-btn')?.classList.remove('is-prominent');

    container.innerHTML = placeResults.map((place, i) => {
        const distance = userLocation
            ? calcDistance(userLocation.lat, userLocation.lng, place.lat, place.lng)
            : null;
        const where = [place.address_line1, place.city, place.country].filter(Boolean).join(', ');

        return `
            <button class="place-result" type="button" onclick="choosePlace(${i})">
                <span class="place-result-body">
                    <span class="place-result-name">${escapeHtml(place.name)}</span>
                    <span class="place-result-address">${escapeHtml(where)}</span>
                </span>
                ${distance !== null ? `<span class="place-result-distance">${distance.toFixed(1)} mi</span>` : ''}
            </button>
        `;
    }).join('');
}

function choosePlace(index) {
    const place = placeResults[index];
    if (!place) return;

    pendingPlace = place;
    // A guess from the OSM tag, not a decision — the owner sees it in the
    // select and can change it before saving.
    pendingPlaceGenres = [];

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };
    set('add-venue-name', place.name);
    set('add-venue-address', place.address_line1);
    set('add-venue-city', place.city);
    set('add-venue-state', place.state);
    set('add-venue-postal', place.postal_code);
    set('add-venue-country', place.country);
    // The coordinate fields are real inputs now, and they are the ONLY thing
    // saveNewVenue() reads — pendingPlace.lat/lng is no longer consulted. An
    // OSM pick that skipped this would save a venue with no coordinates.
    set('add-venue-lat', place.lat.toFixed(6));
    set('add-venue-lng', place.lng.toFixed(6));

    coordlessSaveConfirmed = false;
    setCoordsStatus(`${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`);

    renderAddVenueCategoryOptions(window.VenuePlaces.guessCategory(place));
    renderAddVenueGenreChips();
    setFormMessage('add-venue', '');
    showAddVenueStep('confirm');
}

// The second way into #add-venue-step-confirm. Deliberately NOT a third step:
// that form already holds every column the insert writes, so a separate manual
// form would be a second writer to keep in sync with the first.
function startManualVenue() {
    if (!isOwner) return;   // presentation guard; RLS is the real one

    pendingPlace = null;
    pendingPlaceGenres = [];
    coordlessSaveConfirmed = false;

    for (const id of ['add-venue-name', 'add-venue-address', 'add-venue-city',
                      'add-venue-state', 'add-venue-postal', 'add-venue-country',
                      'add-venue-lat', 'add-venue-lng']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }

    setCoordsStatus('');
    // No `selected` argument: there is no OSM tag to guess from, so the
    // placeholder option wins and the owner has to choose.
    renderAddVenueCategoryOptions(null);
    renderAddVenueGenreChips();
    setFormMessage('add-venue', '');
    showAddVenueStep('confirm');

    const name = document.getElementById('add-venue-name');
    if (name && !('ontouchstart' in window)) setTimeout(() => name.focus(), 50);
}

// #add-venue-coords is the status line, shared by the OSM pick and the
// geocoder. One writer, so the two paths cannot leave contradictory text.
function setCoordsStatus(text, kind = 'ok') {
    const coords = document.getElementById('add-venue-coords');
    if (!coords) return;

    coords.classList.toggle('is-error', kind === 'error');
    if (!text) {
        coords.innerHTML = '';
        return;
    }

    coords.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <span>${escapeHtml(text)}</span>
    `;
}

// A port of app/venues.html's geocodeAddress(), onto the SAME
// window.VenuePlaces.geocodeAddress() seam — one Nominatim client, one queue.
// Two independent queues against a service that allows ~1 req/sec from a single
// source is how both surfaces get rate-limited at once.
async function geocodeVenueAddress() {
    const parts = [
        document.getElementById('add-venue-address')?.value,
        document.getElementById('add-venue-city')?.value,
        document.getElementById('add-venue-state')?.value,
        document.getElementById('add-venue-postal')?.value,
        document.getElementById('add-venue-country')?.value,
    ].map(v => (v || '').trim()).filter(Boolean);

    if (parts.length === 0) {
        setCoordsStatus(translateOr('social.coordsNeedAddress', null,
            'Enter an address or city first'), 'error');
        return;
    }

    setSubmitting('add-venue-geocode-btn', true,
        translateOr('social.searchingPlaces', null, 'Searching…'));
    const result = await window.VenuePlaces.geocodeAddress(parts.join(', '));
    setSubmitting('add-venue-geocode-btn', false);

    if (!result) {
        setCoordsStatus(translateOr('social.coordsNotFound', null,
            'Address not found. Try adding more detail.'), 'error');
        return;
    }

    const lat = document.getElementById('add-venue-lat');
    const lng = document.getElementById('add-venue-lng');
    if (lat) lat.value = result.lat.toFixed(6);
    if (lng) lng.value = result.lng.toFixed(6);

    // The owner just changed the coordinates, so a pending "save it hidden"
    // confirmation no longer describes what the next Save would do.
    coordlessSaveConfirmed = false;
    setCoordsStatus(`${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
}

function renderAddVenueCategoryOptions(selected) {
    const select = document.getElementById('add-venue-category');
    if (!select) return;
    const cats = window.VENUE_CATEGORIES || [];
    // ⚠️ An empty placeholder FIRST. Without it a manual save silently lands on
    // whatever VENUE_CATEGORIES[0] happens to be — the owner never chose it and
    // never saw a prompt. With it, saveNewVenue()'s existing isValidCategory
    // guard produces "Choose a category", which is the right message.
    const placeholder = `<option value="" ${selected ? '' : 'selected'} disabled`
        + ` data-i18n="social.chooseCategory">Choose a category…</option>`;
    select.innerHTML = placeholder + cats
        .map(c => `<option value="${escapeHtml(c.slug)}"${c.slug === selected ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
        .join('');

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function renderAddVenueGenreChips() {
    const wrap = document.getElementById('add-venue-genres');
    if (!wrap) return;
    const all = window.MUSIC_GENRES || [];
    wrap.innerHTML = all.map(g => `
        <button class="genre-chip genre-chip-btn ${pendingPlaceGenres.includes(g.slug) ? 'on' : ''}"
                type="button" aria-pressed="${pendingPlaceGenres.includes(g.slug) ? 'true' : 'false'}"
                onclick="toggleNewVenueGenre('${escapeHtml(g.slug)}')"
                data-i18n="${g.labelKey}">${escapeHtml(g.label)}</button>
    `).join('');

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

function toggleNewVenueGenre(slug) {
    if (!isValidGenre(slug)) return;
    pendingPlaceGenres = pendingPlaceGenres.includes(slug)
        ? pendingPlaceGenres.filter(g => g !== slug)
        : sanitizeGenres([...pendingPlaceGenres, slug]);
    renderAddVenueGenreChips();
}

// Slug: same rule as app/venues.html's saveVenue() — slugify the name and
// append a base-36 timestamp. venues_slug_app_unique is per app, and the
// timestamp is what makes a second "Le Bungalow" saveable rather than a 23505
// the owner cannot act on.
function slugifyVenueName(name) {
    const base = String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `${base || 'venue'}-${Date.now().toString(36)}`;
}

// Reads a coordinate input as a number, or null.
//
// ⚠️ Number.isFinite over the COERCED value, never a truthiness test: 0 is a
// perfectly good latitude (the equator) and a perfectly good longitude (the
// prime meridian, which runs through London). `if (!lat)` would reject both.
function readCoordInput(id, max) {
    const raw = document.getElementById(id)?.value;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < -max || n > max) return null;
    return n;
}

async function saveNewVenue() {
    // ⚠️ pendingPlace is NO LONGER a gate. It is null on the manual path by
    // definition, and the old `if (!pendingPlace) return` is precisely why
    // "enter the details yourself" could not exist. ownerOrgId is what the
    // insert actually needs — it is the organization_id column, and RLS tests
    // for a membership row in it.
    if (!currentApp || !ownerOrgId) return;

    const name = document.getElementById('add-venue-name')?.value.trim();
    if (!name) {
        setFormMessage('add-venue', 'Give the venue a name');
        return;
    }

    const category = document.getElementById('add-venue-category')?.value;
    // venues_category_valid rejects anything outside the seven slugs, and a
    // venue with a bogus category only ever surfaces under "All" — invisible
    // behind every pill. Fail here, where the message can say so.
    if (!isValidCategory(category)) {
        setFormMessage('add-venue', 'Choose a category');
        return;
    }

    const latitude = readCoordInput('add-venue-lat', 90);
    const longitude = readCoordInput('add-venue-lng', 180);
    const hasCoords = latitude !== null && longitude !== null;

    // ⚠️ HONOUR venues_active_requires_coordinates (20260823000002), do not
    // trip it. Sending is_active:true with a null latitude is a 23514 whose
    // message names a constraint the owner has no way to understand or fix.
    // Instead: say what will happen, and let a second tap confirm it — the
    // same two-choice contract app/venues.html's showCoordsRequiredModal()
    // offers, with no new markup.
    if (!hasCoords && !coordlessSaveConfirmed) {
        coordlessSaveConfirmed = true;
        setFormMessage('add-venue', translateOr('social.venueNoCoordsWarning', null,
            'Without coordinates this venue will be hidden from the map and search. '
            + 'Tap Save again to add it anyway, or use "Find coordinates" above.'));
        return;
    }

    setSubmitting('add-venue-save', true, 'Saving…');
    setFormMessage('add-venue', '');

    // Every required column, named explicitly:
    //   organization_id + app_id — what the RLS policy and the app scope check
    //   latitude/longitude       — venues_active_requires_coordinates (20260823000002)
    //                              rejects an ACTIVE venue without both
    //   category                 — venues_category_valid
    //   slug                     — venues_slug_app_unique, per app
    const { data, error } = await supabaseClient
        .from('venues')
        .insert({
            organization_id: ownerOrgId,
            app_id: currentApp.id,
            name,
            slug: slugifyVenueName(name),
            category,
            music_genres: sanitizeGenres(pendingPlaceGenres),
            address_line1: document.getElementById('add-venue-address')?.value.trim() || null,
            city: document.getElementById('add-venue-city')?.value.trim() || null,
            state: document.getElementById('add-venue-state')?.value.trim() || null,
            postal_code: document.getElementById('add-venue-postal')?.value.trim() || null,
            // A real pre-existing bug: #add-venue-country was populated by
            // choosePlace() and then never read, so every venue added from this
            // sheet took the DB default 'US' — including the one in Perpignan.
            country: document.getElementById('add-venue-country')?.value.trim() || null,
            latitude,
            longitude,
            // Computed, never the literal true. See the constraint note above.
            is_active: hasCoords,
            created_by_user_id: currentUserId || null,
            media_count: 0
        })
        .select()
        .single();

    setSubmitting('add-venue-save', false);

    if (error) {
        console.error('Failed to add venue:', error);
        setFormMessage('add-venue', error.code === '42501'
            ? 'Your account cannot add venues to this app.'
            : (error.message || 'Could not save that venue'));
        return;
    }

    // Push onto the local array so the venue is immediately pickable in the
    // composer, searchable, and on the map — without a reload. It came back
    // from .select(), so it has every column the RPC would have returned
    // except here_now, which is 0 for a venue nobody has posted at yet.
    // here_now is 0 for a venue nobody has posted at yet; every other column
    // comes back from .select(). Adding it locally makes it immediately
    // pickable in the composer, searchable and mapped, with no reload.
    //
    // ⚠️ ONLY when it is active. get_venues_for_map filters on is_active, so a
    // hidden venue pushed into the local array shows a pin and a swim-lane card
    // that both vanish on the next reload — which reads as the save having
    // failed after the fact.
    if (data.is_active) {
        const created = { ...data, here_now: 0 };
        if (usingDemoVenues) {
            // The first real venue REPLACES the sample set. Appending would leave
            // one real venue sitting among five fictional ones, which is worse
            // than either state on its own.
            venues = [created];
            usingDemoVenues = false;
            document.getElementById('sample-data-notice')?.remove();
        } else {
            venues.push(created);
        }
    }

    closeAddVenue();
    showToast(data.is_active
        ? `${name} added`
        : translateOr('social.venueAddedHidden', null, `${name} added, hidden from the map`));

    refreshFilterPills();
    renderVenueSwimLane();
    if (map) renderMapPins();
    const searchInput = document.getElementById('search-input');
    if (activeTab === 'search') handleSearch((searchInput?.value || '').trim());
}

function closeCreatePost() {
    const modal = document.getElementById('create-post-modal');
    const backdrop = document.getElementById('create-post-backdrop');
    if (modal) modal.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    unlockBodyScroll('create-post');

    // ⚠️ Detach onstop BEFORE anything stops the recorder. stopCamera() ends
    // the tracks, which stops a live MediaRecorder, whose onstop then builds a
    // File and paints a preview into a composer that is already closed — and
    // leaves selectedPostFile set for the next open.
    if (mediaRecorder) {
        mediaRecorder.onstop = null;
        mediaRecorder.ondataavailable = null;
        if (mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch { /* already stopping */ }
        }
    }

    selectedPostFile = null;
    recordedChunks = [];
    recordedDurationSeconds = null;
    composerVenueId = null;
    stopCamera();
    stopCountdownUi();
    applyComposerOrientation();
}

// ===== Camera & Recording =====

// ----- Phones only, upright only, 9:16 (Jay, 2026-10-06) -----

/**
 * True on a phone. userAgentData.mobile where the browser has it (Chromium);
 * otherwise an iPhone, or an Android UA that says Mobile AND has a coarse
 * pointer — Android tablets drop "Mobile" from their UA, and a desktop with a
 * spoofed UA still has a fine pointer. iPads are not phones here.
 */
function isPhoneDevice() {
    const nav = window.navigator || {};
    if (nav.userAgentData && nav.userAgentData.mobile === true) return true;

    const ua = nav.userAgent || '';
    if (/iPhone|iPod/.test(ua)) return true;

    const coarse = typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
    return /Android/.test(ua) && /Mobile/.test(ua) && coarse;
}

/**
 * The PHYSICAL orientation. screen.orientation first, then iOS's legacy
 * window.orientation, and the CSS media query only as a last resort: on
 * Android the soft keyboard shrinks the viewport, and `(orientation:
 * landscape)` would then report a portrait phone as landscape while someone
 * types a caption.
 */
function isLandscape() {
    const type = window.screen?.orientation?.type;
    if (typeof type === 'string') return type.startsWith('landscape');
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(orientation: landscape)').matches;
}

// "Turn your phone upright", over the camera area, while the composer is open
// and there is no clip yet. Rotating mid-take stops the recording and KEEPS the
// clip — stopRecording()'s onstop builds the preview as usual.
function applyComposerOrientation() {
    const overlay = document.getElementById('rotate-overlay');
    const recordBtn = document.getElementById('record-btn');
    const open = !!document.getElementById('create-post-modal')?.classList.contains('visible');
    const landscape = open && isPhoneDevice() && isLandscape();

    if (landscape && mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
        showToast('Recording stopped — keep your phone upright');
    }

    if (overlay) overlay.style.display = (landscape && !selectedPostFile) ? 'flex' : 'none';
    if (recordBtn) recordBtn.disabled = landscape;
}

function watchComposerOrientation() {
    const handler = () => applyComposerOrientation();
    if (window.screen?.orientation?.addEventListener) {
        window.screen.orientation.addEventListener('change', handler);
    }
    window.addEventListener('orientationchange', handler);
}

/** m:ss. `0:${s}` was wrong for anything over 59 — a 60s cap read "0:60". */
function formatClock(totalSeconds) {
    const n = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

const RECORD_RING_CIRCUMFERENCE = 188.5;   // 2π × r=30, matching social.css

function stopCountdownUi() {
    const countdown = document.getElementById('recording-countdown');
    if (countdown) {
        countdown.style.display = 'none';
        countdown.textContent = '';
        countdown.classList.remove('urgent');
    }
    const ring = document.getElementById('record-ring-fill');
    if (ring) ring.style.strokeDashoffset = String(RECORD_RING_CIRCUMFERENCE);
}

const CLIP_ASPECT = 9 / 16;
const CLIP_WIDTH = 720;
const CLIP_HEIGHT = 1280;

/**
 * The centred 9:16 window inside a source frame, or null when the source is
 * already close enough (within 2%) that cropping would only cost quality.
 */
function cropRectFor(srcW, srcH, aspect = CLIP_ASPECT) {
    const w = Number(srcW), h = Number(srcH);
    if (!(w > 0) || !(h > 0)) return null;
    const ratio = w / h;
    if (Math.abs(ratio - aspect) / aspect <= 0.02) return null;

    if (ratio > aspect) {
        // Too wide: trim the sides.
        const sw = Math.round(h * aspect);
        return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
    }
    // Too tall: trim top and bottom.
    const sh = Math.round(w / aspect);
    return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}

let cropFrameHandle = null;
let cropCanvasStream = null;

/**
 * A 720×1280 canvas fed with the centre crop of the viewfinder, plus the
 * camera's own audio track. Returns that stream, or null when no crop is needed
 * or the canvas route is unavailable — the caller then records the camera.
 */
function startCropPipeline(video) {
    stopCropPipeline();
    if (!video || !cameraStream) return null;
    if (!cropRectFor(video.videoWidth, video.videoHeight)) return null;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = CLIP_WIDTH;
        canvas.height = CLIP_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof canvas.captureStream !== 'function') return null;

        const draw = () => {
            // Re-read per frame: the track can renegotiate its size.
            const rect = cropRectFor(video.videoWidth, video.videoHeight)
                || { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight };
            if (rect.sw > 0 && rect.sh > 0) {
                ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, CLIP_WIDTH, CLIP_HEIGHT);
            }
            cropFrameHandle = requestAnimationFrame(draw);
        };
        draw();

        const stream = canvas.captureStream(30);
        cameraStream.getAudioTracks().forEach(track => stream.addTrack(track));
        cropCanvasStream = stream;
        return stream;
    } catch (err) {
        console.warn('9:16 crop unavailable, recording the camera directly:', err?.name || err);
        stopCropPipeline();
        return null;
    }
}

function stopCropPipeline() {
    if (cropFrameHandle !== null) {
        cancelAnimationFrame(cropFrameHandle);
        cropFrameHandle = null;
    }
    if (cropCanvasStream) {
        // Only the canvas's own video track — the audio track belongs to
        // cameraStream, which stopCamera() ends.
        cropCanvasStream.getVideoTracks().forEach(track => track.stop());
        cropCanvasStream = null;
    }
}


async function startCamera() {
    if (cameraStream) return; // Already running

    // Belt and braces with openCreatePost(): no camera request on a desktop.
    if (!isPhoneDevice()) {
        showToast('Open ViibeView on your phone to post');
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera not supported on this device');
        return;
    }

    // PORTRAIT, and capped (#9). This was 1280×720 landscape, which is the wrong
    // shape for a feed of 100dvh portrait panels — object-fit: cover then throws
    // away most of every frame that was paid for in bandwidth and battery.
    //
    // Every constraint is `ideal`, deliberately: `exact` raises
    // OverconstrainedError on any device that cannot match, and being unable to
    // record at all is far worse than recording at whatever the camera offers.
    const videoConstraints = {
        facingMode: 'environment',
        width: { ideal: 720 },
        height: { ideal: 1280 },
        frameRate: { ideal: 30, max: 30 }
    };

    try {
        // Audio first — a Viibe is a video with sound, and the feed has a sound
        // toggle. But getUserMedia is all-or-nothing: ask for audio you cannot
        // have and you get NO stream, not a video-only one. That is how a
        // Permissions-Policy of microphone=() turned into "Camera access
        // denied" with a perfectly working camera.
        //
        // So: try with sound, and if only the audio half is unavailable, fall
        // back to a silent recording rather than refusing to record at all.
        // Being unable to post is worse than posting without sound.
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: true
            });
        } catch (audioErr) {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
            console.warn('Microphone unavailable, recording video only:', audioErr.name);
            showToast('No microphone available — your Viibe will be silent');
        }

        const viewfinder = document.getElementById('camera-viewfinder');
        if (viewfinder) {
            viewfinder.srcObject = cameraStream;
            viewfinder.style.display = 'block';
            await viewfinder.play();
        }

        const placeholder = document.getElementById('upload-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        const controls = document.getElementById('recording-controls');
        if (controls) controls.style.display = 'flex';

        const uploadArea = document.getElementById('create-post-upload');
        if (uploadArea) uploadArea.classList.add('camera-active');

    } catch (e) {
        // Name the actual obstacle. "Camera access denied" was reported for a
        // camera that was never asked for permission, because the request had
        // already failed on the microphone.
        if (e.name === 'NotAllowedError') {
            const byPolicy = /permissions policy|disallowed by permissions/i.test(e.message || '');
            showToast(byPolicy
                ? 'Camera is blocked by this site’s settings. Tell support.'
                : 'Camera access denied. Allow camera access in your browser, then try again.');
        } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
            showToast('No camera found on this device');
        } else if (e.name === 'NotReadableError') {
            showToast('Your camera is in use by another app');
        } else {
            showToast('Could not access camera');
        }
        console.error('Camera error:', e.name, e.message);
    }
}

function stopCamera() {
    stopCropPipeline();
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.srcObject = null;
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
    mediaRecorder = null;
}

function startRecording() {
    if (!cameraStream) return;
    // Upright only. The button is disabled in landscape; this is the backstop.
    if (isLandscape()) {
        applyComposerOrientation();
        return;
    }

    recordedChunks = [];
    recordedDurationSeconds = null;

    // Every clip is 9:16. If the camera did not hand us that shape, record a
    // centre-cropped canvas instead; if the canvas route fails, the camera.
    const viewfinder = document.getElementById('camera-viewfinder');
    const source = startCropPipeline(viewfinder) || cameraStream;

    // Pick supported mimeType
    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

    // Bitrate cap (#9). At 15 seconds this puts a Viibe at roughly 1.5–2.5 MB
    // instead of the 10–15 MB an uncapped 1080p-class encode produces on a
    // recent phone. That is the whole performance story on the upload side —
    // there is no transcoding step and no new vendor.
    //
    // Lowered from 2.5 Mbps / 96 kbps on 2026-09-09. The clips this produces
    // are 5–15 s of a bar or a street at phone-portrait size, watched on a
    // phone — 1.2 Mbps is not visibly worse there, and every stored byte is
    // paid for again on every feed load. The org had just gone over its
    // free-tier Supabase egress on two videos.
    //
    // ⚠️ Wrapped: MediaRecorder throws NotSupportedError if it dislikes the
    // options object on some engines, and a capture app that cannot capture is
    // a total failure where a fatter file is a slower one.
    try {
        mediaRecorder = new MediaRecorder(source, {
            mimeType,
            videoBitsPerSecond: 1_200_000,
            audioBitsPerSecond: 64_000
        });
    } catch (err) {
        console.warn('MediaRecorder rejected the bitrate options, falling back:', err.name);
        try {
            mediaRecorder = new MediaRecorder(source, { mimeType });
        } catch (sourceErr) {
            // The cropped canvas stream is the one most likely to be refused
            // here. Recording the camera uncropped beats not recording.
            if (source === cameraStream) throw sourceErr;
            console.warn('MediaRecorder refused the cropped stream, recording the camera:', sourceErr.name);
            stopCropPipeline();
            mediaRecorder = new MediaRecorder(cameraStream, { mimeType });
        }
    }

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    const maxSeconds = maxVideoDuration();

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        selectedPostFile = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });

        // Capture the real elapsed length so venue_media.duration_seconds is
        // populated — the feed renders a duration badge from it, and it was
        // never being set.
        recordedDurationSeconds = Math.min(
            Math.max(1, Math.round((Date.now() - recordingStartTime) / 1000)),
            maxSeconds
        );

        // Show preview
        showRecordingPreview(blob);
        updatePostSubmitState();
    };

    mediaRecorder.start(1000); // collect data every second
    recordingStartTime = Date.now();

    // Update UI
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.add('recording');
    const timer = document.getElementById('recording-timer');
    if (timer) timer.classList.add('active');

    // Count DOWN from the cap rather than up — the limit is the point, and the
    // user needs to see it coming. Big number over the viewfinder, a ring on
    // the button, the small clock above it.
    const countdown = document.getElementById('recording-countdown');
    const ring = document.getElementById('record-ring-fill');
    const paintCountdown = (elapsed) => {
        const remaining = Math.max(0, Math.ceil(maxSeconds - elapsed));
        if (timer) timer.textContent = formatClock(remaining);
        if (countdown) {
            countdown.textContent = String(remaining);
            countdown.style.display = '';
            countdown.classList.toggle('urgent', remaining <= 3);
        }
        if (ring) {
            const used = Math.min(1, Math.max(0, elapsed / maxSeconds));
            ring.style.strokeDashoffset = String(RECORD_RING_CIRCUMFERENCE * (1 - used));
        }
    };
    paintCountdown(0);

    recordingTimerInterval = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        paintCountdown(elapsed);

        // Hard stop at the cap. settings.video_max_duration was seeded at 15s
        // for ViibeView but nothing enforced it, so recordings ran unbounded.
        if (elapsed >= maxSeconds) {
            stopRecording();
            showToast(`Clips are capped at ${maxSeconds} seconds`);
        }
    }, 200);
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    mediaRecorder.stop();
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;

    // Stop camera stream
    stopCamera();

    // Update UI
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.remove('recording');
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.style.display = 'none';
    const controls = document.getElementById('recording-controls');
    if (controls) controls.style.display = 'none';
    stopCountdownUi();
}

function showRecordingPreview(blob) {
    const preview = document.getElementById('upload-preview');
    if (!preview) return;

    preview.innerHTML = '';
    const video = document.createElement('video');
    video.src = URL.createObjectURL(blob);
    video.controls = true;
    video.playsInline = true;
    video.muted = false;
    preview.appendChild(video);
    preview.style.display = 'block';

    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'block';
}

function retakeRecording() {
    selectedPostFile = null;
    recordedChunks = [];
    recordedDurationSeconds = null;

    const preview = document.getElementById('upload-preview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'none';
    const timer = document.getElementById('recording-timer');
    if (timer) { timer.textContent = '0:00'; timer.classList.remove('active'); }
    stopCountdownUi();

    updatePostSubmitState();
    applyComposerOrientation();
    startCamera();
}

function updatePostSubmitState() {
    const submitBtn = document.getElementById('create-post-submit');
    if (submitBtn) submitBtn.disabled = !selectedPostFile;
}

// Poster frames are drawn at most this many pixels on the long edge, at this
// JPEG quality. Was full source resolution at 0.7, which produced an 82 KB
// poster for a 5-second clip — for an element that is never wider than ~430 CSS
// px on a phone. ~25 KB at these settings.
const POSTER_MAX_EDGE_PX = 720;
const POSTER_JPEG_QUALITY = 0.6;

/**
 * Grabs a poster frame from the recorded clip.
 *
 * thumbnail_url has never been written — before this it existed only in
 * migrations — so every feed card fell back to a grey block until the video
 * decoded. Resolves to null on any failure: a missing poster is cosmetic, and
 * a failed thumbnail must never fail the post.
 *
 * ⚠️ EVERY MISS IS PERMANENT AND COSTS FOREVER (#9). videoPreloadMode() only
 * gets to use preload="none" when thumbnail_url is set; a post without one is
 * pinned to preload="metadata" for the rest of its life, on every feed render,
 * for every visitor. So this is written to succeed rather than to be tidy:
 *
 *   * A MediaRecorder blob very often reports duration === Infinity, because
 *     the container is written without a duration header. Seeking such an
 *     element may never fire `seeked` at all. When the duration is not a usable
 *     number this now draws the frame it already has instead of seeking.
 *   * Even with a finite duration, some engines resolve loadeddata and then
 *     never fire seeked for these blobs. A 1.2s grace timer draws whatever is
 *     decoded rather than waiting out the 6s cap and shipping no poster.
 *
 * Both fallbacks are strictly better than the previous behaviour: the worst
 * case is the same null, and the common case is now a frame.
 */
function generateThumbnail(file) {
    return new Promise((resolve) => {
        let settled = false;
        let objectUrl = null;
        let timer = null;
        let graceTimer = null;

        const finish = (blob) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(graceTimer);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            resolve(blob || null);
        };

        try {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;

            // Nothing has been decoded yet — drawing now would produce a blank
            // canvas, which is worse than no poster because it LOOKS like one.
            const draw = () => {
                if (settled) return;
                try {
                    if (!video.videoWidth || !video.videoHeight) {
                        finish(null);
                        return;
                    }
                    // ⚠️ Downscale. This used to be the full source resolution
                    // at quality 0.7, which put a 5-second clip's poster at
                    // 82 KB. That matters more than it looks: with
                    // preload="none" the poster is the ONLY byte cost of a
                    // panel nobody scrolls to, so at feed scale it is paid on
                    // every post while the video is paid on one.
                    //
                    // 720 on the long edge is above the CSS pixel size of the
                    // element on any phone, so this costs no visible sharpness.
                    const scale = Math.min(1, POSTER_MAX_EDGE_PX /
                        Math.max(video.videoWidth, video.videoHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((blob) => finish(blob), 'image/jpeg', POSTER_JPEG_QUALITY);
                } catch {
                    finish(null);
                }
            };

            // The outer cap, so the composer can never sit on "Preparing…".
            timer = setTimeout(() => finish(null), 6000);

            video.onloadeddata = () => {
                const duration = video.duration;
                if (!Number.isFinite(duration) || duration <= 0.2) {
                    // Infinity, NaN, or a clip too short to seek inside. Take
                    // the frame that is already decoded.
                    draw();
                    return;
                }
                graceTimer = setTimeout(draw, 1200);
                try {
                    video.currentTime = 0.1;
                } catch {
                    draw();
                }
            };

            video.onseeked = draw;
            video.onerror = () => finish(null);

            objectUrl = URL.createObjectURL(file);
            video.src = objectUrl;
        } catch {
            finish(null);
        }
    });
}

// ===== Interruption handling (#11) =====
//
// The recording is the irreplaceable thing here. Everything else — the caption,
// the venue, the coordinates — can be retyped; the moment cannot be re-shot.
// So it is written to IndexedDB BEFORE the first byte is uploaded, and only
// deleted once the post row exists.
//
// Why IndexedDB + retry-with-backoff and NOT resumable/TUS uploads
// ----------------------------------------------------------------
// A capped Viibe is 2–4 MB (see startRecording's bitrate cap). Chunked
// resumption buys very little at that size, and it adds a CDN dependency and a
// second upload path to keep correct. What actually loses recordings today is
// not a half-finished transfer — it is the tab being backgrounded, the browser
// being killed, or the network dropping entirely. A durable draft plus retry
// addresses all three; TUS addresses none of them on its own.
//
// The seam stays clean: publishViibe() is the only uploader, so swapping in a
// resumable transport later is one function.

const DRAFT_DB_NAME = 'viibeview';
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = 'post_drafts';
// One draft at a time. A queue would need conflict rules ("which of your three
// unfinished Viibes did you mean?") for a case that does not exist: the
// composer holds one recording and cannot be opened twice.
const DRAFT_KEY = 'pending';

// Attempt delays in ms. Three attempts total; the first is immediate.
const UPLOAD_RETRY_DELAYS_MS = [0, 1200, 4000];

// Every draft helper resolves rather than rejects. IndexedDB is unavailable in
// some private-browsing modes and behind some enterprise policies, and losing
// the SAFETY NET must never take the POST down with it.
function openDraftDb() {
    return new Promise((resolve) => {
        try {
            if (!window.indexedDB) { resolve(null); return; }
            const request = window.indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(DRAFT_STORE)) {
                    db.createObjectStore(DRAFT_STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch (err) {
            resolve(null);
        }
    });
}

function withDraftStore(mode, run) {
    return openDraftDb().then((db) => {
        if (!db) return null;
        return new Promise((resolve) => {
            let result = null;
            try {
                const tx = db.transaction(DRAFT_STORE, mode);
                const store = tx.objectStore(DRAFT_STORE);
                const request = run(store);
                if (request) request.onsuccess = () => { result = request.result; };
                tx.oncomplete = () => { db.close(); resolve(result ?? null); };
                tx.onerror = () => { db.close(); resolve(null); };
                tx.onabort = () => { db.close(); resolve(null); };
            } catch (err) {
                db.close();
                resolve(null);
            }
        });
    });
}

// ⚠️ Stores the Blob itself, not an object URL. An object URL dies with the
// document, which is precisely the event this draft exists to survive.
function saveDraft(draft) {
    return withDraftStore('readwrite', (store) => store.put(draft, DRAFT_KEY));
}

function loadDraft() {
    return withDraftStore('readonly', (store) => store.get(DRAFT_KEY));
}

function clearDraft() {
    return withDraftStore('readwrite', (store) => store.delete(DRAFT_KEY));
}

// Retriable = the request never got a verdict, or the server said it was its
// own fault. A 4xx (RLS refusal, expired session, bad path) will say the same
// thing three times, and retrying it just makes the failure slower.
function isRetriableUploadError(error) {
    if (!error) return false;
    const status = parseInt(error.statusCode ?? error.status, 10);
    if (Number.isFinite(status)) return status >= 500;
    // No status at all is a fetch/network failure — exactly the case worth
    // retrying, and the one a phone walking out of a venue produces.
    return true;
}

// ⚠️ 409 / "Duplicate" is treated as SUCCESS, not as an error.
//
// The uploads use upsert: false, so an attempt whose RESPONSE was lost but
// whose BYTES landed makes the retry collide with the object it just created.
// Reporting that as a failure would throw away a recording that is already
// safely in storage.
function isAlreadyUploaded(error) {
    if (!error) return false;
    const status = parseInt(error.statusCode ?? error.status, 10);
    if (status === 409) return true;
    return /duplicate|already exists|resource already/i.test(error.message || '');
}

async function uploadWithRetry(path, file, onStatus) {
    let lastError = null;

    for (let attempt = 0; attempt < UPLOAD_RETRY_DELAYS_MS.length; attempt++) {
        const wait = UPLOAD_RETRY_DELAYS_MS[attempt];
        if (wait > 0) {
            onStatus(translateOr('social.uploadRetrying',
                { attempt: attempt + 1, total: UPLOAD_RETRY_DELAYS_MS.length },
                `Connection lost — retrying (${attempt + 1}/${UPLOAD_RETRY_DELAYS_MS.length})…`));
            await new Promise(r => setTimeout(r, wait));
        }

        const { error } = await supabaseClient.storage
            .from('venue-media')
            .upload(path, file, { cacheControl: MEDIA_CACHE_CONTROL, upsert: false });

        if (!error || isAlreadyUploaded(error)) return { ok: true };

        lastError = error;
        if (!isRetriableUploadError(error)) break;
    }

    return { ok: false, error: lastError };
}

// ===== Publishing =====
//
// The ONE uploader. submitPost() feeds it from the composer's DOM;
// resumeDraft() feeds it from IndexedDB. Keeping them on one path is what makes
// "resume" mean the same thing as "post" rather than a second, thinner
// implementation that drifts.
//
// `payload` is exactly what a draft holds, so a draft can be replayed verbatim.
async function publishViibe(payload, { onProgress, onStatus }) {
    const progress = onProgress || (() => {});
    const status = onStatus || (() => {});

    const session = await SocialAuth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('Sign in to post a Viibe');

    progress(20);
    status(translateOr('social.uploading', null, 'Uploading…'));

    // ⚠️ The storage path is part of the DRAFT, not recomputed on resume.
    // Recomputing it would mint a new timestamped path on every retry, so a
    // resumed upload could not collide with — and therefore could not RECOGNISE
    // — the bytes a previous attempt had already written.
    const path = payload.path;

    progress(40);

    const uploaded = await uploadWithRetry(path, payload.file, status);
    if (!uploaded.ok) throw uploaded.error || new Error('Upload failed');

    const { data: urlData } = supabaseClient.storage
        .from('venue-media')
        .getPublicUrl(path);

    progress(60);

    // Poster frame. Everything about it is best-effort — but see
    // generateThumbnail's header: a miss is permanent and costs a metadata
    // fetch on every future render, so it is worth the seconds it takes.
    let thumbnailUrl = null;
    try {
        const thumbBlob = await generateThumbnail(payload.file);
        if (thumbBlob) {
            const thumbPath = `${path.replace(/\.[^.]+$/, '')}-thumb.jpg`;
            const { error: thumbError } = await supabaseClient.storage
                .from('venue-media')
                .upload(thumbPath, thumbBlob, { cacheControl: MEDIA_CACHE_CONTROL, upsert: false, contentType: 'image/jpeg' });

            if (!thumbError || isAlreadyUploaded(thumbError)) {
                thumbnailUrl = supabaseClient.storage
                    .from('venue-media')
                    .getPublicUrl(thumbPath).data.publicUrl;
            }
        }
    } catch (thumbErr) {
        console.warn('Thumbnail generation failed, posting without one:', thumbErr);
    }

    progress(80);
    status(translateOr('social.savingPost', null, 'Saving…'));

    const { data: postData, error: postError } = await supabaseClient.rpc('create_social_post', {
        p_app_id: payload.appId,
        p_storage_path: path,
        p_url: urlData.publicUrl,
        p_venue_id: payload.venueId || null,
        p_caption: payload.caption,
        p_thumbnail_url: thumbnailUrl,
        p_duration_seconds: payload.durationSeconds,
        p_file_size_bytes: payload.file.size,
        p_latitude: payload.latitude,
        p_longitude: payload.longitude
    });

    // ⚠️ A SECURITY DEFINER function returning success:false does NOT set
    // `error`. Testing only postError would swallow every server-side
    // rejection — rate limit, wrong app's venue, not a member — and show
    // "Posted!" over a post that does not exist.
    const row = Array.isArray(postData) ? postData[0] : postData;
    if (postError) throw postError;
    if (!row || row.success === false) {
        throw new Error(row?.error_message || 'Could not publish your Viibe');
    }

    // venues.media_count is maintained by the trg_venue_media_count trigger
    // (migration 20260821000001). The client used to do a read-modify-write
    // here, which lost an increment on concurrent uploads.

    progress(100);
    return row;
}

// Everything that has to happen after a Viibe lands, wherever it came from.
async function afterViibePublished() {
    // Small delay to ensure DB propagation, then reload + scroll to top
    await new Promise(r => setTimeout(r, 300));
    await loadFeed(false);
    await loadPostPins();
    if (map) renderPostPins();
    if (venuePageVenueId) await loadVenuePageFeed(false);
    // ⚠️ The feed scrolls on #feed-container, not on window. A window.scrollTo
    // here would do nothing at all and the member would be left mid-feed
    // wondering where their Viibe went.
    document.getElementById('feed-container')?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitPost() {
    if (!selectedPostFile) return;

    const submitBtn = document.getElementById('create-post-submit');
    const progress = document.getElementById('create-post-progress');
    const progressFill = document.getElementById('post-progress-fill');
    const progressText = document.getElementById('post-progress-text');

    if (submitBtn) submitBtn.disabled = true;
    if (progress) progress.style.display = 'block';
    if (progressFill) progressFill.style.width = '10%';
    if (progressText) progressText.textContent = translateOr('social.preparing', null, 'Preparing…');

    // ⚠️ These percentages are STAGE markers, not byte progress, and the label
    // says so ("Uploading…", not "43%"). supabase-js v2's storage.upload() is a
    // fetch with no progress event, so real byte progress would mean a second
    // XHR-based upload path. Retry status is the honest thing this UI can add,
    // and it is what a stalled upload actually needs to say.
    const setProgress = (percent) => {
        if (progressFill) progressFill.style.width = `${percent}%`;
    };
    const setStatus = (text) => {
        if (progressText) progressText.textContent = text;
    };

    const session = await SocialAuth.getSession();
    const userId = session?.user?.id;

    // Which venue, if any — whatever the picker holds, for everyone.
    //
    // There used to be an owner-only branch here that called
    // getOrCreateDefaultVenue() and auto-minted a venue named "General".
    // It is gone: venue_id is nullable, the picker is explicit, and an
    // owner who wants no venue gets no venue, same as a member.
    const venueId = composerVenueId;

    // Where the clip was actually recorded. Null when location was refused;
    // the post is still perfectly valid, it just gets no pin of its own.
    const coords = await getCurrentCoords();

    const timestamp = Date.now();
    const safeFilename = selectedPostFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Owners keep {orgId}/{venueId}/… — that policy and that path are
    // untouched. Members get their own prefix, which is what the
    // "Members can upload their own venue media" policy authorizes.
    const path = (isOwner && ownerOrgId && venueId && userId)
        ? `${ownerOrgId}/${venueId}/${timestamp}-${safeFilename}`
        : `members/${userId}/${timestamp}-${safeFilename}`;

    const payload = {
        appId: currentApp.id,
        path,
        file: selectedPostFile,
        caption: document.getElementById('post-caption')?.value.trim() || null,
        venueId: venueId || null,
        durationSeconds: recordedDurationSeconds,
        latitude: coords ? coords.lat : null,
        longitude: coords ? coords.lng : null,
        savedAt: timestamp
    };

    // ⚠️ BEFORE the first byte goes out. This is the entire point of #11: a
    // crash, a tab close, or a backgrounded browser from here on costs a retry,
    // not the recording.
    await saveDraft(payload);

    try {
        await publishViibe(payload, { onProgress: setProgress, onStatus: setStatus });

        // Only now. A draft cleared on upload success rather than on POST
        // success would lose the recording whenever create_social_post refused
        // it — a rate limit, say, which is a retry-later case by definition.
        await clearDraft();

        setStatus(translateOr('social.posted', null, 'Posted!'));

        setTimeout(async () => {
            closeCreatePost();
            showToast('Post published!');
            await afterViibePublished();
        }, 500);

    } catch (err) {
        console.error('Post upload failed:', err);
        setProgress(0);
        setStatus(translateOr('social.uploadFailed', null, 'Upload failed'));
        showToast(err.message || 'Failed to post. Try again.');
        if (submitBtn) submitBtn.disabled = false;
        // The draft is deliberately LEFT in place. The banner on next open is
        // the second chance, and closing the composer must not be the thing
        // that discards a recording.
        refreshDraftBanner();
    }
}

// ===== Draft recovery banner =====
//
// Shown on boot when a draft outlived its upload. Uses insertBelowFilterRows(),
// the same in-flow slot as the location banner and the sample-data notice —
// deliberately NOT a modal: interrupting someone with a dialog before they have
// seen the app is a worse trade than a row they can act on when ready.
async function refreshDraftBanner() {
    document.getElementById('draft-banner')?.remove();

    const draft = await loadDraft();
    // A draft for a DIFFERENT tenant belongs to a different app on the same
    // device. Leave it alone rather than offering to post it here.
    if (!draft || !draft.file || !currentApp || draft.appId !== currentApp.id) return;
    if (!(await SocialAuth.isSignedIn())) return;

    const banner = document.createElement('div');
    banner.id = 'draft-banner';
    banner.className = 'draft-banner';
    banner.innerHTML = `
        <span class="draft-banner-text" data-i18n="social.draftPending">Your last Viibe didn't finish uploading.</span>
        <button type="button" class="draft-banner-action" id="draft-resume" data-i18n="social.draftResume">Resume</button>
        <button type="button" class="draft-banner-dismiss" id="draft-discard" data-i18n="social.draftDiscard">Discard</button>
    `;

    banner.querySelector('#draft-resume').addEventListener('click', () => resumeDraft(draft));
    banner.querySelector('#draft-discard').addEventListener('click', async () => {
        await clearDraft();
        banner.remove();
    });

    insertBelowFilterRows(banner);

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
}

// Replays the stored payload through the same publishViibe() the composer uses.
// The progress UI belongs to the composer, which is closed here, so status goes
// to toasts instead.
async function resumeDraft(draft) {
    const banner = document.getElementById('draft-banner');
    const resumeBtn = document.getElementById('draft-resume');
    if (resumeBtn) {
        resumeBtn.disabled = true;
        resumeBtn.textContent = translateOr('social.uploading', null, 'Uploading…');
    }

    try {
        await publishViibe(draft, { onStatus: (text) => { if (resumeBtn) resumeBtn.textContent = text; } });
        await clearDraft();
        banner?.remove();
        showToast('Post published!');
        await afterViibePublished();
    } catch (err) {
        console.error('Draft resume failed:', err);
        showToast(err.message || 'Still could not post that. Try again later.');
        if (resumeBtn) {
            resumeBtn.disabled = false;
            resumeBtn.textContent = translateOr('social.draftResume', null, 'Resume');
        }
    }
}

// ===== Location Banner =====
// Inserted into normal flow directly beneath the category pills. It used to be
// position:fixed at top:56px, which laid it straight over the pills and
// swallowed their clicks — so denying location (a very common choice) silently
// disabled category filtering entirely.
function showLocationBanner() {
    if (document.getElementById('location-banner')) return;
    // At most one notice bar at a time — stacking them pushes the feed and map
    // down the screen. The sample-data notice outranks this one, and distances
    // are meaningless against sample venues anyway.
    if (document.getElementById('sample-data-notice')) return;

    const banner = document.createElement('div');
    banner.id = 'location-banner';
    banner.className = 'location-banner';
    banner.innerHTML = `
        <span>Enable location access for distance info</span>
        <button class="location-banner-close" type="button" aria-label="Dismiss">&times;</button>
    `;
    banner.querySelector('.location-banner-close')
        .addEventListener('click', () => banner.remove());

    insertBelowFilterRows(banner);
}

// ===== Toast Notifications =====
function showToast(message) {
    const existing = document.querySelector('.social-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'social-toast';
    toast.textContent = message;
    // max-width is capped in absolute terms as well as proportionally: 90% of
    // a 1440px desktop viewport is a 1300px-wide toast floating outside the
    // app column.
    toast.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:9999;opacity:0;transition:opacity 0.3s;max-width:min(90%,360px);text-align:center;';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Add to Home Screen =====
//
// What is actually possible, per platform:
//   Android / Chrome / Edge — capture beforeinstallprompt, preventDefault() it,
//     stash the event, and call .prompt() from a real tap. One-tap install.
//   iOS Safari — there is NO programmatic install. Apple provides no API at
//     all, so the only honest thing to do is show the Share → Add to Home
//     Screen instructions.
// Neither can be forced, on either platform.

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function isIosSafari() {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua)
        // iPadOS 13+ reports as a Mac; the touch points give it away.
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // Chrome and Firefox on iOS are Safari underneath but have no Add to Home
    // Screen item in their share sheets, so the instructions would be wrong.
    const realSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return iOS && realSafari;
}

// Dismissals persist per app AND per banner, matching the
// viibe_recent_searches_${appSlug} / viibe_sound_on_${appSlug} convention
// already in this file. Keyed because the install and signup banners share a
// slot but not an answer.
function bannerDismissedRecently(key) {
    try {
        const raw = localStorage.getItem(`${key}_${appSlug}`);
        if (!raw) return false;
        const at = parseInt(raw, 10);
        if (!Number.isFinite(at)) return false;
        return (Date.now() - at) < INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch {
        return false;   // private mode; showing it once is better than never
    }
}

function recordBannerDismissal(key) {
    try {
        localStorage.setItem(`${key}_${appSlug}`, String(Date.now()));
    } catch { /* preference is non-essential */ }
}

function installDismissedRecently() { return bannerDismissedRecently(INSTALL_DISMISSED_KEY); }
function recordInstallDismissal()   { recordBannerDismissal(INSTALL_DISMISSED_KEY); }

// Second visit, not first. Chrome only fires beforeinstallprompt once its own
// engagement heuristic is met anyway, so this mainly governs the iOS banner —
// and asking someone to install an app they have looked at for four seconds is
// how you teach them to dismiss banners.
const INSTALL_VISITS_KEY = 'viibe_visits';

// ⚠️ Incremented at most once per page load, whichever banner's setup asks
// first. Both setupInstallPrompt() and setupSignupPrompt() must call it so
// neither depends on the other having run — and without this memo that double
// increment would collapse the second-visit rule into a first-visit rule.
let visitsThisLoad = null;

function recordVisit() {
    if (visitsThisLoad !== null) return visitsThisLoad;
    try {
        const key = `${INSTALL_VISITS_KEY}_${appSlug}`;
        const n = parseInt(localStorage.getItem(key) || '0', 10);
        visitsThisLoad = (Number.isFinite(n) ? n : 0) + 1;
        localStorage.setItem(key, String(visitsThisLoad));
    } catch {
        visitsThisLoad = 1;
    }
    return visitsThisLoad;
}

// Read without incrementing — maybeShowInstallBanner() can run more than once
// per page load and must not inflate the count.
function recordedVisits() {
    try {
        const n = parseInt(localStorage.getItem(`${INSTALL_VISITS_KEY}_${appSlug}`) || '0', 10);
        return Number.isFinite(n) ? n : 1;
    } catch {
        return 1;
    }
}

// Chrome-family hands us a replayable beforeinstallprompt; iOS Safari hands us
// nothing but has a Share -> Add to Home Screen item to point at. Anywhere else
// — desktop Firefox, Chrome/Firefox on iOS — the Add button would have nothing
// honest to do, so the banner must never be offered at all.
//
// This lived at maybeShowInstallBanner()'s single call site until it acquired a
// second one. A caller that forgets it shows a banner whose Add button falls
// through to openIosInstall(), i.e. iOS instructions on Firefox.
function canOfferInstall() {
    return !!deferredInstallPrompt || isIosSafari();
}

// Shows the banner if every condition is met. Safe to call from either side of
// the race between beforeinstallprompt and init().
//
// `ignoreVisitCount` is the ONE bypass: someone who just signed up in this
// session has already told us they are staying, so making them wait for a
// second visit to be offered the install is pure friction. Standalone and the
// 14-day dismissal are still honoured on that path.
function maybeShowInstallBanner({ ignoreVisitCount = false } = {}) {
    if (!installUiReady) return;
    // Anonymous visitors get #signup-banner in this slot instead. There is no
    // point asking someone to install an app they have no account in.
    if (!isMemberSignedIn) return;
    if (!canOfferInstall()) return;
    if (isStandalone() || installDismissedRecently()) return;
    if (!ignoreVisitCount && recordedVisits() < 2) return;
    document.getElementById('install-banner')?.classList.add('visible');
}

// The signup half of the same slot. Same gating as install — second visit or
// later, its own 14-day dismissal — but deliberately NOT gated on
// isStandalone(): someone who installed the PWA and still has no account is
// exactly who this is for.
function maybeShowSignupBanner() {
    if (!signupUiReady) return;
    if (isMemberSignedIn) return;
    if (bannerDismissedRecently(SIGNUP_BANNER_DISMISSED_KEY)) return;
    if (recordedVisits() < 2) return;
    document.getElementById('signup-banner')?.classList.add('visible');
}

// The two banners share one fixed slot at the bottom of the viewport, so
// exactly one may be .visible. This is the only function that decides which,
// and the only one anything outside this section should call — onSignedIn()
// uses it to swap the slot under a page that is already painted.
//
// The isMemberSignedIn guards in the two maybeShow* functions are exact
// complements read from one variable, so they are mutually exclusive by
// construction rather than by call ordering. Clearing both first is the belt.
function refreshBottomBanners({ justSignedIn = false } = {}) {
    document.getElementById('install-banner')?.classList.remove('visible');
    document.getElementById('signup-banner')?.classList.remove('visible');
    maybeShowSignupBanner();
    maybeShowInstallBanner({ ignoreVisitCount: justSignedIn });
}

function setupInstallPrompt() {
    const banner = document.getElementById('install-banner');
    if (!banner) return;

    recordVisit();

    // Brand the banner's tile the same way the header and auth splash do.
    const icon = document.getElementById('install-banner-icon');
    if (icon && currentApp) {
        const logo = currentApp.branding?.logo_url;
        icon.innerHTML = logo
            ? `<img src="${escapeHtml(logo)}" alt="">`
            : escapeHtml((currentApp.name || 'V').charAt(0).toUpperCase());
    }

    document.getElementById('install-banner-dismiss')?.addEventListener('click', () => {
        banner.classList.remove('visible');
        recordInstallDismissal();
    });

    document.getElementById('ios-install-close')?.addEventListener('click', closeIosInstall);
    document.getElementById('ios-install-backdrop')?.addEventListener('click', closeIosInstall);

    // Already installed — nothing to offer.
    if (isStandalone()) return;

    window.addEventListener('appinstalled', () => {
        banner.classList.remove('visible');
        deferredInstallPrompt = null;
    });

    document.getElementById('install-banner-btn')?.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            banner.classList.remove('visible');
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            // The event is single-use whatever the answer.
            deferredInstallPrompt = null;
            if (outcome === 'dismissed') recordInstallDismissal();
            return;
        }
        // iOS: no event to replay, so explain instead.
        openIosInstall();
    });

    installUiReady = true;

    // Two ways in:
    //   Android/Chrome — beforeinstallprompt has already fired (it is captured
    //     at parse time, below) or will fire shortly and call this itself.
    //   iOS Safari — that event NEVER fires, so the banner is offered on visit
    //     count alone and the Add button opens the instructions instead.
    // Both cases are canOfferInstall(), which maybeShowInstallBanner() now
    // checks for itself.
    maybeShowInstallBanner();
}

// The other half of the bottom slot. Mirrors setupInstallPrompt(), minus the
// platform and standalone questions — a signup prompt is offerable everywhere.
function setupSignupPrompt() {
    const banner = document.getElementById('signup-banner');
    if (!banner) return;

    // Idempotent per page load — setupInstallPrompt() has already called it.
    // Both must ask, so neither depends on the other having run.
    recordVisit();

    // Brand the tile the same way the install banner, the header and the auth
    // splash do.
    const icon = document.getElementById('signup-banner-icon');
    if (icon && currentApp) {
        const logo = currentApp.branding?.logo_url;
        icon.innerHTML = logo
            ? `<img src="${escapeHtml(logo)}" alt="">`
            : escapeHtml((currentApp.name || 'V').charAt(0).toUpperCase());
    }

    document.getElementById('signup-banner-dismiss')?.addEventListener('click', () => {
        banner.classList.remove('visible');
        recordBannerDismissal(SIGNUP_BANNER_DISMISSED_KEY);
    });

    // showAuth() rather than requireAccount(): the banner is only ever visible
    // when signed out, and there is no interrupted action to stash. Hidden but
    // NOT recorded as a dismissal — someone who backs out of the overlay should
    // be asked again next visit, just not for the rest of this one.
    document.getElementById('signup-banner-btn')?.addEventListener('click', () => {
        banner.classList.remove('visible');
        showAuth('signup');
    });

    signupUiReady = true;
    maybeShowSignupBanner();
}

function openIosInstall() {
    document.getElementById('ios-install-sheet')?.classList.add('visible');
    document.getElementById('ios-install-backdrop')?.classList.add('visible');
    lockBodyScroll('ios-install');
}

function closeIosInstall() {
    document.getElementById('ios-install-sheet')?.classList.remove('visible');
    document.getElementById('ios-install-backdrop')?.classList.remove('visible');
    unlockBodyScroll('ios-install');
}

// ===== Back navigation =====
//
// Android's back button (and the browser's) used to leave the app from
// anywhere: ViibeView made no history entries at all, and the manifest is
// `standalone`, so one press from inside a venue page closed the whole PWA
// (Jay, 2026-10-06).
//
// The model: ONE guard entry. Whenever anything is open, or a tab other than
// Feed is showing, a single extra history entry sits on top of the page's own.
// Back pops it; popstate closes the top-most open surface (BACK_SURFACES is in
// stacking order, top first) or returns to Feed, and then re-arms the guard if
// there is still something to go back from. Back from Feed with nothing open
// leaves — in the installed app, only after "Press back again to exit".
//
// ⚠️ THE PUSH WAITS FOR THE FIRST USER GESTURE. Chrome marks a history entry
// as skippable when it is added by a document that has never had user
// activation, and back then jumps straight over it — out of the app. A guard
// pushed at boot (deep-linked venue page, first-run onboarding) would make the
// very first back press exit. Once the user has tapped anything the activation
// is sticky and every later push, including the re-arm inside popstate, holds.
//
// ⚠️ A popstate that lands ON a guard entry is the forward button, not back;
// it is ignored. history.state is passed through by every replaceState in this
// app (social.js and social-auth.js) so the guard's marker is never wiped.

const BACK_SURFACES = [
    { id: 'onboarding-overlay', back: () => {
        if (onboardingIndex > 0) setOnboardingIndex(onboardingIndex - 1);
        else finishOnboarding();
    } },
    // Through its own Cancel button, so showConfirm's close() runs.
    { id: 'confirm-dialog',      back: () => document.getElementById('confirm-cancel')?.click() },
    { id: 'venue-picker-sheet',  back: () => closeVenuePicker() },
    { id: 'create-post-modal',   back: () => backFromComposer() },
    { id: 'auth-overlay',        back: () => backFromAuth() },
    { id: 'edit-profile-sheet',  back: () => closeEditProfile() },
    { id: 'post-options-sheet',  back: () => closePostOptions() },
    { id: 'people-sheet',        back: () => closePeopleSheet() },
    { id: 'member-page',         back: () => closeMemberProfile() },
    { id: 'venue-page',          back: () => closeVenuePage() },
    { id: 'post-preview-modal',  back: () => closePostPreview() },
    { id: 'add-venue-sheet',     back: () => closeAddVenue() },
    { id: 'app-settings-sheet',  back: () => closeAppSettings() },
    { id: 'radius-sheet',        back: () => closeRadiusSheet() },
    { id: 'contact-sheet',       back: () => closeContactSheet() },
    { id: 'ios-install-sheet',   back: () => closeIosInstall() },
];

const BACK_GUARD_STATE = 'viibeBackGuard';
let backGuardArmed = false;
let backHadGesture = false;
let backExitWarned = false;

function topOpenSurface() {
    return BACK_SURFACES.find(s =>
        document.getElementById(s.id)?.classList.contains('visible')) || null;
}

// Whether back has anything to do inside the app. In the installed app the
// answer is always yes — the guard is what lets us say "press back again".
function needsBackGuard() {
    if (topOpenSurface() || activeTab !== 'feed') return true;
    return installedApp() && !backExitWarned;
}

// isStandalone(), tolerant of an environment with no matchMedia (jsdom, some
// webviews) — this runs inside a global pointerdown listener.
function installedApp() {
    try { return isStandalone(); } catch { return window.navigator?.standalone === true; }
}

function syncBackGuard() {
    if (backGuardArmed || !backHadGesture || !needsBackGuard()) return;
    try {
        const base = history.state && typeof history.state === 'object' ? history.state : {};
        history.pushState({ ...base, [BACK_GUARD_STATE]: true }, '');
        backGuardArmed = true;
    } catch {
        // Some embedded webviews refuse pushState. Back then behaves as it
        // always did, which is the worst case, not a new one.
    }
}

function onBackPopState(event) {
    // Forward onto our own guard entry — not a back press.
    if (event.state && event.state[BACK_GUARD_STATE]) {
        backGuardArmed = true;
        return;
    }
    backGuardArmed = false;

    const surface = topOpenSurface();
    if (surface) {
        surface.back();
        syncBackGuard();
        return;
    }

    if (activeTab !== 'feed') {
        switchTab('feed');
        syncBackGuard();
        return;
    }

    // Feed, nothing open: this press is a request to leave.
    if (installedApp()) {
        // No re-arm: the NEXT press goes past the page's first entry and the
        // OS closes the app. Any tap in between re-arms (onBackGesture).
        backExitWarned = true;
        showToast(translateOr('social.pressBackToExit', null, 'Press back again to exit'));
        return;
    }
    // A browser tab: the guard we just consumed was left over from a surface
    // closed by its own button. Take the press the rest of the way.
    history.back();
}

function onBackGesture() {
    backHadGesture = true;
    backExitWarned = false;
    syncBackGuard();
}

function backFromComposer() {
    const recording = !!mediaRecorder && mediaRecorder.state === 'recording';
    if (selectedPostFile || recording) {
        showConfirm({
            title: translateOr('social.discardViibeTitle', null, 'Discard this Viibe?'),
            body: translateOr('social.discardViibeBody', null, 'Your clip will be lost.'),
            acceptLabel: translateOr('social.discard', null, 'Discard'),
            onAccept: () => closeCreatePost()
        });
        return;
    }
    closeCreatePost();
}

function currentAuthView() {
    return ['reset', 'forgot', 'login', 'signup', 'splash'].find(v => {
        const el = document.getElementById(`auth-view-${v}`);
        return el && el.style.display !== 'none';
    }) || 'splash';
}

// One view back: forgot → login → splash → closed.
function backFromAuth() {
    const view = currentAuthView();
    if (view === 'forgot') setAuthView('login');
    else if (view === 'login' || view === 'signup') setAuthView('splash');
    else hideAuth();
}

function setupBackNavigation() {
    window.addEventListener('popstate', onBackPopState);
    // Capture phase: the first tap anywhere counts, even one a handler stops.
    ['pointerdown', 'keydown'].forEach(type =>
        document.addEventListener(type, onBackGesture, { capture: true, passive: true }));

    // Opening any surface arms the guard — whatever opened it. One observer
    // over every registered element, on its class attribute only.
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => syncBackGuard());
        BACK_SURFACES.forEach(s => {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
    }
}

// At PARSE time — the script tag sits at the end of <body>, so every surface
// already exists, and a popstate must be caught even before init() resolves.
setupBackNavigation();

// ===== Service Worker =====
// sw.js already precaches social.html/.css/.js, but this page never registered
// it — so offline support and push were dead weight for the whole app type.
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

    navigator.serviceWorker.register('/customer-app/sw.js', { scope: '/customer-app/' })
        .catch(err => console.warn('Service worker registration failed:', err));
}

// ⚠️ Registered at PARSE time, deliberately outside setupInstallPrompt().
// Chrome fires beforeinstallprompt as soon as its criteria are met, which can
// beat init()'s awaits, and the event is not replayed for a late listener.
window.addEventListener('beforeinstallprompt', (e) => {
    // Without preventDefault the browser shows its own mini-infobar and the
    // event cannot be replayed later from our own button.
    e.preventDefault();
    deferredInstallPrompt = e;
    maybeShowInstallBanner();   // no-op until setupInstallPrompt() has run
});

// ===== Start =====
document.addEventListener('DOMContentLoaded', () => {
    init();
    registerServiceWorker();
});
