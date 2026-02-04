/**
 * Customer Apps Management Page
 * Handles CRUD for customer-facing apps (loyalty, rewards, etc.)
 */

// ===== State =====
let currentUser = null;
let currentOrganization = null;
let apps = [];

// ===== App Type Feature Configurations =====
const APP_TYPE_FEATURES = {
    loyalty: [
        { name: 'points_enabled', label: 'Points System', checked: true },
        { name: 'leaderboard_enabled', label: 'Leaderboard', checked: true },
        { name: 'rewards_enabled', label: 'Rewards Catalog', checked: true },
        { name: 'tiers_enabled', label: 'Membership Tiers', checked: true },
        { name: 'announcements_enabled', label: 'Announcements', checked: true }
    ],
    rewards: [
        { name: 'points_enabled', label: 'Points System', checked: true },
        { name: 'rewards_enabled', label: 'Rewards Catalog', checked: true },
        { name: 'leaderboard_enabled', label: 'Leaderboard', checked: false },
        { name: 'referrals_enabled', label: 'Referral Program', checked: true },
        { name: 'announcements_enabled', label: 'Announcements', checked: true }
    ],
    membership: [
        { name: 'tiers_enabled', label: 'Membership Tiers', checked: true },
        { name: 'points_enabled', label: 'Points System', checked: true },
        { name: 'rewards_enabled', label: 'Member Perks', checked: true },
        { name: 'profile_public', label: 'Public Profiles', checked: false },
        { name: 'announcements_enabled', label: 'Member Updates', checked: true }
    ],
    newsletter: [
        { name: 'articles_enabled', label: 'Blog Articles', checked: true },
        { name: 'series_enabled', label: 'Article Series', checked: true },
        { name: 'topics_enabled', label: 'Categories & Topics', checked: true },
        { name: 'subscriber_signup', label: 'Subscriber Signup', checked: true },
        { name: 'comments_enabled', label: 'Comments', checked: false }
    ],
    custom: [
        { name: 'points_enabled', label: 'Points System', checked: false },
        { name: 'rewards_enabled', label: 'Rewards', checked: false },
        { name: 'leaderboard_enabled', label: 'Leaderboard', checked: false },
        { name: 'announcements_enabled', label: 'Announcements', checked: false },
        { name: 'menu_enabled', label: 'Menu Browser', checked: false }
    ]
};

// ===== Initialization =====
async function initApps() {
    try {
        // Check authentication
        currentUser = await requireAuth();

        // Load user info and organization
        await loadUserInfo();

        // Load apps
        await loadApps();

        // Setup event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Failed to initialize apps page:', error);
        showError('Failed to load apps. Please try again.');
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
            return;
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
            // Continue without organization
        }

        currentOrganization = membership?.organizations;

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
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

async function loadApps() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('apps-grid');
    const emptyState = document.getElementById('empty-state');

    loading.style.display = 'flex';
    grid.style.display = 'none';
    emptyState.style.display = 'none';

    // Check if organization is loaded
    if (!currentOrganization?.id) {
        console.warn('Organization not loaded yet');
        loading.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        if (error) {
            // Check if table doesn't exist (need to run migration)
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                console.warn('customer_apps table does not exist. Please run the migration.');
                loading.style.display = 'none';
                emptyState.style.display = 'block';
                // Show a helpful message
                const emptyTitle = emptyState.querySelector('h3');
                if (emptyTitle) {
                    emptyTitle.textContent = 'Setup Required';
                }
                const emptyDesc = emptyState.querySelector('p');
                if (emptyDesc) {
                    emptyDesc.textContent = 'Please run the customer-apps-migration.sql in Supabase to enable Customer Apps.';
                }
                return;
            }
            throw error;
        }

        apps = data || [];

        // Render
        loading.style.display = 'none';

        if (apps.length === 0) {
            emptyState.style.display = 'block';
        } else {
            grid.style.display = 'grid';
            renderApps();
        }

    } catch (error) {
        console.error('Failed to load apps:', error);
        loading.style.display = 'none';
        showError('Failed to load apps');
    }
}

// ===== Rendering =====
function renderApps() {
    const grid = document.getElementById('apps-grid');

    grid.innerHTML = apps.map(app => {
        const features = app.features || {};
        const enabledFeatures = [];
        if (features.points_enabled) enabledFeatures.push('Points');
        if (features.leaderboard_enabled) enabledFeatures.push('Leaderboard');
        if (features.rewards_enabled) enabledFeatures.push('Rewards');
        if (features.menu_enabled) enabledFeatures.push('Menu');
        if (features.announcements_enabled) enabledFeatures.push('News');

        const statusClass = app.is_published ? 'published' : (app.is_active ? 'active' : 'draft');
        const statusText = app.is_published ? 'Published' : (app.is_active ? 'Active' : 'Draft');

        const iconMap = {
            loyalty: '&#11088;',
            rewards: '&#127873;',
            membership: '&#128081;',
            newsletter: '&#128240;',
            custom: '&#128241;'
        };

        // Newsletter-specific actions
        const newsletterActions = app.app_type === 'newsletter' ? `
            <button onclick="event.stopPropagation(); navigateToContent('${app.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Content Generator
            </button>
            <button onclick="event.stopPropagation(); viewBlog('${app.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M7 7h10M7 12h10M7 17h6"/>
                </svg>
                View Blog
            </button>
            <button onclick="event.stopPropagation(); copyContentUrl('${app.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy Content URL
            </button>
            <div class="dropdown-divider"></div>
        ` : '';

        return `
            <div class="app-card" data-app-id="${app.id}">
                <div class="app-card-header">
                    <div class="app-card-icon ${app.app_type}">
                        <span>${iconMap[app.app_type] || iconMap.custom}</span>
                    </div>
                    <div class="app-card-info">
                        <div class="app-card-name">${escapeHtml(app.name)}</div>
                        <div class="app-card-type">${app.app_type.charAt(0).toUpperCase() + app.app_type.slice(1)} Program</div>
                    </div>
                    <div class="app-card-status">
                        <span class="status-badge ${statusClass}">
                            <span class="status-dot"></span>
                            ${statusText}
                        </span>
                    </div>
                    <div class="app-card-menu">
                        <button class="app-menu-btn" onclick="event.stopPropagation(); toggleAppMenu('${app.id}')" title="More options">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                            </svg>
                        </button>
                        <div class="app-dropdown" id="dropdown-${app.id}">
                            ${newsletterActions}
                            <button onclick="event.stopPropagation(); navigateToApp('${app.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                                Edit App
                            </button>
                            <button onclick="event.stopPropagation(); viewLiveApp('${escapeHtml(app.slug)}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                View Live App
                            </button>
                            <button onclick="event.stopPropagation(); copyAppUrl('${escapeHtml(app.slug)}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                Copy URL
                            </button>
                            <div class="dropdown-divider"></div>
                            <button class="danger" onclick="event.stopPropagation(); confirmDeleteApp('${app.id}', '${escapeHtml(app.name)}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                                Delete App
                            </button>
                        </div>
                    </div>
                </div>

                ${app.description ? `<p style="color: var(--color-text-secondary); font-size: 14px; margin: 0 0 12px 0;">${escapeHtml(app.description)}</p>` : ''}

                <div class="app-features">
                    ${enabledFeatures.map(f => `<span class="feature-badge">${f}</span>`).join('')}
                </div>

                <div class="app-card-qr" onclick="event.stopPropagation(); copyAppUrl('${escapeHtml(app.slug)}')" title="Click to copy full URL" style="cursor: pointer;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                    </svg>
                    <span class="app-url-text" data-slug="${escapeHtml(app.slug)}">URL: <code>${window.location.origin}/a/${escapeHtml(app.slug)}</code></span>
                    <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: auto; opacity: 0.5;">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </div>

                <div class="app-card-stats">
                    <div class="app-stat">
                        <div class="app-stat-value" id="members-${app.id}">-</div>
                        <div class="app-stat-label">Members</div>
                    </div>
                    <div class="app-stat">
                        <div class="app-stat-value" id="points-${app.id}">-</div>
                        <div class="app-stat-label">Points Issued</div>
                    </div>
                    <div class="app-stat">
                        <div class="app-stat-value" id="redemptions-${app.id}">-</div>
                        <div class="app-stat-label">Redemptions</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Load stats for each app
    apps.forEach(app => loadAppStats(app.id));
}

async function loadAppStats(appId) {
    try {
        const { data, error } = await supabase
            .rpc('get_app_stats', { p_app_id: appId });

        if (error) {
            // RPC might not exist yet, use fallback
            return;
        }

        if (data && data[0]) {
            const stats = data[0];
            const membersEl = document.getElementById(`members-${appId}`);
            const pointsEl = document.getElementById(`points-${appId}`);
            const redemptionsEl = document.getElementById(`redemptions-${appId}`);

            if (membersEl) membersEl.textContent = formatNumber(stats.total_members || 0);
            if (pointsEl) pointsEl.textContent = formatNumber(stats.total_points_issued || 0);
            if (redemptionsEl) redemptionsEl.textContent = formatNumber(stats.total_redemptions || 0);
        }
    } catch (e) {
        // Stats not available yet, leave as dash
        console.log('Stats not available for app:', appId);
    }
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ===== Feature Rendering =====
function renderFeaturesForAppType(appType) {
    const menu = document.getElementById('features-menu');
    if (!menu) {
        console.warn('Features menu not found');
        return;
    }

    const features = APP_TYPE_FEATURES[appType] || APP_TYPE_FEATURES.custom || [];

    if (!features.length) {
        console.warn('No features found for app type:', appType);
        menu.innerHTML = '<div class="features-dropdown-item"><span style="color: var(--color-text-secondary);">No features available</span></div>';
        updateFeaturesSelectedText();
        return;
    }

    menu.innerHTML = features.map(feature => `
        <label class="features-dropdown-item">
            <input type="checkbox" name="${feature.name}" ${feature.checked ? 'checked' : ''}>
            <span>${feature.label}</span>
        </label>
    `).join('');

    // Add change listeners to update selected text
    menu.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateFeaturesSelectedText);
    });

    updateFeaturesSelectedText();
}

function updateFeaturesSelectedText() {
    const menu = document.getElementById('features-menu');
    const trigger = document.getElementById('features-trigger');
    if (!menu || !trigger) return;

    const checkboxes = menu.querySelectorAll('input[type="checkbox"]:checked');
    const textSpan = trigger.querySelector('.features-selected-text');

    if (checkboxes.length === 0) {
        textSpan.textContent = 'Select features...';
        textSpan.classList.remove('has-selection');
    } else if (checkboxes.length === 1) {
        const label = checkboxes[0].closest('.features-dropdown-item').querySelector('span').textContent;
        textSpan.textContent = label;
        textSpan.classList.add('has-selection');
    } else {
        textSpan.textContent = `${checkboxes.length} features selected`;
        textSpan.classList.add('has-selection');
    }
}

function toggleFeaturesDropdown() {
    const container = document.getElementById('features-container');
    if (container) {
        container.classList.toggle('open');
    }
}

function closeFeaturesDropdown() {
    const container = document.getElementById('features-container');
    if (container) {
        container.classList.remove('open');
    }
}

function gatherFeaturesFromForm() {
    const menu = document.getElementById('features-menu');
    if (!menu) {
        console.warn('Features menu not found when gathering features');
        return {};
    }

    const features = {};
    const checkboxes = menu.querySelectorAll('input[type="checkbox"]');

    if (checkboxes.length === 0) {
        console.warn('No feature checkboxes found');
        // Return default features based on app type
        const appType = document.getElementById('app-type')?.value || 'loyalty';
        const defaultFeatures = APP_TYPE_FEATURES[appType] || APP_TYPE_FEATURES.custom || [];
        defaultFeatures.forEach(f => {
            features[f.name] = f.checked;
        });
        return features;
    }

    checkboxes.forEach(checkbox => {
        if (checkbox.name) {
            features[checkbox.name] = checkbox.checked;
        }
    });
    return features;
}

// ===== Event Handlers =====
function setupEventListeners() {
    // New app buttons
    document.getElementById('new-app-btn')?.addEventListener('click', openCreateModal);
    document.getElementById('empty-new-app-btn')?.addEventListener('click', openCreateModal);

    // Template cards
    document.querySelectorAll('.template-card').forEach(card => {
        card.addEventListener('click', () => {
            const template = card.dataset.template;
            openCreateModalWithTemplate(template);
        });
    });

    // App type change - update features dynamically
    document.getElementById('app-type')?.addEventListener('change', (e) => {
        renderFeaturesForAppType(e.target.value);
        closeFeaturesDropdown();
    });

    // Features dropdown toggle
    document.getElementById('features-trigger')?.addEventListener('click', toggleFeaturesDropdown);

    // Close features dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const container = document.getElementById('features-container');
        if (container && !container.contains(e.target)) {
            closeFeaturesDropdown();
        }
    });

    // Modal controls
    document.getElementById('modal-close')?.addEventListener('click', closeCreateModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeCreateModal);

    // Form submission
    document.getElementById('create-app-form')?.addEventListener('submit', handleCreateApp);

    // Click outside modal to close
    document.getElementById('create-app-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCreateModal();
        }
    });

    // App card clicks
    document.getElementById('apps-grid')?.addEventListener('click', (e) => {
        const card = e.target.closest('.app-card');
        // Don't navigate if clicking on action buttons, menu, or QR/URL area
        if (card && !e.target.closest('.app-action-btn') && !e.target.closest('.app-card-menu') && !e.target.closest('.app-card-qr')) {
            const appId = card.dataset.appId;
            navigateToApp(appId);
        }
    });

    // Escape key to close modal and dropdowns
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeFeaturesDropdown();
            closeCreateModal();
            document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
        }
    });
}

// ===== Modal Controls =====
function openCreateModal() {
    const modal = document.getElementById('create-app-modal');
    document.getElementById('create-app-form').reset();
    // Render default features for loyalty (first option)
    renderFeaturesForAppType('loyalty');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('app-name').focus();
}

function openCreateModalWithTemplate(templateId) {
    const template = getAppTemplateById(templateId);

    const modal = document.getElementById('create-app-modal');
    document.getElementById('create-app-form').reset();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (template) {
        // Pre-fill from template library
        document.getElementById('app-name').value = template.name;
        document.getElementById('app-description').value = template.description;
        document.getElementById('app-type').value = template.app_type;
        renderFeaturesForAppType(template.app_type);
    } else {
        // Just set app type based on template card clicked
        const typeMap = {
            'loyalty-points': 'loyalty',
            'rewards-club': 'rewards',
            'vip-membership': 'membership',
            'newsletter': 'newsletter'
        };
        const mappedType = typeMap[templateId] || 'loyalty';
        document.getElementById('app-type').value = mappedType;
        renderFeaturesForAppType(mappedType);
    }

    document.getElementById('app-name').focus();
}

function closeCreateModal() {
    closeFeaturesDropdown();
    const modal = document.getElementById('create-app-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== CRUD Operations =====
async function handleCreateApp(e) {
    e.preventDefault();

    // Check if organization is loaded
    if (!currentOrganization?.id) {
        showError('Organization not loaded. Please refresh the page.');
        return;
    }

    const form = e.target;
    const createBtn = document.getElementById('create-btn');
    const originalText = createBtn.textContent;

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
        const name = document.getElementById('app-name').value.trim();
        const description = document.getElementById('app-description').value.trim();
        const appType = document.getElementById('app-type').value;

        // Generate slug from name
        const slug = generateSlug(name);

        // Gather features dynamically from form
        const features = gatherFeaturesFromForm();

        // Get default settings based on app type
        const template = getAppTemplateById(appType + '-points') || getAppTemplateById(appType);
        let settings = template?.settings;

        // Default settings per app type
        if (!settings) {
            if (appType === 'newsletter') {
                settings = {
                    default_language: 'en',
                    enabled_languages: ['en'],
                    publish_frequency: 'weekly',
                    double_optin: true,
                    welcome_email_enabled: true,
                    ai_topic_enabled: false,
                    max_subscribers: 1000
                };
            } else {
                settings = {
                    points_per_scan: 10,
                    points_per_dollar: 1,
                    daily_scan_limit: 5,
                    welcome_points: 50,
                    require_email: true,
                    require_phone: false,
                    tier_thresholds: {
                        silver: 500,
                        gold: 1500,
                        platinum: 5000
                    }
                };
            }
        }

        // Create app
        const { data, error } = await supabase
            .from('customer_apps')
            .insert([{
                organization_id: currentOrganization.id,
                name,
                slug,
                description,
                app_type: appType,
                features,
                settings,
                branding: {
                    primary_color: '#7c3aed',
                    secondary_color: '#1e293b',
                    logo_url: null,
                    favicon_url: null
                },
                is_active: false,
                is_published: false
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505' && error.message.includes('slug')) {
                throw new Error('An app with this name already exists. Please choose a different name.');
            }
            throw error;
        }

        // Success
        closeCreateModal();
        await loadApps();

        // Navigate to app builder
        navigateToApp(data.id);

    } catch (error) {
        console.error('Failed to create app:', error);
        showError(error.message || 'Failed to create app. Please try again.');
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = originalText;
    }
}

function navigateToApp(appId) {
    window.location.href = `/app/app-builder.html?id=${appId}`;
}

function navigateToContent(appId) {
    window.location.href = `/app/content-generator.html?app_id=${appId}`;
    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
}

function viewBlog(appId) {
    // Find the app to get its slug
    const app = apps.find(a => a.id === appId);
    if (app?.slug) {
        window.open(`/blog/?app=${app.slug}`, '_blank');
    } else {
        window.open('/blog/', '_blank');
    }
    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
}

function copyContentUrl(appId) {
    const contentUrl = `${window.location.origin}/app/content-generator.html?app_id=${appId}`;

    const doCopy = (success) => {
        if (success) {
            showSuccess('Content Generator URL copied!');
        } else {
            showError('Failed to copy URL');
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentUrl)
            .then(() => doCopy(true))
            .catch(() => doCopy(false));
    } else {
        const input = document.createElement('input');
        input.value = contentUrl;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        try {
            document.execCommand('copy');
            doCopy(true);
        } catch (e) {
            doCopy(false);
        }
        document.body.removeChild(input);
    }

    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
}

// ===== Utility Functions =====
const generateSlug = AppUtils.generateSlug;

function escapeHtml(text) {
    // Use AppUtils if available (preferred), otherwise fallback to DOM method
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
        return AppUtils.escapeHtml(text);
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function showError(message) {
    // Use AppUtils.showToast if available, otherwise alert
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
        AppUtils.showToast(message, 'error');
    } else if (typeof showToast === 'function') {
        showToast(message, 'error');
    } else {
        alert(message);
    }
}

function showSuccess(message) {
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
        AppUtils.showToast(message, 'success');
    } else if (typeof showToast === 'function') {
        showToast(message, 'success');
    } else {
        console.log(message);
    }
}

function toggleAppMenu(appId) {
    // Close all other dropdowns first
    document.querySelectorAll('.app-dropdown.active').forEach(dropdown => {
        if (dropdown.id !== `dropdown-${appId}`) {
            dropdown.classList.remove('active');
        }
    });

    // Toggle this dropdown
    const dropdown = document.getElementById(`dropdown-${appId}`);
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

function copyAppUrl(slug) {
    const fullUrl = `${window.location.origin}/a/${slug}`;

    // Visual feedback on the QR row
    const urlElement = document.querySelector(`.app-url-text[data-slug="${slug}"]`);
    const qrRow = urlElement?.closest('.app-card-qr');

    const doCopy = (success) => {
        if (success) {
            showSuccess('URL copied to clipboard!');
            // Add visual feedback
            if (qrRow) {
                qrRow.style.background = 'rgba(16, 185, 129, 0.15)';
                const copyIcon = qrRow.querySelector('.copy-icon');
                if (copyIcon) {
                    copyIcon.style.opacity = '1';
                    copyIcon.style.color = '#10b981';
                }
                setTimeout(() => {
                    qrRow.style.background = '';
                    if (copyIcon) {
                        copyIcon.style.opacity = '';
                        copyIcon.style.color = '';
                    }
                }, 1000);
            }
        } else {
            showError('Failed to copy URL');
        }
    };

    // Try modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullUrl)
            .then(() => doCopy(true))
            .catch(() => {
                // Fallback for older browsers
                const input = document.createElement('input');
                input.value = fullUrl;
                input.style.position = 'fixed';
                input.style.left = '-9999px';
                document.body.appendChild(input);
                input.select();
                try {
                    document.execCommand('copy');
                    doCopy(true);
                } catch (e) {
                    doCopy(false);
                }
                document.body.removeChild(input);
            });
    } else {
        // Fallback for browsers without clipboard API
        const input = document.createElement('input');
        input.value = fullUrl;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        try {
            document.execCommand('copy');
            doCopy(true);
        } catch (e) {
            doCopy(false);
        }
        document.body.removeChild(input);
    }

    // Close any open dropdowns
    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
}

function viewLiveApp(slug) {
    window.open(`/a/${slug}`, '_blank');
    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
}

async function confirmDeleteApp(appId, appName) {
    document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));

    if (!confirm(`Are you sure you want to delete "${appName}"? This cannot be undone.`)) {
        return;
    }

    try {
        const { error } = await supabase
            .from('customer_apps')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', appId);

        if (error) throw error;

        showSuccess('App deleted successfully');
        await loadApps();
    } catch (error) {
        console.error('Failed to delete app:', error);
        showError('Failed to delete app');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.app-card-menu')) {
        document.querySelectorAll('.app-dropdown.active').forEach(d => d.classList.remove('active'));
    }
});

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', initApps);
