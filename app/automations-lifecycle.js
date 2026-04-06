// ===== Automations Page — Lifecycle Module =====
// Lifecycle automation management: load, toggle, render, and pipeline visualization.
// State variables (lifecycleAutomations, currentFilter, etc.) are in automations.js.

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
/** Toggle a lifecycle automation on/off by updating is_enabled in automation_definitions. */
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
                ${automation.target_type === 'organizations' ? '<span class="target-badge" title="Targets businesses">Businesses</span>' : ''}
                ${automation.sequence_key ? `<span class="sequence-badge ${automation.target_type === 'organizations' ? 'with-target' : ''}" title="Part of ${escapeHtml(automation.sequence_key)} sequence">Step ${automation.sequence_step || ''}</span>` : ''}
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
            <h2 class="pipeline-title">${escapeHtml(sequenceKey.replace(/_/g, ' '))} Pipeline</h2>
            <p class="pipeline-subtitle">${states?.length || 0} organizations enrolled</p>

            <div class="pipeline-funnel">
                ${Array.from({ length: totalSteps }, (_, i) => {
                    const step = i + 1;
                    const count = stepCounts[step] || 0;
                    const name = stepNames.get(step) || `Step ${step}`;
                    return `<div class="pipeline-step">
                        <div class="pipeline-step-count">${count}</div>
                        <div class="pipeline-step-label">${escapeHtml(name.replace('Onboarding: ', '').replace('Win-Back: ', ''))}</div>
                    </div>`;
                }).join('')}
                <div class="pipeline-step pipeline-step--completed">
                    <div class="pipeline-step-count">${completedCount}</div>
                    <div class="pipeline-step-label">Completed</div>
                </div>
            </div>

            <div class="pipeline-org-list">
                ${(states || []).map(state => {
                    const orgName = orgMap.get(state.organization_id) || 'Unknown';
                    const stepLabel = state.completed_at ? 'Completed' : (stepNames.get(state.current_step) || `Step ${state.current_step}`);
                    const isCompleted = !!state.completed_at;
                    return `<div class="pipeline-org-item">
                        <span class="pipeline-org-name">${escapeHtml(orgName)}</span>
                        <span class="pipeline-org-step ${isCompleted ? 'pipeline-org-step--completed' : ''}">${escapeHtml(stepLabel.replace('Onboarding: ', '').replace('Win-Back: ', ''))}</span>
                    </div>`;
                }).join('')}
            </div>

            <div style="text-align:right;margin-top:16px;">
                <button onclick="this.closest('.pipeline-overlay')?.remove()" class="btn btn-secondary">Close</button>
            </div>
    `;

    // Show modal
    const overlay = document.createElement('div');
    overlay.className = 'pipeline-overlay';
    overlay.innerHTML = `<div class="pipeline-modal">${pipelineHtml}</div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

window.showSequencePipeline = showSequencePipeline;
