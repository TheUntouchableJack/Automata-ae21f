// ===== Crown Dashboard Module =====
// Integration layer: binds 3D crown to intelligence data, manages modes, renders cards

const CrownDashboard = (function() {
    let currentMode = 'review'; // 'review' | 'autonomous'
    let currentTheme = 'dark';
    let isInitialized = false;
    let pendingCount = 0;
    let completedCount = 0;

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

    async function init() {
        // Check WebGL support
        if (!supportsWebGL()) {
            showFallback();
            setupCards();
            isInitialized = true;
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
        isInitialized = true;
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
        const saved = localStorage.getItem('intelligence-theme') || 'dark';
        applyTheme(saved);

        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
            });
        }

        // Clean up sidebar class when leaving page
        window.addEventListener('beforeunload', cleanupSidebar);
    }

    function applyTheme(theme) {
        currentTheme = theme;
        localStorage.setItem('intelligence-theme', theme);

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
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                setMode(mode);
            });
        });
    }

    function setMode(mode) {
        currentMode = mode;

        // Update toggle UI
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update crown visual state
        if (typeof CrownScene !== 'undefined' && CrownScene.setState) {
            CrownScene.setState(mode === 'autonomous' ? 'autonomous' : 'idle');
        }

        // Update status indicator
        updateStatus(mode === 'autonomous' ? 'autonomous' : 'idle');

        // Re-render cards for the mode
        renderCardsForMode(mode);
    }

    function setupCards() {
        // Show initial feed immediately (no "analyze" button)
        showInitialFeed();
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
        // Listen for crown events from intelligence.js
        document.addEventListener('crown:analyzing', () => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState('analyzing');
            }
            updateStatus('analyzing');
        });

        document.addEventListener('crown:analyzed', (e) => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.setState(currentMode === 'autonomous' ? 'autonomous' : 'idle');
                CrownScene.pulseOnce();
            }
            updateStatus(currentMode === 'autonomous' ? 'autonomous' : 'idle');

            // Render new recommendation cards
            if (e.detail && e.detail.recommendations) {
                renderRecommendationCards(e.detail.recommendations);
            }
        });

        document.addEventListener('crown:implemented', (e) => {
            if (typeof CrownScene !== 'undefined') {
                CrownScene.pulseOnce();
            }
            // Add completed card
            if (e.detail) {
                addCompletedCard(e.detail);
            }
        });

        document.addEventListener('crown:recommendations-loaded', (e) => {
            if (e.detail && e.detail.recommendations) {
                renderRecommendationCards(e.detail.recommendations);
            }
        });
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
            pendingCount = 0;
            completedCount = 0;
            updateCounts();
            return;
        }

        pendingCount = 0;
        completedCount = 0;

        recommendations.forEach(rec => {
            const status = rec.status || 'pending';
            if (status === 'implemented' || status === 'dismissed') {
                completedCount++;
            } else {
                pendingCount++;
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

        card.innerHTML = `
            <div class="insight-card-header">
                <div class="insight-card-icon">${icon}</div>
                <div class="insight-card-title">${escapeHtml(rec.title || rec.name || 'Recommendation')}</div>
                <div class="insight-card-time">${timeAgo}</div>
            </div>
            <div class="insight-card-body">${escapeHtml(rec.description || '')}</div>
            ${!isCompleted && !isDismissed && currentMode === 'review' ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn primary" data-action="accept" data-rec-id="${rec.id}">Accept</button>
                    <button class="card-action-btn secondary" data-action="dismiss" data-rec-id="${rec.id}">Dismiss</button>
                </div>
            ` : isCompleted ? `
                <div class="insight-card-actions">
                    <button class="card-action-btn secondary" data-action="view" data-rec-id="${rec.id}">View Details</button>
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

    function handleCardAction(action, recId, cardEl) {
        if (action === 'accept') {
            // Find and click the accept button in the legacy recommendations list
            const legacyBtn = document.querySelector(`[data-recommendation-id="${recId}"] .btn-implement, [data-rec-id="${recId}"]`);
            if (legacyBtn) {
                legacyBtn.click();
            } else {
                // Dispatch event for intelligence.js to handle
                document.dispatchEvent(new CustomEvent('crown:accept-recommendation', {
                    detail: { recId }
                }));
            }
            // Visual feedback
            cardEl.classList.remove('type-action', 'type-insight');
            cardEl.classList.add('type-completed');
            const actions = cardEl.querySelector('.insight-card-actions');
            if (actions) actions.innerHTML = '<span style="font-size:12px;color:#10b981">Accepted</span>';
        } else if (action === 'dismiss') {
            cardEl.style.opacity = '0';
            cardEl.style.transform = 'translateX(20px)';
            setTimeout(() => cardEl.remove(), 300);
        }
    }

    function addCompletedCard(detail) {
        const feed = document.getElementById('cards-feed');
        if (!feed) return;

        completedCount++;
        pendingCount = Math.max(0, pendingCount - 1);
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
            const actions = card.querySelector('.insight-card-actions');
            if (!actions) return;

            const isCompleted = card.classList.contains('type-completed');
            if (isCompleted) return;

            const recId = card.dataset.recId;
            if (mode === 'autonomous') {
                actions.innerHTML = `
                    <button class="card-action-btn secondary" data-action="view" data-rec-id="${recId}">View Details</button>
                `;
            } else {
                actions.innerHTML = `
                    <button class="card-action-btn primary" data-action="accept" data-rec-id="${recId}">Accept</button>
                    <button class="card-action-btn secondary" data-action="dismiss" data-rec-id="${recId}">Dismiss</button>
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
            pendingEl.textContent = `${pendingCount} pending`;
            pendingEl.className = 'stat-mini' + (pendingCount > 0 ? ' pending' : '');
        }
        if (completedEl) {
            completedEl.textContent = `${completedCount} completed`;
            completedEl.className = 'stat-mini' + (completedCount > 0 ? ' completed' : '');
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

    function formatTimeAgo(dateStr) {
        const date = new Date(dateStr);
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

    function escapeHtml(str) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init, setMode, applyTheme };
})();

window.CrownDashboard = CrownDashboard;
