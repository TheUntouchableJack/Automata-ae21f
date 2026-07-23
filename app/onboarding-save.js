// ===== Onboarding Save (shared) =====
// Persists onboarding discovery data (from OnboardingStorage) to the new user's
// organization: creates the project, drafts automations from selected templates,
// writes AI recommendations, and seeds business_knowledge + business_profiles.
//
// Extracted from signup.html so both the signup page (warm signups coming from
// the homepage) and app/get-started.html (cold signups describing their business
// after creating an account) share ONE implementation. No DB migration needed —
// reuses existing tables.
//
// Depends on globals (all defined by scripts loaded before this one):
//   db               — Supabase client (from auth.js)
//   OnboardingStorage — localStorage-backed onboarding data (onboarding-storage.js)
//   BusinessAnalysis  — cached AI analysis (business-analysis.js) [optional]
//
// Exposes: OnboardingSave.commit(userId) -> Promise<projectId|null>

const OnboardingSave = (function () {
    // Template id → human-readable automation name (mirrors the homepage templates).
    const templateNames = {
        'birthday-rewards': 'Birthday Rewards',
        'loyalty-program': 'Loyalty Points Program',
        'happy-hour': 'Happy Hour Alerts',
        'appointment-reminders': 'Appointment Reminders',
        'post-visit': 'Post-Visit Follow-up',
        'win-back': 'Win-Back Campaign',
        'referral-program': 'Referral Program',
        'review-request': 'Review Request',
        'new-product': 'New Product Announcements',
        'welcome-series': 'Welcome Series',
        'seasonal-promo': 'Seasonal Promotions',
        'vip-program': 'VIP Program'
    };

    async function commit(userId) {
        if (typeof OnboardingStorage === 'undefined') return null;

        const onboardingData = OnboardingStorage.get();
        if (!onboardingData) {
            return null;
        }

        const currentLang = localStorage.getItem('royalty_language')
            || document.documentElement.lang || 'en';

        try {
            const { data: membership, error: membershipError } = await db
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', userId)
                .single();

            if (membershipError || !membership) {
                console.error('Error finding organization:', membershipError);
                return null;
            }

            const organizationId = membership.organization_id;

            const projectName = onboardingData.businessDetails?.businessName
                || (onboardingData.businessContext?.industry
                    ? `${onboardingData.businessContext.industry.charAt(0).toUpperCase() + onboardingData.businessContext.industry.slice(1)} Rewards`
                    : 'My Loyalty Program');

            const { data: project, error: projectError } = await db
                .from('projects')
                .insert({
                    organization_id: organizationId,
                    created_by: userId,
                    name: projectName,
                    description: onboardingData.businessPrompt || '',
                    industry: onboardingData.businessContext?.industry || null,
                    goals: onboardingData.businessContext?.goals || [],
                    pain_points: onboardingData.businessContext?.painPoints || [],
                    target_market: onboardingData.businessContext?.targetMarket || null,
                    location: onboardingData.businessContext?.location || null
                })
                .select()
                .single();

            if (projectError) {
                console.error('Error creating project:', projectError);
                return null;
            }

            if (onboardingData.selectedTemplates?.length > 0) {
                const automations = onboardingData.selectedTemplates.map(templateId => ({
                    project_id: project.id,
                    name: templateNames[templateId] || templateId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: `AI-recommended automation: ${templateNames[templateId] || templateId}`,
                    type: 'email',
                    frequency: 'manual',
                    is_active: false,
                    settings: { template_id: templateId }
                }));

                const { error: automationError } = await db
                    .from('automations')
                    .insert(automations);

                if (automationError) {
                    console.error('Error creating automations:', automationError);
                }
            }

            if (onboardingData.customAutomation?.trim()) {
                const { error: customError } = await db
                    .from('automations')
                    .insert({
                        project_id: project.id,
                        name: 'Custom Request: ' + (onboardingData.customAutomation.trim().slice(0, 60) || 'Pending'),
                        description: onboardingData.customAutomation,
                        type: 'custom',
                        frequency: 'manual',
                        is_active: false,
                        settings: { status: 'requested', source: 'onboarding' }
                    });

                if (customError) {
                    console.error('Error creating custom automation:', customError);
                }
            }

            // ── Save AI analysis as ai_recommendations ──
            const aiAnalysis = typeof BusinessAnalysis !== 'undefined'
                ? (BusinessAnalysis.getCached('en') || BusinessAnalysis.getCached(currentLang))
                : null;

            if (aiAnalysis?.opportunities?.length) {
                const iconToType = {
                    loyalty: 'opportunity',
                    automation: 'automation',
                    insights: 'efficiency',
                    growth: 'growth'
                };

                const recommendations = aiAnalysis.opportunities.map(opp => ({
                    organization_id: organizationId,
                    recommendation_type: iconToType[opp.icon] || 'opportunity',
                    title: opp.title,
                    description: opp.description,
                    confidence_score: 0.85,
                    potential_impact: 'high',
                    suggested_action: opp.actionSteps?.join('. ') || opp.impact || '',
                    action_type: 'signup_insight',
                    action_payload: {
                        source: 'signup_analysis',
                        icon: opp.icon,
                        impact_statement: opp.impact,
                        action_steps: opp.actionSteps || []
                    },
                    status: 'pending'
                }));

                const { error: recError } = await db
                    .from('ai_recommendations')
                    .insert(recommendations);

                if (recError) {
                    console.error('Error saving AI recommendations:', recError);
                }
            }

            // ── Store full analysis + business details in project settings ──
            const ctx = onboardingData.businessContext || {};
            const details = onboardingData.businessDetails || {};
            const settingsPayload = {};

            if (aiAnalysis) {
                settingsPayload.signup_analysis = aiAnalysis;
                settingsPayload.signup_analysis_date = new Date().toISOString();
            }
            if (details.businessName || details.businessType || details.customerCount || details.websiteUrl) {
                settingsPayload.business_details = {
                    businessName: details.businessName,
                    businessType: details.businessType,
                    customerCount: details.customerCount,
                    websiteUrl: details.websiteUrl
                };
            }

            const projectUpdate = {};
            if (Object.keys(settingsPayload).length > 0) {
                projectUpdate.settings = settingsPayload;
            }
            if (aiAnalysis?.businessSummary) {
                projectUpdate.description = aiAnalysis.businessSummary;
            }
            if (Object.keys(projectUpdate).length > 0) {
                await db.from('projects')
                    .update(projectUpdate)
                    .eq('id', project.id);
            }

            // ── Seed business_knowledge — Royal AI's foundation layer ──
            const knowledgeFacts = [];

            if (ctx.industry) {
                knowledgeFacts.push({
                    organization_id: organizationId,
                    layer: 'operational', category: 'business_type',
                    fact: `Business operates in ${ctx.industry} industry`,
                    confidence: 1.0, importance: 'critical',
                    source_type: 'conversation', status: 'active'
                });
            }
            if (ctx.description) {
                knowledgeFacts.push({
                    organization_id: organizationId,
                    layer: 'operational', category: 'description',
                    fact: ctx.description,
                    confidence: 0.95, importance: 'high',
                    source_type: 'conversation', status: 'active'
                });
            }
            if (ctx.targetMarket) {
                knowledgeFacts.push({
                    organization_id: organizationId,
                    layer: 'customer', category: 'target_market',
                    fact: `Target market: ${ctx.targetMarket}`,
                    confidence: 0.95, importance: 'high',
                    source_type: 'conversation', status: 'active'
                });
            }
            if (ctx.location) {
                knowledgeFacts.push({
                    organization_id: organizationId,
                    layer: 'market', category: 'location',
                    fact: `Business located in ${ctx.location}`,
                    confidence: 1.0, importance: 'high',
                    source_type: 'conversation', status: 'active'
                });
            }
            if (ctx.goals?.length) {
                ctx.goals.forEach(goal => {
                    knowledgeFacts.push({
                        organization_id: organizationId,
                        layer: 'growth', category: 'goals',
                        fact: `Business goal: ${goal}`,
                        confidence: 1.0, importance: 'high',
                        source_type: 'conversation', status: 'active'
                    });
                });
            }
            if (ctx.painPoints?.length) {
                ctx.painPoints.forEach(pain => {
                    knowledgeFacts.push({
                        organization_id: organizationId,
                        layer: 'operational', category: 'pain_points',
                        fact: `Pain point: ${pain}`,
                        confidence: 1.0, importance: 'high',
                        source_type: 'conversation', status: 'active'
                    });
                });
            }
            if (aiAnalysis?.businessSummary) {
                knowledgeFacts.push({
                    organization_id: organizationId,
                    layer: 'market', category: 'overview',
                    fact: `[AI Analysis] ${aiAnalysis.businessSummary}`,
                    confidence: 0.85, importance: 'critical',
                    source_type: 'inferred', status: 'active'
                });
            }
            if (aiAnalysis?.impactMetrics?.length) {
                aiAnalysis.impactMetrics.forEach(m => {
                    knowledgeFacts.push({
                        organization_id: organizationId,
                        layer: 'financial', category: 'projections',
                        fact: `[AI Projection] ${m.label}: ${m.value}`,
                        confidence: 0.75, importance: 'medium',
                        source_type: 'inferred', status: 'active'
                    });
                });
            }

            if (knowledgeFacts.length > 0) {
                const { error: knowledgeError } = await db
                    .from('business_knowledge')
                    .insert(knowledgeFacts);
                if (knowledgeError) {
                    console.error('Error seeding business knowledge:', knowledgeError);
                }
            }

            // ── Seed business_profiles — structured data ──
            const profileData = {
                organization_id: organizationId,
                profile_completeness: 15
            };

            if (details.businessType) {
                const typeMap = {
                    'restaurant': 'restaurant', 'cafe': 'restaurant', 'coffee': 'restaurant',
                    'retail': 'retail', 'shop': 'retail', 'store': 'retail',
                    'salon': 'service', 'gym': 'service', 'clinic': 'service',
                };
                const lowerType = (details.businessType || '').toLowerCase();
                profileData.business_type = typeMap[lowerType] || 'other';
                profileData.business_subtype = details.businessType;
                profileData.profile_completeness += 10;
            }
            if (ctx.targetMarket) {
                profileData.ideal_customer_description = ctx.targetMarket;
                profileData.profile_completeness += 10;
            }
            if (ctx.location) {
                profileData.profile_completeness += 5;
            }
            if (ctx.goals?.length) {
                profileData.growth_goals = ctx.goals.map(g => ({ goal: g, timeline: null, metrics: null }));
                profileData.biggest_challenge = ctx.painPoints?.[0] || null;
                profileData.profile_completeness += 10;
            }
            if (details.customerCount) {
                profileData.profile_completeness += 5;
            }

            const { error: profileError } = await db
                .from('business_profiles')
                .upsert(profileData);
            if (profileError) {
                console.error('Error seeding business profile:', profileError);
            }

            // ── Clear caches ──
            OnboardingStorage.clear();
            if (typeof BusinessAnalysis !== 'undefined' && BusinessAnalysis.clearCache) {
                BusinessAnalysis.clearCache();
            }

            console.log('Onboarding data saved to project:', project.id);
            return project.id;
        } catch (err) {
            console.error('Error saving onboarding data:', err);
            return null;
        }
    }

    return { commit };
})();

window.OnboardingSave = OnboardingSave;
