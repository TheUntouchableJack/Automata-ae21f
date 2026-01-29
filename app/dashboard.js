// ===== Dashboard Initialization =====
let currentUser = null;
let currentOrganization = null;
let currentUsage = null;
let orgLimits = null;

async function initDashboard() {
    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Load user info
    await loadUserInfo();

    // Load user's organization
    await loadOrganization();

    // Load usage data
    await loadUsageData();

    // Load projects
    await loadProjects();

    // Setup event listeners
    setupEventListeners();
}

// ===== Load Organization =====
async function loadOrganization() {
    try {
        // First get the membership
        const { data: memberships, error: memberError } = await supabase
            .from('organization_members')
            .select('organization_id, role')
            .eq('user_id', currentUser.id)
            .limit(1);

        if (memberError) throw memberError;

        if (!memberships || memberships.length === 0) {
            console.error('No organization membership found');
            return;
        }

        // Then get the organization details including plan info
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('id, name, slug, plan_type, appsumo_tier, subscription_tier, plan_limits_override')
            .eq('id', memberships[0].organization_id)
            .single();

        if (orgError) throw orgError;

        currentOrganization = org;

        // Get plan limits
        if (typeof getOrgLimits === 'function') {
            orgLimits = getOrgLimits(org);
        }
    } catch (error) {
        console.error('Error loading organization:', error);
    }
}

// ===== Load Usage Data =====
async function loadUsageData() {
    if (!currentOrganization) return;

    try {
        // Try to get current usage period
        const { data: usage, error } = await supabase
            .rpc('get_current_usage', { org_id: currentOrganization.id });

        if (error) {
            // If RPC doesn't exist yet, calculate manually
            console.log('get_current_usage not available, calculating manually');
            await calculateUsageManually();
            return;
        }

        currentUsage = usage;

        // Update snapshot counts
        await supabase.rpc('update_usage_snapshots', { org_id: currentOrganization.id });

        // Re-fetch updated usage
        const { data: updatedUsage } = await supabase
            .rpc('get_current_usage', { org_id: currentOrganization.id });

        if (updatedUsage) {
            currentUsage = updatedUsage;
        }

        renderUsageDashboard();
    } catch (error) {
        console.error('Error loading usage data:', error);
        // Fall back to manual calculation
        await calculateUsageManually();
    }
}

// ===== Calculate Usage Manually (fallback) =====
async function calculateUsageManually() {
    if (!currentOrganization) return;

    try {
        // Count projects
        const { count: projectsCount } = await supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id);

        // Count automations via projects
        const { data: projects } = await supabase
            .from('projects')
            .select('id')
            .eq('organization_id', currentOrganization.id);

        let automationsCount = 0;
        if (projects && projects.length > 0) {
            const projectIds = projects.map(p => p.id);
            const { count } = await supabase
                .from('automations')
                .select('*', { count: 'exact', head: true })
                .in('project_id', projectIds);
            automationsCount = count || 0;
        }

        // Count customers
        const { count: customersCount } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id);

        currentUsage = {
            projects_count: projectsCount || 0,
            automations_count: automationsCount,
            customers_count: customersCount || 0,
            emails_sent: 0,
            sms_sent: 0,
            ai_analyses_used: 0
        };

        renderUsageDashboard();
    } catch (error) {
        console.error('Error calculating usage:', error);
    }
}

// ===== Render Usage Dashboard =====
function renderUsageDashboard() {
    const usageSection = document.getElementById('usage-section');
    const usageMetrics = document.getElementById('usage-metrics');
    const planName = document.getElementById('usage-plan-name');
    const planBadge = document.getElementById('usage-plan-badge');
    const redeemBtn = document.getElementById('redeem-code-btn');
    const upgradeBtn = document.getElementById('upgrade-btn');
    const usageFooter = document.getElementById('usage-footer');

    if (!usageSection || !currentUsage || !orgLimits) return;

    // Show the section
    usageSection.style.display = 'block';

    // Set plan name and badge
    planName.textContent = orgLimits.name || 'Free';

    if (orgLimits.badge) {
        planBadge.textContent = orgLimits.badge;
        planBadge.style.display = 'inline-block';
    }

    // Show redeem button for free users or AppSumo users who can stack
    if (currentOrganization.plan_type === 'free' ||
        (currentOrganization.plan_type === 'appsumo_lifetime' && currentOrganization.appsumo_tier < 3)) {
        redeemBtn.style.display = 'inline-flex';
    }

    // Hide upgrade button for max tier AppSumo or enterprise
    if (currentOrganization.plan_type === 'appsumo_lifetime' && currentOrganization.appsumo_tier === 3) {
        upgradeBtn.textContent = 'Stack Code';
        upgradeBtn.href = '/app/redeem.html';
    } else if (currentOrganization.subscription_tier === 'enterprise') {
        upgradeBtn.style.display = 'none';
    }

    // Render metrics
    const metrics = [
        {
            key: 'projects',
            label: 'Projects',
            used: currentUsage.projects_count || 0,
            limit: orgLimits.projects,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
        },
        {
            key: 'automations',
            label: 'Automations',
            used: currentUsage.automations_count || 0,
            limit: orgLimits.automations,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
        },
        {
            key: 'customers',
            label: 'Customers',
            used: currentUsage.customers_count || 0,
            limit: orgLimits.customers,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
        },
        {
            key: 'emails',
            label: 'Emails',
            used: currentUsage.emails_sent || 0,
            limit: orgLimits.emails_monthly,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
            resets: true
        },
        {
            key: 'ai',
            label: 'AI Analyses',
            used: currentUsage.ai_analyses_used || 0,
            limit: orgLimits.ai_analyses,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/><circle cx="12" cy="12" r="3"/></svg>',
            resets: true
        }
    ];

    usageMetrics.innerHTML = metrics.map(m => {
        const isUnlimited = m.limit === -1;
        const percent = isUnlimited ? 0 : Math.min(Math.round((m.used / m.limit) * 100), 100);
        const status = getUsageStatusClass(percent);

        return `
            <div class="usage-metric ${isUnlimited ? 'unlimited' : ''}">
                <div class="usage-metric-header">
                    <div class="usage-metric-label">
                        ${m.icon}
                        ${m.label}
                    </div>
                    ${m.resets ? '<span class="usage-metric-value">This month</span>' : ''}
                </div>
                ${!isUnlimited ? `
                    <div class="usage-metric-bar">
                        <div class="usage-metric-fill ${status}" style="width: ${percent}%"></div>
                    </div>
                ` : ''}
                <div class="usage-metric-numbers">
                    <span class="usage-metric-used">${m.used.toLocaleString()}</span>
                    <span class="usage-metric-limit">/ ${isUnlimited ? 'Unlimited' : m.limit.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');

    // Show footer with reset date
    usageFooter.style.display = 'flex';
    const resetDate = document.getElementById('reset-date');
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    resetDate.textContent = nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getUsageStatusClass(percent) {
    if (percent >= 100) return 'critical';
    if (percent >= 80) return 'warning';
    if (percent >= 50) return 'moderate';
    return 'healthy';
}

// ===== Load User Info =====
async function loadUserInfo() {
    const profile = await getUserProfile(currentUser.id);

    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');

    if (profile && (profile.first_name || profile.last_name)) {
        const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        const initials = getInitials(profile.first_name, profile.last_name);
        userAvatar.textContent = initials;
        userName.textContent = fullName;
    } else {
        const initials = currentUser.email.substring(0, 2).toUpperCase();
        userAvatar.textContent = initials;
        userName.textContent = currentUser.email.split('@')[0];
    }
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

// ===== Load Projects =====
async function loadProjects() {
    const loading = document.getElementById('loading');
    const projectsGrid = document.getElementById('projects-grid');
    const emptyState = document.getElementById('empty-state');

    if (!currentOrganization) {
        loading.innerHTML = '<p style="color: var(--color-error);">No organization found. Please contact support.</p>';
        return;
    }

    try {
        const { data: projects, error } = await supabase
            .from('projects')
            .select(`
                *,
                automations(count)
            `)
            .eq('organization_id', currentOrganization.id)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        loading.style.display = 'none';

        if (!projects || projects.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        projectsGrid.style.display = 'grid';
        renderProjects(projects);

    } catch (error) {
        console.error('Error loading projects:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading projects. Please refresh.</p>';
    }
}

function renderProjects(projects) {
    const projectsGrid = document.getElementById('projects-grid');

    const projectCards = projects.map(project => {
        const automationCount = project.automations?.[0]?.count || 0;
        const createdDate = new Date(project.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });

        return `
            <div class="project-card" data-project-id="${project.id}">
                <div class="project-card-header">
                    <div class="project-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                            <path d="M8 10H16M8 14H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </div>
                    ${project.industry ? `<span class="project-industry">${project.industry}</span>` : ''}
                </div>
                <h3 class="project-name">${escapeHtml(project.name)}</h3>
                <p class="project-description">${escapeHtml(project.description || 'No description')}</p>
                <div class="project-meta">
                    <span class="project-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M8 5V8L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        ${createdDate}
                    </span>
                    <span class="project-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8L7 12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        ${automationCount} automation${automationCount !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Add create project card at the end
    const createCard = `
        <div class="create-project-card" id="create-project-card">
            <div class="create-project-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <span>Create New Project</span>
        </div>
    `;

    projectsGrid.innerHTML = projectCards + createCard;

    // Add click handlers for project cards
    document.querySelectorAll('.project-card[data-project-id]').forEach(card => {
        card.addEventListener('click', () => {
            const projectId = card.dataset.projectId;
            if (projectId) {
                // Use hash-based routing since server strips query params
                window.location.href = `/app/project.html#${projectId}`;
            }
        });
    });

    // Add click handler for create card
    document.getElementById('create-project-card').addEventListener('click', openCreateModal);
}

// ===== Event Listeners =====
function setupEventListeners() {
    // User menu toggle
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');

    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        userDropdown.classList.remove('active');
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
    });

    // New project buttons
    document.getElementById('new-project-btn').addEventListener('click', openCreateModal);
    document.getElementById('empty-new-project-btn')?.addEventListener('click', openCreateModal);

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeCreateModal);
    document.getElementById('modal-cancel').addEventListener('click', closeCreateModal);

    // Close modal on overlay click
    document.getElementById('create-project-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCreateModal();
        }
    });

    // Create project form
    document.getElementById('create-project-form').addEventListener('submit', handleCreateProject);

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCreateModal();
        }
    });
}

// ===== Modal Functions =====
function openCreateModal() {
    document.getElementById('create-project-modal').classList.add('active');
    document.getElementById('project-name').focus();
}

function closeCreateModal() {
    document.getElementById('create-project-modal').classList.remove('active');
    document.getElementById('create-project-form').reset();
}

// ===== Create Project =====
async function handleCreateProject(e) {
    e.preventDefault();

    const createBtn = document.getElementById('create-btn');
    const originalText = createBtn.textContent;

    // Check limit before creating
    if (orgLimits && currentUsage && typeof checkLimit === 'function') {
        const limitCheck = checkLimit(
            currentOrganization,
            { projects: currentUsage.projects_count || 0 },
            'projects'
        );

        if (!limitCheck.allowed) {
            showUpgradeModal('projects', limitCheck);
            return;
        }
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    const name = document.getElementById('project-name').value.trim();
    const description = document.getElementById('project-description').value.trim();
    const industry = document.getElementById('project-industry').value;

    try {
        const { data, error } = await supabase
            .from('projects')
            .insert([{
                organization_id: currentOrganization.id,
                created_by: currentUser.id,
                name,
                description,
                industry: industry || null,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Update local usage count
        if (currentUsage) {
            currentUsage.projects_count = (currentUsage.projects_count || 0) + 1;
            renderUsageDashboard();
        }

        // Celebrate!
        celebrate();
        createBtn.textContent = 'Created!';
        createBtn.classList.add('btn-success');

        // Redirect to the new project after brief celebration
        setTimeout(() => {
            window.location.href = `/app/project.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating project:', error);
        alert('Error creating project. Please try again.');
        createBtn.disabled = false;
        createBtn.textContent = originalText;
    }
}

// ===== Upgrade Modal =====
function showUpgradeModal(limitType, limitCheck) {
    const modal = document.getElementById('upgrade-modal');
    if (!modal) {
        // Create modal if it doesn't exist
        createUpgradeModal();
    }

    const upgradeTitle = document.getElementById('upgrade-title');
    const upgradeMessage = document.getElementById('upgrade-message');
    const upgradeOptions = document.getElementById('upgrade-options');

    // Set title and message
    const limitNames = {
        projects: 'Projects',
        automations: 'Automations',
        customers: 'Customers',
        emails_monthly: 'Monthly Emails',
        ai_analyses: 'AI Analyses'
    };

    upgradeTitle.textContent = `${limitNames[limitType] || 'Limit'} Reached`;
    upgradeMessage.textContent = limitCheck.message;

    // Get upgrade options
    const options = typeof getUpgradeOptions === 'function'
        ? getUpgradeOptions(currentOrganization)
        : [];

    upgradeOptions.innerHTML = options.map(opt => `
        <a href="${opt.action === 'redeem' ? '/app/redeem.html' : '/pricing.html'}" class="upgrade-option">
            <div class="upgrade-option-icon">
                ${opt.type === 'stack_code' || opt.type === 'appsumo'
                    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>'
                    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
                }
            </div>
            <div class="upgrade-option-content">
                <h4>${opt.label}</h4>
                <p>${opt.description}</p>
            </div>
        </a>
    `).join('');

    document.getElementById('upgrade-modal').classList.add('active');
}

function createUpgradeModal() {
    const modalHtml = `
        <div class="modal-overlay upgrade-modal" id="upgrade-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2 id="upgrade-title">Limit Reached</h2>
                    <button class="modal-close" onclick="closeUpgradeModal()">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="upgrade-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <p class="upgrade-message" id="upgrade-message">You've reached your limit.</p>
                    <div class="upgrade-options" id="upgrade-options">
                        <!-- Options populated by JS -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeUpgradeModal()">Maybe Later</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Close on overlay click
    document.getElementById('upgrade-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeUpgradeModal();
        }
    });
}

function closeUpgradeModal() {
    const modal = document.getElementById('upgrade-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ===== Utility Functions =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initDashboard);
