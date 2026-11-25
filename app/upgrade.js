// =====================================================
// UPGRADE PAGE
// Plan cards, comparison, checkout and the post-checkout screen for Starter/Growth/Scale.
//
// Plan abstract-gliding-hellman, Phase 3 (2026-11-25). Before: the banner and success screen still
// spoke of Pro/Max ("Welcome to Pro!" for a Growth trial), the promo box never sent its code,
// AppSumo owners could buy a plan over their lifetime deal, and checkout ran in an embedded Stripe
// modal the CSP may not allow. Checkout is now Stripe-hosted (a redirect): Stripe's page handles
// 3-D Secure, Apple Pay, Google Pay and promo codes (allow_promotion_codes).
// =====================================================

let currentUser = null;
let currentProfile = null;
let currentOrganization = null;
let currentMembership = null;

const UPGRADE_FUNCTIONS_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/';
const UPGRADE_TIER_ORDER = { free: 0, starter: 1, growth: 2, scale: 3, pro: 2, max: 3 };
const UPGRADE_PAID_TIERS = ['starter', 'growth', 'scale'];
const UPGRADE_POLL_MS = 2000;
const UPGRADE_POLL_LIMIT_MS = 20000;

// ===== Initialization =====
async function initUpgrade() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    await loadUserProfile();
    await loadOrganization();

    // Initialize sidebar
    if (typeof AppSidebar !== 'undefined') {
        let fullName = '';
        if (currentProfile && (currentProfile.first_name || currentProfile.last_name)) {
            fullName = [currentProfile.first_name, currentProfile.last_name].filter(Boolean).join(' ');
        } else {
            fullName = currentUser.email.split('@')[0];
        }

        AppSidebar.init({
            name: fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: currentMembership?.role,
            isAdmin: currentProfile?.is_admin === true
        });
    }

    renderCurrentPlan();
    setupEventListeners();

    // Returning from Stripe, or arriving from a ?plan= link
    checkReturnState();
    handlePlanDeepLink();
}

// ===== Load User Profile =====
async function loadUserProfile() {
    const { data, error } = await window.supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (!error && data) {
        currentProfile = data;
    }
}

// ===== Load Organization =====
// Loads the signed-in user's own org: this page ignores "view as" (upgradeViewingAs() turns
// checkout off instead, and create-checkout-session refuses an impersonating membership too).
async function loadOrganization() {
    const { data: membership, error: memError } = await window.supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', currentUser.id)
        .eq('is_impersonating', false) // a super admin's temporary "view as" row is not their org
        .limit(1)
        .single();

    if (memError || !membership) return;
    currentMembership = membership;

    const { data: org, error: orgError } = await window.supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single();

    if (!orgError && org) {
        currentOrganization = org;
    }
}

// ===== Plan helpers (pure) =====

/** The name of the plan this org is on, from PLAN_LIMITS. */
function upgradePlanName(org) {
    if (!org) return 'Free';
    const planType = org.plan_type || 'free';
    if (planType === 'appsumo_lifetime') {
        const base = `AppSumo Lifetime Tier ${org.appsumo_tier || 1}`;
        return org.has_royalty_pro ? `${base} + Royalty Pro` : base;
    }
    if (planType === 'subscription') {
        const plan = window.PLAN_LIMITS?.subscription?.[org.subscription_tier];
        if (plan?.name) return plan.name;
        return org.subscription_tier === 'enterprise' ? 'Enterprise' : 'Subscription';
    }
    return window.PLAN_LIMITS?.free?.name || 'Free';
}

/** Same rule as the server (_shared/checkout-rules.ts): the trial is for an org that never subscribed. */
function upgradeTrialAvailable(org) {
    if (!org) return true;
    const status = org.subscription_status == null ? '' : String(org.subscription_status);
    return !org.stripe_subscription_id && !org.cancelled_at && (status === '' || status === 'inactive');
}

function upgradeViewingAs() {
    try { return !!sessionStorage.getItem('adminViewAsOrg'); } catch (e) { return false; }
}

function upgradeCanManageBilling() {
    return ['owner', 'admin'].includes(currentMembership?.role);
}

/**
 * What a plan card's button does for this org:
 *   { action: 'current' | 'checkout' | 'portal' | 'none', label, primary }
 */
function upgradeCardState(cardPlan, org, opts) {
    opts = opts || {};
    const planType = org?.plan_type || 'free';
    const tier = org?.subscription_tier || null;
    const trial = upgradeTrialAvailable(org);

    if (opts.viewingAs) return { action: 'none', label: 'Checkout off while viewing as an org', primary: false };
    if (planType === 'appsumo_lifetime') return { action: 'none', label: '', primary: false, hidden: true };

    if (planType === 'free') {
        if (cardPlan === 'free') return { action: 'current', label: 'Current Plan', primary: false };
        if (!opts.canManage) return { action: 'none', label: 'Ask your account owner', primary: false };
        return { action: 'checkout', label: trial ? 'Start Free Trial' : 'Subscribe', primary: true };
    }

    // Subscribed: the matching card is current; every other card changes plan in Stripe's portal.
    if (cardPlan === tier) return { action: 'current', label: 'Current Plan', primary: false };
    if (!opts.canManage) return { action: 'none', label: 'Ask your account owner', primary: false };
    const higher = (UPGRADE_TIER_ORDER[cardPlan] ?? 0) > (UPGRADE_TIER_ORDER[tier] ?? 0);
    return { action: 'portal', label: 'Change Plan', primary: higher };
}

// ===== Render Current Plan State =====
function renderCurrentPlan() {
    if (!currentOrganization) return;

    const banner = document.getElementById('current-plan-banner');
    const planName = document.getElementById('current-plan-name');
    const planStatus = document.getElementById('current-plan-status');
    const subtitle = document.getElementById('page-subtitle');
    const manageBilling = document.getElementById('manage-billing-link');

    const org = currentOrganization;
    const planType = org.plan_type || 'free';

    banner.style.display = 'flex';
    planName.textContent = upgradePlanName(org);

    // Status badge for a subscription
    const status = planType === 'subscription' ? org.subscription_status : (org.has_royalty_pro ? org.royalty_pro_status : null);
    const statusText = status === 'trialing' ? 'Trial' : status === 'active' ? 'Active' : status === 'past_due' ? 'Past Due' : '';
    planStatus.textContent = statusText;
    planStatus.className = `plan-status ${status || ''}`.trim();
    planStatus.style.display = statusText ? 'inline-block' : 'none';

    if (planType === 'free') {
        subtitle.textContent = upgradeTrialAvailable(org)
            ? 'Start with a 14-day free trial. No card needed. Cancel anytime.'
            : 'Pick a plan. Cancel anytime.';
    } else if (planType === 'appsumo_lifetime') {
        subtitle.textContent = 'Your lifetime deal is active. Add Royalty Pro to let Royal run your marketing.';
    } else {
        subtitle.textContent = 'Change plans, update your card or cancel in Manage Billing.';
    }

    // Manage Billing opens Stripe's customer portal (needs a Stripe customer)
    const canPortal = !!org.stripe_customer_id && upgradeCanManageBilling() && !upgradeViewingAs()
        && (planType === 'subscription' || !!org.has_royalty_pro);
    if (manageBilling) manageBilling.style.display = canPortal ? 'inline-flex' : 'none';

    updatePlanCards(org);

    // AppSumo lifetime orgs see only the Royalty Pro add-on: a plan would overwrite their deal.
    const isLtd = planType === 'appsumo_lifetime';
    const hideForLtd = ['upgrade-plans', 'billing-toggle-container', 'comparison-section', 'billing-note'];
    hideForLtd.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = isLtd ? 'none' : '';
    });
    const royaltyProSection = document.getElementById('royalty-pro-section');
    if (royaltyProSection) {
        royaltyProSection.style.display = isLtd ? 'block' : 'none';
        const btn = royaltyProSection.querySelector('[data-plan="royalty_pro"]');
        if (btn && isLtd) {
            if (org.has_royalty_pro || upgradeViewingAs() || !upgradeCanManageBilling()) {
                btn.disabled = true;
                btn.classList.remove('checkout-btn');
                btn.textContent = org.has_royalty_pro ? 'Royalty Pro is active'
                    : upgradeViewingAs() ? 'Checkout off while viewing as an org' : 'Ask your account owner';
            }
        }
    }
}

// ===== Update Plan Card States =====
function updatePlanCards(org) {
    const opts = { viewingAs: upgradeViewingAs(), canManage: upgradeCanManageBilling() };
    document.querySelectorAll('.upgrade-plan-card').forEach((card) => {
        const cardPlan = card.dataset.plan;
        if (cardPlan === 'enterprise') return; // a link to the estimate page, same for everyone
        const btn = card.querySelector('button');
        if (!btn) return;

        const state = upgradeCardState(cardPlan, org, opts);
        card.classList.toggle('current', state.action === 'current');
        btn.classList.remove('checkout-btn', 'portal-btn', 'current-plan-btn', 'btn-primary', 'btn-secondary');
        btn.classList.add(state.primary ? 'btn-primary' : 'btn-secondary');
        btn.textContent = state.label;
        btn.disabled = state.action === 'current' || state.action === 'none';
        btn.hidden = !!state.hidden;
        if (state.action === 'checkout') btn.classList.add('checkout-btn');
        if (state.action === 'portal') btn.classList.add('portal-btn');
        if (state.action === 'current') btn.classList.add('current-plan-btn');
    });
}

// ===== Event Listeners =====
function setupEventListeners() {
    const billingToggle = document.getElementById('billing-toggle');
    if (billingToggle) {
        billingToggle.addEventListener('change', handleBillingToggle);
    }

    document.addEventListener('click', (e) => {
        const checkoutBtn = e.target.closest('.checkout-btn');
        if (checkoutBtn && !checkoutBtn.disabled) {
            const plan = checkoutBtn.dataset.plan;
            if (plan) handleCheckout(plan, checkoutBtn);
            return;
        }
        const portalBtn = e.target.closest('.portal-btn');
        if (portalBtn && !portalBtn.disabled) openBillingPortal(portalBtn);
    });
}

// ===== Billing Toggle =====
function handleBillingToggle(e) {
    const isAnnual = e.target.checked;
    document.querySelectorAll('.price-amount[data-monthly]').forEach(el => {
        const price = isAnnual ? el.dataset.annual : el.dataset.monthly;
        el.textContent = `$${price}`;
    });
}

// ===== Checkout (Stripe-hosted) =====
async function handleCheckout(plan, btn) {
    if (upgradeViewingAs() || !currentOrganization) return;
    const billingToggle = document.getElementById('billing-toggle');
    const isAnnual = billingToggle?.checked || false;
    // Royalty Pro add-on is monthly-only — never build royalty_pro_annual (no such price → 400).
    const priceKey = plan === 'royalty_pro'
        ? 'royalty_pro_monthly'
        : `${plan}_${isAnnual ? 'annual' : 'monthly'}`;

    window.Analytics?.track('checkout_started', {
        plan: plan,
        price_key: priceKey,
        annual: isAnnual,
        hosted: true
    });

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        const origin = window.location.origin;
        const response = await fetch(UPGRADE_FUNCTIONS_URL + 'create-checkout-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                priceKey: priceKey,
                organizationId: currentOrganization.id,
                embedded: false,
                successUrl: `${origin}/app/upgrade.html?success=true`,
                cancelUrl: `${origin}/app/upgrade.html?canceled=true`
            })
        });

        let data = {};
        try { data = await response.json(); } catch (e) { data = {}; }
        if (!response.ok || !data.url) {
            throw new Error(data.error || 'Failed to start checkout');
        }
        window.location.assign(data.url);
    } catch (err) {
        console.error('Checkout error:', err);
        showToast(err.message || 'Failed to start checkout', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// ===== Stripe customer portal (change plan, card, cancel) =====
async function openBillingPortal(btn) {
    if (!currentOrganization || upgradeViewingAs()) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading…';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        const response = await fetch(UPGRADE_FUNCTIONS_URL + 'create-portal-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                organizationId: currentOrganization.id,
                returnUrl: `${window.location.origin}/app/upgrade.html`
            })
        });

        let data = {};
        try { data = await response.json(); } catch (e) { data = {}; }
        if (data.error) throw new Error(data.error);
        if (!data.url) throw new Error('Failed to open billing portal');
        window.location.assign(data.url);
    } catch (err) {
        console.error('Portal error:', err);
        showToast(err.message || 'Failed to open billing portal', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// ===== ?plan= deep link: point at that card, never start checkout =====
// Every checkout attempt uses one of 5 per hour, so the click stays the owner's.
function handlePlanDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const plan = (params.get('plan') || '').toLowerCase();
    if (!params.has('plan')) return;

    params.delete('plan');
    const rest = params.toString();
    window.history.replaceState({}, '', '/app/upgrade.html' + (rest ? '?' + rest : '') + window.location.hash);

    if (!UPGRADE_PAID_TIERS.includes(plan)) return;
    if ((currentOrganization?.plan_type || 'free') !== 'free' || upgradeViewingAs()) return;
    const card = document.querySelector(`.upgrade-plan-card[data-plan="${plan}"]`);
    if (!card) return;
    card.classList.add('is-highlighted');
    if (card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const btn = card.querySelector('.checkout-btn');
    if (btn && btn.focus) btn.focus({ preventScroll: true });
}

// ===== Back from Stripe =====
function checkReturnState() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === 'true') {
        window.history.replaceState({}, '', '/app/upgrade.html');
        showToast('Checkout canceled. You have not been charged.', 'info');
        return;
    }
    if (params.get('success') === 'true') {
        const fromOffer = params.get('from') === 'offer';
        window.history.replaceState({}, '', '/app/upgrade.html');
        window.Analytics?.track('checkout_completed', { from: fromOffer ? 'offer' : 'upgrade' });
        showSuccessState({ fromOffer });
    }
}

/** The org now shows the plan Stripe sold (the webhook has run). */
function upgradeIsSettled(org) {
    if (!org) return false;
    return org.plan_type === 'subscription' || (org.plan_type === 'appsumo_lifetime' && !!org.has_royalty_pro);
}

async function showSuccessState(opts) {
    opts = opts || {};
    const upgradeSection = document.getElementById('upgrade-section');
    const successSection = document.getElementById('upgrade-success');
    const pageHeader = document.querySelector('.page-header');
    if (upgradeSection) upgradeSection.style.display = 'none';
    if (pageHeader) pageHeader.style.display = 'none';
    if (successSection) successSection.style.display = 'block';

    const back = document.getElementById('success-back-to-app');
    if (back) back.hidden = !opts.fromOffer;

    // Stripe redirects back before its webhook has always reached us: say nothing about a plan
    // until the org shows one.
    renderSuccess(null);
    const started = Date.now();
    while (!upgradeIsSettled(currentOrganization) && Date.now() - started < UPGRADE_POLL_LIMIT_MS) {
        await new Promise((r) => setTimeout(r, UPGRADE_POLL_MS));
        await loadOrganization();
    }
    renderSuccess(currentOrganization, { timedOut: !upgradeIsSettled(currentOrganization) });
    if (upgradeIsSettled(currentOrganization) && typeof celebrate === 'function') celebrate();
}

/** The success screen for org (null = still waiting for the webhook). */
function renderSuccess(org, opts) {
    opts = opts || {};
    const title = document.getElementById('success-title');
    const subtitle = document.getElementById('success-subtitle');
    const metrics = document.getElementById('success-metrics');
    const manage = document.getElementById('success-manage-billing');

    if (!org || !upgradeIsSettled(org)) {
        if (title) title.textContent = opts.timedOut ? 'Almost there' : 'Starting your plan…';
        if (subtitle) {
            subtitle.textContent = opts.timedOut
                ? 'Stripe has your order. Your plan will show here within a minute: refresh this page if it doesn’t.'
                : 'This takes a few seconds.';
        }
        if (metrics) metrics.textContent = '';
        if (manage) manage.hidden = true;
        return;
    }

    const isAddon = org.plan_type === 'appsumo_lifetime';
    const plan = isAddon ? window.PLAN_LIMITS?.royalty_pro : window.PLAN_LIMITS?.subscription?.[org.subscription_tier];
    const name = plan?.name || upgradePlanName(org);
    const status = isAddon ? org.royalty_pro_status : org.subscription_status;
    if (title) title.textContent = `Welcome to ${name}!`;
    if (subtitle) {
        subtitle.textContent = status === 'trialing'
            ? 'Your 14-day free trial has started. No card needed until it ends. Cancel anytime.'
            : isAddon ? 'Your Royalty Pro add-on is now active.' : 'Your subscription is active.';
    }
    if (metrics) buildSuccessMetrics(metrics, plan, isAddon);
    if (manage) manage.hidden = !org.stripe_customer_id;
}

function upgradeFormatNumber(n) {
    return Number(n).toLocaleString('en-US');
}

/** The tiles on the success screen, from the plan's PLAN_LIMITS entry. */
function upgradeSuccessMetrics(plan, isAddon) {
    if (!plan) return [];
    const out = [];
    if (isAddon) {
        out.push({ label: 'Emails/mo', value: '+' + upgradeFormatNumber(plan.emails_monthly_bonus), icon: 'mail' });
    } else {
        out.push({ label: 'Customers', value: plan.members === -1 ? 'Unlimited' : upgradeFormatNumber(plan.members), icon: 'users' });
        out.push({ label: 'Emails/mo', value: upgradeFormatNumber(plan.emails_monthly), icon: 'mail' });
    }
    out.push({ label: 'SMS/mo', value: upgradeFormatNumber(plan.sms_monthly), icon: 'message' });
    if (plan.royal_queries_monthly) {
        out.push({ label: 'Royal AI queries/mo', value: plan.royal_queries_monthly === -1 ? 'Unlimited' : upgradeFormatNumber(plan.royal_queries_monthly), icon: 'brain' });
    }
    out.push(plan.autonomous_mode
        ? { label: 'Autonomous Mode', value: 'Active', icon: 'zap' }
        : { label: 'Review-mode automations', value: 'Active', icon: 'zap' });
    if (plan.visit_attribution) out.push({ label: 'Visit Attribution', value: 'Active', icon: 'target' });
    else if (plan.business_learning) out.push({ label: 'Business Learning', value: 'Active', icon: 'lightbulb' });
    if (plan.white_label) out.push({ label: 'White-label', value: 'Enabled', icon: 'palette' });
    return out.slice(0, 6);
}

const UPGRADE_ICONS = {
    users: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    mail: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    message: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    brain: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>',
    zap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    lightbulb: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>',
    target: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    palette: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>'
};

function buildSuccessMetrics(container, plan, isAddon) {
    container.textContent = '';
    upgradeSuccessMetrics(plan, isAddon).forEach((m) => {
        const tile = document.createElement('div');
        tile.className = 'success-metric';
        const icon = document.createElement('div');
        icon.className = 'success-metric-icon';
        icon.innerHTML = UPGRADE_ICONS[m.icon] || ''; // static markup above, never data
        const value = document.createElement('div');
        value.className = 'success-metric-value';
        value.textContent = m.value;
        const label = document.createElement('div');
        label.className = 'success-metric-label';
        label.textContent = m.label;
        tile.append(icon, value, label);
        container.appendChild(tile);
    });
}

// ===== Init on DOM ready =====
document.addEventListener('DOMContentLoaded', initUpgrade);
