/**
 * Social Venue Discovery App
 * Customer-facing app for discovering venues via map + video feed
 */

// ===== Config =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        await renderProfileIdentity();

        // Check if viewer is the business owner
        await checkOwnerAccess();

        // What this user follows, for every Follow button on the page. Must run
        // AFTER checkOwnerAccess(), which is what sets currentUserId.
        await loadFollowingState();

        // Request geolocation
        requestLocation();

        // Load venues for map
        await loadVenues();

        // Post pins double as the map's default centre, so they are loaded up
        // front rather than lazily with the map tab.
        await loadPostPins();

        // Load initial feed
        await loadFeed();

        // Setup event listeners
        setupEventListeners();

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

// ===== Session =====

// ⚠️ The reload is load-bearing beyond convenience: it is what rebuilds the
// bottom banner slot signed-out. Anything that turns this into an in-place
// teardown must also call refreshBottomBanners().
async function handleLogout() {
    await SocialAuth.signOut();
    window.location.reload();
}

// Swaps the Profile tab between its signed-out invitation and the real card.
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

    // Counts come from get_member_profile, which computes them rather than
    // reading a stored column — see migration 20260903000001 §4 for why there
    // is no counter. A failure here must not blank the whole tab, so the row
    // simply keeps its zeros.
    const userId = session.user?.id;
    if (userId && currentApp) {
        const { data } = await supabaseClient.rpc('get_member_profile', {
            p_app_id: currentApp.id,
            p_user_id: userId
        });
        const profile = Array.isArray(data) ? data[0] : data;
        if (profile) {
            const followers = document.getElementById('profile-followers-count');
            const following = document.getElementById('profile-following-count');
            if (followers) followers.textContent = profile.follower_count ?? 0;
            if (following) following.textContent = profile.following_count ?? 0;
        }
    }
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
        console.warn('Failed to load follow state:', error.message);
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

    if (!(await requireAccount('Create an account to follow'))) return;

    // requireAccount() only guarantees a session; currentUserId is set by
    // checkOwnerAccess(), which onSignedIn() runs. Read it again rather than
    // assuming, so the first follow after a fresh signup is not a no-op.
    if (!currentUserId) await checkOwnerAccess();

    const key = followKey(type, id);
    const wasFollowing = followingKeys.has(key);

    if (wasFollowing) followingKeys.delete(key); else followingKeys.add(key);
    repaintFollowButtons();

    const { data, error } = await supabaseClient.rpc(
        wasFollowing ? 'unfollow_target' : 'follow_target',
        { p_app_id: currentApp.id, p_target_type: type, p_target_id: id }
    );

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.success === false) {
        if (wasFollowing) followingKeys.add(key); else followingKeys.delete(key);
        repaintFollowButtons();
        showToast(row?.error_message || error?.message || 'Could not update that');
        return;
    }

    // The server's follower count is authoritative — it excludes soft-deleted
    // members, which the client cannot see and therefore cannot compute.
    if (memberPageProfile && type === 'user' && memberPageUserId === id) {
        memberPageProfile.follower_count = row.follower_count ?? memberPageProfile.follower_count;
        renderMemberStats();
    }

    repaintFollowButtons();
}

// Every visible follow control, repainted from followingKeys. One writer, so
// the venue page's button and the member page's button cannot disagree.
function repaintFollowButtons() {
    const memberBtn = document.getElementById('member-page-follow-btn');
    if (memberBtn && memberPageUserId) {
        paintFollowButton(memberBtn, isFollowing('user', memberPageUserId));
    }

    const venueBtn = document.getElementById('venue-page-follow-btn');
    if (venueBtn && venuePageVenueId) {
        paintFollowButton(venueBtn, isFollowing('venue', venuePageVenueId));
    }
}

function paintFollowButton(btn, following) {
    btn.classList.toggle('following', following);
    btn.setAttribute('data-i18n', following ? 'social.followingState' : 'social.follow');
    btn.textContent = following ? 'Following' : 'Follow';
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

function setAuthView(view) {
    ['splash', 'login', 'signup', 'forgot', 'reset'].forEach(v => {
        const el = document.getElementById(`auth-view-${v}`);
        if (el) el.style.display = v === view ? '' : 'none';
    });
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
async function requireAccount(reason, { pendingVenueId } = {}) {
    if (await SocialAuth.isSignedIn()) return true;

    if (pendingVenueId !== undefined) {
        pendingComposerVenueId = pendingVenueId;
        hasPendingComposer = true;
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
    // "Browse without an account" abandons whatever the overlay interrupted.
    // Without this, a visitor who taps Create, backs out, and signs in an hour
    // later from the Profile tab gets a composer they never asked for.
    // Cleared HERE and not in hideAuth(), which the successful-auth paths call
    // immediately before onSignedIn() — the one moment the intent must survive.
    document.getElementById('auth-browse-btn')?.addEventListener('click', () => {
        hasPendingComposer = false;
        pendingComposerVenueId = undefined;
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

    ['contact-us-btn', 'contact-us-btn-out'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', openContactSheet);
    });
    document.getElementById('contact-close')?.addEventListener('click', closeContactSheet);
    document.getElementById('contact-backdrop')?.addEventListener('click', closeContactSheet);

    // Arriving from a password-recovery email
    if (SocialAuth.isRecoveryRedirect()) {
        showAuth('reset');
    }
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
        setFormMessage('reset-form', result.error);
        return;
    }

    // Clear the recovery fragment so a refresh doesn't reopen this view
    history.replaceState(null, '', window.location.pathname + window.location.search);
    hideAuth();
    await onSignedIn();
    showToast('Password updated');
}

// Runs after any successful sign-in / sign-up.
async function onSignedIn() {
    await SocialAuth.loadMember({ force: true });
    await checkOwnerAccess();
    await loadFollowingState({ force: true });
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

    // Finish what the visitor was doing when the overlay interrupted them.
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

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        currentUserId = session?.user?.id || null;
        if (!session) return;

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
    ['add-venue-btn', 'search-add-venue-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isOwner ? '' : 'none';
    });
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

    showFeedLoading(true);

    // Two RPCs, one identical RETURNS TABLE, one renderFeedCard(). They are
    // separate functions rather than a p_following argument on get_venue_feed
    // because a merged function could not have an honest grant footer —
    // browsing must be anon-executable and a Following feed cannot be. See the
    // header of migration 20260903000004.
    //
    // ⚠️ Belt and braces on the mode: get_following_feed returns zero rows for
    // a null auth.uid(), which would read as "nobody you follow has posted"
    // rather than "you are signed out". Falling back to the public feed here
    // means signing out can never strand the tab on an unexplainable empty
    // state, even if a chip survived the sign-out.
    const useFollowing = feedMode === 'following' && !!currentUserId;
    const rpcName = useFollowing ? 'get_following_feed' : 'get_venue_feed';

    // Named arguments, so the new p_genre parameter landing in the middle of
    // the signature (migration 20260901000001) does not shift anything.
    // activeCategory and activeGenre are already normalized to null by
    // normalizeCategory()/normalizeGenre() — the literal strings 'all' would
    // filter on a value no row has and empty the feed silently.
    const { data, error } = await supabaseClient.rpc(rpcName, {
        p_app_id: currentApp.id,
        p_category: activeCategory,
        p_genre: activeGenre,
        p_limit: FEED_PAGE_SIZE,
        p_offset: feedOffset
    });

    feedLoading = false;
    showFeedLoading(false);

    if (error) {
        console.error('Failed to load feed:', error);
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
        renderFeedEmptyState();
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = feedItems.map(item => renderFeedCard(item)).join('');

    // Setup intersection observer for video autoplay
    setupVideoObserver();
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
    const title = empty.querySelector('h3');
    const body = empty.querySelector('p');

    if (title) {
        title.setAttribute('data-i18n', following ? 'social.emptyFollowingTitle' : 'social.emptyFeedTitle');
        title.textContent = following ? 'Nothing from your follows yet' : 'No posts yet';
    }
    if (body) {
        body.setAttribute('data-i18n', following ? 'social.emptyFollowingBody' : 'social.emptyFeedBody');
        body.textContent = following
            ? 'Follow some people and venues to fill this up.'
            : 'Check back later for venue content';
    }

    let cta = document.getElementById('feed-empty-cta');
    if (following) {
        if (!cta) {
            cta = document.createElement('button');
            cta.id = 'feed-empty-cta';
            cta.type = 'button';
            cta.className = 'auth-btn auth-btn-primary';
            cta.setAttribute('data-i18n', 'social.discoverMembers');
            cta.textContent = 'Discover Members';
            cta.addEventListener('click', () => openPeopleSheet('discover'));
            empty.appendChild(cta);
        }
        cta.style.display = '';
    } else if (cta) {
        cta.style.display = 'none';
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

function renderFeedCard(item) {
    const isVideo = item.media_type === 'video';
    const identity = postIdentity(item);

    return `
        <div class="feed-card" data-media-id="${escapeHtml(item.id)}" data-venue-id="${escapeHtml(item.venue_id || '')}">
            <div class="feed-card-header">
                ${postHeaderMarkup(identity)}
                <button class="feed-more-btn" aria-label="Post options" onclick="showPostOptions('${escapeHtml(item.id)}')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
            </div>
            <div class="feed-media" onclick="toggleVideoPlay(this)">
                ${isVideo ? `
                    <!-- preload="metadata" is the backfill story for the poster
                         frame: every post that predates thumbnail generation has
                         thumbnail_url NULL, and metadata makes the browser paint
                         the first frame instead of a grey block. No data
                         migration is possible — the column was never written. -->
                    <video src="${escapeHtml(item.url)}" poster="${escapeHtml(item.thumbnail_url || '')}" playsinline muted preload="metadata" loop></video>
                    ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
                    <button class="video-sound-btn" type="button" onclick="toggleFeedSound(event, this)"></button>
                ` : `
                    <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                `}
            </div>
            ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
        </div>
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

    mediaEl.innerHTML = `
        <video src="${escapeHtml(pin.url)}" poster="${escapeHtml(pin.thumbnail_url || '')}"
               playsinline muted loop autoplay preload="metadata"></video>
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

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    const emptyHint = document.getElementById('search-empty');
    const recentsWrap = document.getElementById('recent-searches');
    if (!resultsContainer) return;

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
        // The button ships with no label; repaintFollowButtons() is the single
        // writer of Follow/Following text so the two follow surfaces cannot
        // disagree about the same edge.
        repaintFollowButtons();
    }

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
        about += renderVenueGenreSection(venue);
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

    if (!editable) {
        if (genres.length === 0) return '';
        return `
            <div class="venue-page-genres">
                <h4 class="venue-page-genres-title" data-i18n="social.tonightsSound">Tonight's sound</h4>
                <div class="genre-chips">
                    ${genres.map(g => `<span class="genre-chip on">${escapeHtml(genreLabel(g))}</span>`).join('')}
                </div>
            </div>
        `;
    }

    const all = window.MUSIC_GENRES || [];
    return `
        <div class="venue-page-genres">
            <h4 class="venue-page-genres-title" data-i18n="social.tonightsSound">Tonight's sound</h4>
            <p class="venue-page-genres-hint" data-i18n="social.tonightsSoundHint">Tap to change what is playing. Saves instantly.</p>
            <div class="genre-chips" id="venue-genre-chips">
                ${all.map(g => `
                    <button class="genre-chip genre-chip-btn ${genres.includes(g.slug) ? 'on' : ''}"
                            type="button" aria-pressed="${genres.includes(g.slug) ? 'true' : 'false'}"
                            onclick="toggleVenueGenre('${escapeHtml(g.slug)}')"
                            data-i18n="${g.labelKey}">${escapeHtml(g.label)}</button>
                `).join('')}
            </div>
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
function repaintVenueGenres() {
    const aboutEl = document.getElementById('venue-page-about');
    const block = aboutEl?.querySelector('.venue-page-genres');
    if (!block || !venuePageVenue) return;

    block.outerHTML = renderVenueGenreSection(venuePageVenue);
    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
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
        renderVenuePageFeed();
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
    renderVenuePageFeed();
}

function renderVenuePageFeed() {
    const container = document.getElementById('venue-page-feed');
    const emptyEl = document.getElementById('venue-page-empty');
    if (!container) return;

    if (venuePageFeed.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    container.innerHTML = venuePageFeed.map(item => {
        const isVideo = item.media_type === 'video';
        // The author, not the venue — the whole page is already this venue, so
        // showVenue:false drops the "at {venue}" line that would just repeat
        // the page header above.
        //
        // A pre-UGC post has no recorded author and no backfill is possible, so
        // there is nothing to name. It keeps the old headerless card rather
        // than an inert "Someone / ?" row: on a page that is already one venue,
        // that row would add a name nobody can use and an avatar nobody can
        // open. The main feed still says "Someone" there, because a feed card
        // with no header at all reads as broken.
        const identity = postIdentity({ ...item, venue_id: null });
        const headerless = identity.primary === 'none';
        return `
            <div class="feed-card" data-media-id="${escapeHtml(item.id)}">
                <div class="feed-card-header${headerless ? ' feed-card-header-compact' : ''}">
                    ${headerless ? '' : postHeaderMarkup(identity, { showVenue: false })}
                    <button class="feed-more-btn" aria-label="Post options" onclick="showPostOptions('${escapeHtml(item.id)}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                </div>
                <div class="feed-media" onclick="toggleVideoPlay(this)">
                    ${isVideo ? `
                        <video src="${escapeHtml(item.url)}" poster="${escapeHtml(item.thumbnail_url || '')}" playsinline muted preload="metadata" loop></video>
                        ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
                        <button class="video-sound-btn" type="button" onclick="toggleFeedSound(event, this)"></button>
                    ` : `
                        <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                    `}
                </div>
                ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // Setup video autoplay observers for venue page feed
    setupVideoObserverIn(container);
    refreshSoundButtons();
}

// Same leak, same fix, for the venue page's own feed.
function setupVideoObserverIn(container) {
    if (venueVideoObserver) venueVideoObserver.disconnect();

    venueVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;
            if (entry.isIntersecting) {
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

    // Pause any playing videos in venue page
    const pageEl = document.getElementById('venue-page-feed');
    if (pageEl) {
        pageEl.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });
    }

    venuePageVenueId = null;
    venuePageVenue = null;
    venuePageFeed = [];
}

// ===== Member Profile Page =====
//
// An overlay, not a fifth tab: the bottom nav is exactly four items (a contract
// test asserts it), and a profile tab would have nothing to show the signed-out
// visitors who are most of this app's traffic.
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

    // Clearing the grid stops any <video> that was decoding a poster frame; a
    // paused video left in the DOM keeps its buffer and keeps downloading.
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
        // No follow button on your own profile: social_follows_no_self would
        // reject the write, so offering it would be a control that can only
        // ever produce an error message.
        const isSelf = !!currentUserId && currentUserId === p.user_id;
        followBtn.style.display = isSelf ? 'none' : '';
        if (!isSelf) {
            followBtn.onclick = () => toggleFollow('user', p.user_id);
            paintFollowButton(followBtn, isFollowing('user', p.user_id));
        }
    }
}

// Posts / Followers / Following. Followers and Following are buttons that open
// the people sheet — the whole point of the profile is being a route to them.
function renderMemberStats() {
    const el = document.getElementById('member-page-stats');
    const p = memberPageProfile;
    if (!el || !p) return;

    const stat = (value, labelKey, label, onclick) => `
        <button class="member-stat" type="button" ${onclick ? `onclick="${onclick}"` : 'disabled'}>
            <span class="member-stat-value">${escapeHtml(String(value ?? 0))}</span>
            <span class="member-stat-label" data-i18n="${labelKey}">${escapeHtml(label)}</span>
        </button>
    `;

    const uid = escapeHtml(p.user_id);
    el.innerHTML =
        stat(p.post_count, 'social.posts', 'Posts', null) +
        stat(p.follower_count, 'social.followers', 'Followers', `openPeopleSheet('followers', '${uid}')`) +
        stat(p.following_count, 'social.following', 'Following', `openPeopleSheet('following', '${uid}')`);

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }
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

    renderMemberGrid();
}

// A grid of poster frames, not a stack of autoplaying clips. A profile can hold
// dozens of Viibes and this overlay has no IntersectionObserver of its own —
// forty <video> elements all calling play() is how a phone runs out of memory.
// Tiles with no thumbnail_url (every post predating thumbnail generation) fall
// back to preload="metadata", which paints the first frame.
function renderMemberGrid() {
    const grid = document.getElementById('member-page-grid');
    const emptyEl = document.getElementById('member-page-empty');
    if (!grid) return;

    if (memberPagePosts.length === 0) {
        grid.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    grid.innerHTML = memberPagePosts.map(post => {
        // A tile opens the venue it was posted at. An unattached Viibe has no
        // venue page to open, so its tile is not made to look tappable.
        const onclick = post.venue_id
            ? ` onclick="closeMemberProfile(); openVenuePage('${escapeHtml(post.venue_id)}')"`
            : '';
        const label = post.venue_name || post.caption || '';

        return `
            <button class="member-grid-tile" type="button"${onclick}
                    aria-label="${escapeHtml(label)}">
                ${post.thumbnail_url
                    ? `<img src="${escapeHtml(post.thumbnail_url)}" alt="" loading="lazy">`
                    : `<video src="${escapeHtml(post.url)}" muted playsinline preload="metadata"></video>`}
                ${post.venue_name
                    // BEFORE the duration badge, not after: the chip's scrim
                    // spans the full tile width and would paint over the badge
                    // otherwise. .has-duration is what reserves the badge's
                    // corner — done with a class rather than a CSS :has()
                    // sibling rule, which is both newer than this app's
                    // baseline and silent when it fails to match.
                    ? `<span class="member-grid-venue${post.duration_seconds ? ' has-duration' : ''}">${escapeHtml(post.venue_name)}</span>`
                    : ''}
                ${post.duration_seconds ? `<span class="video-duration">${formatDuration(post.duration_seconds)}</span>` : ''}
            </button>
        `;
    }).join('');
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
        const onclick = isVenue
            ? `closePeopleSheet(); openVenuePage('${escapeHtml(row.target_id)}')`
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
                    cacheControl: '3600',
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
// Profile has no venue list, so showing the pills there was dead chrome that
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

    // Chrome hiding is scoped to the feed: #map-container's height subtracts
    // var(--nav-height), so a hidden nav on the map tab would leave a dead
    // strip. Re-run on every tab change so leaving the feed mid-scroll restores
    // the nav rather than stranding it offscreen.
    updateScrollChrome();
}

// ===== Scroll chrome =====
// One rAF-throttled window listener. Uses transform, never display: body has
// padding-bottom: calc(var(--nav-height) …), so removing the nav from flow
// would jump the page by the height of the nav on every scroll.
function setupScrollChrome() {
    window.addEventListener('scroll', () => {
        if (scrollChromeTicking) return;
        scrollChromeTicking = true;
        requestAnimationFrame(() => {
            updateScrollChrome();
            scrollChromeTicking = false;
        });
    }, { passive: true });

    document.getElementById('back-to-top')?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function updateScrollChrome() {
    const nav = document.querySelector('.bottom-nav');
    const backToTop = document.getElementById('back-to-top');
    const y = window.scrollY || window.pageYOffset || 0;

    if (activeTab !== 'feed') {
        nav?.classList.remove('hidden');
        backToTop?.classList.remove('visible');
        lastScrollY = y;
        return;
    }

    // Scrolling back up brings the nav straight back, at any depth — the
    // alternative is making someone scroll to the top of a video feed to reach
    // their own navigation.
    const scrollingUp = y < lastScrollY;
    if (nav) nav.classList.toggle('hidden', y > 100 && !scrollingUp);

    const firstCard = document.querySelector('#feed-container .feed-card');
    const threshold = firstCard ? firstCard.offsetHeight : 400;
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

    return {
        categories: (window.VENUE_CATEGORIES || []).filter(c => cats.has(c.slug)),
        genres: (window.MUSIC_GENRES || []).filter(g => genres.has(g.slug))
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

    container.innerHTML = `
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
    const media = btn ? btn.closest('.feed-media') : null;
    const video = media ? media.querySelector('video') : null;
    if (video) {
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

// One observer for the main feed, rebuilt on every render. Rebuilding is fine;
// LEAKING is not — this used to create a new IntersectionObserver per
// renderFeed() and never disconnect the old one, so after five pages of
// infinite scroll five observers were racing to play and pause the same
// elements.
function setupVideoObserver() {
    if (feedVideoObserver) feedVideoObserver.disconnect();

    feedVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
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

    document.querySelectorAll('#feed-container .feed-media').forEach(el => {
        if (el.querySelector('video')) feedVideoObserver.observe(el);
    });
}

// ===== Infinite Scroll =====
// Observes the #load-more-trigger sentinel that already sat at the bottom of the
// feed unused. Replaces a window scroll listener doing scrollHeight arithmetic —
// the observer fires only when the sentinel is actually near the viewport, so it
// costs nothing while the user is on the Map or Search tabs.
function setupInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    if (!trigger) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            if (activeTab !== 'feed' || feedLoading || !feedHasMore) return;
            loadFeed(true);
        });
    }, { rootMargin: '400px' });

    observer.observe(trigger);
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

    // Profile tab entry points
    document.getElementById('edit-profile-btn')?.addEventListener('click', openEditProfile);
    document.getElementById('discover-members-btn')?.addEventListener('click', () => openPeopleSheet('discover'));
    document.getElementById('profile-followers-btn')?.addEventListener('click', () => openPeopleSheet('followers'));
    document.getElementById('profile-following-btn')?.addEventListener('click', () => openPeopleSheet('following'));
    document.getElementById('view-my-profile-btn')?.addEventListener('click', () => {
        if (currentUserId) openMemberProfile(currentUserId);
    });

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

    // Infinite scroll
    setupInfiniteScroll();

    // Nav hide-on-scroll + back-to-top
    setupScrollChrome();

    // Add to Home Screen, and the signup prompt that shares its slot
    setupInstallPrompt();
    setupSignupPrompt();

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
    const canDelete = isOwner ||
        (!!currentUserId && !!item && item.uploaded_by_user_id === currentUserId);

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

    const { data, error } = await supabaseClient.rpc('delete_social_post', {
        p_media_id: mediaId
    });

    // A SECURITY DEFINER function that returns success:false does NOT set
    // `error`. Checking only `error` here would report "Post deleted" over a
    // rejected delete and leave the card on screen until the next reload.
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.success === false) {
        showToast(row?.error_message || error?.message || 'Could not delete that post');
        return;
    }

    // Drop it from every list that could still be showing it, rather than
    // refetching — the feed is paginated and a reload would jump the scroll
    // position back to the top.
    feedItems = feedItems.filter(i => i.id !== mediaId);
    venuePageFeed = venuePageFeed.filter(i => i.id !== mediaId);
    postPins = postPins.filter(i => i.id !== mediaId);

    renderFeed();
    if (venuePageVenueId) renderVenuePageFeed();
    if (map) renderPostPins();

    showToast('Post deleted');
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
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
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
    const caption = document.getElementById('post-caption');
    if (caption) caption.value = '';
    const countEl = document.getElementById('caption-count');
    if (countEl) countEl.textContent = '0';
    const preview = document.getElementById('upload-preview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    const placeholder = document.getElementById('upload-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
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

    const input = document.getElementById('place-search-input');
    if (input) input.value = '';
    const results = document.getElementById('place-results');
    if (results) results.innerHTML = '';
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
        if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
            window.I18n.applyTranslations();
        }
        return;
    }

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

    const coords = document.getElementById('add-venue-coords');
    if (coords) {
        coords.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span>${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}</span>
        `;
    }

    renderAddVenueCategoryOptions(window.VenuePlaces.guessCategory(place));
    renderAddVenueGenreChips();
    setFormMessage('add-venue', '');
    showAddVenueStep('confirm');
}

function renderAddVenueCategoryOptions(selected) {
    const select = document.getElementById('add-venue-category');
    if (!select) return;
    const cats = window.VENUE_CATEGORIES || [];
    select.innerHTML = cats
        .map(c => `<option value="${escapeHtml(c.slug)}"${c.slug === selected ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
        .join('');
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

async function saveNewVenue() {
    if (!pendingPlace || !currentApp) return;

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
            latitude: pendingPlace.lat,
            longitude: pendingPlace.lng,
            is_active: true,
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

    closeAddVenue();
    showToast(`${name} added`);

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
    selectedPostFile = null;
    recordedChunks = [];
    recordedDurationSeconds = null;
    composerVenueId = null;
    stopCamera();
}

// ===== Camera & Recording =====

async function startCamera() {
    if (cameraStream) return; // Already running

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera not supported on this device');
        return;
    }

    const videoConstraints = { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } };

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

    recordedChunks = [];
    recordedDurationSeconds = null;

    // Pick supported mimeType
    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

    mediaRecorder = new MediaRecorder(cameraStream, { mimeType });

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
    // user needs to see it coming.
    recordingTimerInterval = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        const remaining = Math.max(0, Math.ceil(maxSeconds - elapsed));
        if (timer) timer.textContent = `0:${remaining.toString().padStart(2, '0')}`;

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

    updatePostSubmitState();
    startCamera();
}

function updatePostSubmitState() {
    const submitBtn = document.getElementById('create-post-submit');
    if (submitBtn) submitBtn.disabled = !selectedPostFile;
}

/**
 * Grabs a poster frame from the recorded clip.
 *
 * thumbnail_url has never been written — before this it existed only in
 * migrations — so every feed card fell back to a grey block until the video
 * decoded. Resolves to null on any failure: a missing poster is cosmetic, and
 * a failed thumbnail must never fail the post.
 */
function generateThumbnail(file) {
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
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;

            // Some browsers never fire seeked for a MediaRecorder blob whose
            // duration metadata is Infinity. Cap the wait rather than leaving
            // the composer stuck on "Preparing…".
            const timer = setTimeout(() => finish(null), 6000);

            video.onloadeddata = () => {
                try {
                    const d = Number.isFinite(video.duration) ? video.duration : 0;
                    video.currentTime = d > 0.2 ? 0.1 : 0;
                } catch {
                    clearTimeout(timer);
                    finish(null);
                }
            };

            video.onseeked = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth || 720;
                    canvas.height = video.videoHeight || 1280;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob((blob) => { clearTimeout(timer); finish(blob); }, 'image/jpeg', 0.7);
                } catch {
                    clearTimeout(timer);
                    finish(null);
                }
            };

            video.onerror = () => { clearTimeout(timer); finish(null); };

            objectUrl = URL.createObjectURL(file);
            video.src = objectUrl;
        } catch {
            finish(null);
        }
    });
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
    if (progressText) progressText.textContent = 'Preparing...';

    try {
        const session = await SocialAuth.getSession();
        const userId = session?.user?.id;
        if (!userId) throw new Error('Sign in to post a Viibe');

        // Which venue, if any — whatever the picker holds, for everyone.
        //
        // There used to be an owner-only branch here that called
        // getOrCreateDefaultVenue() and auto-minted a venue named "General".
        // It is gone: venue_id is nullable, the picker is explicit, and an
        // owner who wants no venue gets no venue, same as a member.
        const venueId = composerVenueId;

        if (progressFill) progressFill.style.width = '20%';
        if (progressText) progressText.textContent = 'Uploading...';

        const timestamp = Date.now();
        const safeFilename = selectedPostFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');

        // Owners keep {orgId}/{venueId}/… — that policy and that path are
        // untouched. Members get their own prefix, which is what the new
        // "Members can upload their own venue media" policy authorizes.
        const path = (isOwner && ownerOrgId && venueId)
            ? `${ownerOrgId}/${venueId}/${timestamp}-${safeFilename}`
            : `members/${userId}/${timestamp}-${safeFilename}`;

        if (progressFill) progressFill.style.width = '40%';

        const { error: uploadError } = await supabaseClient.storage
            .from('venue-media')
            .upload(path, selectedPostFile, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabaseClient.storage
            .from('venue-media')
            .getPublicUrl(path);

        if (progressFill) progressFill.style.width = '60%';

        // Poster frame. Everything about it is best-effort.
        let thumbnailUrl = null;
        try {
            const thumbBlob = await generateThumbnail(selectedPostFile);
            if (thumbBlob) {
                const thumbPath = `${path.replace(/\.[^.]+$/, '')}-thumb.jpg`;
                const { error: thumbError } = await supabaseClient.storage
                    .from('venue-media')
                    .upload(thumbPath, thumbBlob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });

                if (!thumbError) {
                    thumbnailUrl = supabaseClient.storage
                        .from('venue-media')
                        .getPublicUrl(thumbPath).data.publicUrl;
                }
            }
        } catch (thumbErr) {
            console.warn('Thumbnail generation failed, posting without one:', thumbErr);
        }

        if (progressFill) progressFill.style.width = '80%';
        if (progressText) progressText.textContent = 'Saving...';

        // Where the clip was actually recorded. Null when location was refused;
        // the post is still perfectly valid, it just gets no pin of its own.
        const coords = await getCurrentCoords();

        const caption = document.getElementById('post-caption')?.value.trim() || null;

        const { data: postData, error: postError } = await supabaseClient.rpc('create_social_post', {
            p_app_id: currentApp.id,
            p_storage_path: path,
            p_url: urlData.publicUrl,
            p_venue_id: venueId || null,
            p_caption: caption,
            p_thumbnail_url: thumbnailUrl,
            p_duration_seconds: recordedDurationSeconds,
            p_file_size_bytes: selectedPostFile.size,
            p_latitude: coords ? coords.lat : null,
            p_longitude: coords ? coords.lng : null
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

        if (progressFill) progressFill.style.width = '100%';
        if (progressText) progressText.textContent = 'Posted!';

        setTimeout(async () => {
            closeCreatePost();
            showToast('Post published!');
            // Small delay to ensure DB propagation, then reload + scroll to top
            await new Promise(r => setTimeout(r, 300));
            await loadFeed(false);
            await loadPostPins();
            if (map) renderPostPins();
            if (venuePageVenueId) await loadVenuePageFeed(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 500);

    } catch (err) {
        console.error('Post upload failed:', err);
        if (progressFill) progressFill.style.width = '0';
        if (progressText) progressText.textContent = 'Upload failed';
        showToast(err.message || 'Failed to post. Try again.');
        if (submitBtn) submitBtn.disabled = false;
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
