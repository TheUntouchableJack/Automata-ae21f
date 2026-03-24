/**
 * App Sidebar Component
 * Supabase-inspired collapsible navigation
 */

const AppSidebar = (function() {
    let userDropdownOpen = false;
    let mobileOpen = false;

    // Notification badge count (updated async)
    let notificationCount = 0;

    // Navigation items configuration
    // adminOnly: true = only visible to admin/owner users
    // smbOnly: true = only visible to non-admin users (SMB view)
    const navItems = [
        {
            section: 'main',
            items: [
                // Intelligence - AI brain, visible to all (default landing)
                { id: 'intelligence', icon: 'brain', href: '/app/intelligence.html', labelKey: 'nav.intelligence', label: 'Intelligence' },
                // Application - app metrics & growth data
                { id: 'dashboard', icon: 'layout', href: '/app/dashboard.html', labelKey: 'nav.dashboard', label: 'Application' },
                // Rewards - manage loyalty rewards (elevated — daily-use feature)
                { id: 'rewards', icon: 'gift', href: '/app/rewards.html', labelKey: 'nav.rewards', label: 'Rewards' },
                // Apps - admin only (SMB users manage their single program)
                { id: 'apps', icon: 'smartphone', href: '/app/apps.html', labelKey: 'nav.apps', label: 'Apps', adminOnly: true },
                // Automations - visible to all
                { id: 'automations', icon: 'zap', href: '/app/automations.html', labelKey: 'nav.automations', label: 'Automations' },
                // Campaigns - output of automations, visible to all
                { id: 'campaigns', icon: 'send', href: '/app/outgoing.html', labelKey: 'nav.campaigns', label: 'Campaigns' },
                // Customers - visible to all
                { id: 'customers', icon: 'users', href: '/app/customers.html', labelKey: 'nav.customers', label: 'Customers' },
            ]
        },
        {
            section: 'management',
            labelKey: 'nav.management',
            label: 'Management',
            items: [
                // Roadmap visible to ALL users - customers can give feedback!
                { id: 'roadmap', icon: 'map', href: '/app/roadmap.html', labelKey: 'nav.roadmap', label: 'Roadmap' },
                // Support - manage customer tickets, FAQs, and AI support (with notification badge)
                { id: 'support', icon: 'headset', href: '/app/support.html', labelKey: 'nav.support', label: 'Support', hasBadge: true },
            ]
        },
        {
            section: 'system',
            labelKey: 'nav.system',
            label: 'System',
            items: [
                { id: 'settings', icon: 'settings', href: '/app/settings.html', labelKey: 'nav.settings', label: 'Settings' },
            ]
        },
        {
            section: 'admin',
            labelKey: 'nav.admin',
            label: 'Admin',
            adminOnly: true,
            items: [
                { id: 'ceo', icon: 'userTie', href: '/app/ceo.html', labelKey: 'nav.ceo', label: 'CEO', adminOnly: true },
                { id: 'blog-review', icon: 'globe', href: '/app/blog-review.html', labelKey: 'nav.blog', label: 'Blog', adminOnly: true, highlight: true, hasBadge: true },
                { id: 'launch-plan', icon: 'rocket', href: '/app/launch-plan.html', labelKey: 'nav.launchPlan', label: 'Launch Plan', adminOnly: true },
                { id: 'admin-panel', icon: 'shield', href: '/app/admin.html', labelKey: 'nav.superAdmin', label: 'Super Admin', adminOnly: true },
            ]
        }
    ];

    // SVG Icons
    const icons = {
        home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>`,
        folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>`,
        zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>`,
        users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>`,
        send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>`,
        map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
            <line x1="8" y1="2" x2="8" y2="18"></line>
            <line x1="16" y1="6" x2="16" y2="22"></line>
        </svg>`,
        settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>`,
        signOut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>`,
        chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>`,
        menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>`,
        messageCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>`,
        chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
        </svg>`,
        x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>`,
        user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
        </svg>`,
        globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>`,
        smartphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>`,
        rocket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
        </svg>`,
        brain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
            <path d="M12 2a10 10 0 0 1 10 10"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>`,
        headset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z"></path>
            <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"></path>
        </svg>`,
        layout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>`,
        edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>`,
        shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>`,
        gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 12 20 22 4 22 4 12"></polyline>
            <rect x="2" y="7" width="20" height="5"></rect>
            <line x1="12" y1="22" x2="12" y2="7"></line>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
        </svg>`,
        trendingUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
            <polyline points="17 6 23 6 23 12"></polyline>
        </svg>`,
        userTie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="7" r="4"/>
            <path d="M5.5 21a8.38 8.38 0 0 1 13 0"/>
            <polyline points="11 12 12 16 13 12"/>
        </svg>`
    };

    // Helper to get translation
    function getText(key, fallback) {
        if (typeof t === 'function') {
            return t(key, fallback);
        }
        return fallback;
    }

    // Get current page ID from URL
    function getCurrentPageId(isAdmin) {
        const path = window.location.pathname;
        if (path.includes('ceo')) return 'ceo';
        if (path.includes('blog-review')) return 'blog-review';
        // Dashboard page - always highlight 'dashboard' nav item
        if (path.includes('dashboard')) return 'dashboard';
        if (path.includes('project.html')) return 'dashboard'; // Individual project pages
        if (path.includes('intelligence')) return 'intelligence';
        if (path.includes('automations.html')) return 'automations';
        if (path.includes('automation.html')) return 'automations';
        if (path.includes('apps.html')) return 'apps';
        if (path.includes('app-builder.html')) return 'apps';
        if (path.includes('customers')) return 'customers';
        if (path.includes('rewards')) return 'rewards';
        if (path.includes('outgoing')) return 'campaigns';
        if (path.includes('roadmap')) return 'roadmap';
        if (path.includes('settings')) return 'settings';
        if (path.includes('launch-plan')) return 'launch-plan';
        if (path.includes('content-generator')) return 'content-generator';
        if (path.includes('admin.html')) return 'admin-panel';
        return 'dashboard';
    }

    // Get user initials
    function getUserInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    // Render sidebar HTML
    function render(container, userData = {}) {
        const userName = userData.name || userData.full_name || 'User';
        const userEmail = userData.email || '';
        const userInitials = getUserInitials(userName);
        const orgName = userData.organization?.name || 'My Organization';
        const orgInitial = orgName.charAt(0).toUpperCase();
        const userRole = userData.role || '';

        // Check if user is a super admin (is_admin flag in profiles table)
        const isSuperAdmin = userData.isAdmin === true;

        // Check advanced mode from userData (priority) or localStorage (fallback)
        // SMB users should see simplified view unless they enable Advanced Mode
        const advancedModeFromStorage = localStorage.getItem('advancedMode') === 'true';
        const isAdvanced = userData.advancedMode !== undefined ? userData.advancedMode : advancedModeFromStorage;

        // Show admin items if: super admin OR advanced mode is enabled
        const showAdminItems = isSuperAdmin || isAdvanced;
        const currentPage = getCurrentPageId(showAdminItems);

        let navHTML = '';

        navItems.forEach((section, sectionIndex) => {
            // Skip admin-only sections if advanced mode is not enabled
            if (section.adminOnly && !showAdminItems) {
                return;
            }

            // Section label (for non-main sections)
            if (section.label && section.section !== 'main') {
                navHTML += `<div class="sidebar-section-label" data-i18n="${section.labelKey}">${getText(section.labelKey, section.label)}</div>`;
            }

            // Section items
            section.items.forEach(item => {
                // Skip admin-only items if advanced mode is not enabled
                if (item.adminOnly && !showAdminItems) {
                    return;
                }

                // Determine if this item is active
                const isActive = item.id === currentPage;

                // Add notification badge if this item supports it
                // Shows as dot when collapsed, number when expanded
                const badgeHTML = item.hasBadge
                    ? `<span class="sidebar-item-badge" id="sidebar-badge-${item.id}" style="display: none;">0</span>
                       <span class="sidebar-item-badge-dot" id="sidebar-badge-dot-${item.id}" style="display: none;"></span>`
                    : '';

                navHTML += `
                    <a href="${item.href}"
                       class="sidebar-item ${isActive ? 'active sidebar-item--highlight' : ''} ${!isActive && item.highlight ? 'sidebar-item--badge-hint' : ''}"
                       data-nav="${item.id}"
                       data-tooltip="${getText(item.labelKey, item.label)}">
                        <span class="sidebar-item-icon">${icons[item.icon]}</span>
                        <span class="sidebar-item-text" data-i18n="${item.labelKey}">${getText(item.labelKey, item.label)}</span>
                        ${badgeHTML}
                    </a>
                `;
            });

            // Add divider after main section
            if (section.section === 'main') {
                navHTML += '<div class="sidebar-divider"></div>';
            }
        });

        const sidebarHTML = `
            <!-- Mobile Header -->
            <div class="mobile-header">
                <button class="mobile-menu-toggle" id="mobile-menu-toggle">
                    ${icons.menu}
                </button>
                <img src="/logo.svg" alt="Royalty" class="sidebar-logo" style="width:28px;height:28px;">
                <div class="sidebar-logo-text" style="opacity: 1; margin-left: 8px;">Royalty</div>
            </div>

            <!-- Sidebar Overlay (mobile) -->
            <div class="sidebar-overlay" id="sidebar-overlay"></div>

            <!-- Sidebar -->
            <aside class="app-sidebar" id="app-sidebar">
                <!-- Logo -->
                <div class="sidebar-header">
                    <img src="/logo.svg" alt="Royalty" class="sidebar-logo">
                    <span class="sidebar-logo-text">Royalty</span>
                </div>

                <!-- Organization Selector -->
                <a href="/app/organization.html" class="sidebar-org" id="sidebar-org" title="Manage Organization">
                    <div class="sidebar-org-avatar">${orgInitial}</div>
                    <div class="sidebar-org-info">
                        <div class="sidebar-org-name">${escapeHtml(orgName)}</div>
                        <div class="sidebar-org-plan">Free Plan</div>
                    </div>
                </a>

                <!-- Navigation -->
                <nav class="sidebar-nav">
                    <div class="sidebar-section">
                        ${navHTML}
                    </div>
                </nav>

                <!-- Footer -->
                <div class="sidebar-footer">
                    <!-- Language Selector -->
                    <div class="sidebar-lang">
                        <button class="sidebar-lang-btn" id="sidebar-lang-btn">
                            ${icons.globe}
                            <span id="sidebar-lang-code">EN</span>
                        </button>
                        <div class="sidebar-lang-dropdown" id="sidebar-lang-dropdown">
                            <a href="#" class="lang-option" data-lang="en">EN</a>
                            <a href="#" class="lang-option" data-lang="es">ES</a>
                            <a href="#" class="lang-option" data-lang="fr">FR</a>
                            <a href="#" class="lang-option" data-lang="de">DE</a>
                            <a href="#" class="lang-option" data-lang="it">IT</a>
                            <a href="#" class="lang-option" data-lang="pt">PT</a>
                            <a href="#" class="lang-option" data-lang="zh">ZH</a>
                            <a href="#" class="lang-option" data-lang="ar">AR</a>
                        </div>
                    </div>

                    <!-- User Profile (clickable to expand) -->
                    <div class="sidebar-user" id="sidebar-user">
                        <div class="sidebar-user-avatar">${userInitials}</div>
                        <div class="sidebar-user-info">
                            <div class="sidebar-user-name">${escapeHtml(userName)}</div>
                            <div class="sidebar-user-email">${escapeHtml(userEmail)}</div>
                        </div>
                    </div>

                    <!-- Dedicated Logout Button (always visible) -->
                    <button class="sidebar-logout-btn" id="sidebar-signout" title="Sign Out">
                        ${icons.signOut}
                        <span class="sidebar-logout-text" data-i18n="nav.signOut">${getText('nav.signOut', 'Sign Out')}</span>
                    </button>
                </div>
            </aside>
        `;

        // Remove existing sidebar elements if re-rendering (e.g., when called again with user data)
        const existingSidebar = container.querySelector('.app-sidebar');
        const existingOverlay = container.querySelector('.sidebar-overlay');
        const existingMobileHeader = container.querySelector('.mobile-header');
        if (existingSidebar) existingSidebar.remove();
        if (existingOverlay) existingOverlay.remove();
        if (existingMobileHeader) existingMobileHeader.remove();

        container.insertAdjacentHTML('afterbegin', sidebarHTML);
        attachEventListeners();
    }

    // Escape HTML helper - delegates to AppUtils
    function escapeHtml(text) {
        if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
            return AppUtils.escapeHtml(text);
        }
        // Fallback for safety
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // Attach event listeners
    function attachEventListeners() {
        // User dropdown toggle
        const userBtn = document.getElementById('sidebar-user');
        if (userBtn) {
            userBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                userBtn.classList.toggle('active');
                userDropdownOpen = !userDropdownOpen;
            });
        }

        // Sign out
        const signOutBtn = document.getElementById('sidebar-signout');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof signOut === 'function') {
                    await signOut();
                } else if (typeof supabase !== 'undefined') {
                    await supabase.auth.signOut();
                    window.location.href = '/index.html';
                }
            });
        }

        // Mobile menu toggle
        const mobileToggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.getElementById('app-sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        if (mobileToggle && sidebar) {
            mobileToggle.addEventListener('click', () => {
                mobileOpen = !mobileOpen;
                sidebar.classList.toggle('mobile-open', mobileOpen);
                overlay?.classList.toggle('active', mobileOpen);
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                mobileOpen = false;
                sidebar?.classList.remove('mobile-open');
                overlay.classList.remove('active');
            });
        }

        // Language selector integration
        const langBtn = document.getElementById('sidebar-lang-btn');
        const langDropdown = document.getElementById('sidebar-lang-dropdown');
        if (langBtn && langDropdown) {
            langBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                langDropdown.classList.toggle('active');
            });

            // Handle language option clicks
            langDropdown.querySelectorAll('.lang-option').forEach(option => {
                option.addEventListener('click', (e) => {
                    e.preventDefault();
                    const lang = option.dataset.lang;
                    if (lang && typeof I18n !== 'undefined') {
                        I18n.setLanguage(lang);
                        updateLanguageDisplay();
                        langDropdown.classList.remove('active');
                    }
                });
            });

            // Update language code display
            updateLanguageDisplay();
        }

        // Close dropdowns on outside click
        document.addEventListener('click', () => {
            const userBtn = document.getElementById('sidebar-user');
            if (userBtn && userDropdownOpen) {
                userBtn.classList.remove('active');
                userDropdownOpen = false;
            }
            // Close language dropdown
            const langDropdown = document.getElementById('sidebar-lang-dropdown');
            if (langDropdown) {
                langDropdown.classList.remove('active');
            }
        });

    }

    // Update blog review badge (admin only)
    async function updateBlogReviewBadge() {
        if (typeof supabase === 'undefined') return;

        try {
            const { data, error } = await supabase.rpc('get_blog_review_count');
            if (error) return;

            const count = data || 0;
            const badge = document.getElementById('sidebar-badge-blog-review');
            const badgeDot = document.getElementById('sidebar-badge-dot-blog-review');

            if (badge) {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
            if (badgeDot) {
                badgeDot.style.display = count > 0 ? 'block' : 'none';
            }
        } catch (err) {
            // Non-admin users will get an error — silently ignore
        }
    }

    // Poll blog review badge (admin only, 60s interval)
    function startBlogReviewPolling(intervalMs = 60000) {
        updateBlogReviewBadge();
        setInterval(updateBlogReviewBadge, intervalMs);
    }

    // Update notification badge
    async function updateNotificationBadge(organizationId) {
        if (!organizationId || typeof supabase === 'undefined') return;

        try {
            const { data, error } = await supabase.rpc('get_unread_notification_count', {
                p_organization_id: organizationId
            });

            if (error) {
                console.warn('Failed to fetch notification count:', error);
                return;
            }

            notificationCount = data || 0;

            // Update the support badge (expanded view)
            const badge = document.getElementById('sidebar-badge-support');
            const badgeDot = document.getElementById('sidebar-badge-dot-support');

            if (badge) {
                if (notificationCount > 0) {
                    badge.textContent = notificationCount > 99 ? '99+' : notificationCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }

            // Update the dot indicator (collapsed view)
            if (badgeDot) {
                badgeDot.style.display = notificationCount > 0 ? 'block' : 'none';
            }
        } catch (err) {
            console.warn('Error updating notification badge:', err);
        }
    }

    // Poll for notification updates
    function startNotificationPolling(organizationId, intervalMs = 30000) {
        // Initial fetch
        updateNotificationBadge(organizationId);

        // Poll every 30 seconds
        setInterval(() => {
            updateNotificationBadge(organizationId);
        }, intervalMs);
    }

    // Update language display
    function updateLanguageDisplay() {
        const langCode = document.getElementById('sidebar-lang-code');
        const currentLang = localStorage.getItem('language') || 'en';
        if (langCode) {
            langCode.textContent = currentLang.toUpperCase();
        }
        // Update active state on language options
        const langDropdown = document.getElementById('sidebar-lang-dropdown');
        if (langDropdown) {
            langDropdown.querySelectorAll('.lang-option').forEach(option => {
                option.classList.toggle('active', option.dataset.lang === currentLang);
            });
        }
    }

    // Initialize sidebar
    function init(userData = {}) {
        // Find or create the app layout wrapper
        let appLayout = document.querySelector('.app-layout');

        if (!appLayout) {
            // Wrap existing content in app-layout
            const body = document.body;
            const existingContent = body.innerHTML;

            appLayout = document.createElement('div');
            appLayout.className = 'app-layout';

            const appMain = document.createElement('main');
            appMain.className = 'app-main';
            appMain.innerHTML = existingContent;

            body.innerHTML = '';
            body.appendChild(appLayout);
            appLayout.appendChild(appMain);
        }

        // Render sidebar
        render(appLayout, userData);

        // Update language display when language changes
        window.addEventListener('i18n:changed', updateLanguageDisplay);
    }

    return {
        init,
        render,
        updateLanguageDisplay,
        updateNotificationBadge,
        startNotificationPolling,
        updateBlogReviewBadge,
        startBlogReviewPolling
    };
})();

// Export globally
window.AppSidebar = AppSidebar;

// Auto-initialize sidebar on DOM ready (basic render, can be updated later with user data)
document.addEventListener('DOMContentLoaded', () => {
    // Only auto-init if not already initialized and app-layout exists
    const appLayout = document.querySelector('.app-layout');
    const existingSidebar = document.querySelector('.app-sidebar');

    if (appLayout && !existingSidebar) {
        // Initialize with placeholder data - will be updated when page JS calls init()
        AppSidebar.init({
            name: 'Loading...',
            email: '',
            organization: { name: 'Loading...' }
        });
    }
});
