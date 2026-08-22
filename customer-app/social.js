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
let venuePageFeed = [];
let venuePageOffset = 0;
let venuePageHasMore = true;
let venuePageLoading = false;
let venuePageScrollHandler = null;

const FEED_PAGE_SIZE = 20;

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
            supabaseUrl: SUPABASE_URL
        });

        // Pills must exist before anything reads or highlights them
        renderCategoryPills();

        setupAuthListeners();
        await renderProfileIdentity();

        // Check if viewer is the business owner
        await checkOwnerAccess();

        // Request geolocation
        requestLocation();

        // Load venues for map
        await loadVenues();

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

    if (!enabled('categories_enabled')) {
        const pills = document.getElementById('category-pills');
        if (pills) pills.style.display = 'none';
    }
}

// Max recording length, in seconds. Read from the app row so the App Builder
// value is authoritative; falls back to the SOW's 15s for ViibeView.
function maxVideoDuration() {
    const v = parseInt(appSettings.video_max_duration, 10);
    return Number.isFinite(v) && v > 0 ? v : 15;
}

// ===== Session =====

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
}

// ===== Auth Overlay =====

function showAuth(view = 'splash') {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    setAuthView(view);
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function hideAuth() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
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
async function requireAccount(reason) {
    if (await SocialAuth.isSignedIn()) return true;
    if (reason) showToast(reason);
    showAuth('signup');
    return false;
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
    document.getElementById('auth-browse-btn')?.addEventListener('click', hideAuth);

    // Live formatting + strength feedback
    const phoneInput = document.getElementById('signup-phone');
    phoneInput?.addEventListener('input', () => {
        phoneInput.value = SocialAuth.formatPhone(phoneInput.value);
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
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;
    const acceptedTerms = document.getElementById('signup-terms').checked;

    // Field-level errors first, so the user sees exactly which input to fix
    // rather than one generic message at the bottom of the form.
    let valid = true;
    valid = setFieldError('signup-first-name', firstName.trim() ? null : 'Enter your first name') && valid;
    valid = setFieldError('signup-email', SocialAuth.validateEmail(email)) && valid;
    valid = setFieldError('signup-phone', SocialAuth.validatePhone(phone)) && valid;
    valid = setFieldError('signup-password', SocialAuth.validatePassword(password)) && valid;
    valid = setFieldError('signup-confirm', SocialAuth.validatePasswordMatch(password, confirmPassword)) && valid;
    valid = setFieldError('signup-terms', acceptedTerms ? null : 'Accept the Terms & Conditions to continue') && valid;
    if (!valid) return;

    setSubmitting('signup-submit', true, 'Creating account…');
    const result = await SocialAuth.signUp({
        email, password, confirmPassword, firstName, lastName, phone, acceptedTerms
    });
    setSubmitting('signup-submit', false);

    if (!result.ok) {
        // Email-already-taken belongs on the email field, not in the footer
        if (/already registered/i.test(result.error)) {
            setFieldError('signup-email', result.error);
        } else {
            setFormMessage('signup-form', result.error);
        }
        return;
    }

    if (result.needsConfirmation) {
        setAuthView('login');
        setFormMessage('login-form', 'Check your email to confirm your account, then log in.', 'success');
        return;
    }

    hideAuth();
    await onSignedIn();
    showToast('Account created');
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
    await renderProfileIdentity();
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
    document.body.style.overflow = 'hidden';
}

function closeContactSheet() {
    document.getElementById('contact-sheet')?.classList.remove('visible');
    document.getElementById('contact-backdrop')?.classList.remove('visible');
    document.body.style.overflow = '';
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
        document.body.style.overflow = '';
        // Replacing the nodes drops every listener — no accumulation across opens
        accept.replaceWith(accept.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
    };

    accept.addEventListener('click', async () => { close(); await onAccept(); });
    cancel.addEventListener('click', close);
    backdrop.addEventListener('click', close, { once: true });

    dialog.classList.add('visible');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

// ===== Owner Access Check =====
async function checkOwnerAccess() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
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
            const postBtn = document.querySelector('.post-btn');
            if (postBtn) postBtn.style.display = '';
        }
    } catch (e) {
        // Not an owner — that's fine, button stays hidden
    }
}

// ===== Geolocation =====
function requestLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            // Re-render feed with distances
            renderFeed();
            // Center map if it's initialized
            if (map && activeTab === 'map') {
                map.setView([userLocation.lat, userLocation.lng], 13);
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
        venues = DEMO_VENUES;
        showSampleDataNotice();
    }
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

    const pills = document.getElementById('category-pills');
    if (pills && pills.parentNode) {
        pills.parentNode.insertBefore(notice, pills.nextSibling);
    } else {
        document.body.appendChild(notice);
    }
}

function getVenueById(id) {
    return venues.find(v => v.id === id);
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

    const { data, error } = await supabaseClient.rpc('get_venue_feed', {
        p_app_id: currentApp.id,
        p_category: activeCategory,
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
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = feedItems.map(item => {
        const locationParts = [item.venue_name, item.venue_city].filter(Boolean);
        const locationText = locationParts.join(', ');
        const isVideo = item.media_type === 'video';

        // Identity comes from the venue the Viibe was posted at. get_venue_feed
        // already returns venue_handle and venue_profile_image_url; every card
        // used to render a hardcoded "@Admin" and ignore both.
        const handle = item.venue_handle
            ? `@${item.venue_handle}`
            : (item.venue_name || '');
        const avatarLetter = (item.venue_name || '?').charAt(0).toUpperCase();

        return `
            <div class="feed-card" data-media-id="${item.id}" data-venue-id="${item.venue_id}">
                <div class="feed-card-header">
                    <div class="feed-venue-info" onclick="openVenuePage('${item.venue_id}')">
                        <div class="venue-avatar">
                            ${item.venue_profile_image_url
                                ? `<img src="${escapeHtml(item.venue_profile_image_url)}" alt="">`
                                : `<div class="venue-avatar-placeholder">${escapeHtml(avatarLetter)}</div>`}
                        </div>
                        <div class="venue-meta">
                            <div class="venue-handle">${escapeHtml(handle)}</div>
                            <div class="venue-location">${escapeHtml(locationText)}</div>
                        </div>
                    </div>
                    <button class="feed-more-btn" onclick="showVenueOptions('${item.venue_id}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                </div>
                <div class="feed-media" onclick="toggleVideoPlay(this)">
                    ${isVideo ? `
                        <video src="${item.url}" poster="${item.thumbnail_url || ''}" playsinline muted preload="none" loop></video>
                        <div class="video-play-btn">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
                    ` : `
                        <img src="${item.url}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                    `}
                </div>
                ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // Setup intersection observer for video autoplay
    setupVideoObserver();
}

function showFeedLoading(show) {
    const shimmer = document.getElementById('feed-shimmer');
    if (shimmer) shimmer.style.display = show ? 'block' : 'none';
}

// ===== Map =====
function initMap() {
    if (map) return; // Already initialized

    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    const center = userLocation
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
    renderVenueSwimLane();
}

function renderMapPins() {
    if (!map) return;

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const filteredVenues = activeCategory
        ? venues.filter(v => v.category === activeCategory)
        : venues;

    filteredVenues.forEach((venue, index) => {
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

    // Fit bounds if we have venues with valid coordinates
    const geoVenues = filteredVenues.filter(v => v.latitude && v.longitude);
    if (geoVenues.length > 0 && !userLocation) {
        const bounds = L.latLngBounds(geoVenues.map(v => [v.latitude, v.longitude]));
        map.fitBounds(bounds, { padding: [40, 40] });
    }
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

    const filteredVenues = activeCategory
        ? venues.filter(v => v.category === activeCategory)
        : venues;

    // Only show venues with coordinates
    const geoVenues = filteredVenues.filter(v => v.latitude && v.longitude);

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
                    <div class="swim-card-rating">
                        ${renderStars(venue.average_rating || 0)}
                        <span class="swim-card-rating-text">${venue.average_rating || 0}</span>
                        ${venue.review_count ? `<span class="swim-card-reviews">&middot; ${venue.review_count}</span>` : ''}
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
// category column reads "bar".
function matchesQuery(v, q) {
    if (!v || !q) return false;
    const haystack = [
        v.name,
        v.handle,
        v.category,
        categoryLabel(v.category),
        v.city
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
}

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    const emptyHint = document.getElementById('search-empty');
    const recentsWrap = document.getElementById('recent-searches');
    if (!resultsContainer) return;

    // Below the 2-character threshold there are no results, so show the
    // starting state again: the hint plus any recent searches.
    if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        if (emptyHint) emptyHint.style.display = '';
        renderRecentSearches();
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

    resultsContainer.innerHTML = results.map(venue => {
        const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
        const distanceText = distance !== null ? `${distance.toFixed(1)} mi` : '';

        return `
            <div class="search-result-card" onclick="goToVenueOnMap('${venue.id}')">
                <div class="search-result-thumb">
                    ${venue.profile_image_url
                        ? `<img src="${venue.profile_image_url}" alt="">`
                        : `<div class="search-result-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(venue.name)}</div>
                    <div class="search-result-meta">
                        <span class="search-result-category">${escapeHtml(categoryLabel(venue.category))}</span>
                        ${distanceText ? `<span class="search-result-distance">${distanceText}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
    document.body.style.overflow = 'hidden';

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
                ${venue.category ? `<span class="venue-page-category">${escapeHtml(venue.category)}</span>` : ''}
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

    // Render about
    const aboutEl = document.getElementById('venue-page-about');
    if (aboutEl) {
        let about = '';
        if (venue.description) {
            about += `<p class="venue-page-description">${escapeHtml(venue.description)}</p>`;
        }
        if (venue.tags && venue.tags.length > 0) {
            about += `<div class="venue-page-tags">${venue.tags.map(t => `<span class="venue-page-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        }
        aboutEl.innerHTML = about;
        aboutEl.style.display = about ? 'block' : 'none';
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
    const { data, error } = await supabaseClient
        .from('venue_media')
        .select('id, url, thumbnail_url, media_type, caption, duration_seconds, created_at')
        .eq('venue_id', venuePageVenueId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .range(venuePageOffset, venuePageOffset + pageSize - 1);

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
        return `
            <div class="feed-card" data-media-id="${item.id}">
                <div class="feed-media" onclick="toggleVideoPlay(this)">
                    ${isVideo ? `
                        <video src="${item.url}" poster="${item.thumbnail_url || ''}" playsinline muted preload="none" loop></video>
                        <div class="video-play-btn">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
                    ` : `
                        <img src="${item.url}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                    `}
                </div>
                ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // Setup video autoplay observers for venue page feed
    setupVideoObserverIn(container);
}

function setupVideoObserverIn(container) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;
            if (entry.isIntersecting) {
                video.play().catch(() => {
                    const playBtn = entry.target.querySelector('.video-play-btn');
                    if (playBtn) playBtn.style.display = 'flex';
                });
            } else {
                video.pause();
                video.muted = true;
                const playBtn = entry.target.querySelector('.video-play-btn');
                if (playBtn) playBtn.style.display = 'flex';
            }
        });
    }, { threshold: 0.6 });

    container.querySelectorAll('.feed-media').forEach(el => {
        if (el.querySelector('video')) observer.observe(el);
    });
}

function closeVenuePage() {
    const page = document.getElementById('venue-page');
    const backdrop = document.getElementById('venue-page-backdrop');
    if (page) page.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.style.overflow = '';

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
    venuePageFeed = [];
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
    const pills = document.getElementById('category-pills');
    if (pills && appFeatures.categories_enabled !== false) {
        pills.style.display = CATEGORY_TABS.includes(tabId) ? '' : 'none';
    }

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
}

// ===== Category Filter =====

// Pills are rendered from the shared VENUE_CATEGORIES list rather than hardcoded
// in the HTML, so their slugs cannot drift from venues.category.
function renderCategoryPills() {
    const container = document.getElementById('category-pills');
    if (!container) return;

    const cats = window.VENUE_CATEGORIES || [];
    container.innerHTML = `
        <button class="pill active" data-category="${window.ALL_CATEGORY || 'all'}" role="tab" aria-selected="true" data-i18n="social.catAll">All</button>
        ${cats.map(c => `
            <button class="pill" data-category="${c.slug}" role="tab" aria-selected="false" data-i18n="${c.labelKey}">${escapeHtml(c.label)}</button>
        `).join('')}
    `;

    if (window.I18n && typeof window.I18n.applyTranslations === 'function') {
        window.I18n.applyTranslations();
    }

    pinCategoryPills();
}

// The pills stick beneath the header, whose height varies with the safe-area
// inset, so the offset has to be measured rather than hardcoded.
function pinCategoryPills() {
    const header = document.querySelector('.social-header');
    const pills = document.getElementById('category-pills');
    if (!header || !pills) return;
    pills.style.top = `${header.offsetHeight}px`;
}

function setCategory(category) {
    // 'all' means "no filter" and must reach the RPC as NULL — passing the
    // literal string made get_venue_feed filter WHERE category = 'all',
    // which returned nothing and emptied both the feed and the map.
    activeCategory = window.normalizeCategory
        ? window.normalizeCategory(category)
        : (category && category !== 'all' ? category : null);

    // Update pill active state (aria-selected too — it used to never update)
    document.querySelectorAll('.pill').forEach(pill => {
        const pillCat = window.normalizeCategory
            ? window.normalizeCategory(pill.dataset.category)
            : (pill.dataset.category || null);
        const isActive = pillCat === activeCategory;
        pill.classList.toggle('active', isActive);
        pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Reload feed with new category
    loadFeed(false);

    // Update map pins + swim lane if map is visible
    if (map) {
        renderMapPins();
        renderVenueSwimLane();
    }
}

// ===== Video Handling =====
function toggleVideoPlay(mediaEl) {
    const video = mediaEl.querySelector('video');
    if (!video) return;

    const playBtn = mediaEl.querySelector('.video-play-btn');

    if (video.paused) {
        // Pause all other videos
        document.querySelectorAll('.feed-media video').forEach(v => {
            if (v !== video) { v.pause(); v.muted = true; }
        });
        video.play();
        video.muted = false;
        if (playBtn) playBtn.style.display = 'none';
    } else {
        video.pause();
        if (playBtn) playBtn.style.display = 'flex';
    }
}

function setupVideoObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
                video.play().catch(() => {
                    // Autoplay blocked — show play button so user can tap to play
                    const playBtn = entry.target.querySelector('.video-play-btn');
                    if (playBtn) playBtn.style.display = 'flex';
                });
            } else {
                video.pause();
                video.muted = true;
                const playBtn = entry.target.querySelector('.video-play-btn');
                if (playBtn) playBtn.style.display = 'flex';
            }
        });
    }, { threshold: 0.6 });

    document.querySelectorAll('.feed-media').forEach(el => {
        if (el.querySelector('video')) observer.observe(el);
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

    // Category pills — delegated, because the pills are rendered dynamically
    // from VENUE_CATEGORIES and so don't exist when this runs.
    const pillsContainer = document.getElementById('category-pills');
    if (pillsContainer) {
        pillsContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.pill');
            if (pill) setCategory(pill.dataset.category);
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

    // Create post button + modal
    const postBtn = document.querySelector('.post-btn');
    if (postBtn) {
        postBtn.addEventListener('click', openCreatePost);
    }

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

    // Infinite scroll
    setupInfiniteScroll();

    // Re-measure the sticky offset when the header can change height
    window.addEventListener('resize', pinCategoryPills);
    window.addEventListener('orientationchange', pinCategoryPills);
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

function showVenueOptions(venueId) {
    openVenuePage(venueId);
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

async function getOrCreateDefaultVenue() {
    // Use existing real venue if available (skip demo venues)
    const realVenues = venues.filter(v => !String(v.id).startsWith('demo-'));
    if (realVenues.length > 0) return realVenues[0];

    // Auto-create a "General" venue for the org
    const { data, error } = await supabaseClient
        .from('venues')
        .insert({
            name: 'General',
            slug: 'general-' + Date.now().toString(36),
            organization_id: ownerOrgId,
            app_id: currentApp.id,
            // Must be a real slug from VENUE_CATEGORIES, otherwise this venue's
            // posts only ever surface under "All" and vanish behind every pill.
            category: 'nightlife',
            is_active: true,
            media_count: 0
        })
        .select()
        .single();

    if (error) throw new Error('Failed to create default venue: ' + error.message);

    // Add to local venues array so subsequent posts reuse it
    venues.push(data);
    return data;
}

async function openCreatePost() {
    // Signed-out visitors get the signup prompt rather than a silent no-op.
    // Hiding the button is presentation, not authorization — this function is
    // also reachable directly, and it becomes the member path in Phase 3.
    if (!(await requireAccount('Create an account to post a Viibe'))) return;

    // Posting is still owner-only until Phase 3 opens UGC to members.
    if (!isOwner) {
        showToast('Posting opens to members soon');
        return;
    }

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

    modal.classList.add('visible');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeCreatePost() {
    const modal = document.getElementById('create-post-modal');
    const backdrop = document.getElementById('create-post-backdrop');
    if (modal) modal.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.style.overflow = '';
    selectedPostFile = null;
    recordedChunks = [];
    recordedDurationSeconds = null;
    stopCamera();
}

// ===== Camera & Recording =====

async function startCamera() {
    if (cameraStream) return; // Already running

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera not supported on this device');
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

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
        if (e.name === 'NotAllowedError') {
            showToast('Camera access denied. Please allow camera access.');
        } else if (e.name === 'NotFoundError') {
            showToast('No camera found on this device');
        } else {
            showToast('Could not access camera');
            console.error('Camera error:', e);
        }
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

async function submitPost() {
    if (!selectedPostFile || !isOwner || !ownerOrgId) return;

    const submitBtn = document.getElementById('create-post-submit');
    const progress = document.getElementById('create-post-progress');
    const progressFill = document.getElementById('post-progress-fill');
    const progressText = document.getElementById('post-progress-text');

    if (submitBtn) submitBtn.disabled = true;
    if (progress) progress.style.display = 'block';
    if (progressFill) progressFill.style.width = '10%';
    if (progressText) progressText.textContent = 'Preparing...';

    try {
        // Get or create a default venue automatically
        const venue = await getOrCreateDefaultVenue();
        const venueId = venue.id;

        if (progressFill) progressFill.style.width = '20%';
        if (progressText) progressText.textContent = 'Uploading...';

        const timestamp = Date.now();
        const safeFilename = selectedPostFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${ownerOrgId}/${venueId}/${timestamp}-${safeFilename}`;

        if (progressFill) progressFill.style.width = '40%';

        const { error: uploadError } = await supabaseClient.storage
            .from('venue-media')
            .upload(path, selectedPostFile, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        if (progressFill) progressFill.style.width = '70%';
        if (progressText) progressText.textContent = 'Saving...';

        const { data: urlData } = supabaseClient.storage
            .from('venue-media')
            .getPublicUrl(path);

        const caption = document.getElementById('post-caption')?.value.trim() || null;

        const { error: insertError } = await supabaseClient
            .from('venue_media')
            .insert({
                venue_id: venueId,
                app_id: currentApp.id,
                url: urlData.publicUrl,
                media_type: 'video',
                caption: caption,
                status: 'approved',
                storage_path: path,
                duration_seconds: recordedDurationSeconds,
                file_size_bytes: selectedPostFile.size
            });

        if (insertError) throw insertError;

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

    const pills = document.getElementById('category-pills');
    if (pills && pills.parentNode) {
        pills.parentNode.insertBefore(banner, pills.nextSibling);
    } else {
        document.body.appendChild(banner);
    }
}

// ===== Toast Notifications =====
function showToast(message) {
    const existing = document.querySelector('.social-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'social-toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:9999;opacity:0;transition:opacity 0.3s;max-width:90%;text-align:center;';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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

// ===== Start =====
document.addEventListener('DOMContentLoaded', () => {
    init();
    registerServiceWorker();
});
