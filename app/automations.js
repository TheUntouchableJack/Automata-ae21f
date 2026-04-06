// ===== Automations Page — Coordinator =====
// Shared state, initialization, event listeners, and shared rendering functions.
// Lifecycle functions are in automations-lifecycle.js.
// Project/CRUD/creation functions are in automations-projects.js.

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

// ===== Shared Utilities =====
const escapeHtml = AppUtils.escapeHtml;

/** Initialize the automations page — auth, load data, setup events. */
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
/** Render automations grid — dispatches to lifecycle or project view based on currentView. */
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

// ===== Empty State =====
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', initAutomations);
