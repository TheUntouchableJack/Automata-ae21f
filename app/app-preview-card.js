// ===== App Preview Card =====
// Renders a loyalty-app config as a phone mockup plus a short row of facts.
// This is the payoff moment: the thing a visitor gets for describing their
// business, shown BEFORE the signup wall.
//
// Extracted into its own module because two pages need exactly this markup --
// the homepage hero (index.html) and the cold-signup page (app/get-started.html),
// which already duplicate each other's element IDs. Forking the mockup between
// them would guarantee they drift.
//
// Styling reuses .app-screen-inner / .app-header / .app-bottom-nav / .phone-frame
// from styles.css. Colour is driven by a --preview-primary custom property set
// on the phone root, so re-theming is one property write rather than a tree walk.
//
// Exposes: AppPreviewCard.render(container, config, options)

const AppPreviewCard = (function () {

    // Local escape. index.html does not load app/utils.js, so this module cannot
    // depend on the shared escapeHtml. Every value below originates from a model
    // response or a free-text field the visitor typed, so none of it is trusted.
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Only ever interpolated into a style attribute, so it must not be able to
    // carry anything but a colour.
    function safeColor(value, fallback) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
    }

    function t(key, fallback, vars) {
        let out = fallback;
        try {
            if (window.I18n && typeof I18n.t === 'function') {
                const translated = I18n.t(key);
                // I18n.t returns the key itself when there is no translation.
                if (translated && translated !== key) out = translated;
            }
        } catch (e) { /* fall back to English */ }
        if (vars) {
            for (const [k, v] of Object.entries(vars)) {
                out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
            }
        }
        return out;
    }

    const ICONS = {
        home:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
        rewards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>',
        scan:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M3 12h18"/></svg>',
        profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    };

    function renderPhone(config) {
        const primary = safeColor(config.primaryColor, '#5B21B6');
        const tiers = Array.isArray(config.tiers) ? config.tiers : [];
        const rewards = (Array.isArray(config.rewards) ? config.rewards : []).slice(0, 3);

        const tierChips = tiers.map((tier, i) => `
            <span class="preview-tier-chip${i === 0 ? ' is-current' : ''}">${esc(tier.name)}</span>
        `).join('');

        const rewardRows = rewards.map(r => `
            <div class="preview-reward-row">
                <div class="preview-reward-text">
                    <span class="preview-reward-name">${esc(r.name)}</span>
                    <span class="preview-reward-desc">${esc(r.description)}</span>
                </div>
                <span class="preview-reward-cost">${esc(r.pointsCost)}</span>
            </div>
        `).join('');

        return `
            <div class="hero-preview-phone" style="--preview-primary: ${primary}">
                <div class="app-screen-inner">
                    <div class="app-status-bar">
                        <span>9:41</span>
                        <span class="status-icons">&#9679;&#9679;&#9679;</span>
                    </div>
                    <div class="app-header" style="background: ${primary}">
                        <span>${esc(config.appName)}</span>
                    </div>
                    <div class="preview-app-body">
                        <div class="preview-points-ring" style="border-color: ${primary}">
                            <span class="preview-points-value" style="color: ${primary}">${esc(config.welcomePoints)}</span>
                            <span class="preview-points-label">${esc(t('hero.previewPointsLabel', 'points'))}</span>
                        </div>
                        <div class="preview-tier-row">${tierChips}</div>
                        <div class="preview-rewards-list">${rewardRows}</div>
                    </div>
                    <div class="app-bottom-nav" style="--nav-active: ${primary}">
                        <div class="nav-item active">${ICONS.home}<span>${esc(t('hero.previewNavHome', 'Home'))}</span></div>
                        <div class="nav-item">${ICONS.rewards}<span>${esc(t('hero.previewNavRewards', 'Rewards'))}</span></div>
                        <div class="nav-item">${ICONS.scan}<span>${esc(t('hero.previewNavScan', 'Scan'))}</span></div>
                        <div class="nav-item">${ICONS.profile}<span>${esc(t('hero.previewNavProfile', 'Profile'))}</span></div>
                    </div>
                </div>
                <div class="phone-frame"><div class="phone-island"></div></div>
            </div>
        `;
    }

    function renderFacts(config) {
        const chips = [
            t('hero.previewChipPoints',  '{n} pts per visit', { n: esc(config.pointsPerScan) }),
            t('hero.previewChipWelcome', '{n} welcome points', { n: esc(config.welcomePoints) }),
            t('hero.previewChipTiers',   '{n} tiers',          { n: (config.tiers || []).length }),
            t('hero.previewChipRewards', '{n} rewards ready',  { n: (config.rewards || []).length })
        ];
        return chips.map(c => `<span class="preview-fact-chip">${c}</span>`).join('');
    }

    /**
     * Render the preview into a container.
     *
     * @param {HTMLElement|string} container element or element id
     * @param {object} config  from AppConfigFallback.build()
     * @param {object} [options]
     * @param {boolean} [options.showSourceNote=true]  show the honest "built
     *        from our {industry} template" line when the config did not come
     *        from a per-business AI generation.
     * @param {string} [options.industryLabel]  human-readable industry, for that note.
     * @returns {boolean} whether anything was rendered
     */
    function render(container, config, options) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el || !config) return false;
        const opts = options || {};

        // The note is deliberately honest rather than apologetic. A template app
        // presented as if the AI hand-built it reads as a lie the moment they
        // reach the builder; presented as a starting point it reads as a head
        // start. What it must never do is look like an error.
        let note = '';
        if (opts.showSourceNote !== false) {
            const industryLabel = opts.industryLabel || t('hero.previewIndustryGeneric', 'small business');
            note = `<p class="preview-source-note">${esc(
                t('hero.previewFallbackNote',
                  'Built from our {industry} template — you can change everything in the next step',
                  { industry: industryLabel })
            )}</p>`;
        }

        el.innerHTML = `
            <div class="hero-preview-split">
                <div class="hero-preview-phone-col">${renderPhone(config)}</div>
                <div class="hero-preview-facts">
                    <div class="preview-fact-chips">${renderFacts(config)}</div>
                    ${note}
                </div>
            </div>
        `;
        return true;
    }

    return { render, _esc: esc, _safeColor: safeColor };
})();

if (typeof window !== 'undefined') window.AppPreviewCard = AppPreviewCard;
