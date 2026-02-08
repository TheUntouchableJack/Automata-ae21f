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
    // Free tier - 50 members, no intelligence
    free: {
        name: 'Free',
        members: 50,
        intelligence_monthly: 0,
        automations: true,  // 1-click automations included for all
        ai_setup: false,
        white_label: false,
        priority_support: false
    },

    // Subscription tiers (matches Stripe products)
    subscription: {
        starter: {
            name: 'Starter',
            price_monthly: 49,
            price_annual: 39, // $468/year = $39/month
            members: 500,
            intelligence_monthly: 30,
            automations: true,
            ai_setup: true,
            white_label: false,
            priority_support: false
        },
        growth: {
            name: 'Growth',
            price_monthly: 149,
            price_annual: 119, // $1,428/year = $119/month
            members: 2000,
            intelligence_monthly: 100,
            automations: true,
            ai_setup: true,
            white_label: false,
            priority_support: true
        },
        scale: {
            name: 'Scale',
            price_monthly: 399,
            price_annual: 319, // $3,828/year = $319/month
            members: -1, // unlimited
            intelligence_monthly: -1, // unlimited
            automations: true,
            ai_setup: true,
            white_label: true,
            priority_support: true
        }
    },

    // AppSumo lifetime tiers - AI setup + automations, NO intelligence
    appsumo: {
        1: {
            name: 'Lifetime Tier 1',
            badge: 'AppSumo',
            price_paid: 59,
            members: 500,
            intelligence_monthly: 0, // No intelligence - need Royalty Pro
            automations: true,
            ai_setup: true,
            white_label: false,
            priority_support: false,
            can_upgrade_to_pro: true
        },
        2: {
            name: 'Lifetime Tier 2',
            badge: 'AppSumo',
            price_paid: 118,
            members: 2000,
            intelligence_monthly: 0,
            automations: true,
            ai_setup: true,
            white_label: false,
            priority_support: true,
            can_upgrade_to_pro: true
        },
        3: {
            name: 'Lifetime Tier 3',
            badge: 'AppSumo',
            price_paid: 177,
            members: -1, // unlimited
            intelligence_monthly: 0,
            automations: true,
            ai_setup: true,
            white_label: false, // Need Royalty Pro for white-label
            priority_support: true,
            can_upgrade_to_pro: true
        }
    },

    // Royalty Pro add-on for LTD users
    royalty_pro: {
        name: 'Royalty Pro',
        price_monthly: 39,
        intelligence_monthly: -1, // unlimited
        white_label: true
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
                baseLimits.intelligence_monthly = PLAN_LIMITS.royalty_pro.intelligence_monthly;
                baseLimits.white_label = PLAN_LIMITS.royalty_pro.white_label;
                baseLimits.has_royalty_pro = true;
            }
            return baseLimits;

        case 'subscription':
            return PLAN_LIMITS.subscription[org.subscription_tier] || PLAN_LIMITS.subscription.starter;

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

    // Feature not available at all (e.g., intelligence for free users)
    if (limit === 0 && limitType === 'intelligence_monthly') {
        return {
            allowed: false,
            message: getIntelligenceUpgradeMessage(org),
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
        members: 'members',
        intelligence_monthly: 'AI insights this month',
        automations: 'automations'
    };
    return names[limitType] || limitType;
}

/**
 * Get limit exceeded message based on plan type
 */
function getLimitMessage(limitType, limit, planType) {
    const name = formatLimitName(limitType);

    if (planType === 'appsumo_lifetime') {
        if (limitType === 'intelligence_monthly') {
            return 'Add Royalty Pro ($39/mo) to unlock unlimited AI Intelligence.';
        }
        return `You've reached your ${name} limit (${formatLimit(limit)}). Stack another AppSumo code to increase your limits.`;
    }

    if (planType === 'subscription') {
        return `You've reached your ${name} limit (${formatLimit(limit)}). Upgrade to a higher tier for more capacity.`;
    }

    return `You've reached your ${name} limit (${formatLimit(limit)}). Upgrade to unlock more capacity.`;
}

/**
 * Get intelligence upgrade message based on plan type
 */
function getIntelligenceUpgradeMessage(org) {
    if (org.plan_type === 'appsumo_lifetime') {
        return 'AI Intelligence is available with Royalty Pro ($39/mo). Get unlimited insights and white-label branding.';
    }
    return 'Upgrade to Starter ($49/mo) to unlock AI Intelligence with 30 insights per month.';
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
                description: '$39/month - Unlimited Intelligence + White-label',
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
        // Subscription users can upgrade tiers
        const upgrades = {
            starter: { tier: 'growth', name: 'Growth', price: 149 },
            growth: { tier: 'scale', name: 'Scale', price: 399 }
        };
        const upgrade = upgrades[org.subscription_tier];
        if (upgrade) {
            options.push({
                type: 'upgrade_tier',
                label: `Upgrade to ${upgrade.name}`,
                description: `$${upgrade.price}/month - More members and insights`,
                action: 'upgrade',
                tier: upgrade.tier
            });
        }
    } else {
        // Free users
        options.push({
            type: 'subscription',
            label: 'Upgrade to Starter',
            description: '$49/month - 500 members, 30 AI insights',
            action: 'upgrade',
            tier: 'starter',
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

    // Only show intelligence metric if user has access
    if (limits.intelligence_monthly !== 0) {
        metrics.push({
            key: 'intelligence',
            label: 'AI Insights This Month',
            used: usage.intelligence_used || 0,
            limit: limits.intelligence_monthly,
            percent: getUsagePercent(usage.intelligence_used || 0, limits.intelligence_monthly),
            status: getUsageStatus(getUsagePercent(usage.intelligence_used || 0, limits.intelligence_monthly)),
            icon: 'brain',
            resets: true
        });
    }

    return {
        plan: {
            name: limits.name,
            type: org.plan_type,
            badge: limits.badge || null,
            has_royalty_pro: limits.has_royalty_pro || false
        },
        metrics: metrics,
        features: {
            automations: limits.automations,
            ai_setup: limits.ai_setup,
            white_label: limits.white_label,
            priority_support: limits.priority_support,
            intelligence: limits.intelligence_monthly !== 0
        }
    };
}

/**
 * Check if organization can use Intelligence features (sync - basic check)
 */
function canUseIntelligenceSync(org) {
    const limits = getOrgLimits(org);
    return limits.intelligence_monthly !== 0;
}

/**
 * Check Intelligence quota with usage (async - full check)
 * @param {string|object} orgIdOrObj - Organization ID or organization object
 * @returns {Promise<{allowed: boolean, used: number, limit: number}>}
 */
async function canUseIntelligence(orgIdOrObj) {
    // Handle both org ID and org object
    let org = orgIdOrObj;
    if (typeof orgIdOrObj === 'string') {
        // Fetch org from Supabase
        if (typeof supabase !== 'undefined') {
            const { data } = await supabase
                .from('organizations')
                .select('*')
                .eq('id', orgIdOrObj)
                .single();
            org = data;
        } else {
            return { allowed: false, used: 0, limit: 0 };
        }
    }

    if (!org) {
        return { allowed: false, used: 0, limit: 0 };
    }

    const limits = getOrgLimits(org);
    const monthlyLimit = limits.intelligence_monthly;

    // Free tier or no intelligence access
    if (monthlyLimit === 0) {
        return { allowed: false, used: 0, limit: 0 };
    }

    // Unlimited intelligence
    if (monthlyLimit === -1) {
        return { allowed: true, used: 0, limit: -1 };
    }

    // Check current month's usage
    let used = 0;
    if (typeof supabase !== 'undefined') {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count } = await supabase
            .from('ai_recommendations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id)
            .gte('created_at', startOfMonth.toISOString());

        used = count || 0;
    }

    return {
        allowed: used < monthlyLimit,
        used,
        limit: monthlyLimit
    };
}

/**
 * Check if organization has white-label access
 */
function hasWhiteLabel(org) {
    const limits = getOrgLimits(org);
    return limits.white_label === true;
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
    window.canUseIntelligence = canUseIntelligence;
    window.canUseIntelligenceSync = canUseIntelligenceSync;
    window.hasWhiteLabel = hasWhiteLabel;

    // Create PlanLimits namespace for crown-dashboard.js compatibility
    window.PlanLimits = {
        PLANS: {
            free: PLAN_LIMITS.free,
            starter: PLAN_LIMITS.subscription.starter,
            growth: PLAN_LIMITS.subscription.growth,
            scale: PLAN_LIMITS.subscription.scale,
            subscription: PLAN_LIMITS.subscription
        },
        canUseIntelligence: canUseIntelligence,
        getOrgLimits: getOrgLimits,
        checkLimit: checkLimit,
        formatLimit: formatLimit
    };
}
