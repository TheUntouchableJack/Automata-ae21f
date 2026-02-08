// ===== Planning Cycles Module =====
// Micro, Meso, and Macro planning for proactive business intelligence

const PlanningCycles = (function() {

    // Cycle timing configuration
    const CYCLE_INTERVALS = {
        micro: 60 * 60 * 1000,      // 1 hour
        meso: 24 * 60 * 60 * 1000,  // 1 day
        macro: 7 * 24 * 60 * 60 * 1000  // 1 week
    };

    // Track last run times
    let lastMicroRun = null;
    let lastMesoRun = null;
    let lastMacroRun = null;

    // Active timers
    let microTimer = null;
    let mesoTimer = null;

    // Cached business data
    let cachedBusinessData = null;

    /**
     * Initialize planning cycles
     */
    async function init(orgId, supabase) {
        // Load last run times from localStorage
        const stored = localStorage.getItem('royalty_planning_cycles');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                lastMicroRun = parsed.micro ? new Date(parsed.micro) : null;
                lastMesoRun = parsed.meso ? new Date(parsed.meso) : null;
                lastMacroRun = parsed.macro ? new Date(parsed.macro) : null;
            } catch (e) {
                console.warn('Failed to load planning cycle state:', e);
            }
        }

        // Load business data
        await loadBusinessData(orgId, supabase);
    }

    /**
     * Load business data for planning
     */
    async function loadBusinessData(orgId, supabase) {
        try {
            const [orgRes, automationsRes, membersRes] = await Promise.all([
                supabase.from('organizations')
                    .select('name, plan_type, subscription_tier, created_at, timezone')
                    .eq('id', orgId)
                    .single(),
                supabase.from('automations')
                    .select('type, is_active, settings')
                    .eq('organization_id', orgId),
                supabase.from('customers')
                    .select('id', { count: 'exact', head: true })
                    .eq('organization_id', orgId)
            ]);

            // Get project/business info
            const { data: projectData } = await supabase
                .from('projects')
                .select('industry, city, state, pain_points, goals')
                .eq('organization_id', orgId)
                .limit(1);

            const project = projectData?.[0];

            cachedBusinessData = {
                orgId,
                name: orgRes.data?.name,
                tier: orgRes.data?.subscription_tier || orgRes.data?.plan_type || 'free',
                createdAt: orgRes.data?.created_at,
                timezone: orgRes.data?.timezone,
                industry: project?.industry,
                city: project?.city,
                state: project?.state,
                painPoints: project?.pain_points || [],
                goals: project?.goals || [],
                memberCount: membersRes.count || 0,
                automations: automationsRes.data || [],
                activeAutomations: (automationsRes.data || []).filter(a => a.is_active).map(a => a.type)
            };

            return cachedBusinessData;
        } catch (error) {
            console.error('Failed to load business data for planning:', error);
            return null;
        }
    }

    /**
     * Run micro planning cycle (real-time opportunities)
     */
    async function runMicroCycle() {
        if (!cachedBusinessData) return { opportunities: [], skipped: 'no_data' };

        const now = new Date();
        const opportunities = [];

        // Get external context (location from org settings if available)
        let context = null;
        if (typeof ExternalContext !== 'undefined') {
            context = await ExternalContext.gather({
                city: cachedBusinessData.city,
                state: cachedBusinessData.state
            });
        }

        // Weather-based opportunities
        if (context?.weather?.available) {
            const weather = context.weather.current;

            if (weather.conditions === 'cold_possible_snow') {
                opportunities.push({
                    type: 'weather-opportunity',
                    priority: 'high',
                    title: 'Cold Weather Alert',
                    action: 'Send a "warm up" promotion - hot drinks or cozy indoor specials',
                    urgency: 'immediate',
                    reasoning: 'Cold weather detected, customers seek warmth',
                    icon: '❄️'
                });
            }

            if (weather.conditions === 'hot') {
                opportunities.push({
                    type: 'weather-opportunity',
                    priority: 'high',
                    title: 'Hot Weather Opportunity',
                    action: 'Push cold drinks, refreshments, or "beat the heat" specials',
                    urgency: 'immediate',
                    reasoning: 'Hot weather increases demand for cooling options',
                    icon: '🌡️'
                });
            }

            if (weather.conditions === 'mild_possible_rain') {
                opportunities.push({
                    type: 'weather-opportunity',
                    priority: 'medium',
                    title: 'Rainy Day Potential',
                    action: 'Consider a "rainy day special" or delivery promotion',
                    urgency: 'within_hour',
                    reasoning: 'Rain may reduce foot traffic, incentivize visits',
                    icon: '🌧️'
                });
            }
        }

        // Time-based opportunities
        if (context?.time) {
            const time = context.time;

            if (time.isFriday && time.hour >= 15 && time.hour <= 18) {
                opportunities.push({
                    type: 'time-opportunity',
                    priority: 'high',
                    title: 'Friday Afternoon Window',
                    action: 'Post weekend kickoff promotion or happy hour reminder',
                    urgency: 'within_hour',
                    reasoning: 'Friday 3-6pm is prime time for weekend planning',
                    icon: '🎉'
                });
            }

            if (time.isMonday && time.hour >= 7 && time.hour <= 10) {
                opportunities.push({
                    type: 'time-opportunity',
                    priority: 'medium',
                    title: 'Monday Morning Boost',
                    action: 'Send "start the week right" loyalty bonus message',
                    urgency: 'today',
                    reasoning: 'Monday mornings benefit from motivational messaging',
                    icon: '☀️'
                });
            }

            if (time.isLunchHour && !time.isWeekend) {
                opportunities.push({
                    type: 'time-opportunity',
                    priority: 'medium',
                    title: 'Lunch Rush Active',
                    action: 'Ensure lunch specials are visible, consider flash points bonus',
                    urgency: 'immediate',
                    reasoning: 'Peak lunch traffic window',
                    icon: '🍽️'
                });
            }
        }

        // Holiday proximity opportunities
        if (context?.holidays?.length > 0) {
            const nextHoliday = context.holidays[0];

            if (nextHoliday.daysAway <= 3 && !cachedBusinessData.activeAutomations.includes('holiday')) {
                opportunities.push({
                    type: 'holiday-opportunity',
                    priority: 'high',
                    title: `${nextHoliday.name} is ${nextHoliday.daysAway === 0 ? 'Today' : nextHoliday.daysAway === 1 ? 'Tomorrow' : 'in ' + nextHoliday.daysAway + ' days'}!`,
                    action: `Launch ${nextHoliday.name} themed promotion immediately`,
                    urgency: 'immediate',
                    reasoning: `${nextHoliday.name} is imminent, capitalize on holiday spending`,
                    icon: '🎊'
                });
            }
        }

        // Update last run time
        lastMicroRun = now;
        saveRunTimes();

        return {
            cycle: 'micro',
            ran_at: now.toISOString(),
            opportunities,
            context_used: {
                weather: context?.weather?.available || false,
                time: !!context?.time,
                holidays: context?.holidays?.length || 0
            }
        };
    }

    /**
     * Run meso planning cycle (tactical, daily)
     */
    async function runMesoCycle() {
        if (!cachedBusinessData) return { campaigns: [], skipped: 'no_data' };

        const now = new Date();
        const campaigns = [];

        // Get external context for the week ahead
        let context = null;
        if (typeof ExternalContext !== 'undefined') {
            context = await ExternalContext.gather({
                city: cachedBusinessData.city,
                state: cachedBusinessData.state
            });
        }

        // Upcoming holiday campaigns
        if (context?.holidays) {
            for (const holiday of context.holidays.filter(h => h.daysAway <= 7 && h.daysAway >= 1)) {
                campaigns.push({
                    type: 'holiday-campaign',
                    priority: holiday.daysAway <= 3 ? 'high' : 'medium',
                    holiday: holiday.name,
                    daysAway: holiday.daysAway,
                    title: `${holiday.name} Campaign Prep`,
                    suggestedActions: generateHolidayActions(holiday, cachedBusinessData),
                    startBy: new Date(now.getTime() + (holiday.daysAway - 2) * 24 * 60 * 60 * 1000).toISOString()
                });
            }
        }

        // Slow day optimization
        if (cachedBusinessData.slowDays?.length > 0) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const today = dayNames[now.getDay()];

            // Check if tomorrow is a slow day
            const tomorrowIdx = (now.getDay() + 1) % 7;
            const tomorrow = dayNames[tomorrowIdx];

            if (cachedBusinessData.slowDays.includes(tomorrow)) {
                campaigns.push({
                    type: 'slow-day-boost',
                    priority: 'medium',
                    day: tomorrow,
                    title: `Tomorrow is ${tomorrow} - Slow Day`,
                    suggestedActions: [
                        `Double points on ${tomorrow}`,
                        `${tomorrow}-only flash sale (limited hours)`,
                        `Refer a friend bonus active on ${tomorrow}s`,
                        `Send "beat the crowd" early bird message`
                    ]
                });
            }
        }

        // Automation gap campaigns
        const automationGaps = identifyAutomationGaps(cachedBusinessData);
        for (const gap of automationGaps.slice(0, 2)) {
            campaigns.push({
                type: 'automation-setup',
                priority: gap.priority,
                automation: gap.type,
                title: gap.title,
                suggestedActions: [gap.action],
                impact: gap.impact
            });
        }

        // Business lifecycle campaigns
        const orgAge = Math.floor((now - new Date(cachedBusinessData.createdAt)) / (24 * 60 * 60 * 1000));

        if (orgAge <= 7) {
            campaigns.push({
                type: 'lifecycle-new',
                priority: 'high',
                title: 'New Business Setup Sprint',
                suggestedActions: [
                    'Import your first 10 customers',
                    'Set up a welcome automation',
                    'Configure your first reward tier'
                ]
            });
        } else if (orgAge <= 30 && cachedBusinessData.memberCount < 50) {
            campaigns.push({
                type: 'lifecycle-growth',
                priority: 'medium',
                title: 'Early Growth Phase',
                suggestedActions: [
                    'Launch a referral campaign',
                    'Run a "founding member" bonus promotion',
                    'Set up birthday rewards to capture dates'
                ]
            });
        }

        // Update last run time
        lastMesoRun = now;
        saveRunTimes();

        return {
            cycle: 'meso',
            ran_at: now.toISOString(),
            campaigns,
            business_age_days: orgAge,
            automations_active: cachedBusinessData.activeAutomations.length
        };
    }

    /**
     * Run macro planning cycle (strategic, weekly)
     */
    async function runMacroCycle() {
        if (!cachedBusinessData) return { strategy: null, skipped: 'no_data' };

        const now = new Date();

        // Calculate quarter
        const quarter = Math.floor(now.getMonth() / 3) + 1;
        const quarterEnd = new Date(now.getFullYear(), quarter * 3, 0);

        const strategy = {
            quarter: `Q${quarter} ${now.getFullYear()}`,
            themes: [],
            goals: [],
            risks: [],
            recommendations: []
        };

        // Member growth analysis
        const memberCount = cachedBusinessData.memberCount;
        if (memberCount < 50) {
            strategy.themes.push('Acquisition Focus');
            strategy.goals.push({
                metric: 'new_members',
                target: 100,
                current: memberCount,
                deadline: quarterEnd.toISOString()
            });
            strategy.recommendations.push({
                title: 'Aggressive Acquisition Campaign',
                description: 'Focus on referral bonuses and first-visit incentives',
                priority: 'high'
            });
        } else if (memberCount < 200) {
            strategy.themes.push('Growth Acceleration');
            strategy.goals.push({
                metric: 'new_members',
                target: memberCount * 1.5,
                current: memberCount,
                deadline: quarterEnd.toISOString()
            });
        } else {
            strategy.themes.push('Retention & Optimization');
            strategy.recommendations.push({
                title: 'Loyalty Program Optimization',
                description: 'Focus on visit frequency and average transaction value',
                priority: 'medium'
            });
        }

        // Seasonal planning
        const upcomingSeason = getUpcomingSeason(now);
        strategy.themes.push(`${upcomingSeason} Planning`);

        const seasonalRecommendations = getSeasonalRecommendations(upcomingSeason, cachedBusinessData);
        strategy.recommendations.push(...seasonalRecommendations);

        // Risk identification
        if (cachedBusinessData.activeAutomations.length === 0) {
            strategy.risks.push({
                type: 'no_automations',
                severity: 'high',
                description: 'No automations active - missing engagement opportunities',
                mitigation: 'Set up welcome and birthday automations immediately'
            });
        }

        if (!cachedBusinessData.activeAutomations.includes('win_back') &&
            !cachedBusinessData.activeAutomations.includes('re-engagement')) {
            strategy.risks.push({
                type: 'no_winback',
                severity: 'medium',
                description: 'No win-back automation - losing inactive customers',
                mitigation: 'Create 30-day inactivity trigger with special offer'
            });
        }

        // Pain point alignment
        if (cachedBusinessData.painPoints?.length > 0) {
            for (const pain of cachedBusinessData.painPoints.slice(0, 2)) {
                strategy.recommendations.push({
                    title: `Address: ${pain}`,
                    description: `Prioritize solutions for your stated challenge`,
                    priority: 'high',
                    source: 'pain_point'
                });
            }
        }

        // Goal alignment
        if (cachedBusinessData.goals?.length > 0) {
            for (const goal of cachedBusinessData.goals.slice(0, 2)) {
                strategy.goals.push({
                    metric: 'custom_goal',
                    description: goal,
                    deadline: quarterEnd.toISOString()
                });
            }
        }

        // Update last run time
        lastMacroRun = now;
        saveRunTimes();

        return {
            cycle: 'macro',
            ran_at: now.toISOString(),
            strategy
        };
    }

    // Helper functions

    function generateHolidayActions(holiday, businessData) {
        const actions = [];
        const name = holiday.name.toLowerCase();

        // Generic holiday actions
        actions.push(`Create ${holiday.name} themed email campaign`);
        actions.push(`Set up ${holiday.name} bonus points event`);

        // Holiday-specific
        if (name.includes('valentine')) {
            actions.push('Launch "bring your partner" couples discount');
            actions.push('Create gift card promotion');
        } else if (name.includes('mother') || name.includes('father')) {
            actions.push('Promote gift cards and family packages');
        } else if (name.includes('independence') || name.includes('memorial') || name.includes('labor')) {
            actions.push('Create patriotic-themed rewards');
            actions.push('Consider extended hours or special menu');
        } else if (name.includes('halloween')) {
            actions.push('Launch costume discount or spooky special');
        } else if (name.includes('thanksgiving')) {
            actions.push('Express gratitude to loyal customers');
            actions.push('Pre-Black Friday teaser');
        } else if (name.includes('black friday') || name.includes('cyber')) {
            actions.push('Massive points multiplier event');
            actions.push('Flash sale with time-limited offers');
        } else if (name.includes('christmas') || name.includes('new year')) {
            actions.push('Holiday gift card bundles');
            actions.push('Year-end loyalty appreciation event');
        }

        return actions.slice(0, 4);
    }

    function identifyAutomationGaps(businessData) {
        const gaps = [];
        const active = new Set(businessData.activeAutomations);

        if (!active.has('welcome')) {
            gaps.push({
                type: 'welcome',
                title: 'Missing: Welcome Automation',
                action: 'Set up welcome message for new members',
                priority: 'high',
                impact: 'First impression with new customers'
            });
        }

        if (!active.has('birthday')) {
            gaps.push({
                type: 'birthday',
                title: 'Missing: Birthday Rewards',
                action: 'Enable birthday automation (4x engagement increase)',
                priority: 'high',
                impact: 'Birthday rewards drive significant engagement'
            });
        }

        if (!active.has('win_back') && !active.has('re-engagement') && businessData.memberCount >= 50) {
            gaps.push({
                type: 'win_back',
                title: 'Missing: Win-Back Campaign',
                action: 'Create 30-day inactivity re-engagement flow',
                priority: 'medium',
                impact: 'Recover churning customers automatically'
            });
        }

        if (!active.has('streak-bonus') && businessData.memberCount >= 100) {
            gaps.push({
                type: 'streak-bonus',
                title: 'Missing: Visit Streak Bonus',
                action: 'Reward consecutive weekly visits',
                priority: 'low',
                impact: 'Increase visit frequency for regulars'
            });
        }

        return gaps;
    }

    function getUpcomingSeason(date) {
        const month = date.getMonth();
        if (month >= 2 && month <= 4) return 'Spring';
        if (month >= 5 && month <= 7) return 'Summer';
        if (month >= 8 && month <= 10) return 'Fall';
        return 'Winter';
    }

    function getSeasonalRecommendations(season, businessData) {
        const recommendations = [];

        switch (season) {
            case 'Spring':
                recommendations.push({
                    title: 'Spring Refresh Campaign',
                    description: 'Launch "fresh start" promotions as weather improves',
                    priority: 'medium'
                });
                break;
            case 'Summer':
                recommendations.push({
                    title: 'Summer Traffic Strategy',
                    description: 'Plan for vacation season - consider special hours or travel-related promos',
                    priority: 'medium'
                });
                break;
            case 'Fall':
                recommendations.push({
                    title: 'Back-to-Routine Push',
                    description: 'Capitalize on customers returning to regular schedules',
                    priority: 'medium'
                });
                recommendations.push({
                    title: 'Holiday Season Prep',
                    description: 'Plan Q4 holiday campaigns now (Halloween through New Year)',
                    priority: 'high'
                });
                break;
            case 'Winter':
                recommendations.push({
                    title: 'Year-End Appreciation',
                    description: 'Thank loyal customers and set up New Year incentives',
                    priority: 'high'
                });
                recommendations.push({
                    title: 'Beat the Winter Slump',
                    description: 'Create indoor-focused, comfort-driven promotions',
                    priority: 'medium'
                });
                break;
        }

        return recommendations;
    }

    function saveRunTimes() {
        const state = {
            micro: lastMicroRun?.toISOString(),
            meso: lastMesoRun?.toISOString(),
            macro: lastMacroRun?.toISOString()
        };
        localStorage.setItem('royalty_planning_cycles', JSON.stringify(state));
    }

    /**
     * Check if a cycle should run
     */
    function shouldRunCycle(cycle) {
        const now = Date.now();

        switch (cycle) {
            case 'micro':
                return !lastMicroRun || (now - lastMicroRun.getTime() > CYCLE_INTERVALS.micro);
            case 'meso':
                return !lastMesoRun || (now - lastMesoRun.getTime() > CYCLE_INTERVALS.meso);
            case 'macro':
                return !lastMacroRun || (now - lastMacroRun.getTime() > CYCLE_INTERVALS.macro);
            default:
                return false;
        }
    }

    /**
     * Run all due cycles
     */
    async function runDueCycles() {
        const results = {};

        if (shouldRunCycle('macro')) {
            results.macro = await runMacroCycle();
        }

        if (shouldRunCycle('meso')) {
            results.meso = await runMesoCycle();
        }

        if (shouldRunCycle('micro')) {
            results.micro = await runMicroCycle();
        }

        return results;
    }

    /**
     * Start automatic cycle scheduling (for autonomous mode)
     */
    function startAutoCycles() {
        // Run micro cycle every hour
        if (microTimer) clearInterval(microTimer);
        microTimer = setInterval(runMicroCycle, CYCLE_INTERVALS.micro);

        // Run meso cycle every day (at a reasonable hour)
        if (mesoTimer) clearInterval(mesoTimer);
        mesoTimer = setInterval(runMesoCycle, CYCLE_INTERVALS.meso);

        // Run immediately if due
        runDueCycles();
    }

    /**
     * Stop automatic cycles
     */
    function stopAutoCycles() {
        if (microTimer) {
            clearInterval(microTimer);
            microTimer = null;
        }
        if (mesoTimer) {
            clearInterval(mesoTimer);
            mesoTimer = null;
        }
    }

    // Public API
    return {
        init,
        loadBusinessData,
        runMicroCycle,
        runMesoCycle,
        runMacroCycle,
        runDueCycles,
        shouldRunCycle,
        startAutoCycles,
        stopAutoCycles,
        getBusinessData: () => cachedBusinessData
    };

})();

// Make available globally
window.PlanningCycles = PlanningCycles;
