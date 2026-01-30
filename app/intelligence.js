// ===== AI Intelligence Page =====
// Full-featured AI recommendations with filtering, stats, and one-click implementation

const IntelligencePage = (function() {
    let organizationId = null;
    let currentUserId = null;
    let isAnalyzing = false;
    let allRecommendations = [];
    let currentFilter = 'all';
    let currentType = '';

    // Icons for recommendation types
    const typeIcons = {
        opportunity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
        efficiency: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        risk: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        growth: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
        automation: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
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

    // AI Recommendation Templates - Define what gets created
    const AI_TEMPLATES = {
        'welcome-email': {
            projectName: 'Customer Onboarding',
            projectDesc: 'Automated welcome and onboarding for new customers',
            automation: {
                name: 'Welcome Email Series',
                description: 'Automatically welcome new customers with a personalized email series',
                type: 'email',
                frequency: 'daily',
                icon: 'welcome',
                template_id: 'welcome-series'
            }
        },
        'follow-up': {
            projectName: 'Customer Follow-ups',
            projectDesc: 'Automated follow-up communications after customer interactions',
            automation: {
                name: 'Post-Visit Follow-up',
                description: 'Send thank you messages and collect feedback after visits',
                type: 'email',
                frequency: 'daily',
                icon: 'follow_up',
                template_id: 'post-visit-follow-up'
            }
        },
        're-engagement': {
            projectName: 'Customer Retention',
            projectDesc: 'Win back inactive customers and prevent churn',
            automation: {
                name: 'Win-Back Campaign',
                description: 'Re-engage customers who haven\'t visited in 30+ days',
                type: 'email',
                frequency: 'weekly',
                icon: 'win_back',
                template_id: 'win-back-campaign'
            }
        },
        'birthday': {
            projectName: 'Customer Celebrations',
            projectDesc: 'Celebrate customer milestones and special days',
            automation: {
                name: 'Birthday Rewards',
                description: 'Send personalized birthday greetings with special offers',
                type: 'email',
                frequency: 'daily',
                icon: 'birthday',
                template_id: 'birthday-rewards'
            }
        },
        'review-request': {
            projectName: 'Reputation Management',
            projectDesc: 'Build your online reputation through customer reviews',
            automation: {
                name: 'Review Requests',
                description: 'Ask satisfied customers for reviews at the right time',
                type: 'email',
                frequency: 'weekly',
                icon: 'feedback',
                template_id: 'review-request'
            }
        },
        'newsletter': {
            projectName: 'Customer Communications',
            projectDesc: 'Keep customers informed and engaged',
            automation: {
                name: 'Monthly Newsletter',
                description: 'Monthly updates, news, and curated content for your audience',
                type: 'email',
                frequency: 'monthly',
                icon: 'newsletter',
                template_id: 'monthly-newsletter'
            }
        },
        'loyalty': {
            projectName: 'Loyalty Program',
            projectDesc: 'Reward and retain your best customers',
            automation: {
                name: 'Loyalty Rewards',
                description: 'Automatically reward customers with points and VIP perks',
                type: 'workflow',
                frequency: 'weekly',
                icon: 'loyalty',
                template_id: 'loyalty-program'
            }
        },
        'thank-you': {
            projectName: 'Customer Appreciation',
            projectDesc: 'Show gratitude to your customers',
            automation: {
                name: 'Thank You Notes',
                description: 'Send personalized thank you messages after purchases',
                type: 'email',
                frequency: 'daily',
                icon: 'thank_you',
                template_id: 'thank-you-note'
            }
        }
    };

    // Initialize the page
    async function init() {
        // Get auth data
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            window.location.href = '/app/login.html';
            return;
        }
        currentUserId = user.id;

        // Get organization and user info
        const [memberResult, userInfoResult, orgResult] = await Promise.all([
            supabase
                .from('organization_members')
                .select('organization_id, role')
                .eq('user_id', user.id)
                .single(),
            supabase
                .from('user_profiles')
                .select('full_name')
                .eq('id', user.id)
                .single(),
            supabase
                .from('organization_members')
                .select('organization_id, organizations(id, name)')
                .eq('user_id', user.id)
                .single()
        ]);

        const member = memberResult.data;
        if (!member) {
            window.location.href = '/app/dashboard.html';
            return;
        }

        organizationId = member.organization_id;
        const userInfo = userInfoResult.data;
        const orgData = orgResult.data;

        // Setup sidebar with proper data
        if (typeof AppSidebar !== 'undefined') {
            AppSidebar.init({
                name: userInfo?.full_name || user.email,
                email: user.email,
                organization: orgData?.organizations || { name: 'My Organization' },
                role: member.role
            });
        }

        // Setup event listeners
        setupEventListeners();

        // Load recommendations
        await loadRecommendations();

        // Update stats
        updateStats();
    }

    // Setup event listeners
    function setupEventListeners() {
        // Analyze button
        const analyzeBtn = document.getElementById('analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', handleAnalyze);
        }

        // Empty state analyze button
        const emptyAnalyzeBtn = document.getElementById('empty-analyze-btn');
        if (emptyAnalyzeBtn) {
            emptyAnalyzeBtn.addEventListener('click', handleAnalyze);
        }

        // Filter tabs
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentFilter = tab.dataset.filter;
                renderFilteredRecommendations();
            });
        });

        // Type filter dropdown
        const typeFilter = document.getElementById('type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                currentType = typeFilter.value;
                renderFilteredRecommendations();
            });
        }

        // Event delegation for recommendation actions
        const recommendationsList = document.getElementById('recommendations-list');
        if (recommendationsList) {
            recommendationsList.addEventListener('click', handleRecommendationAction);
        }
    }

    // Load recommendations from database
    async function loadRecommendations() {
        if (!organizationId) return;

        showLoading();

        try {
            // Try RPC first
            const { data, error } = await supabase.rpc('get_pending_recommendations', {
                org_id: organizationId,
                limit_count: 100
            });

            if (error) {
                // Fallback to direct query
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('ai_recommendations')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .order('created_at', { ascending: false })
                    .limit(100);

                if (!fallbackError && fallbackData) {
                    allRecommendations = fallbackData;
                } else {
                    allRecommendations = [];
                }
            } else {
                // RPC only returns pending, get all for this page
                const { data: allData } = await supabase
                    .from('ai_recommendations')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .order('created_at', { ascending: false })
                    .limit(100);

                allRecommendations = allData || [];
            }

            renderFilteredRecommendations();
            updateStats();
        } catch (err) {
            console.log('AI recommendations table not yet created:', err);
            allRecommendations = [];
            showEmptyState();
        }
    }

    // Render recommendations based on current filters
    function renderFilteredRecommendations() {
        let filtered = [...allRecommendations];

        // Apply status filter
        if (currentFilter !== 'all') {
            filtered = filtered.filter(rec => rec.status === currentFilter);
        }

        // Apply type filter
        if (currentType) {
            filtered = filtered.filter(rec => rec.recommendation_type === currentType);
        }

        // Sort by impact (high first), then by confidence
        filtered.sort((a, b) => {
            const impactOrder = { high: 0, medium: 1, low: 2 };
            const aImpact = impactOrder[a.potential_impact] ?? 1;
            const bImpact = impactOrder[b.potential_impact] ?? 1;
            if (aImpact !== bImpact) return aImpact - bImpact;
            return (b.confidence_score || 0) - (a.confidence_score || 0);
        });

        renderRecommendations(filtered);
    }

    // Render recommendations
    function renderRecommendations(recommendations) {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'none';

        if (!recommendations || recommendations.length === 0) {
            if (empty) empty.style.display = 'block';
            if (list) list.style.display = 'none';
            return;
        }

        if (empty) empty.style.display = 'none';
        if (list) {
            list.style.display = 'flex';
            list.innerHTML = recommendations.map(renderRecommendationCard).join('');
        }
    }

    // Render a single recommendation card
    function renderRecommendationCard(rec) {
        const type = rec.recommendation_type || 'opportunity';
        const impact = rec.potential_impact || 'medium';
        const status = rec.status || 'pending';
        const confidence = rec.confidence_score || 0.8;
        const confidencePercent = Math.round(confidence * 100);
        const payload = rec.action_payload || {};
        const createdAt = new Date(rec.created_at).toLocaleDateString();

        // Get what will be created
        const template = AI_TEMPLATES[payload.template_id] || {};
        const willCreate = template.projectName
            ? `<strong>Will create:</strong> "${template.projectName}" project with "${template.automation?.name}" automation`
            : '';

        // Status badge
        let statusBadge = '';
        if (status === 'implemented') {
            statusBadge = '<span class="status-badge implemented"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Implemented</span>';
        } else if (status === 'dismissed') {
            statusBadge = '<span class="status-badge dismissed">Dismissed</span>';
        }

        // Action buttons based on status
        let actionButtons = '';
        if (status === 'pending') {
            actionButtons = `
                <button class="btn btn-primary" data-action="implement" data-id="${rec.id}" data-payload='${JSON.stringify(payload).replace(/'/g, "&#39;")}'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Accept & Create
                </button>
                <button class="btn btn-ghost" data-action="dismiss" data-id="${rec.id}">
                    Dismiss
                </button>
            `;
        } else if (status === 'implemented') {
            actionButtons = `
                <button class="btn btn-success" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Implemented
                </button>
            `;
        }

        return `
            <div class="recommendation-card ${status}" data-recommendation-id="${rec.id}">
                <div class="recommendation-header">
                    <div class="recommendation-meta">
                        <div class="recommendation-type-icon ${type}">
                            ${typeIcons[type] || typeIcons.opportunity}
                        </div>
                        <div class="recommendation-type-info">
                            <span class="recommendation-type-label ${type}">${typeLabels[type] || 'Insight'}</span>
                            <span class="recommendation-date">${createdAt}</span>
                        </div>
                    </div>
                    <div class="recommendation-impact ${impact}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                        </svg>
                        ${impactLabels[impact]}
                        ${statusBadge}
                    </div>
                </div>
                <h3 class="recommendation-title">${AppUtils.escapeHtml(rec.title)}</h3>
                <p class="recommendation-description">${AppUtils.escapeHtml(rec.description)}</p>
                ${willCreate ? `<div class="recommendation-will-create">${willCreate}</div>` : ''}
                <div class="recommendation-footer">
                    <div class="recommendation-actions">
                        ${actionButtons}
                    </div>
                    <div class="recommendation-confidence">
                        <span>Confidence</span>
                        <div class="confidence-bar-lg">
                            <div class="confidence-fill-lg" style="width: ${confidencePercent}%"></div>
                        </div>
                        <span>${confidencePercent}%</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Update stats display
    function updateStats() {
        const pending = allRecommendations.filter(r => r.status === 'pending').length;
        const implemented = allRecommendations.filter(r => r.status === 'implemented').length;
        const highImpact = allRecommendations.filter(r => r.status === 'pending' && r.potential_impact === 'high').length;

        const statPending = document.getElementById('stat-pending');
        const statImplemented = document.getElementById('stat-implemented');
        const statHighImpact = document.getElementById('stat-high-impact');
        const statLastAnalysis = document.getElementById('stat-last-analysis');

        if (statPending) statPending.textContent = pending;
        if (statImplemented) statImplemented.textContent = implemented;
        if (statHighImpact) statHighImpact.textContent = highImpact;

        // Get last analysis time
        if (statLastAnalysis && allRecommendations.length > 0) {
            const latest = allRecommendations.reduce((a, b) =>
                new Date(a.created_at) > new Date(b.created_at) ? a : b
            );
            const date = new Date(latest.created_at);
            const now = new Date();
            const diffMs = now - date;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffHours / 24);

            if (diffHours < 1) {
                statLastAnalysis.textContent = 'Just now';
            } else if (diffHours < 24) {
                statLastAnalysis.textContent = `${diffHours}h ago`;
            } else if (diffDays === 1) {
                statLastAnalysis.textContent = 'Yesterday';
            } else if (diffDays < 7) {
                statLastAnalysis.textContent = `${diffDays}d ago`;
            } else {
                statLastAnalysis.textContent = date.toLocaleDateString();
            }
        }
    }

    // Show loading state
    function showLoading() {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'block';
        if (empty) empty.style.display = 'none';
        if (list) list.style.display = 'none';
    }

    // Show empty state
    function showEmptyState() {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'none';
        if (empty) empty.style.display = 'block';
        if (list) list.style.display = 'none';
    }

    // Handle analyze button
    async function handleAnalyze() {
        if (isAnalyzing) return;

        const analyzeBtn = document.getElementById('analyze-btn');
        if (!analyzeBtn) return;

        isAnalyzing = true;
        const originalContent = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
        analyzeBtn.disabled = true;

        showLoading();

        try {
            // Gather data
            const analysisData = await gatherAnalysisData();

            // Generate recommendations
            const recommendations = await generateRecommendations(analysisData);

            // Save to database
            if (recommendations.length > 0) {
                await saveRecommendations(recommendations);
            }

            // Reload
            await loadRecommendations();

            // Celebrate
            if (recommendations.length > 0 && typeof celebrate === 'function') {
                celebrate();
            }

        } catch (error) {
            console.error('Error analyzing business:', error);
            alert('Error analyzing business data. Please try again.');
            showEmptyState();
        } finally {
            isAnalyzing = false;
            analyzeBtn.innerHTML = originalContent;
            analyzeBtn.disabled = false;
        }
    }

    // Gather organization data for analysis
    async function gatherAnalysisData() {
        const data = {
            customers: { total: 0, recent: 0, bySource: {} },
            projects: { total: 0, byIndustry: {}, list: [] },
            automations: { total: 0, active: 0, byType: {}, byTemplate: {} }
        };

        try {
            // Get customer stats
            const { count: totalCustomers } = await supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null);

            data.customers.total = totalCustomers || 0;

            // Recent customers (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { count: recentCustomers } = await supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
                .gte('created_at', thirtyDaysAgo.toISOString());

            data.customers.recent = recentCustomers || 0;

            // Get project stats
            const { data: projects } = await supabase
                .from('projects')
                .select('id, name, industry')
                .eq('organization_id', organizationId)
                .is('deleted_at', null);

            data.projects.total = projects?.length || 0;
            data.projects.list = projects || [];
            if (projects) {
                projects.forEach(p => {
                    const industry = p.industry || 'unset';
                    data.projects.byIndustry[industry] = (data.projects.byIndustry[industry] || 0) + 1;
                });
            }

            // Get automation stats
            if (projects && projects.length > 0) {
                const projectIds = projects.map(p => p.id);
                const { data: automations } = await supabase
                    .from('automations')
                    .select('id, type, is_active, template_id')
                    .in('project_id', projectIds)
                    .is('deleted_at', null);

                data.automations.total = automations?.length || 0;
                if (automations) {
                    automations.forEach(a => {
                        if (a.is_active) data.automations.active++;
                        const type = a.type || 'other';
                        data.automations.byType[type] = (data.automations.byType[type] || 0) + 1;
                        if (a.template_id) {
                            data.automations.byTemplate[a.template_id] = true;
                        }
                    });
                }
            }

        } catch (error) {
            console.error('Error gathering analysis data:', error);
        }

        return data;
    }

    // Generate recommendations
    async function generateRecommendations(data) {
        const recommendations = [];
        const hasTemplate = (id) => data.automations.byTemplate[id];

        // Priority 1: No automations - suggest welcome series
        if (data.automations.total === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'automation',
                title: 'Start with a Welcome Email Series',
                description: `You have ${data.customers.total || 'no'} customers but no automations. A welcome series is the foundation - it engages new customers from day one and sets the tone for your relationship.`,
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Create a welcome email automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'welcome-email' }
            });
        }

        // Suggest follow-up
        if (!hasTemplate('post-visit-follow-up') && data.customers.total > 5) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'efficiency',
                title: 'Automate Post-Visit Follow-ups',
                description: `With ${data.customers.total} customers, manual follow-ups don't scale. Automated follow-ups after visits increase repeat business by 23% on average.`,
                confidence_score: 0.88,
                potential_impact: 'high',
                suggested_action: 'Create a follow-up automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'follow-up' }
            });
        }

        // Suggest win-back
        if (!hasTemplate('win-back-campaign') && data.customers.total > 20) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Win Back Inactive Customers',
                description: `Some of your ${data.customers.total} customers likely haven't engaged recently. A win-back campaign can recover 5-15% of churned customers with minimal effort.`,
                confidence_score: 0.85,
                potential_impact: 'medium',
                suggested_action: 'Create a win-back campaign',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 're-engagement' }
            });
        }

        // Suggest birthday rewards
        if (!hasTemplate('birthday-rewards') && data.customers.total > 10) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Celebrate Customer Birthdays',
                description: `Birthday emails have 481% higher transaction rates than regular promotions. With ${data.customers.total} customers, this is low-hanging fruit.`,
                confidence_score: 0.90,
                potential_impact: 'high',
                suggested_action: 'Create birthday rewards automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'birthday' }
            });
        }

        // Suggest reviews
        if (!hasTemplate('review-request') && data.customers.total > 15) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Build Your Online Reputation',
                description: 'Automated review requests at the right moment dramatically increase your review count. More reviews = more trust = more customers.',
                confidence_score: 0.82,
                potential_impact: 'medium',
                suggested_action: 'Create review request automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'review-request' }
            });
        }

        // Suggest newsletter
        if (!hasTemplate('monthly-newsletter') && data.customers.total > 50) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Start a Monthly Newsletter',
                description: `${data.customers.total} customers is a valuable audience. A monthly newsletter keeps you top-of-mind and drives consistent engagement.`,
                confidence_score: 0.78,
                potential_impact: 'medium',
                suggested_action: 'Create monthly newsletter',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'newsletter' }
            });
        }

        // Suggest loyalty program
        if (!hasTemplate('loyalty-program') && data.customers.total > 100) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Launch a Loyalty Program',
                description: 'With over 100 customers, a loyalty program can increase customer lifetime value by 30%. Reward your best customers automatically.',
                confidence_score: 0.80,
                potential_impact: 'high',
                suggested_action: 'Create loyalty program',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'loyalty' }
            });
        }

        // Check for inactive automations
        if (data.automations.total > 0 && data.automations.active === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'risk',
                title: 'Your Automations Are Inactive',
                description: `You have ${data.automations.total} automations but none are active. Review and activate them to start seeing results.`,
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Review automations',
                action_type: 'navigate',
                action_payload: { url: '/app/automations.html' }
            });
        }

        // No customers
        if (data.customers.total === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Import Your Customer Data',
                description: 'Get started by importing your existing customers. This enables all AI-powered features and personalized recommendations.',
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Go to Customers',
                action_type: 'navigate',
                action_payload: { url: '/app/customers.html' }
            });
        }

        return recommendations.slice(0, 10);
    }

    // Save recommendations
    async function saveRecommendations(recommendations) {
        try {
            const { error } = await supabase
                .from('ai_recommendations')
                .insert(recommendations);

            if (error) {
                console.error('Error saving recommendations:', error);
            }
        } catch (err) {
            console.log('Could not save recommendations:', err);
        }
    }

    // Handle recommendation action clicks
    async function handleRecommendationAction(event) {
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

    // Dismiss recommendation
    async function dismissRecommendation(recId) {
        try {
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'dismissed',
                    dismissed_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Update local data
            const rec = allRecommendations.find(r => r.id === recId);
            if (rec) {
                rec.status = 'dismissed';
                rec.dismissed_at = new Date().toISOString();
            }

            // Re-render
            renderFilteredRecommendations();
            updateStats();

        } catch (err) {
            console.error('Error dismissing recommendation:', err);
        }
    }

    // Implement recommendation - THE MAGIC
    async function implementRecommendation(recId, payload) {
        const card = document.querySelector(`[data-recommendation-id="${recId}"]`);
        const button = card?.querySelector('[data-action="implement"]');

        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="spinner"></span> Creating...';
        }

        try {
            // Handle navigation
            if (payload.url) {
                window.location.href = payload.url;
                return;
            }

            // Get template
            const template = AI_TEMPLATES[payload.template_id];
            if (!template) {
                alert('Template not found. Please try again.');
                return;
            }

            // CREATE PROJECT
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
                alert('Error creating project. Please try again.');
                return;
            }

            // CREATE AUTOMATION
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
                    is_active: false,
                    settings: { created_from: 'ai_recommendation' }
                })
                .select()
                .single();

            if (automationError) {
                console.error('Error creating automation:', automationError);
            }

            // Mark as implemented
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'implemented',
                    implemented_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Log audit
            if (typeof AuditLog !== 'undefined') {
                AuditLog.logProjectCreate(organizationId, project);
            }

            // Celebrate!
            if (typeof celebrate === 'function') {
                celebrate();
            }

            // Show success
            if (card) {
                card.style.background = 'rgba(16, 185, 129, 0.1)';
                if (button) {
                    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Created!';
                    button.classList.remove('btn-primary');
                    button.classList.add('btn-success');
                }
            }

            // Navigate
            setTimeout(() => {
                if (automation) {
                    window.location.href = `/app/automation.html#${automation.id}`;
                } else {
                    window.location.href = `/app/project.html#${project.id}`;
                }
            }, 800);

        } catch (err) {
            console.error('Error implementing recommendation:', err);
            alert('Error creating project. Please try again.');

            if (button) {
                button.disabled = false;
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Accept & Create';
            }
        }
    }

    // Public API
    return {
        init
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    IntelligencePage.init();
});
