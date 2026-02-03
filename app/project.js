// ===== Project Page Initialization =====
let currentUser = null;
let currentProject = null;
let projectGoals = [];
let projectPainPoints = [];
let projectCompetitors = [];
let projectCompetitiveAdvantage = '';
let selectedCustomerIds = new Set();
let allOrgCustomers = [];
let selectedProjectIcon = 'workflow';

async function initProject() {
    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Get project ID from URL hash (fallback to query param for compatibility)
    let projectId = window.location.hash.slice(1);
    const urlParams = new URLSearchParams(window.location.search);
    if (!projectId) {
        projectId = urlParams.get('id');
    }

    if (!projectId) {
        window.location.href = '/app/dashboard.html';
        return;
    }

    // Check if coming from onboarding
    const isOnboardingComplete = urlParams.get('onboarding') === 'complete';

    // Load user info
    const userProfile = await loadUserInfo();

    // Load project
    await loadProject(projectId);

    // Initialize sidebar with user data (including role for admin features)
    if (typeof AppSidebar !== 'undefined') {
        // Get user role for admin features
        const orgData = typeof AppUtils !== 'undefined'
            ? await AppUtils.loadOrganization(supabase, currentUser.id)
            : { role: null };

        AppSidebar.init({
            name: userProfile?.fullName || currentUser.email.split('@')[0],
            email: currentUser.email,
            organization: currentProject ? { name: currentProject.name } : null,
            role: orgData.role,
            isAdmin: userProfile?.profile?.is_admin === true
        });
    }

    // Setup event listeners
    setupEventListeners();

    // Handle onboarding completion
    if (isOnboardingComplete) {
        handleOnboardingComplete();
        // Clean up URL parameter
        const cleanUrl = window.location.pathname + '?id=' + projectId;
        window.history.replaceState({}, '', cleanUrl);
    } else {
        // Show coaching tour for new projects (check if recently created)
        showProjectCoachingIfNeeded();
    }
}

// ===== Onboarding Completion =====
function handleOnboardingComplete() {
    // Celebrate arrival!
    if (typeof celebrateBig === 'function') {
        celebrateBig();
    } else if (typeof celebrate === 'function') {
        celebrate();
    }

    // Show welcome banner
    showOnboardingWelcomeBanner();

    // Show coaching tour after a short delay
    setTimeout(() => {
        if (typeof Coaching !== 'undefined') {
            Coaching.showTour('project');
        }
    }, 1500);
}

function showOnboardingWelcomeBanner() {
    // Create and insert welcome banner at the top of the page
    const banner = document.createElement('div');
    banner.className = 'onboarding-welcome-banner';
    banner.id = 'onboarding-welcome-banner';
    banner.innerHTML = `
        <div class="welcome-banner-content">
            <div class="welcome-banner-icon">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2"/>
                    <path d="M10 16L14 20L22 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <div class="welcome-banner-text">
                <h3>Welcome to your new project!</h3>
                <p>Your automations are ready to be configured. Complete your project details below, then activate your automations to get started.</p>
            </div>
            <button class="welcome-banner-dismiss" onclick="dismissOnboardingBanner()" title="Dismiss">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
    `;

    // Add styles for the banner
    const style = document.createElement('style');
    style.textContent = `
        .onboarding-welcome-banner {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
            border: 1px solid rgba(124, 58, 237, 0.2);
            border-radius: var(--radius-lg);
            padding: 20px 24px;
            margin-bottom: 24px;
            animation: welcomeBannerSlideIn 0.5s ease;
        }

        @keyframes welcomeBannerSlideIn {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .welcome-banner-content {
            display: flex;
            align-items: flex-start;
            gap: 16px;
        }

        .welcome-banner-icon {
            flex-shrink: 0;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--color-primary);
            color: white;
            border-radius: var(--radius-full);
        }

        .welcome-banner-text {
            flex: 1;
        }

        .welcome-banner-text h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--color-text);
        }

        .welcome-banner-text p {
            font-size: 14px;
            color: var(--color-text-muted);
            margin: 0;
        }

        .welcome-banner-dismiss {
            flex-shrink: 0;
            background: none;
            border: none;
            padding: 8px;
            cursor: pointer;
            color: var(--color-text-muted);
            border-radius: var(--radius-md);
            transition: all 0.2s ease;
        }

        .welcome-banner-dismiss:hover {
            background: rgba(0, 0, 0, 0.05);
            color: var(--color-text);
        }

        .onboarding-welcome-banner.dismissing {
            animation: welcomeBannerSlideOut 0.3s ease forwards;
        }

        @keyframes welcomeBannerSlideOut {
            from {
                opacity: 1;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                transform: translateY(-20px);
            }
        }
    `;
    document.head.appendChild(style);

    // Insert banner at the start of the overview tab content
    const overviewTab = document.getElementById('overview-tab');
    if (overviewTab) {
        overviewTab.insertBefore(banner, overviewTab.firstChild);
    }
}

function dismissOnboardingBanner() {
    const banner = document.getElementById('onboarding-welcome-banner');
    if (banner) {
        banner.classList.add('dismissing');
        setTimeout(() => banner.remove(), 300);
    }
}

window.dismissOnboardingBanner = dismissOnboardingBanner;

// ===== Coaching Tour =====
function showProjectCoachingIfNeeded() {
    if (typeof Coaching === 'undefined') return;
    if (!currentProject) return;

    // Check if this is a newly created project (within last 5 minutes)
    const createdAt = new Date(currentProject.created_at);
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    if (createdAt > fiveMinutesAgo) {
        // Slight delay to ensure UI is ready
        setTimeout(() => {
            Coaching.showTour('project');
        }, 500);
    }
}

// ===== Load User Info =====
async function loadUserInfo() {
    const profile = await getUserProfile(currentUser.id);

    let fullName = '';
    if (profile && (profile.first_name || profile.last_name)) {
        fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
    } else {
        fullName = currentUser.email.split('@')[0];
    }

    return {
        profile,
        fullName
    };
}

function getInitials(firstName, lastName) {
    if (firstName && lastName) {
        return (firstName[0] + lastName[0]).toUpperCase();
    } else if (firstName) {
        return firstName.substring(0, 2).toUpperCase();
    } else if (lastName) {
        return lastName.substring(0, 2).toUpperCase();
    }
    return '?';
}

// ===== Load Project =====
async function loadProject(projectId) {
    const loading = document.getElementById('loading');

    try {
        // Load project details (RLS handles authorization via organization membership)
        const { data: project, error } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();

        if (error || !project) {
            console.error('Project not found or access denied:', error);
            window.location.href = '/app/dashboard.html';
            return;
        }

        currentProject = project;

        // Update page with project info
        document.getElementById('breadcrumb-project').textContent = project.name;
        document.getElementById('project-title').textContent = project.name;
        document.getElementById('project-description').textContent = project.description || '';

        if (project.industry) {
            const industryBadge = document.getElementById('project-industry');
            industryBadge.textContent = project.industry;
            industryBadge.style.display = 'inline-flex';
        }

        // Populate overview form fields
        document.getElementById('details-name').value = project.name;
        document.getElementById('details-description').value = project.description || '';
        document.getElementById('details-industry').value = project.industry || '';
        document.getElementById('details-target-market').value = project.target_market || '';
        document.getElementById('details-location').value = project.location || '';

        // Load business context (goals, pain points, competitors, competitive advantage)
        projectGoals = project.goals || [];
        projectPainPoints = project.pain_points || [];
        projectCompetitors = project.competitors || [];
        projectCompetitiveAdvantage = project.competitive_advantage || '';

        // Populate view mode
        updateDetailsViewMode();
        updateContextViewMode();

        // Check if analyze button should be enabled
        updateAnalyzeButtonState();

        // Load automations
        await loadAutomations(projectId);

        // Load project customers
        await loadProjectCustomers(projectId);

        // Load project apps
        await loadProjectApps(projectId);

        // Load opportunities
        if (typeof loadOpportunities === 'function') {
            await loadOpportunities(projectId);
        }

        loading.style.display = 'none';

    } catch (error) {
        console.error('Error loading project:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading project. Please refresh.</p>';
    }
}

// ===== Load Automations =====
async function loadAutomations(projectId) {
    const automationsList = document.getElementById('automations-list');
    const emptyState = document.getElementById('empty-automations');
    const automationsTab = document.getElementById('automations-tab');

    try {
        const { data: automations, error } = await supabase
            .from('automations')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        automationsTab.style.display = 'block';

        if (!automations || automations.length === 0) {
            automationsList.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        automationsList.style.display = 'flex';
        renderAutomations(automations);

    } catch (error) {
        console.error('Error loading automations:', error);
    }
}

function renderAutomations(automations) {
    const automationsList = document.getElementById('automations-list');

    automationsList.innerHTML = automations.map(automation => {
        // Use icon library if available, otherwise fallback to type-based icon
        let typeIcon;
        if (automation.icon && typeof getIconSvg === 'function') {
            typeIcon = getIconSvg(automation.icon);
        } else if (automation.type === 'blog_generation') {
            typeIcon = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                    <path d="M8 8H16M8 12H16M8 16H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
        } else {
            typeIcon = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
                    <path d="M2 8L12 14L22 8" stroke="currentColor" stroke-width="2"/>
                </svg>
            `;
        }

        const statusClass = automation.is_active ? 'active' : 'inactive';
        const statusText = automation.is_active ? 'Active' : 'Inactive';
        const description = automation.description || `${formatType(automation.type)} running ${automation.frequency}. Click to configure settings and view generated content.`;

        return `
            <a href="/app/automation.html#${automation.id}" class="automation-card">
                <div class="automation-icon">
                    ${typeIcon}
                </div>
                <div class="automation-name">${escapeHtml(automation.name)}</div>
                <div class="automation-description">${escapeHtml(description)}</div>
                <div class="automation-status-badge ${statusClass}">
                    <span class="status-dot"></span>
                    ${statusText}
                </div>
            </a>
        `;
    }).join('');
}

function formatType(type) {
    const types = {
        'blog_generation': 'Blog Generation',
        'email': 'Email'
    };
    return types[type] || type;
}

// ===== Load Project Customers =====
async function loadProjectCustomers(projectId) {
    const list = document.getElementById('project-customers-list');
    const emptyState = document.getElementById('empty-project-customers');

    try {
        const { data: projectCustomers, error } = await supabase
            .from('project_customers')
            .select(`
                id,
                customer_id,
                customers (
                    id,
                    first_name,
                    last_name,
                    email,
                    company
                )
            `)
            .eq('project_id', projectId)
            .order('added_at', { ascending: false });

        if (error) throw error;

        if (!projectCustomers || projectCustomers.length === 0) {
            list.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        renderProjectCustomers(projectCustomers);

    } catch (error) {
        console.error('Error loading project customers:', error);
    }
}

function renderProjectCustomers(projectCustomers) {
    const list = document.getElementById('project-customers-list');

    list.innerHTML = projectCustomers.map(pc => {
        const customer = pc.customers;
        if (!customer) return '';

        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown';
        const initials = getInitials(customer.first_name, customer.last_name);

        return `
            <div class="project-customer-card" data-id="${pc.id}">
                <div class="customer-info">
                    <span class="customer-avatar">${initials}</span>
                    <div class="customer-details">
                        <h4>${escapeHtml(name)}</h4>
                        <p>${escapeHtml(customer.email || customer.company || 'No email')}</p>
                    </div>
                </div>
                <button class="remove-customer-btn" onclick="removeProjectCustomer('${pc.id}')" title="Remove from project">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
}

async function removeProjectCustomer(pcId) {
    try {
        const { error } = await supabase
            .from('project_customers')
            .delete()
            .eq('id', pcId);

        if (error) throw error;

        await loadProjectCustomers(currentProject.id);

    } catch (error) {
        console.error('Error removing customer:', error);
        showToast('Error removing customer', 'error');
    }
}

window.removeProjectCustomer = removeProjectCustomer;

// ===== Load Project Apps =====
async function loadProjectApps(projectId) {
    const container = document.getElementById('project-app-container');
    const emptyState = document.getElementById('empty-project-app');
    const createBtn = document.getElementById('create-project-app-btn');

    try {
        // Query customer_apps linked to this project
        const { data: apps, error } = await supabase
            .from('customer_apps')
            .select('*')
            .eq('project_id', projectId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!apps || apps.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            createBtn.style.display = 'inline-flex';
            // Update the create button link to include project context
            createBtn.href = `/app/app-builder.html?projectId=${projectId}`;
            document.getElementById('empty-create-app-btn').href = `/app/app-builder.html?projectId=${projectId}`;
            return;
        }

        // Has app(s) - hide empty state and create button
        emptyState.style.display = 'none';
        createBtn.style.display = 'none';

        // Render the app(s)
        renderProjectApps(apps);

    } catch (error) {
        console.error('Error loading project apps:', error);
        container.innerHTML = '<p style="padding: 24px; color: var(--color-error);">Error loading apps.</p>';
    }
}

function renderProjectApps(apps) {
    const container = document.getElementById('project-app-container');

    container.innerHTML = apps.map(app => {
        const appUrl = `${window.location.origin}/a/${app.slug}`;
        const statusClass = app.is_published ? 'published' : 'draft';
        const statusText = app.is_published ? 'Published' : 'Draft';

        return `
            <div class="project-app-card" data-id="${app.id}">
                <div class="app-card-header">
                    <div class="app-card-icon" style="background: ${app.branding?.primary_color || 'var(--color-primary)'};">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <rect x="5" y="2" width="14" height="20" rx="3"/>
                            <circle cx="12" cy="18" r="1"/>
                        </svg>
                    </div>
                    <div class="app-card-info">
                        <h4>${escapeHtml(app.name)}</h4>
                        <span class="app-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="app-card-url">
                    <input type="text" value="${appUrl}" readonly onclick="this.select()">
                    <button class="btn btn-sm btn-secondary" onclick="copyAppUrl('${appUrl}')" title="Copy URL">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    </button>
                </div>
                <div class="app-card-actions">
                    <a href="/app/app-builder.html?id=${app.id}" class="btn btn-secondary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit App
                    </a>
                    <a href="${appUrl}" target="_blank" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                        View App
                    </a>
                </div>
            </div>
        `;
    }).join('');
}

function copyAppUrl(url) {
    const doCopy = (success) => {
        if (success) {
            // Show toast notification
            if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
                AppUtils.showToast('URL copied to clipboard!', 'success');
            }
            // Brief celebration
            if (typeof celebrateSubtle === 'function') {
                celebrateSubtle();
            }
        } else {
            if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
                AppUtils.showToast('Failed to copy URL', 'error');
            }
        }
    };

    // Try modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
            .then(() => doCopy(true))
            .catch(() => {
                // Fallback for older browsers
                const input = document.createElement('input');
                input.value = url;
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
        input.value = url;
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
}

window.copyAppUrl = copyAppUrl;

// ===== Toggle Automation =====
async function toggleAutomation(automationId, isActive) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ is_active: isActive })
            .eq('id', automationId);

        if (error) throw error;

    } catch (error) {
        console.error('Error toggling automation:', error);
        showToast('Error updating automation', 'error');
        // Reload to reset toggle state
        await loadAutomations(currentProject.id);
    }
}

// Make available globally for onclick handler
window.toggleAutomation = toggleAutomation;

// ===== Event Listeners =====
function setupEventListeners() {
    // User menu and logout are now handled by sidebar.js

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // New automation buttons
    document.getElementById('new-automation-btn').addEventListener('click', openAutomationModal);
    document.getElementById('empty-new-automation-btn')?.addEventListener('click', openAutomationModal);

    // Automation modal controls
    document.getElementById('automation-modal-close').addEventListener('click', closeAutomationModal);
    document.getElementById('automation-modal-cancel').addEventListener('click', closeAutomationModal);

    document.getElementById('create-automation-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeAutomationModal();
        }
    });

    // Create automation form
    document.getElementById('create-automation-form').addEventListener('submit', handleCreateAutomation);

    // Icon detection on name/description change
    document.getElementById('automation-name')?.addEventListener('blur', handleProjectIconDetection);
    document.getElementById('automation-description')?.addEventListener('blur', handleProjectIconDetection);

    // Initialize icon picker
    initProjectIconPicker();

    // Project details form (in Overview tab)
    document.getElementById('edit-details-btn')?.addEventListener('click', showDetailsEditMode);
    document.getElementById('cancel-details-btn')?.addEventListener('click', hideDetailsEditMode);
    document.getElementById('project-details-form').addEventListener('submit', handleSaveDetails);

    // Business context view/edit toggle
    document.getElementById('edit-context-btn')?.addEventListener('click', showContextEditMode);
    document.getElementById('cancel-context-btn')?.addEventListener('click', hideContextEditMode);
    document.getElementById('save-context-btn')?.addEventListener('click', handleSaveContext);

    // Delete project
    document.getElementById('delete-project-btn').addEventListener('click', handleDeleteProject);

    // Add customers modal
    document.getElementById('add-project-customers-btn')?.addEventListener('click', openCustomersModal);
    document.getElementById('empty-add-customers-btn')?.addEventListener('click', openCustomersModal);
    document.getElementById('customers-modal-close')?.addEventListener('click', closeCustomersModal);
    document.getElementById('customers-modal-cancel')?.addEventListener('click', closeCustomersModal);
    document.getElementById('add-customers-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeCustomersModal();
    });
    document.getElementById('add-selected-customers-btn')?.addEventListener('click', handleAddSelectedCustomers);
    document.getElementById('customer-search')?.addEventListener('input', filterSelectableCustomers);

    // Create new customer from project
    document.getElementById('create-new-customer-btn')?.addEventListener('click', showCreateCustomerView);
    document.getElementById('back-to-select-btn')?.addEventListener('click', showSelectCustomersView);
    document.getElementById('new-customer-form')?.addEventListener('submit', handleCreateNewCustomer);

    // Dismiss banner
    document.getElementById('dismiss-banner')?.addEventListener('click', dismissIncompleteBanner);

    // AI Opportunities
    document.getElementById('analyze-btn')?.addEventListener('click', () => {
        if (typeof generateOpportunities === 'function') {
            generateOpportunities(currentProject);
        }
    });
    document.getElementById('refresh-opportunities-btn')?.addEventListener('click', () => {
        if (typeof generateOpportunities === 'function') {
            generateOpportunities(currentProject);
        }
    });
    document.getElementById('show-more-btn')?.addEventListener('click', () => {
        if (typeof showMoreOpportunities === 'function') {
            showMoreOpportunities();
        }
    });

    // AI Diagnosis
    document.getElementById('run-diagnosis-btn')?.addEventListener('click', runProjectDiagnosis);

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAutomationModal();
            closeCustomersModal();
        }
    });
}

// ===== Tab Switching =====
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.getElementById('overview-tab').style.display = tabName === 'overview' ? 'block' : 'none';
    document.getElementById('content-tab').style.display = tabName === 'content' ? 'block' : 'none';
    document.getElementById('automations-tab').style.display = tabName === 'automations' ? 'block' : 'none';
    document.getElementById('apps-tab').style.display = tabName === 'apps' ? 'block' : 'none';
    document.getElementById('customers-tab').style.display = tabName === 'customers' ? 'block' : 'none';
    document.getElementById('settings-tab').style.display = tabName === 'settings' ? 'block' : 'none';

    // Load content tab data when switching to it
    if (tabName === 'content') {
        loadContentTab();
    }
}

// ===== Automation Modal =====
function openAutomationModal() {
    document.getElementById('create-automation-modal').classList.add('active');
    document.getElementById('automation-name').focus();
}

function closeAutomationModal() {
    document.getElementById('create-automation-modal').classList.remove('active');
    document.getElementById('create-automation-form').reset();
}

// ===== Create Automation =====
async function handleCreateAutomation(e) {
    e.preventDefault();

    const createBtn = document.getElementById('create-automation-btn');
    const originalText = createBtn.textContent;

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    const name = document.getElementById('automation-name').value.trim();
    const description = document.getElementById('automation-description').value.trim();
    const type = document.getElementById('automation-type').value;
    const frequency = document.getElementById('automation-frequency').value;
    const icon = document.getElementById('automation-icon')?.value || 'workflow';
    const targetSegment = document.getElementById('automation-segment')?.value || 'all';

    try {
        const { data, error } = await supabase
            .from('automations')
            .insert([{
                project_id: currentProject.id,
                name,
                description,
                type,
                frequency,
                icon,
                target_segment: targetSegment,
                is_active: false,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Log the creation
        if (typeof AuditLog !== 'undefined') {
            AuditLog.logAutomationCreate(currentProject.organization_id, data);
        }

        // Celebrate!
        celebrate();
        createBtn.textContent = 'Created!';

        // Redirect to the new automation after brief celebration
        setTimeout(() => {
            window.location.href = `/app/automation.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating automation:', error);
        showToast('Error creating automation', 'error');
        createBtn.disabled = false;
        createBtn.textContent = originalText;
    }
}

// ===== Project Icon Picker =====
function initProjectIconPicker() {
    const picker = document.getElementById('project-icon-picker');
    if (!picker || typeof getAllIcons !== 'function') return;

    const icons = getAllIcons();
    picker.innerHTML = icons.map(icon => `
        <div class="icon-picker-item ${icon.key === selectedProjectIcon ? 'selected' : ''}"
             data-icon="${icon.key}"
             title="${icon.name}"
             onclick="selectProjectIcon('${icon.key}')"
             style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer;">
            ${icon.svg}
        </div>
    `).join('');
}

function toggleProjectIconPicker() {
    const picker = document.getElementById('project-icon-picker');
    if (picker) {
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    }
}

function selectProjectIcon(iconKey) {
    selectedProjectIcon = iconKey;
    document.getElementById('automation-icon').value = iconKey;
    updateProjectIconPreview();
    toggleProjectIconPicker();
}

function updateProjectIconPreview() {
    const preview = document.getElementById('project-icon-preview');
    if (preview && typeof getIconSvg === 'function') {
        preview.innerHTML = getIconSvg(selectedProjectIcon);
    }

    // Update picker selection
    document.querySelectorAll('#project-icon-picker .icon-picker-item').forEach(item => {
        if (item.dataset.icon === selectedProjectIcon) {
            item.style.background = 'rgba(124, 58, 237, 0.1)';
            item.style.borderColor = 'var(--color-primary)';
            item.style.color = 'var(--color-primary)';
        } else {
            item.style.background = 'var(--color-bg)';
            item.style.borderColor = 'var(--color-border)';
            item.style.color = 'var(--color-text-secondary)';
        }
    });
}

function handleProjectIconDetection() {
    const name = document.getElementById('automation-name')?.value || '';
    const description = document.getElementById('automation-description')?.value || '';

    if ((name || description) && typeof detectIcon === 'function') {
        selectedProjectIcon = detectIcon(name, description);
        document.getElementById('automation-icon').value = selectedProjectIcon;
        updateProjectIconPreview();
    }
}

window.toggleProjectIconPicker = toggleProjectIconPicker;
window.selectProjectIcon = selectProjectIcon;

// ===== View/Edit Mode Functions =====
function updateDetailsViewMode() {
    const industryLabels = {
        'agnostic': 'Agnostic / All Industries',
        'food': 'Food & Restaurant',
        'health': 'Health & Wellness',
        'service': 'Professional Services',
        'politics': 'Politics & Advocacy',
        'technology': 'Technology',
        'retail': 'Retail & E-commerce',
        'education': 'Education',
        'other': 'Other'
    };

    document.getElementById('view-name').textContent = currentProject.name || '-';
    document.getElementById('view-industry').textContent = industryLabels[currentProject.industry] || currentProject.industry || '-';
    document.getElementById('view-description').textContent = currentProject.description || '-';
    document.getElementById('view-target-market').textContent = currentProject.target_market || '-';
    document.getElementById('view-location').textContent = currentProject.location || '-';
}

function updateContextViewMode() {
    const goalsDisplay = document.getElementById('view-goals');
    const painPointsDisplay = document.getElementById('view-pain-points');
    const competitorsDisplay = document.getElementById('view-competitors');
    const competitiveAdvantageDisplay = document.getElementById('view-competitive-advantage');

    goalsDisplay.innerHTML = projectGoals.length > 0
        ? projectGoals.map(g => `<span class="tag">${escapeHtml(g)}</span>`).join('')
        : '<span class="empty-text">No goals set</span>';

    painPointsDisplay.innerHTML = projectPainPoints.length > 0
        ? projectPainPoints.map(p => `<span class="tag">${escapeHtml(p)}</span>`).join('')
        : '<span class="empty-text">No pain points set</span>';

    competitorsDisplay.innerHTML = projectCompetitors.length > 0
        ? projectCompetitors.map(c => `<span class="tag">${escapeHtml(c)}</span>`).join('')
        : '<span class="empty-text">No competitors set</span>';

    competitiveAdvantageDisplay.textContent = projectCompetitiveAdvantage || '-';
}

function showDetailsEditMode() {
    document.getElementById('details-view-mode').style.display = 'none';
    document.getElementById('project-details-form').style.display = 'block';
    document.getElementById('edit-details-btn').style.display = 'none';
    document.getElementById('details-name').focus();
}

function hideDetailsEditMode() {
    document.getElementById('project-details-form').style.display = 'none';
    document.getElementById('details-view-mode').style.display = 'block';
    document.getElementById('edit-details-btn').style.display = 'inline-flex';

    // Reset form to current values
    document.getElementById('details-name').value = currentProject.name;
    document.getElementById('details-description').value = currentProject.description || '';
    document.getElementById('details-industry').value = currentProject.industry || '';
    document.getElementById('details-target-market').value = currentProject.target_market || '';
    document.getElementById('details-location').value = currentProject.location || '';
}

function showContextEditMode() {
    document.getElementById('context-view-mode').style.display = 'none';
    document.getElementById('context-edit-mode').style.display = 'block';
    document.getElementById('edit-context-btn').style.display = 'none';

    // Populate textareas with current values
    document.getElementById('goals-textarea').value = projectGoals.join('\n');
    document.getElementById('pain-points-textarea').value = projectPainPoints.join('\n');
    document.getElementById('competitors-textarea').value = projectCompetitors.join('\n');
    document.getElementById('competitive-advantage-textarea').value = projectCompetitiveAdvantage;
}

function hideContextEditMode() {
    document.getElementById('context-edit-mode').style.display = 'none';
    document.getElementById('context-view-mode').style.display = 'block';
    document.getElementById('edit-context-btn').style.display = 'inline-flex';
}

function updateAnalyzeButtonState() {
    const btn = document.getElementById('analyze-btn');
    const status = document.getElementById('analysis-status');
    const banner = document.getElementById('incomplete-banner');
    const bannerMessage = document.getElementById('banner-message');

    const hasName = currentProject.name && currentProject.name.trim();
    const hasDescription = currentProject.description && currentProject.description.trim();
    const hasIndustry = currentProject.industry;

    if (hasName && hasDescription && hasIndustry) {
        btn.disabled = false;
        status.textContent = 'Ready to generate AI opportunities';
        status.classList.add('ready');
        // Hide banner when complete
        banner.style.display = 'none';
    } else {
        btn.disabled = true;
        const missing = [];
        if (!hasName) missing.push('name');
        if (!hasDescription) missing.push('description');
        if (!hasIndustry) missing.push('industry');
        status.textContent = `Complete your project ${missing.join(', ')} to enable AI analysis`;
        status.classList.remove('ready');

        // Show banner if not dismissed for this project
        const dismissedKey = `banner_dismissed_${currentProject.id}`;
        if (!localStorage.getItem(dismissedKey)) {
            banner.style.display = 'flex';
            bannerMessage.textContent = `Add your project ${missing.join(', ')} to enable AI analysis`;
        }
    }
}

function showOpportunitiesColumn() {
    document.getElementById('overview-content').classList.add('has-opportunities');
    document.getElementById('overview-right').style.display = 'block';
}

function dismissIncompleteBanner() {
    const banner = document.getElementById('incomplete-banner');
    banner.style.display = 'none';

    // Remember dismissal for this project
    if (currentProject && currentProject.id) {
        localStorage.setItem(`banner_dismissed_${currentProject.id}`, 'true');
    }
}

// ===== Save Project Details =====
async function handleSaveDetails(e) {
    e.preventDefault();

    const saveBtn = document.getElementById('save-details-btn');
    const originalText = saveBtn.textContent;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const name = document.getElementById('details-name').value.trim();
    const description = document.getElementById('details-description').value.trim();
    const industry = document.getElementById('details-industry').value;
    const targetMarket = document.getElementById('details-target-market').value.trim();
    const location = document.getElementById('details-location').value.trim();

    // Capture previous state for audit log
    const previousData = {
        name: currentProject.name,
        description: currentProject.description,
        industry: currentProject.industry,
        target_market: currentProject.target_market,
        location: currentProject.location
    };

    try {
        const { error } = await supabase
            .from('projects')
            .update({
                name,
                description,
                industry: industry || null,
                target_market: targetMarket || null,
                location: location || null
            })
            .eq('id', currentProject.id);

        if (error) throw error;

        // Update page
        document.getElementById('breadcrumb-project').textContent = name;
        document.getElementById('project-title').textContent = name;
        document.getElementById('project-description').textContent = description;

        const industryBadge = document.getElementById('project-industry');
        if (industry) {
            industryBadge.textContent = industry;
            industryBadge.style.display = 'inline-flex';
        } else {
            industryBadge.style.display = 'none';
        }

        currentProject.name = name;
        currentProject.description = description;
        currentProject.industry = industry;
        currentProject.target_market = targetMarket;
        currentProject.location = location;

        // Log the update
        if (typeof AuditLog !== 'undefined') {
            const newData = { name, description, industry, target_market: targetMarket, location };
            AuditLog.logProjectUpdate(
                currentProject.organization_id,
                currentProject.id,
                name,
                previousData,
                newData,
                ['name', 'description', 'industry', 'target_market', 'location']
            );
        }

        // Update view mode and switch back
        updateDetailsViewMode();
        hideDetailsEditMode();
        updateAnalyzeButtonState();

        // Subtle celebration for save
        celebrateSubtle();

    } catch (error) {
        console.error('Error saving details:', error);
        showToast('Error saving details', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

// ===== Business Context =====
async function handleSaveContext() {
    const saveBtn = document.getElementById('save-context-btn');
    const originalText = saveBtn.textContent;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // Capture previous data for audit log
    const previousData = {
        goals: currentProject.goals,
        pain_points: currentProject.pain_points,
        competitors: currentProject.competitors,
        competitive_advantage: currentProject.competitive_advantage
    };

    // Parse textareas (one item per line, filter empty lines)
    projectGoals = document.getElementById('goals-textarea').value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s);
    projectPainPoints = document.getElementById('pain-points-textarea').value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s);
    projectCompetitors = document.getElementById('competitors-textarea').value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s);
    projectCompetitiveAdvantage = document.getElementById('competitive-advantage-textarea').value.trim();

    const newData = {
        goals: projectGoals,
        pain_points: projectPainPoints,
        competitors: projectCompetitors,
        competitive_advantage: projectCompetitiveAdvantage || null
    };

    try {
        const { error } = await supabase
            .from('projects')
            .update(newData)
            .eq('id', currentProject.id);

        if (error) throw error;

        // Log the update
        if (typeof AuditLog !== 'undefined') {
            AuditLog.logProjectUpdate(
                currentProject.organization_id,
                currentProject.id,
                currentProject.name,
                previousData,
                newData,
                ['goals', 'pain_points', 'competitors', 'competitive_advantage']
            );
        }

        currentProject.goals = projectGoals;
        currentProject.pain_points = projectPainPoints;
        currentProject.competitors = projectCompetitors;
        currentProject.competitive_advantage = projectCompetitiveAdvantage;

        // Update view mode and switch back
        updateContextViewMode();
        hideContextEditMode();

        celebrateSubtle();

    } catch (error) {
        console.error('Error saving context:', error);
        showToast('Error saving context', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

// ===== Delete Project (Soft Delete with 1-hour Undo) =====
function handleDeleteProject() {
    DangerModal.show({
        title: 'Delete Project',
        itemName: currentProject.name,
        warningText: 'This project will be deleted. You can undo this within 1 hour. Automations and customers will remain available.',
        confirmPhrase: 'DELETE THIS PROJECT',
        confirmButtonText: 'Delete Project',
        onConfirm: async () => {
            try {
                // Capture project data before deletion for audit log
                const projectData = { ...currentProject };
                const projectId = currentProject.id;
                const projectName = currentProject.name;

                // Log the deletion
                if (typeof AuditLog !== 'undefined') {
                    AuditLog.logProjectDelete(projectData.organization_id, projectData);
                }

                // Soft delete - sets deleted_at timestamp
                const result = await SoftDelete.delete('projects', projectId, {
                    userId: currentUser?.id
                });

                if (!result.success) {
                    throw new Error(result.error);
                }

                // Redirect to dashboard with undo params
                window.location.href = '/app/dashboard.html?deleted=' + encodeURIComponent(projectName) + '&deletedId=' + projectId;

            } catch (error) {
                console.error('Error deleting project:', error);
                showToast('Error deleting project', 'error');
            }
        }
    });
}

// ===== Add Customers Modal =====
async function openCustomersModal() {
    selectedCustomerIds.clear();
    updateSelectedCount();

    document.getElementById('add-customers-modal').classList.add('active');
    document.getElementById('customer-search').value = '';

    // Load organization customers
    await loadSelectableCustomers();
}

function closeCustomersModal() {
    document.getElementById('add-customers-modal').classList.remove('active');
    selectedCustomerIds.clear();
    // Reset to select view
    showSelectCustomersView();
}

async function loadSelectableCustomers() {
    const list = document.getElementById('selectable-customers-list');
    list.innerHTML = '<div class="loading-spinner"></div>';

    try {
        // Get customers already in the project
        const { data: existingPCs } = await supabase
            .from('project_customers')
            .select('customer_id')
            .eq('project_id', currentProject.id);

        const existingIds = new Set(existingPCs?.map(pc => pc.customer_id) || []);

        // Get all organization customers
        const { data: customers, error } = await supabase
            .from('customers')
            .select('*')
            .eq('organization_id', currentProject.organization_id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Filter out customers already in project
        allOrgCustomers = (customers || []).filter(c => !existingIds.has(c.id));

        renderSelectableCustomers(allOrgCustomers);

    } catch (error) {
        console.error('Error loading customers:', error);
        list.innerHTML = '<p style="padding: 24px; color: var(--color-error);">Error loading customers.</p>';
    }
}

function renderSelectableCustomers(customers) {
    const list = document.getElementById('selectable-customers-list');

    if (customers.length === 0) {
        list.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--color-text-muted);">No customers available to add.</p>';
        return;
    }

    list.innerHTML = customers.map(customer => {
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown';
        const initials = getInitials(customer.first_name, customer.last_name);
        const isSelected = selectedCustomerIds.has(customer.id);

        return `
            <div class="selectable-customer ${isSelected ? 'selected' : ''}" onclick="toggleCustomerSelection('${customer.id}')">
                <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleCustomerSelection('${customer.id}')">
                <span class="customer-avatar">${initials}</span>
                <div class="customer-details">
                    <h4>${escapeHtml(name)}</h4>
                    <p>${escapeHtml(customer.email || customer.company || 'No email')}</p>
                </div>
            </div>
        `;
    }).join('');
}

function filterSelectableCustomers() {
    const search = document.getElementById('customer-search').value.toLowerCase();

    const filtered = allOrgCustomers.filter(c => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const company = (c.company || '').toLowerCase();
        return name.includes(search) || email.includes(search) || company.includes(search);
    });

    renderSelectableCustomers(filtered);
}

function toggleCustomerSelection(customerId) {
    if (selectedCustomerIds.has(customerId)) {
        selectedCustomerIds.delete(customerId);
    } else {
        selectedCustomerIds.add(customerId);
    }

    // Update UI
    const card = document.querySelector(`.selectable-customer[onclick*="${customerId}"]`);
    if (card) {
        card.classList.toggle('selected', selectedCustomerIds.has(customerId));
        card.querySelector('input[type="checkbox"]').checked = selectedCustomerIds.has(customerId);
    }

    updateSelectedCount();
}

window.toggleCustomerSelection = toggleCustomerSelection;

function updateSelectedCount() {
    const count = selectedCustomerIds.size;
    document.getElementById('selected-count').textContent = `${count} selected`;
    document.getElementById('add-selected-customers-btn').disabled = count === 0;
}

async function handleAddSelectedCustomers() {
    const btn = document.getElementById('add-selected-customers-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        const toInsert = Array.from(selectedCustomerIds).map(customerId => ({
            project_id: currentProject.id,
            customer_id: customerId
        }));

        const { error } = await supabase
            .from('project_customers')
            .insert(toInsert);

        if (error) throw error;

        celebrateSubtle();
        closeCustomersModal();
        await loadProjectCustomers(currentProject.id);

    } catch (error) {
        console.error('Error adding customers:', error);
        showToast('Error adding customers', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Selected';
    }
}

// ===== Create New Customer from Project =====
function showCreateCustomerView() {
    document.getElementById('select-customers-view').style.display = 'none';
    document.getElementById('create-customer-view').style.display = 'block';
    document.getElementById('customers-modal-title').textContent = 'Create New Customer';
    document.getElementById('new-customer-form').reset();
    document.getElementById('new-customer-first-name').focus();
}

function showSelectCustomersView() {
    document.getElementById('create-customer-view').style.display = 'none';
    document.getElementById('select-customers-view').style.display = 'block';
    document.getElementById('customers-modal-title').textContent = 'Add Customers to Project';
}

async function handleCreateNewCustomer(e) {
    e.preventDefault();

    const btn = document.getElementById('save-new-customer-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const customerData = {
        organization_id: currentProject.organization_id,
        first_name: document.getElementById('new-customer-first-name').value.trim() || null,
        last_name: document.getElementById('new-customer-last-name').value.trim() || null,
        email: document.getElementById('new-customer-email').value.trim() || null,
        phone: document.getElementById('new-customer-phone').value.trim() || null,
        company: document.getElementById('new-customer-company').value.trim() || null,
        source: 'manual'
    };

    try {
        // Create customer in organization
        const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert([customerData])
            .select()
            .single();

        if (customerError) throw customerError;

        // Add customer to this project
        const { error: projectError } = await supabase
            .from('project_customers')
            .insert([{
                project_id: currentProject.id,
                customer_id: newCustomer.id
            }]);

        if (projectError) throw projectError;

        celebrate();
        closeCustomersModal();
        await loadProjectCustomers(currentProject.id);

    } catch (error) {
        console.error('Error creating customer:', error);
        showToast('Error creating customer', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create & Add to Project';
    }
}

// ===== AI Diagnosis Functions =====
async function runProjectDiagnosis() {
    const btn = document.getElementById('run-diagnosis-btn');
    const loading = document.getElementById('diagnosis-loading');
    const results = document.getElementById('diagnosis-results');

    // Check rate limiting for business analysis
    if (window.RateLimiter && window.RateLimiter.isRateLimited('business_analysis')) {
        const errorMsg = window.RateLimiter.getRateLimitErrorMessage('business_analysis');
        showToast(errorMsg, 'error');
        return;
    }

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="spin">
            <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="25 25"/>
        </svg>
        Analyzing...
    `;
    loading.style.display = 'flex';
    results.style.display = 'none';

    // Record rate limit attempt
    if (window.RateLimiter) {
        window.RateLimiter.recordRateLimit('business_analysis');
    }

    // Generate suggestions based on project context
    const suggestions = generateDiagnosisSuggestions();

    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Render suggestions
    renderDiagnosisSuggestions(suggestions);

    // Hide loading, show results
    loading.style.display = 'none';
    results.style.display = 'flex';

    // Reset button
    btn.disabled = false;
    btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C5.58 2 2 5.58 2 10C2 14.42 5.58 18 10 18C14.42 18 18 14.42 18 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M18 2L10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 2H18V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Refresh Suggestions
    `;
}

function generateDiagnosisSuggestions() {
    const industry = currentProject?.industry || 'agnostic';
    const goals = currentProject?.goals || [];
    const painPoints = currentProject?.pain_points || [];

    // Base suggestions applicable to all industries
    const baseSuggestions = [
        {
            name: 'Welcome New Customers',
            description: 'Automatically send a warm welcome message to new customers, introducing them to your brand and key offerings.',
            icon: 'welcome',
            type: 'email',
            segment: 'New customers',
            reasoning: 'A strong first impression increases customer lifetime value and engagement.'
        },
        {
            name: 'Birthday Celebration',
            description: 'Delight customers on their special day with personalized birthday greetings and exclusive offers.',
            icon: 'birthday',
            type: 'email',
            segment: 'Customers with birthdays',
            reasoning: 'Birthday campaigns have 481% higher transaction rates than promotional emails.'
        },
        {
            name: 'Win-Back Inactive Customers',
            description: 'Re-engage customers who haven\'t interacted in 30+ days with personalized offers to bring them back.',
            icon: 'win_back',
            type: 'email',
            segment: 'Inactive customers',
            reasoning: 'Acquiring new customers costs 5x more than retaining existing ones.'
        }
    ];

    // Industry-specific suggestions
    const industrySuggestions = {
        food: [
            {
                name: 'Happy Hour Alerts',
                description: 'Notify nearby customers about daily specials, happy hour deals, and limited-time menu items.',
                icon: 'promotion',
                type: 'email',
                segment: 'Local customers',
                reasoning: 'Timely promotions drive same-day foot traffic and increase average order value.'
            },
            {
                name: 'Loyalty Rewards Update',
                description: 'Keep customers engaged by updating them on their loyalty points and available rewards.',
                icon: 'loyalty',
                type: 'email',
                segment: 'Loyalty members',
                reasoning: 'Loyalty program members spend 67% more than non-members.'
            }
        ],
        health: [
            {
                name: 'Appointment Reminders',
                description: 'Reduce no-shows by sending automated reminders before scheduled appointments.',
                icon: 'appointment',
                type: 'email',
                segment: 'Scheduled patients',
                reasoning: 'Automated reminders can reduce no-show rates by up to 38%.'
            },
            {
                name: 'Health Tips Newsletter',
                description: 'Share valuable health tips, wellness advice, and seasonal health information.',
                icon: 'education',
                type: 'email',
                segment: 'All patients',
                reasoning: 'Educational content builds trust and positions you as a health authority.'
            }
        ],
        service: [
            {
                name: 'Renewal Reminders',
                description: 'Notify clients before their contract or subscription is about to expire.',
                icon: 'renewal',
                type: 'email',
                segment: 'Expiring contracts',
                reasoning: 'Proactive renewal outreach improves retention rates by 20%.'
            },
            {
                name: 'Post-Service Follow-up',
                description: 'Check in after service delivery to ensure satisfaction and gather feedback.',
                icon: 'follow_up',
                type: 'email',
                segment: 'Recent clients',
                reasoning: 'Follow-up increases referral likelihood and identifies issues early.'
            }
        ],
        retail: [
            {
                name: 'Abandoned Cart Recovery',
                description: 'Remind customers about items left in their cart with a gentle nudge to complete their purchase.',
                icon: 'cart',
                type: 'email',
                segment: 'Cart abandoners',
                reasoning: 'Cart recovery emails have a 45% open rate and 21% click-through rate.'
            },
            {
                name: 'Product Review Request',
                description: 'Ask satisfied customers to leave reviews after their purchase.',
                icon: 'feedback',
                type: 'email',
                segment: 'Recent purchasers',
                reasoning: '93% of consumers read reviews before making a purchase decision.'
            }
        ]
    };

    // Combine base and industry suggestions
    let suggestions = [...baseSuggestions];
    if (industrySuggestions[industry]) {
        suggestions = [...suggestions, ...industrySuggestions[industry]];
    }

    // Shuffle and limit to 3-5 suggestions
    suggestions = shuffleArray(suggestions).slice(0, Math.min(5, Math.max(3, suggestions.length)));

    return suggestions;
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function renderDiagnosisSuggestions(suggestions) {
    const container = document.getElementById('diagnosis-results');

    container.innerHTML = suggestions.map((suggestion, index) => `
        <div class="diagnosis-card" data-index="${index}">
            <div class="diagnosis-card-header">
                <div class="diagnosis-card-icon">
                    ${typeof getIconSvg === 'function' ? getIconSvg(suggestion.icon) : ''}
                </div>
                <div class="diagnosis-card-info">
                    <div class="diagnosis-card-title">${escapeHtml(suggestion.name)}</div>
                    <div class="diagnosis-card-segment">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M3 12C3 9.79 4.79 8 7 8C9.21 8 11 9.79 11 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        ${escapeHtml(suggestion.segment)}
                    </div>
                </div>
            </div>
            <div class="diagnosis-card-desc">${escapeHtml(suggestion.description)}</div>
            <div style="font-size: 13px; color: var(--color-text-muted); background: var(--color-bg-secondary); padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px;">
                <strong>Why this matters:</strong> ${escapeHtml(suggestion.reasoning)}
            </div>
            <div class="diagnosis-card-actions">
                <button class="btn-create-diagnosis" onclick="createFromDiagnosis(${index})">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    Create Automation
                </button>
                <button class="btn-dismiss-diagnosis" onclick="dismissDiagnosis(${index})">Dismiss</button>
            </div>
        </div>
    `).join('');

    // Store suggestions for later use
    window.diagnosisSuggestions = suggestions;
}

async function createFromDiagnosis(index) {
    const suggestion = window.diagnosisSuggestions?.[index];
    if (!suggestion) return;

    // Pre-fill the automation modal with the suggestion
    document.getElementById('automation-name').value = suggestion.name;
    document.getElementById('automation-description').value = suggestion.description;

    // Try to detect and set type
    const typeSelect = document.getElementById('automation-type');
    if (typeSelect) {
        const type = suggestion.type === 'email' ? 'email' : 'blog_generation';
        // Check if option exists and is not disabled
        const option = typeSelect.querySelector(`option[value="${type}"]`);
        if (option && !option.disabled) {
            typeSelect.value = type;
        }
    }

    // Open the modal
    openAutomationModal();

    // Celebrate the choice
    if (typeof celebrateSubtle === 'function') {
        celebrateSubtle();
    }
}

function dismissDiagnosis(index) {
    const card = document.querySelector(`.diagnosis-card[data-index="${index}"]`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        setTimeout(() => card.remove(), 300);
    }

    // Update stored suggestions
    if (window.diagnosisSuggestions) {
        window.diagnosisSuggestions.splice(index, 1);
    }
}

window.createFromDiagnosis = createFromDiagnosis;
window.dismissDiagnosis = dismissDiagnosis;

// ===== Content Tab =====
let contentCalendar = null;
let contentPosts = [];

async function loadContentTab() {
    if (!currentProject) return;

    try {
        // Get or create content calendar for this project
        const { data: calendar, error: calError } = await supabase
            .rpc('get_or_create_content_calendar', {
                p_organization_id: currentProject.organization_id,
                p_project_id: currentProject.id
            });

        if (calError) {
            console.error('Failed to load content calendar:', calError);
            // Calendar functions might not exist yet - show empty state
            document.getElementById('empty-pipeline').style.display = 'block';
            document.getElementById('pipeline-list').style.display = 'none';
            return;
        }

        contentCalendar = calendar;

        // Populate form with existing settings
        if (calendar) {
            populateContentSettings(calendar);
        }

        // Load pipeline stats
        await loadPipelineStats();

        // Load content posts
        await loadContentPosts();

        // Setup event listeners
        setupContentTabListeners();

    } catch (error) {
        console.error('Error loading content tab:', error);
    }
}

function populateContentSettings(calendar) {
    if (calendar.strategy_prompt) {
        document.getElementById('strategy-prompt').value = calendar.strategy_prompt;
    }
    if (calendar.brand_voice) {
        document.getElementById('brand-voice').value = calendar.brand_voice;
    }
    if (calendar.target_audience) {
        document.getElementById('target-audience').value = calendar.target_audience;
    }
    if (calendar.content_pillars && Array.isArray(calendar.content_pillars)) {
        document.getElementById('content-pillars').value = calendar.content_pillars.join('\n');
    }
    if (calendar.publish_frequency) {
        document.getElementById('publish-frequency').value = calendar.publish_frequency;
    }
    if (calendar.preferred_days && Array.isArray(calendar.preferred_days)) {
        document.querySelectorAll('input[name="preferred-day"]').forEach(cb => {
            cb.checked = calendar.preferred_days.includes(cb.value);
        });
    }
    if (calendar.quality_threshold !== undefined) {
        document.getElementById('quality-threshold').value = calendar.quality_threshold;
        document.getElementById('threshold-value').textContent = calendar.quality_threshold;
    }
    if (calendar.auto_publish !== undefined) {
        document.getElementById('auto-publish').checked = calendar.auto_publish;
    }
    if (calendar.require_review !== undefined) {
        document.getElementById('require-review').checked = calendar.require_review;
    }
}

async function loadPipelineStats() {
    try {
        const { data, error } = await supabase
            .rpc('get_content_pipeline_stats', { p_project_id: currentProject.id });

        if (error) {
            console.log('Pipeline stats not available yet');
            return;
        }

        if (data && data.length > 0) {
            const stats = data[0];
            document.getElementById('stat-drafts').textContent = stats.drafts || 0;
            document.getElementById('stat-pending').textContent = stats.pending_review || 0;
            document.getElementById('stat-scheduled').textContent = stats.scheduled || 0;
            document.getElementById('stat-published').textContent = stats.published || 0;
            document.getElementById('stat-avg-quality').textContent = stats.avg_quality_score || '-';
        }
    } catch (error) {
        console.log('Pipeline stats error:', error);
    }
}

async function loadContentPosts() {
    try {
        const { data, error } = await supabase
            .from('content_posts')
            .select('*')
            .eq('project_id', currentProject.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.log('Content posts table may not exist yet');
            document.getElementById('empty-pipeline').style.display = 'block';
            document.getElementById('pipeline-list').innerHTML = '';
            return;
        }

        contentPosts = data || [];
        renderPipelineList();
    } catch (error) {
        console.log('Content posts error:', error);
        document.getElementById('empty-pipeline').style.display = 'block';
    }
}

function renderPipelineList() {
    const list = document.getElementById('pipeline-list');
    const emptyState = document.getElementById('empty-pipeline');

    if (contentPosts.length === 0) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    list.innerHTML = contentPosts.map(post => {
        const statusClass = post.status.replace('_', '-');
        const statusText = formatStatus(post.status);
        const scoreClass = post.quality_score >= 80 ? 'high' : post.quality_score >= 60 ? 'medium' : 'low';
        const date = post.scheduled_for ? new Date(post.scheduled_for).toLocaleDateString() :
                     post.created_at ? new Date(post.created_at).toLocaleDateString() : '';

        return `
            <div class="pipeline-item" data-post-id="${post.id}">
                <div class="pipeline-item-content">
                    <div class="pipeline-item-title">${escapeHtml(post.title)}</div>
                    <div class="pipeline-item-meta">
                        <span>${date}</span>
                        ${post.quality_score ? `
                            <span class="pipeline-item-score ${scoreClass}">
                                Score: ${post.quality_score}
                            </span>
                        ` : ''}
                    </div>
                </div>
                <span class="pipeline-item-status ${statusClass}">${statusText}</span>
                <div class="pipeline-item-actions">
                    <button class="btn btn-secondary btn-sm" onclick="viewPost('${post.id}')">View</button>
                    ${post.status === 'pending_review' ? `
                        <button class="btn btn-primary btn-sm" onclick="approvePost('${post.id}')">Approve</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function formatStatus(status) {
    const statusMap = {
        'draft': 'Draft',
        'pending_review': 'Pending Review',
        'approved': 'Approved',
        'scheduled': 'Scheduled',
        'published': 'Published',
        'failed': 'Failed'
    };
    return statusMap[status] || status;
}

function setupContentTabListeners() {
    // Quality threshold slider
    const thresholdSlider = document.getElementById('quality-threshold');
    const thresholdValue = document.getElementById('threshold-value');
    if (thresholdSlider && !thresholdSlider._hasListener) {
        thresholdSlider.addEventListener('input', () => {
            thresholdValue.textContent = thresholdSlider.value;
        });
        thresholdSlider._hasListener = true;
    }

    // Save settings button
    const saveBtn = document.getElementById('save-content-settings-btn');
    if (saveBtn && !saveBtn._hasListener) {
        saveBtn.addEventListener('click', saveContentSettings);
        saveBtn._hasListener = true;
    }

    // Generate strategy button
    const generateStrategyBtn = document.getElementById('generate-strategy-btn');
    if (generateStrategyBtn && !generateStrategyBtn._hasListener) {
        generateStrategyBtn.addEventListener('click', generateContentStrategy);
        generateStrategyBtn._hasListener = true;
    }

    // Generate post button
    const generatePostBtn = document.getElementById('generate-post-btn');
    if (generatePostBtn && !generatePostBtn._hasListener) {
        generatePostBtn.addEventListener('click', generateContentPost);
        generatePostBtn._hasListener = true;
    }

    // Empty state generate button
    const emptyGenerateBtn = document.getElementById('empty-generate-btn');
    if (emptyGenerateBtn && !emptyGenerateBtn._hasListener) {
        emptyGenerateBtn.addEventListener('click', generateContentPost);
        emptyGenerateBtn._hasListener = true;
    }
}

async function saveContentSettings() {
    const btn = document.getElementById('save-content-settings-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        // Get form values
        const strategyPrompt = document.getElementById('strategy-prompt').value.trim();
        const brandVoice = document.getElementById('brand-voice').value.trim();
        const targetAudience = document.getElementById('target-audience').value.trim();
        const contentPillarsText = document.getElementById('content-pillars').value.trim();
        const contentPillars = contentPillarsText ? contentPillarsText.split('\n').filter(p => p.trim()) : [];
        const publishFrequency = document.getElementById('publish-frequency').value;
        const preferredDays = Array.from(document.querySelectorAll('input[name="preferred-day"]:checked'))
            .map(cb => cb.value);
        const qualityThreshold = parseInt(document.getElementById('quality-threshold').value);
        const autoPublish = document.getElementById('auto-publish').checked;
        const requireReview = document.getElementById('require-review').checked;

        const { data, error } = await supabase
            .rpc('save_content_calendar_settings', {
                p_project_id: currentProject.id,
                p_strategy_prompt: strategyPrompt || null,
                p_brand_voice: brandVoice || null,
                p_target_audience: targetAudience || null,
                p_content_pillars: contentPillars.length > 0 ? JSON.stringify(contentPillars) : null,
                p_topics_to_avoid: null,
                p_publish_frequency: publishFrequency,
                p_preferred_days: preferredDays.length > 0 ? JSON.stringify(preferredDays) : null,
                p_quality_threshold: qualityThreshold,
                p_auto_publish: autoPublish,
                p_require_review: requireReview
            });

        if (error) throw error;

        if (data && data.success) {
            contentCalendar = data.calendar;
            showSuccess('Content settings saved');
        } else {
            throw new Error(data?.error || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Failed to save content settings:', error);
        showError('Failed to save settings: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function generateContentStrategy() {
    const btn = document.getElementById('generate-strategy-btn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner-sm"></span> Generating...';

    // Check rate limiting
    if (window.RateLimiter && window.RateLimiter.isRateLimited('business_analysis')) {
        const errorMsg = window.RateLimiter.getRateLimitErrorMessage('business_analysis');
        showError(errorMsg);
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        return;
    }

    // Record rate limit attempt
    if (window.RateLimiter) {
        window.RateLimiter.recordRateLimit('business_analysis');
    }

    try {
        // Build context from project and content settings
        const context = buildContentStrategyContext();

        // Generate strategy using AI (mock implementation)
        const strategy = await callAIForContentStrategy(context);

        // Save strategy to database
        const { data, error } = await supabase
            .rpc('save_content_calendar_settings', {
                p_project_id: currentProject.id,
                p_strategy_prompt: document.getElementById('strategy-prompt').value.trim() || null,
                p_brand_voice: document.getElementById('brand-voice').value.trim() || null,
                p_target_audience: document.getElementById('target-audience').value.trim() || null,
                p_content_pillars: strategy.contentPillars.length > 0 ? JSON.stringify(strategy.contentPillars) : null,
                p_topics_to_avoid: strategy.topicsToAvoid.length > 0 ? JSON.stringify(strategy.topicsToAvoid) : null,
                p_publish_frequency: document.getElementById('publish-frequency').value,
                p_preferred_days: null,
                p_quality_threshold: parseInt(document.getElementById('quality-threshold').value),
                p_auto_publish: document.getElementById('auto-publish').checked,
                p_require_review: document.getElementById('require-review').checked
            });

        if (error) throw error;

        // Update UI with generated strategy
        displayGeneratedStrategy(strategy);

        // Update the calendar data
        if (data && data.success) {
            contentCalendar = data.calendar;
        }

        // Celebrate success
        if (typeof celebrate === 'function') {
            celebrate();
        }

        showSuccess('Content strategy generated successfully!');

    } catch (error) {
        console.error('Failed to generate strategy:', error);
        showError('Failed to generate strategy: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function buildContentStrategyContext() {
    // Gather all project context for AI
    return {
        project: {
            name: currentProject.name,
            description: currentProject.description,
            industry: currentProject.industry,
            targetMarket: currentProject.target_market,
            location: currentProject.location,
            goals: currentProject.goals || [],
            painPoints: currentProject.pain_points || [],
            competitors: currentProject.competitors || [],
            competitiveAdvantage: currentProject.competitive_advantage
        },
        contentSettings: {
            strategyPrompt: document.getElementById('strategy-prompt')?.value.trim() || '',
            brandVoice: document.getElementById('brand-voice')?.value.trim() || '',
            targetAudience: document.getElementById('target-audience')?.value.trim() || '',
            contentPillars: document.getElementById('content-pillars')?.value.trim().split('\n').filter(p => p.trim()) || [],
            publishFrequency: document.getElementById('publish-frequency')?.value || 'weekly'
        }
    };
}

// Mock AI implementation for content strategy generation
// In production, this would call Claude API via a backend service
async function callAIForContentStrategy(context) {
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { project, contentSettings } = context;
    const industry = project.industry || 'agnostic';

    // Industry-specific content themes
    const industryThemes = {
        food: {
            pillars: [
                'Seasonal Recipes & Menu Highlights',
                'Behind-the-Scenes Kitchen Stories',
                'Chef Tips & Cooking Techniques',
                'Local Ingredients & Sourcing',
                'Customer Spotlights & Reviews'
            ],
            topics: [
                'Weekly specials and seasonal menu features',
                'Recipe breakdowns and cooking tips from the chef',
                'Stories about local farmers and ingredient sourcing',
                'Food pairing guides and wine/beverage recommendations',
                'Kitchen team profiles and day-in-the-life content'
            ],
            avoid: ['Competitor mentions', 'Price comparisons', 'Negative food trends'],
            tone: 'warm, inviting, and passionate about food'
        },
        health: {
            pillars: [
                'Wellness Tips & Prevention',
                'Treatment Insights & Education',
                'Patient Success Stories',
                'Health News & Research',
                'Community Health Events'
            ],
            topics: [
                'Seasonal health tips and preventive care advice',
                'Common condition explanations and treatment options',
                'Staff introductions and expertise highlights',
                'New services and technology announcements',
                'Community health initiatives and partnerships'
            ],
            avoid: ['Medical guarantees', 'Specific pricing', 'Competitive comparisons'],
            tone: 'trustworthy, caring, and educational'
        },
        service: {
            pillars: [
                'Industry Insights & Trends',
                'Case Studies & Success Stories',
                'Expert Tips & Best Practices',
                'Company News & Culture',
                'Client Spotlights'
            ],
            topics: [
                'Industry trend analysis and market insights',
                'How-to guides and professional tips',
                'Project case studies with measurable results',
                'Team expertise and thought leadership pieces',
                'Client testimonials and partnership stories'
            ],
            avoid: ['Pricing details', 'Competitor criticism', 'Overpromising results'],
            tone: 'professional, knowledgeable, and solution-oriented'
        },
        retail: {
            pillars: [
                'Product Showcases & New Arrivals',
                'Style Guides & Trends',
                'Behind-the-Brand Stories',
                'Customer Features & Reviews',
                'Sales & Special Offers'
            ],
            topics: [
                'New product launches and collection previews',
                'Styling tips and product pairing ideas',
                'Brand story and sustainability initiatives',
                'Customer photos and user-generated content',
                'Seasonal buying guides and gift ideas'
            ],
            avoid: ['Competitor products', 'Negative reviews', 'Out-of-stock items'],
            tone: 'exciting, trendy, and customer-focused'
        },
        technology: {
            pillars: [
                'Product Updates & Features',
                'Tech Tips & Tutorials',
                'Industry News & Analysis',
                'Behind-the-Code Stories',
                'User Success Stories'
            ],
            topics: [
                'Feature releases and product roadmap updates',
                'How-to tutorials and best practices',
                'Tech industry analysis and trend pieces',
                'Engineering team insights and tech deep-dives',
                'Customer implementation case studies'
            ],
            avoid: ['Security vulnerabilities', 'Competitor FUD', 'Unreleased features'],
            tone: 'innovative, helpful, and technically credible'
        }
    };

    // Get base themes or use generic ones
    const themes = industryThemes[industry] || {
        pillars: [
            'Company News & Updates',
            'Industry Insights',
            'Customer Stories',
            'Tips & How-To Guides',
            'Behind-the-Scenes'
        ],
        topics: [
            'Company milestones and announcements',
            'Industry trend analysis and commentary',
            'Customer success stories and testimonials',
            'Practical tips and educational content',
            'Team culture and company values'
        ],
        avoid: ['Controversial topics', 'Competitor criticism', 'Unverified claims'],
        tone: 'professional, engaging, and authentic'
    };

    // Merge user-provided pillars with AI suggestions
    let contentPillars = contentSettings.contentPillars.length > 0
        ? contentSettings.contentPillars
        : themes.pillars.slice(0, 4);

    // Generate topic calendar for next 4 weeks
    const topicCalendar = generateTopicCalendar(themes.topics, contentSettings.publishFrequency);

    // Build strategy object
    const strategy = {
        contentPillars,
        suggestedTopics: themes.topics,
        topicCalendar,
        topicsToAvoid: themes.avoid,
        recommendedTone: contentSettings.brandVoice || themes.tone,
        audienceInsights: generateAudienceInsights(project, contentSettings),
        competitorAnalysis: generateCompetitorInsights(project),
        seriesIdeas: generateSeriesIdeas(industry, project),
        quickWins: generateQuickWins(industry)
    };

    return strategy;
}

function generateTopicCalendar(topics, frequency) {
    const calendar = [];
    const weeksAhead = 4;
    const postsPerWeek = frequency === 'daily' ? 5 :
                         frequency === 'twice_weekly' ? 2 :
                         frequency === 'biweekly' ? 0.5 :
                         frequency === 'monthly' ? 0.25 : 1;

    const totalPosts = Math.ceil(weeksAhead * postsPerWeek);
    const shuffledTopics = [...topics].sort(() => Math.random() - 0.5);

    const today = new Date();
    for (let i = 0; i < totalPosts; i++) {
        const daysAhead = Math.floor(i * (7 / postsPerWeek));
        const publishDate = new Date(today);
        publishDate.setDate(publishDate.getDate() + daysAhead);

        calendar.push({
            week: Math.floor(i / postsPerWeek) + 1,
            topic: shuffledTopics[i % shuffledTopics.length],
            suggestedDate: publishDate.toISOString().split('T')[0],
            status: 'suggested'
        });
    }

    return calendar;
}

function generateAudienceInsights(project, contentSettings) {
    const insights = [];

    if (project.targetMarket) {
        insights.push(`Your target market is ${project.targetMarket}. Content should speak directly to their needs and aspirations.`);
    }

    if (project.painPoints && project.painPoints.length > 0) {
        insights.push(`Address these pain points in your content: ${project.painPoints.slice(0, 3).join(', ')}. Solution-focused content resonates well.`);
    }

    if (project.goals && project.goals.length > 0) {
        insights.push(`Align content with your goals: ${project.goals.slice(0, 2).join(', ')}. Every piece should move toward these objectives.`);
    }

    if (contentSettings.targetAudience) {
        insights.push(`For ${contentSettings.targetAudience}, focus on value-first content that establishes trust before asking for action.`);
    }

    // Add generic insight if no specific ones
    if (insights.length === 0) {
        insights.push('Define your target audience to get personalized content recommendations.');
    }

    return insights;
}

function generateCompetitorInsights(project) {
    if (!project.competitors || project.competitors.length === 0) {
        return ['Add competitors to get differentiation strategies and content gap analysis.'];
    }

    const insights = [
        `Monitoring ${project.competitors.length} competitor(s). Look for content gaps they\'re not addressing.`,
        'Focus on your unique angle: ' + (project.competitiveAdvantage || 'what makes you different from the competition'),
        'Create content that showcases your unique strengths and expertise.'
    ];

    return insights;
}

function generateSeriesIdeas(industry, project) {
    const seriesTemplates = {
        food: [
            { name: 'Chef\'s Table Series', description: '4-part series on signature dishes and their stories', posts: 4 },
            { name: 'Farm to Table', description: 'Monthly spotlight on local ingredient suppliers', posts: 6 },
            { name: 'Kitchen Secrets', description: 'Weekly tips from the kitchen team', posts: 8 }
        ],
        health: [
            { name: 'Wellness Wednesday', description: 'Weekly health tips and preventive care advice', posts: 8 },
            { name: 'Meet Our Team', description: 'Staff profiles highlighting expertise', posts: 6 },
            { name: 'Patient Journey', description: 'Success stories (with consent)', posts: 4 }
        ],
        service: [
            { name: 'Expert Insights', description: 'Deep-dive industry analysis series', posts: 6 },
            { name: 'Case Study Spotlight', description: 'Monthly client success stories', posts: 4 },
            { name: 'How We Work', description: 'Behind-the-scenes process reveals', posts: 4 }
        ],
        retail: [
            { name: 'Style Guide Series', description: 'Seasonal styling and trend guides', posts: 4 },
            { name: 'Product Stories', description: 'The story behind our products', posts: 6 },
            { name: 'Customer Spotlight', description: 'Featuring real customers', posts: 8 }
        ],
        technology: [
            { name: 'Feature Deep Dives', description: 'Technical exploration of key features', posts: 6 },
            { name: 'Tech Tips Tuesday', description: 'Weekly productivity and usage tips', posts: 8 },
            { name: 'Building in Public', description: 'Engineering team insights', posts: 4 }
        ]
    };

    return seriesTemplates[industry] || [
        { name: 'Behind the Scenes', description: 'Company culture and team stories', posts: 4 },
        { name: 'Customer Success', description: 'Highlighting customer achievements', posts: 6 },
        { name: 'Industry Insights', description: 'Thought leadership content', posts: 4 }
    ];
}

function generateQuickWins(industry) {
    const quickWins = {
        food: [
            'Share a simple recipe video (60 seconds)',
            'Post a "dish of the day" photo with story',
            'Create a poll asking customers about their favorite menu items'
        ],
        health: [
            'Share a quick health tip infographic',
            'Post a team member introduction',
            'Create a FAQ post addressing common patient questions'
        ],
        service: [
            'Share an industry statistic with your take',
            'Post a quick tip related to your expertise',
            'Create a "myth vs fact" post about your industry'
        ],
        retail: [
            'Share a product styling tip',
            'Post a customer photo (with permission)',
            'Create a "new arrivals" roundup'
        ],
        technology: [
            'Share a quick tip for using your product',
            'Post about a recent feature update',
            'Create a "did you know?" fact about your tech'
        ]
    };

    return quickWins[industry] || [
        'Share a company milestone or achievement',
        'Post a behind-the-scenes photo',
        'Create a poll to engage your audience'
    ];
}

function displayGeneratedStrategy(strategy) {
    // Update content pillars textarea
    const pillarsTextarea = document.getElementById('content-pillars');
    if (pillarsTextarea && strategy.contentPillars.length > 0) {
        pillarsTextarea.value = strategy.contentPillars.join('\n');
    }

    // Create or update strategy display section
    let strategyDisplay = document.getElementById('generated-strategy-display');
    if (!strategyDisplay) {
        strategyDisplay = document.createElement('div');
        strategyDisplay.id = 'generated-strategy-display';
        strategyDisplay.className = 'generated-strategy-display';

        // Insert after the content settings grid
        const settingsGrid = document.querySelector('.content-settings-grid');
        if (settingsGrid) {
            settingsGrid.parentNode.insertBefore(strategyDisplay, settingsGrid.nextSibling);
        }
    }

    strategyDisplay.innerHTML = `
        <div class="strategy-section">
            <h3>📅 Content Calendar (Next 4 Weeks)</h3>
            <div class="topic-calendar">
                ${strategy.topicCalendar.map(item => `
                    <div class="calendar-item">
                        <span class="calendar-date">${item.suggestedDate}</span>
                        <span class="calendar-topic">${escapeHtml(item.topic)}</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="strategy-section">
            <h3>🎯 Audience Insights</h3>
            <ul class="insights-list">
                ${strategy.audienceInsights.map(insight => `
                    <li>${escapeHtml(insight)}</li>
                `).join('')}
            </ul>
        </div>

        <div class="strategy-section">
            <h3>🏆 Quick Wins</h3>
            <p style="color: var(--color-text-muted); margin-bottom: 12px;">Start with these easy content ideas:</p>
            <ul class="quick-wins-list">
                ${strategy.quickWins.map(win => `
                    <li>${escapeHtml(win)}</li>
                `).join('')}
            </ul>
        </div>

        <div class="strategy-section">
            <h3>📚 Series Ideas</h3>
            <div class="series-ideas">
                ${strategy.seriesIdeas.map(series => `
                    <div class="series-card">
                        <h4>${escapeHtml(series.name)}</h4>
                        <p>${escapeHtml(series.description)}</p>
                        <span class="series-posts">${series.posts} posts</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="strategy-section">
            <h3>🔍 Competitor Analysis</h3>
            <ul class="insights-list">
                ${strategy.competitorAnalysis.map(insight => `
                    <li>${escapeHtml(insight)}</li>
                `).join('')}
            </ul>
        </div>

        <div class="strategy-section">
            <h3>🚫 Topics to Avoid</h3>
            <div class="avoid-topics">
                ${strategy.topicsToAvoid.map(topic => `
                    <span class="avoid-tag">${escapeHtml(topic)}</span>
                `).join('')}
            </div>
        </div>
    `;
}

async function generateContentPost() {
    const btn = document.getElementById('generate-post-btn') || document.getElementById('empty-generate-btn');
    if (!btn) return;

    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner-sm"></span> Generating...';

    // Check rate limiting
    if (window.RateLimiter && window.RateLimiter.isRateLimited('business_analysis')) {
        const errorMsg = window.RateLimiter.getRateLimitErrorMessage('business_analysis');
        showError(errorMsg);
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        return;
    }

    // Record rate limit attempt
    if (window.RateLimiter) {
        window.RateLimiter.recordRateLimit('business_analysis');
    }

    try {
        // Look up the customer app linked to this project
        let appId = null;
        const { data: linkedApp } = await supabase
            .from('customer_apps')
            .select('id')
            .eq('project_id', currentProject.id)
            .is('deleted_at', null)
            .single();

        if (linkedApp) {
            appId = linkedApp.id;
        }

        // Build context for content generation
        const context = buildContentPostContext();

        // Generate content using AI (mock implementation)
        const generatedPost = await callAIForContentPost(context);

        // Save to database
        const { data: newPost, error } = await supabase
            .from('content_posts')
            .insert([{
                organization_id: currentProject.organization_id,
                project_id: currentProject.id,
                calendar_id: contentCalendar?.id || null,
                app_id: appId,
                title: generatedPost.title,
                slug: generateSlug(generatedPost.title),
                excerpt: generatedPost.excerpt,
                body: generatedPost.body,
                body_html: generatedPost.bodyHtml,
                hero_image_url: generatedPost.heroImage?.url || null,
                hero_image_alt: generatedPost.heroImage?.alt || null,
                hero_image_prompt: generatedPost.heroImage?.prompt || null,
                social_snippets: generatedPost.socialSnippets,
                meta_title: generatedPost.seo?.title || generatedPost.title,
                meta_description: generatedPost.seo?.description || generatedPost.excerpt,
                keywords: generatedPost.seo?.keywords || [],
                ai_generated: true,
                ai_model: 'claude-3-opus',
                ai_prompt_used: context.prompt,
                generation_context: context,
                quality_score: generatedPost.qualityScore,
                quality_breakdown: generatedPost.qualityBreakdown,
                quality_notes: generatedPost.qualityNotes,
                status: generatedPost.qualityScore >= (contentCalendar?.quality_threshold || 80) && !contentCalendar?.require_review
                    ? 'approved'
                    : 'pending_review'
            }])
            .select()
            .single();

        if (error) throw error;

        // Refresh the pipeline
        await loadContentPosts();
        await loadPipelineStats();

        // Celebrate
        if (typeof celebrate === 'function') {
            celebrate();
        }

        // Show the generated post in a preview
        showGeneratedPostPreview(generatedPost, newPost.id);

        showSuccess('Content generated successfully!');

    } catch (error) {
        console.error('Failed to generate post:', error);
        showError('Failed to generate post: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function buildContentPostContext() {
    const strategyPrompt = document.getElementById('strategy-prompt')?.value.trim() || '';
    const brandVoice = document.getElementById('brand-voice')?.value.trim() || '';
    const targetAudience = document.getElementById('target-audience')?.value.trim() || '';
    const contentPillars = document.getElementById('content-pillars')?.value.trim().split('\n').filter(p => p.trim()) || [];

    return {
        project: {
            name: currentProject.name,
            description: currentProject.description,
            industry: currentProject.industry,
            targetMarket: currentProject.target_market,
            goals: currentProject.goals || [],
            painPoints: currentProject.pain_points || []
        },
        contentStrategy: {
            strategyPrompt,
            brandVoice,
            targetAudience,
            contentPillars
        },
        prompt: `Generate a blog post for ${currentProject.name}, a ${currentProject.industry} business.
                 Target audience: ${targetAudience || currentProject.target_market || 'general audience'}.
                 Brand voice: ${brandVoice || 'professional and engaging'}.
                 Topics to cover: ${contentPillars.join(', ') || 'industry insights'}.`
    };
}

// Mock AI implementation for content post generation
async function callAIForContentPost(context) {
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 2500));

    const { project, contentStrategy } = context;
    const industry = project.industry || 'agnostic';

    // Industry-specific content templates
    const contentTemplates = {
        food: {
            titles: [
                `5 Reasons Why ${project.name}'s Seasonal Menu is a Must-Try`,
                `Behind the Kitchen: How We Source Our Ingredients`,
                `The Secret to Our Signature Dish Revealed`,
                `A Taste of Tradition: Our Chef's Favorite Family Recipe`,
                `Why Local Ingredients Make All the Difference`
            ],
            openings: [
                `There's something magical about a meal made with care and passion.`,
                `At ${project.name}, we believe food tells a story.`,
                `Every dish has a journey, from farm to table.`,
                `Great food isn't just about ingredients—it's about the love behind them.`
            ]
        },
        health: {
            titles: [
                `Understanding Your Health: Common Questions Answered`,
                `Prevention First: Simple Steps to Better Wellness`,
                `Meet Our Team: Dedicated to Your Care`,
                `New Approaches in ${project.industry}: What You Should Know`,
                `Your Wellness Journey Starts Here`
            ],
            openings: [
                `Taking care of your health shouldn't be complicated.`,
                `At ${project.name}, we're committed to your wellbeing.`,
                `Understanding your body is the first step to better health.`,
                `We believe in treating the whole person, not just symptoms.`
            ]
        },
        service: {
            titles: [
                `How ${project.name} Delivers Results That Matter`,
                `Industry Insights: Trends Shaping the Future`,
                `Client Success Story: Achieving Goals Together`,
                `Expert Tips for Getting the Most From Your Investment`,
                `Why Experience Matters in Professional Services`
            ],
            openings: [
                `In today's competitive landscape, expertise makes all the difference.`,
                `At ${project.name}, we pride ourselves on delivering measurable results.`,
                `Success isn't accidental—it's the result of proven strategies.`,
                `When you work with the right partner, challenges become opportunities.`
            ]
        },
        retail: {
            titles: [
                `New Arrivals: What's Trending This Season`,
                `Style Guide: How to Mix and Match Like a Pro`,
                `Behind the Brand: Our Story and Mission`,
                `Customer Spotlight: Real People, Real Style`,
                `Why Quality Matters: Our Commitment to You`
            ],
            openings: [
                `Style is personal, and we're here to help you find yours.`,
                `At ${project.name}, every product tells a story.`,
                `The best things in life are worth waiting for—and so is quality.`,
                `Fashion changes, but great style is timeless.`
            ]
        },
        technology: {
            titles: [
                `Introducing New Features That Will Transform Your Workflow`,
                `Tech Tips: Get More From ${project.name}`,
                `Behind the Code: How We Built Our Latest Feature`,
                `Customer Story: How [Company] Achieved 10x Results`,
                `The Future of ${project.industry}: Trends to Watch`
            ],
            openings: [
                `Technology should make your life easier, not more complicated.`,
                `At ${project.name}, innovation drives everything we do.`,
                `The best tools are the ones you barely notice—they just work.`,
                `We're constantly pushing the boundaries of what's possible.`
            ]
        }
    };

    // Get templates or use generic
    const templates = contentTemplates[industry] || {
        titles: [
            `News from ${project.name}: What's New`,
            `Behind the Scenes at ${project.name}`,
            `Tips and Insights from Our Team`,
            `How ${project.name} is Making a Difference`,
            `Your Guide to Getting the Most From Us`
        ],
        openings: [
            `At ${project.name}, we're always looking for ways to serve you better.`,
            `There's a lot happening at ${project.name}, and we're excited to share.`,
            `We believe in transparency and keeping you informed.`,
            `Thank you for being part of our journey.`
        ]
    };

    // Select random title and opening
    const title = templates.titles[Math.floor(Math.random() * templates.titles.length)];
    const opening = templates.openings[Math.floor(Math.random() * templates.openings.length)];

    // Generate body content
    const bodyParagraphs = generateBodyContent(project, contentStrategy, title);
    const body = `${opening}\n\n${bodyParagraphs.join('\n\n')}`;

    // Generate excerpt
    const excerpt = opening.length > 150 ? opening.substring(0, 147) + '...' : opening;

    // Convert to simple HTML
    const bodyHtml = `<p>${body.split('\n\n').join('</p><p>')}</p>`;

    // Generate social snippets
    const socialSnippets = {
        twitter: `${title.substring(0, 200)}${title.length > 200 ? '...' : ''} 🚀`,
        linkedin: `New article: ${title}\n\n${excerpt}\n\nRead more on our blog.`,
        instagram: `📝 ${title}\n\n${opening}\n\n#${project.industry || 'business'} #${project.name.replace(/\s/g, '')}`,
        facebook: `${title}\n\n${opening}\n\nRead the full article on our blog!`
    };

    // Generate SEO metadata
    const seo = {
        title: title.length > 60 ? title.substring(0, 57) + '...' : title,
        description: excerpt.length > 160 ? excerpt.substring(0, 157) + '...' : excerpt,
        keywords: generateKeywords(project, contentStrategy)
    };

    // Generate hero image suggestion
    const heroImage = {
        url: null, // Would be generated by DALL-E in production
        alt: `Featured image for: ${title}`,
        prompt: `Professional, modern image representing ${project.industry || 'business'}: ${title}. Clean, high-quality, suitable for blog header.`
    };

    // Generate quality score (simulated)
    const qualityBreakdown = {
        brandAlignment: Math.floor(Math.random() * 15) + 80,
        seoOptimization: Math.floor(Math.random() * 20) + 75,
        engagementPotential: Math.floor(Math.random() * 15) + 80,
        readability: Math.floor(Math.random() * 10) + 85,
        originality: Math.floor(Math.random() * 15) + 80
    };

    const qualityScore = Math.round(
        Object.values(qualityBreakdown).reduce((a, b) => a + b, 0) /
        Object.values(qualityBreakdown).length
    );

    const qualityNotes = qualityScore >= 85
        ? 'Excellent content quality. Strong brand alignment and engagement potential.'
        : qualityScore >= 75
        ? 'Good content quality. Minor improvements could enhance engagement.'
        : 'Content meets basic requirements. Consider revisions for better performance.';

    return {
        title,
        excerpt,
        body,
        bodyHtml,
        heroImage,
        socialSnippets,
        seo,
        qualityScore,
        qualityBreakdown,
        qualityNotes
    };
}

function generateBodyContent(project, contentStrategy, title) {
    const paragraphs = [];

    // Introduction expansion
    paragraphs.push(
        `Whether you're a long-time supporter or just discovering us, we're thrilled to share what makes ${project.name} special. Our commitment to excellence drives everything we do, and we're always looking for new ways to exceed your expectations.`
    );

    // Main content based on industry
    if (project.industry === 'food') {
        paragraphs.push(
            `Quality ingredients are the foundation of great food. We work closely with local suppliers to ensure every dish meets our exacting standards. From farm-fresh produce to artisanal products, we believe you can taste the difference.`,
            `Our culinary team brings years of experience and passion to every plate. They constantly innovate while honoring traditional techniques, creating dishes that are both familiar and exciting.`,
            `We invite you to experience what makes our menu truly special. Whether you're joining us for a casual lunch or a special celebration, we're here to make every visit memorable.`
        );
    } else if (project.industry === 'health') {
        paragraphs.push(
            `Your health journey is unique, and we're here to support you every step of the way. Our team takes a personalized approach, understanding that one size doesn't fit all when it comes to wellness.`,
            `Prevention and education are at the heart of what we do. We believe that informed patients make better decisions, which is why we take the time to explain options and answer questions.`,
            `Whether you're looking to address a specific concern or simply maintain your wellbeing, we're here to partner with you on your path to better health.`
        );
    } else if (project.industry === 'service') {
        paragraphs.push(
            `Results matter, and we measure our success by the outcomes we achieve for our clients. Our team brings deep expertise and a proven track record to every engagement.`,
            `We take the time to understand your unique challenges and goals. This personalized approach allows us to develop strategies that address your specific needs, not generic solutions.`,
            `Our commitment to your success extends beyond the initial engagement. We're here to support you as your needs evolve and new opportunities arise.`
        );
    } else if (project.industry === 'retail') {
        paragraphs.push(
            `Every product in our collection is carefully selected with you in mind. We prioritize quality, style, and value—because you deserve the best.`,
            `Our team stays on top of trends while maintaining a focus on timeless pieces that will serve you well for years to come. It's this balance that sets our collection apart.`,
            `Shopping should be enjoyable, not stressful. Whether you visit us in store or browse online, we're committed to making your experience seamless and satisfying.`
        );
    } else if (project.industry === 'technology') {
        paragraphs.push(
            `Technology should empower you, not complicate your life. That's why we focus on creating intuitive solutions that solve real problems.`,
            `Our development team works tirelessly to improve and enhance our offerings. Regular updates ensure you always have access to the latest features and improvements.`,
            `We value your feedback and use it to guide our roadmap. Your success is our success, and we're committed to building tools that help you achieve your goals.`
        );
    } else {
        paragraphs.push(
            `At ${project.name}, we're driven by a simple mission: to deliver exceptional value to everyone we serve. This commitment guides our decisions and shapes our culture.`,
            `Our team brings together diverse perspectives and expertise, allowing us to approach challenges creatively and deliver innovative solutions.`,
            `We're grateful for your trust and support. As we continue to grow and evolve, we remain focused on what matters most—you.`
        );
    }

    // Closing call to action
    paragraphs.push(
        `We'd love to hear from you. Whether you have questions, feedback, or just want to connect, don't hesitate to reach out. Thank you for being part of the ${project.name} community.`
    );

    return paragraphs;
}

function generateKeywords(project, contentStrategy) {
    const keywords = [];

    // Add project-based keywords
    if (project.name) {
        keywords.push(project.name.toLowerCase());
    }
    if (project.industry) {
        keywords.push(project.industry);
    }
    if (project.targetMarket) {
        keywords.push(...project.targetMarket.toLowerCase().split(' ').slice(0, 3));
    }

    // Add content pillar keywords
    if (contentStrategy.contentPillars && contentStrategy.contentPillars.length > 0) {
        contentStrategy.contentPillars.forEach(pillar => {
            keywords.push(...pillar.toLowerCase().split(' ').slice(0, 2));
        });
    }

    // Industry-specific keywords
    const industryKeywords = {
        food: ['restaurant', 'dining', 'cuisine', 'menu', 'chef'],
        health: ['wellness', 'healthcare', 'health', 'care', 'medical'],
        service: ['professional', 'consulting', 'services', 'solutions', 'expertise'],
        retail: ['shop', 'products', 'style', 'quality', 'collection'],
        technology: ['software', 'tech', 'digital', 'innovation', 'solution']
    };

    if (industryKeywords[project.industry]) {
        keywords.push(...industryKeywords[project.industry].slice(0, 3));
    }

    // Deduplicate and limit
    return [...new Set(keywords)].slice(0, 10);
}

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
}

function showGeneratedPostPreview(post, postId) {
    // Create modal for previewing generated content
    let modal = document.getElementById('post-preview-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'post-preview-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal post-preview-modal">
                <div class="modal-header">
                    <h2>Generated Content Preview</h2>
                    <button class="modal-close" onclick="closePostPreview()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body" id="post-preview-content"></div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closePostPreview()">Close</button>
                    <button class="btn btn-primary" id="approve-preview-btn">Approve & Schedule</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const content = document.getElementById('post-preview-content');
    content.innerHTML = `
        <div class="preview-header">
            <h3>${escapeHtml(post.title)}</h3>
            <div class="preview-quality">
                <span class="quality-badge ${post.qualityScore >= 80 ? 'high' : post.qualityScore >= 60 ? 'medium' : 'low'}">
                    Quality Score: ${post.qualityScore}/100
                </span>
            </div>
        </div>

        <div class="preview-section">
            <h4>Excerpt</h4>
            <p>${escapeHtml(post.excerpt)}</p>
        </div>

        <div class="preview-section">
            <h4>Full Content</h4>
            <div class="preview-body">${post.bodyHtml}</div>
        </div>

        <div class="preview-section">
            <h4>Quality Breakdown</h4>
            <div class="quality-breakdown">
                ${Object.entries(post.qualityBreakdown).map(([key, value]) => `
                    <div class="quality-item">
                        <span class="quality-label">${formatQualityLabel(key)}</span>
                        <div class="quality-bar">
                            <div class="quality-fill" style="width: ${value}%; background: ${value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444'}"></div>
                        </div>
                        <span class="quality-value">${value}</span>
                    </div>
                `).join('')}
            </div>
            <p class="quality-notes">${escapeHtml(post.qualityNotes)}</p>
        </div>

        <div class="preview-section">
            <h4>Social Media Snippets</h4>
            <div class="social-snippets">
                ${Object.entries(post.socialSnippets).map(([platform, text]) => `
                    <div class="social-snippet">
                        <strong>${platform.charAt(0).toUpperCase() + platform.slice(1)}</strong>
                        <p>${escapeHtml(text)}</p>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="preview-section">
            <h4>SEO Details</h4>
            <div class="seo-details">
                <p><strong>Title:</strong> ${escapeHtml(post.seo.title)}</p>
                <p><strong>Description:</strong> ${escapeHtml(post.seo.description)}</p>
                <p><strong>Keywords:</strong> ${post.seo.keywords.map(k => escapeHtml(k)).join(', ')}</p>
            </div>
        </div>

        <div class="preview-section">
            <h4>Hero Image Prompt</h4>
            <p class="image-prompt">${escapeHtml(post.heroImage.prompt)}</p>
            <p class="image-note">🎨 Image generation available with DALL-E integration</p>
        </div>
    `;

    // Setup approve button
    const approveBtn = document.getElementById('approve-preview-btn');
    approveBtn.onclick = () => {
        approvePost(postId);
        closePostPreview();
    };

    modal.classList.add('active');
}

function formatQualityLabel(key) {
    const labels = {
        brandAlignment: 'Brand Alignment',
        seoOptimization: 'SEO Optimization',
        engagementPotential: 'Engagement Potential',
        readability: 'Readability',
        originality: 'Originality'
    };
    return labels[key] || key;
}

function closePostPreview() {
    const modal = document.getElementById('post-preview-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

window.closePostPreview = closePostPreview;

async function viewPost(postId) {
    try {
        // Fetch post data
        const { data: post, error } = await supabase
            .from('content_posts')
            .select('*')
            .eq('id', postId)
            .single();

        if (error) throw error;
        if (!post) {
            showError('Post not found');
            return;
        }

        // Open editor modal
        openPostEditorModal(post);

    } catch (error) {
        console.error('Error loading post:', error);
        showError('Failed to load post');
    }
}

function openPostEditorModal(post) {
    // Create or get modal
    let modal = document.getElementById('post-editor-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'post-editor-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    const statusOptions = ['draft', 'pending_review', 'approved', 'scheduled', 'published']
        .map(s => `<option value="${s}" ${post.status === s ? 'selected' : ''}>${formatStatus(s)}</option>`)
        .join('');

    const qualityClass = post.quality_score >= 80 ? 'high' : post.quality_score >= 60 ? 'medium' : 'low';

    modal.innerHTML = `
        <div class="modal post-editor-modal">
            <div class="modal-header">
                <h2>Edit Content</h2>
                <div class="modal-header-actions">
                    ${post.quality_score ? `
                        <span class="quality-badge ${qualityClass}">Score: ${post.quality_score}</span>
                    ` : ''}
                    <button class="modal-close" onclick="closePostEditorModal()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="modal-body">
                <div class="editor-grid">
                    <div class="editor-main">
                        <div class="form-group">
                            <label for="edit-post-title">Title</label>
                            <input type="text" id="edit-post-title" value="${escapeHtml(post.title)}" class="input-lg">
                        </div>

                        <div class="form-group">
                            <label for="edit-post-excerpt">Excerpt</label>
                            <textarea id="edit-post-excerpt" rows="2">${escapeHtml(post.excerpt || '')}</textarea>
                        </div>

                        <div class="form-group">
                            <label for="edit-post-body">Content</label>
                            <textarea id="edit-post-body" rows="15" class="editor-textarea">${escapeHtml(post.body || '')}</textarea>
                        </div>
                    </div>

                    <div class="editor-sidebar">
                        <div class="editor-section">
                            <h4>Publishing</h4>
                            <div class="form-group">
                                <label for="edit-post-status">Status</label>
                                <select id="edit-post-status">${statusOptions}</select>
                            </div>

                            <div class="form-group" id="schedule-group" style="${post.status === 'scheduled' ? '' : 'display: none;'}">
                                <label for="edit-post-schedule">Schedule For</label>
                                <input type="datetime-local" id="edit-post-schedule"
                                    value="${post.scheduled_for ? new Date(post.scheduled_for).toISOString().slice(0, 16) : ''}">
                            </div>
                        </div>

                        <div class="editor-section">
                            <h4>SEO</h4>
                            <div class="form-group">
                                <label for="edit-post-meta-title">Meta Title</label>
                                <input type="text" id="edit-post-meta-title" value="${escapeHtml(post.meta_title || '')}" maxlength="60">
                                <span class="char-count" id="meta-title-count">${(post.meta_title || '').length}/60</span>
                            </div>

                            <div class="form-group">
                                <label for="edit-post-meta-desc">Meta Description</label>
                                <textarea id="edit-post-meta-desc" rows="2" maxlength="160">${escapeHtml(post.meta_description || '')}</textarea>
                                <span class="char-count" id="meta-desc-count">${(post.meta_description || '').length}/160</span>
                            </div>
                        </div>

                        <div class="editor-section">
                            <h4>Social Snippets</h4>
                            <div class="social-tabs">
                                <button class="social-tab active" data-platform="twitter">Twitter</button>
                                <button class="social-tab" data-platform="linkedin">LinkedIn</button>
                                <button class="social-tab" data-platform="facebook">Facebook</button>
                            </div>
                            <textarea id="edit-social-snippet" rows="3" data-platform="twitter">${escapeHtml(post.social_snippets?.twitter || '')}</textarea>
                        </div>

                        ${post.quality_breakdown ? `
                            <div class="editor-section">
                                <h4>Quality Breakdown</h4>
                                <div class="quality-mini-breakdown">
                                    ${Object.entries(post.quality_breakdown).map(([key, value]) => `
                                        <div class="quality-mini-item">
                                            <span>${formatQualityLabel(key)}</span>
                                            <span class="${value >= 80 ? 'high' : value >= 60 ? 'medium' : 'low'}">${value}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <div class="footer-left">
                    <button class="btn btn-danger-outline" onclick="deletePost('${post.id}')">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 4H14M5 4V3C5 2.44772 5.44772 2 6 2H10C10.5523 2 11 2.44772 11 3V4M6 7V11M10 7V11M3 4L4 13C4 13.5523 4.44772 14 5 14H11C11.5523 14 12 13.5523 12 13L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Delete
                    </button>
                </div>
                <div class="footer-right">
                    <button class="btn btn-secondary" onclick="closePostEditorModal()">Cancel</button>
                    <button class="btn btn-secondary" onclick="savePostDraft('${post.id}')">Save Draft</button>
                    ${post.status === 'pending_review' || post.status === 'draft' ? `
                        <button class="btn btn-primary" onclick="approveAndSchedulePost('${post.id}')">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M3 8L6 11L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Approve
                        </button>
                    ` : post.status === 'approved' || post.status === 'scheduled' ? `
                        <button class="btn btn-primary" onclick="publishPostNow('${post.id}')">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Publish Now
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Store social snippets for tab switching
    modal._socialSnippets = { ...post.social_snippets };
    modal._currentPlatform = 'twitter';

    // Setup event listeners
    setupPostEditorListeners(modal, post);

    modal.classList.add('active');
}

function setupPostEditorListeners(modal, post) {
    // Status change shows/hides schedule field
    const statusSelect = document.getElementById('edit-post-status');
    const scheduleGroup = document.getElementById('schedule-group');
    statusSelect.addEventListener('change', () => {
        scheduleGroup.style.display = statusSelect.value === 'scheduled' ? '' : 'none';
    });

    // Character counters
    const metaTitle = document.getElementById('edit-post-meta-title');
    const metaTitleCount = document.getElementById('meta-title-count');
    metaTitle.addEventListener('input', () => {
        metaTitleCount.textContent = `${metaTitle.value.length}/60`;
    });

    const metaDesc = document.getElementById('edit-post-meta-desc');
    const metaDescCount = document.getElementById('meta-desc-count');
    metaDesc.addEventListener('input', () => {
        metaDescCount.textContent = `${metaDesc.value.length}/160`;
    });

    // Social tabs
    const socialTabs = modal.querySelectorAll('.social-tab');
    const socialSnippet = document.getElementById('edit-social-snippet');

    socialTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Save current
            modal._socialSnippets[modal._currentPlatform] = socialSnippet.value;

            // Switch tab
            socialTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Load new platform
            const platform = tab.dataset.platform;
            modal._currentPlatform = platform;
            socialSnippet.value = modal._socialSnippets[platform] || '';
            socialSnippet.dataset.platform = platform;
        });
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closePostEditorModal();
        }
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closePostEditorModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function closePostEditorModal() {
    const modal = document.getElementById('post-editor-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function savePostDraft(postId) {
    const modal = document.getElementById('post-editor-modal');
    const btn = modal.querySelector('button[onclick*="savePostDraft"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        // Collect form data
        const title = document.getElementById('edit-post-title').value.trim();
        const excerpt = document.getElementById('edit-post-excerpt').value.trim();
        const body = document.getElementById('edit-post-body').value.trim();
        const status = document.getElementById('edit-post-status').value;
        const scheduledFor = document.getElementById('edit-post-schedule').value;
        const metaTitle = document.getElementById('edit-post-meta-title').value.trim();
        const metaDescription = document.getElementById('edit-post-meta-desc').value.trim();

        // Get social snippets
        const socialSnippet = document.getElementById('edit-social-snippet');
        modal._socialSnippets[modal._currentPlatform] = socialSnippet.value;

        // Convert body to HTML (simple conversion)
        const bodyHtml = `<p>${body.split('\n\n').join('</p><p>')}</p>`;

        // Update post
        const { error } = await supabase
            .from('content_posts')
            .update({
                title,
                slug: generateSlug(title),
                excerpt,
                body,
                body_html: bodyHtml,
                status,
                scheduled_for: status === 'scheduled' && scheduledFor ? new Date(scheduledFor).toISOString() : null,
                meta_title: metaTitle || title,
                meta_description: metaDescription || excerpt,
                social_snippets: modal._socialSnippets,
                updated_at: new Date().toISOString()
            })
            .eq('id', postId);

        if (error) throw error;

        showSuccess('Post saved');
        await loadContentPosts();
        await loadPipelineStats();

    } catch (error) {
        console.error('Failed to save post:', error);
        showError('Failed to save post');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function approveAndSchedulePost(postId) {
    const status = document.getElementById('edit-post-status').value;
    const scheduledFor = document.getElementById('edit-post-schedule').value;

    // First save the draft
    await savePostDraft(postId);

    try {
        // Then approve
        const { data, error } = await supabase
            .rpc('approve_content_post', {
                p_post_id: postId,
                p_schedule_for: status === 'scheduled' && scheduledFor ? new Date(scheduledFor).toISOString() : null,
                p_notes: null
            });

        if (error) throw error;

        if (data && data.success) {
            showSuccess(scheduledFor ? 'Post approved and scheduled' : 'Post approved');
            closePostEditorModal();
            await loadContentPosts();
            await loadPipelineStats();

            if (typeof celebrateSubtle === 'function') {
                celebrateSubtle();
            }
        } else {
            throw new Error(data?.error || 'Failed to approve');
        }

    } catch (error) {
        console.error('Failed to approve post:', error);
        showError('Failed to approve post');
    }
}

async function publishPostNow(postId) {
    // First save any changes
    await savePostDraft(postId);

    try {
        const { data, error } = await supabase
            .rpc('publish_content_post', { p_post_id: postId });

        if (error) throw error;

        if (data && data.success) {
            showSuccess('Post published!');
            closePostEditorModal();
            await loadContentPosts();
            await loadPipelineStats();

            if (typeof celebrate === 'function') {
                celebrate();
            }
        } else {
            throw new Error(data?.error || 'Failed to publish');
        }

    } catch (error) {
        console.error('Failed to publish post:', error);
        showError('Failed to publish post');
    }
}

async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) {
        return;
    }

    try {
        // Soft delete
        const { error } = await supabase
            .from('content_posts')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', postId);

        if (error) throw error;

        showSuccess('Post deleted');
        closePostEditorModal();
        await loadContentPosts();
        await loadPipelineStats();

    } catch (error) {
        console.error('Failed to delete post:', error);
        showError('Failed to delete post');
    }
}

// Make editor functions globally available
window.closePostEditorModal = closePostEditorModal;
window.savePostDraft = savePostDraft;
window.approveAndSchedulePost = approveAndSchedulePost;
window.publishPostNow = publishPostNow;
window.deletePost = deletePost;

async function approvePost(postId) {
    try {
        const { data, error } = await supabase
            .rpc('approve_content_post', { p_post_id: postId });

        if (error) throw error;

        if (data && data.success) {
            showSuccess('Post approved');
            await loadContentPosts();
            await loadPipelineStats();
        } else {
            throw new Error(data?.error || 'Failed to approve post');
        }
    } catch (error) {
        console.error('Failed to approve post:', error);
        showError('Failed to approve post');
    }
}

// Make content functions globally available
window.viewPost = viewPost;
window.approvePost = approvePost;

// ===== Utility Functions =====
function escapeHtml(text) {
    // Use AppUtils if available (preferred), otherwise fallback to DOM method
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
        return AppUtils.escapeHtml(text);
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function showSuccess(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'success');
    } else if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
        AppUtils.showToast(message, 'success');
    } else {
        console.log('✓', message);
    }
}

function showError(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'error');
    } else if (typeof AppUtils !== 'undefined' && typeof AppUtils.showToast === 'function') {
        AppUtils.showToast(message, 'error');
    } else {
        console.error('✗', message);
        alert(message);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initProject);
