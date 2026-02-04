/**
 * App Builder - Multi-step wizard for creating customer apps
 */

// ===== State =====
let currentUser = null;
let currentOrganization = null;
let currentApp = null;
let currentStep = 1;
const totalSteps = 6;
let isNewApp = true;
let autoSaveTimer = null;
let hasUnsavedChanges = false;
let linkAutomationId = null; // If creating from automation, link after creation
let isOrgAdmin = false; // Track if user is admin/owner for UI visibility

// ===== App Type Feature Configurations =====
const BLOG_FEATURES = [
    { id: 'articles_enabled', icon: '&#128240;', name: 'Blog Articles', desc: 'Publish articles and posts', checked: true },
    { id: 'series_enabled', icon: '&#128218;', name: 'Article Series', desc: 'Group related articles together', checked: true },
    { id: 'topics_enabled', icon: '&#127991;', name: 'Categories & Topics', desc: 'Organize content by category', checked: true },
    { id: 'subscriber_signup', icon: '&#128231;', name: 'Subscriber Signup', desc: 'Collect email subscribers', checked: true },
    { id: 'comments_enabled', icon: '&#128172;', name: 'Comments', desc: 'Allow readers to comment', checked: false }
];

const APP_TYPE_FEATURES = {
    loyalty: [
        { id: 'points_enabled', icon: '&#127775;', name: 'Points System', desc: 'Customers earn points on visits or purchases', checked: true },
        { id: 'leaderboard_enabled', icon: '&#127942;', name: 'Leaderboard', desc: 'Show top customers and rankings', checked: true },
        { id: 'rewards_enabled', icon: '&#127873;', name: 'Rewards Catalog', desc: 'Let customers redeem points for prizes', checked: true },
        { id: 'menu_enabled', icon: '&#127860;', name: 'Menu Browser', desc: 'Show your products or services', checked: false },
        { id: 'announcements_enabled', icon: '&#128227;', name: 'Announcements', desc: 'Share updates and promotions', checked: true },
        { id: 'referrals_enabled', icon: '&#128101;', name: 'Referrals', desc: 'Let customers invite friends for bonus points', checked: false }
    ],
    blog: BLOG_FEATURES,
    rewards: [
        { id: 'points_enabled', icon: '&#127775;', name: 'Points System', desc: 'Customers earn points on visits or purchases', checked: true },
        { id: 'rewards_enabled', icon: '&#127873;', name: 'Rewards Catalog', desc: 'Let customers redeem points for prizes', checked: true },
        { id: 'leaderboard_enabled', icon: '&#127942;', name: 'Leaderboard', desc: 'Show top customers and rankings', checked: false },
        { id: 'referrals_enabled', icon: '&#128101;', name: 'Referral Program', desc: 'Reward customers for referrals', checked: true },
        { id: 'announcements_enabled', icon: '&#128227;', name: 'Announcements', desc: 'Share updates and promotions', checked: true }
    ],
    membership: [
        { id: 'tiers_enabled', icon: '&#128081;', name: 'Membership Tiers', desc: 'VIP levels with exclusive perks', checked: true },
        { id: 'points_enabled', icon: '&#127775;', name: 'Points System', desc: 'Customers earn points on visits', checked: true },
        { id: 'rewards_enabled', icon: '&#127873;', name: 'Member Perks', desc: 'Exclusive rewards for members', checked: true },
        { id: 'profile_public', icon: '&#128100;', name: 'Public Profiles', desc: 'Members can view each other', checked: false },
        { id: 'announcements_enabled', icon: '&#128227;', name: 'Member Updates', desc: 'Share news with members', checked: true }
    ],
    newsletter: BLOG_FEATURES,
    custom: [
        { id: 'points_enabled', icon: '&#127775;', name: 'Points System', desc: 'Customers earn points', checked: false },
        { id: 'rewards_enabled', icon: '&#127873;', name: 'Rewards', desc: 'Redeemable rewards', checked: false },
        { id: 'leaderboard_enabled', icon: '&#127942;', name: 'Leaderboard', desc: 'Show rankings', checked: false },
        { id: 'announcements_enabled', icon: '&#128227;', name: 'Announcements', desc: 'Share updates', checked: false },
        { id: 'menu_enabled', icon: '&#127860;', name: 'Menu Browser', desc: 'Show products', checked: false }
    ]
};

// ===== Dynamic Features Rendering =====
function renderFeaturesForAppType(appType, existingFeatures = {}) {
    const grid = document.getElementById('features-grid');
    if (!grid) return;

    const features = APP_TYPE_FEATURES[appType] || APP_TYPE_FEATURES.custom;

    grid.innerHTML = features.map(feature => {
        // Use existing feature value if available, otherwise use default
        const isChecked = existingFeatures.hasOwnProperty(feature.id)
            ? existingFeatures[feature.id]
            : feature.checked;

        return `
            <div class="feature-toggle">
                <div class="feature-info">
                    <div class="feature-icon">${feature.icon}</div>
                    <div class="feature-details">
                        <div class="feature-name">${feature.name}</div>
                        <div class="feature-desc">${feature.desc}</div>
                    </div>
                </div>
                <label class="toggle">
                    <input type="checkbox" id="feature-${feature.id}" data-feature="${feature.id}" ${isChecked ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    }).join('');

    // Re-attach change listeners for auto-save
    grid.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', scheduleAutoSave);
    });
}

function gatherFeaturesFromBuilder() {
    const features = {};
    document.querySelectorAll('#features-grid input[type="checkbox"]').forEach(input => {
        const featureId = input.dataset.feature;
        if (featureId) {
            features[featureId] = input.checked;
        }
    });
    return features;
}

// ===== Settings Visibility =====
function updateSettingsVisibility(appType) {
    // Blog and Newsletter apps don't need points/tiers settings
    const pointsSection = document.querySelector('.points-settings');
    const tiersSection = document.querySelector('.tiers-settings');
    const settingsStep = document.querySelector('[data-step="3"]');

    const isContentApp = appType === 'newsletter' || appType === 'blog';

    if (pointsSection) {
        pointsSection.style.display = isContentApp ? 'none' : '';
    }
    if (tiersSection) {
        tiersSection.style.display = isContentApp ? 'none' : '';
    }

    // Update step 3 label for content apps
    if (settingsStep) {
        const stepLabel = settingsStep.querySelector('.step-label');
        if (stepLabel) {
            stepLabel.textContent = isContentApp ? 'Subscriber Settings' : 'Points & Tiers';
        }
    }
}

// ===== Auto-Save =====
function scheduleAutoSave() {
    // Don't auto-save if organization not loaded
    if (!currentOrganization?.id) return;

    hasUnsavedChanges = true;
    updateSaveIndicator('unsaved');

    // Clear existing timer
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }

    // Schedule auto-save after 2 seconds of inactivity
    autoSaveTimer = setTimeout(async () => {
        if (hasUnsavedChanges) {
            updateSaveIndicator('saving');
            await saveApp(true);
            hasUnsavedChanges = false;
            updateSaveIndicator('saved');
        }
    }, 2000);
}

function updateSaveIndicator(status) {
    const btn = document.getElementById('save-draft-btn');
    if (!btn) return;

    switch (status) {
        case 'saving':
            btn.textContent = 'Saving...';
            btn.disabled = true;
            break;
        case 'saved':
            btn.textContent = 'Saved';
            btn.disabled = false;
            setTimeout(() => {
                btn.textContent = 'Save Draft';
            }, 2000);
            break;
        case 'unsaved':
            btn.textContent = 'Save Draft •';
            btn.disabled = false;
            break;
        default:
            btn.textContent = 'Save Draft';
            btn.disabled = false;
    }
}

// ===== Initialization =====
async function initAppBuilder() {
    try {
        // Check authentication
        currentUser = await requireAuth();

        // Load user info and organization
        const orgLoaded = await loadUserInfo();

        // If organization failed to load, don't proceed
        if (!orgLoaded || !currentOrganization?.id) {
            document.getElementById('loading').style.display = 'none';
            showPersistentError('Failed to load your organization.', '/app/settings.html');
            return;
        }

        // Check if editing existing app or creating from automation/project
        const urlParams = new URLSearchParams(window.location.search);
        const appId = urlParams.get('id');
        const presetProjectId = urlParams.get('projectId'); // Pre-select project if creating from project page
        linkAutomationId = urlParams.get('linkAutomation'); // Store for later linking
        console.log('[App Builder] URL params - id:', appId, 'projectId:', presetProjectId);

        // Update slug prefix to show current domain
        const slugPrefix = document.querySelector('.slug-prefix');
        if (slugPrefix) {
            slugPrefix.textContent = `${getBaseUrl()}/a/`;
        }

        // Load projects for dropdown
        await loadProjects();

        // Pre-select project if coming from project page
        if (presetProjectId) {
            const projectSelect = document.getElementById('app-project');
            if (projectSelect) {
                projectSelect.value = presetProjectId;
            }
        }

        if (appId) {
            isNewApp = false;
            await loadApp(appId);
        } else {
            // New app - render default features and show first step
            const defaultType = 'loyalty';
            renderFeaturesForAppType(defaultType);
            updateSettingsVisibility(defaultType);
            showStep(1);
        }

        // Setup event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Failed to initialize app builder:', error);
        showError('Failed to load app builder. Please try again.');
    }
}

// ===== Data Loading =====
async function loadUserInfo() {
    try {
        // First get the profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (profileError) {
            console.error('Failed to load profile:', profileError);
            return false;
        }

        // Then get the organization membership separately
        const { data: membership, error: memberError } = await supabase
            .from('organization_members')
            .select(`
                role,
                organizations (
                    id,
                    name,
                    plan
                )
            `)
            .eq('user_id', currentUser.id)
            .limit(1)
            .single();

        if (memberError) {
            console.error('Failed to load organization:', memberError);
            // Continue without organization - will fail gracefully later
        }

        currentOrganization = membership?.organizations;

        // Check if organization was found
        if (!currentOrganization?.id) {
            console.warn('No organization found for user');
            return false;
        }

        // Check if user is admin/owner (for UI visibility)
        isOrgAdmin = membership?.role === 'owner' || membership?.role === 'admin';

        // Update sidebar with user data (including role for admin features)
        if (typeof AppSidebar !== 'undefined') {
            AppSidebar.init({
                name: profile.full_name || profile.email,
                email: profile.email,
                organization: currentOrganization,
                role: membership?.role,
                isAdmin: profile?.is_admin === true
            });
        }

        // Apply admin-only UI visibility
        updateAdminOnlyElements();

        return true;
    } catch (error) {
        console.error('Error in loadUserInfo:', error);
        return false;
    }
}

// ===== Admin-Only UI Visibility =====
function updateAdminOnlyElements() {
    // Elements to hide for non-admin (SMB) users
    const projectGroup = document.getElementById('app-project')?.closest('.form-group');
    const typeGroup = document.querySelector('.type-cards')?.closest('.form-group');

    if (!isOrgAdmin) {
        // Hide "Link to Project" dropdown
        if (projectGroup) {
            projectGroup.style.display = 'none';
        }

        // Hide App Type selection (auto-select loyalty for SMB users)
        if (typeGroup) {
            typeGroup.style.display = 'none';
        }

        // Ensure loyalty is selected by default for SMB users
        const loyaltyCard = document.querySelector('.type-card[data-type="loyalty"]');
        if (loyaltyCard) {
            document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
            loyaltyCard.classList.add('selected');
            const loyaltyInput = loyaltyCard.querySelector('input');
            if (loyaltyInput) loyaltyInput.checked = true;
        }
    }
}

async function loadProjects() {
    if (!currentOrganization?.id) return;

    try {
        const { data: projects, error } = await supabase
            .from('projects')
            .select('id, name')
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('name');

        if (error) throw error;

        const select = document.getElementById('app-project');
        if (select && projects) {
            projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

async function loadApp(appId) {
    console.log('[App Builder] Loading app:', appId);
    document.getElementById('loading').style.display = 'flex';

    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('*')
            .eq('id', appId)
            .single();

        if (error) {
            // Check if table doesn't exist (need to run migration)
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                console.warn('customer_apps table does not exist. Please run the migration.');
                showError('Database tables not set up. Please contact support.');
                setTimeout(() => {
                    window.location.href = '/app/apps.html';
                }, 2000);
                return;
            }
            throw error;
        }

        console.log('[App Builder] App loaded:', data.name, data.id);
        currentApp = data;

        // Update title
        document.getElementById('builder-title').textContent = data.name;

        // Populate form fields
        populateFormFromApp(data);

        // Show first step
        showStep(1);

        // Enable publish button if app is ready
        updatePublishButton();

    } catch (error) {
        console.error('[App Builder] Failed to load app:', error);
        document.getElementById('loading').style.display = 'none';

        // Show error state on the builder page instead of redirecting
        const mainContent = document.querySelector('.builder-content') || document.querySelector('main');
        if (mainContent) {
            mainContent.innerHTML = `
                <div style="text-align: center; padding: 60px 20px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
                         stroke="var(--color-text-tertiary)" stroke-width="1.5" style="margin-bottom: 16px;">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <h2 style="margin-bottom: 8px;">Unable to load app</h2>
                    <p style="color: var(--color-text-secondary); margin-bottom: 24px;">
                        The app could not be found or you don't have permission to edit it.
                    </p>
                    <a href="/app/dashboard.html" class="btn btn-primary">Back to Dashboard</a>
                </div>
            `;
        }
    }
}

function populateFormFromApp(app) {
    // Step 1: Basics
    document.getElementById('app-name').value = app.name || '';
    document.getElementById('app-description').value = app.description || '';
    document.getElementById('app-slug').value = app.slug || '';

    // Set project dropdown
    const projectSelect = document.getElementById('app-project');
    if (projectSelect && app.project_id) {
        projectSelect.value = app.project_id;
    }

    // Select app type
    const appType = app.app_type || 'loyalty';
    let typeCard = document.querySelector(`.type-card[data-type="${appType}"]`);

    // Fallback to loyalty if app type not recognized
    if (!typeCard) {
        console.warn('App type not found:', appType, '- falling back to loyalty');
        typeCard = document.querySelector('.type-card[data-type="loyalty"]');
    }

    if (typeCard) {
        document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
        typeCard.classList.add('selected');
        const typeInput = typeCard.querySelector('input');
        if (typeInput) {
            typeInput.checked = true;
        }
    }

    // Step 2: Features - render dynamically based on app type
    const features = app.features || {};
    renderFeaturesForAppType(appType, features);

    // Update settings visibility based on app type
    updateSettingsVisibility(appType);

    // Step 3: Settings
    const settings = app.settings || {};
    document.getElementById('points-per-scan').value = settings.points_per_scan || 10;
    document.getElementById('points-per-dollar').value = settings.points_per_dollar || 1;
    document.getElementById('welcome-points').value = settings.welcome_points || 50;
    document.getElementById('daily-scan-limit').value = settings.daily_scan_limit || 5;

    const tiers = settings.tier_thresholds || {};
    document.getElementById('tier-silver').value = tiers.silver || 500;
    document.getElementById('tier-gold').value = tiers.gold || 1500;
    document.getElementById('tier-platinum').value = tiers.platinum || 5000;

    const requireEmailEl = document.getElementById('require-email');
    const requirePhoneEl = document.getElementById('require-phone');
    if (requireEmailEl) requireEmailEl.checked = settings.require_email !== false;
    if (requirePhoneEl) requirePhoneEl.checked = settings.require_phone === true;

    // Step 4: Branding
    const branding = app.branding || {};
    const primaryColor = branding.primary_color || '#7c3aed';
    const secondaryColor = branding.secondary_color || '#1e293b';

    document.getElementById('primary-color').value = primaryColor;
    document.getElementById('primary-color-hex').value = primaryColor;
    document.getElementById('secondary-color').value = secondaryColor;
    document.getElementById('secondary-color-hex').value = secondaryColor;

    // Logo fit option
    const logoFit = branding.logo_fit || 'contain';
    const logoFitRadio = document.querySelector(`input[name="logo-fit"][value="${logoFit}"]`);
    if (logoFitRadio) logoFitRadio.checked = true;

    // Business info (stored inside branding JSONB)
    const businessInfo = branding.business_info || {};
    document.getElementById('business-hours').value = businessInfo.hours || '';
    document.getElementById('business-phone').value = businessInfo.phone || '';
    document.getElementById('business-email').value = businessInfo.email || '';
    document.getElementById('business-address').value = businessInfo.address || '';

    // Social links
    const social = businessInfo.social || {};
    document.getElementById('social-instagram').value = social.instagram || '';
    document.getElementById('social-facebook').value = social.facebook || '';
    document.getElementById('social-twitter').value = social.twitter || '';
    document.getElementById('social-tiktok').value = social.tiktok || '';
    document.getElementById('social-youtube').value = social.youtube || '';
    document.getElementById('social-snapchat').value = social.snapchat || '';
    document.getElementById('social-pinterest').value = social.pinterest || '';
    document.getElementById('social-website').value = social.website || '';

    updateBrandPreview();
}

// ===== Step Navigation =====
function showStep(step) {
    currentStep = step;

    // Hide loading, show navigation
    document.getElementById('loading').style.display = 'none';
    document.getElementById('step-nav').style.display = 'flex';

    // Hide all steps
    document.querySelectorAll('.builder-step').forEach(s => s.style.display = 'none');

    // Show current step
    document.getElementById(`step-${step}`).style.display = 'block';

    // Update progress
    document.querySelectorAll('.progress-step').forEach((s, i) => {
        s.classList.remove('active', 'completed');
        if (i + 1 < step) s.classList.add('completed');
        if (i + 1 === step) s.classList.add('active');
    });

    // Update navigation buttons
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    prevBtn.style.visibility = step > 1 ? 'visible' : 'hidden';

    if (step === totalSteps) {
        nextBtn.innerHTML = `
            Publish App
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
        `;
    } else {
        nextBtn.innerHTML = `
            Next
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        `;
    }

    // Special handling for certain steps
    if (step === 5) generateQRCode();
    if (step === 6) updatePreview();
}

function nextStep() {
    if (currentStep < totalSteps) {
        // Validate current step
        if (!validateStep(currentStep)) return;

        // Auto-save on step change
        saveApp(true);

        showStep(currentStep + 1);
    } else {
        // Final step - publish
        publishApp();
    }
}

function prevStep() {
    if (currentStep > 1) {
        showStep(currentStep - 1);
    }
}

function validateStep(step) {
    switch (step) {
        case 1:
            const name = document.getElementById('app-name').value.trim();
            if (!name) {
                showError('Please enter an app name');
                document.getElementById('app-name').focus();
                return false;
            }
            return true;
        default:
            return true;
    }
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Navigation
    document.getElementById('next-btn').addEventListener('click', nextStep);
    document.getElementById('prev-btn').addEventListener('click', prevStep);

    // Progress step clicks
    document.querySelectorAll('.progress-step').forEach(step => {
        step.addEventListener('click', () => {
            const stepNum = parseInt(step.dataset.step);
            if (stepNum <= currentStep || !isNewApp) {
                showStep(stepNum);
            }
        });
    });

    // Save draft
    document.getElementById('save-draft-btn').addEventListener('click', () => saveApp(false));

    // Publish
    document.getElementById('publish-btn').addEventListener('click', publishApp);

    // Preview in browser
    document.getElementById('preview-in-browser-btn').addEventListener('click', openPreviewInBrowser);

    // Type cards
    document.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            card.querySelector('input').checked = true;
        });
    });

    // Slug auto-generation
    document.getElementById('app-name').addEventListener('input', (e) => {
        if (isNewApp) {
            const slug = generateSlug(e.target.value);
            document.getElementById('app-slug').value = slug;
        }
        document.getElementById('builder-title').textContent = e.target.value || 'New App';
        scheduleAutoSave();
    });

    // Auto-save on any form field change
    setupAutoSaveListeners();

    // Color pickers
    document.getElementById('primary-color').addEventListener('input', (e) => {
        document.getElementById('primary-color-hex').value = e.target.value;
        updateBrandPreview();
    });

    document.getElementById('primary-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            document.getElementById('primary-color').value = e.target.value;
            updateBrandPreview();
        }
    });

    document.getElementById('secondary-color').addEventListener('input', (e) => {
        document.getElementById('secondary-color-hex').value = e.target.value;
        updateBrandPreview();
    });

    document.getElementById('secondary-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            document.getElementById('secondary-color').value = e.target.value;
            updateBrandPreview();
        }
    });

    // Logo upload
    document.getElementById('upload-logo-btn').addEventListener('click', () => {
        document.getElementById('logo-input').click();
    });

    document.getElementById('logo-input').addEventListener('change', handleLogoUpload);

    // QR code and share actions
    document.getElementById('copy-url-btn').addEventListener('click', copyAppUrl);
    document.getElementById('download-qr-btn').addEventListener('click', downloadQRCode);
    document.getElementById('print-qr-btn').addEventListener('click', printQRCode);

    // Share buttons
    document.getElementById('share-native-btn').addEventListener('click', shareNative);
    document.getElementById('share-whatsapp-btn').addEventListener('click', shareWhatsApp);
    document.getElementById('share-sms-btn').addEventListener('click', shareSMS);
    document.getElementById('share-email-btn').addEventListener('click', shareEmail);

    // URL input click to select all
    document.getElementById('share-url-input').addEventListener('click', (e) => {
        e.target.select();
    });
}

function setupAutoSaveListeners() {
    // List of all form field IDs that should trigger auto-save
    const textFields = [
        'app-name', 'app-description', 'app-slug',
        'points-per-scan', 'points-per-dollar', 'welcome-points', 'daily-scan-limit',
        'tier-silver', 'tier-gold', 'tier-platinum',
        'primary-color-hex', 'secondary-color-hex',
        // Business info fields
        'business-hours', 'business-phone', 'business-email', 'business-address',
        // Social links
        'social-instagram', 'social-facebook', 'social-twitter', 'social-tiktok',
        'social-youtube', 'social-snapchat', 'social-pinterest', 'social-website'
    ];

    const checkboxFields = [
        'feature-points', 'feature-leaderboard', 'feature-rewards',
        'feature-menu', 'feature-announcements', 'feature-referrals',
        'require-email', 'require-phone'
    ];

    // Text/number inputs - save on input with debounce
    textFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', scheduleAutoSave);
        }
    });

    // Checkboxes - save immediately on change
    checkboxFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', scheduleAutoSave);
        }
    });

    // Radio buttons (app type, logo fit)
    document.querySelectorAll('input[name="app-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            // Re-render features for the new app type
            renderFeaturesForAppType(e.target.value);
            // Update settings section visibility (newsletter doesn't need points/tiers)
            updateSettingsVisibility(e.target.value);
            scheduleAutoSave();
        });
    });
    document.querySelectorAll('input[name="logo-fit"]').forEach(radio => {
        radio.addEventListener('change', scheduleAutoSave);
    });

    // Color pickers
    ['primary-color', 'secondary-color'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', scheduleAutoSave);
        }
    });
}

// ===== App Data =====
function getAppData() {
    if (!currentOrganization?.id) {
        throw new Error('Organization not loaded. Please refresh the page.');
    }
    // Properly handle empty string as null for UUID foreign key
    const projectSelect = document.getElementById('app-project');
    const projectId = projectSelect?.value && projectSelect.value.trim() !== '' ? projectSelect.value : null;
    const appType = document.querySelector('input[name="app-type"]:checked')?.value || 'loyalty';

    // Get checkbox states with fallbacks
    const requireEmailEl = document.getElementById('require-email');
    const requirePhoneEl = document.getElementById('require-phone');

    return {
        organization_id: currentOrganization.id,
        project_id: projectId,
        name: document.getElementById('app-name').value.trim(),
        slug: document.getElementById('app-slug').value.trim() || generateSlug(document.getElementById('app-name').value),
        description: document.getElementById('app-description').value.trim(),
        app_type: appType,
        features: gatherFeaturesFromBuilder(),
        settings: {
            points_per_scan: parseInt(document.getElementById('points-per-scan').value) || 10,
            points_per_dollar: parseInt(document.getElementById('points-per-dollar').value) || 1,
            welcome_points: parseInt(document.getElementById('welcome-points').value) || 50,
            daily_scan_limit: parseInt(document.getElementById('daily-scan-limit').value) || 5,
            require_email: requireEmailEl ? requireEmailEl.checked : true,
            require_phone: requirePhoneEl ? requirePhoneEl.checked : false,
            tier_thresholds: {
                silver: parseInt(document.getElementById('tier-silver').value) || 500,
                gold: parseInt(document.getElementById('tier-gold').value) || 1500,
                platinum: parseInt(document.getElementById('tier-platinum').value) || 5000
            }
        },
        // Store business_info inside branding since customer_apps table doesn't have business_info column
        branding: {
            primary_color: document.getElementById('primary-color').value,
            secondary_color: document.getElementById('secondary-color').value,
            logo_url: currentApp?.branding?.logo_url || null,
            logo_fit: document.querySelector('input[name="logo-fit"]:checked')?.value || 'contain',
            favicon_url: null,
            custom_css: null,
            // Business info stored inside branding JSONB
            business_info: {
                hours: document.getElementById('business-hours')?.value.trim() || null,
                phone: document.getElementById('business-phone')?.value.trim() || null,
                email: document.getElementById('business-email')?.value.trim() || null,
                address: document.getElementById('business-address')?.value.trim() || null,
                social: {
                    instagram: document.getElementById('social-instagram')?.value.trim() || null,
                    facebook: document.getElementById('social-facebook')?.value.trim() || null,
                    twitter: document.getElementById('social-twitter')?.value.trim() || null,
                    tiktok: document.getElementById('social-tiktok')?.value.trim() || null,
                    youtube: document.getElementById('social-youtube')?.value.trim() || null,
                    snapchat: document.getElementById('social-snapchat')?.value.trim() || null,
                    pinterest: document.getElementById('social-pinterest')?.value.trim() || null,
                    website: document.getElementById('social-website')?.value.trim() || null
                }
            }
        }
    };
}

async function saveApp(silent = false) {
    const appData = getAppData();

    try {
        if (currentApp) {
            // Update existing app
            const { error } = await supabase
                .from('customer_apps')
                .update(appData)
                .eq('id', currentApp.id);

            if (error) throw error;
            currentApp = { ...currentApp, ...appData };
        } else {
            // Create new app
            const { data, error } = await supabase
                .from('customer_apps')
                .insert([{
                    ...appData,
                    is_active: false,
                    is_published: false
                }])
                .select()
                .single();

            if (error) {
                if (error.code === '23505' && error.message.includes('slug')) {
                    throw new Error('This URL slug is already taken. Please choose a different one.');
                }
                throw error;
            }

            currentApp = data;
            isNewApp = false;

            // Update URL without reload
            window.history.replaceState({}, '', `/app/app-builder.html?id=${data.id}`);

            // Link to automation if we came from automation page
            if (linkAutomationId) {
                await linkAppToAutomation(data.id, linkAutomationId);
                linkAutomationId = null; // Only link once
            }
        }

        if (!silent) {
            showSuccess('App saved successfully!');
        }

        updatePublishButton();

    } catch (error) {
        console.error('Failed to save app:', error);
        // Show more detailed error message
        const errorMsg = error.message || error.details || error.hint || 'Failed to save app';
        console.error('Error details:', { message: error.message, details: error.details, hint: error.hint, code: error.code });
        showError(errorMsg);
    }
}

async function publishApp() {
    try {
        // Save first
        await saveApp(true);

        // Update status
        const { error } = await supabase
            .from('customer_apps')
            .update({
                is_active: true,
                is_published: true
            })
            .eq('id', currentApp.id);

        if (error) throw error;

        showSuccess('App published successfully!');

        // Redirect to apps list
        setTimeout(() => {
            window.location.href = '/app/apps.html';
        }, 1500);

    } catch (error) {
        console.error('Failed to publish app:', error);
        showError('Failed to publish app');
    }
}

function updatePublishButton() {
    const btn = document.getElementById('publish-btn');
    btn.disabled = !currentApp;
}

function openPreviewInBrowser() {
    if (!currentApp || !currentApp.id) {
        showError('Please save the app first');
        return;
    }

    // Open preview in new tab with preview mode parameters
    const previewUrl = `/customer-app/index.html?preview=true&app_id=${currentApp.id}`;
    window.open(previewUrl, '_blank');
}

// Link app to automation (when creating from automation page)
async function linkAppToAutomation(appId, automationId) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ app_id: appId })
            .eq('id', automationId);

        if (error) {
            console.error('Failed to link app to automation:', error);
            // Non-blocking - app was created successfully
        } else {
            console.log('App linked to automation:', automationId);
        }
    } catch (error) {
        console.error('Error linking app to automation:', error);
    }
}

// ===== Brand Preview =====
function updateBrandPreview() {
    const primary = document.getElementById('primary-color').value;
    const secondary = document.getElementById('secondary-color').value;

    const preview = document.getElementById('brand-preview');
    const header = preview.querySelector('.preview-header');
    const btn = preview.querySelector('.preview-btn');
    const pointsValue = preview.querySelector('.points-value');

    header.style.background = primary;
    btn.style.background = primary;
    pointsValue.style.color = primary;

    // Update phone preview too
    const phonePreview = document.getElementById('phone-preview');
    if (phonePreview) {
        const logo = phonePreview.querySelector('.app-preview-logo');
        const pointsNum = phonePreview.querySelector('.points-number');
        if (logo) logo.style.background = primary;
        if (pointsNum) pointsNum.style.color = primary;
    }
}

// ===== Logo Upload =====
async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate size
    if (file.size > 2 * 1024 * 1024) {
        showError('Logo must be less than 2MB');
        return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (event) => {
        const preview = document.getElementById('logo-preview');
        preview.innerHTML = `<img src="${event.target.result}" alt="Logo">`;
    };
    reader.readAsDataURL(file);

    // TODO: Upload to Supabase Storage
    // For now, just show the preview
}

// ===== QR Code & Sharing =====
function getBaseUrl() {
    // Use current origin for dynamic URL support
    return window.location.origin;
}

function generateQRCode() {
    const slug = document.getElementById('app-slug').value || 'your-app';
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/a/${slug}`;

    // Update URL displays
    document.getElementById('qr-url-display').textContent = url;
    document.getElementById('share-url-input').value = url;

    // Also update the slug prefix display
    const slugPrefix = document.querySelector('.slug-prefix');
    if (slugPrefix) {
        slugPrefix.textContent = `${baseUrl}/a/`;
    }

    const container = document.getElementById('qr-code');

    // Clear previous
    container.innerHTML = '';

    // Try using the loaded QRCode library first
    if (typeof QRCode !== 'undefined' && typeof QRCode.toCanvas === 'function') {
        try {
            QRCode.toCanvas(document.createElement('canvas'), url, {
                width: 220,
                margin: 2,
                color: {
                    dark: '#1e293b',
                    light: '#ffffff'
                }
            }, (error, canvas) => {
                if (error) {
                    console.error('QR generation error:', error);
                    generateQRCodeFallback(container, url);
                    return;
                }
                container.innerHTML = '';
                container.appendChild(canvas);
            });
        } catch (e) {
            console.warn('QRCode library error:', e);
            generateQRCodeFallback(container, url);
        }
    } else {
        console.warn('QRCode library not loaded, using fallback');
        generateQRCodeFallback(container, url);
    }
}

// Fallback QR code generation using API
function generateQRCodeFallback(container, url) {
    // Use a free QR code API as fallback
    const encodedUrl = encodeURIComponent(url);
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodedUrl}&bgcolor=ffffff&color=1e293b&margin=8`;

    const img = document.createElement('img');
    img.src = qrApiUrl;
    img.alt = 'QR Code';
    img.style.width = '220px';
    img.style.height = '220px';
    img.style.borderRadius = '8px';

    img.onerror = () => {
        container.innerHTML = '<div class="qr-placeholder" style="width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; background: var(--color-bg-secondary); border-radius: 8px; font-size: 12px; color: var(--color-text-muted);">QR code will generate when connected</div>';
    };

    container.innerHTML = '';
    container.appendChild(img);
}

function getAppUrl() {
    return document.getElementById('share-url-input')?.value ||
           document.getElementById('qr-url-display')?.textContent ||
           `${getBaseUrl()}/a/${document.getElementById('app-slug').value || 'your-app'}`;
}

function getShareMessage() {
    const appName = currentApp?.name || document.getElementById('app-name').value || 'our loyalty program';
    return `Join ${appName} and start earning rewards! ${getAppUrl()}`;
}

function copyAppUrl() {
    const url = getAppUrl();
    const btn = document.getElementById('copy-url-btn');
    const btnText = document.getElementById('copy-btn-text');

    navigator.clipboard.writeText(url).then(() => {
        // Visual feedback
        btn.classList.add('btn-copied');
        btnText.textContent = 'Copied!';

        // Reset after 2 seconds
        setTimeout(() => {
            btn.classList.remove('btn-copied');
            btnText.textContent = 'Copy Link';
        }, 2000);

        showSuccess('Link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const input = document.getElementById('share-url-input');
        input.select();
        document.execCommand('copy');
        showSuccess('Link copied to clipboard!');
    });
}

async function shareNative() {
    const url = getAppUrl();
    const appName = currentApp?.name || document.getElementById('app-name').value || 'My Loyalty Program';

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Join ${appName}`,
                text: `Join ${appName} and start earning rewards!`,
                url: url
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                // User cancelled - not an error
                console.error('Share failed:', err);
            }
        }
    } else {
        // Fallback - copy to clipboard
        copyAppUrl();
    }
}

function shareWhatsApp() {
    const message = getShareMessage();
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
}

function shareSMS() {
    const message = getShareMessage();
    // SMS link format varies by platform
    const smsUrl = `sms:?body=${encodeURIComponent(message)}`;
    window.location.href = smsUrl;
}

function shareEmail() {
    const appName = currentApp?.name || document.getElementById('app-name').value || 'our loyalty program';
    const url = getAppUrl();
    const subject = `Join ${appName}`;
    const body = `Hey!\n\nI wanted to share ${appName} with you. Join and start earning rewards!\n\n${url}\n\nSee you there!`;

    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
}

function downloadQRCode() {
    const canvas = document.querySelector('#qr-code canvas');
    const img = document.querySelector('#qr-code img');

    if (canvas) {
        // Download from canvas
        const link = document.createElement('a');
        link.download = `${currentApp?.slug || 'app'}-qr-code.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } else if (img && img.src) {
        // Download from API-generated image
        // Fetch the image and create a download link
        fetch(img.src)
            .then(response => response.blob())
            .then(blob => {
                const link = document.createElement('a');
                link.download = `${currentApp?.slug || 'app'}-qr-code.png`;
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
            })
            .catch(() => {
                // Fallback: open image in new tab
                window.open(img.src, '_blank');
            });
    } else {
        showError('Please generate QR code first');
    }
}

function printQRCode() {
    const canvas = document.querySelector('#qr-code canvas');
    const img = document.querySelector('#qr-code img');

    let imgSrc = '';
    if (canvas) {
        imgSrc = canvas.toDataURL();
    } else if (img && img.src) {
        imgSrc = img.src;
    } else {
        showError('Please generate QR code first');
        return;
    }

    const win = window.open('', '_blank');
    win.document.write(`
        <html>
        <head><title>QR Code - ${currentApp?.name || 'App'}</title></head>
        <body style="display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;">
            <div style="text-align: center;">
                <img src="${imgSrc}" style="width: 300px; height: 300px;">
                <p style="font-family: sans-serif; font-size: 18px; margin-top: 20px;">
                    Scan to join ${currentApp?.name || 'our loyalty program'}
                </p>
                <p style="font-family: monospace; color: #7c3aed;">
                    ${document.getElementById('qr-url-display').textContent}
                </p>
            </div>
        </body>
        </html>
    `);
    win.document.close();
    win.print();
}

// ===== Preview =====
function updatePreview() {
    const appData = getAppData();

    // Update summary
    document.getElementById('summary-name').textContent = appData.name || '-';
    document.getElementById('summary-type').textContent = appData.app_type.charAt(0).toUpperCase() + appData.app_type.slice(1);

    const enabledFeatures = [];
    if (appData.features.points_enabled) enabledFeatures.push('Points');
    if (appData.features.leaderboard_enabled) enabledFeatures.push('Leaderboard');
    if (appData.features.rewards_enabled) enabledFeatures.push('Rewards');
    if (appData.features.menu_enabled) enabledFeatures.push('Menu');
    document.getElementById('summary-features').textContent = enabledFeatures.join(', ') || 'None';

    document.getElementById('summary-welcome').textContent = `${appData.settings.welcome_points} points`;
    document.getElementById('summary-url').textContent = `${getBaseUrl()}/a/${appData.slug}`;

    // Update phone preview
    const phonePreview = document.getElementById('phone-preview');
    const appName = phonePreview.querySelector('.app-preview-name');
    const welcomePoints = phonePreview.querySelector('.points-number');
    const logo = phonePreview.querySelector('.app-preview-logo');

    if (appName) appName.textContent = appData.name || 'Your App';
    if (welcomePoints) welcomePoints.textContent = appData.settings.welcome_points;
    if (logo) {
        logo.style.background = appData.branding.primary_color;
        logo.textContent = (appData.name || 'A').charAt(0).toUpperCase();
    }

    // Update nav based on features
    const navItems = phonePreview.querySelectorAll('.nav-item');
    if (navItems.length >= 2) {
        navItems[1].style.display = appData.features.leaderboard_enabled ? 'flex' : 'none';
    }
    if (navItems.length >= 3) {
        navItems[2].style.display = appData.features.rewards_enabled ? 'flex' : 'none';
    }
}

// ===== Utilities =====
function generateSlug(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50);
}

function showError(message) {
    // Use toast if available
    if (typeof showToast === 'function') {
        showToast(message, 'error');
    } else {
        alert(message);
    }
}

function showSuccess(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'success');
    } else {
        console.log(message);
    }
}

function showPersistentError(message, helpLink) {
    // Create a persistent error banner that stays until dismissed
    const container = document.querySelector('.builder-content') || document.querySelector('main');
    if (!container) {
        alert(message);
        return;
    }

    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.innerHTML = `
        <div class="error-banner-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>${message}</span>
            ${helpLink ? `<a href="${helpLink}" class="error-banner-link">Go to Settings</a>` : ''}
            <a href="mailto:support@automata.app" class="error-banner-link">Contact Support</a>
        </div>
    `;
    banner.style.cssText = `
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        margin: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    `;

    // Style the content
    const content = banner.querySelector('.error-banner-content');
    content.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        justify-content: center;
    `;

    // Style the links
    banner.querySelectorAll('.error-banner-link').forEach(link => {
        link.style.cssText = `
            color: white;
            font-weight: 600;
            text-decoration: underline;
            text-underline-offset: 2px;
            white-space: nowrap;
        `;
    });

    container.prepend(banner);
}

// Simple toast implementation
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 16px 24px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#7c3aed'};
        color: white;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        z-index: 9999;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', initAppBuilder);
