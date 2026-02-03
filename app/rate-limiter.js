/**
 * Rate Limiter Utility
 * Client-side rate limiting with localStorage fallback and Supabase sync
 */

// Rate limit configurations per action type
const RATE_LIMITS = {
    feature_request: { maxRequests: 3, windowMinutes: 60 },    // 3 per hour
    waitlist: { maxRequests: 2, windowMinutes: 60 },           // 2 per hour
    ai_analysis: { maxRequests: 10, windowMinutes: 60 },       // 10 per hour
    business_analysis: { maxRequests: 5, windowMinutes: 60 },  // 5 per hour
    vote: { maxRequests: 30, windowMinutes: 60 },              // 30 per hour
    support_ticket: { maxRequests: 10, windowMinutes: 60 },    // 10 tickets per hour
    support_reply: { maxRequests: 30, windowMinutes: 60 },     // 30 replies per hour
    ai_support_chat: { maxRequests: 50, windowMinutes: 60 }    // 50 AI messages per hour
};

// Admin bypass - admins skip rate limits
let _isAdminUser = false;

/**
 * Set admin status for rate limit bypass
 * @param {boolean} isAdmin - Whether the current user is an admin
 */
function setAdminStatus(isAdmin) {
    _isAdminUser = isAdmin === true;
}

/**
 * Check if current user is admin (bypasses rate limits)
 * @returns {boolean}
 */
function isAdmin() {
    return _isAdminUser;
}

// Get or create a session identifier for rate limiting
function getRateLimitIdentifier() {
    let identifier = localStorage.getItem('rate_limit_session');
    if (!identifier) {
        identifier = 'session_' + crypto.randomUUID();
        localStorage.setItem('rate_limit_session', identifier);
    }
    return identifier;
}

// Get timestamps from localStorage for a specific action
function getLocalRateLimitTimestamps(actionType) {
    const key = `rate_limit_${actionType}`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];

    try {
        return JSON.parse(stored);
    } catch {
        return [];
    }
}

// Save timestamps to localStorage
function setLocalRateLimitTimestamps(actionType, timestamps) {
    const key = `rate_limit_${actionType}`;
    localStorage.setItem(key, JSON.stringify(timestamps));
}

// Clean up old timestamps (older than window)
function cleanupTimestamps(timestamps, windowMinutes) {
    const cutoff = Date.now() - (windowMinutes * 60 * 1000);
    return timestamps.filter(ts => ts > cutoff);
}

/**
 * Check if an action is rate limited (client-side only)
 * @param {string} actionType - The action type to check
 * @returns {boolean} - True if rate limited, false if allowed
 */
function isRateLimited(actionType) {
    // Admins bypass rate limits
    if (_isAdminUser) {
        return false;
    }

    const config = RATE_LIMITS[actionType];
    if (!config) {
        console.warn(`Unknown action type: ${actionType}`);
        return false;
    }

    const timestamps = getLocalRateLimitTimestamps(actionType);
    const cleaned = cleanupTimestamps(timestamps, config.windowMinutes);

    // Update storage with cleaned timestamps
    setLocalRateLimitTimestamps(actionType, cleaned);

    return cleaned.length >= config.maxRequests;
}

/**
 * Record a rate limit attempt (client-side only)
 * @param {string} actionType - The action type to record
 */
function recordRateLimit(actionType) {
    const config = RATE_LIMITS[actionType];
    if (!config) return;

    const timestamps = getLocalRateLimitTimestamps(actionType);
    const cleaned = cleanupTimestamps(timestamps, config.windowMinutes);
    cleaned.push(Date.now());
    setLocalRateLimitTimestamps(actionType, cleaned);
}

/**
 * Check and record rate limit in one call
 * @param {string} actionType - The action type
 * @returns {boolean} - True if allowed, false if rate limited
 */
function checkAndRecordRateLimit(actionType) {
    if (isRateLimited(actionType)) {
        return false;
    }
    recordRateLimit(actionType);
    return true;
}

/**
 * Check rate limit using Supabase (server-side verification)
 * Falls back to client-side if Supabase is unavailable
 * @param {object} supabase - Supabase client instance
 * @param {string} actionType - The action type to check
 * @returns {Promise<boolean>} - True if allowed, false if rate limited
 */
async function checkRateLimitWithSupabase(supabase, actionType) {
    // Admins bypass rate limits
    if (_isAdminUser) {
        return true;
    }

    const config = RATE_LIMITS[actionType];
    if (!config) {
        console.warn(`Unknown action type: ${actionType}`);
        return true;
    }

    const identifier = getRateLimitIdentifier();

    try {
        // Call the Supabase function to check and record
        const { data, error } = await supabase.rpc('check_and_record_rate_limit', {
            p_identifier: identifier,
            p_action_type: actionType,
            p_max_requests: config.maxRequests,
            p_window_minutes: config.windowMinutes
        });

        if (error) {
            console.warn('Rate limit check failed, falling back to client-side:', error);
            return checkAndRecordRateLimit(actionType);
        }

        // Sync with client-side storage
        if (data) {
            recordRateLimit(actionType);
        }

        return data; // true = allowed, false = rate limited
    } catch (err) {
        console.warn('Rate limit check error, falling back to client-side:', err);
        return checkAndRecordRateLimit(actionType);
    }
}

/**
 * Get remaining requests for an action
 * @param {string} actionType - The action type
 * @returns {number} - Number of remaining requests in current window
 */
function getRemainingRequests(actionType) {
    const config = RATE_LIMITS[actionType];
    if (!config) return 0;

    const timestamps = getLocalRateLimitTimestamps(actionType);
    const cleaned = cleanupTimestamps(timestamps, config.windowMinutes);

    return Math.max(0, config.maxRequests - cleaned.length);
}

/**
 * Get time until rate limit resets
 * @param {string} actionType - The action type
 * @returns {number} - Milliseconds until oldest request expires, or 0 if not limited
 */
function getTimeUntilReset(actionType) {
    const config = RATE_LIMITS[actionType];
    if (!config) return 0;

    const timestamps = getLocalRateLimitTimestamps(actionType);
    const cleaned = cleanupTimestamps(timestamps, config.windowMinutes);

    if (cleaned.length < config.maxRequests) return 0;

    const oldestTimestamp = Math.min(...cleaned);
    const expiresAt = oldestTimestamp + (config.windowMinutes * 60 * 1000);
    return Math.max(0, expiresAt - Date.now());
}

/**
 * Format time until reset as human-readable string
 * @param {string} actionType - The action type
 * @returns {string} - Formatted time string (e.g., "5 minutes")
 */
function getFormattedTimeUntilReset(actionType) {
    const ms = getTimeUntilReset(actionType);
    if (ms <= 0) return '';

    const minutes = Math.ceil(ms / 60000);
    if (minutes === 1) return '1 minute';
    return `${minutes} minutes`;
}

/**
 * Show rate limit error message to user
 * @param {string} actionType - The action type
 * @param {string} customMessage - Optional custom message
 * @returns {string} - Error message to display
 */
function getRateLimitErrorMessage(actionType, customMessage) {
    const timeUntil = getFormattedTimeUntilReset(actionType);
    const config = RATE_LIMITS[actionType];

    if (customMessage) {
        return customMessage.replace('{time}', timeUntil);
    }

    const actionNames = {
        feature_request: 'feature requests',
        waitlist: 'waitlist signups',
        ai_analysis: 'AI analyses',
        business_analysis: 'business analyses',
        vote: 'votes'
    };

    const actionName = actionNames[actionType] || 'requests';
    return `Too many ${actionName}. Please try again in ${timeUntil}.`;
}

/**
 * Get warning message when approaching rate limit
 * @param {string} actionType - The action type
 * @returns {string|null} - Warning message or null if not near limit
 */
function getRateLimitWarning(actionType) {
    const remaining = getRemainingRequests(actionType);
    const config = RATE_LIMITS[actionType];

    if (!config) return null;

    // Only warn when at 1 or 2 remaining
    if (remaining > 2) return null;

    const actionNames = {
        feature_request: 'feature request',
        waitlist: 'signup attempt',
        ai_analysis: 'AI analysis',
        business_analysis: 'analysis',
        vote: 'vote'
    };

    const actionName = actionNames[actionType] || 'request';

    if (remaining === 0) {
        return `You've reached the limit for ${actionName}s this hour.`;
    } else if (remaining === 1) {
        return `You have 1 ${actionName} remaining this hour.`;
    } else {
        return `You have ${remaining} ${actionName}s remaining this hour.`;
    }
}

/**
 * Check if user should see a warning (approaching limit)
 * @param {string} actionType - The action type
 * @returns {boolean} - True if warning should be shown
 */
function shouldShowWarning(actionType) {
    const remaining = getRemainingRequests(actionType);
    return remaining <= 2;
}

/**
 * Get status info for UI display
 * @param {string} actionType - The action type
 * @returns {object} - Status object with remaining, total, warning, isLimited
 */
function getRateLimitStatus(actionType) {
    const config = RATE_LIMITS[actionType];
    if (!config) return null;

    const remaining = getRemainingRequests(actionType);
    const isLimited = remaining === 0;
    const warning = getRateLimitWarning(actionType);

    return {
        remaining,
        total: config.maxRequests,
        windowMinutes: config.windowMinutes,
        isLimited,
        warning,
        timeUntilReset: isLimited ? getFormattedTimeUntilReset(actionType) : null
    };
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.RateLimiter = {
        isRateLimited,
        recordRateLimit,
        checkAndRecordRateLimit,
        checkRateLimitWithSupabase,
        getRemainingRequests,
        getTimeUntilReset,
        getFormattedTimeUntilReset,
        getRateLimitErrorMessage,
        getRateLimitWarning,
        shouldShowWarning,
        getRateLimitStatus,
        setAdminStatus,
        isAdmin,
        RATE_LIMITS
    };
}
