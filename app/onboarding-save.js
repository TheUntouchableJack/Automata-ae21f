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

    // Slug generation. AppUtils is not loaded on every page that calls commit(),
    // so this is deliberately self-contained.
    function slugify(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'my-app';
    }

    /**
     * Create the customer_apps row (and its rewards) from the config the visitor
     * was shown before signing up.
     *
     * WHY THIS IS HERE
     * commit() previously wrote projects, automations, ai_recommendations,
     * business_knowledge and business_profiles — and no customer_apps row at all.
     * The app was created blind and late by dashboard.js's autoCreateDefaultApp()
     * whenever the user happened to click "Application" in the sidebar, which is
     * why every business ended up purple with the same four filler rewards. If we
     * are going to show someone their app before signup, that app has to be the
     * one that actually gets created.
     *
     * Returns the new app id, or null. NEVER throws: a failure here must not cost
     * the account, the project, or the knowledge that was already written.
     */
    async function createLoyaltyApp(organizationId, projectId, config, businessDetails) {
        if (!config) return null;
        try {
            const details = businessDetails || {};
            const appName = config.appName || `${details.businessName || 'My Business'} Rewards`;
            const baseSlug = slugify(appName);

            const tiers = Array.isArray(config.tiers) ? config.tiers : [];
            const tierByKey = {};
            tiers.forEach(t => { if (t && t.key) tierByKey[t.key] = t; });

            // Built in EXACTLY the shape app-builder.js getAppData() produces, so
            // the wizard round-trips it without normalising anything on first save.
            // In particular tier_thresholds is the NESTED {points, name} shape the
            // builder writes, not the flat shape autoCreateDefaultApp writes.
            const appData = {
                organization_id: organizationId,
                project_id: projectId || null,
                name: appName,
                slug: baseSlug,
                description: config.appDescription || '',
                app_type: config.appType || 'loyalty',
                features: config.features || {},
                settings: {
                    points_per_scan: config.pointsPerScan ?? 10,
                    points_per_dollar: config.pointsPerDollar ?? 1,
                    welcome_points: config.welcomePoints ?? 50,
                    daily_scan_limit: config.dailyScanLimit ?? 1,
                    require_email: true,
                    require_phone: false,
                    tier_thresholds: {
                        bronze:   { points: tierByKey.bronze?.points ?? 0,      name: tierByKey.bronze?.name || 'Bronze' },
                        silver:   { points: tierByKey.silver?.points ?? 500,    name: tierByKey.silver?.name || 'Silver' },
                        gold:     { points: tierByKey.gold?.points ?? 1500,     name: tierByKey.gold?.name || 'Gold' },
                        platinum: { points: tierByKey.platinum?.points ?? 5000, name: tierByKey.platinum?.name || 'Platinum' }
                    },
                    created_from: 'signup_ai',
                    config_source: config.source || 'template'
                },
                branding: {
                    primary_color: config.primaryColor || '#5B21B6',
                    secondary_color: config.secondaryColor || '#2E1065',
                    logo_url: null,
                    logo_fit: 'contain',
                    favicon_url: null,
                    custom_css: null,
                    business_info: {
                        hours: null,
                        phone: null,
                        email: null,
                        address: details.location || null,
                        social: { website: details.websiteUrl || null }
                    }
                },
                is_active: true,
                // NOT published. autoCreateDefaultApp publishes immediately, which
                // was right when nobody was ever going to open the wizard — the
                // context this change removes. Publishing here would put /a/{slug}
                // publicly live with colours and reward names the owner has never
                // seen, and would fire app_published (explicitly the north-star
                // activation event) for ~100% of signups, destroying it as a metric.
                is_published: false
            };

            // Slug collisions. dashboard.js retries exactly once with a 4-char
            // suffix, which is not enough at signup volume for names like
            // "my-business-rewards". Bounded: base, then three random suffixes,
            // then a timestamp that cannot realistically collide.
            let app = null;
            const candidates = [
                baseSlug,
                `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
                `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
                `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
                `${baseSlug}-${Date.now().toString(36)}`
            ];

            for (const slug of candidates) {
                appData.slug = slug;
                const { data, error } = await db.from('customer_apps').insert(appData).select().single();
                if (!error) { app = data; break; }
                // Only a unique-violation is worth retrying; anything else is a
                // real error and retrying it just burns four more round trips.
                if (error.code !== '23505') {
                    console.error('Error creating loyalty app:', error);
                    return null;
                }
            }

            if (!app) {
                console.error('Could not find a free slug for the loyalty app');
                return null;
            }

            // Rewards. Non-fatal: an app with no rewards is still a usable app,
            // and the owner is about to walk through the builder anyway.
            const rewards = Array.isArray(config.rewards) ? config.rewards : [];
            if (rewards.length) {
                const rows = rewards.map((r, i) => ({
                    app_id: app.id,
                    name: r.name,
                    description: r.description || '',
                    points_cost: r.pointsCost ?? 100,
                    tier_required: r.tierRequired || null,
                    display_order: i,
                    is_active: true
                }));
                const { error: rewardError } = await db.from('app_rewards').insert(rows);
                if (rewardError) console.error('Error creating app rewards:', rewardError);
            }

            return app.id;
        } catch (err) {
            console.error('Error creating loyalty app:', err);
            return null;
        }
    }

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

            // ── Create the loyalty app ──
            // Placed after the project insert (so project_id can be set) and
            // before the automations block. Two AFTER INSERT triggers fire on
            // customer_apps — create_default_campaigns and
            // auto_create_support_settings — so those rows now exist from minute
            // one instead of appearing whenever the user first opens the app page.
            //
            // If no config was stored (an older OnboardingStorage blob, or the
            // control arm of the preview A/B), rebuild one from the template so a
            // signup still ends with a real app rather than nothing.
            let appConfig = onboardingData.appConfig || null;
            if (!appConfig && typeof AppConfigFallback !== 'undefined') {
                appConfig = AppConfigFallback.build({
                    prompt: onboardingData.businessPrompt || '',
                    industry: onboardingData.businessContext?.industry || '',
                    businessName: onboardingData.businessDetails?.businessName || ''
                });
            }

            const newAppId = await createLoyaltyApp(
                organizationId,
                project.id,
                appConfig,
                onboardingData.businessDetails
            );

            // commit() returns project.id and three call sites consume that, so
            // the signature must not change. The app id rides alongside instead.
            OnboardingSave.lastAppId = newAppId;

            if (newAppId) {
                window.Analytics?.track('onboarding_app_created', {
                    app_id: newAppId,
                    source: appConfig?.source || 'unknown',
                    reward_count: (appConfig?.rewards || []).length
                });
            } else {
                // Falling through to autoCreateDefaultApp means a generic purple
                // app instead of the one they were shown. Worth an alarm.
                window.Analytics?.track('onboarding_app_create_failed', {
                    had_config: !!appConfig
                });
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

            // Which pricing tier sent them here, stashed by signup.html from
            // ?plan=. Survives the cold-path hop to get-started.html because
            // sessionStorage is per-tab, not per-page. Recorded so plan intent
            // is answerable from the database and not just from analytics.
            let planIntent = null;
            try { planIntent = sessionStorage.getItem('royalty_plan_intent'); } catch (e) { /* private mode */ }
            if (planIntent) {
                settingsPayload.plan_intent = planIntent;
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
            try { sessionStorage.removeItem('royalty_plan_intent'); } catch (e) { /* private mode */ }
            if (typeof BusinessAnalysis !== 'undefined' && BusinessAnalysis.clearCache) {
                BusinessAnalysis.clearCache();
            }

            console.log('Onboarding data saved to project:', project.id);
            // The account exists and the business data is persisted — the point
            // where a signup becomes a usable org. Everything before this is
            // reversible; this is the first durable write.
            window.Analytics?.track('onboarding_committed', {
                industry: ctx.industry || null,
                automations_seeded: knowledgeFacts.length > 0
            });
            return project.id;
        } catch (err) {
            console.error('Error saving onboarding data:', err);
            // This failure strands the user with an account but no business
            // data, and today it only surfaces in their console. Worth an alarm.
            window.Analytics?.track('onboarding_commit_failed', {
                message: String(err && err.message || err)
            });
            return null;
        }
    }

    // lastAppId: set by commit() when it creates a customer_apps row. commit()
    // still returns project.id because three call sites depend on that; callers
    // that need to route into the app builder read this instead.
    return { commit, createLoyaltyApp, lastAppId: null };
})();

window.OnboardingSave = OnboardingSave;
