/**
 * Royalty Customer App
 * Core JavaScript for the customer-facing PWA
 */

// One-time localStorage migration from Automata to Royalty branding
(function migrateCustomerStorageKeys() {
    if (localStorage.getItem('royalty_customer_migration_done')) return;
    Object.keys(localStorage).forEach(function(key) {
        if (key.startsWith('automata' + '_member_')) {
            var newKey = key.replace('automata' + '_member_', 'royalty_member_');
            if (!localStorage.getItem(newKey)) {
                localStorage.setItem(newKey, localStorage.getItem(key));
            }
            localStorage.removeItem(key);
        }
    });
    localStorage.setItem('royalty_customer_migration_done', '1');
})();

// ===== Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

// Set to true when Edge Function is deployed for secure server-side token generation
const USE_SECURE_TOKENS = true;

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== State =====
let currentApp = null;
let currentMember = null;
let memberToken = null;
let isPreviewMode = false;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    // Register service worker (skip in preview mode)
    const urlParams = new URLSearchParams(window.location.search);
    isPreviewMode = urlParams.get('preview') === 'true';

    if (!isPreviewMode) {
        registerServiceWorker();
    }

    // Check for preview mode
    if (isPreviewMode) {
        const appId = urlParams.get('app_id');
        if (!appId) {
            showError('Invalid preview URL');
            return;
        }

        // Load app by ID for preview
        await loadAppForPreview(appId);
        showPreviewBanner();
    } else {
        // Get app slug from URL
        const slug = getAppSlug();
        if (!slug) {
            showError('Invalid app URL');
            return;
        }

        // Load app data
        await loadApp(slug);
    }

    // Check for existing session (skip in preview mode)
    if (!isPreviewMode) {
        await checkSession();
    }

    // Setup event listeners
    setupEventListeners();
});

// ===== Service Worker =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/customer-app/sw.js');
            console.log('Service Worker registered:', registration.scope);
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}

// ===== URL Helpers =====
function getAppSlug() {
    // URL format: /a/{slug} or /a/{slug}/app
    const path = window.location.pathname;
    const match = path.match(/\/a\/([^\/]+)/);
    return match ? match[1] : null;
}

function isLandingPage() {
    return !window.location.pathname.includes('/app');
}

// ===== App Loading =====
async function loadApp(slug) {
    try {
        const { data, error } = await supabaseClient
            .rpc('get_app_by_slug', { p_slug: slug });

        if (error || !data || data.length === 0) {
            showError('App not found');
            return;
        }

        currentApp = data[0];

        // Apply branding
        applyBranding(currentApp.branding);

        // Update UI with app info
        updateAppUI();

    } catch (error) {
        console.error('Failed to load app:', error);
        showError('Failed to load app');
    }
}

async function loadAppForPreview(appId) {
    try {
        const { data, error } = await supabaseClient
            .rpc('preview_app_by_id', { p_app_id: appId });

        if (error || !data || data.length === 0) {
            console.error('Preview load error:', error);
            showError('App not found or preview unavailable');
            return;
        }

        currentApp = data[0];

        // Apply branding
        applyBranding(currentApp.branding);

        // Update UI with app info
        updateAppUI();

    } catch (error) {
        console.error('Failed to load app preview:', error);
        showError('Failed to load app preview');
    }
}

function showPreviewBanner() {
    const urlParams = new URLSearchParams(window.location.search);
    const isPublished = urlParams.get('published') === '1';
    const banner = document.createElement('div');
    banner.className = 'preview-banner';
    banner.innerHTML = isPublished
        ? '<span>Preview Mode</span>'
        : '<span>Preview Mode</span><span class="preview-note">This app is not yet published</span>';
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${isPublished ? '#7c3aed' : 'linear-gradient(90deg, #f59e0b, #d97706)'};
        color: white;
        text-align: center;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
    `;

    const noteStyle = banner.querySelector('.preview-note');
    if (noteStyle) {
        noteStyle.style.cssText = `
            font-weight: 400;
            opacity: 0.9;
        `;
    }

    document.body.insertBefore(banner, document.body.firstChild);

    // Add top padding to body to account for banner
    document.body.style.paddingTop = '40px';
}

function applyBranding(branding) {
    if (!branding) return;

    const root = document.documentElement;

    if (branding.primary_color) {
        root.style.setProperty('--app-primary', branding.primary_color);
        // Calculate RGB values for rgba usage
        const rgb = hexToRgb(branding.primary_color);
        if (rgb) {
            root.style.setProperty('--app-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        }
    }

    if (branding.secondary_color) {
        root.style.setProperty('--app-secondary', branding.secondary_color);
    }

    // Update theme-color meta tag
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && branding.primary_color) {
        themeColor.content = branding.primary_color;
    }
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function updateAppUI() {
    // Update page title
    document.title = currentApp.name;

    // Update header
    const headerTitle = document.querySelector('.header-title');
    if (headerTitle) headerTitle.textContent = currentApp.name;

    // Update logo
    const headerLogo = document.querySelector('.header-logo');
    if (headerLogo && currentApp.branding?.logo_url) {
        headerLogo.src = currentApp.branding.logo_url;
    }

    // Landing page specific updates
    const landingTitle = document.querySelector('.landing-title');
    if (landingTitle) landingTitle.textContent = currentApp.name;

    const landingSubtitle = document.querySelector('.landing-subtitle');
    if (landingSubtitle && currentApp.description) {
        landingSubtitle.textContent = currentApp.description;
    }

    // Update welcome bonus display
    const welcomeBonus = document.querySelector('.welcome-bonus-amount');
    if (welcomeBonus && currentApp.settings?.welcome_points) {
        welcomeBonus.textContent = currentApp.settings.welcome_points;
    }
}

// ===== Session Management =====
async function checkSession() {
    // Get token from localStorage
    const storedToken = localStorage.getItem(`royalty_member_${getAppSlug()}`);
    if (!storedToken) {
        if (!isLandingPage()) {
            // Redirect to landing page if not authenticated
            window.location.href = `/a/${getAppSlug()}`;
        }
        return;
    }

    try {
        // Verify token and get member data
        const tokenData = JSON.parse(atob(storedToken.split('.')[1]));

        // Check if token expired
        if (tokenData.exp * 1000 < Date.now()) {
            localStorage.removeItem(`royalty_member_${getAppSlug()}`);
            if (!isLandingPage()) {
                window.location.href = `/a/${getAppSlug()}`;
            }
            return;
        }

        memberToken = storedToken;
        await loadMemberData(tokenData.member_id);

        if (isLandingPage()) {
            // Redirect to main app if authenticated
            window.location.href = `/a/${getAppSlug()}/app`;
        }

    } catch (error) {
        console.error('Session check failed:', error);
        localStorage.removeItem(`royalty_member_${getAppSlug()}`);
    }
}

async function loadMemberData(memberId) {
    const { data, error } = await supabaseClient
        .rpc('get_member_profile', { p_member_id: memberId });

    if (error) {
        console.error('Failed to load member data:', error);
        showToast('Unable to load your profile. Please try again.', 'error');
        return;
    }

    // RPC returns array; take first row
    const member = Array.isArray(data) ? data[0] : data;
    if (!member) {
        console.error('Member not found:', memberId);
        return;
    }

    currentMember = member;
    updateMemberUI();
}

function updateMemberUI() {
    if (!currentMember) return;

    // Update points display
    const pointsValue = document.querySelector('.points-value');
    if (pointsValue) {
        pointsValue.textContent = formatNumber(currentMember.points_balance);
    }

    // Update tier badge — use custom tier name if available
    const tierBadge = document.querySelector('.tier-badge');
    if (tierBadge) {
        tierBadge.className = `tier-badge ${currentMember.tier}`;
        tierBadge.querySelector('span')?.remove();
        const tiers = getTierData(currentApp?.settings?.tier_thresholds);
        const tierKey = currentMember.tier || 'bronze';
        const displayName = tiers[tierKey]?.name || capitalizeFirst(tierKey);
        tierBadge.textContent = displayName;
    }

    // Update tier progress
    updateTierProgress();

    // Update profile section
    const profileName = document.querySelector('.profile-name');
    if (profileName) {
        profileName.textContent = currentMember.display_name ||
            `${currentMember.first_name || ''} ${currentMember.last_name || ''}`.trim() ||
            'Member';
    }

    const profileEmail = document.querySelector('.profile-email');
    if (profileEmail) {
        profileEmail.textContent = currentMember.email || currentMember.phone || '';
    }

    // Update avatar initials
    const profileAvatar = document.querySelector('.profile-avatar');
    if (profileAvatar) {
        const name = currentMember.first_name || currentMember.display_name || 'M';
        profileAvatar.textContent = name.charAt(0).toUpperCase();
    }

    // Load activity and other data
    loadRecentActivity();

    if (currentApp.features?.leaderboard_enabled) {
        loadLeaderboard();
    }

    if (currentApp.features?.rewards_enabled) {
        loadRewards();
    }
}

function getTierData(rawThresholds) {
    // Support both flat (silver: 500) and object ({silver: {points: 500, name: "..."}}) formats
    const t = rawThresholds || {};
    return {
        bronze: { points: 0, name: (typeof t.bronze === 'object' ? t.bronze?.name : null) || 'Bronze' },
        silver: { points: (typeof t.silver === 'object' ? t.silver?.points : t.silver) || 500, name: (typeof t.silver === 'object' ? t.silver?.name : null) || 'Silver' },
        gold: { points: (typeof t.gold === 'object' ? t.gold?.points : t.gold) || 1500, name: (typeof t.gold === 'object' ? t.gold?.name : null) || 'Gold' },
        platinum: { points: (typeof t.platinum === 'object' ? t.platinum?.points : t.platinum) || 5000, name: (typeof t.platinum === 'object' ? t.platinum?.name : null) || 'Platinum' }
    };
}

function updateTierProgress() {
    const tiers = getTierData(currentApp.settings?.tier_thresholds);

    const points = currentMember.total_points_earned || 0;
    let currentTierThreshold = 0;
    let nextTierThreshold = tiers.silver.points;
    let nextTier = tiers.silver.name;

    if (points >= tiers.platinum.points) {
        currentTierThreshold = tiers.platinum.points;
        nextTierThreshold = tiers.platinum.points;
        nextTier = 'Max';
    } else if (points >= tiers.gold.points) {
        currentTierThreshold = tiers.gold.points;
        nextTierThreshold = tiers.platinum.points;
        nextTier = tiers.platinum.name;
    } else if (points >= tiers.silver.points) {
        currentTierThreshold = tiers.silver.points;
        nextTierThreshold = tiers.gold.points;
        nextTier = tiers.gold.name;
    }

    const progress = nextTier === 'Max' ? 100 :
        ((points - currentTierThreshold) / (nextTierThreshold - currentTierThreshold)) * 100;

    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) {
        progressFill.style.width = `${Math.min(100, progress)}%`;
    }

    const progressLabels = document.querySelector('.progress-labels');
    if (progressLabels) {
        progressLabels.innerHTML = `
            <span>${formatNumber(points)} pts</span>
            <span>${nextTier === 'Max' ? 'Max Tier!' : `${formatNumber(nextTierThreshold)} for ${nextTier}`}</span>
        `;
    }
}

// ===== Input Validation =====
function validateJoinForm(formData) {
    // First name required, max 50 chars
    if (!formData.firstName || formData.firstName.trim().length === 0) {
        return { valid: false, error: 'First name is required' };
    }
    if (formData.firstName.length > 50) {
        return { valid: false, error: 'First name is too long' };
    }

    // Last name max 50 chars if provided
    if (formData.lastName && formData.lastName.length > 50) {
        return { valid: false, error: 'Last name is too long' };
    }

    // Email or phone required
    if (!formData.email && !formData.phone) {
        return { valid: false, error: 'Email or phone is required' };
    }

    // Email format validation
    if (formData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email)) {
            return { valid: false, error: 'Please enter a valid email address' };
        }
    }

    // Phone format validation (basic - allows digits, spaces, dashes, parens, plus)
    if (formData.phone) {
        const phoneClean = formData.phone.replace(/[\s\-\(\)\+]/g, '');
        if (phoneClean.length < 7 || phoneClean.length > 15 || !/^\d+$/.test(phoneClean)) {
            return { valid: false, error: 'Please enter a valid phone number' };
        }
    }

    // PIN must be exactly 4 digits
    if (!formData.pin || !/^\d{4}$/.test(formData.pin)) {
        return { valid: false, error: 'PIN must be exactly 4 digits' };
    }

    return { valid: true };
}

// ===== Join Flow =====
async function handleJoin(formData) {
    const joinBtn = document.querySelector('.join-btn');
    if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining...';
    }

    // Validate input
    const validation = validateJoinForm(formData);
    if (!validation.valid) {
        showToast(validation.error, 'error');
        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join Now';
        }
        return;
    }

    // Rate limiting check
    const signupIdentifier = formData.email || formData.phone;
    if (signupIdentifier) {
        try {
            const { data: allowed, error: rlError } = await supabaseClient.rpc('check_and_record_rate_limit', {
                p_identifier: `customer_signup_${currentApp.id}_${signupIdentifier}`,
                p_action_type: 'customer_signup',
                p_max_attempts: 10,
                p_window_minutes: 60
            });

            if (!rlError && allowed === false) {
                showToast('Too many signup attempts. Please wait and try again later.', 'error');
                if (joinBtn) {
                    joinBtn.disabled = false;
                    joinBtn.textContent = 'Join Now';
                }
                return;
            }
        } catch (e) {
            console.warn('Rate limit check failed, continuing:', e);
        }
    }

    try {
        let token, welcomePoints;

        if (USE_SECURE_TOKENS) {
            // Use Edge Function for secure server-side token generation
            // PIN is sent plaintext and hashed server-side with bcrypt
            const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-member-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY
                },
                body: JSON.stringify({
                    action: 'signup',
                    app_id: currentApp.id,
                    first_name: formData.firstName,
                    last_name: formData.lastName || '',
                    email: formData.email || null,
                    phone: formData.phone || null,
                    pin: formData.pin  // Plaintext - hashed server-side with bcrypt
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                const errorMsg = result.error || 'Failed to create account';
                if (errorMsg.includes('already registered') || errorMsg.includes('duplicate')) {
                    throw new Error('This email or phone is already registered. Please login instead.');
                }
                throw new Error(errorMsg);
            }

            token = result.token;
            welcomePoints = result.welcome_points;
        } else {
            // Fallback: Use atomic RPC for signup (creates member, transaction, and event in one call)
            // PIN is sent plaintext and hashed server-side with bcrypt
            const { data, error } = await supabaseClient.rpc('customer_app_signup', {
                p_app_id: currentApp.id,
                p_first_name: formData.firstName,
                p_last_name: formData.lastName || '',
                p_email: formData.email || null,
                p_phone: formData.phone || null,
                p_pin_hash: formData.pin  // Plaintext - stored as pin_hash
            });

            if (error) {
                console.error('Signup RPC error:', error);
                throw new Error('Failed to create account. Please try again.');
            }

            // RPC returns array with single row
            const result = data && data.length > 0 ? data[0] : data;

            if (!result || !result.success) {
                const errorMsg = result?.error_message || 'Failed to create account';
                if (errorMsg.includes('already registered') || errorMsg.includes('duplicate')) {
                    throw new Error('This email or phone is already registered. Please login instead.');
                }
                throw new Error(errorMsg);
            }

            // Generate session token with the returned member_id (client-side fallback)
            token = generateClientToken(result.member_id);
            welcomePoints = result.welcome_points;
        }

        localStorage.setItem(`royalty_member_${getAppSlug()}`, token);

        // Show success with welcome points info
        const welcomeMsg = welcomePoints > 0
            ? `Welcome! You've earned ${welcomePoints} bonus points!`
            : 'Welcome! Your account has been created.';
        showToast(welcomeMsg, 'success');

        setTimeout(() => {
            window.location.href = `/a/${getAppSlug()}/app`;
        }, 1000);

    } catch (error) {
        console.error('Join failed:', error);
        showToast(error.message || 'Failed to join. Please try again.', 'error');

        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Join Now';
        }
    }
}

async function handleLogin(pin) {
    const email = document.querySelector('#login-email')?.value?.trim().toLowerCase();
    const phone = document.querySelector('#login-phone')?.value?.trim();

    if (!email && !phone) {
        showToast('Please enter your email or phone', 'error');
        return;
    }

    if (!pin || pin.length !== 4) {
        showToast('Please enter your 4-digit PIN', 'error');
        return;
    }

    try {
        let token;

        if (USE_SECURE_TOKENS) {
            // Use Edge Function for secure server-side token generation
            // PIN is sent plaintext and verified server-side with bcrypt
            const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-member-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY
                },
                body: JSON.stringify({
                    action: 'login',
                    app_id: currentApp.id,
                    email: email || null,
                    phone: phone || null,
                    pin: pin  // Plaintext - verified server-side with bcrypt
                })
            });

            const result = await response.json();

            if (response.status === 429) {
                showToast('Too many login attempts. Please wait 15 minutes and try again.', 'error');
                return;
            }

            if (!response.ok || !result.success) {
                showToast(result.error || 'Invalid credentials', 'error');
                return;
            }

            token = result.token;
        } else {
            // Fallback: Rate limiting check (client-side)
            const identifier = email || phone;
            try {
                const { data: allowed, error: rlError } = await supabaseClient.rpc('check_and_record_rate_limit', {
                    p_identifier: `customer_login_${currentApp.id}_${identifier}`,
                    p_action_type: 'customer_login',
                    p_max_attempts: 5,
                    p_window_minutes: 15
                });

                if (!rlError && allowed === false) {
                    showToast('Too many login attempts. Please wait 15 minutes and try again.', 'error');
                    return;
                }
            } catch (e) {
                console.warn('Rate limit check failed, continuing:', e);
            }

            // PIN is sent plaintext and verified server-side with bcrypt
            const { data, error } = await supabaseClient.rpc('verify_app_member_login', {
                p_app_id: currentApp.id,
                p_email: email || null,
                p_phone: phone || null,
                p_pin_hash: pin  // Plaintext - verified server-side
            });

            if (error) {
                console.error('Login RPC error:', error);
                showToast('Login failed. Please try again.', 'error');
                return;
            }

            if (!data.success) {
                showToast(data.error_message || 'Invalid credentials', 'error');
                return;
            }

            // Generate session token (client-side fallback)
            token = generateClientToken(data.member_id);
        }

        localStorage.setItem(`royalty_member_${getAppSlug()}`, token);

        showToast('Welcome back!', 'success');

        setTimeout(() => {
            window.location.href = `/a/${getAppSlug()}/app`;
        }, 500);

    } catch (error) {
        console.error('Login failed:', error);
        showToast('Login failed. Please try again.', 'error');
    }
}

function generateClientToken(memberId) {
    // Client-side token generation (fallback when Edge Function not deployed)
    // NOTE: Set USE_SECURE_TOKENS = true after deploying the generate-member-token Edge Function
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
        member_id: memberId,
        app_id: currentApp.id,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    }));
    const signature = btoa('client-signature');
    return `${header}.${payload}.${signature}`;
}

// hashPin function removed - PIN hashing now done server-side with bcrypt

// ===== Data Loading =====
async function loadRecentActivity() {
    if (!currentMember) return;

    const { data, error } = await supabaseClient
        .rpc('get_member_activity', { p_member_id: currentMember.id, p_limit: 10 });

    if (error) {
        console.error('Failed to load activity:', error);
        showToast('Unable to load recent activity', 'error');
        return;
    }

    renderActivity(data || []);
}

function renderActivity(transactions) {
    const container = document.querySelector('.activity-list');
    if (!container) return;

    if (transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div class="empty-state-title">No activity yet</div>
                <p>Your points history will appear here</p>
            </div>
        `;
        return;
    }

    container.innerHTML = transactions.map(tx => {
        const isPositive = tx.points_change > 0;
        const iconClass = isPositive ? 'earn' : 'redeem';
        const icon = isPositive ?
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12H4"/></svg>';

        return `
            <div class="activity-item">
                <div class="activity-icon ${iconClass}">${icon}</div>
                <div class="activity-info">
                    <div class="activity-title">${escapeHtml(tx.description || tx.type)}</div>
                    <div class="activity-time">${formatTimeAgo(tx.created_at)}</div>
                </div>
                <div class="activity-points ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '+' : ''}${formatNumber(tx.points_change)}
                </div>
            </div>
        `;
    }).join('');
}

async function loadLeaderboard() {
    const { data, error } = await supabaseClient
        .rpc('get_app_leaderboard', {
            p_app_id: currentApp.id,
            p_limit: 10
        });

    if (error) {
        console.error('Failed to load leaderboard:', error);
        showToast('Unable to load leaderboard', 'error');
        return;
    }

    renderLeaderboard(data || []);
}

function renderLeaderboard(leaders) {
    const container = document.querySelector('.leaderboard-list');
    if (!container) return;

    if (leaders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div class="empty-state-title">No leaderboard yet</div>
                <p>Be the first to earn points!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = leaders.map((leader, index) => {
        const isCurrentUser = currentMember && leader.id === currentMember.id;
        const initial = (leader.display_name || 'M').charAt(0).toUpperCase();
        const name = leader.profile_public ? leader.display_name : 'Anonymous';

        return `
            <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                <div class="leaderboard-rank">${index + 1}</div>
                <div class="leaderboard-avatar">${initial}</div>
                <div class="leaderboard-info">
                    <div class="leaderboard-name">${escapeHtml(name)}${isCurrentUser ? ' (You)' : ''}</div>
                    <div class="leaderboard-tier">${getTierData(currentApp?.settings?.tier_thresholds)[leader.tier || 'bronze']?.name || capitalizeFirst(leader.tier)}</div>
                </div>
                <div class="leaderboard-points">${formatNumber(leader.total_points_earned)}</div>
            </div>
        `;
    }).join('');
}

async function loadRewards() {
    const { data, error } = await supabaseClient
        .from('app_rewards')
        .select('*')
        .eq('app_id', currentApp.id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('points_cost', { ascending: true });

    if (error) {
        console.error('Failed to load rewards:', error);
        showToast('Unable to load rewards', 'error');
        return;
    }

    renderRewards(data || []);
}

function renderRewards(rewards) {
    const container = document.querySelector('.rewards-grid');
    if (!container) return;

    if (rewards.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 8v13m0-13V6a4 4 0 00-4-4H6a2 2 0 00-2 2v1h12V4a2 2 0 00-2-2h-2a4 4 0 00-4 4v2z"/>
                    <path d="M20 8H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V10a2 2 0 00-2-2z"/>
                </svg>
                <div class="empty-state-title">No rewards yet</div>
                <p>Check back soon for exciting rewards!</p>
            </div>
        `;
        return;
    }

    const memberPoints = currentMember?.points_balance || 0;

    container.innerHTML = rewards.map(reward => {
        const canAfford = memberPoints >= reward.points_cost;

        return `
            <div class="reward-card ${canAfford ? '' : 'locked'}" data-reward-id="${reward.id}">
                ${reward.image_url ?
                    `<img class="reward-image" src="${escapeHtml(reward.image_url)}" alt="${escapeHtml(reward.name)}">` :
                    `<div class="reward-image" style="display: flex; align-items: center; justify-content: center; font-size: 2rem;">🎁</div>`
                }
                <div class="reward-content">
                    <div class="reward-name">${escapeHtml(reward.name)}</div>
                    <div class="reward-cost">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        ${formatNumber(reward.points_cost)}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.reward-card').forEach(card => {
        card.addEventListener('click', () => {
            const rewardId = card.dataset.rewardId;
            const reward = rewards.find(r => r.id === rewardId);
            if (reward) showRewardModal(reward);
        });
    });
}

function showRewardModal(reward) {
    const memberPoints = currentMember?.points_balance || 0;
    const canAfford = memberPoints >= reward.points_cost;

    const modal = document.getElementById('reward-modal') || createRewardModal();

    modal.querySelector('.reward-detail-image').src = reward.image_url || '';
    modal.querySelector('.reward-detail-image').style.display = reward.image_url ? 'block' : 'none';
    modal.querySelector('.reward-detail-name').textContent = reward.name;
    modal.querySelector('.reward-detail-description').textContent = reward.description || '';
    modal.querySelector('.reward-detail-cost').innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        ${formatNumber(reward.points_cost)} points
    `;

    const redeemBtn = modal.querySelector('.redeem-btn');
    redeemBtn.disabled = !canAfford;
    redeemBtn.textContent = canAfford ? 'Redeem Reward' : `Need ${formatNumber(reward.points_cost - memberPoints)} more points`;
    redeemBtn.onclick = () => redeemReward(reward);

    modal.classList.add('active');
}

function createRewardModal() {
    const modal = document.createElement('div');
    modal.id = 'reward-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-handle"></div>
            <img class="reward-detail-image" src="" alt="">
            <h2 class="reward-detail-name"></h2>
            <p class="reward-detail-description"></p>
            <div class="reward-detail-cost"></div>
            <button class="btn btn-primary redeem-btn">Redeem Reward</button>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    document.body.appendChild(modal);
    return modal;
}

async function redeemReward(reward) {
    if (!currentMember || currentMember.points_balance < reward.points_cost) {
        showToast('Not enough points', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .rpc('redeem_reward', {
                p_member_id: currentMember.id,
                p_reward_id: reward.id
            });

        if (error) throw error;

        // Update local state
        currentMember.points_balance -= reward.points_cost;
        updateMemberUI();

        // Close modal
        document.getElementById('reward-modal')?.classList.remove('active');

        // Show success with redemption code
        showToast(`Redeemed! Code: ${data.redemption_code}`, 'success');

        // Reload activity
        loadRecentActivity();

    } catch (error) {
        console.error('Redemption failed:', error);
        showToast(error.message || 'Redemption failed', 'error');
    }
}

// ===== Navigation =====
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    // Join form
    const joinForm = document.getElementById('join-form');
    if (joinForm) {
        joinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = {
                firstName: document.getElementById('first-name').value,
                lastName: document.getElementById('last-name').value,
                email: document.getElementById('email').value,
                phone: document.getElementById('phone').value,
                pin: getPinValue()
            };
            handleJoin(formData);
        });
    }

    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const pin = getLoginPinValue();
            handleLogin(pin);
        });
    }

    // PIN inputs auto-advance
    document.querySelectorAll('.pin-digit').forEach((input, index, inputs) => {
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });

    // Show/hide login modal
    const loginLink = document.getElementById('show-login');
    if (loginLink) {
        loginLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-modal')?.classList.add('active');
        });
    }

    // Close modals
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // Scan FAB (legacy - scanner is now in app.html via openScanner())

    // Profile settings
    const publicProfileToggle = document.querySelector('#public-profile');
    if (publicProfileToggle) {
        publicProfileToggle.checked = currentMember?.profile_public || false;
        publicProfileToggle.addEventListener('change', async (e) => {
            await updateMemberSetting('profile_public', e.target.checked);
        });
    }

    // Logout
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem(`royalty_member_${getAppSlug()}`);
            window.location.href = `/a/${getAppSlug()}`;
        });
    }
}

function switchTab(tabId) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Update tab views
    document.querySelectorAll('.tab-view').forEach(view => {
        view.classList.toggle('active', view.id === `${tabId}-view`);
    });
}

function getPinValue() {
    const digits = document.querySelectorAll('#join-form .pin-digit');
    return Array.from(digits).map(d => d.value).join('');
}

function getLoginPinValue() {
    const digits = document.querySelectorAll('#login-form .pin-digit');
    return Array.from(digits).map(d => d.value).join('');
}

async function updateMemberSetting(key, value) {
    if (!currentMember) return;

    const { error } = await supabaseClient
        .rpc('update_member_setting', {
            p_member_id: currentMember.id,
            p_key: key,
            p_value: String(value)
        });

    if (error) {
        console.error('Failed to update setting:', error);
        showToast('Failed to update setting', 'error');
    } else {
        currentMember[key] = value;
        showToast('Setting updated', 'success');
    }
}

// ===== Utilities =====
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
}

function capitalizeFirst(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    // Auto-hide
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showError(message) {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; text-align: center;">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4m0 4h.01"/>
            </svg>
            <h2 style="margin: 16px 0 8px; color: #1e293b;">Oops!</h2>
            <p style="color: #64748b;">${escapeHtml(message)}</p>
        </div>
    `;
}

// ===== Export for testing =====
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatNumber,
        formatTimeAgo,
        capitalizeFirst,
        escapeHtml
    };
}
