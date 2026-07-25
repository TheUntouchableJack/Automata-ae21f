// ===== AI Intelligence Feed =====
// AI-powered recommendations that CREATE projects + automations in one click
// 2026-level intuitive - AI recommends, user accepts, system builds
//
// BUSINESS MODEL NOTE: Royalty is visits-based loyalty, NOT purchases/payments.
// - Customers earn points by visiting (scanning QR codes), not by purchasing
// - No in-app sales or payment processing
// - Do NOT recommend product pricing, purchase incentives, or checkout-related features
// - Focus on: visits, engagement, retention, referrals, milestones, birthdays

const AIFeed = (function() {
    let organizationId = null;
    let currentUserId = null;
    let isAnalyzing = false;

    // Icons for recommendation types
    const typeIcons = {
        opportunity: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
        efficiency: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        risk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        growth: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
        automation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    };

    // Type labels
    const typeLabels = {
        opportunity: 'Opportunity',
        efficiency: 'Efficiency',
        risk: 'Risk Alert',
        growth: 'Growth',
        automation: 'Automation'
    };

    // Impact labels
    const impactLabels = {
        high: 'High Impact',
        medium: 'Medium Impact',
        low: 'Low Impact'
    };

    // AI Recommendation Templates - loaded from shared/ai-templates.js
    const AI_TEMPLATES = window.AI_TEMPLATES;

    // Initialize the feed
    async function init(orgId, userRole, userId) {
        organizationId = orgId;
        currentUserId = userId;

        const feedSection = document.getElementById('ai-feed-section');
        if (!feedSection) return;

        // Only show for admins/owners (with fallback for fresh signups where role may not be set yet)
        if (userRole !== 'owner' && userRole !== 'admin') {
            // Check if they have pending recommendations anyway (fresh signup race condition)
            const { count } = await supabase
                .from('ai_recommendations')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'pending');

            if (!count || count === 0) {
                feedSection.style.display = 'none';
                return;
            }
        }

        feedSection.style.display = 'block';

        // Setup event listeners
        setupEventListeners();

        // Load existing recommendations
        await loadRecommendations();
    }

    // Setup event listeners
    function setupEventListeners() {
        const analyzeBtn = document.getElementById('analyze-business-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', handleAnalyze);
        }

        // Event delegation for feed actions
        const feedList = document.getElementById('ai-feed-list');
        if (feedList) {
            feedList.addEventListener('click', handleFeedAction);
        }
    }

    // Load recommendations from database
    async function loadRecommendations() {
        if (!organizationId) return;

        try {
            const { data, error } = await supabase.rpc('get_pending_recommendations', {
                org_id: organizationId,
                limit_count: 10
            });

            if (error) {
                // Try direct query as fallback
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('ai_recommendations')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: false })
                    .limit(10);

                if (!fallbackError && fallbackData) {
                    renderRecommendations(fallbackData);
                }
                return;
            }

            renderRecommendations(data || []);
        } catch (err) {
            console.log('AI recommendations table not yet created');
            showEmptyState();
        }
    }

    // Render recommendations in the feed
    function renderRecommendations(recommendations) {
        const feedEmpty = document.getElementById('ai-feed-empty');
        const feedList = document.getElementById('ai-feed-list');
        const feedLoading = document.getElementById('ai-feed-loading');

        if (feedLoading) feedLoading.style.display = 'none';

        if (!recommendations || recommendations.length === 0) {
            showEmptyState();
            return;
        }

        if (feedEmpty) feedEmpty.style.display = 'none';
        if (feedList) {
            feedList.style.display = 'block';
            feedList.innerHTML = recommendations.map(rec => renderRecommendationItem(rec)).join('');
        }
    }

    // Render a single recommendation item
    function renderRecommendationItem(rec) {
        const type = rec.recommendation_type || 'opportunity';
        const impact = rec.potential_impact || 'medium';
        const confidence = rec.confidence_score || 0.8;
        const confidencePercent = Math.round(confidence * 100);
        const payload = rec.action_payload || {};

        // Get what will be created
        const template = AI_TEMPLATES[payload.template_id] || {};
        const willCreate = template.projectName
            ? `Creates: "${template.projectName}" project with "${template.automation?.name}" automation`
            : 'Takes action based on recommendation';

        return `
            <div class="ai-feed-item" data-recommendation-id="${rec.id}">
                <div class="ai-feed-item-header">
                    <div class="ai-feed-item-type">
                        <div class="ai-feed-item-icon ${type}">
                            ${typeIcons[type] || typeIcons.opportunity}
                        </div>
                        <span class="ai-feed-item-label ${type}">${typeLabels[type] || 'Insight'}</span>
                    </div>
                    <div class="ai-feed-item-impact ${impact}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                        </svg>
                        ${impactLabels[impact]}
                    </div>
                </div>
                <h4 class="ai-feed-item-title">${AppUtils.escapeHtml(rec.title)}</h4>
                <p class="ai-feed-item-description">${AppUtils.escapeHtml(rec.description)}</p>
                <div class="ai-feed-item-actions">
                    <button class="btn btn-sm btn-primary" data-action="implement" data-id="${rec.id}" data-payload='${JSON.stringify(payload).replace(/'/g, "&#39;")}'>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Accept & Create
                    </button>
                    <button class="btn btn-sm btn-ghost" data-action="dismiss" data-id="${rec.id}">
                        Dismiss
                    </button>
                </div>
                <div class="ai-feed-item-confidence">
                    <span>Confidence:</span>
                    <div class="confidence-bar">
                        <div class="confidence-fill" style="width: ${confidencePercent}%"></div>
                    </div>
                    <span>${confidencePercent}%</span>
                    <span style="margin-left: 12px; opacity: 0.7;">${willCreate}</span>
                </div>
            </div>
        `;
    }

    // Show empty state
    function showEmptyState() {
        const feedEmpty = document.getElementById('ai-feed-empty');
        const feedList = document.getElementById('ai-feed-list');
        const feedLoading = document.getElementById('ai-feed-loading');

        if (feedEmpty) feedEmpty.style.display = 'block';
        if (feedList) feedList.style.display = 'none';
        if (feedLoading) feedLoading.style.display = 'none';
    }

    // Show loading state
    function showLoading() {
        const feedEmpty = document.getElementById('ai-feed-empty');
        const feedList = document.getElementById('ai-feed-list');
        const feedLoading = document.getElementById('ai-feed-loading');

        if (feedEmpty) feedEmpty.style.display = 'none';
        if (feedList) feedList.style.display = 'none';
        if (feedLoading) feedLoading.style.display = 'block';
    }

    // Handle analyze button click
    async function handleAnalyze() {
        if (isAnalyzing) return;

        const analyzeBtn = document.getElementById('analyze-business-btn');
        if (!analyzeBtn) return;

        isAnalyzing = true;
        const originalContent = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
        analyzeBtn.disabled = true;

        showLoading();

        try {
            // Route to the server-side, knowledge-driven generator (royal-ai-recommend),
            // retiring the client count-rule engine as the source of truth.
            let session = null;
            if (typeof getValidSession === 'function') {
                session = await getValidSession();
            } else {
                const { data } = await supabase.auth.getSession();
                session = data?.session || null;
            }

            const invokeOpts = { body: { organization_id: organizationId } };
            if (session?.access_token) {
                invokeOpts.headers = { Authorization: `Bearer ${session.access_token}` };
            }

            const { data: genResult, error: genError } = await supabase.functions.invoke(
                'royal-ai-recommend', invokeOpts
            );
            if (genError) throw genError;

            // Reload the feed from the database (single source of truth).
            await loadRecommendations();

            // Celebrate if new recommendations were generated.
            const generatedCount = genResult?.recommendations || 0;
            if (generatedCount > 0 && typeof celebrate === 'function') {
                celebrate();
            }

        } catch (error) {
            console.error('Error analyzing business:', error);
            alert(window.t ? window.t('errors.analyzingBusiness') : 'Error analyzing business data. Please try again.');
            showEmptyState();
        } finally {
            isAnalyzing = false;
            analyzeBtn.innerHTML = originalContent;
            analyzeBtn.disabled = false;
        }
    }

    // Handle feed action clicks
    async function handleFeedAction(event) {
        const button = event.target.closest('[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const recId = button.dataset.id;

        switch (action) {
            case 'dismiss':
                await dismissRecommendation(recId);
                break;
            case 'implement':
                const payloadStr = button.dataset.payload;
                const payload = payloadStr ? JSON.parse(payloadStr.replace(/&#39;/g, "'")) : {};
                await implementRecommendation(recId, payload);
                break;
        }
    }

    // Dismiss a recommendation
    async function dismissRecommendation(recId) {
        try {
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'dismissed',
                    dismissed_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Remove from UI with animation
            const item = document.querySelector(`[data-recommendation-id="${recId}"]`);
            if (item) {
                item.style.opacity = '0';
                item.style.transform = 'translateX(20px)';
                item.style.transition = 'all 0.2s';
                setTimeout(() => {
                    item.remove();
                    checkEmptyState();
                }, 200);
            }
        } catch (err) {
            console.error('Error dismissing recommendation:', err);
        }
    }

    // Implement a recommendation - THIS IS THE MAGIC
    async function implementRecommendation(recId, payload) {
        const item = document.querySelector(`[data-recommendation-id="${recId}"]`);
        const button = item?.querySelector('[data-action="implement"]');

        // Show loading state on button
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="spinner"></span> Creating...';
        }

        try {
            // Handle navigation-only actions
            if (payload.url) {
                window.location.href = payload.url;
                return;
            }

            // Get the template configuration
            const template = AI_TEMPLATES[payload.template_id];
            if (!template) {
                alert(window.t ? window.t('errors.templateNotFound') : 'Template not found. Please try again.');
                return;
            }

            // CREATE THE PROJECT
            const { data: project, error: projectError } = await supabase
                .from('projects')
                .insert({
                    organization_id: organizationId,
                    name: template.projectName,
                    description: template.projectDesc,
                    settings: { created_from: 'ai_recommendation', recommendation_id: recId }
                })
                .select()
                .single();

            if (projectError) {
                console.error('Error creating project:', projectError);
                alert(window.t ? window.t('errors.creatingProject') : 'Error creating project. Please try again.');
                return;
            }

            // CREATE THE AUTOMATION inside the project
            const { data: automation, error: automationError } = await supabase
                .from('automations')
                .insert({
                    project_id: project.id,
                    name: template.automation.name,
                    description: template.automation.description,
                    type: template.automation.type,
                    frequency: template.automation.frequency,
                    icon: template.automation.icon,
                    template_id: template.automation.template_id,
                    is_active: false, // Start as draft for review
                    settings: { created_from: 'ai_recommendation' }
                })
                .select()
                .single();

            if (automationError) {
                console.error('Error creating automation:', automationError);
                // Still navigate to project even if automation failed
            }

            // Mark recommendation as implemented
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'implemented',
                    implemented_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Log to audit if available
            if (typeof AuditLog !== 'undefined') {
                AuditLog.logProjectCreate(organizationId, project);
            }

            // Celebrate!
            if (typeof celebrate === 'function') {
                celebrate();
            }

            // Show success state briefly
            if (item) {
                item.style.background = 'rgba(16, 185, 129, 0.1)';
                if (button) {
                    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Created!';
                    button.classList.remove('btn-primary');
                    button.classList.add('btn-success');
                }
            }

            // Navigate to the automation after a brief pause
            setTimeout(() => {
                if (automation) {
                    window.location.href = `/app/automation.html#${automation.id}`;
                } else {
                    window.location.href = `/app/project.html#${project.id}`;
                }
            }, 800);

        } catch (err) {
            console.error('Error implementing recommendation:', err);
            alert(window.t ? window.t('errors.creatingProject') : 'Error creating project. Please try again.');

            if (button) {
                button.disabled = false;
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Accept & Create';
            }
        }
    }

    // Check if feed is empty and show empty state
    function checkEmptyState() {
        const feedList = document.getElementById('ai-feed-list');
        if (feedList && feedList.children.length === 0) {
            showEmptyState();
        }
    }

    // Public API
    return {
        init,
        loadRecommendations,
        handleAnalyze
    };
})();
