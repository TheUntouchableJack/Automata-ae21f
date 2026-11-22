// ===== Signup Preview =====
// Step 2 of 2 of the homepage funnel. A visitor who described their business
// and clicked "Claim My App" sees the app they were just shown, next to the
// signup form, instead of a report they have to click past to reach the form.
//
// Desktop: the phone mockup (AppPreviewCard) in the left panel, form on the
// right. Narrow screens: a one-row strip (app colour, name, first reward) above
// the form, so the form itself is above the fold.
//
// Depends on: AppPreviewCard (app-preview-card.js), AppConfigFallback
// (app-config-fallback.js), OnboardingStorage. All optional; render() returns
// false when it can't show anything and the page falls back to form-only.
//
// Exposes: SignupPreview.resolveConfig(data), .firstReward(config), .render(data)

const SignupPreview = (function () {

    function t(key, fallback, vars) {
        let out = fallback;
        try {
            if (window.I18n && typeof I18n.t === 'function') {
                const translated = I18n.t(key);
                if (translated && translated !== key) out = translated;
            }
        } catch (e) { /* English fallback */ }
        if (vars) {
            for (const [k, v] of Object.entries(vars)) {
                out = out.split('{' + k + '}').join(v);
            }
        }
        return out;
    }

    function isUsableConfig(config) {
        return !!(config && typeof config === 'object' &&
            typeof config.appName === 'string' && config.appName.trim() &&
            Array.isArray(config.tiers) && config.tiers.length &&
            Array.isArray(config.rewards));
    }

    /**
     * The config the visitor was shown on the homepage, or one rebuilt from
     * their description when none was stored (preview A/B control arm, an older
     * stored blob). If they corrected the business name after the preview was
     * built, the stored appName is stale: rename it so the page and the app
     * OnboardingSave creates both carry the name they confirmed.
     *
     * @param {object} data  OnboardingStorage.get()
     * @returns {{config: object|null, changed: boolean}} changed = caller should
     *          write config back with OnboardingStorage.setAppConfig
     */
    function resolveConfig(data) {
        if (!data) return { config: null, changed: false };
        const businessName = String(data.businessDetails?.businessName || '').trim();
        let config = isUsableConfig(data.appConfig) ? { ...data.appConfig } : null;
        let changed = false;

        if (!config) {
            const builder = (typeof window !== 'undefined' && window.AppConfigFallback) ||
                (typeof AppConfigFallback !== 'undefined' ? AppConfigFallback : null);
            if (!builder || !data.businessPrompt) return { config: null, changed: false };
            config = builder.build({
                prompt: data.businessPrompt || '',
                industry: data.businessContext?.industry || data.businessDetails?.businessType || '',
                businessName
            });
            changed = true;
        }

        if (businessName && config.appName.indexOf(businessName) === -1) {
            config.appName = `${businessName} Rewards`;
            changed = true;
        }
        return { config, changed };
    }

    /** The cheapest reward, i.e. the first one a new member works towards. */
    function firstReward(config) {
        const rewards = (config && Array.isArray(config.rewards)) ? config.rewards : [];
        if (!rewards.length) return null;
        return rewards.reduce((min, r) =>
            (Number(r.pointsCost) < Number(min.pointsCost) ? r : min), rewards[0]);
    }

    function safeColor(value, fallback) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
    }

    function renderTexts(config, businessName) {
        const titleEl = document.getElementById('signup-app-preview-title');
        if (titleEl) {
            titleEl.textContent = businessName
                ? t('hero.previewTitle', "Here's {name}'s loyalty app", { name: businessName })
                : t('hero.previewTitleGeneric', "Here's your loyalty app");
        }
        const rewardEl = document.getElementById('signup-app-strip-reward');
        const reward = firstReward(config);
        if (rewardEl) {
            rewardEl.textContent = reward
                ? t('auth.previewStripFirstReward', 'First reward: {reward}', { reward: reward.name })
                : '';
        }
    }

    /**
     * Render the desktop preview and the narrow-screen strip.
     * @param {object} data  OnboardingStorage.get()
     * @returns {object|null} the config shown, or null when nothing was rendered
     */
    function render(data) {
        const { config, changed } = resolveConfig(data);
        if (!config) return null;
        if (changed && typeof OnboardingStorage !== 'undefined' && OnboardingStorage.setAppConfig) {
            try { OnboardingStorage.setAppConfig(config); } catch (e) { /* display still works */ }
        }
        const businessName = String(data.businessDetails?.businessName || '').trim();

        // The phone's chips and the titles are translated at render time, so
        // the whole thing is painted again whenever i18n (re)loads.
        const paint = () => {
            let phoneShown = false;
            try {
                phoneShown = !!(window.AppPreviewCard &&
                    AppPreviewCard.render('signup-preview-mount', config, { showSourceNote: false }));
            } catch (e) {
                console.error('Signup preview render failed:', e);
            }
            const section = document.getElementById('signup-app-preview');
            if (section) section.hidden = !phoneShown;
            renderTexts(config, businessName);
        };

        const strip = document.getElementById('signup-app-strip');
        if (strip) {
            const icon = document.getElementById('signup-app-strip-icon');
            const name = document.getElementById('signup-app-strip-name');
            if (icon) {
                icon.style.background = safeColor(config.primaryColor, '#5B21B6');
                icon.textContent = (config.appName.trim()[0] || 'R').toUpperCase();
            }
            if (name) name.textContent = config.appName;
            strip.hidden = false;
        }

        paint();
        window.addEventListener('i18n:ready', paint);
        window.addEventListener('i18n:changed', paint);
        return config;
    }

    return { resolveConfig, firstReward, render };
})();

if (typeof window !== 'undefined') window.SignupPreview = SignupPreview;
if (typeof module !== 'undefined' && module.exports) module.exports = { SignupPreview };
