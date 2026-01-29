// ===== Plan Limits Configuration =====
// Defines limits for all plan types: free, subscription tiers, and AppSumo lifetime tiers

const PLAN_LIMITS = {
    // Free tier
    free: {
        name: 'Free',
        projects: 1,
        automations: 3,
        customers: 100,
        emails_monthly: 500,
        sms_monthly: 0,
        ai_analyses: 10,
        team_members: 1,
        api_access: false,
        webhooks: false,
        priority_support: false
    },

    // Subscription tiers
    subscription: {
        growth: {
            name: 'Growth',
            price_monthly: 39,
            price_annual: 31,
            projects: 5,
            automations: 15,
            customers: 2000,
            emails_monthly: 5000,
            sms_monthly: 0,
            ai_analyses: 50,
            team_members: 3,
            api_access: false,
            webhooks: false,
            priority_support: false
        },
        business: {
            name: 'Business',
            price_monthly: 99,
            price_annual: 79,
            projects: 15,
            automations: 50,
            customers: 10000,
            emails_monthly: 25000,
            sms_monthly: 0,
            ai_analyses: 200,
            team_members: 10,
            api_access: true,
            webhooks: true,
            priority_support: true
        },
        enterprise: {
            name: 'Enterprise',
            price_monthly: 249,
            price_annual: 199,
            projects: -1, // unlimited
            automations: -1,
            customers: 50000,
            emails_monthly: 100000,
            sms_monthly: 1000,
            ai_analyses: -1,
            team_members: -1,
            api_access: true,
            webhooks: true,
            priority_support: true,
            dedicated_support: true,
            sla: true
        }
    },

    // AppSumo lifetime tiers
    appsumo: {
        1: {
            name: 'Lifetime Tier 1',
            badge: 'AppSumo',
            projects: 3,
            automations: 10,
            customers: 1000,
            emails_monthly: 3000,
            sms_monthly: 0,
            ai_analyses: 30,
            team_members: 2,
            api_access: false,
            webhooks: false,
            priority_support: false
        },
        2: {
            name: 'Lifetime Tier 2',
            badge: 'AppSumo',
            projects: 10,
            automations: 30,
            customers: 5000,
            emails_monthly: 15000,
            sms_monthly: 0,
            ai_analyses: 100,
            team_members: 5,
            api_access: true,
            webhooks: false,
            priority_support: true
        },
        3: {
            name: 'Lifetime Tier 3',
            badge: 'AppSumo',
            projects: 25,
            automations: -1, // unlimited
            customers: 15000,
            emails_monthly: 50000,
            sms_monthly: 0,
            ai_analyses: 300,
            team_members: 10,
            api_access: true,
            webhooks: true,
            priority_support: true,
            white_label: true
        }
    }
};

// ===== Helper Functions =====

/**
 * Get limits for an organization based on their plan
 * @param {Object} org - Organization object with plan_type, appsumo_tier, subscription_tier
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

    switch (org.plan_type) {
        case 'appsumo_lifetime':
            return PLAN_LIMITS.appsumo[org.appsumo_tier] || PLAN_LIMITS.appsumo[1];

        case 'subscription':
            return PLAN_LIMITS.subscription[org.subscription_tier] || PLAN_LIMITS.subscription.growth;

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
    const limits = getOrgLimits(org);
    const limit = limits[limitType];

    // Unlimited
    if (limit === -1) {
        return { allowed: true };
    }

    const currentUsage = usage[limitType] || 0;
    const newUsage = currentUsage + increment;

    if (newUsage > limit) {
        return {
            allowed: false,
            message: getLimitMessage(limitType, limit, org.plan_type),
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
        projects: 'projects',
        automations: 'automations',
        customers: 'customers',
        emails_monthly: 'monthly emails',
        sms_monthly: 'monthly SMS',
        ai_analyses: 'AI analyses',
        team_members: 'team members'
    };
    return names[limitType] || limitType;
}

/**
 * Get limit exceeded message based on plan type
 */
function getLimitMessage(limitType, limit, planType) {
    const name = formatLimitName(limitType);

    if (planType === 'appsumo_lifetime') {
        return `You've reached your ${name} limit (${formatLimit(limit)}). Stack another AppSumo code or upgrade to a subscription for more capacity.`;
    }

    if (planType === 'subscription') {
        return `You've reached your ${name} limit (${formatLimit(limit)}). Upgrade to a higher tier for more capacity.`;
    }

    return `You've reached your ${name} limit (${formatLimit(limit)}). Upgrade to unlock more capacity.`;
}

/**
 * Get upgrade options based on current plan
 */
function getUpgradeOptions(org) {
    const options = [];

    if (org.plan_type === 'appsumo_lifetime') {
        // AppSumo users can stack codes or switch to subscription
        if (org.appsumo_tier < 3) {
            options.push({
                type: 'stack_code',
                label: 'Stack Another Code',
                description: 'Redeem another AppSumo code to increase your limits',
                action: 'redeem'
            });
        }
        options.push({
            type: 'subscription',
            label: 'Switch to Monthly',
            description: 'Get unlimited growth with a monthly subscription',
            action: 'upgrade'
        });
    } else if (org.plan_type === 'subscription') {
        // Subscription users can upgrade tiers
        const upgrades = {
            growth: { tier: 'business', name: 'Business', price: 99 },
            business: { tier: 'enterprise', name: 'Enterprise', price: 249 }
        };
        const upgrade = upgrades[org.subscription_tier];
        if (upgrade) {
            options.push({
                type: 'upgrade_tier',
                label: `Upgrade to ${upgrade.name}`,
                description: `$${upgrade.price}/month - More projects, automations, and customers`,
                action: 'upgrade',
                tier: upgrade.tier
            });
        }
    } else {
        // Free users
        options.push({
            type: 'subscription',
            label: 'Upgrade to Growth',
            description: '$39/month - 5 projects, 2,000 customers, 5,000 emails',
            action: 'upgrade',
            tier: 'growth'
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

    return {
        plan: {
            name: limits.name,
            type: org.plan_type,
            badge: limits.badge || null
        },
        metrics: [
            {
                key: 'projects',
                label: 'Projects',
                used: usage.projects_count || 0,
                limit: limits.projects,
                percent: getUsagePercent(usage.projects_count || 0, limits.projects),
                status: getUsageStatus(getUsagePercent(usage.projects_count || 0, limits.projects)),
                icon: 'folder'
            },
            {
                key: 'automations',
                label: 'Automations',
                used: usage.automations_count || 0,
                limit: limits.automations,
                percent: getUsagePercent(usage.automations_count || 0, limits.automations),
                status: getUsageStatus(getUsagePercent(usage.automations_count || 0, limits.automations)),
                icon: 'zap'
            },
            {
                key: 'customers',
                label: 'Customers',
                used: usage.customers_count || 0,
                limit: limits.customers,
                percent: getUsagePercent(usage.customers_count || 0, limits.customers),
                status: getUsageStatus(getUsagePercent(usage.customers_count || 0, limits.customers)),
                icon: 'users'
            },
            {
                key: 'emails',
                label: 'Emails This Month',
                used: usage.emails_sent || 0,
                limit: limits.emails_monthly,
                percent: getUsagePercent(usage.emails_sent || 0, limits.emails_monthly),
                status: getUsageStatus(getUsagePercent(usage.emails_sent || 0, limits.emails_monthly)),
                icon: 'mail',
                resets: true
            },
            {
                key: 'ai_analyses',
                label: 'AI Analyses',
                used: usage.ai_analyses_used || 0,
                limit: limits.ai_analyses,
                percent: getUsagePercent(usage.ai_analyses_used || 0, limits.ai_analyses),
                status: getUsageStatus(getUsagePercent(usage.ai_analyses_used || 0, limits.ai_analyses)),
                icon: 'brain',
                resets: true
            }
        ],
        features: {
            api_access: limits.api_access,
            webhooks: limits.webhooks,
            priority_support: limits.priority_support,
            team_members: limits.team_members
        }
    };
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
}
