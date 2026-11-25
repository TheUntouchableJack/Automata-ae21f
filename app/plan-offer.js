/**
 * Plan offer (plan abstract-gliding-hellman, Phase 2, 2026-11-25).
 *
 * Someone who clicked a paid plan on Pricing used to end up on Free with nothing ever offering
 * that plan again. Now, once their app is live, the dashboard offers exactly that plan's 14-day
 * trial (no card), one click from Stripe's hosted checkout. Intelligence points at the same offer.
 *
 * The plan comes from the account: user_metadata.plan_intent (app/signup.html), or the older
 * signup_source.plan. sessionStorage was lost when the confirmation link opened a new tab.
 *
 * window.PlanOffer: intentFor, reason, eligible (pure), check, mount, pointLink. No other globals.
 */
(function () {
    'use strict';

    var PAID_TIERS = ['starter', 'growth', 'scale'];
    var MAX_ACCOUNT_AGE_DAYS = 30;
    var DISMISS_PREFIX = 'royalty_plan_offer_dismissed:';
    var NEVER_SUBSCRIBED_STATUSES = ['', 'inactive'];
    var FALLBACK_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';

    // ----- pure -----

    /** The paid tier this person picked on Pricing, or null. */
    function intentFor(user) {
        var meta = (user && user.user_metadata) || {};
        var raw = meta.plan_intent != null ? meta.plan_intent
            : (meta.signup_source && typeof meta.signup_source === 'object' ? meta.signup_source.plan : null);
        var tier = String(raw || '').toLowerCase();
        return PAID_TIERS.indexOf(tier) >= 0 ? tier : null;
    }

    /**
     * Why the offer is NOT shown, or null when it is. ctx:
     *   intent, org {plan_type}, role, isSuperAdmin, viewingAs, hasPublishedApp, dismissed,
     *   accountCreatedAt (ISO), now (ms), billing {subscription_status, cancelled_at} | undefined
     * billing undefined = not loaded yet (every other rule is checked first, so the one query runs
     * only for someone who passes them all).
     */
    function reason(ctx) {
        ctx = ctx || {};
        if (PAID_TIERS.indexOf(ctx.intent) < 0) return 'no_paid_intent';
        var org = ctx.org || {};
        if ((org.plan_type || 'free') !== 'free') return 'not_free';
        if (ctx.role !== 'owner' && ctx.role !== 'admin') return 'role';
        if (ctx.isSuperAdmin) return 'super_admin';
        if (ctx.viewingAs) return 'viewing_as';
        if (!ctx.hasPublishedApp) return 'no_published_app';
        if (ctx.dismissed) return 'dismissed';
        var created = Date.parse(ctx.accountCreatedAt || '');
        var now = typeof ctx.now === 'number' ? ctx.now : Date.now();
        if (!isFinite(created)) return 'account_age_unknown';
        if (now - created > MAX_ACCOUNT_AGE_DAYS * 86400000) return 'account_too_old';
        if (ctx.billing === undefined) return 'billing_unknown';
        var b = ctx.billing || {};
        if (b.cancelled_at) return 'had_subscription';
        if (NEVER_SUBSCRIBED_STATUSES.indexOf(b.subscription_status == null ? '' : String(b.subscription_status)) < 0) {
            return 'had_subscription';
        }
        return null;
    }

    function eligible(ctx) {
        return reason(ctx) === null;
    }

    // ----- helpers -----

    function t(key, fallback, vars) {
        var out = fallback;
        try {
            var v = window.I18n && window.I18n.t ? window.I18n.t(key, vars || {}) : null;
            if (v && v !== key) out = v;
        } catch (e) { /* English fallback */ }
        if (vars) {
            out = out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
        }
        return out;
    }

    function planInfo(tier) {
        var all = window.PLAN_LIMITS && window.PLAN_LIMITS.subscription;
        var p = all && all[tier];
        if (!p) return null;
        return { name: p.name, price: '$' + Number(p.price_monthly).toFixed(2) };
    }

    function track(name, props) {
        try {
            if (typeof royaltyWhenAnalytics === 'function') royaltyWhenAnalytics(function (A) { A.track(name, props); });
        } catch (e) { /* analytics never breaks the page */ }
    }

    function dismissKey(orgId) { return DISMISS_PREFIX + orgId; }

    function isDismissed(orgId) {
        try { return !!localStorage.getItem(dismissKey(orgId)); } catch (e) { return false; }
    }

    function viewingAs() {
        try { return !!sessionStorage.getItem('adminViewAsOrg'); } catch (e) { return false; }
    }

    function client() {
        return window.supabase && typeof window.supabase.from === 'function' ? window.supabase : null;
    }

    async function loadBilling(orgId) {
        var db = client();
        if (!db) return undefined;
        var res = await db.from('organizations')
            .select('subscription_status, cancelled_at')
            .eq('id', orgId)
            .maybeSingle();
        if (res.error || !res.data) return undefined;
        return res.data;
    }

    async function loadHasPublishedApp(orgId) {
        var db = client();
        if (!db) return false;
        var res = await db.from('customer_apps')
            .select('id')
            .eq('organization_id', orgId)
            .eq('is_published', true)
            .is('deleted_at', null)
            .limit(1);
        return !res.error && Array.isArray(res.data) && res.data.length > 0;
    }

    /**
     * Resolve { eligible, tier, reason } for this person and org. opts: user, org, role,
     * isSuperAdmin, hasPublishedApp (looked up when not given), now.
     */
    async function check(opts) {
        opts = opts || {};
        var org = opts.org || null;
        var ctx = {
            intent: intentFor(opts.user),
            org: org || {},
            role: opts.role,
            isSuperAdmin: opts.isSuperAdmin === true,
            viewingAs: viewingAs(),
            hasPublishedApp: opts.hasPublishedApp,
            dismissed: org && org.id ? isDismissed(org.id) : false,
            accountCreatedAt: opts.user && opts.user.created_at,
            now: opts.now,
            billing: undefined,
        };
        if (!org || !org.id) return { eligible: false, tier: ctx.intent, reason: 'no_org' };
        try {
            if (ctx.hasPublishedApp === undefined) {
                // Only worth a query when nothing cheaper already rules the offer out.
                ctx.hasPublishedApp = true;
                var early = reason(ctx);
                if (early !== 'billing_unknown') return { eligible: false, tier: ctx.intent, reason: early };
                ctx.hasPublishedApp = await loadHasPublishedApp(org.id);
            }
            var before = reason(ctx);
            if (before !== 'billing_unknown') return { eligible: false, tier: ctx.intent, reason: before };
            ctx.billing = await loadBilling(org.id);
        } catch (e) {
            return { eligible: false, tier: ctx.intent, reason: 'error' };
        }
        var why = reason(ctx);
        return { eligible: why === null, tier: ctx.intent, reason: why };
    }

    // ----- the card -----

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function render(container, tier, state) {
        var info = planInfo(tier);
        if (!info) return false;
        container.textContent = '';
        container.classList.add('plan-offer');
        container.setAttribute('role', 'region');
        container.setAttribute('aria-labelledby', 'plan-offer-title');

        var body = el('div', 'plan-offer-body');
        body.appendChild(el('p', 'plan-offer-eyebrow', t('planOffer.eyebrow', 'Your app is live')));
        var title = el('h3', 'plan-offer-title', t('planOffer.title', 'You picked {plan}.', { plan: info.name }));
        title.id = 'plan-offer-title';
        body.appendChild(title);
        body.appendChild(el('p', 'plan-offer-terms', t('planOffer.terms',
            'Try it free for 14 days, no card needed. Then {price}/mo, cancel anytime.', { price: info.price })));

        var actions = el('div', 'plan-offer-actions');
        var start = el('button', 'btn btn-primary plan-offer-start');
        start.type = 'button';
        var spinner = el('span', 'plan-offer-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        spinner.hidden = !state.busy;
        start.appendChild(spinner);
        start.appendChild(el('span', 'plan-offer-start-label', state.busy
            ? t('planOffer.starting', 'Opening checkout…')
            : t('planOffer.start', 'Start free trial')));
        start.disabled = !!state.busy;
        if (state.busy) start.setAttribute('aria-busy', 'true');
        var stay = el('button', 'btn btn-ghost plan-offer-stay', t('planOffer.stay', 'Stay on Free'));
        stay.type = 'button';
        stay.disabled = !!state.busy;
        actions.appendChild(start);
        actions.appendChild(stay);

        var err = el('p', 'plan-offer-error', state.error || '');
        err.setAttribute('role', 'alert');
        err.hidden = !state.error;

        container.appendChild(body);
        container.appendChild(actions);
        container.appendChild(err);
        return true;
    }

    function functionsUrl() {
        // eslint-disable-next-line no-undef
        var base = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : FALLBACK_URL;
        return base + '/functions/v1/create-checkout-session';
    }

    async function startCheckout(orgId, tier) {
        var session = typeof getValidSession === 'function' ? await getValidSession() : null;
        if (!session) throw new Error(t('planOffer.errorSession', 'Your session expired. Refresh the page and try again.'));
        var origin = window.location.origin;
        var res = await fetch(functionsUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({
                priceKey: tier + '_monthly',
                organizationId: orgId,
                embedded: false,
                successUrl: origin + '/app/upgrade.html?success=true&from=offer',
                cancelUrl: origin + '/app/dashboard.html',
            }),
        });
        var data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (!res.ok || !data.url) {
            throw new Error(data.error || t('planOffer.errorGeneric', 'We couldn’t open checkout. Please try again.'));
        }
        return data.url;
    }

    /**
     * Show the offer in `container` when this person is eligible. Resolves true when shown.
     * opts: container, user, org, role, isSuperAdmin, hasPublishedApp.
     */
    async function mount(opts) {
        opts = opts || {};
        var container = opts.container;
        if (!container) return false;
        var result = await check(opts);
        if (!result.eligible) { container.hidden = true; return false; }

        var tier = result.tier;
        var orgId = opts.org.id;
        var state = { busy: false, error: '' };
        var draw = function () { return render(container, tier, state); };
        if (!draw()) { container.hidden = true; return false; }
        container.hidden = false;
        track('plan_offer_shown', { tier: tier });

        container.addEventListener('click', async function (e) {
            if (e.target.closest('.plan-offer-stay')) {
                try { localStorage.setItem(dismissKey(orgId), new Date().toISOString()); } catch (err) { /* private mode */ }
                container.hidden = true;
                track('plan_offer_dismissed', { tier: tier });
                return;
            }
            if (e.target.closest('.plan-offer-start') && !state.busy) {
                state.busy = true;
                state.error = '';
                draw();
                track('plan_offer_clicked', { tier: tier });
                try {
                    var url = await startCheckout(orgId, tier);
                    window.location.assign(url);
                } catch (err) {
                    state.busy = false;
                    state.error = (err && err.message) || t('planOffer.errorGeneric', 'We couldn’t open checkout. Please try again.');
                    draw();
                }
            }
        });
        window.addEventListener('i18n:changed', function () { if (!container.hidden) draw(); });
        window.addEventListener('i18n:ready', function () { if (!container.hidden) draw(); });

        if (window.location.hash === '#plan-offer' && container.scrollIntoView) {
            container.scrollIntoView({ block: 'center' });
        }
        return true;
    }

    /** Intelligence: turn the "See what Pro unlocks" link into this person's trial offer. */
    function pointLink(link, tier) {
        var info = planInfo(tier);
        if (!link || !info) return false;
        link.removeAttribute('data-i18n'); // a language load would reset it to the Pro line
        var draw = function () {
            link.textContent = t('planOffer.tryLink', 'Try {plan} free for 14 days →', { plan: info.name });
        };
        draw();
        link.setAttribute('href', '/app/dashboard.html#plan-offer');
        window.addEventListener('i18n:changed', draw);
        window.addEventListener('i18n:ready', draw);
        return true;
    }

    window.PlanOffer = {
        PAID_TIERS: PAID_TIERS.slice(),
        MAX_ACCOUNT_AGE_DAYS: MAX_ACCOUNT_AGE_DAYS,
        intentFor: intentFor,
        reason: reason,
        eligible: eligible,
        check: check,
        mount: mount,
        pointLink: pointLink,
    };
})();
