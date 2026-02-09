// ===== AI Opportunities Module =====
// This module handles AI-generated automation opportunities

let currentBatch = 1;
const BATCH_SIZE = 5;

// ===== Load Opportunities =====
async function loadOpportunities(projectId) {
    const list = document.getElementById('opportunities-list');
    const showMoreContainer = document.getElementById('show-more-container');

    if (!list) return;

    try {
        const { data: opportunities, error, count } = await supabase
            .from('opportunities')
            .select('*', { count: 'exact' })
            .eq('project_id', projectId)
            .in('status', ['suggested', 'accepted'])
            .order('batch_number', { ascending: true })
            .order('created_at', { ascending: false })
            .range(0, currentBatch * BATCH_SIZE - 1);

        if (error) throw error;

        if (!opportunities || opportunities.length === 0) {
            list.innerHTML = '<p class="empty-text" style="padding: 24px; text-align: center;">No opportunities yet. Click "Generate AI Opportunities" to get started.</p>';
            showMoreContainer.style.display = 'none';
            return;
        }

        // Show the opportunities column
        if (typeof showOpportunitiesColumn === 'function') {
            showOpportunitiesColumn();
        }

        renderOpportunities(opportunities);

        // Show "Show More" button if there are more opportunities
        if (count > currentBatch * BATCH_SIZE) {
            showMoreContainer.style.display = 'flex';
        } else {
            showMoreContainer.style.display = 'none';
        }

    } catch (error) {
        console.error('Error loading opportunities:', error);
    }
}

function renderOpportunities(opportunities) {
    const list = document.getElementById('opportunities-list');

    list.innerHTML = opportunities.map(opp => {
        const impactClass = `impact-${opp.estimated_impact || 'medium'}`;
        const typeLabel = formatOpportunityType(opp.opportunity_type);

        return `
            <div class="opportunity-card" data-id="${opp.id}">
                <div class="opportunity-card-header">
                    <div>
                        <h4 class="opportunity-title">${escapeHtml(opp.title)}</h4>
                        <div class="opportunity-meta">
                            <span class="opportunity-badge type">${typeLabel}</span>
                            <span class="opportunity-badge ${impactClass}">${capitalizeFirst(opp.estimated_impact || 'Medium')} Impact</span>
                        </div>
                    </div>
                </div>
                <p class="opportunity-description">${escapeHtml(opp.description || '')}</p>
                ${opp.ai_reasoning ? `
                    <div class="opportunity-reasoning">
                        <strong>Why this?</strong> ${escapeHtml(opp.ai_reasoning)}
                    </div>
                ` : ''}
                <div class="opportunity-card-actions">
                    ${opp.status === 'suggested' ? `
                        <button class="btn-automate" onclick="startAutomation('${opp.id}')">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M13.5 8L6 12.5V3.5L13.5 8Z" fill="currentColor"/>
                            </svg>
                            Start Automation
                        </button>
                        <button class="btn-dismiss" onclick="dismissOpportunity('${opp.id}')">Dismiss</button>
                    ` : `
                        <span class="opportunity-badge impact-high">Accepted</span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function formatOpportunityType(type) {
    const types = {
        'email': 'Email Campaign',
        'workflow': 'Workflow',
        'notification': 'Notification',
        'report': 'Report',
        'automation': 'Automation'
    };
    return types[type] || capitalizeFirst(type || 'Automation');
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function toggleReasoning(btn) {
    btn.classList.toggle('expanded');
    const content = btn.nextElementSibling;
    content.classList.toggle('visible');
}

window.toggleReasoning = toggleReasoning;

// ===== Start Automation / Dismiss Opportunities =====
async function startAutomation(id) {
    try {
        // Mark as accepted
        const { error } = await supabase
            .from('opportunities')
            .update({ status: 'accepted' })
            .eq('id', id);

        if (error) throw error;

        celebrate();

        // Redirect to automations tab or create automation modal
        // For now, switch to automations tab
        if (typeof switchTab === 'function') {
            switchTab('automations');
        }

        // Optionally trigger the create automation modal
        if (typeof openAutomationModal === 'function') {
            openAutomationModal();
        }

    } catch (error) {
        console.error('Error starting automation:', error);
        alert(window.t ? window.t('errors.startingAutomation') : 'Error starting automation. Please try again.');
    }
}

window.startAutomation = startAutomation;

async function dismissOpportunity(id) {
    try {
        const { error } = await supabase
            .from('opportunities')
            .update({ status: 'dismissed' })
            .eq('id', id);

        if (error) throw error;

        loadOpportunities(currentProject.id);

    } catch (error) {
        console.error('Error dismissing opportunity:', error);
        alert(window.t ? window.t('errors.dismissingOpportunity') : 'Error dismissing opportunity. Please try again.');
    }
}

window.dismissOpportunity = dismissOpportunity;

// ===== Generate Opportunities =====
async function generateOpportunities(project) {
    const analyzeBtn = document.getElementById('analyze-btn');
    const analyzingState = document.getElementById('analyzing-state');

    // Check rate limiting for business analysis
    if (window.RateLimiter && window.RateLimiter.isRateLimited('business_analysis')) {
        const errorMsg = window.RateLimiter.getRateLimitErrorMessage('business_analysis');
        alert(errorMsg);
        return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="spin">
            <path d="M10 2V4M10 16V18M4 10H2M18 10H16M15.66 15.66L14.24 14.24M15.66 4.34L14.24 5.76M4.34 15.66L5.76 14.24M4.34 4.34L5.76 5.76" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Analyzing...
    `;
    analyzingState.style.display = 'flex';

    // Record rate limit attempt
    if (window.RateLimiter) {
        window.RateLimiter.recordRateLimit('business_analysis');
    }

    try {
        // Get existing opportunities to avoid duplicates
        const { data: existingOpportunities } = await supabase
            .from('opportunities')
            .select('title')
            .eq('project_id', project.id);

        // Get customer stats
        const { data: projectCustomers } = await supabase
            .from('project_customers')
            .select('customer_id, customers(email, first_name, last_name, company, tags, custom_data)')
            .eq('project_id', project.id)
            .limit(100);

        // Get organization customer count
        const { count: totalCustomers } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', project.organization_id);

        // Build context for AI
        const context = {
            project: {
                name: project.name,
                description: project.description,
                industry: project.industry,
                goals: project.goals || [],
                painPoints: project.pain_points || [],
                targetMarket: project.target_market,
                location: project.location,
                competitors: project.competitors || []
            },
            customers: {
                totalInProject: projectCustomers?.length || 0,
                totalInOrganization: totalCustomers || 0,
                sampleData: projectCustomers?.slice(0, 10).map(pc => ({
                    email: pc.customers?.email,
                    company: pc.customers?.company,
                    tags: pc.customers?.tags
                })) || []
            },
            existingOpportunities: existingOpportunities?.map(o => o.title) || []
        };

        // Generate opportunities using AI
        const opportunities = await callAIForOpportunities(context);

        // Get max batch number
        const { data: maxBatchData } = await supabase
            .from('opportunities')
            .select('batch_number')
            .eq('project_id', project.id)
            .order('batch_number', { ascending: false })
            .limit(1);

        const nextBatch = (maxBatchData?.[0]?.batch_number || 0) + 1;

        // Save opportunities
        if (opportunities && opportunities.length > 0) {
            const toInsert = opportunities.map(opp => ({
                project_id: project.id,
                title: opp.title,
                description: opp.description,
                opportunity_type: opp.type,
                target_segment: opp.segment,
                estimated_impact: opp.impact,
                implementation_complexity: opp.complexity,
                ai_reasoning: opp.reasoning,
                batch_number: nextBatch
            }));

            const { error } = await supabase
                .from('opportunities')
                .insert(toInsert);

            if (error) throw error;

            celebrate();
        }

        // Show opportunities column and reload
        if (typeof showOpportunitiesColumn === 'function') {
            showOpportunitiesColumn();
        }
        await loadOpportunities(project.id);

    } catch (error) {
        console.error('Error generating opportunities:', error);
        alert(window.t ? window.t('errors.generatingOpportunities') : 'Error generating opportunities. Please try again.');
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2V4M10 16V18M4 10H2M18 10H16M15.66 15.66L14.24 14.24M15.66 4.34L14.24 5.76M4.34 15.66L5.76 14.24M4.34 4.34L5.76 5.76" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Analyze Now
        `;
        analyzingState.style.display = 'none';
    }
}

// ===== AI Call (Mock Implementation) =====
// In production, this would call your backend which calls Claude API
async function callAIForOpportunities(context) {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate contextual opportunities based on project data
    const opportunities = [];
    const { project, customers } = context;

    // Industry-specific opportunity templates
    const industryOpportunities = {
        food: [
            {
                title: 'Loyalty Program Re-engagement Campaign',
                description: 'Send personalized emails to inactive loyalty members with special offers to bring them back.',
                type: 'email',
                segment: 'Inactive loyalty members',
                impact: 'high',
                complexity: 'easy',
                reasoning: 'Based on your food & restaurant industry, customer retention through loyalty programs is critical. Re-engaging inactive members typically yields 15-25% recovery rate.'
            },
            {
                title: 'Weekly Special Menu Announcement',
                description: 'Automated weekly email showcasing new menu items and specials to drive repeat visits.',
                type: 'email',
                segment: 'All customers',
                impact: 'medium',
                complexity: 'easy',
                reasoning: 'Regular communication about menu updates keeps your restaurant top-of-mind and can increase visit frequency by up to 20%.'
            },
            {
                title: 'Birthday Reward Automation',
                description: 'Automatically send birthday rewards to customers a week before their special day.',
                type: 'workflow',
                segment: 'Customers with birthdays',
                impact: 'high',
                complexity: 'moderate',
                reasoning: 'Birthday campaigns in the restaurant industry see 30%+ redemption rates and often bring groups, increasing average ticket size.'
            }
        ],
        health: [
            {
                title: 'Membership Renewal Reminder Sequence',
                description: 'Multi-touch email sequence starting 30 days before membership expiration.',
                type: 'workflow',
                segment: 'Expiring memberships',
                impact: 'high',
                complexity: 'moderate',
                reasoning: 'Proactive renewal reminders can improve retention by 20-30%. The health industry sees high switching costs, making retention efforts highly valuable.'
            },
            {
                title: 'Health Tips Newsletter',
                description: 'Weekly automated newsletter with health tips, workout suggestions, and facility updates.',
                type: 'email',
                segment: 'All members',
                impact: 'medium',
                complexity: 'easy',
                reasoning: 'Regular health content positions you as a trusted advisor and keeps members engaged between visits.'
            },
            {
                title: 'Class Booking Reminder',
                description: 'Automated reminders 24 hours before booked classes with preparation tips.',
                type: 'notification',
                segment: 'Class bookers',
                impact: 'medium',
                complexity: 'easy',
                reasoning: 'Reduces no-shows by up to 40% and improves member experience with personalized preparation advice.'
            }
        ],
        service: [
            {
                title: 'Contract Renewal Pipeline',
                description: 'Automated workflow to nurture clients 90 days before contract renewal with value reports.',
                type: 'workflow',
                segment: 'Clients with upcoming renewals',
                impact: 'high',
                complexity: 'moderate',
                reasoning: 'For professional services, contract renewals are critical revenue. Starting 90 days early allows time for negotiation and upselling.'
            },
            {
                title: 'Quarterly Business Review Scheduling',
                description: 'Automated email to schedule quarterly check-ins with key accounts.',
                type: 'email',
                segment: 'Key accounts',
                impact: 'high',
                complexity: 'easy',
                reasoning: 'Regular business reviews strengthen client relationships and surface upsell opportunities. QBRs correlate with 2x higher retention.'
            },
            {
                title: 'NPS Survey Automation',
                description: 'Trigger NPS surveys after project completion or service delivery.',
                type: 'workflow',
                segment: 'Post-project clients',
                impact: 'medium',
                complexity: 'easy',
                reasoning: 'Collecting NPS data helps identify at-risk clients early and generates testimonials from promoters.'
            }
        ],
        retail: [
            {
                title: 'Abandoned Cart Recovery',
                description: 'Multi-email sequence to recover abandoned shopping carts with progressive incentives.',
                type: 'workflow',
                segment: 'Cart abandoners',
                impact: 'high',
                complexity: 'moderate',
                reasoning: 'Cart abandonment recovery emails can recover 5-15% of lost sales. Progressive incentives optimize recovery vs. margin.'
            },
            {
                title: 'Post-Purchase Follow-up',
                description: 'Automated emails requesting reviews and suggesting complementary products.',
                type: 'email',
                segment: 'Recent purchasers',
                impact: 'high',
                complexity: 'easy',
                reasoning: 'Post-purchase emails have 2x higher open rates and can drive 10-15% repeat purchase rate.'
            },
            {
                title: 'Back-in-Stock Notifications',
                description: 'Automatically notify customers when items on their wishlist are back in stock.',
                type: 'notification',
                segment: 'Wishlist users',
                impact: 'medium',
                complexity: 'moderate',
                reasoning: 'Back-in-stock alerts convert at 5-10%, much higher than general promotional emails.'
            }
        ]
    };

    // Get base opportunities for the industry
    const industry = project.industry || 'agnostic';
    let baseOpportunities = industryOpportunities[industry] || [];

    // If no industry-specific ones, generate generic ones
    if (baseOpportunities.length === 0) {
        baseOpportunities = [
            {
                title: 'Welcome Email Sequence',
                description: 'Automated onboarding sequence for new customers introducing your brand and services.',
                type: 'email',
                segment: 'New customers',
                impact: 'high',
                complexity: 'easy',
                reasoning: 'Welcome emails see 4x higher open rates. First impressions are crucial for long-term customer relationships.'
            },
            {
                title: 'Win-back Campaign',
                description: 'Re-engage customers who haven\'t interacted in 90+ days with a special offer.',
                type: 'email',
                segment: 'Inactive customers',
                impact: 'medium',
                complexity: 'easy',
                reasoning: 'Acquiring new customers costs 5-7x more than retaining existing ones. Win-back campaigns typically recover 5-10% of churned customers.'
            },
            {
                title: 'Customer Feedback Loop',
                description: 'Automated surveys after key interactions to gather feedback and improve service.',
                type: 'workflow',
                segment: 'All customers',
                impact: 'medium',
                complexity: 'moderate',
                reasoning: 'Customer feedback drives product improvements and helps identify at-risk accounts before they churn.'
            }
        ];
    }

    // Add goal-based opportunities
    if (project.goals && project.goals.length > 0) {
        const goal = project.goals[0].toLowerCase();
        if (goal.includes('retention') || goal.includes('churn')) {
            baseOpportunities.push({
                title: 'Customer Health Score Monitoring',
                description: 'Track engagement metrics to identify at-risk customers and trigger intervention workflows.',
                type: 'workflow',
                segment: 'At-risk customers',
                impact: 'high',
                complexity: 'complex',
                reasoning: `Based on your goal "${project.goals[0]}", monitoring customer health scores can predict churn 30+ days in advance, allowing proactive intervention.`
            });
        }
        if (goal.includes('engagement') || goal.includes('open rate')) {
            baseOpportunities.push({
                title: 'Send Time Optimization',
                description: 'Analyze customer behavior to send emails at optimal times for each recipient.',
                type: 'workflow',
                segment: 'All customers',
                impact: 'medium',
                complexity: 'moderate',
                reasoning: `Based on your goal "${project.goals[0]}", optimizing send times can improve open rates by 15-25% without changing content.`
            });
        }
    }

    // Add pain-point based opportunities
    if (project.painPoints && project.painPoints.length > 0) {
        const painPoint = project.painPoints[0].toLowerCase();
        if (painPoint.includes('low') && (painPoint.includes('engagement') || painPoint.includes('open'))) {
            baseOpportunities.push({
                title: 'Subject Line A/B Testing',
                description: 'Automated A/B testing of email subject lines to find what resonates with your audience.',
                type: 'workflow',
                segment: 'All customers',
                impact: 'high',
                complexity: 'moderate',
                reasoning: `You mentioned "${project.painPoints[0]}" as a pain point. Subject line testing is the fastest way to improve open rates, often yielding 10-30% improvement.`
            });
        }
    }

    // Filter out existing opportunities
    const existingTitles = new Set(context.existingOpportunities.map(t => t.toLowerCase()));
    const newOpportunities = baseOpportunities.filter(opp =>
        !existingTitles.has(opp.title.toLowerCase())
    );

    // Return up to 5 opportunities
    return newOpportunities.slice(0, 5);
}

// ===== Show More =====
function showMoreOpportunities() {
    currentBatch++;
    loadOpportunities(currentProject.id);
}
