// ===== Crown Dashboard Module =====
// Integration layer: binds 3D crown to intelligence data, manages modes, renders cards

const CrownDashboard = (function() {
    // ===== STATE OBJECTS =====

    // Mode & initialization state
    const modeState = {
        current: 'review',    // 'review' | 'autonomous'
        theme: 'dark',
        initialized: false
    };

    // Counter state
    const counterState = {
        pending: 0,
        completed: 0
    };

    // Organization reference (set via init)
    let currentOrg = null;

    // Event listener references for cleanup
    const eventListenerRefs = {};

    // Currency mapping for localization (Intel card money inputs)
    const CURRENCY_MAP = {
        'US': { symbol: '$', code: 'USD' },
        'GB': { symbol: '£', code: 'GBP' },
        'EU': { symbol: '€', code: 'EUR' },
        'DE': { symbol: '€', code: 'EUR' },
        'FR': { symbol: '€', code: 'EUR' },
        'ES': { symbol: '€', code: 'EUR' },
        'IT': { symbol: '€', code: 'EUR' },
        'NL': { symbol: '€', code: 'EUR' },
        'BE': { symbol: '€', code: 'EUR' },
        'AT': { symbol: '€', code: 'EUR' },
        'PT': { symbol: '€', code: 'EUR' },
        'IE': { symbol: '€', code: 'EUR' },
        'JP': { symbol: '¥', code: 'JPY' },
        'AU': { symbol: '$', code: 'AUD' },
        'CA': { symbol: '$', code: 'CAD' },
        'MX': { symbol: '$', code: 'MXN' },
        'BR': { symbol: 'R$', code: 'BRL' },
        'IN': { symbol: '₹', code: 'INR' },
        'CH': { symbol: 'CHF', code: 'CHF' },
        'SE': { symbol: 'kr', code: 'SEK' },
        'NO': { symbol: 'kr', code: 'NOK' },
        'DK': { symbol: 'kr', code: 'DKK' }
    };

    let orgCurrency = CURRENCY_MAP['US']; // Default to USD, updated on org load

    // AI Recommendation Templates - loaded from shared/ai-templates.js
    const AI_TEMPLATES = window.AI_TEMPLATES;

    // ===== CONSTANTS =====

    // localStorage keys
    const STORAGE_KEYS = {
        MODE: 'royalty_current_mode',
        AUTONOMOUS_CONFIRMED: 'royalty_autonomous_confirmed',
        THEME: 'intelligence-theme'
    };

    // Keep legacy constant for backward compatibility during refactoring
    const MODE_STORAGE_KEY = STORAGE_KEYS.MODE;

    // DOM element IDs
    const SELECTORS = {
        FEED: 'cards-feed',
        VIEWPORT: 'crown-viewport',
        CANVAS: 'crown-canvas',
        LOADING: 'crown-loading',
        TEXTAREA: 'prompt-textarea',
        SEND_BTN: 'prompt-send-btn',
        CHAR_COUNT: 'prompt-char-count',
        SUGGESTIONS: 'crown-suggestions',
        THEME_BTN: 'theme-toggle-btn',
        DASHBOARD: 'crown-dashboard',
        MODE_TOGGLE: 'crown-mode-toggle',
        TOAST_CONTAINER: 'activity-toast-container',
        FILTERS: 'actions-filters',
        PAUSE_BTN: 'pause-autonomous',
        CONFIRM_MODAL: 'mode-confirm-modal',
        DETAIL_MODAL: 'action-detail-modal',
        UPGRADE_BTN: 'prompt-upgrade-btn'
    };

    // Custom event names
    const EVENTS = {
        ANALYZING: 'crown:analyzing',
        ANALYZED: 'crown:analyzed',
        IMPLEMENTED: 'crown:implemented',
        RECOMMENDATIONS_LOADED: 'crown:recommendations-loaded',
        ACCEPT: 'crown:accept',
        STATUS_CHANGED: 'crown:status-changed'
    };

    function getCurrencyForCountry(countryCode) {
        return CURRENCY_MAP[countryCode?.toUpperCase()] || CURRENCY_MAP['US'];
    }

    // Demo cards for first-time users — creates "constant feed" illusion
    const MOCK_CARDS = [
        {
            id: 'demo-1',
            type: 'opportunity',
            title: 'Welcome to Royalty Intelligence',
            description: 'I analyze your business data continuously and surface actionable insights. Here\'s what I\'m monitoring for you...',
            created_at: new Date().toISOString(),
            status: 'pending',
            is_demo: true
        },
        {
            id: 'demo-2',
            type: 'growth',
            title: 'Import your first customers',
            description: 'Once you have customers, I\'ll track visit patterns, identify at-risk members, and suggest retention strategies.',
            created_at: new Date(Date.now() - 3600000).toISOString(),
            status: 'pending',
            is_demo: true,
            action_url: '/app/customers.html'
        },
        {
            id: 'demo-3',
            type: 'automation',
            title: 'Birthday rewards drive 4x engagement',
            description: 'When you add customer birthdays, I\'ll automatically trigger special offers that increase visit frequency.',
            created_at: new Date(Date.now() - 7200000).toISOString(),
            status: 'pending',
            is_demo: true
        },
        {
            id: 'demo-4',
            type: 'efficiency',
            title: 'Win-back campaigns recover 15% of churned members',
            description: 'I\'ll identify members who haven\'t visited in 30+ days and propose re-engagement messages.',
            created_at: new Date(Date.now() - 86400000).toISOString(),
            status: 'pending',
            is_demo: true
        }
    ];

    async function init(options) {
        if (options && options.organization) {
            currentOrg = options.organization;
        }

        // Clean up any existing event listeners to prevent memory leaks on re-init
        cleanupEventListeners();

        // Check WebGL support
        if (!supportsWebGL()) {
            showFallback();
            setupCards();
            modeState.initialized = true;
            return;
        }

        // Show loading state
        const viewport = document.getElementById('crown-viewport');
        if (viewport) {
            const loading = document.createElement('div');
            loading.className = 'crown-loading';
            loading.id = 'crown-loading';
            loading.innerHTML = '<div class="crown-loading-spinner"></div><span>Loading 3D scene...</span>';
            viewport.appendChild(loading);
        }

        try {
            const canvas = document.getElementById('crown-canvas');
            if (!canvas) return;

            await CrownScene.init(canvas);

            // Remove loading
            const loadingEl = document.getElementById('crown-loading');
            if (loadingEl) loadingEl.remove();

        } catch (e) {
            console.error('Failed to initialize 3D scene:', e);
            showFallback();
        }

        setupModeToggle();
        setupThemeToggle();
        setupCards();
        setupEventListeners();
        initPrompt();

        // Event delegation for autonomous feed (prevents memory leaks from repeated bindings)
        const feedContainer = document.getElementById('cards-feed');
        if (feedContainer && !feedContainer._delegatedHandlerAdded) {
            feedContainer.addEventListener('click', handleFeedClick);
            feedContainer._delegatedHandlerAdded = true;
        }
        setupActionDetailModal();

        // Restore persisted mode from localStorage
        const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
        if (savedMode && (savedMode === 'review' || savedMode === 'autonomous')) {
            // Skip confirmation modal if restoring autonomous (user already confirmed)
            if (savedMode === 'autonomous') {
                localStorage.setItem(STORAGE_KEYS.AUTONOMOUS_CONFIRMED, 'true');
            }
            setMode(savedMode);
        }

        // Cleanup on page unload to prevent memory leaks (only add once)
        if (!eventListenerRefs.beforeUnload) {
            eventListenerRefs.beforeUnload = () => {
                cleanupEventListeners();
                stopCountdownTimer();
            };
            window.addEventListener('beforeunload', eventListenerRefs.beforeUnload);
        }

        modeState.initialized = true;
    }

    function supportsWebGL() {
        try {
            const c = document.createElement('canvas');
            return !!(c.getContext('webgl2') || c.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }

    function showFallback() {
        const viewport = document.getElementById('crown-viewport');
        if (!viewport) return;

        const canvas = document.getElementById('crown-canvas');
        if (canvas) canvas.style.display = 'none';

        // Remove loading
        const loadingEl = document.getElementById('crown-loading');
        if (loadingEl) loadingEl.remove();

        const fallback = document.createElement('div');
        fallback.className = 'crown-fallback';
        fallback.innerHTML = `
            <div class="crown-fallback-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(124,58,237,0.6)" stroke-width="1.5">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
            </div>
            <span>AI Intelligence</span>
        `;
        viewport.appendChild(fallback);
    }

    function setupThemeToggle() {
        const saved = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
        applyTheme(saved);

        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                applyTheme(modeState.theme === 'dark' ? 'light' : 'dark');
            });
        }

        // Clean up sidebar class when leaving page
        window.addEventListener('beforeunload', cleanupSidebar);
    }

    function applyTheme(theme) {
        modeState.theme = theme;
        localStorage.setItem(STORAGE_KEYS.THEME, theme);

        const dashboard = document.getElementById('crown-dashboard');
        if (dashboard) {
            dashboard.setAttribute('data-theme', theme);
        }

        // Sidebar transparency (both light and dark modes)
        const sidebar = document.querySelector('.app-sidebar');
        if (sidebar) {
            sidebar.classList.add('intelligence-active'); // Always transparent on this page
            sidebar.classList.toggle('intelligence-dark', theme === 'dark');
        }

        // Update 3D environment
        if (typeof CrownScene !== 'undefined' && CrownScene.setTheme) {
            CrownScene.setTheme(theme === 'dark');
        }

        // Update toggle button icon
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            const isDark = theme === 'dark';
            btn.innerHTML = isDark
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
            btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        }
    }

    function cleanupSidebar() {
        const sidebar = document.querySelector('.app-sidebar');
        if (sidebar) {
            sidebar.classList.remove('intelligence-active', 'intelligence-dark');
        }
    }

    function setupModeToggle() {
        const toggle = document.getElementById('crown-mode-toggle');
        if (!toggle) return;

        toggle.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const mode = btn.dataset.mode;

                // Check if switching to autonomous and user has capability
                if (mode === 'autonomous' && modeState.current !== 'autonomous') {
                    // Check plan capability using the new hasCapability function
                    if (typeof hasCapability === 'function' && currentOrg) {
                        const canUseAutonomous = hasCapability(currentOrg, 'autonomous_mode');
                        if (!canUseAutonomous) {
                            // Show upgrade message
                            const message = typeof getFeatureUpgradeMessage === 'function'
                                ? getFeatureUpgradeMessage('autonomous_mode', currentOrg)
                                : 'Autonomous Mode is available on Pro ($299/mo). Upgrade to let Royal send campaigns without asking.';
                            showToast(message, 'info', 5000);
                            return;
                        }
                    }

                    const alreadyConfirmed = localStorage.getItem(STORAGE_KEYS.AUTONOMOUS_CONFIRMED) === 'true';
                    if (!alreadyConfirmed) {
                        showAutonomousModal();
                        return;
                    }
                }

                setMode(mode);
            });
        });

        // Setup modal handlers
        setupAutonomousModal();
    }

    function showAutonomousModal() {
        const modal = document.getElementById('mode-confirm-modal');
        if (modal) {
            previouslyFocusedElement = document.activeElement;
            modal.style.display = 'flex';
            trapFocus(modal);
        }
    }

    function hideAutonomousModal() {
        const modal = document.getElementById('mode-confirm-modal');
        if (modal) {
            releaseFocusTrap(modal);
            modal.style.display = 'none';

            // Restore focus
            if (previouslyFocusedElement && previouslyFocusedElement.focus) {
                previouslyFocusedElement.focus();
                previouslyFocusedElement = null;
            }
        }
        // Reset checkbox
        const checkbox = document.getElementById('mode-confirm-remember-checkbox');
        if (checkbox) {
            checkbox.checked = false;
        }
    }

    function setupAutonomousModal() {
        const modal = document.getElementById('mode-confirm-modal');
        if (!modal) return;

        const overlay = modal.querySelector('.mode-confirm-overlay');
        const cancelBtn = document.getElementById('mode-confirm-cancel');
        const enableBtn = document.getElementById('mode-confirm-enable');
        const rememberCheckbox = document.getElementById('mode-confirm-remember-checkbox');

        // Close on overlay click
        if (overlay) {
            overlay.addEventListener('click', hideAutonomousModal);
        }

        // Cancel button
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideAutonomousModal);
        }

        // Enable button
        if (enableBtn) {
            enableBtn.addEventListener('click', () => {
                // Check if "don't show again" is checked
                if (rememberCheckbox && rememberCheckbox.checked) {
                    localStorage.setItem(STORAGE_KEYS.AUTONOMOUS_CONFIRMED, 'true');
                }

                hideAutonomousModal();
                setMode('autonomous');
            });
        }

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                hideAutonomousModal();
            }
        });
    }

    // ===== ACCESSIBILITY UTILITIES =====

    // Track previously focused element for restoring focus after modal closes
    let previouslyFocusedElement = null;

    /**
     * Trap focus within a modal element
     * @param {HTMLElement} modal - The modal element to trap focus within
     */
    function trapFocus(modal) {
        const focusable = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstFocusable = focusable[0];
        const lastFocusable = focusable[focusable.length - 1];

        // Store handler reference for removal
        modal._focusTrapHandler = (e) => {
            if (e.key === 'Tab') {
                if (e.shiftKey && document.activeElement === firstFocusable) {
                    e.preventDefault();
                    lastFocusable?.focus();
                } else if (!e.shiftKey && document.activeElement === lastFocusable) {
                    e.preventDefault();
                    firstFocusable?.focus();
                }
            }
        };

        modal.addEventListener('keydown', modal._focusTrapHandler);
        firstFocusable?.focus();
    }

    /**
     * Release focus trap from a modal
     * @param {HTMLElement} modal - The modal element to release focus from
     */
    function releaseFocusTrap(modal) {
        if (modal._focusTrapHandler) {
            modal.removeEventListener('keydown', modal._focusTrapHandler);
            delete modal._focusTrapHandler;
        }
    }

    // ===== ACTION DETAIL MODAL =====

    function showActionDetailModal(action) {
        const modal = document.getElementById('action-detail-modal');
        if (!modal) return;

        // Populate content
        const titleEl = document.getElementById('action-detail-title');
        const timeEl = document.getElementById('action-detail-time');
        const descEl = document.getElementById('action-detail-description');
        const actionEl = document.getElementById('action-detail-action');
        const impactEl = document.getElementById('action-detail-impact');
        const customersEl = document.getElementById('action-detail-customers');

        if (titleEl) titleEl.textContent = action.title || 'Completed Action';
        if (timeEl) timeEl.textContent = `Completed ${formatTimeAgo(action.completed_at)}`;
        if (descEl) descEl.textContent = action.description || 'This action was automatically accepted by Royal AI.';
        if (actionEl) actionEl.textContent = action.actionTaken || action.title || 'Action completed';
        if (impactEl) impactEl.textContent = action.impact || 'Impact tracking in progress...';

        // Render affected customers
        if (customersEl) {
            if (action.affectedCustomers && action.affectedCustomers.length > 0) {
                const displayCount = Math.min(3, action.affectedCustomers.length);
                const remaining = action.affectedCustomers.length - displayCount;
                customersEl.innerHTML = action.affectedCustomers.slice(0, displayCount)
                    .map(name => `<div class="customer-chip">${escapeHtml(name)}</div>`)
                    .join('') + (remaining > 0 ? `<div class="customer-chip more">+${remaining} more</div>` : '');
            } else if (action.affectedCount) {
                customersEl.innerHTML = `<div class="customer-chip">${action.affectedCount} customers</div>`;
            } else {
                customersEl.innerHTML = '<span class="text-muted">All eligible customers</span>';
            }
        }

        // Store currently focused element for restoration
        previouslyFocusedElement = document.activeElement;

        // Show modal and trap focus
        modal.style.display = 'flex';
        modal.dataset.actionId = action.id;
        trapFocus(modal);
    }

    function hideActionDetailModal() {
        const modal = document.getElementById('action-detail-modal');
        if (modal) {
            releaseFocusTrap(modal);
            modal.style.display = 'none';

            // Restore focus to previously focused element
            if (previouslyFocusedElement && previouslyFocusedElement.focus) {
                previouslyFocusedElement.focus();
                previouslyFocusedElement = null;
            }
        }
    }

    function setupActionDetailModal() {
        const modal = document.getElementById('action-detail-modal');
        if (!modal) return;

        const overlay = modal.querySelector('.action-detail-overlay');
        const closeBtn = document.getElementById('action-detail-close');

        // Close handlers
        if (overlay) {
            overlay.addEventListener('click', hideActionDetailModal);
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', hideActionDetailModal);
        }

        // Footer buttons
        modal.querySelectorAll('.action-detail-footer button').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'undo') {
                    showActivityToast('info', 'Undo not yet implemented');
                }
                hideActionDetailModal();
            });
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                hideActionDetailModal();
            }
        });
    }

    function setMode(mode) {
        // Map 'chat' to 'review' for crown state (chat uses review's visual style)
        const crownMode = mode === 'chat' ? 'review' : mode;
        modeState.current = crownMode;

        // Persist mode to localStorage
        localStorage.setItem(MODE_STORAGE_KEY, crownMode);

        // Update toggle UI (only for review/autonomous buttons)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const btnMode = btn.dataset.mode;
            // If setting to chat mode, keep review button active
            const isActive = mode === 'chat' ? btnMode === 'review' : btnMode === mode;
            btn.classList.toggle('active', isActive);
            // Update aria-pressed for accessibility
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        // Update crown visual state
        if (typeof CrownScene !== 'undefined' && CrownScene.setState) {
            CrownScene.setState(crownMode === 'autonomous' ? 'autonomous' : 'idle');
        }

        // Update status indicator
        updateStatus(crownMode === 'autonomous' ? 'autonomous' : 'idle');

        // Re-render cards for the mode
        renderCardsForMode(crownMode);

        // Handle auto-accept for autonomous mode
        if (crownMode === 'autonomous') {
            // Keep insight cards visible — don't replace with queue layout
            startCountdownTimer();
            // Start monitoring for suggestions running dry
            startSuggestionsDryMonitor();
            // Start planning cycles
            startPlanningCycles();
        } else {
            // Cancel any in-progress auto-accept
            cancelAutoAccept();
            // Stop countdown timer
            stopCountdownTimer();
            // Reset pause state
            autonomousState.paused = false;
            // Stop suggestions dry monitor
            if (infoRequestState.dryTimer) {
                clearTimeout(infoRequestState.dryTimer);
                infoRequestState.dryTimer = null;
            }
            // Stop planning cycles
            stopPlanningCycles();
        }
    }

    let currentFilter = 'new';  // 'new' | 'rejected' | 'accepted'

    function setupCards() {
        // Show initial feed immediately (no "analyze" button)
        showInitialFeed();
        setupActionsFilters();
    }

    function setupActionsFilters() {
        const filtersContainer = document.getElementById('actions-filters');
        if (!filtersContainer) return;

        filtersContainer.querySelectorAll('.filter-pill').forEach(pill => {
            const handleFilter = () => {
                // Update active state
                filtersContainer.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                // Apply filter
                currentFilter = pill.dataset.filter;
                applyCurrentFilter();
            };

            pill.addEventListener('click', handleFilter);

            // Keyboard accessibility - handle Enter and Space
            pill.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFilter();
                }
            });
        });
    }

    function applyCurrentFilter() {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const cards = feed.querySelectorAll('.insight-card');
        cards.forEach(card => {
            const status = card.dataset.status || 'pending';

            let show = false;
            switch (currentFilter) {
                case 'new':
                    show = status === 'pending';
                    break;
                case 'rejected':
                    show = status === 'dismissed';
                    break;
                case 'accepted':
                    show = status === 'implemented';
                    break;
            }

            card.style.display = show ? '' : 'none';
        });

        // Update filter counts
        updateFilterCounts();
    }

    function updateFilterCounts() {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const cards = feed.querySelectorAll('.insight-card');
        let newCount = 0, rejectedCount = 0, acceptedCount = 0;

        cards.forEach(card => {
            const status = card.dataset.status || 'pending';
            if (status === 'pending') newCount++;
            else if (status === 'dismissed') rejectedCount++;
            else if (status === 'implemented') acceptedCount++;
        });

        // Update filter pill count badges if they exist
        const filtersContainer = document.getElementById('actions-filters');
        if (filtersContainer) {
            const newPill = filtersContainer.querySelector('[data-filter="new"]');
            const rejectedPill = filtersContainer.querySelector('[data-filter="rejected"]');
            const acceptedPill = filtersContainer.querySelector('[data-filter="accepted"]');

            if (newPill && newCount > 0) {
                if (!newPill.querySelector('.filter-count')) {
                    newPill.innerHTML += `<span class="filter-count">${newCount}</span>`;
                } else {
                    newPill.querySelector('.filter-count').textContent = newCount;
                }
            }
        }
    }

    function showInitialFeed() {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        // Check if real cards already loaded (from intelligence.js)
        const hasRealCards = feed.querySelector('.insight-card:not([data-demo="true"])');
        if (hasRealCards) return;

        // Show demo cards as onboarding experience
        renderRecommendationCards(MOCK_CARDS);

        // Mark as demo cards
        feed.querySelectorAll('.insight-card').forEach(card => {
            card.setAttribute('data-demo', 'true');
        });
    }

    function setupEventListeners() {
        // Store handler references for cleanup on page unload
        eventListenerRefs.analyzing = () => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState('analyzing');
            }
            updateStatus('analyzing');
        };

        eventListenerRefs.analyzed = (e) => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState(modeState.current === 'autonomous' ? 'autonomous' : 'idle');
                CrownScene.pulseOnce();
            }
            updateStatus(modeState.current === 'autonomous' ? 'autonomous' : 'idle');

            // Render new recommendation cards (only if non-empty to preserve mock cards)
            if (e.detail && e.detail.recommendations && e.detail.recommendations.length > 0) {
                renderRecommendationCards(e.detail.recommendations);
            }
        };

        eventListenerRefs.implemented = (e) => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.pulseOnce();
            }
            // Add completed card
            if (e.detail) {
                addCompletedCard(e.detail);
            }
        };

        eventListenerRefs.recommendationsLoaded = (e) => {
            if (e.detail && e.detail.recommendations && e.detail.recommendations.length > 0) {
                renderRecommendationCards(e.detail.recommendations);
            }
        };

        // Listen for crown events from intelligence.js
        document.addEventListener(EVENTS.ANALYZING, eventListenerRefs.analyzing);
        document.addEventListener(EVENTS.ANALYZED, eventListenerRefs.analyzed);
        document.addEventListener(EVENTS.IMPLEMENTED, eventListenerRefs.implemented);
        document.addEventListener(EVENTS.RECOMMENDATIONS_LOADED, eventListenerRefs.recommendationsLoaded);
    }

    function cleanupEventListeners() {
        if (eventListenerRefs.analyzing) {
            document.removeEventListener(EVENTS.ANALYZING, eventListenerRefs.analyzing);
        }
        if (eventListenerRefs.analyzed) {
            document.removeEventListener(EVENTS.ANALYZED, eventListenerRefs.analyzed);
        }
        if (eventListenerRefs.implemented) {
            document.removeEventListener(EVENTS.IMPLEMENTED, eventListenerRefs.implemented);
        }
        if (eventListenerRefs.recommendationsLoaded) {
            document.removeEventListener(EVENTS.RECOMMENDATIONS_LOADED, eventListenerRefs.recommendationsLoaded);
        }
        // Clean up beforeunload listener to prevent memory leaks on re-init
        if (eventListenerRefs.beforeUnload) {
            window.removeEventListener('beforeunload', eventListenerRefs.beforeUnload);
            eventListenerRefs.beforeUnload = null;
        }
    }

    function updateStatus(state) {
        const dot = document.querySelector('.crown-status-dot');
        const text = document.querySelector('.crown-status-text');
        if (!dot || !text) return;

        dot.className = 'crown-status-dot';

        const t = (key, fallback) => {
            if (typeof I18n !== 'undefined' && I18n.t) {
                return I18n.t('intelligence.' + key) || fallback;
            }
            return fallback;
        };

        switch (state) {
            case 'analyzing':
                dot.classList.add('analyzing');
                text.textContent = t('crown.analyzing', 'Analyzing...');
                break;
            case 'autonomous':
                dot.classList.add('autonomous');
                text.textContent = t('crown.autonomous', 'Auto-pilot Active');
                break;
            default:
                text.textContent = t('crown.idle', 'Monitoring');
        }
    }

    function renderRecommendationCards(recommendations) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        // Clear existing cards
        feed.innerHTML = '';

        if (!recommendations || recommendations.length === 0) {
            feed.innerHTML = `
                <div class="cards-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>I'm monitoring your business. New insights will appear here automatically.</p>
                </div>
            `;
            counterState.pending = 0;
            counterState.completed = 0;
            updateCounts();
            return;
        }

        counterState.pending = 0;
        counterState.completed = 0;

        recommendations.forEach(rec => {
            const status = rec.status || 'pending';
            if (status === 'implemented' || status === 'dismissed') {
                counterState.completed++;
            } else {
                counterState.pending++;
            }

            const card = createCard(rec);
            feed.appendChild(card);
        });

        updateCounts();
    }

    function createCard(rec) {
        const isCompleted = rec.status === 'implemented';
        const isDismissed = rec.status === 'dismissed';
        const type = isCompleted ? 'completed' : isDismissed ? 'completed' : mapRecType(rec.type);

        const card = document.createElement('div');
        card.className = `insight-card type-${type}`;
        card.dataset.recId = rec.id || '';

        const timeAgo = rec.created_at ? formatTimeAgo(rec.created_at) : '';
        const icon = getCardIcon(rec.type);

        // Store status for filtering
        card.dataset.status = rec.status || 'pending';

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">${icon}</div>
                <div class="insight-card-title">${escapeHtml(rec.title || rec.name || 'Recommendation')}</div>
                <div class="insight-card-time">${timeAgo}</div>
            </div>
            <div class="insight-card-body">${escapeHtml(rec.description || '')}</div>
            ${!isCompleted && !isDismissed && modeState.current === 'review' ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn ghost detail-toggle" data-action="view" data-rec-id="${rec.id}">View Details</button>
                    <div class="insight-card-actions-right">
                        <button class="card-action-btn secondary" data-action="dismiss" data-rec-id="${rec.id}">Dismiss</button>
                        <button class="card-action-btn primary" data-action="accept" data-rec-id="${rec.id}">Accept</button>
                    </div>
                </div>
            ` : !isCompleted && !isDismissed ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn ghost detail-toggle" data-action="view" data-rec-id="${rec.id}">View Details</button>
                </div>
            ` : isDismissed ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn primary" data-action="reaccept" data-rec-id="${rec.id}">Re-accept</button>
                </div>
            ` : isCompleted ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn ghost detail-toggle" data-action="view" data-rec-id="${rec.id}">View Details</button>
                </div>
            ` : ''}
        `;

        // Card action handlers
        card.querySelectorAll('.card-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleCardAction(btn.dataset.action, btn.dataset.recId, card);
            });
        });

        return card;
    }

    /**
     * Create automation from an AI suggestion card
     * @param {Object} idea - The idea object from the card
     * @param {boolean} autoActivate - Whether to activate immediately (autonomous mode)
     */
    async function createAutomationFromIdea(idea, autoActivate) {
        const templateId = idea.action_payload?.template_id;
        const template = AI_TEMPLATES[templateId];
        if (!template) {
            console.warn('Template not found:', templateId);
            return;
        }

        try {
            // Get current user and organization
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: orgResult } = await supabase
                .from('organization_members')
                .select('organization:organizations(id)')
                .eq('user_id', user.id)
                .single();

            if (!orgResult?.organization?.id) {
                console.error('Organization not found');
                return;
            }

            const orgId = orgResult.organization.id;

            // Create project first
            const { data: project, error: projectError } = await supabase
                .from('projects')
                .insert({
                    organization_id: orgId,
                    name: template.projectName,
                    description: template.projectDesc,
                    settings: { created_from: 'ai_suggestion' }
                })
                .select()
                .single();

            if (projectError) {
                console.error('Error creating project:', projectError);
                showActivityToast('error', 'Failed to create project');
                return;
            }

            // Create automation
            const { data: automation, error: automationError } = await supabase
                .from('automations')
                .insert({
                    project_id: project.id,
                    name: template.automation.name,
                    description: template.automation.description,
                    type: template.automation.type,
                    frequency: template.automation.frequency,
                    icon: template.automation.icon,
                    template_id: template.automation.template_id,
                    is_active: autoActivate,
                    settings: { created_from: 'ai_suggestion', template_id: templateId }
                })
                .select()
                .single();

            if (automationError) {
                console.error('Error creating automation:', automationError);
                showActivityToast('error', 'Failed to create automation');
                return;
            }

            // Show appropriate toast
            showActivityToast(
                autoActivate ? 'success' : 'info',
                autoActivate
                    ? `Created & activated "${template.automation.name}"`
                    : `Created "${template.automation.name}" - activate in Automations`
            );

            // Log audit
            if (typeof AuditLog !== 'undefined') {
                AuditLog.logAutomationCreate(orgId, automation);
            }

        } catch (err) {
            console.error('Failed to create automation:', err);
            showActivityToast('error', 'Failed to create automation');
        }
    }

    function handleCardAction(action, recId, cardEl) {
        try {
        if (action === 'accept') {
            // Check for automation idea data and create automation if present
            const ideaBtn = cardEl.querySelector('[data-idea]');
            if (ideaBtn) {
                try {
                    const idea = JSON.parse(decodeURIComponent(ideaBtn.dataset.idea));
                    if (idea?.action_type === 'create_automation' ||
                        idea?.action_type === 'create_project_with_automation') {
                        // Create automation: active in autonomous mode, inactive in review mode
                        createAutomationFromIdea(idea, modeState.current === 'autonomous');
                    }
                } catch (e) {
                    console.error('Failed to parse idea data:', e);
                }
            }

            // Find and click the accept button in the legacy recommendations list
            const legacyBtn = document.querySelector(`[data-recommendation-id="${recId}"] .btn-implement, [data-rec-id="${recId}"]`);
            if (legacyBtn) {
                legacyBtn.click();
            } else {
                // Dispatch event for intelligence.js to handle
                document.dispatchEvent(new CustomEvent(EVENTS.ACCEPT, {
                    detail: { recId }
                }));
            }
            // Visual feedback
            cardEl.classList.remove('type-action', 'type-insight');
            cardEl.classList.add('type-completed');
            cardEl.dataset.status = 'implemented';
            const actions = cardEl.querySelector('.insight-card-actions');
            if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Accepted</span>';

            // Update counts
            counterState.pending = Math.max(0, counterState.pending - 1);
            counterState.completed++;
            updateCounts();

            // Dispatch event for persistence
            document.dispatchEvent(new CustomEvent(EVENTS.STATUS_CHANGED, {
                detail: { recId, status: 'implemented' }
            }));
        } else if (action === 'dismiss') {
            // Mark as dismissed instead of removing
            cardEl.dataset.status = 'dismissed';
            cardEl.classList.add('dismissed');

            // Update the actions to show re-accept
            const actions = cardEl.querySelector('.insight-card-actions');
            if (actions) {
                actions.innerHTML = `
                    <button class="card-action-btn primary" data-action="reaccept" data-rec-id="${recId}">Re-accept</button>
                `;
                actions.querySelector('.card-action-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleCardAction('reaccept', recId, cardEl);
                });
            }

            // Dispatch event for persistence
            document.dispatchEvent(new CustomEvent(EVENTS.STATUS_CHANGED, {
                detail: { recId, status: 'dismissed' }
            }));

            // Update filter view (hide from New tab)
            applyCurrentFilter();
        } else if (action === 'reaccept') {
            // Re-accept a dismissed card
            cardEl.classList.remove('type-action', 'type-insight', 'dismissed');
            cardEl.classList.add('type-completed');
            cardEl.dataset.status = 'implemented';

            const actions = cardEl.querySelector('.insight-card-actions');
            if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Accepted</span>';

            // Dispatch events
            document.dispatchEvent(new CustomEvent(EVENTS.ACCEPT, {
                detail: { recId }
            }));
            document.dispatchEvent(new CustomEvent(EVENTS.STATUS_CHANGED, {
                detail: { recId, status: 'implemented' }
            }));

            // Update counts
            counterState.completed++;
            updateCounts();
        } else if (action === 'view') {
            // Expand card in place to show details
            expandCardDetails(cardEl, recId);
        } else if (action === 'collapse') {
            // Collapse expanded card
            collapseCardDetails(cardEl);
        }
        } catch (e) {
            console.error('Card action failed:', e.message);
            showActivityToast('error', 'Action failed. Please try again.');
        }
    }

    /**
     * Expand card to show details inline
     */
    function expandCardDetails(cardEl, recId) {
        // Check if already expanded
        if (cardEl.classList.contains('expanded')) {
            return collapseCardDetails(cardEl);
        }

        // Collapse any other expanded cards first
        document.querySelectorAll('.insight-card.expanded').forEach(card => {
            collapseCardDetails(card);
        });

        // Build expanded content
        const expandedHtml = `
            <div class="insight-card-expanded">
                <div class="expanded-section">
                    <h4>Why this was suggested</h4>
                    <p>Royal AI analyzed your business data and identified this as a high-impact opportunity based on your customer engagement patterns and industry benchmarks.</p>
                </div>
                <div class="expanded-metrics">
                    <div class="metric">
                        <span class="metric-value">~15%</span>
                        <span class="metric-label">Est. Impact</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">47</span>
                        <span class="metric-label">Customers</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">3d</span>
                        <span class="metric-label">Time to Result</span>
                    </div>
                </div>
                <div class="expanded-collapse">
                    <button class="btn-ghost" data-action="collapse">Close Details</button>
                </div>
            </div>
        `;

        // Add expanded content to card
        cardEl.insertAdjacentHTML('beforeend', expandedHtml);
        cardEl.classList.add('expanded');

        // Update the toggle button to Hide Details
        const viewBtn = cardEl.querySelector('.card-action-btn.detail-toggle[data-action="view"]');
        if (viewBtn) {
            viewBtn.textContent = 'Hide Details';
            viewBtn.dataset.action = 'collapse';
        }

        // Bind handler for collapse button
        cardEl.querySelectorAll('.expanded-collapse button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.action === 'collapse') {
                    collapseCardDetails(cardEl);
                }
            });
        });
    }

    /**
     * Collapse expanded card details
     */
    function collapseCardDetails(cardEl) {
        cardEl.classList.remove('expanded');
        const expandedContent = cardEl.querySelector('.insight-card-expanded');
        if (expandedContent) {
            expandedContent.remove();
        }

        // Reset toggle button to View Details
        const collapseBtn = cardEl.querySelector('.card-action-btn.detail-toggle[data-action="collapse"]');
        if (collapseBtn) {
            collapseBtn.textContent = 'View Details';
            collapseBtn.dataset.action = 'view';
        }
    }

    // Autonomous mode state
    const autonomousState = {
        acceptInProgress: false,
        abortController: null,
        queued: [],
        completed: [],
        paused: false,
        countdownInterval: null
    };

    async function autoAcceptPendingCards() {
        // Prevent multiple simultaneous auto-accept runs
        if (autonomousState.acceptInProgress) return;
        autonomousState.acceptInProgress = true;

        // Create abort controller for cancellation
        autonomousState.abortController = new AbortController();

        const feed = document.getElementById('cards-feed');
        if (!feed) {
            autonomousState.acceptInProgress = false;
            return;
        }

        const pendingCards = Array.from(feed.querySelectorAll('.insight-card[data-status="pending"]'));

        for (const card of pendingCards) {
            // Check if we should abort (mode changed back)
            if (autonomousState.abortController.signal.aborted || modeState.current !== 'autonomous') {
                break;
            }

            const recId = card.dataset.recId;
            if (!recId) continue;

            // Visual feedback: pulse the card before accepting
            card.classList.add('auto-accepting');
            card.style.boxShadow = '0 0 20px rgba(124, 58, 237, 0.5)';

            // Show toast notification
            showActivityToast('ai-accepted', card.querySelector('.insight-card-title')?.textContent || 'Recommendation');

            // Wait 1 second for visual feedback
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Accept the card
            handleCardAction('accept', recId, card);

            // Remove pulse effect
            card.classList.remove('auto-accepting');
            card.style.boxShadow = '';

            // 3-second stagger before next card
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        autonomousState.acceptInProgress = false;
        autonomousState.abortController = null;
    }

    function cancelAutoAccept() {
        if (autonomousState.abortController) {
            autonomousState.abortController.abort();
        }
        autonomousState.acceptInProgress = false;
    }

    // ===== Autonomous Mode Hybrid Feed =====

    /**
     * Initialize the autonomous feed from current cards
     */
    function initAutonomousFeed() {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        // Get pending cards and convert to queued actions
        const pendingCards = Array.from(feed.querySelectorAll('.insight-card[data-status="pending"]'));
        autonomousState.queued = pendingCards.map((card, index) => ({
            id: card.dataset.recId || `queued-${index}`,
            title: card.querySelector('.insight-card-title')?.textContent || 'Pending Action',
            target: 'All customers',
            countdown: 30 + (index * 5), // 30s base with 5s stagger - gives time to read, pause, or cancel
            cardEl: card
        }));

        // Get completed cards for today
        const completedCards = Array.from(feed.querySelectorAll('.insight-card[data-status="implemented"]'));
        autonomousState.completed = completedCards.map((card, index) => ({
            id: card.dataset.recId || `completed-${index}`,
            title: card.querySelector('.insight-card-title')?.textContent || 'Completed Action',
            type: 'ai-accepted',
            completed_at: new Date(Date.now() - (index * 60000)) // Stagger times for demo
        }));

        renderAutonomousFeed();
        startCountdownTimer();
    }

    /**
     * Render the hybrid autonomous feed
     */
    function renderAutonomousFeed() {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const queuedHtml = autonomousState.queued.length > 0
            ? autonomousState.queued.map(action => `
                <div class="queued-item" data-id="${action.id}">
                    <span class="queued-icon">⏱️</span>
                    <span class="queued-title">${escapeHtml(action.title)}</span>
                    <span class="queued-countdown">in ${action.countdown}s</span>
                    <button class="skip-btn" data-action="skip" data-id="${action.id}">Skip</button>
                </div>
            `).join('')
            : '<div class="feed-empty">No actions queued</div>';

        const completedHtml = autonomousState.completed.length > 0
            ? autonomousState.completed.map(action => `
                <div class="completed-item type-${action.type}" data-id="${action.id}">
                    <span class="completed-icon">✅</span>
                    <span class="completed-title">${escapeHtml(action.title)}</span>
                    <span class="completed-time">${formatTimeAgo(action.completed_at)}</span>
                </div>
            `).join('')
            : '<div class="feed-empty">No actions completed yet today</div>';

        feed.innerHTML = `
            <div class="autonomous-feed">
                <div class="feed-section queued-section">
                    <div class="section-header">
                        <span class="section-title">Queued Actions</span>
                        <span class="section-count">${autonomousState.queued.length}</span>
                        <button class="pause-btn ${autonomousState.paused ? 'paused' : ''}" id="pause-autonomous">
                            ${autonomousState.paused ? '▶️ Resume' : '⏸ Pause'}
                        </button>
                    </div>
                    <div class="queued-list" id="queued-list">
                        ${queuedHtml}
                    </div>
                </div>

                <div class="feed-section completed-section">
                    <div class="section-header">
                        <span class="section-title">Completed Today</span>
                        <span class="section-count">${autonomousState.completed.length}</span>
                    </div>
                    <div class="completed-list" id="completed-list">
                        ${completedHtml}
                    </div>
                </div>
            </div>
        `;

        // Bind pause button (only if not already bound)
        const pauseBtn = document.getElementById('pause-autonomous');
        if (pauseBtn && !pauseBtn._boundHandler) {
            pauseBtn.addEventListener('click', toggleAutonomousPause);
            pauseBtn._boundHandler = true;
        }

        // Note: Skip buttons and completed items use event delegation via handleFeedClick()
        // which is set up once in init() to prevent memory leaks from repeated addEventListener calls
    }

    /**
     * Delegated click handler for feed items (skip buttons, completed items)
     * Set up once in init() to prevent memory leaks
     */
    function handleFeedClick(e) {
        // Handle skip button clicks
        const skipBtn = e.target.closest('.skip-btn');
        if (skipBtn) {
            e.stopPropagation();
            skipQueuedAction(skipBtn.dataset.id);
            return;
        }

        // Handle completed item clicks
        const completedItem = e.target.closest('.completed-item');
        if (completedItem) {
            const actionId = completedItem.dataset.id;
            const action = autonomousState.completed.find(a => a.id === actionId);
            if (action) {
                showActionDetailModal(action);
            }
        }
    }

    /**
     * Toggle pause/resume for autonomous mode
     */
    function toggleAutonomousPause() {
        autonomousState.paused = !autonomousState.paused;

        if (autonomousState.paused) {
            cancelAutoAccept();
            showActivityToast('info', 'Autonomous mode paused');
        } else {
            showActivityToast('info', 'Autonomous mode resumed');
            processNextQueuedAction();
        }

        renderAutonomousFeed();
    }

    /**
     * Skip a queued action
     */
    function skipQueuedAction(actionId) {
        const index = autonomousState.queued.findIndex(a => a.id === actionId);
        if (index !== -1) {
            const action = autonomousState.queued[index];
            autonomousState.queued.splice(index, 1);
            showActivityToast('info', `Skipped: ${action.title}`);
            renderAutonomousFeed();
        }
    }

    /**
     * Start countdown timer for queued actions
     */
    function startCountdownTimer() {
        if (autonomousState.countdownInterval) {
            clearInterval(autonomousState.countdownInterval);
        }

        autonomousState.countdownInterval = setInterval(() => {
            if (autonomousState.paused || modeState.current !== 'autonomous') {
                return;
            }

            // Stop timer if queue is empty (prevents running indefinitely)
            if (autonomousState.queued.length === 0) {
                stopCountdownTimer();
                return;
            }

            let needsRender = false;

            autonomousState.queued.forEach(action => {
                if (action.countdown > 0) {
                    action.countdown--;
                    needsRender = true;
                }
            });

            // Check for actions that hit 0
            const readyActions = autonomousState.queued.filter(a => a.countdown <= 0);
            if (readyActions.length > 0) {
                processNextQueuedAction();
            }

            // Update countdown displays
            if (needsRender) {
                document.querySelectorAll('.queued-item').forEach(item => {
                    const action = autonomousState.queued.find(a => a.id === item.dataset.id);
                    if (action) {
                        const countdownEl = item.querySelector('.queued-countdown');
                        if (countdownEl) {
                            countdownEl.textContent = `in ${action.countdown}s`;
                        }
                    }
                });

                // Update countdown on insight cards
                document.querySelectorAll('.card-countdown').forEach(el => {
                    const action = autonomousState.queued.find(a => a.id === el.dataset.recId);
                    if (action) {
                        el.textContent = `Sending in ${action.countdown}s`;
                    } else {
                        el.remove();
                    }
                });
            }
        }, 1000);
    }

    /**
     * Process the next queued action
     */
    function processNextQueuedAction() {
        if (autonomousState.paused || autonomousState.queued.length === 0) {
            return;
        }

        const action = autonomousState.queued.find(a => a.countdown <= 0);
        if (!action) return;

        // Remove from queue
        autonomousState.queued = autonomousState.queued.filter(a => a.id !== action.id);

        // Accept the action if we have the card element
        if (action.cardEl) {
            handleCardAction('accept', action.id, action.cardEl);
        }

        // Add to completed
        autonomousState.completed.unshift({
            id: action.id,
            title: action.title,
            type: 'ai-accepted',
            completed_at: new Date()
        });

        // Show toast
        showActivityToast('ai-accepted', action.title);

        // Re-render feed (safe now since action was removed)
        renderAutonomousFeed();
        // NOTE: Removed reset logic - actions are processed one at a time
        // and each has its own countdown. No need to reset remaining items.
    }

    /**
     * Stop the countdown timer
     */
    function stopCountdownTimer() {
        if (autonomousState.countdownInterval) {
            clearInterval(autonomousState.countdownInterval);
            autonomousState.countdownInterval = null;
        }
    }

    /**
     * Format time ago - handles both Date objects and ISO strings
     */
    function formatTimeAgo(input) {
        if (!input) return 'Just now';

        const date = input instanceof Date ? input : new Date(input);
        if (isNaN(date.getTime())) return 'Just now';

        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    // Activity toast notification system
    function showActivityToast(type, message) {
        // Get or create toast container
        let container = document.getElementById('activity-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'activity-toast-container';
            container.className = 'activity-toast-container';
            document.body.appendChild(container);
        }

        const icons = {
            'email-sent': '✉️',
            'birthday-reward': '🎂',
            'points-earned': '⭐',
            'automation-triggered': '⚡',
            'visit-logged': '📍',
            'ai-accepted': '🤖'
        };

        const toast = document.createElement('div');
        toast.className = `activity-toast type-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || '🔔'}</span>
            <span class="toast-message">${escapeHtml(message)}</span>
            <span class="toast-time">Just now</span>
            <button class="toast-dismiss" aria-label="Dismiss">&times;</button>
        `;

        container.appendChild(toast);

        function dismissToast() {
            toast.classList.add('dismissing');
            setTimeout(() => toast.remove(), 300);
        }

        // Auto-dismiss after 4 seconds
        const autoTimer = setTimeout(dismissToast, 4000);

        // X button dismiss
        toast.querySelector('.toast-dismiss').addEventListener('click', () => {
            clearTimeout(autoTimer);
            dismissToast();
        });

        // Swipe-to-dismiss
        let startX = 0, currentX = 0, isDragging = false;
        toast.addEventListener('pointerdown', (e) => {
            startX = e.clientX;
            currentX = 0;
            isDragging = true;
            toast.style.transition = 'none';
            toast.setPointerCapture(e.pointerId);
        });
        toast.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            currentX = e.clientX - startX;
            toast.style.transform = `translateX(${currentX}px)`;
            toast.style.opacity = String(1 - Math.abs(currentX) / 200);
        });
        toast.addEventListener('pointerup', () => {
            if (!isDragging) return;
            isDragging = false;
            if (Math.abs(currentX) > 80) {
                clearTimeout(autoTimer);
                toast.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
                toast.style.transform = `translateX(${currentX > 0 ? 300 : -300}px)`;
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 200);
            } else {
                toast.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            }
        });
    }

    // Activity card types for live activity feed
    const activityIcons = {
        'email-sent': '✉️',
        'birthday-reward': '🎂',
        'points-earned': '⭐',
        'automation-triggered': '⚡',
        'visit-logged': '📍',
        'ai-accepted': '🤖',
        'reward-redeemed': '🎁',
        'tier-upgraded': '👑',
        'referral-completed': '🤝',
        'review-received': '📝'
    };

    const activityLabels = {
        'email-sent': 'Email Sent',
        'birthday-reward': 'Birthday Reward',
        'points-earned': 'Points Earned',
        'automation-triggered': 'Automation',
        'visit-logged': 'Visit Logged',
        'ai-accepted': 'AI Action',
        'reward-redeemed': 'Reward Redeemed',
        'tier-upgraded': 'Tier Upgrade',
        'referral-completed': 'Referral',
        'review-received': 'Review'
    };

    function createActivityCard(event) {
        const card = document.createElement('div');
        card.className = `activity-card type-${event.type}`;
        card.dataset.eventId = event.id || '';
        card.dataset.timestamp = event.created_at || new Date().toISOString();

        const icon = activityIcons[event.type] || '🔔';
        const label = activityLabels[event.type] || 'Activity';
        const timeAgo = event.created_at ? formatTimeAgo(event.created_at) : 'Just now';

        card.innerHTML = `
            <div class="activity-card-icon">${icon}</div>
            <div class="activity-card-content">
                <div class="activity-card-header">
                    <span class="activity-card-label">${label}</span>
                    <span class="activity-card-time">${timeAgo}</span>
                </div>
                <div class="activity-card-title">${escapeHtml(event.title || '')}</div>
                ${event.description ? `<div class="activity-card-desc">${escapeHtml(event.description)}</div>` : ''}
                ${event.member_name ? `<div class="activity-card-member">👤 ${escapeHtml(event.member_name)}</div>` : ''}
            </div>
        `;

        return card;
    }

    function addActivityCard(event) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const card = createActivityCard(event);

        // Insert at top of feed
        if (feed.firstChild) {
            feed.insertBefore(card, feed.firstChild);
        } else {
            feed.appendChild(card);
        }

        // Animate in
        card.style.animation = 'cardSlideIn 0.4s ease forwards';

        // Also show toast
        showActivityToast(event.type, event.title);

        // Update badge count
        updateActivityBadge();
    }

    function updateActivityBadge() {
        const badge = document.getElementById('activity-badge');
        const menuBadge = document.getElementById('activity-badge-menu');
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const activityCards = feed.querySelectorAll('.activity-card');
        const count = activityCards.length;
        [badge, menuBadge].forEach(function(b) {
            if (!b) return;
            if (count > 0) { b.textContent = count; b.style.display = ''; }
            else { b.style.display = 'none'; }
        });
    }

    function addCompletedCard(detail) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        counterState.completed++;
        counterState.pending = Math.max(0, counterState.pending - 1);
        updateCounts();

        const card = document.createElement('div');
        card.className = 'insight-card type-completed';
        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
                <div class="insight-card-title">${escapeHtml(detail.name || 'Action completed')}</div>
                <div class="insight-card-time">Just now</div>
            </div>
            <div class="insight-card-body">Successfully implemented.</div>
        `;

        feed.insertBefore(card, feed.firstChild);
    }

    function renderCardsForMode(mode) {
        // Re-render card actions based on mode
        document.querySelectorAll('.insight-card').forEach(card => {
            const isCompleted = card.classList.contains('type-completed');
            if (isCompleted) return;

            const recId = card.dataset.recId;
            const isDismissed = card.dataset.status === 'dismissed';
            const actions = card.querySelector('.insight-card-actions');
            if (!actions) return;

            if (isDismissed) return; // dismissed cards keep their Re-accept button

            if (mode === 'autonomous') {
                const action = autonomousState.queued.find(a => a.id === recId);
                const countdownHtml = action
                    ? `<span class="card-countdown" data-rec-id="${recId}">Sending in ${action.countdown}s</span>`
                    : '';
                actions.innerHTML = `
                    <button class="card-action-btn ghost detail-toggle" data-action="view" data-rec-id="${recId}">View Details</button>
                    <div class="insight-card-actions-right">
                        ${countdownHtml}
                        <button class="card-action-btn secondary" data-action="skip" data-rec-id="${recId}">Skip</button>
                    </div>
                `;
            } else {
                actions.innerHTML = `
                    <button class="card-action-btn ghost detail-toggle" data-action="view" data-rec-id="${recId}">View Details</button>
                    <div class="insight-card-actions-right">
                        <button class="card-action-btn secondary" data-action="dismiss" data-rec-id="${recId}">Dismiss</button>
                        <button class="card-action-btn primary" data-action="accept" data-rec-id="${recId}">Accept</button>
                    </div>
                `;
            }

            // Re-bind handlers
            actions.querySelectorAll('.card-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleCardAction(btn.dataset.action, btn.dataset.recId, card);
                });
            });
        });
    }

    function updateCounts() {
        const pendingEl = document.getElementById('cards-pending');
        const completedEl = document.getElementById('cards-completed');
        if (pendingEl) {
            pendingEl.textContent = `${counterState.pending} pending`;
            pendingEl.className = 'stat-mini' + (counterState.pending > 0 ? ' pending' : '');
        }
        if (completedEl) {
            completedEl.textContent = `${counterState.completed} completed`;
            completedEl.className = 'stat-mini' + (counterState.completed > 0 ? ' completed' : '');
        }
    }

    // Helpers

    function mapRecType(type) {
        const map = { opportunity: 'insight', efficiency: 'insight', growth: 'insight', risk: 'action', automation: 'data' };
        return map[type] || 'insight';
    }

    function getCardIcon(type) {
        const icons = {
            opportunity: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
            efficiency: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
            growth: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>',
            risk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
            automation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m8.66-14.5l-1.73 1m-13.86 8l-1.73 1m16.59 3.5l-1.73-1M4.34 6.5l-1.73-1M23 12h-2M3 12H1"/></svg>',
        };
        return icons[type] || icons.opportunity;
    }

    function escapeHtml(str) {
        if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
            return AppUtils.escapeHtml(str);
        }
        // Fallback for safety
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // =============================================
    // AI PROMPT INPUT HANDLING
    // =============================================

    // Prompt/Intelligence state
    const promptState = {
        sessionId: null,
        usage: { used: 0, limit: 0, unlimited: false },
        loading: false,
        orgData: null,
        threadId: null
    };

    // Expose thread ID setter for ChatThread module
    window.setCurrentThreadId = function(threadId) {
        promptState.threadId = threadId;
    };

    function initPrompt() {
        // Generate session ID for conversation continuity
        promptState.sessionId = crypto.randomUUID();

        setupPromptInput();
        loadPromptUsage();
        loadOrgDataForSuggestions();
    }

    function setupPromptInput() {
        const textarea = document.getElementById('prompt-textarea');
        const sendBtn = document.getElementById('prompt-send-btn');
        const charCount = document.getElementById('prompt-char-count');
        const suggestions = document.getElementById('crown-suggestions');

        if (!textarea || !sendBtn) return;

        // Auto-expand textarea
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

            // Update character count
            const len = textarea.value.length;
            if (charCount) {
                charCount.textContent = `${len}/500`;
                charCount.classList.remove('warning', 'critical');
                if (len > 400) charCount.classList.add('warning');
                if (len > 475) charCount.classList.add('critical');
            }

            // Enable/disable send button
            sendBtn.disabled = len === 0 || promptState.loading;
        });

        // Enter to send (Shift+Enter for newline)
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // Double-submit prevention: check both button state AND loading flag
                if (!sendBtn.disabled && !promptState.loading && textarea.value.trim()) {
                    submitPrompt();
                }
            }
        });

        // Send button click with double-submit prevention
        sendBtn.addEventListener('click', () => {
            if (!promptState.loading && textarea.value.trim()) {
                submitPrompt();
            }
        });

        // Suggestion pill clicks
        if (suggestions) {
            suggestions.addEventListener('click', (e) => {
                const pill = e.target.closest('.suggestion-pill');
                if (pill && textarea) {
                    textarea.value = pill.textContent;
                    textarea.dispatchEvent(new Event('input'));
                    textarea.focus();
                }
            });
        }

        // Upgrade button
        const upgradeBtn = document.getElementById('prompt-upgrade-btn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => {
                window.location.href = '/app/upgrade.html';
            });
        }
    }

    async function loadPromptUsage() {
        // Check plan limits using capability-based functions
        if (typeof AppUtils === 'undefined' || typeof getCurrentUser !== 'function') return;

        try {
            const user = await getCurrentUser();
            if (!user) return;

            promptState.orgData = await AppUtils.loadOrganization(supabase, user.id);
            if (!promptState.orgData || !promptState.orgData.organization) return;

            const org = promptState.orgData.organization;

            // Use new capability-based check (royal_chat)
            const canUse = typeof canUseRoyalAI === 'function'
                ? canUseRoyalAI(org)
                : (typeof PlanLimits !== 'undefined' && PlanLimits.canUseIntelligence
                    ? (await PlanLimits.canUseIntelligence(org)).allowed
                    : true);

            promptState.usage.allowed = canUse;
            promptState.usage.message = !canUse && typeof getFeatureUpgradeMessage === 'function'
                ? getFeatureUpgradeMessage('royal_chat', org)
                : '';

            // Get limit details from plan using getOrgLimits
            const limits = typeof getOrgLimits === 'function'
                ? getOrgLimits(org)
                : (typeof PlanLimits !== 'undefined' ? PlanLimits.getOrgLimits(org) : {});

            // No monthly quota anymore - Royal AI is capability-based
            promptState.usage.limit = limits.max_automations || 0;
            promptState.usage.unlimited = limits.max_automations === -1;

            updatePromptUI();
        } catch (e) {
            console.warn('Failed to load prompt usage:', e);
        }
    }

    function updatePromptUI() {
        const overlay = document.getElementById('prompt-upgrade-overlay');
        const usageBadge = document.getElementById('prompt-usage-badge');
        const usageCount = document.getElementById('prompt-usage-count');
        const textarea = document.getElementById('prompt-textarea');
        const sendBtn = document.getElementById('prompt-send-btn');

        // Show upgrade overlay if not allowed
        if (overlay) {
            overlay.style.display = promptState.usage.allowed === false ? 'flex' : 'none';
        }

        // Show usage badge (except for unlimited)
        if (usageBadge && usageCount && !promptState.usage.unlimited) {
            const remaining = promptState.usage.limit - promptState.usage.used;
            usageBadge.style.display = 'block';
            usageCount.textContent = `${promptState.usage.used}/${promptState.usage.limit}`;

            usageBadge.classList.remove('warning', 'critical');
            if (remaining <= 5) usageBadge.classList.add('warning');
            if (remaining <= 0) usageBadge.classList.add('critical');

            // Disable input if at limit
            if (remaining <= 0 && textarea && sendBtn) {
                textarea.disabled = true;
                sendBtn.disabled = true;
                textarea.placeholder = 'Monthly limit reached. Upgrade for more.';
            }
        } else if (usageBadge) {
            usageBadge.style.display = 'none';
        }
    }

    async function loadOrgDataForSuggestions() {
        if (typeof supabase === 'undefined' || typeof AppUtils === 'undefined' || typeof getCurrentUser !== 'function') return;

        try {
            // Verify we have a valid session before making queries
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                console.warn('No session, showing default suggestions');
                renderSuggestedQuestions();
                return;
            }

            const user = await getCurrentUser();
            if (!user) return;

            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult || !orgResult.organization) return;

            const orgId = orgResult.organization.id;
            const org = orgResult.organization;

            // Gather business context for suggestions
            // Note: Use customers table (app_members uses app_id, not organization_id)
            // Only query columns that are guaranteed to exist (business intel columns may not be migrated yet)
            const [customersRes, automationsRes, projectsRes] = await Promise.all([
                supabase.from('customers').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
                supabase.from('automations').select('type, is_active').eq('organization_id', orgId),
                supabase.from('projects').select('industry, city, state, pain_points, goals').eq('organization_id', orgId).limit(1)
            ]);

            const project = projectsRes.data?.[0] || {};

            promptState.orgData = {
                customerCount: customersRes.count || 0,
                automations: automationsRes.data || [],
                industry: project.industry || null,
                city: project.city || null,
                businessName: org.name || null,
                // Business intel fields from organizations table (may not exist yet)
                monthlyRevenue: org.monthly_revenue || null,
                revenueGoal: org.revenue_goal || null,
                slowDays: org.slow_days || [],
                avgTransactionValue: org.avg_transaction_value || null,
                peakMonths: org.peak_months || [],
                // Business intel fields from projects table (queried separately if columns exist)
                painPoints: project.pain_points || [],
                goals: project.goals || [],
                // These fields may not exist - set to null (will be populated when migration runs)
                targetAgeRange: null,
                retentionDriver: null,
                competitors: null,
                currentChallenge: null,
                successVision: null,
                // Org metadata
                createdAt: org.created_at || null,
                state: project.state || null
            };

            // Set currency based on country
            orgCurrency = getCurrencyForCountry('US'); // Default to US (country field not in schema)

            // Check which automations exist
            const automationTypes = new Set(promptState.orgData.automations.map(a => a.type));
            promptState.orgData.hasBirthdayAutomation = automationTypes.has('birthday');
            promptState.orgData.hasWinBackAutomation = automationTypes.has('win_back') || automationTypes.has('re-engagement');
            promptState.orgData.hasWelcomeAutomation = automationTypes.has('welcome');
            promptState.orgData.activeAutomationCount = promptState.orgData.automations.filter(a => a.is_active).length;

            renderSuggestedQuestions();
        } catch (e) {
            console.warn('Failed to load org data for suggestions:', e);
            // Show default suggestions
            renderSuggestedQuestions();
        }
    }

    // ===== Knowledge Tab =====

    let knowledgeLoaded = false;

    async function loadKnowledge() {
        if (knowledgeLoaded) return;

        const feed = document.getElementById('knowledge-feed');
        const empty = document.getElementById('knowledge-empty');
        if (!feed) return;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const user = await getCurrentUser();
            if (!user) return;

            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult || !orgResult.organization) return;

            const { data: knowledge, error } = await supabase
                .from('business_knowledge')
                .select('id, layer, category, fact, confidence, importance, source_type, created_at')
                .eq('organization_id', orgResult.organization.id)
                .eq('status', 'active')
                .order('importance', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                console.error('Failed to load knowledge:', error);
                return;
            }

            if (!knowledge || knowledge.length === 0) {
                if (empty) empty.style.display = 'flex';
                feed.innerHTML = '';
                return;
            }

            if (empty) empty.style.display = 'none';

            // Fetch knowledge usage data (which facts are used by actions)
            let usageMap = {};
            try {
                const { data: usage } = await supabase.rpc('get_knowledge_usage', {
                    p_org_id: orgResult.organization.id
                });
                if (usage) {
                    for (const row of usage) {
                        usageMap[row.knowledge_id] = {
                            count: row.action_count,
                            types: row.action_types || []
                        };
                    }
                }
            } catch (err) {
                // Non-critical — show learnings without badges if RPC not yet deployed
                console.warn('Knowledge usage fetch failed (RPC may not be deployed yet):', err.message);
            }

            // Fetch knowledge score for the AI Understanding widget
            let scoreHtml = '';
            try {
                const { data: scoreData } = await supabase.rpc('get_knowledge_score', {
                    p_org_id: orgResult.organization.id
                });
                if (scoreData && scoreData.length > 0) {
                    const scoreLayers = {
                        operational: 'Operations', customer: 'Customers', financial: 'Financial',
                        market: 'Market', growth: 'Growth', regulatory: 'Compliance'
                    };
                    const overallScore = Math.round(scoreData.reduce((sum, s) => sum + s.layer_score, 0) / scoreData.length);
                    scoreHtml = `
                        <div class="knowledge-score-widget">
                            <div class="knowledge-score-header">
                                <span class="knowledge-score-icon">&#x1F9E0;</span>
                                <span class="knowledge-score-title">AI Understanding</span>
                                <span class="knowledge-score-value">${overallScore}%</span>
                                <button class="knowledge-score-toggle" aria-label="Toggle details" aria-expanded="true">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.427 5.427a.75.75 0 011.06-.013L8 7.782l2.513-2.368a.75.75 0 111.028 1.092l-3 2.824a.75.75 0 01-1.028 0l-3-2.824a.75.75 0 01-.086-1.079z"/></svg>
                                </button>
                            </div>
                            <div class="knowledge-score-bar">
                                <div class="knowledge-score-fill" style="width: ${overallScore}%"></div>
                            </div>
                            <div class="knowledge-score-layers">
                                ${scoreData.map(s => {
                                    const icon = s.layer_score >= 60 ? '&#x2705;' : s.layer_score > 0 ? '&#x26A0;&#xFE0F;' : '&#x274C;';
                                    const label = scoreLayers[s.layer] || s.layer;
                                    const tellAi = s.layer_score < 60
                                        ? `<button class="knowledge-tell-ai-btn" data-layer="${AppUtils.escapeHtml(s.layer)}">Tell AI</button>`
                                        : '';
                                    return `<div class="knowledge-score-layer">
                                        <span class="knowledge-score-layer-icon">${icon}</span>
                                        <span class="knowledge-score-layer-name">${label}</span>
                                        <span class="knowledge-score-layer-count">${s.fact_count} facts</span>
                                        ${tellAi}
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>`;
                }
            } catch (err) {
                console.warn('Knowledge score fetch failed (RPC may not be deployed yet):', err.message);
            }

            // Action type display labels
            const actionTypeLabels = {
                create_automation: 'Automation',
                create_announcement: 'Announcement',
                send_message: 'Message',
                create_promotion: 'Promotion',
                award_points: 'Points Award',
                create_reward: 'Reward'
            };

            // Group by layer
            const groups = {};
            const layerLabels = {
                operational: 'Operations', customer: 'Customers', financial: 'Financial',
                market: 'Market', growth: 'Growth', regulatory: 'Compliance'
            };
            const layerIcons = {
                operational: '\u2699\uFE0F', customer: '\uD83D\uDC65', financial: '\uD83D\uDCB0',
                market: '\uD83D\uDCCA', growth: '\uD83D\uDE80', regulatory: '\uD83D\uDCCB'
            };

            for (const k of knowledge) {
                if (!groups[k.layer]) groups[k.layer] = [];
                groups[k.layer].push(k);
            }

            feed.innerHTML = scoreHtml + Object.entries(groups).map(([layer, facts]) => `
                <div class="knowledge-group">
                    <div class="knowledge-group-header">
                        <span class="knowledge-group-icon">${layerIcons[layer] || '\uD83D\uDCDD'}</span>
                        <span class="knowledge-group-title">${layerLabels[layer] || layer}</span>
                        <span class="knowledge-group-count">${facts.length}</span>
                    </div>
                    <div class="knowledge-group-facts">
                        ${facts.map(f => {
                            const usage = usageMap[f.id];
                            const usageBadge = usage
                                ? `<div class="knowledge-usage-badge">
                                    <span class="knowledge-usage-icon">&#x1F517;</span>
                                    <span class="knowledge-usage-label">Used by: ${usage.types.map(t => AppUtils.escapeHtml(actionTypeLabels[t] || t)).join(', ')}</span>
                                   </div>`
                                : '';
                            return `
                            <div class="knowledge-fact ${AppUtils.escapeHtml(f.importance)}${usage ? ' has-usage' : ''}" data-fact-id="${AppUtils.escapeHtml(f.id)}">
                                <button class="knowledge-dismiss" data-id="${AppUtils.escapeHtml(f.id)}" title="Dismiss">&times;</button>
                                <div class="knowledge-fact-text">${AppUtils.escapeHtml(f.fact)}</div>
                                <div class="knowledge-fact-meta">
                                    <span class="knowledge-confidence" title="Confidence">${Math.round(f.confidence * 100)}%</span>
                                    <span class="knowledge-source">${AppUtils.escapeHtml(f.source_type)}</span>
                                    <span class="knowledge-date">${new Date(f.created_at).toLocaleDateString()}</span>
                                </div>
                                ${usageBadge}
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            `).join('');

            // Dismiss handler via event delegation
            feed.addEventListener('click', async function(e) {
                const dismissBtn = e.target.closest('.knowledge-dismiss');
                if (!dismissBtn) return;

                const factId = dismissBtn.dataset.id;
                const factEl = dismissBtn.closest('.knowledge-fact');
                if (!factEl) return;

                // Fade out
                factEl.style.opacity = '0';
                setTimeout(async () => {
                    const groupEl = factEl.closest('.knowledge-group');
                    factEl.remove();

                    // Update group count
                    if (groupEl) {
                        const remaining = groupEl.querySelectorAll('.knowledge-fact').length;
                        const countEl = groupEl.querySelector('.knowledge-group-count');
                        if (countEl) countEl.textContent = remaining;
                        if (remaining === 0) groupEl.remove();
                    }
                }, 300);

                // Invalidate in DB
                try {
                    await supabase
                        .from('business_knowledge')
                        .update({ status: 'invalidated' })
                        .eq('id', factId);
                } catch (err) {
                    console.error('Failed to dismiss knowledge:', err);
                }
            });

            // Toggle collapse on AI Understanding widget
            feed.addEventListener('click', function(e) {
                const toggle = e.target.closest('.knowledge-score-toggle');
                if (!toggle) return;
                const widget = toggle.closest('.knowledge-score-widget');
                if (!widget) return;
                widget.classList.toggle('collapsed');
                toggle.setAttribute('aria-expanded', String(!widget.classList.contains('collapsed')));
            });

            // "Tell AI" button handler
            feed.addEventListener('click', function(e) {
                const tellBtn = e.target.closest('.knowledge-tell-ai-btn');
                if (!tellBtn) return;

                const layer = tellBtn.dataset.layer;

                // In onboarding mode: show a targeted discovery question for this layer
                if (onboardingActive) {
                    const categories = LAYER_TO_CATEGORIES[layer] || [];
                    if (categories.length === 0) return;

                    const targetQ = INFO_REQUEST_QUESTIONS.find(q =>
                        categories.includes(q.category) && !infoRequestState.asked.has(q.id)
                    );

                    if (targetQ) {
                        const existing = feed.querySelector('.info-request-card');
                        if (existing) existing.remove();
                        infoRequestState.pending = null;
                        showLearningsDiscoveryCard(feed, targetQ);
                    } else {
                        tellBtn.textContent = 'Done';
                        tellBtn.disabled = true;
                        setTimeout(() => { tellBtn.textContent = 'Tell AI'; tellBtn.disabled = false; }, 1500);
                    }
                    return;
                }

                // Normal mode: open Chat tab with pre-filled prompt
                const layerPrompts = {
                    operational: 'Tell me about your operations — hours, staffing, daily workflow, and key processes.',
                    customer: 'Tell me about your customers — who are they, what do they like, how often do they visit?',
                    financial: 'Tell me about your financials — average ticket size, margins, pricing strategy.',
                    market: 'Tell me about your market — main competitors, your positioning, local trends.',
                    growth: 'Tell me about your growth goals — what are you working toward this quarter?',
                    regulatory: 'Tell me about any regulations or compliance requirements for your business.'
                };
                const prompt = layerPrompts[layer] || 'Tell me more about your business.';

                const chatTab = document.querySelector('[data-tab="chat"]');
                if (chatTab) chatTab.click();

                setTimeout(() => {
                    const chatInput = document.getElementById('prompt-input') || document.querySelector('.chat-input textarea');
                    if (chatInput) {
                        chatInput.value = prompt;
                        chatInput.focus();
                    }
                }, 100);
            });

            knowledgeLoaded = true;

            // Show a discovery question at the top of the Learnings feed
            showLearningsDiscoveryCard(feed);
        } catch (err) {
            console.error('Error loading knowledge:', err);
        }
    }

    async function refreshKnowledgeScore() {
        const feed = document.getElementById('knowledge-feed');
        if (!feed) return;
        const widget = feed.querySelector('.knowledge-score-widget');
        if (!widget) return;

        try {
            const user = await getCurrentUser();
            if (!user) return;
            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult?.organization) return;

            const { data: scoreData } = await supabase.rpc('get_knowledge_score', {
                p_org_id: orgResult.organization.id
            });
            if (!scoreData || scoreData.length === 0) return;

            const scoreLayers = {
                operational: 'Operations', customer: 'Customers', financial: 'Financial',
                market: 'Market', growth: 'Growth', regulatory: 'Compliance'
            };
            const overallScore = Math.round(scoreData.reduce((sum, s) => sum + s.layer_score, 0) / scoreData.length);

            const valueEl = widget.querySelector('.knowledge-score-value');
            if (valueEl) valueEl.textContent = overallScore + '%';

            const fillEl = widget.querySelector('.knowledge-score-fill');
            if (fillEl) fillEl.style.width = overallScore + '%';

            const layersEl = widget.querySelector('.knowledge-score-layers');
            if (layersEl) {
                layersEl.innerHTML = scoreData.map(s => {
                    const icon = s.layer_score >= 60 ? '&#x2705;' : s.layer_score > 0 ? '&#x26A0;&#xFE0F;' : '&#x274C;';
                    const label = scoreLayers[s.layer] || s.layer;
                    const tellAi = s.layer_score < 60
                        ? `<button class="knowledge-tell-ai-btn" data-layer="${AppUtils.escapeHtml(s.layer)}">Tell AI</button>`
                        : '';
                    return `<div class="knowledge-score-layer">
                        <span class="knowledge-score-layer-icon">${icon}</span>
                        <span class="knowledge-score-layer-name">${label}</span>
                        <span class="knowledge-score-layer-count">${s.fact_count} facts</span>
                        ${tellAi}
                    </div>`;
                }).join('');
            }
        } catch (err) {
            console.warn('Score refresh failed:', err.message);
        }
    }

    /**
     * Show a discovery input card at the top of the Learnings tab feed.
     * Reuses the existing createInfoRequestCard() system but targets the knowledge feed.
     */
    function showLearningsDiscoveryCard(feedEl, forceQuestion) {
        if (!feedEl) return;
        // Don't show if one is already pending (unless forcing a specific question)
        if (infoRequestState.pending && !forceQuestion) return;

        const question = forceQuestion || getNextInfoQuestion();
        if (!question) return;

        infoRequestState.pending = question;
        const card = createInfoRequestCard(question);
        card.classList.add('learnings-discovery-card');

        // Insert AFTER the knowledge score widget (so widget stays on top)
        const scoreWidget = feedEl.querySelector('.knowledge-score-widget');
        if (scoreWidget && scoreWidget.nextSibling) {
            feedEl.insertBefore(card, scoreWidget.nextSibling);
        } else if (scoreWidget) {
            feedEl.appendChild(card);
        } else if (feedEl.firstChild) {
            feedEl.insertBefore(card, feedEl.firstChild);
        } else {
            feedEl.appendChild(card);
        }
    }

    function generateSuggestedQuestions() {
        const questions = [];

        if (!promptState.orgData) {
            // Default suggestions when no data
            return [
                'What automations should I set up?',
                'How can I increase repeat visits?',
                'What loyalty programs work best?'
            ];
        }

        // PRIORITY 1: Pain point driven (most personalized)
        if (promptState.orgData.painPoints && promptState.orgData.painPoints.length > 0) {
            questions.push(`How do I solve "${promptState.orgData.painPoints[0]}"?`);
        }

        // PRIORITY 2: Goal driven
        if (promptState.orgData.goals && promptState.orgData.goals.length > 0) {
            questions.push(`What's the best way to ${promptState.orgData.goals[0]}?`);
        }

        // PRIORITY 3: Current challenge (from Intel questionnaire)
        if (promptState.orgData.currentChallenge) {
            questions.push(`Help me with: ${promptState.orgData.currentChallenge}`);
        }

        // PRIORITY 4: Revenue goals
        if (promptState.orgData.revenueGoal && promptState.orgData.monthlyRevenue) {
            const gap = promptState.orgData.revenueGoal - promptState.orgData.monthlyRevenue;
            if (gap > 0) {
                questions.push(`How can I increase revenue by $${gap.toLocaleString()}/month?`);
            }
        }

        // PRIORITY 5: Slow days optimization
        if (promptState.orgData.slowDays && promptState.orgData.slowDays.length > 0) {
            const slowDay = promptState.orgData.slowDays[0];
            questions.push(`How do I boost traffic on ${slowDay}s?`);
        }

        // PRIORITY 6: Based on org lifecycle
        if (promptState.orgData.createdAt) {
            const daysSinceCreation = Math.floor((Date.now() - new Date(promptState.orgData.createdAt).getTime()) / 86400000);
            if (daysSinceCreation < 7) {
                questions.push("What's the best first step for a new loyalty program?");
            } else if (daysSinceCreation < 30) {
                questions.push("How do I get my first 100 loyalty members?");
            }
        }

        // PRIORITY 7: Based on customer count
        if (promptState.orgData.customerCount === 0) {
            questions.push('How do I import my first customers?');
        } else if (promptState.orgData.customerCount < 50) {
            questions.push('How can I grow my customer base?');
        } else if (promptState.orgData.customerCount > 500) {
            questions.push('How can I improve visit frequency?');
        }

        // PRIORITY 8: Based on automations
        if (promptState.orgData.activeAutomationCount >= 3) {
            questions.push('How can I layer automations for maximum impact?');
        } else {
            if (!promptState.orgData.hasBirthdayAutomation) {
                questions.push('Should I set up birthday rewards?');
            }
            if (!promptState.orgData.hasWinBackAutomation) {
                questions.push('How do I win back inactive customers?');
            }
            if (!promptState.orgData.hasWelcomeAutomation && promptState.orgData.customerCount > 0) {
                questions.push('What should my welcome message say?');
            }
        }

        // PRIORITY 9: Industry-specific (lower priority now)
        if (questions.length < 4) {
            if (promptState.orgData.industry === 'salon' || promptState.orgData.industry === 'beauty') {
                questions.push('What loyalty programs work best for salons?');
            } else if (promptState.orgData.industry === 'restaurant' || promptState.orgData.industry === 'food') {
                questions.push('How do restaurants increase midweek traffic?');
            } else if (promptState.orgData.industry === 'fitness' || promptState.orgData.industry === 'gym') {
                questions.push('How do gyms improve member retention?');
            } else if (promptState.orgData.industry === 'retail') {
                questions.push('What promotions drive retail repeat purchases?');
            }
        }

        // PRIORITY 10: Success vision
        if (promptState.orgData.successVision && questions.length < 4) {
            questions.push(`How do I achieve: ${promptState.orgData.successVision.substring(0, 50)}...`);
        }

        return questions.slice(0, 4); // Max 4 suggestions
    }

    function renderSuggestedQuestions() {
        const container = document.getElementById('crown-suggestions');
        if (!container) return;

        const questions = generateSuggestedQuestions();
        container.innerHTML = questions.map(q =>
            `<button class="suggestion-pill" aria-label="Suggested question: ${escapeHtml(q)}">${escapeHtml(q)}</button>`
        ).join('');
    }

    async function submitPrompt() {
        const textarea = document.getElementById('prompt-textarea');
        const sendBtn = document.getElementById('prompt-send-btn');
        if (!textarea || !sendBtn) return;

        // IMMEDIATE guards - check both disabled state AND flag to close race window
        if (sendBtn.disabled || promptState.loading) {
            return;
        }
        if (!textarea.value.trim()) return;

        // SET IMMEDIATELY before any async work or logic
        promptState.loading = true;
        sendBtn.disabled = true;
        textarea.disabled = true;

        const prompt = textarea.value.trim();

        // Check usage limit
        if (!promptState.usage.unlimited && promptState.usage.used >= promptState.usage.limit) {
            alert(window.t ? window.t('errors.promptLimit') : 'You\'ve reached your monthly prompt limit. Upgrade your plan for more.');
            // Reset loading state since we're not proceeding
            promptState.loading = false;
            sendBtn.disabled = false;
            textarea.disabled = false;
            return;
        }
        const svgIcon = sendBtn.querySelector('svg');
        const spinner = sendBtn.querySelector('.prompt-spinner');
        if (svgIcon) svgIcon.style.display = 'none';
        if (spinner) spinner.style.display = 'block';

        // Trigger crown analyzing state with enhanced animation
        if (typeof CrownScene !== 'undefined') {
            CrownScene.setState('analyzing');
            CrownScene.setGlow(1.3);  // Increase glow during thinking
        }
        updateStatus('analyzing');

        // Always switch to Chat tab and use chat mode when sending a message
        // This ensures the user sees the response regardless of which tab they were on
        if (typeof ChatThread !== 'undefined') {
            ChatThread.activateChatTab();
            ChatThread.appendMessage('user', prompt);
            ChatThread.appendTypingIndicator();
        }
        const activeMode = 'chat';  // Always use chat mode

        // Clear input immediately after capturing
        textarea.value = '';
        textarea.style.height = 'auto';
        const charCount = document.getElementById('prompt-char-count');
        if (charCount) charCount.textContent = '0/500';

        try {
            const response = await callRoyalAI(prompt, activeMode);

            // Increment usage
            promptState.usage.used++;
            updatePromptUI();

            // Update LLM model badge with actual model from response
            if (response.model) {
                const modelName = document.getElementById('llm-model-name');
                if (modelName) {
                    modelName.textContent = response.model;
                }
            }

            // Handle response based on mode
            if (activeMode === 'chat' && typeof ChatThread !== 'undefined') {
                // Remove typing indicator
                ChatThread.removeTypingIndicator();

                // Add assistant message
                if (response.message) {
                    ChatThread.appendMessage('assistant', response.message);
                }

                // If ideas were generated in chat mode, show them in Activity and notify
                if (response.ideas && response.ideas.length > 0) {
                    renderAIIdeas(response.ideas);
                    ChatThread.incrementActivityBadge();
                    // Also mention in chat
                    if (!response.message) {
                        ChatThread.appendMessage('assistant', `I have ${response.ideas.length} suggestion${response.ideas.length > 1 ? 's' : ''} for you! Check the Activity tab to see them.`);
                    }
                }

                ChatThread.scrollToBottom();

                // Update thread in list if new
                if (response.thread_id && response.thread_id !== promptState.threadId) {
                    promptState.threadId = response.thread_id;
                    const title = prompt.slice(0, 50) + (prompt.length > 50 ? '...' : '');
                    ChatThread.addNewThreadToList(response.thread_id, title);
                }
            } else {
                // Review mode - render idea cards
                if (response.ideas && response.ideas.length > 0) {
                    renderAIIdeas(response.ideas);
                }
            }

            // Update suggested questions if provided
            if (response.follow_up_questions && response.follow_up_questions.length > 0) {
                renderFollowUpQuestions(response.follow_up_questions);
            }

            // Success pulse
            if (typeof CrownScene !== 'undefined' && CrownScene.pulseOnce) {
                CrownScene.pulseOnce();
            }

            // Mark welcome banner AI card as complete after first successful chat
            if (typeof WelcomeBanner !== 'undefined' && WelcomeBanner.markAiComplete) {
                WelcomeBanner.markAiComplete();
            }

        } catch (e) {
            console.error('Prompt submission failed:', e);

            // Remove typing indicator on error
            if (activeMode === 'chat' && typeof ChatThread !== 'undefined') {
                ChatThread.removeTypingIndicator();
                ChatThread.appendMessage('assistant', 'Sorry, I encountered an error. Please try again.');
            } else {
                alert(window.t ? window.t('errors.failedResponse') : 'Failed to get response. Please try again.');
            }
        } finally {
            // Reset loading state
            promptState.loading = false;
            sendBtn.disabled = false;
            textarea.disabled = false;
            if (svgIcon) svgIcon.style.display = 'block';
            if (spinner) spinner.style.display = 'none';

            // Reset crown state
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState(modeState.current === 'autonomous' ? 'autonomous' : 'idle');
                CrownScene.setGlow(1.0);  // Reset glow
            }
            updateStatus(modeState.current === 'autonomous' ? 'autonomous' : 'idle');
        }
    }

    async function callRoyalAI(prompt, mode = 'review') {
        // FORCE server-side validation first - getUser() validates token, getSession() only returns cached
        // This fixes 401 errors when localStorage contains expired tokens
        let { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            // Try to refresh the session
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError || !refreshData?.session) {
                throw new Error('Your session has expired. Please refresh the page and log in again.');
            }
            // Re-fetch user after refresh
            const refreshedUser = await supabase.auth.getUser();
            user = refreshedUser.data.user;
            if (!user) {
                throw new Error('Failed to get user after session refresh. Please log in again.');
            }
        }

        // Get valid session with auto-refresh if token is expired/expiring
        let session = await getValidSession();

        if (!session || !session.access_token) {
            throw new Error('Your session has expired. Please refresh the page and log in again.');
        }

        const orgResult = await AppUtils.loadOrganization(supabase, user.id);
        if (!orgResult || !orgResult.organization) {
            throw new Error('Organization not found');
        }

        // Gather external context (weather, time, holidays)
        let externalContext = null;
        if (typeof ExternalContext !== 'undefined') {
            try {
                externalContext = await ExternalContext.gather({
                    city: promptState.orgData?.city,
                    state: promptState.orgData?.state,
                    timezone: orgResult.organization.timezone
                });
            } catch (e) {
                console.warn('Failed to gather external context:', e);
            }
        }

        const context = {
            industry: promptState.orgData?.industry || null,
            customerCount: promptState.orgData?.customerCount || 0,
            activeAutomations: promptState.orgData?.automations?.filter(a => a.is_active).map(a => a.type) || [],
            city: promptState.orgData?.city || null,
            state: promptState.orgData?.state || null,
            businessName: promptState.orgData?.businessName || orgResult.organization.name,
            // Extended context
            slowDays: promptState.orgData?.slowDays || null,
            monthlyRevenue: promptState.orgData?.monthlyRevenue || null,
            currentChallenge: promptState.orgData?.currentChallenge || null,
            // External context (weather, time, holidays)
            external: externalContext
        };

        // Build request body with thread support
        const requestBody = {
            prompt,
            session_id: promptState.sessionId,
            mode: mode,  // 'chat' or 'review'
            context
        };

        // Include thread_id if we have one (for continuing conversation)
        if (promptState.threadId) {
            requestBody.thread_id = promptState.threadId;
        }

        // Call Supabase Edge Function
        // Note: supabase.functions.invoke() should auto-include auth header when user is authenticated
        // But we explicitly pass it to ensure it's always included
        // Calling Edge Function (user ID logged for debugging, not PII)

        const { data, error } = await supabase.functions.invoke('royal-ai-prompt', {
            body: requestBody,
            headers: {
                Authorization: `Bearer ${session.access_token}`
            }
        });

        if (error) {
            // Classify error type
            const isAuthError = error?.status === 401 ||
                                error?.message?.includes('401') ||
                                error?.message?.includes('Unauthorized');
            const isServerError = error?.status >= 500 ||
                                  error?.message?.includes('500') ||
                                  error?.message?.includes('Internal Server Error');

            // Handle server errors immediately (no retry)
            if (isServerError) {
                throw new Error('Something went wrong on our end. Please try again in a moment.');
            }

            // Handle auth issues with automatic retry
            if (isAuthError) {
                // Refresh session and retry ONCE
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                if (refreshData?.session) {
                    // Retry the request with new token
                    const { data: retryData, error: retryError } = await supabase.functions.invoke('royal-ai-prompt', {
                        body: requestBody,
                        headers: {
                            Authorization: `Bearer ${refreshData.session.access_token}`
                        }
                    });
                    if (retryError) {
                        // Check if retry also failed due to server error
                        const retryIsServerError = retryError?.status >= 500 ||
                                                   retryError?.message?.includes('500');
                        if (retryIsServerError) {
                            throw new Error('Something went wrong on our end. Please try again in a moment.');
                        }
                        throw new Error('Session expired. Please refresh the page and log in again.');
                    }
                    // Update thread ID from retry response
                    if (retryData && retryData.thread_id) {
                        promptState.threadId = retryData.thread_id;
                    }
                    return retryData;
                }
                throw new Error('Session expired. Please refresh the page and log in again.');
            }
            throw error;
        }

        // Update current thread ID from response
        if (data && data.thread_id) {
            promptState.threadId = data.thread_id;
        }

        return data;
    }

    function renderAIIdeas(ideas) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        // Add ideas at the top of the feed
        ideas.forEach((idea, index) => {
            const card = createIdeaCard(idea);
            card.style.animationDelay = `${index * 0.1}s`;

            // Insert at the beginning
            if (feed.firstChild) {
                feed.insertBefore(card, feed.firstChild);
            } else {
                feed.appendChild(card);
            }
        });

        // Update pending count
        counterState.pending += ideas.length;
        updateCounts();
    }

    function createIdeaCard(idea) {
        const typeClass = mapIdeaType(idea.type);
        const icon = getIdeaIcon(idea.type);

        const card = document.createElement('div');
        card.className = `insight-card type-${typeClass}`;
        card.dataset.ideaType = idea.type;

        const impactBadge = idea.impact ? `<span class="impact-badge impact-${idea.impact}">${idea.impact}</span>` : '';

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">${icon}</div>
                <div class="insight-card-title">${escapeHtml(idea.title)}</div>
                ${impactBadge}
                <div class="insight-card-time">Just now</div>
            </div>
            <div class="insight-card-body">${escapeHtml(idea.description)}</div>
            ${idea.action_type && idea.action_type !== 'info' ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn primary" data-action="implement-idea" data-idea="${encodeURIComponent(JSON.stringify(idea))}">
                        ${idea.action_type === 'create_automation' ? 'Create Automation' : 'View Details'}
                    </button>
                    <button class="card-action-btn secondary" data-action="dismiss-idea">Not Now</button>
                </div>
            ` : ''}
        `;

        // Bind action handlers
        card.querySelectorAll('.card-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'implement-idea') {
                    const idea = JSON.parse(decodeURIComponent(btn.dataset.idea));
                    handleIdeaImplementation(idea, card);
                } else if (action === 'dismiss-idea') {
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(20px)';
                    setTimeout(() => {
                        card.remove();
                        counterState.pending = Math.max(0, counterState.pending - 1);
                        updateCounts();
                    }, 300);
                }
            });
        });

        return card;
    }

    function handleIdeaImplementation(idea, cardEl) {
        if (idea.action_type === 'create_automation' && idea.action_payload?.template_id) {
            // Navigate to automation creation with template
            window.location.href = `/app/automations.html?template=${idea.action_payload.template_id}`;
        } else if (idea.action_type === 'navigate' && idea.action_payload?.url) {
            window.location.href = idea.action_payload.url;
        } else {
            // Mark as acknowledged
            cardEl.classList.add('type-completed');
            const actions = cardEl.querySelector('.insight-card-actions');
            if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Noted</span>';
            counterState.pending = Math.max(0, counterState.pending - 1);
            counterState.completed++;
            updateCounts();
        }
    }

    function mapIdeaType(type) {
        const map = {
            'automation': 'data',
            'strategy': 'insight',
            'local-insight': 'insight',
            'industry-tip': 'insight'
        };
        return map[type] || 'insight';
    }

    function getIdeaIcon(type) {
        const icons = {
            'automation': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m8.66-14.5l-1.73 1m-13.86 8l-1.73 1m16.59 3.5l-1.73-1M4.34 6.5l-1.73-1M23 12h-2M3 12H1"/></svg>',
            'strategy': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
            'local-insight': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
            'industry-tip': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        return icons[type] || icons['strategy'];
    }

    function renderFollowUpQuestions(questions) {
        const container = document.getElementById('crown-suggestions');
        if (!container) return;

        container.innerHTML = questions.slice(0, 4).map(q =>
            `<button class="suggestion-pill">${escapeHtml(q)}</button>`
        ).join('');
    }

    // =============================================
    // INFO REQUEST CARDS (Proactive Data Gathering)
    // =============================================

    // Map discovery question categories to knowledge layers (for business_knowledge inserts)
    const CATEGORY_TO_LAYER = {
        revenue: 'financial',
        operations: 'operational',
        customer: 'customer',
        competition: 'market',
        seasonality: 'growth',
        goals: 'growth'
    };

    // Map score widget layers to discovery question categories
    const LAYER_TO_CATEGORIES = {
        operational: ['operations'],
        customer: ['customer'],
        financial: ['revenue'],
        market: ['competition'],
        growth: ['goals', 'seasonality'],
        regulatory: []
    };

    // Question pool for gathering missing business data
    const INFO_REQUEST_QUESTIONS = [
        // Revenue & Goals
        {
            id: 'monthly_revenue',
            category: 'revenue',
            priority: 'high',
            title: 'What\'s your average monthly revenue?',
            description: 'This helps me suggest realistic growth targets and promotions.',
            inputType: 'number',
            placeholder: 'e.g., 25000',
            field: 'monthly_revenue',
            table: 'organizations',
            isCurrency: true
        },
        {
            id: 'revenue_goal',
            category: 'revenue',
            priority: 'high',
            title: 'What\'s your revenue goal this quarter?',
            description: 'I\'ll help you create strategies to reach this target.',
            inputType: 'number',
            placeholder: 'e.g., 100000',
            field: 'revenue_goal',
            table: 'organizations',
            isCurrency: true
        },
        // Operations
        {
            id: 'slow_days',
            category: 'operations',
            priority: 'medium',
            title: 'What days are typically slowest?',
            description: 'I\'ll suggest promotions to boost traffic on slow days.',
            inputType: 'multi-select',
            options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            field: 'slow_days',
            table: 'organizations'
        },
        {
            id: 'avg_transaction',
            category: 'operations',
            priority: 'medium',
            title: 'What\'s your average transaction value?',
            description: 'This helps optimize reward thresholds and point values.',
            inputType: 'number',
            placeholder: 'e.g., 45',
            field: 'avg_transaction_value',
            table: 'organizations',
            isCurrency: true
        },
        // Customer
        {
            id: 'target_age_range',
            category: 'customer',
            priority: 'low',
            title: 'What\'s your ideal customer age range?',
            description: 'Helps me tailor messaging and promotion styles.',
            inputType: 'select',
            options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'All ages'],
            field: 'target_age_range',
            table: 'projects'
        },
        {
            id: 'retention_driver',
            category: 'customer',
            priority: 'medium',
            title: 'What brings customers back most often?',
            description: 'Understanding this helps me suggest impactful rewards.',
            inputType: 'text',
            placeholder: 'e.g., Great coffee, friendly staff, convenient location',
            field: 'retention_driver',
            table: 'projects'
        },
        // Competition
        {
            id: 'competitors',
            category: 'competition',
            priority: 'low',
            title: 'Who are your top 3 local competitors?',
            description: 'I\'ll help you differentiate and win customers.',
            inputType: 'text',
            placeholder: 'e.g., Joe\'s Cafe, Downtown Deli, Fresh Bites',
            field: 'competitors',
            table: 'projects'
        },
        // Seasonality
        {
            id: 'peak_months',
            category: 'seasonality',
            priority: 'medium',
            title: 'Which months are your busiest?',
            description: 'I\'ll plan campaigns around your seasonal patterns.',
            inputType: 'multi-select',
            options: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            field: 'peak_months',
            table: 'organizations'
        },
        // Goals & Challenges
        {
            id: 'current_challenge',
            category: 'goals',
            priority: 'high',
            title: 'What\'s your biggest challenge right now?',
            description: 'I\'ll prioritize solutions for your most pressing issue.',
            inputType: 'text',
            placeholder: 'e.g., Getting repeat visits, attracting new customers, staff retention',
            field: 'current_challenge',
            table: 'projects'
        },
        {
            id: 'success_vision',
            category: 'goals',
            priority: 'medium',
            title: 'What would "success" look like in 6 months?',
            description: 'I\'ll create a roadmap to get you there.',
            inputType: 'text',
            placeholder: 'e.g., 500 loyal customers, 20% revenue increase, full weekday bookings',
            field: 'success_vision',
            table: 'projects'
        }
    ];

    // Info request state
    const infoRequestState = {
        asked: new Set(),
        pending: null,
        dryTimer: null
    };

    function getNextInfoQuestion() {
        // Get questions not yet asked, prioritized by importance
        const priorityOrder = { 'high': 0, 'medium': 1, 'low': 2 };
        const available = INFO_REQUEST_QUESTIONS
            .filter(q => !infoRequestState.asked.has(q.id))
            .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        // Check what data we already have
        if (promptState.orgData) {
            // Skip questions we might already have answers to
            return available.find(q => {
                // Skip if we already have this data
                if (q.field === 'monthly_revenue' && promptState.orgData.monthlyRevenue) return false;
                if (q.field === 'slow_days' && promptState.orgData.slowDays?.length > 0) return false;
                // etc.
                return true;
            }) || available[0];
        }

        return available[0];
    }

    function createInfoRequestCard(question) {
        const card = document.createElement('div');
        card.className = 'insight-card type-info-request';
        card.dataset.questionId = question.id;
        card.dataset.field = question.field;
        card.dataset.table = question.table;
        card.dataset.status = 'pending';

        let inputHtml = '';
        switch (question.inputType) {
            case 'number':
                if (question.isCurrency) {
                    // Wrap in currency input with symbol and code
                    inputHtml = `
                        <div class="currency-input-wrapper">
                            <span class="currency-symbol">${orgCurrency.symbol}</span>
                            <input type="number"
                                   id="info-input-${question.id}"
                                   placeholder="${escapeHtml(question.placeholder || '')}"
                                   class="info-request-input">
                            <span class="currency-code">${orgCurrency.code}</span>
                        </div>
                    `;
                } else {
                    inputHtml = `
                        <input type="number"
                               id="info-input-${question.id}"
                               placeholder="${escapeHtml(question.placeholder || '')}"
                               class="info-request-input">
                    `;
                }
                break;
            case 'text':
                inputHtml = `
                    <input type="text"
                           id="info-input-${question.id}"
                           placeholder="${escapeHtml(question.placeholder || '')}"
                           class="info-request-input">
                `;
                break;
            case 'select':
                inputHtml = `
                    <select id="info-input-${question.id}" class="info-request-input">
                        <option value="">Select an option...</option>
                        ${question.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                `;
                break;
            case 'multi-select':
                inputHtml = `
                    <div class="multi-select-group" id="info-input-${question.id}">
                        ${question.options.map(opt => `
                            <label class="multi-select-option" data-value="${opt}">
                                <input type="checkbox" value="${opt}">
                                <span>${opt}</span>
                            </label>
                        `).join('')}
                    </div>
                `;
                break;
        }

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">🔍</div>
                <div class="insight-card-title">Help Royal AI help you</div>
                <div class="insight-card-time">Just now</div>
            </div>
            <div class="insight-card-body">
                <p style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(question.title)}</p>
                <p class="info-request-why">${escapeHtml(question.description)}</p>
            </div>
            <div class="insight-card-input">
                ${inputHtml}
            </div>
            <div class="insight-card-actions">
                <button class="card-action-btn secondary" data-action="skip">Skip</button>
                <button class="card-action-btn primary" data-action="submit">Submit</button>
            </div>
        `;

        // Multi-select toggle handling
        if (question.inputType === 'multi-select') {
            card.querySelectorAll('.multi-select-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.preventDefault();
                    opt.classList.toggle('selected');
                    const checkbox = opt.querySelector('input[type="checkbox"]');
                    if (checkbox) checkbox.checked = opt.classList.contains('selected');
                });
            });
        }

        // Button handlers
        card.querySelector('[data-action="submit"]').addEventListener('click', () => {
            handleInfoRequestSubmit(question, card);
        });

        card.querySelector('[data-action="skip"]').addEventListener('click', () => {
            handleInfoRequestSkip(question, card);
        });

        return card;
    }

    async function handleInfoRequestSubmit(question, cardEl) {
        // Get the value based on input type
        let value;
        const inputEl = cardEl.querySelector(`#info-input-${question.id}`);

        switch (question.inputType) {
            case 'number':
                value = inputEl?.value ? parseFloat(inputEl.value) : null;
                break;
            case 'text':
            case 'select':
                value = inputEl?.value?.trim() || null;
                break;
            case 'multi-select':
                const selected = cardEl.querySelectorAll('.multi-select-option.selected');
                value = Array.from(selected).map(opt => opt.dataset.value);
                break;
        }

        if (!value || (Array.isArray(value) && value.length === 0)) {
            // Show validation error
            if (inputEl) {
                inputEl.style.borderColor = '#ef4444';
                inputEl.style.animation = 'shake 0.3s ease';
                setTimeout(() => {
                    inputEl.style.borderColor = '';
                    inputEl.style.animation = '';
                }, 300);
            }
            return;
        }

        // Show loading state
        const actions = cardEl.querySelector('.insight-card-actions');
        actions.innerHTML = `
            <div class="info-request-progress">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                <span>Saving...</span>
            </div>
        `;

        try {
            // Save to database
            const user = await getCurrentUser();
            if (!user) throw new Error('Not authenticated');

            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult?.organization) throw new Error('Organization not found');

            const orgId = orgResult.organization.id;

            // Prepare update data
            const updateData = {};
            if (question.inputType === 'multi-select') {
                updateData[question.field] = value; // Array
            } else {
                updateData[question.field] = value;
            }

            // Save to appropriate table
            if (question.table === 'organizations') {
                const { error } = await supabase
                    .from('organizations')
                    .update(updateData)
                    .eq('id', orgId);
                if (error) throw error;
            } else if (question.table === 'projects') {
                const { error } = await supabase
                    .from('projects')
                    .update(updateData)
                    .eq('organization_id', orgId);
                if (error) throw error;
            }

            // Bridge: insert into business_knowledge so score widget updates
            const knowledgeLayer = CATEGORY_TO_LAYER[question.category] || 'operational';
            const factText = Array.isArray(value)
                ? `${question.title}: ${value.join(', ')}`
                : `${question.title}: ${value}`;
            supabase.from('business_knowledge').insert({
                organization_id: orgId,
                layer: knowledgeLayer,
                category: question.category,
                fact: factText,
                confidence: 1.0,
                importance: question.priority === 'high' ? 'high' : 'medium',
                source_type: 'conversation',
                status: 'active'
            }).then(() => {}).catch(() => {}); // fire-and-forget

            // Refresh score widget live
            setTimeout(() => refreshKnowledgeScore(), 600);

            // Mark question as answered
            infoRequestState.asked.add(question.id);
            infoRequestState.pending = null;

            // Update local promptState.orgData
            if (promptState.orgData) {
                if (question.field === 'slow_days') promptState.orgData.slowDays = value;
                if (question.field === 'monthly_revenue') promptState.orgData.monthlyRevenue = value;
                if (question.field === 'current_challenge') promptState.orgData.currentChallenge = value;
                // etc.
            }

            // Show success and remove card
            const successMsg = onboardingActive
                ? '✓ Nice! The more Royal knows, the smarter your recommendations get.'
                : '✓ Thanks! Generating new ideas...';
            actions.innerHTML = `<span style="font-size:12px;color:#10b981">${successMsg}</span>`;
            cardEl.dataset.status = 'completed';

            // Show toast
            showActivityToast('ai-accepted', 'Business profile updated');

            // Mark welcome banner AI card complete after first question
            if (typeof WelcomeBanner !== 'undefined' && WelcomeBanner.markAiComplete) {
                WelcomeBanner.markAiComplete();
            }

            // Update onboarding progress counter
            if (onboardingActive) {
                onboardingAnswered++;
                updateOnboardingProgress();
            }

            // Fade out card
            setTimeout(() => {
                cardEl.style.opacity = '0';
                cardEl.style.transform = 'translateX(20px)';
                setTimeout(() => {
                    cardEl.remove();
                    // Update Intel tab state
                    checkIntelEmptyState();
                    updateIntelBadge();
                    // Trigger new suggestion generation with updated context
                    regenerateSuggestions();
                    // In onboarding mode, auto-chain to next question
                    showNextOnboardingQuestion();
                }, 300);
            }, 1500);

        } catch (error) {
            console.error('Failed to save info request:', error);
            actions.innerHTML = `
                <span style="font-size:12px;color:#ef4444">Failed to save. Please try again.</span>
                <button class="card-action-btn primary" data-action="retry" style="margin-left: 8px;">Retry</button>
            `;
            actions.querySelector('[data-action="retry"]').addEventListener('click', () => {
                handleInfoRequestSubmit(question, cardEl);
            });
        }
    }

    function handleInfoRequestSkip(question, cardEl) {
        infoRequestState.asked.add(question.id);
        infoRequestState.pending = null;

        // Animate out
        cardEl.style.opacity = '0';
        cardEl.style.transform = 'translateX(-20px)';

        setTimeout(() => {
            cardEl.remove();
            // Update Intel tab state
            checkIntelEmptyState();
            updateIntelBadge();
            // Check if we should show another question or generate content
            checkAndShowInfoRequest();
            // In onboarding mode, auto-chain to next question
            showNextOnboardingQuestion();
        }, 300);
    }

    /**
     * Check if Intel feed is empty and show empty state
     */
    function checkIntelEmptyState() {
        const intelFeed = document.getElementById('intel-feed');
        const intelEmpty = document.getElementById('intel-empty');

        if (!intelFeed || !intelEmpty) return;

        const hasCards = intelFeed.querySelectorAll('.intel-card, .type-info-request').length > 0;
        intelEmpty.style.display = hasCards ? 'none' : 'flex';
    }

    async function regenerateSuggestions() {
        // Reload org data with new info
        await loadOrgDataForSuggestions();

        // Call Royal AI to generate new suggestions
        if (typeof CrownScene !== 'undefined') {
            CrownScene.setState('analyzing');
        }
        updateStatus('analyzing');

        try {
            const response = await callRoyalAI(
                'Based on my updated business profile, what should I focus on next?',
                'review'
            );

            if (response.ideas && response.ideas.length > 0) {
                renderAIIdeas(response.ideas);
            }

            if (response.follow_up_questions) {
                renderFollowUpQuestions(response.follow_up_questions);
            }

            // Success pulse
            if (typeof CrownScene !== 'undefined') {
                CrownScene.pulseOnce();
            }
        } catch (error) {
            console.error('Failed to regenerate suggestions:', error);
        } finally {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState(modeState.current === 'autonomous' ? 'autonomous' : 'idle');
            }
            updateStatus(modeState.current === 'autonomous' ? 'autonomous' : 'idle');
        }
    }

    function checkAndShowInfoRequest() {
        // Only show in autonomous mode
        if (modeState.current !== 'autonomous') return;

        // Don't show if already showing one
        if (infoRequestState.pending) return;

        // Check if there are pending action cards (in Actions tab)
        const actionsFeed = document.getElementById('cards-feed');
        if (actionsFeed) {
            const pendingCards = actionsFeed.querySelectorAll('.insight-card[data-status="pending"]:not(.type-info-request)');
            if (pendingCards.length > 0) return;
        }

        // Get next question
        const question = getNextInfoQuestion();
        if (!question) return; // All questions asked

        // Show info request card in Intel tab
        infoRequestState.pending = question;
        const card = createInfoRequestCard(question);
        card.classList.add('intel-card'); // Add Intel styling class

        // Insert into Intel feed
        const intelFeed = document.getElementById('intel-feed');
        const intelEmpty = document.getElementById('intel-empty');
        if (intelFeed) {
            // Hide empty state
            if (intelEmpty) intelEmpty.style.display = 'none';

            // Insert at top of Intel feed
            if (intelFeed.firstChild) {
                intelFeed.insertBefore(card, intelFeed.firstChild);
            } else {
                intelFeed.appendChild(card);
            }

            // Update Intel badge
            updateIntelBadge();
        }

        // Show toast
        showActivityToast('ai-accepted', 'Royal AI needs your input');
    }

    /**
     * Update the Intel tab badge count
     */
    function updateIntelBadge() {
        const intelFeed = document.getElementById('intel-feed');
        const badge = document.getElementById('intel-badge');
        const tabIntel = document.getElementById('tab-intel');

        if (!intelFeed || !badge) return;

        const pendingCards = intelFeed.querySelectorAll('.intel-card, .type-info-request');
        const count = pendingCards.length;

        if (count > 0 && tabIntel && !tabIntel.classList.contains('active')) {
            badge.textContent = count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // Monitor for suggestions running dry
    function startSuggestionsDryMonitor() {
        if (infoRequestState.dryTimer) clearTimeout(infoRequestState.dryTimer);

        // Check every 30 seconds if in autonomous mode with no pending cards
        infoRequestState.dryTimer = setTimeout(() => {
            if (modeState.current === 'autonomous') {
                checkAndShowInfoRequest();
            }
            startSuggestionsDryMonitor();
        }, 30000);
    }

    // =============================================
    // PLANNING CYCLES INTEGRATION
    // =============================================

    let planningCyclesInitialized = false;

    async function startPlanningCycles() {
        if (typeof PlanningCycles === 'undefined') {
            console.warn('PlanningCycles module not loaded');
            return;
        }

        try {
            // Get organization ID
            const user = await getCurrentUser();
            if (!user) return;

            const orgResult = await AppUtils.loadOrganization(supabase, user.id);
            if (!orgResult?.organization?.id) return;

            const orgId = orgResult.organization.id;

            // Initialize planning cycles if not done
            if (!planningCyclesInitialized) {
                await PlanningCycles.init(orgId, supabase);
                planningCyclesInitialized = true;
            }

            // Start automatic cycles
            PlanningCycles.startAutoCycles();

            // Run due cycles immediately and show results
            const results = await PlanningCycles.runDueCycles();

            // Convert planning cycle results to cards
            if (results.micro?.opportunities?.length > 0) {
                for (const opp of results.micro.opportunities) {
                    showPlanningOpportunityCard(opp);
                }
            }

            if (results.meso?.campaigns?.length > 0) {
                for (const campaign of results.meso.campaigns.slice(0, 2)) {
                    showPlanningCampaignCard(campaign);
                }
            }

        } catch (error) {
            console.error('Failed to start planning cycles:', error);
        }
    }

    function stopPlanningCycles() {
        if (typeof PlanningCycles !== 'undefined') {
            PlanningCycles.stopAutoCycles();
        }
    }

    function showPlanningOpportunityCard(opportunity) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const card = document.createElement('div');
        card.className = `insight-card type-insight planning-card`;
        card.dataset.planningType = opportunity.type;
        card.dataset.status = 'pending';

        const urgencyBadge = {
            'immediate': '<span class="urgency-badge urgent">Now</span>',
            'within_hour': '<span class="urgency-badge soon">Soon</span>',
            'today': '<span class="urgency-badge today">Today</span>',
            'this_week': '<span class="urgency-badge week">This Week</span>'
        }[opportunity.urgency] || '';

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">${opportunity.icon || '💡'}</div>
                <div class="insight-card-title">${escapeHtml(opportunity.title)}</div>
                ${urgencyBadge}
                <div class="insight-card-time">Just now</div>
            </div>
            <div class="insight-card-body">
                <p>${escapeHtml(opportunity.action)}</p>
                <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 8px;">
                    <em>${escapeHtml(opportunity.reasoning)}</em>
                </p>
            </div>
            <div class="insight-card-actions">
                <button class="card-action-btn secondary" data-action="dismiss">Dismiss</button>
                <button class="card-action-btn primary" data-action="accept">Take Action</button>
            </div>
        `;

        // Bind action handlers
        card.querySelectorAll('.card-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.action === 'accept') {
                    showActivityToast('automation-triggered', opportunity.title);
                    card.dataset.status = 'implemented';
                    card.classList.add('type-completed');
                    const actions = card.querySelector('.insight-card-actions');
                    if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Noted</span>';
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(-20px)';
                    setTimeout(() => card.remove(), 300);
                }
            });
        });

        // Insert at top
        if (feed.firstChild) {
            feed.insertBefore(card, feed.firstChild);
        } else {
            feed.appendChild(card);
        }

        counterState.pending++;
        updateCounts();
    }

    function showPlanningCampaignCard(campaign) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        const card = document.createElement('div');
        card.className = `insight-card type-data planning-card`;
        card.dataset.planningType = campaign.type;
        card.dataset.status = 'pending';

        const actionsHtml = campaign.suggestedActions?.slice(0, 3).map(a =>
            `<li style="margin-bottom: 4px;">${escapeHtml(a)}</li>`
        ).join('') || '';

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">📋</div>
                <div class="insight-card-title">${escapeHtml(campaign.title)}</div>
                <span class="priority-badge priority-${campaign.priority}">${campaign.priority}</span>
                <div class="insight-card-time">Just now</div>
            </div>
            <div class="insight-card-body">
                ${campaign.holiday ? `<p>Prepare for <strong>${campaign.holiday}</strong> (${campaign.daysAway} days away)</p>` : ''}
                ${actionsHtml ? `<ul style="margin: 8px 0 0 16px; padding: 0; font-size: 13px;">${actionsHtml}</ul>` : ''}
            </div>
            <div class="insight-card-actions">
                <button class="card-action-btn secondary" data-action="dismiss">Later</button>
                <button class="card-action-btn primary" data-action="accept">Start Planning</button>
            </div>
        `;

        // Bind action handlers
        card.querySelectorAll('.card-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.action === 'accept') {
                    showActivityToast('automation-triggered', campaign.title);
                    card.dataset.status = 'implemented';
                    card.classList.add('type-completed');
                    const actions = card.querySelector('.insight-card-actions');
                    if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Started</span>';
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(-20px)';
                    setTimeout(() => card.remove(), 300);
                }
            });
        });

        // Insert after any opportunity cards but before regular cards
        const firstRegularCard = feed.querySelector('.insight-card:not(.planning-card)');
        if (firstRegularCard) {
            feed.insertBefore(card, firstRegularCard);
        } else if (feed.firstChild) {
            feed.insertBefore(card, feed.firstChild);
        } else {
            feed.appendChild(card);
        }

        counterState.pending++;
        updateCounts();
    }

    // Handle chat submit from sidebar or external calls
    function handleChatSubmit(message) {
        const textarea = document.getElementById('prompt-textarea');
        if (!textarea || !message) return;
        textarea.value = message;
        submitPrompt();
    }

    // ── Onboarding Mode (focused Learnings experience) ──
    let onboardingActive = false;
    let onboardingAnswered = 0;

    function enterOnboardingMode() {
        const panel = document.querySelector('.crown-cards-panel');
        if (!panel) return;
        onboardingActive = true;
        onboardingAnswered = 0;
        panel.classList.add('onboarding-mode');

        const totalQuestions = INFO_REQUEST_QUESTIONS.length;

        // Inject onboarding header if not already present
        if (!panel.querySelector('.onboarding-header')) {
            const header = document.createElement('div');
            header.className = 'onboarding-header';
            header.innerHTML = `
                <div class="onboarding-header-text">
                    <h2>Help Royal AI Learn Your Business</h2>
                    <p>Answer these questions so Royal can give you smarter recommendations.</p>
                </div>
                <div class="onboarding-progress">
                    <div class="onboarding-progress-text">
                        <span id="onboarding-answered">0</span> of ${totalQuestions} questions answered
                    </div>
                    <div class="onboarding-progress-bar">
                        <div class="onboarding-progress-fill" id="onboarding-progress-fill" style="width: 0%"></div>
                    </div>
                </div>
            `;
            // Insert after the cards-panel-header (tab bar), before tab content
            const panelHeader = panel.querySelector('.cards-panel-header');
            if (panelHeader && panelHeader.nextSibling) {
                panel.insertBefore(header, panelHeader.nextSibling);
            } else {
                panel.appendChild(header);
            }
        }

        // Auto-collapse AI Understanding widget in onboarding mode
        const scoreWidget = document.querySelector('.knowledge-score-widget');
        if (scoreWidget && !scoreWidget.classList.contains('collapsed')) {
            scoreWidget.classList.add('collapsed');
            const toggle = scoreWidget.querySelector('.knowledge-score-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        }

        // Inject onboarding footer if not already present
        if (!panel.querySelector('.onboarding-footer')) {
            const footer = document.createElement('div');
            footer.className = 'onboarding-footer';
            footer.innerHTML = `
                <button class="btn btn-ghost btn-sm" id="onboarding-close-btn">Close</button>
                <button class="btn btn-success btn-sm" id="onboarding-save-btn" disabled>Save</button>
            `;
            panel.appendChild(footer);
            footer.querySelector('#onboarding-close-btn').addEventListener('click', exitOnboardingMode);
            footer.querySelector('#onboarding-save-btn').addEventListener('click', exitOnboardingMode);
        }
    }

    function updateOnboardingProgress() {
        if (!onboardingActive) return;
        const countEl = document.getElementById('onboarding-answered');
        const fillEl = document.getElementById('onboarding-progress-fill');
        const saveBtn = document.getElementById('onboarding-save-btn');
        if (countEl) countEl.textContent = onboardingAnswered;
        if (fillEl) {
            const pct = Math.min(100, Math.round((onboardingAnswered / INFO_REQUEST_QUESTIONS.length) * 100));
            fillEl.style.width = pct + '%';
        }
        if (saveBtn) {
            saveBtn.disabled = onboardingAnswered < 3;
        }
    }

    function exitOnboardingMode() {
        const panel = document.querySelector('.crown-cards-panel');
        if (!panel) return;
        onboardingActive = false;
        panel.classList.remove('onboarding-mode');

        // Remove onboarding header and footer
        const header = panel.querySelector('.onboarding-header');
        if (header) header.remove();
        const footer = panel.querySelector('.onboarding-footer');
        if (footer) footer.remove();

        // Collapse the expanded panel
        if (panel.classList.contains('panel-expanded')) {
            document.getElementById('panel-expand-btn')?.click();
        }
    }

    function showNextOnboardingQuestion() {
        if (!onboardingActive) return;
        const feed = document.getElementById('knowledge-feed');
        if (!feed) return;

        // Small delay for smooth transition
        setTimeout(() => {
            showLearningsDiscoveryCard(feed);
        }, 400);
    }

    return { init, setMode, applyTheme, initPrompt, addActivityCard, showActivityToast, handleChatSubmit, loadKnowledge, enterOnboardingMode, exitOnboardingMode };
})();

window.CrownDashboard = CrownDashboard;
