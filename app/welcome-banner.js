// ===== Welcome Banner Component (V2.1) =====
// Post-signup expandable banner on Intelligence page.
// DB-backed via profiles.welcome_progress JSONB — works across devices.
// V2: Full-width top row, sidebar auto-hide, confirm modal on dismiss.

const WelcomeBanner = (function() {
    let supabaseClient = null;
    let currentProgress = null;
    let orgName = '';

    const CARDS = ['automations', 'app', 'ai', 'rewards'];

    function t(key, fallback) {
        if (typeof i18n !== 'undefined' && i18n.t) return i18n.t(key) || fallback;
        return fallback;
    }

    // ── Public: show banner if needed ──
    async function show(supabase, profile, organizationName) {
        supabaseClient = supabase;
        orgName = organizationName || 'Your';

        // DEV: Reset welcome progress on every refresh for testing
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            profile = { ...profile, welcome_progress: null };
            updateProgress(null);
        }

        // Already completed — never show
        if (profile?.welcome_progress?.completed_at) return;

        currentProgress = profile?.welcome_progress || {
            automations: null, app: null, ai: null, rewards: null, completed_at: null
        };

        // If all cards already actioned, skip
        if (CARDS.every(c => currentProgress[c])) return;

        render(currentProgress);

        // Auto-hide right cards panel when banner is showing
        hidePanel();

        // Add JS class for grid control (replaces :has() CSS selector)
        const dashboard = document.getElementById('crown-dashboard');
        if (dashboard) dashboard.classList.add('has-welcome-banner');
    }

    // ── Hide/show right cards panel ──
    function hidePanel() {
        const dashboard = document.getElementById('crown-dashboard');
        if (dashboard) dashboard.classList.add('panel-hidden');
    }

    function showPanel() {
        const dashboard = document.getElementById('crown-dashboard');
        if (dashboard) dashboard.classList.remove('panel-hidden');
        window.dispatchEvent(new Event('resize'));
    }

    // ── Render ──
    function render(progress) {
        const container = document.getElementById('welcome-banner-container');
        if (!container) return;

        const isFirstTime = !progress.automations && !progress.app && !progress.ai && !progress.rewards;

        // Scale sphere down when banner starts expanded
        if (isFirstTime && window.CrownScene) {
            window.CrownScene.setOrbScale(0.75, 0.3);
        }

        container.innerHTML = `
        <div class="welcome-banner ${isFirstTime ? 'expanded' : 'collapsed'}" id="welcome-banner">
            <!-- Collapsed summary -->
            <div class="welcome-banner-summary" id="welcome-banner-summary">
                <div class="welcome-banner-summary-left">
                    <svg class="welcome-banner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                    </svg>
                    <div>
                        <strong>${t('welcome.summaryTitle', 'Your loyalty program is ready')}</strong>
                        <span class="welcome-banner-sub">${t('welcome.summaryLine', 'Automations + App + AI Intelligence')}</span>
                    </div>
                </div>
                <div class="welcome-banner-summary-actions">
                    <button class="welcome-btn-expand" id="welcome-expand-btn" aria-label="Expand">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button class="welcome-btn-dismiss" id="welcome-dismiss-btn" aria-label="Dismiss">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>

            <!-- Expanded content -->
            <div class="welcome-banner-expanded" id="welcome-banner-expanded">
                <div class="welcome-banner-header">
                    <svg class="welcome-banner-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                    </svg>
                    <h3>${t('welcome.title', "Welcome to Royalty \u2014 here's what we've prepared for you")}</h3>
                    <button class="welcome-btn-collapse" id="welcome-collapse-btn" aria-label="Collapse">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                </div>

                <div class="welcome-banner-cards">
                    ${renderCard('automations', '1', 'zap', progress)}
                    ${renderCard('app', '2', 'smartphone', progress)}
                    ${renderCard('ai', '3', 'brain', progress)}
                    ${renderCard('rewards', '4', 'gift', progress)}
                </div>

                <div class="welcome-banner-footer">
                    <button class="welcome-explore-link" id="welcome-explore-btn">
                        ${t('welcome.exploreOwn', "I'll explore on my own")}
                    </button>
                </div>
            </div>
        </div>

        <!-- Dismiss confirmation modal -->
        <div class="welcome-confirm-modal" id="welcome-confirm-modal" style="display: none;">
            <div class="welcome-confirm-overlay" id="welcome-confirm-overlay"></div>
            <div class="welcome-confirm-content">
                <h4>${t('welcome.confirmDismissTitle', 'Dismiss welcome guide?')}</h4>
                <p>${t('welcome.confirmDismissMessage', "You won't see this guide again. You can always find these features in the sidebar.")}</p>
                <div class="welcome-confirm-actions">
                    <button class="btn btn-secondary btn-sm" id="welcome-confirm-cancel">${t('welcome.confirmDismissCancel', 'Cancel')}</button>
                    <button class="btn btn-primary btn-sm" id="welcome-confirm-yes">${t('welcome.confirmDismissConfirm', 'Yes, dismiss')}</button>
                </div>
            </div>
        </div>`;

        bindEvents();
    }

    function renderCard(id, step, icon, progress) {
        const done = !!progress[id];

        const icons = {
            zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
            smartphone: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
            brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
            gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'
        };

        const titles = {
            automations: t('welcome.automationsTitle', 'Suggested Automations'),
            app: t('welcome.appTitle', 'Your New Application'),
            ai: t('welcome.aiTitle', 'AI Intelligence'),
            rewards: t('welcome.rewardsTitle', 'Rewards Program')
        };

        const descs = {
            automations: t('welcome.automationsDesc', 'We\'ve drafted 4 automations based on your business: Welcome Message, Visit Bonus, At-Risk Check-in, and Win-Back Offer. Review and activate the ones that fit your strategy.'),
            app: t('welcome.appDesc', `${orgName} Rewards is ready to customize. Add your branding, set point values, and configure rewards before sharing with customers.`),
            ai: t('welcome.aiDesc', 'Royal AI is now monitoring your program. It will learn your business, suggest improvements, and can run campaigns on your behalf. Choose between Manual review or Auto-pilot mode.'),
            rewards: t('welcome.rewardsDesc', 'Set up rewards your customers will love. Create point-based perks, tier exclusives, or let AI suggest the best rewards for your business.')
        };

        const links = {
            automations: { href: '/app/automations.html', text: t('welcome.automationsLink', 'Review Automations') },
            app: { href: '/app/app-builder.html', text: t('welcome.appLink', 'Customize App') },
            ai: { href: '#learnings', text: t('welcome.aiLink', 'Explore AI Learnings') },
            rewards: { href: '/app/rewards.html', text: t('welcome.rewardsLink', 'Browse Rewards') }
        };

        const link = links[id];

        return `
        <div class="welcome-card ${done ? 'done' : ''}" data-card="${id}">
            ${done ? '<div class="welcome-card-check"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' : ''}
            <div class="welcome-card-step">${step}</div>
            <div class="welcome-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[icon]}</svg>
            </div>
            <h4>${titles[id]}</h4>
            <p>${descs[id]}</p>
            <div class="welcome-card-actions">
                ${!done ? `
                    <a href="${link.href}" class="btn btn-primary btn-sm welcome-cta" data-card="${id}">${link.text} \u2192</a>
                    <button class="btn btn-ghost btn-sm welcome-skip" data-card="${id}">${t('welcome.skip', 'Skip')}</button>
                ` : `
                    <span class="welcome-completed-label">${t('welcome.completed', 'Completed')}</span>
                `}
            </div>
        </div>`;
    }

    // ── Events ──
    function bindEvents() {
        const banner = document.getElementById('welcome-banner');
        if (!banner) return;

        // Expand button (chevron in collapsed view)
        const expandBtn = document.getElementById('welcome-expand-btn');
        if (expandBtn) expandBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggle();
        });

        // Clicking the summary row also expands (except on dismiss button)
        const summaryEl = document.getElementById('welcome-banner-summary');
        if (summaryEl) summaryEl.addEventListener('click', function(e) {
            if (!e.target.closest('.welcome-btn-dismiss') && !e.target.closest('.welcome-btn-expand')) {
                toggle();
            }
        });

        // Collapse button (chevron in expanded view)
        const collapseBtn = document.getElementById('welcome-collapse-btn');
        if (collapseBtn) collapseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggle();
        });

        // Dismiss (X button) — show confirmation modal
        const dismissBtn = document.getElementById('welcome-dismiss-btn');
        if (dismissBtn) dismissBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            showConfirmModal();
        });

        // Confirm modal buttons
        const confirmCancel = document.getElementById('welcome-confirm-cancel');
        const confirmOverlay = document.getElementById('welcome-confirm-overlay');
        const confirmYes = document.getElementById('welcome-confirm-yes');
        if (confirmCancel) confirmCancel.addEventListener('click', hideConfirmModal);
        if (confirmOverlay) confirmOverlay.addEventListener('click', hideConfirmModal);
        if (confirmYes) confirmYes.addEventListener('click', function() {
            hideConfirmModal();
            dismiss();
        });

        // Panel toggle (hide/show side cards panel)
        // Explore on my own — also show confirmation
        const exploreBtn = document.getElementById('welcome-explore-btn');
        if (exploreBtn) exploreBtn.addEventListener('click', function() {
            showConfirmModal();
        });

        // Card CTAs (mark as visited)
        banner.querySelectorAll('.welcome-cta').forEach(btn => {
            btn.addEventListener('click', function(e) {
                const cardId = this.dataset.card;
                if (cardId === 'ai') {
                    e.preventDefault();
                    markCard(cardId, 'visited');
                    // Show panel and switch to Learnings tab
                    showPanel();
                    const knowledgeTab = document.querySelector('[data-tab="knowledge"]');
                    if (knowledgeTab) knowledgeTab.click();
                } else {
                    markCard(cardId, 'visited');
                }
            });
        });

        // Skip buttons
        banner.querySelectorAll('.welcome-skip').forEach(btn => {
            btn.addEventListener('click', function() {
                markCard(this.dataset.card, 'skipped');
            });
        });
    }

    // ── Confirmation modal ──
    function showConfirmModal() {
        const modal = document.getElementById('welcome-confirm-modal');
        if (modal) modal.style.display = 'flex';
    }

    function hideConfirmModal() {
        const modal = document.getElementById('welcome-confirm-modal');
        if (modal) modal.style.display = 'none';
    }

    // ── Toggle right cards panel (called from cards panel header button) ──
    function togglePanelVisibility() {
        const dashboard = document.getElementById('crown-dashboard');
        if (!dashboard) return;
        dashboard.classList.toggle('panel-hidden');
        window.dispatchEvent(new Event('resize'));
    }

    // ── Toggle expand/collapse ──
    function toggle() {
        const banner = document.getElementById('welcome-banner');
        if (!banner) return;
        banner.classList.toggle('expanded');
        banner.classList.toggle('collapsed');
        // Scale sphere based on expanded state
        if (window.CrownScene) {
            const isExpanded = banner.classList.contains('expanded');
            window.CrownScene.setOrbScale(isExpanded ? 0.75 : 1.0, isExpanded ? 0.3 : 0);
        }
        window.dispatchEvent(new Event('resize'));
    }

    // ── Mark individual card ──
    function markCard(cardId, status) {
        if (!CARDS.includes(cardId)) return;
        currentProgress[cardId] = status;

        // Re-render the card visually
        const card = document.querySelector(`.welcome-card[data-card="${cardId}"]`);
        if (card) {
            card.classList.add('done');
            card.style.opacity = '0.5';
        }

        // Check if all done
        if (CARDS.every(c => currentProgress[c])) {
            currentProgress.completed_at = new Date().toISOString();
            updateProgress(currentProgress);
            setTimeout(() => removeBanner(), 600);
        } else {
            updateProgress(currentProgress);
        }
    }

    // ── Dismiss entire banner ──
    function dismiss() {
        CARDS.forEach(c => {
            if (!currentProgress[c]) currentProgress[c] = 'skipped';
        });
        currentProgress.completed_at = new Date().toISOString();
        updateProgress(currentProgress);
        removeBanner();
    }

    // ── Remove from DOM ──
    function removeBanner() {
        const banner = document.getElementById('welcome-banner');
        if (!banner) return;

        // Restore right cards panel
        const dashboard = document.getElementById('crown-dashboard');
        showPanel();

        banner.classList.add('farewell');
        setTimeout(() => {
            const container = document.getElementById('welcome-banner-container');
            if (container) container.innerHTML = '';
            // Remove grid class after content is cleared
            if (dashboard) dashboard.classList.remove('has-welcome-banner');
            // Restore sphere to full size
            if (window.CrownScene) window.CrownScene.setOrbScale(1.0, 0);
            // Trigger Three.js resize after layout change
            window.dispatchEvent(new Event('resize'));
        }, 400);
    }

    // ── Persist to DB ──
    async function updateProgress(progress) {
        if (!supabaseClient) return;
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;
            await supabaseClient
                .from('profiles')
                .update({ welcome_progress: progress })
                .eq('id', user.id);
        } catch (err) {
            console.error('[WelcomeBanner] Failed to save progress:', err);
        }
    }

    return { show, togglePanel: togglePanelVisibility };
})();
