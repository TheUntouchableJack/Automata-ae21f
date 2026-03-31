// ===== Automations Page =====
let currentUser = null;
let currentOrganization = null;
let allAutomations = [];
let allProjects = [];
let lifecycleAutomations = [];  // Lifecycle automations from automation_definitions
let currentFilter = 'all';
let currentView = 'project';  // 'project' or 'lifecycle'
let searchQuery = '';
let selectedIcon = 'workflow';
let selectedTemplateId = null;
let isSubmitting = false;  // Guard against double-submit

// Pagination state
let currentPage = 1;
const ITEMS_PER_PAGE = 12;

async function initAutomations() {
    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Load user info and organization in parallel (optimized)
    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    // Initialize sidebar with user data (including role for admin features)
    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    // Load projects and automations in parallel (optimized)
    await Promise.all([
        loadProjects(),
        loadAutomations(),
        loadLifecycleAutomations()
    ]);

    // Setup event listeners
    setupEventListeners();

    // Populate templates grid
    populateTemplatesGrid();

    // Populate icon picker
    populateIconPicker();
}

// Use shared utilities for loadOrganization
// See: /app/utils.js

// ===== Load Projects =====
async function loadProjects() {
    if (!currentOrganization) return;

    try {
        const { data: projects, error } = await supabase
            .from('projects')
            .select('id, name, industry')
            .eq('organization_id', currentOrganization.id)
            .order('name');

        if (error) throw error;

        allProjects = projects || [];

        // Populate project dropdowns
        populateProjectDropdowns();
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function populateProjectDropdowns() {
    const scratchSelect = document.getElementById('scratch-project');
    const templateSelect = document.getElementById('template-project');

    const options = allProjects.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');

    if (scratchSelect) {
        scratchSelect.innerHTML = '<option value="">Select a project</option>' + options;
    }
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">Select a project</option>' + options;
    }
}

// Use shared utilities for loadUserInfo and getInitials
// See: /app/utils.js

// ===== Load Automations =====
async function loadAutomations() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('automations-grid');
    const emptyState = document.getElementById('empty-state');

    if (!currentOrganization) {
        loading.innerHTML = '<p style="color: var(--color-error);">No organization found.</p>';
        return;
    }

    try {
        // Load automations for the organization via projects (exclude soft-deleted)
        // Limit to 1000 to prevent unbounded queries at scale
        const { data: automations, error } = await supabase
            .from('automations')
            .select(`
                *,
                projects!inner (
                    id,
                    name,
                    industry,
                    organization_id
                )
            `)
            .eq('projects.organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1000);

        if (error) throw error;

        allAutomations = automations || [];

        loading.style.display = 'none';
        updateCounts();
        renderAutomations();

    } catch (error) {
        console.error('Error loading automations:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading automations.</p>';
    }
}

// ===== Load Lifecycle Automations =====
async function loadLifecycleAutomations() {
    if (!currentOrganization) return;

    try {
        // Load lifecycle automations from automation_definitions
        // Include both org-specific and system templates that are enabled
        const { data: automations, error } = await supabase
            .from('automation_definitions')
            .select(`
                *,
                automation_executions (
                    id,
                    status,
                    created_at
                )
            `)
            .or(`organization_id.eq.${currentOrganization.id},and(is_template.eq.true,organization_id.is.null)`)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        // Calculate execution stats for each automation
        lifecycleAutomations = (automations || []).map(a => {
            const executions = a.automation_executions || [];
            const last7Days = executions.filter(e => {
                const execDate = new Date(e.created_at);
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                return execDate >= weekAgo;
            });
            const successCount = last7Days.filter(e => e.status === 'success').length;

            return {
                ...a,
                execution_count_7d: last7Days.length,
                success_rate_7d: last7Days.length > 0 ? Math.round((successCount / last7Days.length) * 100) : 0
            };
        });

        updateCounts();

    } catch (error) {
        console.error('Error loading lifecycle automations:', error);
    }
}

// ===== Toggle Lifecycle Automation =====
async function toggleLifecycleAutomation(id, enable) {
    try {
        const { error } = await supabase
            .from('automation_definitions')
            .update({ is_enabled: enable, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        // Update local data
        const automation = lifecycleAutomations.find(a => a.id === id);
        if (automation) automation.is_enabled = enable;

        updateCounts();
        renderAutomations();

        if (enable && typeof celebrate === 'function') {
            celebrate({ intensity: 'subtle' });
        }

    } catch (error) {
        console.error('Error toggling automation:', error);
        showToast('Error updating automation', 'error');
    }
}

window.toggleLifecycleAutomation = toggleLifecycleAutomation;

// ===== Update Filter Counts =====
function updateCounts() {
    if (currentView === 'lifecycle') {
        // Lifecycle automations counts
        const enabledCount = lifecycleAutomations.filter(a => a.is_enabled).length;
        const disabledCount = lifecycleAutomations.filter(a => !a.is_enabled).length;
        const aiEnabledCount = lifecycleAutomations.filter(a => a.ai_can_enable && a.is_enabled).length;
        const allCount = lifecycleAutomations.length;

        document.getElementById('count-all').textContent = allCount;
        document.getElementById('count-active').textContent = enabledCount;
        document.getElementById('count-inactive').textContent = disabledCount;
        document.getElementById('count-archived').textContent = aiEnabledCount;

        // Update tab labels for lifecycle view
        const tabs = document.querySelectorAll('.filter-tab');
        if (tabs[3]) tabs[3].innerHTML = `AI-Enabled <span class="count" id="count-archived">${aiEnabledCount}</span>`;
    } else {
        // Project automations counts (original)
        const activeCount = allAutomations.filter(a => a.is_active && !a.is_archived).length;
        const inactiveCount = allAutomations.filter(a => !a.is_active && !a.is_archived).length;
        const archivedCount = allAutomations.filter(a => a.is_archived).length;
        const allCount = allAutomations.filter(a => !a.is_archived).length;

        document.getElementById('count-all').textContent = allCount;
        document.getElementById('count-active').textContent = activeCount;
        document.getElementById('count-inactive').textContent = inactiveCount;
        document.getElementById('count-archived').textContent = archivedCount;

        // Reset tab label
        const tabs = document.querySelectorAll('.filter-tab');
        if (tabs[3]) tabs[3].innerHTML = `Archived <span class="count" id="count-archived">${archivedCount}</span>`;
    }
}

// ===== Render Automations =====
function renderAutomations() {
    const grid = document.getElementById('automations-grid');
    const emptyState = document.getElementById('empty-state');
    const paginationContainer = document.getElementById('pagination');

    // Use lifecycle or project automations based on current view
    if (currentView === 'lifecycle') {
        renderLifecycleAutomations();
        return;
    }

    // Filter automations
    let filtered = allAutomations;

    // Apply status filter
    switch (currentFilter) {
        case 'active':
            filtered = filtered.filter(a => a.is_active && !a.is_archived);
            break;
        case 'inactive':
            filtered = filtered.filter(a => !a.is_active && !a.is_archived);
            break;
        case 'archived':
            filtered = filtered.filter(a => a.is_archived);
            break;
        default: // 'all'
            filtered = filtered.filter(a => !a.is_archived);
    }

    // Apply search filter
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(query) ||
            (a.description && a.description.toLowerCase().includes(query)) ||
            (a.projects?.name && a.projects.name.toLowerCase().includes(query))
        );
    }

    if (filtered.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        if (paginationContainer) paginationContainer.style.display = 'none';
        updateEmptyState();
        return;
    }

    // Pagination calculations
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    // Ensure current page is valid
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    // Get items for current page
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedItems = filtered.slice(startIndex, endIndex);

    emptyState.style.display = 'none';
    grid.style.display = 'grid';

    grid.innerHTML = paginatedItems.map(automation => {
        const isArchived = automation.is_archived;
        const statusClass = isArchived ? 'archived' : (automation.is_active ? 'active' : 'inactive');
        const statusText = isArchived ? 'Archived' : (automation.is_active ? 'Active' : 'Inactive');
        const projectName = automation.projects?.name || 'No Project';
        const description = automation.description || `${formatType(automation.type)} automation running ${formatFrequency(automation.frequency).toLowerCase()}.`;

        const typeIcon = getAutomationIcon(automation);

        return `
            <div class="automation-card ${isArchived ? 'archived' : ''}" data-id="${automation.id}">
                ${isArchived ? `
                    <a href="javascript:void(0)" class="btn-action" onclick="restoreAutomation('${automation.id}')">Restore</a>
                ` : `
                    <a href="/app/automation.html#${automation.id}" class="btn-action">Open</a>
                `}
                <div class="automation-card-icon">
                    ${typeIcon}
                </div>
                <span class="automation-card-badge ${statusClass}">${statusText}</span>
                <h3 class="automation-card-title">${escapeHtml(automation.name)}</h3>
                <p class="automation-card-desc">${escapeHtml(description)}</p>
                <div class="automation-card-meta">
                    <span class="automation-card-project">${escapeHtml(projectName)}</span>
                    <span class="automation-card-frequency">${formatFrequency(automation.frequency)}</span>
                    <div class="automation-card-actions">
                        ${isArchived ? `
                            <button class="btn-secondary-action delete" onclick="deleteAutomation('${automation.id}', '${escapeHtml(automation.name).replace(/'/g, "\\'")}')">Delete</button>
                        ` : `
                            <button class="btn-secondary-action archive" onclick="archiveAutomation('${automation.id}')">Archive</button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Render pagination
    renderPagination(totalItems, totalPages);
}

// ===== Render Lifecycle Automations =====
function renderLifecycleAutomations() {
    const grid = document.getElementById('automations-grid');
    const emptyState = document.getElementById('empty-state');
    const paginationContainer = document.getElementById('pagination');

    // Filter lifecycle automations
    let filtered = lifecycleAutomations;

    // Apply status filter
    switch (currentFilter) {
        case 'active':
            filtered = filtered.filter(a => a.is_enabled);
            break;
        case 'inactive':
            filtered = filtered.filter(a => !a.is_enabled);
            break;
        case 'archived':  // In lifecycle view, this is "AI-Enabled"
            filtered = filtered.filter(a => a.ai_can_enable && a.is_enabled);
            break;
        default: // 'all'
            // Show all
            break;
    }

    // Apply search filter
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(query) ||
            (a.description && a.description.toLowerCase().includes(query)) ||
            (a.category && a.category.toLowerCase().includes(query))
        );
    }

    if (filtered.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        if (paginationContainer) paginationContainer.style.display = 'none';
        updateEmptyState();
        return;
    }

    // Pagination
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedItems = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    emptyState.style.display = 'none';
    grid.style.display = 'grid';

    grid.innerHTML = paginatedItems.map(automation => {
        const isEnabled = automation.is_enabled;
        const statusClass = isEnabled ? 'active' : 'inactive';
        const statusText = isEnabled ? 'Enabled' : 'Disabled';
        const aiEnabled = automation.ai_can_enable;
        const category = formatCategory(automation.category);
        const triggerType = formatTriggerType(automation.trigger_type);
        const execCount = automation.execution_count_7d || 0;
        const successRate = automation.success_rate_7d || 0;

        const categoryIcon = getCategoryIcon(automation.category);

        return `
            <div class="automation-card lifecycle-card ${isEnabled ? '' : 'disabled'}" data-id="${automation.id}" ${automation.sequence_key ? `onclick="showSequencePipeline('${escapeHtml(automation.sequence_key)}')" style="cursor:pointer;"` : ''}>
                <div class="automation-card-icon">
                    ${categoryIcon}
                </div>
                ${aiEnabled ? '<span class="ai-badge" title="AI can manage this automation">AI</span>' : ''}
                ${automation.target_type === 'organizations' ? '<span class="target-badge" title="Targets businesses" style="position:absolute;top:12px;left:12px;background:#10b981;color:white;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;">Businesses</span>' : ''}
                ${automation.sequence_key ? `<span class="sequence-badge" title="Part of ${escapeHtml(automation.sequence_key)} sequence" style="position:absolute;top:${automation.target_type === 'organizations' ? '32' : '12'}px;left:12px;background:#6366f1;color:white;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;">Step ${automation.sequence_step || ''}</span>` : ''}
                <span class="automation-card-badge ${statusClass}">${statusText}</span>
                <h3 class="automation-card-title">${escapeHtml(automation.name)}</h3>
                <p class="automation-card-desc">${escapeHtml(automation.description || `${category} automation`)}</p>
                <div class="automation-card-stats">
                    <span class="stat" title="Executions in last 7 days">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M7 1V7L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                        ${execCount} runs
                    </span>
                    ${execCount > 0 ? `<span class="stat success" title="Success rate">${successRate}%</span>` : ''}
                </div>
                <div class="automation-card-meta">
                    <span class="automation-card-project">${category}</span>
                    <span class="automation-card-frequency">${triggerType}</span>
                    <div class="automation-card-actions">
                        <label class="toggle-switch">
                            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleLifecycleAutomation('${automation.id}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    renderPagination(totalItems, totalPages);
}

// ===== Lifecycle Helpers =====
function formatCategory(category) {
    const categories = {
        'welcome': 'Welcome',
        'engagement': 'Engagement',
        'retention': 'Retention',
        'recovery': 'Recovery',
        'behavioral': 'Behavioral',
        'proactive': 'Proactive'
    };
    return categories[category] || category || 'Automation';
}

function formatTriggerType(type) {
    const types = {
        'event': 'Event-based',
        'schedule': 'Scheduled',
        'condition': 'Conditional',
        'ai': 'AI-triggered'
    };
    return types[type] || type || 'Manual';
}

function getCategoryIcon(category) {
    const icons = {
        'welcome': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        'engagement': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        'retention': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`,
        'recovery': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M21 3V9H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 21V15H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        'behavioral': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M22 12H18L15 21L9 3L6 12H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        'proactive': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
    };
    return icons[category] || icons['engagement'];
}

// ===== Pagination Functions =====
function renderPagination(totalItems, totalPages) {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;

    // Hide pagination if only one page
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }

    paginationContainer.style.display = 'flex';

    const startItem = (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const endItem = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);

    // Generate page numbers with ellipsis for large page counts
    let pageNumbers = '';
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
        // Show all pages
        for (let i = 1; i <= totalPages; i++) {
            pageNumbers += `<button class="pagination-page ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
    } else {
        // Show pages with ellipsis
        if (currentPage <= 3) {
            for (let i = 1; i <= 4; i++) {
                pageNumbers += `<button class="pagination-page ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            pageNumbers += '<span class="pagination-ellipsis">...</span>';
            pageNumbers += `<button class="pagination-page" data-page="${totalPages}">${totalPages}</button>`;
        } else if (currentPage >= totalPages - 2) {
            pageNumbers += `<button class="pagination-page" data-page="1">1</button>`;
            pageNumbers += '<span class="pagination-ellipsis">...</span>';
            for (let i = totalPages - 3; i <= totalPages; i++) {
                pageNumbers += `<button class="pagination-page ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else {
            pageNumbers += `<button class="pagination-page" data-page="1">1</button>`;
            pageNumbers += '<span class="pagination-ellipsis">...</span>';
            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                pageNumbers += `<button class="pagination-page ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            pageNumbers += '<span class="pagination-ellipsis">...</span>';
            pageNumbers += `<button class="pagination-page" data-page="${totalPages}">${totalPages}</button>`;
        }
    }

    paginationContainer.innerHTML = `
        <div class="pagination-info">
            Showing ${startItem}-${endItem} of ${totalItems}
        </div>
        <div class="pagination-controls">
            <button class="pagination-btn" id="pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Previous
            </button>
            <div class="pagination-pages">
                ${pageNumbers}
            </div>
            <button class="pagination-btn" id="pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>
                Next
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </div>
    `;

    // Add event listeners for pagination controls
    setupPaginationListeners();
}

function setupPaginationListeners() {
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderAutomations();
                scrollToTop();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentPage++;
            renderAutomations();
            scrollToTop();
        });
    }

    // Page number buttons
    document.querySelectorAll('.pagination-page').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page !== currentPage) {
                currentPage = page;
                renderAutomations();
                scrollToTop();
            }
        });
    });
}

function scrollToTop() {
    const grid = document.getElementById('automations-grid');
    if (grid) {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Reset to page 1 when filter or search changes
function resetPagination() {
    currentPage = 1;
}

function getAutomationIcon(automation) {
    // Use the icon field if available, otherwise fall back to type-based icon
    if (automation.icon && typeof getIconSvg === 'function') {
        return getIconSvg(automation.icon);
    }

    // Fallback to type-based icons
    const icons = {
        'blog_generation': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M8 9H16M8 13H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`,
        'email': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M3 7L12 13L21 7" stroke="currentColor" stroke-width="2"/>
        </svg>`,
        'workflow': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="6" r="3" stroke="currentColor" stroke-width="2"/>
            <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
            <circle cx="18" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
            <path d="M12 9V12M12 12L6 15M12 12L18 15" stroke="currentColor" stroke-width="2"/>
        </svg>`
    };
    return icons[automation.type] || icons['blog_generation'];
}

function formatFrequency(freq) {
    const frequencies = {
        'daily': 'Daily',
        'weekly': 'Weekly',
        'monthly': 'Monthly'
    };
    return frequencies[freq] || freq || 'Manual';
}

function formatType(type) {
    const types = {
        'blog_generation': 'Blog Generation',
        'email': 'Email',
        'workflow': 'Workflow'
    };
    return types[type] || type || 'Automation';
}

function updateEmptyState() {
    const title = document.getElementById('empty-title');
    const message = document.getElementById('empty-message');

    if (currentView === 'lifecycle') {
        // Lifecycle view empty states
        switch (currentFilter) {
            case 'active':
                title.textContent = 'No enabled automations';
                message.textContent = 'Enable a lifecycle automation to start engaging customers.';
                break;
            case 'inactive':
                title.textContent = 'No disabled automations';
                message.textContent = 'All lifecycle automations are currently enabled!';
                break;
            case 'archived':  // AI-Enabled in lifecycle view
                title.textContent = 'No AI-enabled automations';
                message.textContent = 'The AI hasn\'t enabled any automations yet.';
                break;
            default:
                title.textContent = searchQuery ? 'No automations found' : 'No lifecycle automations';
                message.textContent = searchQuery ? 'Try a different search term.' : 'Lifecycle automations help engage customers automatically.';
        }
    } else {
        // Project view empty states (original)
        switch (currentFilter) {
            case 'active':
                title.textContent = 'No active automations';
                message.textContent = 'Activate an automation from its settings page.';
                break;
            case 'inactive':
                title.textContent = 'No inactive automations';
                message.textContent = 'All your automations are currently active!';
                break;
            case 'archived':
                title.textContent = 'No archived automations';
                message.textContent = 'Archived automations will appear here.';
                break;
            default:
                title.textContent = searchQuery ? 'No automations found' : 'No automations yet';
                message.textContent = searchQuery ? 'Try a different search term.' : 'Create your first automation from a project.';
        }
    }
}

// ===== Archive Automation =====
async function archiveAutomation(id) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ is_archived: true })
            .eq('id', id);

        if (error) throw error;

        // Update local data
        const automation = allAutomations.find(a => a.id === id);
        if (automation) automation.is_archived = true;

        updateCounts();
        renderAutomations();

    } catch (error) {
        console.error('Error archiving automation:', error);
        showToast('Error archiving automation', 'error');
    }
}

window.archiveAutomation = archiveAutomation;

// ===== Restore Automation =====
async function restoreAutomation(id) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ is_archived: false })
            .eq('id', id);

        if (error) throw error;

        // Update local data
        const automation = allAutomations.find(a => a.id === id);
        if (automation) automation.is_archived = false;

        updateCounts();
        renderAutomations();
        celebrate({ intensity: 'subtle' });

    } catch (error) {
        console.error('Error restoring automation:', error);
        showToast('Error restoring automation', 'error');
    }
}

window.restoreAutomation = restoreAutomation;

// ===== Delete Automation (Soft Delete with 1-hour Undo) =====
function deleteAutomation(id, name) {
    // Get automation data before deleting (for potential restore)
    const automation = allAutomations.find(a => a.id === id);

    DangerModal.show({
        title: 'Delete Automation',
        itemName: name,
        warningText: 'This automation will be deleted. You can undo this within 1 hour.',
        confirmPhrase: 'DELETE THIS AUTOMATION',
        confirmButtonText: 'Delete Automation',
        onConfirm: async () => {
            try {
                // Soft delete - sets deleted_at timestamp
                const result = await SoftDelete.delete('automations', id, {
                    userId: currentUser?.id
                });

                if (!result.success) {
                    throw new Error(result.error);
                }

                // Remove from local data
                allAutomations = allAutomations.filter(a => a.id !== id);
                updateCounts();
                renderAutomations();

                // Show undo toast
                UndoToast.show({
                    message: `"${name}" deleted`,
                    entityType: 'automations',
                    entityId: id,
                    entityName: name,
                    onUndo: async (restoredData) => {
                        // Add back to local data and re-render
                        if (restoredData) {
                            allAutomations.push(restoredData);
                        } else if (automation) {
                            allAutomations.push(automation);
                        }
                        updateCounts();
                        renderAutomations();
                    }
                });

            } catch (error) {
                console.error('Error deleting automation:', error);
                alert(window.t ? window.t('errors.deletingAutomation') : 'Error deleting automation. Please try again.');
            }
        }
    });
}

window.deleteAutomation = deleteAutomation;

// ===== Event Listeners =====
function setupEventListeners() {
    // User menu and logout are now handled by sidebar.js

    // View toggle (Project vs Lifecycle)
    AppUtils.delegate('.view-toggle', 'click', '.view-toggle-btn', (event, btn) => {
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        currentFilter = 'all';  // Reset filter when switching views
        resetPagination();
        updateCounts();
        renderAutomations();

        // Update filter tab labels based on view
        const archivedTab = document.querySelector('.filter-tab[data-filter="archived"]');
        if (archivedTab) {
            if (currentView === 'lifecycle') {
                archivedTab.innerHTML = `AI-Enabled <span class="count" id="count-archived">0</span>`;
            } else {
                archivedTab.innerHTML = `Archived <span class="count" id="count-archived">0</span>`;
            }
        }

        // Reset all filter tabs to show 'all' as active
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.filter-tab[data-filter="all"]')?.classList.add('active');
        updateCounts();
    });

    // Filter tabs with event delegation (optimized)
    AppUtils.delegate('.filters', 'click', '.filter-tab', (event, tab) => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        resetPagination();
        renderAutomations();
    });

    // Search with debouncing (optimized - prevents re-render on every keystroke)
    const debouncedSearch = AppUtils.debounce((value) => {
        searchQuery = value;
        resetPagination();
        renderAutomations();
    }, 250);

    document.getElementById('search-input').addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });

    // New Automation button
    document.getElementById('new-automation-btn')?.addEventListener('click', openCreationModal);

    // Modal close buttons
    document.getElementById('automation-modal-close')?.addEventListener('click', closeCreationModal);
    document.getElementById('automation-modal-close-scratch')?.addEventListener('click', closeCreationModal);
    document.getElementById('automation-modal-close-template')?.addEventListener('click', closeCreationModal);
    document.getElementById('automation-modal-close-customize')?.addEventListener('click', closeCreationModal);

    // Cancel buttons
    document.getElementById('cancel-scratch-btn')?.addEventListener('click', closeCreationModal);
    document.getElementById('cancel-template-btn')?.addEventListener('click', closeCreationModal);

    // Path selection
    document.getElementById('path-scratch')?.addEventListener('click', showFromScratchStep);
    document.getElementById('path-template')?.addEventListener('click', showFromTemplateStep);

    // Back buttons
    document.getElementById('back-to-path-scratch')?.addEventListener('click', showChoosePathStep);
    document.getElementById('back-to-path-template')?.addEventListener('click', showChoosePathStep);
    document.getElementById('back-to-templates')?.addEventListener('click', showFromTemplateStep);

    // Form submissions
    document.getElementById('create-scratch-form')?.addEventListener('submit', handleCreateFromScratch);
    document.getElementById('create-template-form')?.addEventListener('submit', handleCreateFromTemplate);

    // Icon detection on name/description change
    document.getElementById('scratch-name')?.addEventListener('blur', handleIconDetection);
    document.getElementById('scratch-description')?.addEventListener('blur', handleIconDetection);

    // Icon preview click to show picker
    document.getElementById('scratch-icon-preview')?.addEventListener('click', toggleIconPicker);

    // Close modal on overlay click
    document.getElementById('create-automation-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCreationModal();
        }
    });

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCreationModal();
        }
    });
}

// ===== Creation Modal Functions =====
function openCreationModal() {
    showChoosePathStep();
    document.getElementById('create-automation-modal').classList.add('active');
}

function closeCreationModal() {
    document.getElementById('create-automation-modal').classList.remove('active');
    resetCreationModal();
}

function resetCreationModal() {
    // Reset forms
    document.getElementById('create-scratch-form')?.reset();
    document.getElementById('create-template-form')?.reset();

    // Reset icon
    selectedIcon = 'workflow';
    updateIconPreview();

    // Hide icon picker
    const iconPicker = document.getElementById('scratch-icon-picker');
    if (iconPicker) iconPicker.style.display = 'none';

    // Reset template selection
    selectedTemplateId = null;
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
}

function showChoosePathStep() {
    document.getElementById('step-choose-path').style.display = 'block';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'none';
}

function showFromScratchStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'block';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'none';
    document.getElementById('scratch-name')?.focus();
}

function showFromTemplateStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'block';
    document.getElementById('step-customize-template').style.display = 'none';
}

function showCustomizeTemplateStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'block';
}

// ===== Icon Functions =====
function handleIconDetection() {
    const name = document.getElementById('scratch-name')?.value || '';
    const description = document.getElementById('scratch-description')?.value || '';

    if (name || description) {
        selectedIcon = detectIcon(name, description);
        updateIconPreview();
        document.getElementById('scratch-icon').value = selectedIcon;
    }
}

function updateIconPreview() {
    const preview = document.getElementById('scratch-icon-preview');
    if (preview && typeof getIconSvg === 'function') {
        preview.innerHTML = getIconSvg(selectedIcon);
    }

    // Update picker selection
    document.querySelectorAll('.icon-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.icon === selectedIcon);
    });
}

function toggleIconPicker() {
    const picker = document.getElementById('scratch-icon-picker');
    if (picker) {
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    }
}

function populateIconPicker() {
    const picker = document.getElementById('scratch-icon-picker');
    if (!picker || typeof getAllIcons !== 'function') return;

    const icons = getAllIcons();
    picker.innerHTML = icons.map(icon => `
        <div class="icon-picker-item ${icon.key === selectedIcon ? 'selected' : ''}"
             data-icon="${icon.key}"
             title="${icon.name}"
             onclick="selectIcon('${icon.key}')">
            ${icon.svg}
        </div>
    `).join('');
}

function selectIcon(iconKey) {
    selectedIcon = iconKey;
    document.getElementById('scratch-icon').value = iconKey;
    updateIconPreview();
    toggleIconPicker();
}

window.selectIcon = selectIcon;

// ===== Templates Functions =====
function populateTemplatesGrid() {
    const grid = document.getElementById('templates-grid');
    if (!grid || typeof getAllTemplates !== 'function') return;

    const templates = getAllTemplates();
    grid.innerHTML = templates.map(template => `
        <div class="template-card" data-template-id="${template.id}" onclick="selectTemplate('${template.id}')">
            <div class="template-card-icon">
                ${typeof getIconSvg === 'function' ? getIconSvg(template.icon) : ''}
            </div>
            <div class="template-card-name">${escapeHtml(template.name)}</div>
            <div class="template-card-desc">${escapeHtml(template.description)}</div>
            <div class="template-card-meta">
                <span class="template-meta-badge">${template.type}</span>
                <span class="template-meta-badge">${template.frequency}</span>
            </div>
        </div>
    `).join('');
}

function selectTemplate(templateId) {
    selectedTemplateId = templateId;

    // Update selection UI
    document.querySelectorAll('.template-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.templateId === templateId);
    });

    // Get template details
    const template = typeof getTemplateById === 'function' ? getTemplateById(templateId) : null;
    if (!template) return;

    // Populate customize form
    document.getElementById('template-id').value = template.id;
    document.getElementById('template-name').value = template.name;
    document.getElementById('template-type').value = template.type;
    document.getElementById('template-frequency').value = template.frequency;
    document.getElementById('template-icon').value = template.icon;
    document.getElementById('template-description').value = template.description;

    // Set target segment
    const segmentSelect = document.getElementById('template-segment');
    if (segmentSelect && template.targetSegment) {
        if (template.targetSegment === 'all' || template.targetSegment === 'project') {
            segmentSelect.value = template.targetSegment;
        } else {
            segmentSelect.value = 'all';
        }
    }

    // Update preview
    document.getElementById('template-preview-icon').innerHTML =
        typeof getIconSvg === 'function' ? getIconSvg(template.icon) : '';
    document.getElementById('template-preview-name').textContent = template.name;
    document.getElementById('template-preview-desc').textContent = template.description;

    // Show customize step
    showCustomizeTemplateStep();
}

window.selectTemplate = selectTemplate;

// ===== Create Automation Handlers =====
async function handleCreateFromScratch(e) {
    e.preventDefault();

    // Prevent double-submit
    if (isSubmitting) return;
    isSubmitting = true;

    const btn = document.getElementById('create-scratch-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const projectId = document.getElementById('scratch-project').value;
    const name = document.getElementById('scratch-name').value.trim();
    const description = document.getElementById('scratch-description').value.trim();
    const type = document.getElementById('scratch-type').value;
    const frequency = document.getElementById('scratch-frequency').value;
    const targetSegment = document.getElementById('scratch-segment').value;
    const icon = document.getElementById('scratch-icon').value || 'workflow';

    try {
        const { data, error } = await supabase
            .from('automations')
            .insert([{
                project_id: projectId,
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

        // Celebrate and redirect
        if (typeof celebrate === 'function') celebrate();
        btn.textContent = 'Created!';

        setTimeout(() => {
            window.location.href = `/app/automation.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating automation:', error);
        alert(window.t ? window.t('errors.creatingAutomation') : 'Error creating automation. Please try again.');
        btn.disabled = false;
        btn.textContent = originalText;
        isSubmitting = false;  // Reset guard on error
    }
}

async function handleCreateFromTemplate(e) {
    e.preventDefault();

    // Prevent double-submit
    if (isSubmitting) return;
    isSubmitting = true;

    const btn = document.getElementById('create-template-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const projectId = document.getElementById('template-project').value;
    const name = document.getElementById('template-name').value.trim();
    const description = document.getElementById('template-description').value;
    const type = document.getElementById('template-type').value;
    const frequency = document.getElementById('template-frequency').value;
    const icon = document.getElementById('template-icon').value;
    const templateId = document.getElementById('template-id').value;
    const targetSegment = document.getElementById('template-segment').value;

    try {
        const { data, error } = await supabase
            .from('automations')
            .insert([{
                project_id: projectId,
                name,
                description,
                type,
                frequency,
                icon,
                template_id: templateId,
                target_segment: targetSegment,
                is_active: false,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Celebrate and redirect
        if (typeof celebrate === 'function') celebrate();
        btn.textContent = 'Created!';

        setTimeout(() => {
            window.location.href = `/app/automation.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating automation:', error);
        alert(window.t ? window.t('errors.creatingAutomation') : 'Error creating automation. Please try again.');
        btn.disabled = false;
        btn.textContent = originalText;
        isSubmitting = false;  // Reset guard on error
    }
}

// ===== Utility Functions =====
// Use shared utilities
const escapeHtml = AppUtils.escapeHtml;

// ===== Sequence Pipeline Detail =====
async function showSequencePipeline(sequenceKey) {
    // Get all orgs in this sequence
    const { data: states, error } = await supabase
        .from('automation_sequence_state')
        .select('organization_id, current_step, started_at, last_sent_at, completed_at, skipped_steps')
        .eq('sequence_key', sequenceKey)
        .order('started_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error loading sequence pipeline:', error);
        return;
    }

    // Get org names
    const orgIds = (states || []).map(s => s.organization_id);
    const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);

    const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));

    // Get step definitions
    const { data: steps } = await supabase
        .from('automation_definitions')
        .select('sequence_step, name, template_key')
        .eq('sequence_key', sequenceKey)
        .not('sequence_step', 'is', null)
        .order('sequence_step');

    const stepNames = new Map((steps || []).map(s => [s.sequence_step, s.name]));
    const totalSteps = steps?.length || 5;

    // Build pipeline counts
    const stepCounts = {};
    let completedCount = 0;
    for (const state of (states || [])) {
        if (state.completed_at) {
            completedCount++;
        } else {
            stepCounts[state.current_step] = (stepCounts[state.current_step] || 0) + 1;
        }
    }

    // Build modal content
    const pipelineHtml = `
        <div style="padding:24px;">
            <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:var(--color-text);">${escapeHtml(sequenceKey.replace(/_/g, ' '))} Pipeline</h2>
            <p style="margin:0 0 20px;font-size:14px;color:var(--color-text-secondary);">${states?.length || 0} organizations enrolled</p>

            <!-- Funnel -->
            <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">
                ${Array.from({ length: totalSteps }, (_, i) => {
                    const step = i + 1;
                    const count = stepCounts[step] || 0;
                    const name = stepNames.get(step) || `Step ${step}`;
                    return `<div style="flex:1;min-width:80px;text-align:center;padding:12px 8px;background:var(--color-bg-secondary);border-radius:8px;border:1px solid var(--color-border-light);">
                        <div style="font-size:24px;font-weight:700;color:var(--color-primary);">${count}</div>
                        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">${escapeHtml(name.replace('Onboarding: ', '').replace('Win-Back: ', ''))}</div>
                    </div>`;
                }).join('')}
                <div style="flex:1;min-width:80px;text-align:center;padding:12px 8px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
                    <div style="font-size:24px;font-weight:700;color:#16a34a;">${completedCount}</div>
                    <div style="font-size:11px;color:#16a34a;margin-top:4px;">Completed</div>
                </div>
            </div>

            <!-- Org list -->
            <div style="max-height:300px;overflow-y:auto;">
                ${(states || []).map(state => {
                    const orgName = orgMap.get(state.organization_id) || 'Unknown';
                    const stepLabel = state.completed_at ? 'Completed' : (stepNames.get(state.current_step) || `Step ${state.current_step}`);
                    const statusColor = state.completed_at ? '#16a34a' : 'var(--color-primary)';
                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--color-border-light);">
                        <span style="font-size:14px;font-weight:500;">${escapeHtml(orgName)}</span>
                        <span style="font-size:12px;color:${statusColor};font-weight:500;">${escapeHtml(stepLabel.replace('Onboarding: ', '').replace('Win-Back: ', ''))}</span>
                    </div>`;
                }).join('')}
            </div>

            <div style="text-align:right;margin-top:16px;">
                <button onclick="this.closest('.modal-overlay')?.remove()" class="btn btn-secondary">Close</button>
            </div>
        </div>
    `;

    // Show modal
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';
    overlay.innerHTML = `<div style="background:var(--color-bg);border-radius:16px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.2);">${pipelineHtml}</div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

window.showSequencePipeline = showSequencePipeline;

// Initialize on page load
document.addEventListener('DOMContentLoaded', initAutomations);
