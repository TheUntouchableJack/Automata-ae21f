// ===== Shared Utilities Module =====
// Centralized functions used across multiple pages
// Eliminates code duplication and ensures consistency

const AppUtils = (function() {
    'use strict';

    // =========================================
    // ORGANIZATION LOADING
    // =========================================

    /**
     * Load the current user's organization
     * @param {object} supabase - Supabase client instance
     * @param {string} userId - Current user's ID
     * @returns {Promise<{organization: object|null, role: string|null, limits: object|null}>}
     */
    async function loadOrganization(supabase, userId) {
        try {
            // Get the membership
            const { data: memberships, error: memberError } = await supabase
                .from('organization_members')
                .select('organization_id, role')
                .eq('user_id', userId)
                .limit(1);

            if (memberError) throw memberError;

            if (!memberships || memberships.length === 0) {
                console.error('No organization membership found');
                return { organization: null, role: null, limits: null };
            }

            // Get the organization details including plan info
            const { data: org, error: orgError } = await supabase
                .from('organizations')
                .select('id, name, slug, plan_type, appsumo_tier, subscription_tier, plan_limits_override')
                .eq('id', memberships[0].organization_id)
                .single();

            if (orgError) throw orgError;

            // Get plan limits if available
            let limits = null;
            if (typeof getOrgLimits === 'function') {
                limits = getOrgLimits(org);
            }

            // Set admin bypass for rate limits and plan limits
            const isAdminRole = memberships[0].role === 'admin' || memberships[0].role === 'owner';
            if (typeof RateLimiter !== 'undefined' && typeof RateLimiter.setAdminStatus === 'function') {
                RateLimiter.setAdminStatus(isAdminRole);
            }
            if (typeof setPlanAdminStatus === 'function') {
                setPlanAdminStatus(isAdminRole);
            }

            return {
                organization: org,
                role: memberships[0].role,
                limits
            };
        } catch (error) {
            console.error('Error loading organization:', error);
            return { organization: null, role: null, limits: null };
        }
    }


    // =========================================
    // USER INFO
    // =========================================

    /**
     * Load user profile and construct display name
     * @param {string} userId - User's ID
     * @param {string} email - User's email (fallback for name)
     * @returns {Promise<{profile: object|null, fullName: string, initials: string}>}
     */
    async function loadUserInfo(userId, email) {
        const profile = await getUserProfile(userId);

        let fullName = '';
        let initials = '?';

        if (profile && (profile.first_name || profile.last_name)) {
            fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
            initials = getInitials(profile.first_name, profile.last_name);
        } else {
            fullName = email.split('@')[0];
            initials = fullName.substring(0, 2).toUpperCase();
        }

        return { profile, fullName, initials };
    }

    /**
     * Get initials from first and last name
     * @param {string} firstName
     * @param {string} lastName
     * @returns {string} Two-character initials
     */
    function getInitials(firstName, lastName) {
        if (firstName && lastName) {
            return (firstName[0] + lastName[0]).toUpperCase();
        } else if (firstName) {
            return firstName.substring(0, 2).toUpperCase();
        } else if (lastName) {
            return lastName.substring(0, 2).toUpperCase();
        }
        return '?';
    }


    // =========================================
    // HTML ESCAPING (XSS Prevention)
    // =========================================

    /**
     * Escape HTML entities to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped HTML string
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


    // =========================================
    // DEBOUNCE / THROTTLE
    // =========================================

    /**
     * Debounce function - delays execution until after wait ms have elapsed since last call
     * @param {Function} func - Function to debounce
     * @param {number} wait - Milliseconds to wait
     * @returns {Function} Debounced function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle function - ensures function is called at most once per wait ms
     * @param {Function} func - Function to throttle
     * @param {number} wait - Minimum ms between calls
     * @returns {Function} Throttled function
     */
    function throttle(func, wait) {
        let lastTime = 0;
        return function executedFunction(...args) {
            const now = Date.now();
            if (now - lastTime >= wait) {
                lastTime = now;
                func.apply(this, args);
            }
        };
    }


    // =========================================
    // EVENT DELEGATION
    // =========================================

    /**
     * Set up event delegation on a parent element
     * @param {string|Element} parent - Parent element or selector
     * @param {string} eventType - Event type (e.g., 'click')
     * @param {string} childSelector - CSS selector for target children
     * @param {Function} handler - Event handler function(event, matchedElement)
     * @returns {Function} Cleanup function to remove listener
     */
    function delegate(parent, eventType, childSelector, handler) {
        const parentEl = typeof parent === 'string'
            ? document.querySelector(parent)
            : parent;

        if (!parentEl) {
            console.warn(`Delegate: Parent element not found: ${parent}`);
            return () => {};
        }

        const listener = (event) => {
            const targetEl = event.target.closest(childSelector);
            if (targetEl && parentEl.contains(targetEl)) {
                handler(event, targetEl);
            }
        };

        parentEl.addEventListener(eventType, listener);

        // Return cleanup function
        return () => parentEl.removeEventListener(eventType, listener);
    }


    // =========================================
    // USAGE CALCULATIONS (OPTIMIZED)
    // =========================================

    /**
     * Get organization usage counts using optimized RPC
     * Falls back to manual calculation if RPC not available
     * @param {object} supabase - Supabase client
     * @param {string} organizationId - Organization UUID
     * @returns {Promise<{projects_count: number, automations_count: number, customers_count: number}>}
     */
    async function getUsageCounts(supabase, organizationId) {
        try {
            // Try optimized RPC first
            const { data, error } = await supabase
                .rpc('get_org_usage_counts', { p_organization_id: organizationId });

            if (!error && data && data.length > 0) {
                return {
                    projects_count: Number(data[0].projects_count) || 0,
                    automations_count: Number(data[0].automations_count) || 0,
                    customers_count: Number(data[0].customers_count) || 0
                };
            }
        } catch (e) {
            console.log('get_org_usage_counts not available, using fallback');
        }

        // Fallback: Use parallel queries instead of sequential
        const [projectsResult, customersResult] = await Promise.all([
            supabase
                .from('projects')
                .select('id', { count: 'exact' })
                .eq('organization_id', organizationId)
                .is('deleted_at', null),
            supabase
                .from('customers')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
        ]);

        const projectIds = projectsResult.data?.map(p => p.id) || [];
        let automationsCount = 0;

        if (projectIds.length > 0) {
            const { count } = await supabase
                .from('automations')
                .select('*', { count: 'exact', head: true })
                .in('project_id', projectIds)
                .is('deleted_at', null);
            automationsCount = count || 0;
        }

        return {
            projects_count: projectsResult.count || 0,
            automations_count: automationsCount,
            customers_count: customersResult.count || 0
        };
    }


    // =========================================
    // CUSTOMER TAGS (OPTIMIZED)
    // =========================================

    /**
     * Get unique customer tags for organization using optimized RPC
     * @param {object} supabase - Supabase client
     * @param {string} organizationId - Organization UUID
     * @returns {Promise<string[]>} Array of unique tags
     */
    async function getUniqueTags(supabase, organizationId) {
        try {
            // Try optimized RPC first
            const { data, error } = await supabase
                .rpc('get_unique_customer_tags', { p_organization_id: organizationId });

            if (!error && data) {
                return data;
            }
        } catch (e) {
            console.log('get_unique_customer_tags not available, using fallback');
        }

        // Fallback: Fetch tags with limit
        const { data: customers } = await supabase
            .from('customers')
            .select('tags')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .not('tags', 'is', null)
            .limit(500);

        const allTags = new Set();
        customers?.forEach(c => {
            c.tags?.forEach(tag => allTags.add(tag));
        });

        return Array.from(allTags).sort();
    }


    // =========================================
    // CUSTOMER STATS (OPTIMIZED)
    // =========================================

    /**
     * Get customer statistics using optimized RPC
     * @param {object} supabase - Supabase client
     * @param {string} organizationId - Organization UUID
     * @returns {Promise<{total: number, newThisMonth: number, withEmail: number, withPhone: number}>}
     */
    async function getCustomerStats(supabase, organizationId) {
        try {
            // Try optimized RPC first
            const { data, error } = await supabase
                .rpc('get_customer_stats', { p_organization_id: organizationId });

            if (!error && data && data.length > 0) {
                return {
                    total: Number(data[0].total_count) || 0,
                    newThisMonth: Number(data[0].new_this_month) || 0,
                    withEmail: Number(data[0].with_email) || 0,
                    withPhone: Number(data[0].with_phone) || 0
                };
            }
        } catch (e) {
            console.log('get_customer_stats not available, using fallback');
        }

        // Fallback: Use parallel queries
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [totalResult, newResult, emailResult] = await Promise.all([
            supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null),
            supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
                .gte('created_at', startOfMonth.toISOString()),
            supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
                .not('email', 'is', null)
                .neq('email', '')
        ]);

        return {
            total: totalResult.count || 0,
            newThisMonth: newResult.count || 0,
            withEmail: emailResult.count || 0,
            withPhone: 0 // Skip this to reduce queries
        };
    }


    // =========================================
    // BATCH UPDATES (N+1 FIX)
    // =========================================

    /**
     * Batch update customers using optimized RPC
     * @param {object} supabase - Supabase client
     * @param {Array} updates - Array of customer update objects
     * @returns {Promise<{success: boolean, count: number, error?: string}>}
     */
    async function batchUpdateCustomers(supabase, updates) {
        if (!updates || updates.length === 0) {
            return { success: true, count: 0 };
        }

        try {
            // Try optimized RPC first
            const { data, error } = await supabase
                .rpc('batch_update_customers', { p_updates: updates });

            if (!error) {
                return { success: true, count: data || updates.length };
            }
        } catch (e) {
            console.log('batch_update_customers not available, using fallback');
        }

        // Fallback: Batch in chunks of 50 using upsert
        const chunkSize = 50;
        let updatedCount = 0;

        for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);

            // Process chunk with Promise.all for better performance
            await Promise.all(chunk.map(async (update) => {
                const { id, organization_id, source, ...updateData } = update;
                const { error } = await supabase
                    .from('customers')
                    .update(updateData)
                    .eq('id', id);

                if (!error) updatedCount++;
            }));
        }

        return { success: true, count: updatedCount };
    }


    // =========================================
    // FORMAT HELPERS
    // =========================================

    /**
     * Format a date for display
     * @param {string|Date} date - Date to format
     * @param {object} options - Intl.DateTimeFormat options
     * @returns {string} Formatted date string
     */
    function formatDate(date, options = { month: 'short', day: 'numeric' }) {
        if (!date) return '';
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', options);
    }

    /**
     * Format a number with locale-appropriate separators
     * @param {number} num - Number to format
     * @returns {string} Formatted number string
     */
    function formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return num.toLocaleString();
    }

    /**
     * Truncate text with ellipsis
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    function truncate(text, maxLength = 100) {
        if (!text || text.length <= maxLength) return text || '';
        return text.substring(0, maxLength - 3) + '...';
    }


    // =========================================
    // TOAST NOTIFICATIONS
    // =========================================

    let _toastStylesInjected = false;

    function _injectToastStyles() {
        if (_toastStylesInjected) return;
        _toastStylesInjected = true;

        const style = document.createElement('style');
        style.textContent = `
            .app-toast-container {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10000;
                display: flex;
                flex-direction: column-reverse;
                gap: 8px;
                pointer-events: none;
            }

            .app-toast {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 18px;
                background: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
                color: #f1f5f9;
                font-size: 14px;
                font-weight: 500;
                pointer-events: auto;
                animation: toastSlideIn 0.25s ease-out;
                max-width: 400px;
            }

            .app-toast.hiding {
                animation: toastSlideOut 0.2s ease-in forwards;
            }

            .app-toast.success {
                border-color: rgba(16, 185, 129, 0.3);
            }

            .app-toast.error {
                border-color: rgba(239, 68, 68, 0.3);
            }

            .app-toast__icon {
                flex-shrink: 0;
                width: 20px;
                height: 20px;
            }

            .app-toast.success .app-toast__icon {
                color: #10b981;
            }

            .app-toast.error .app-toast__icon {
                color: #ef4444;
            }

            @keyframes toastSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes toastSlideOut {
                from {
                    opacity: 1;
                    transform: translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateY(10px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    function _getOrCreateToastContainer() {
        let container = document.querySelector('.app-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'app-toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - 'success' | 'error' | 'info' (default: 'info')
     * @param {number} duration - Duration in ms (default: 3000)
     */
    function showToast(message, type = 'info', duration = 3000) {
        _injectToastStyles();
        const container = _getOrCreateToastContainer();

        const toast = document.createElement('div');
        toast.className = `app-toast ${type}`;

        const icons = {
            success: `<svg class="app-toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>`,
            error: `<svg class="app-toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>`,
            info: `<svg class="app-toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>`
        };

        toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);

        // Auto dismiss
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
                toast.remove();
                // Clean up container if empty
                if (container.children.length === 0) {
                    container.remove();
                }
            }, 200);
        }, duration);
    }


    // =========================================
    // PUBLIC API
    // =========================================

    return {
        // Organization
        loadOrganization,

        // User info
        loadUserInfo,
        getInitials,

        // HTML/Security
        escapeHtml,

        // Performance
        debounce,
        throttle,
        delegate,

        // Optimized data fetching
        getUsageCounts,
        getUniqueTags,
        getCustomerStats,
        batchUpdateCustomers,

        // Formatting
        formatDate,
        formatNumber,
        truncate,

        // Notifications
        showToast
    };
})();

// Make available globally
window.AppUtils = AppUtils;

// Global showToast shortcut for convenience
window.showToast = AppUtils.showToast;
