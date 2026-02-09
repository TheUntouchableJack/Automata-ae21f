// ===== Plan Limits Configuration =====
// Defines limits for all plan types: free, subscription tiers, AppSumo lifetime tiers, and add-ons
// Updated Feb 2026 for Royalty launch

// Admin bypass - admins skip plan limits
let _isPlanAdmin = false;

/**
 * Set admin status for plan limit bypass
 * @param {boolean} isAdmin - Whether the current user is an admin
 */
function setPlanAdminStatus(isAdmin) {
    _isPlanAdmin = isAdmin === true;
}

/**
 * Check if current user is admin (bypasses plan limits)
 * @returns {boolean}
 */
function isPlanAdmin() {
    return _isPlanAdmin;
}

const PLAN_LIMITS = {
    // Free tier - 250 customers, Royal chat (limited), no messaging/automations
    free: {
        name: 'Free',
        tagline: 'Experience Royal',
        members: 250, // "customers" in UI
        // Messaging limits
        emails_monthly: 0,
        sms_monthly: 0,
        // Royal AI capabilities - limited chat only
        royal_chat: true,
        royal_queries_monthly: 20, // Limited to 20 queries/month
        max_automations: 0, // Royal can suggest but not act
        review_mode: false,
        autonomous_mode: false,
        business_learning: false,
        fatigue_protection: false,
        performance_metrics: false,
        visit_attribution: false,
        // Branding & support
        white_label: false,
        email_support: false,
        priority_support: false,
        dedicated_support: false
    },

    // Subscription tiers (matches Stripe products) - Free/Pro/Max
    subscription: {
        pro: {
            name: 'Pro',
            tagline: 'Royal runs your marketing',
            price_monthly: 299,
            price_annual: 239, // $2,868/year = $239/month (20% off)
            members: -1, // unlimited customers
            // Messaging limits
            emails_monthly: 10000,
            sms_monthly: 500,
            // Royal AI capabilities - everything
            royal_chat: true,
            royal_queries_monthly: -1, // unlimited
            max_automations: -1, // unlimited
            review_mode: true,
            autonomous_mode: true,
            business_learning: true,
            fatigue_protection: true,
            performance_metrics: true,
            visit_attribution: false,
            // Branding & support
            white_label: false,
            email_support: true,
            priority_support: true,
            dedicated_support: false
        },
        max: {
            name: 'Max',
            tagline: 'Royal proves your ROI',
            price_monthly: 749,
            price_annual: 599, // $7,188/year = $599/month (20% off)
            members: -1, // unlimited customers
            // Messaging limits
            emails_monthly: 50000,
            sms_monthly: 2000,
            // Royal AI capabilities - everything + attribution
            royal_chat: true,
            royal_queries_monthly: -1, // unlimited
            max_automations: -1, // unlimited
            review_mode: true,
            autonomous_mode: true,
            business_learning: true,
            fatigue_protection: true,
            performance_metrics: true,
            visit_attribution: true,
            // Branding & support
            white_label: true,
            email_support: true,
            priority_support: true,
            dedicated_support: true
        }
    },

    // AppSumo lifetime tiers - Loyalty platform + email, NO Royal AI or SMS
    appsumo: {
        1: {
            name: 'Lifetime Tier 1',
            tagline: 'Loyalty Essentials',
            badge: 'AppSumo',
            price_paid: 59,
            members: 500,
            // Messaging limits - email only, no SMS
            emails_monthly: 500,
            sms_monthly: 0,
            // Royal AI capabilities - none without Royalty Pro
            royal_chat: false,
            max_automations: 0,
            review_mode: false,
            autonomous_mode: false,
            business_learning: false,
            fatigue_protection: false,
            performance_metrics: false,
            visit_attribution: false,
            // Branding & support
            white_label: false,
            email_support: true,
            priority_support: false,
            dedicated_support: false,
            can_upgrade_to_pro: true
        },
        2: {
            name: 'Lifetime Tier 2',
            tagline: 'Growing Business',
            badge: 'AppSumo',
            price_paid: 118,
            members: 2000,
            // Messaging limits
            emails_monthly: 2000,
            sms_monthly: 0,
            // Royal AI capabilities
            royal_chat: false,
            max_automations: 0,
            review_mode: false,
            autonomous_mode: false,
            business_learning: false,
            fatigue_protection: false,
            performance_metrics: false,
            visit_attribution: false,
            // Branding & support
            white_label: false,
            email_support: true,
            priority_support: false,
            dedicated_support: false,
            can_upgrade_to_pro: true
        },
        3: {
            name: 'Lifetime Tier 3',
            tagline: 'Unlimited Growth',
            badge: 'AppSumo',
            price_paid: 177,
            members: -1, // unlimited
            // Messaging limits
            emails_monthly: 5000,
            sms_monthly: 0,
            // Royal AI capabilities
            royal_chat: false,
            max_automations: 0,
            review_mode: false,
            autonomous_mode: false,
            business_learning: false,
            fatigue_protection: false,
            performance_metrics: false,
            visit_attribution: false,
            // Branding & support
            white_label: false,
            email_support: true,
            priority_support: false,
            dedicated_support: false,
            can_upgrade_to_pro: true
        }
    },

    // Royalty Pro add-on for LTD users - unlocks Pro-level AI features
    royalty_pro: {
        name: 'Royalty Pro',
        tagline: 'Let Royal Run Your Marketing',
        price_monthly: 79,
        // Additional messaging (on top of base LTD)
        emails_monthly_bonus: 10000,
        sms_monthly: 500,
        // Unlocks Growth-level Royal AI capabilities
        royal_chat: true,
        max_automations: -1,
        review_mode: true,
        autonomous_mode: true,
        business_learning: true,
        fatigue_protection: true,
        performance_metrics: true,
        visit_attribution: true,
        // Branding & support upgrades
        white_label: true,
        priority_support: true
    },

    // Add-on bundles (one-time purchases)
    bundles: {
        sms_100: {
            name: '100 SMS',
            price: 15,
            sms_credits: 100
        },
        email_5000: {
            name: '5,000 Emails',
            price: 10,
            email_credits: 5000
        }
    }
};

// ===== Helper Functions =====

/**
 * Get limits for an organization based on their plan
 * @param {Object} org - Organization object with plan_type, appsumo_tier, subscription_tier, has_royalty_pro
 * @returns {Object} Plan limits
 */
function getOrgLimits(org) {
    if (!org) return PLAN_LIMITS.free;

    // Check for custom overrides first
    if (org.plan_limits_override) {
        return { ...getPlanLimits(org), ...org.plan_limits_override };
    }

    return getPlanLimits(org);
}

/**
 * Get base plan limits without overrides
 */
function getPlanLimits(org) {
    if (!org) return PLAN_LIMITS.free;

    let baseLimits;

    switch (org.plan_type) {
        case 'appsumo_lifetime':
            baseLimits = { ...PLAN_LIMITS.appsumo[org.appsumo_tier] } || { ...PLAN_LIMITS.appsumo[1] };

            // Apply Royalty Pro add-on if active
            if (org.has_royalty_pro) {
                const pro = PLAN_LIMITS.royalty_pro;
                // Add bonus emails on top of base
                baseLimits.emails_monthly = baseLimits.emails_monthly + pro.emails_monthly_bonus;
                baseLimits.sms_monthly = pro.sms_monthly;
                // Unlock all Royal AI capabilities
                baseLimits.royal_chat = pro.royal_chat;
                baseLimits.max_automations = pro.max_automations;
                baseLimits.review_mode = pro.review_mode;
                baseLimits.autonomous_mode = pro.autonomous_mode;
                baseLimits.business_learning = pro.business_learning;
                baseLimits.fatigue_protection = pro.fatigue_protection;
                baseLimits.performance_metrics = pro.performance_metrics;
                baseLimits.visit_attribution = pro.visit_attribution;
                // Branding & support
                baseLimits.white_label = pro.white_label;
                baseLimits.priority_support = pro.priority_support;
                baseLimits.has_royalty_pro = true;
            }
            return baseLimits;

        case 'subscription':
            return PLAN_LIMITS.subscription[org.subscription_tier] || PLAN_LIMITS.subscription.pro;

        case 'free':
        default:
            return PLAN_LIMITS.free;
    }
}

/**
 * Check if a limit is unlimited (-1)
 */
function isUnlimited(value) {
    return value === -1;
}

/**
 * Format limit for display
 */
function formatLimit(value) {
    if (value === -1) return 'Unlimited';
    if (value === 0) return '—';
    return value.toLocaleString();
}

/**
 * Calculate usage percentage
 * @returns {number} Percentage (0-100+)
 */
function getUsagePercent(used, limit) {
    if (limit === -1) return 0; // Unlimited
    if (limit === 0) return used > 0 ? 100 : 0;
    return Math.round((used / limit) * 100);
}

/**
 * Get usage status class based on percentage
 */
function getUsageStatus(percent) {
    if (percent >= 100) return 'critical';
    if (percent >= 80) return 'warning';
    if (percent >= 50) return 'moderate';
    return 'healthy';
}

/**
 * Check if user can perform an action based on limits
 * @returns {Object} { allowed: boolean, message?: string, upgradeRequired?: boolean }
 */
function checkLimit(org, usage, limitType, increment = 1) {
    // Admins bypass plan limits
    if (_isPlanAdmin) {
        return { allowed: true, adminBypass: true };
    }

    const limits = getOrgLimits(org);
    const limit = limits[limitType];

    // Boolean feature check (e.g., autonomous_mode, visit_attribution)
    if (typeof limit === 'boolean') {
        if (!limit) {
            return {
                allowed: false,
                message: getFeatureUpgradeMessage(limitType, org),
                upgradeRequired: true
            };
        }
        return { allowed: true };
    }

    // Feature not available at all (quota = 0)
    if (limit === 0) {
        return {
            allowed: false,
            message: getFeatureUpgradeMessage(limitType, org),
            upgradeRequired: true,
            current: 0,
            limit: 0
        };
    }

    // Unlimited
    if (limit === -1) {
        return { allowed: true };
    }

    const currentUsage = usage[limitType] || 0;
    const newUsage = currentUsage + increment;

    if (newUsage > limit) {
        return {
            allowed: false,
            message: getLimitMessage(limitType, limit, org),
            upgradeRequired: true,
            current: currentUsage,
            limit: limit
        };
    }

    // Warning at 80%
    const percent = getUsagePercent(newUsage, limit);
    if (percent >= 80 && percent < 100) {
        return {
            allowed: true,
            warning: true,
            message: `You're at ${percent}% of your ${formatLimitName(limitType)} limit.`,
            current: newUsage,
            limit: limit
        };
    }

    return { allowed: true, current: newUsage, limit: limit };
}

/**
 * Get human-readable limit name
 */
function formatLimitName(limitType) {
    const names = {
        members: 'members',
        emails_monthly: 'emails this month',
        sms_monthly: 'SMS this month',
        max_automations: 'AI automations',
        // Boolean features
        royal_chat: 'Royal AI chat',
        autonomous_mode: 'Autonomous Mode',
        business_learning: 'Business Learning',
        fatigue_protection: 'Fatigue Protection',
        performance_metrics: 'Performance Metrics',
        visit_attribution: 'Visit Attribution'
    };
    return names[limitType] || limitType;
}

/**
 * Get limit exceeded message based on plan type
 */
function getLimitMessage(limitType, limit, org) {
    const name = formatLimitName(limitType);
    const planType = org.plan_type;

    // SMS/Email specific messages with bundle upsell
    if (limitType === 'sms_monthly') {
        if (planType === 'appsumo_lifetime' && !org.has_royalty_pro) {
            return 'SMS campaigns require Royalty Pro ($49/mo). Unlock 500 SMS/month plus Royal AI.';
        }
        return `You've used all ${formatLimit(limit)} SMS this month. Purchase an SMS bundle ($15/100) or wait for monthly reset.`;
    }

    if (limitType === 'emails_monthly') {
        return `You've used all ${formatLimit(limit)} emails this month. Purchase an email bundle ($10/5,000) or wait for monthly reset.`;
    }

    // Automation limit
    if (limitType === 'max_automations') {
        if (planType === 'free') {
            return 'Upgrade to Pro ($299/mo) to create AI automations.';
        }
        return `You've reached your limit of ${limit} automations. Upgrade to Pro ($299/mo) for unlimited automations.`;
    }

    // Member limit
    if (limitType === 'members') {
        if (planType === 'appsumo_lifetime') {
            return `You've reached your ${formatLimit(limit)} member limit. Stack another AppSumo code to increase your limit.`;
        }
        return `You've reached your ${formatLimit(limit)} member limit. Upgrade to the next tier for more capacity.`;
    }

    return `You've reached your ${name} limit (${formatLimit(limit)}). Upgrade to unlock more capacity.`;
}

/**
 * Get feature upgrade message for boolean capabilities
 */
function getFeatureUpgradeMessage(feature, org) {
    const messages = {
        // Royal AI features
        royal_chat: org.plan_type === 'appsumo_lifetime'
            ? 'Royal AI chat requires Royalty Pro ($49/mo). Let Royal help run your marketing.'
            : 'Upgrade to Pro ($299/mo) to chat with Royal and get AI recommendations.',
        autonomous_mode: 'Autonomous Mode is available on Pro ($299/mo). Let Royal send campaigns without asking.',
        business_learning: 'Business Learning is available on Pro ($299/mo). Royal learns your margins, busy times, and customer patterns.',
        fatigue_protection: 'Fatigue Protection is available on Pro ($299/mo). Royal knows when to back off.',
        performance_metrics: 'Performance Metrics are available on Pro ($299/mo). See which automations drive results.',
        visit_attribution: 'Visit Attribution is available on Max ($749/mo). Link automations to actual store visits.',
        // Other features
        white_label: 'White-label branding is available on Max ($749/mo) or with Royalty Pro.',
        priority_support: 'Priority support is available on Pro ($299/mo) and above.',
        dedicated_support: 'Dedicated support is available on Max ($749/mo).'
    };
    return messages[feature] || `This feature requires a plan upgrade.`;
}

/**
 * Get upgrade options based on current plan
 */
function getUpgradeOptions(org) {
    const options = [];

    if (org.plan_type === 'appsumo_lifetime') {
        // LTD users can add Royalty Pro or stack codes
        if (!org.has_royalty_pro) {
            options.push({
                type: 'royalty_pro',
                label: 'Add Royalty Pro',
                description: '$49/month - Royal AI + 500 SMS + White-label',
                action: 'upgrade',
                tier: 'royalty_pro',
                featured: true
            });
        }
        if (org.appsumo_tier < 3) {
            options.push({
                type: 'stack_code',
                label: 'Stack Another Code',
                description: 'Redeem another AppSumo code to increase member limits',
                action: 'redeem'
            });
        }
    } else if (org.plan_type === 'subscription') {
        // Subscription users can upgrade tiers (Pro → Max)
        const upgrades = {
            pro: {
                tier: 'max',
                name: 'Max',
                price: 749,
                description: 'Visit Attribution + white-label + 50K emails'
            }
        };
        const upgrade = upgrades[org.subscription_tier];
        if (upgrade) {
            options.push({
                type: 'upgrade_tier',
                label: `Upgrade to ${upgrade.name}`,
                description: `$${upgrade.price}/month - ${upgrade.description}`,
                action: 'upgrade',
                tier: upgrade.tier
            });
        }
    } else {
        // Free users
        options.push({
            type: 'subscription',
            label: 'Upgrade to Pro',
            description: '$299/month - Royal runs your marketing autonomously',
            action: 'upgrade',
            tier: 'pro',
            featured: true
        });
        options.push({
            type: 'appsumo',
            label: 'Redeem AppSumo Code',
            description: 'Have a lifetime deal code? Redeem it here',
            action: 'redeem'
        });
    }

    return options;
}

/**
 * Get all usage metrics for dashboard display
 */
function formatUsageForDashboard(org, usage) {
    const limits = getOrgLimits(org);

    const metrics = [
        {
            key: 'members',
            label: 'Members',
            used: usage.members_count || 0,
            limit: limits.members,
            percent: getUsagePercent(usage.members_count || 0, limits.members),
            status: getUsageStatus(getUsagePercent(usage.members_count || 0, limits.members)),
            icon: 'users'
        }
    ];

    // Email metric (if available)
    if (limits.emails_monthly > 0) {
        metrics.push({
            key: 'emails',
            label: 'Emails This Month',
            used: usage.emails_sent || 0,
            limit: limits.emails_monthly,
            percent: getUsagePercent(usage.emails_sent || 0, limits.emails_monthly),
            status: getUsageStatus(getUsagePercent(usage.emails_sent || 0, limits.emails_monthly)),
            icon: 'mail',
            resets: true,
            bundle: PLAN_LIMITS.bundles.email_5000
        });
    }

    // SMS metric (if available)
    if (limits.sms_monthly > 0) {
        metrics.push({
            key: 'sms',
            label: 'SMS This Month',
            used: usage.sms_sent || 0,
            limit: limits.sms_monthly,
            percent: getUsagePercent(usage.sms_sent || 0, limits.sms_monthly),
            status: getUsageStatus(getUsagePercent(usage.sms_sent || 0, limits.sms_monthly)),
            icon: 'message-square',
            resets: true,
            bundle: PLAN_LIMITS.bundles.sms_100
        });
    }

    // Automations metric (if limited)
    if (limits.max_automations > 0 && limits.max_automations !== -1) {
        metrics.push({
            key: 'automations',
            label: 'AI Automations',
            used: usage.automations_count || 0,
            limit: limits.max_automations,
            percent: getUsagePercent(usage.automations_count || 0, limits.max_automations),
            status: getUsageStatus(getUsagePercent(usage.automations_count || 0, limits.max_automations)),
            icon: 'zap'
        });
    }

    return {
        plan: {
            name: limits.name,
            tagline: limits.tagline,
            type: org.plan_type,
            badge: limits.badge || null,
            has_royalty_pro: limits.has_royalty_pro || false
        },
        metrics: metrics,
        features: {
            // Royal AI capabilities
            royal_chat: limits.royal_chat,
            max_automations: limits.max_automations,
            review_mode: limits.review_mode,
            autonomous_mode: limits.autonomous_mode,
            business_learning: limits.business_learning,
            fatigue_protection: limits.fatigue_protection,
            performance_metrics: limits.performance_metrics,
            visit_attribution: limits.visit_attribution,
            // Branding & support
            white_label: limits.white_label,
            email_support: limits.email_support,
            priority_support: limits.priority_support,
            dedicated_support: limits.dedicated_support
        }
    };
}

/**
 * Check if organization can use Royal AI chat (sync - basic check)
 */
function canUseRoyalAI(org) {
    const limits = getOrgLimits(org);
    return limits.royal_chat === true;
}

// Backwards compatibility alias
function canUseIntelligenceSync(org) {
    return canUseRoyalAI(org);
}

/**
 * Check if organization can use a specific Royal AI capability
 * @param {Object} org - Organization object
 * @param {string} capability - Capability to check (autonomous_mode, business_learning, etc.)
 * @returns {boolean}
 */
function hasCapability(org, capability) {
    const limits = getOrgLimits(org);
    return limits[capability] === true || limits[capability] === -1;
}

/**
 * Check messaging quota (async - with current usage)
 * @param {string|object} orgIdOrObj - Organization ID or organization object
 * @param {string} type - 'email' or 'sms'
 * @returns {Promise<{allowed: boolean, used: number, limit: number, remaining: number}>}
 */
async function checkMessagingQuota(orgIdOrObj, type = 'email') {
    // Handle both org ID and org object
    let org = orgIdOrObj;
    if (typeof orgIdOrObj === 'string') {
        if (typeof supabase !== 'undefined') {
            const { data } = await supabase
                .from('organizations')
                .select('*')
                .eq('id', orgIdOrObj)
                .single();
            org = data;
        } else {
            return { allowed: false, used: 0, limit: 0, remaining: 0 };
        }
    }

    if (!org) {
        return { allowed: false, used: 0, limit: 0, remaining: 0 };
    }

    const limits = getOrgLimits(org);
    const limitKey = type === 'sms' ? 'sms_monthly' : 'emails_monthly';
    const monthlyLimit = limits[limitKey];

    // No access
    if (monthlyLimit === 0) {
        return { allowed: false, used: 0, limit: 0, remaining: 0 };
    }

    // Unlimited
    if (monthlyLimit === -1) {
        return { allowed: true, used: 0, limit: -1, remaining: -1 };
    }

    // Check current month's usage
    let used = 0;
    if (typeof supabase !== 'undefined') {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const usageColumn = type === 'sms' ? 'sms_sent' : 'emails_sent';
        const { data } = await supabase
            .from('usage_tracking')
            .select(usageColumn)
            .eq('organization_id', org.id)
            .gte('period_start', startOfMonth.toISOString().split('T')[0])
            .single();

        used = data?.[usageColumn] || 0;
    }

    const remaining = Math.max(0, monthlyLimit - used);
    return {
        allowed: used < monthlyLimit,
        used,
        limit: monthlyLimit,
        remaining
    };
}

// Backwards compatibility - alias for old canUseIntelligence
async function canUseIntelligence(orgIdOrObj) {
    let org = orgIdOrObj;
    if (typeof orgIdOrObj === 'string') {
        if (typeof supabase !== 'undefined') {
            const { data } = await supabase
                .from('organizations')
                .select('*')
                .eq('id', orgIdOrObj)
                .single();
            org = data;
        } else {
            return { allowed: false };
        }
    }
    return { allowed: canUseRoyalAI(org) };
}

/**
 * Check if organization has white-label access
 */
function hasWhiteLabel(org) {
    const limits = getOrgLimits(org);
    return limits.white_label === true;
}

/**
 * Check if organization can create more automations
 */
function canCreateAutomation(org, currentCount) {
    const limits = getOrgLimits(org);
    if (limits.max_automations === -1) return true;
    if (limits.max_automations === 0) return false;
    return currentCount < limits.max_automations;
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.PLAN_LIMITS = PLAN_LIMITS;
    window.getOrgLimits = getOrgLimits;
    window.checkLimit = checkLimit;
    window.formatLimit = formatLimit;
    window.getUsagePercent = getUsagePercent;
    window.getUsageStatus = getUsageStatus;
    window.getUpgradeOptions = getUpgradeOptions;
    window.formatUsageForDashboard = formatUsageForDashboard;
    window.formatLimitName = formatLimitName;
    window.isUnlimited = isUnlimited;
    window.setPlanAdminStatus = setPlanAdminStatus;
    window.isPlanAdmin = isPlanAdmin;
    // New capability-based functions
    window.canUseRoyalAI = canUseRoyalAI;
    window.hasCapability = hasCapability;
    window.checkMessagingQuota = checkMessagingQuota;
    window.canCreateAutomation = canCreateAutomation;
    window.getFeatureUpgradeMessage = getFeatureUpgradeMessage;
    // Backwards compatibility
    window.canUseIntelligence = canUseIntelligence;
    window.canUseIntelligenceSync = canUseIntelligenceSync;
    window.hasWhiteLabel = hasWhiteLabel;

    // Create PlanLimits namespace for crown-dashboard.js compatibility
    window.PlanLimits = {
        PLANS: {
            free: PLAN_LIMITS.free,
            pro: PLAN_LIMITS.subscription.pro,
            max: PLAN_LIMITS.subscription.max,
            subscription: PLAN_LIMITS.subscription
        },
        // New capability-based API
        canUseRoyalAI: canUseRoyalAI,
        hasCapability: hasCapability,
        checkMessagingQuota: checkMessagingQuota,
        canCreateAutomation: canCreateAutomation,
        // Backwards compatibility
        canUseIntelligence: canUseIntelligence,
        getOrgLimits: getOrgLimits,
        checkLimit: checkLimit,
        formatLimit: formatLimit
    };
}
