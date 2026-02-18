// =====================================================
// UPGRADE PAGE
// In-dashboard plan selection, comparison, and checkout
// =====================================================

let currentUser = null;
let currentProfile = null;
let currentOrganization = null;
let currentMembership = null;

// Stripe checkout state
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51HWGJPGNy14i1og8J56avjT0UdlWrPSUdRRHwUhkVKLnqAb2L4WfMPBj6vMq1X3aKl8WxwOwQvnCXYd8C63sDCXI00TN8OAJgM';
let stripeInstance = null;
let embeddedCheckout = null;
let appliedPromoCode = null;

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

    // Check if returning from checkout success
    checkSuccessState();
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
async function loadOrganization() {
    // Get membership
    const { data: membership, error: memError } = await window.supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', currentUser.id)
        .limit(1)
        .single();

    if (memError || !membership) return;
    currentMembership = membership;

    // Get organization
    const { data: org, error: orgError } = await window.supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single();

    if (!orgError && org) {
        currentOrganization = org;
    }
}

// ===== Render Current Plan State =====
function renderCurrentPlan() {
    if (!currentOrganization) return;

    const banner = document.getElementById('current-plan-banner');
    const planName = document.getElementById('current-plan-name');
    const planStatus = document.getElementById('current-plan-status');
    const subtitle = document.getElementById('page-subtitle');
    const manageBillingLink = document.getElementById('manage-billing-link');

    const org = currentOrganization;
    const planType = org.plan_type || 'free';
    const tier = org.subscription_tier;

    // Determine display name
    let displayName = 'Free';
    if (planType === 'appsumo_lifetime') {
        displayName = `AppSumo Lifetime Tier ${org.appsumo_tier || 1}`;
    } else if (planType === 'subscription') {
        displayName = tier === 'pro' ? 'Pro' : tier === 'max' ? 'Max' : tier === 'enterprise' ? 'Enterprise' : 'Free';
    }

    // Show banner
    banner.style.display = 'flex';
    planName.textContent = displayName;

    // Show status badge if subscribed
    if (org.subscription_status) {
        planStatus.textContent = org.subscription_status === 'trialing' ? 'Trial' :
                                 org.subscription_status === 'active' ? 'Active' :
                                 org.subscription_status === 'past_due' ? 'Past Due' : '';
        planStatus.className = `plan-status ${org.subscription_status}`;
        planStatus.style.display = planStatus.textContent ? 'inline-block' : 'none';
    }

    // Update subtitle for paid users
    if (planType !== 'free') {
        subtitle.textContent = 'Manage your subscription or upgrade to a higher tier.';
        manageBillingLink.style.display = 'inline-flex';
    }

    // Highlight current plan card & update buttons
    updatePlanCards(planType, tier, org);

    // Show Royalty Pro section for AppSumo users
    if (planType === 'appsumo_lifetime') {
        const royaltyProSection = document.getElementById('royalty-pro-section');
        if (royaltyProSection) {
            royaltyProSection.style.display = 'block';
        }
    }
}

// ===== Update Plan Card States =====
function updatePlanCards(planType, tier, org) {
    const cards = document.querySelectorAll('.upgrade-plan-card');

    cards.forEach(card => {
        const cardPlan = card.dataset.plan;
        const btn = card.querySelector('.checkout-btn, .current-plan-btn');
        if (!btn) return;

        let isCurrent = false;
        let isLower = false;

        if (planType === 'free') {
            isCurrent = cardPlan === 'free';
        } else if (planType === 'subscription') {
            isCurrent = cardPlan === tier;
            // Mark lower tiers
            const tierOrder = { free: 0, pro: 1, max: 2, enterprise: 3 };
            isLower = tierOrder[cardPlan] < tierOrder[tier];
        } else if (planType === 'appsumo_lifetime') {
            // AppSumo users: hide subscription cards, show only Royalty Pro upsell
            if (['pro', 'max'].includes(cardPlan)) {
                card.style.display = 'none';
                return;
            }
            isCurrent = cardPlan === 'free'; // They have LTD, effectively beyond free
        }

        if (isCurrent) {
            card.classList.add('current');
            btn.textContent = 'Current Plan';
            btn.disabled = true;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        } else if (isLower) {
            btn.textContent = 'Current Plan';
            btn.disabled = true;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    });

    // If on max (highest subscription tier), hide upgrade section except enterprise
    if (planType === 'subscription' && tier === 'max') {
        const proCard = document.querySelector('.upgrade-plan-card[data-plan="pro"]');
        if (proCard) proCard.style.display = 'none';
    }
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Billing toggle
    const billingToggle = document.getElementById('billing-toggle');
    if (billingToggle) {
        billingToggle.addEventListener('change', handleBillingToggle);
    }

    // Checkout buttons (event delegation)
    document.addEventListener('click', (e) => {
        const checkoutBtn = e.target.closest('.checkout-btn');
        if (checkoutBtn && !checkoutBtn.disabled) {
            const plan = checkoutBtn.dataset.plan;
            if (plan) handleCheckout(plan);
        }
    });

    // Checkout modal close
    const closeBtn = document.getElementById('checkout-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeCheckoutModal);
    }

    // Close on overlay click
    const modal = document.getElementById('checkout-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeCheckoutModal();
        });
    }

    // Promo code
    const applyPromoBtn = document.getElementById('apply-promo-btn');
    if (applyPromoBtn) {
        applyPromoBtn.addEventListener('click', validatePromoCode);
    }

    const promoInput = document.getElementById('checkout-promo-code');
    if (promoInput) {
        promoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') validatePromoCode();
        });
    }

    // ESC key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCheckoutModal();
    });
}

// ===== Billing Toggle =====
function handleBillingToggle(e) {
    const isAnnual = e.target.checked;
    const priceElements = document.querySelectorAll('.price-amount[data-monthly]');

    priceElements.forEach(el => {
        const price = isAnnual ? el.dataset.annual : el.dataset.monthly;
        el.textContent = `$${price}`;
    });

    // Update period text
    const periodElements = document.querySelectorAll('.price-period');
    periodElements.forEach(el => {
        // Skip elements in non-priced cards (Enterprise, Free)
        const card = el.closest('.upgrade-plan-card');
        if (card && ['enterprise', 'free'].includes(card.dataset.plan)) return;
        el.textContent = '/month';
    });
}

// ===== Stripe Checkout =====
function getStripe() {
    if (!stripeInstance && typeof Stripe !== 'undefined') {
        stripeInstance = Stripe(STRIPE_PUBLISHABLE_KEY);
    }
    return stripeInstance;
}

async function handleCheckout(plan) {
    const billingToggle = document.getElementById('billing-toggle');
    const isAnnual = billingToggle?.checked || false;
    const priceKey = `${plan}_${isAnnual ? 'annual' : 'monthly'}`;

    const btn = document.querySelector(`.checkout-btn[data-plan="${plan}"]`);
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Loading...';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        const response = await fetch(
            'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/create-checkout-session',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    priceKey: priceKey,
                    organizationId: currentOrganization.id,
                    embedded: true,
                    promoCode: appliedPromoCode || undefined
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.clientSecret) {
            await openCheckoutModal(data.clientSecret);
        }

        btn.disabled = false;
        btn.innerHTML = originalText;

    } catch (err) {
        console.error('Checkout error:', err);
        showToast(err.message || 'Failed to start checkout', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function openCheckoutModal(clientSecret) {
    const modal = document.getElementById('checkout-modal');
    const container = document.getElementById('checkout-container');

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const stripe = getStripe();

        if (embeddedCheckout) {
            embeddedCheckout.destroy();
        }

        embeddedCheckout = await stripe.initEmbeddedCheckout({
            clientSecret,
            onComplete: handleCheckoutComplete
        });

        container.innerHTML = '';
        embeddedCheckout.mount(container);

    } catch (err) {
        console.error('Error mounting checkout:', err);
        showToast('Failed to load checkout form', 'error');
        closeCheckoutModal();
    }
}

function closeCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    modal.style.display = 'none';
    document.body.style.overflow = '';

    if (embeddedCheckout) {
        embeddedCheckout.destroy();
        embeddedCheckout = null;
    }

    const container = document.getElementById('checkout-container');
    container.innerHTML = `
        <div class="checkout-loading">
            <div class="loading-spinner"></div>
            <p>Loading checkout...</p>
        </div>
    `;

    // Reset promo code state
    appliedPromoCode = null;
    const promoInput = document.getElementById('checkout-promo-code');
    const promoStatus = document.getElementById('promo-status');
    if (promoInput) {
        promoInput.value = '';
        promoInput.classList.remove('valid', 'invalid');
    }
    if (promoStatus) {
        promoStatus.textContent = '';
        promoStatus.className = 'promo-status';
    }
}

async function handleCheckoutComplete() {
    closeCheckoutModal();

    // Reload org data to get new plan
    await loadOrganization();

    // Show success state with celebration
    showSuccessState();
}

// ===== Promo Code Validation =====
async function validatePromoCode() {
    const promoInput = document.getElementById('checkout-promo-code');
    const promoStatus = document.getElementById('promo-status');
    const applyBtn = document.getElementById('apply-promo-btn');
    const code = promoInput?.value?.trim().toUpperCase();

    if (!code) {
        promoStatus.textContent = 'Please enter a code';
        promoStatus.className = 'promo-status invalid';
        return;
    }

    promoStatus.textContent = 'Checking...';
    promoStatus.className = 'promo-status checking';
    applyBtn.disabled = true;

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        const { data, error } = await window.supabase.rpc('check_appsumo_code', {
            code_to_check: code
        });

        if (error) throw error;

        if (data.valid) {
            if (data.code_type === 'appsumo') {
                promoInput.classList.add('invalid');
                promoInput.classList.remove('valid');
                promoStatus.textContent = 'AppSumo codes must be redeemed on the Redeem page';
                promoStatus.className = 'promo-status invalid';
                appliedPromoCode = null;
            } else {
                promoInput.classList.add('valid');
                promoInput.classList.remove('invalid');
                const discountText = data.discount_percent ? `${data.discount_percent}% off` : 'Discount applied';
                promoStatus.textContent = `${discountText} will be applied at checkout`;
                promoStatus.className = 'promo-status valid';
                appliedPromoCode = code;
            }
        } else {
            promoInput.classList.add('invalid');
            promoInput.classList.remove('valid');
            promoStatus.textContent = data.error || 'Invalid code';
            promoStatus.className = 'promo-status invalid';
            appliedPromoCode = null;
        }
    } catch (err) {
        console.error('Error validating promo code:', err);
        promoInput.classList.add('invalid');
        promoStatus.textContent = 'Error checking code';
        promoStatus.className = 'promo-status invalid';
        appliedPromoCode = null;
    } finally {
        applyBtn.disabled = false;
    }
}

// ===== Post-Checkout Success State =====

function checkSuccessState() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
        showSuccessState();
        // Clean URL without reload
        window.history.replaceState({}, '', '/app/upgrade.html');
    }
}

function showSuccessState() {
    // Fire celebration
    if (typeof celebrate === 'function') celebrate();
    showToast('Subscription activated! Welcome to your new plan.', 'success');

    // Hide the plans section, show success
    const upgradeSection = document.getElementById('upgrade-section');
    const successSection = document.getElementById('upgrade-success');
    const pageHeader = document.querySelector('.page-header');

    if (upgradeSection) upgradeSection.style.display = 'none';
    if (pageHeader) pageHeader.style.display = 'none';
    if (successSection) successSection.style.display = 'block';

    // Populate success content based on current plan
    const org = currentOrganization;
    if (!org) return;

    const tier = org.subscription_tier;
    const planType = org.plan_type;

    // Determine plan display name
    let planName = 'Pro';
    if (tier === 'max') planName = 'Max';
    else if (tier === 'enterprise') planName = 'Enterprise';
    else if (planType === 'appsumo_lifetime' && org.has_royalty_pro) planName = 'Royalty Pro';

    const title = document.getElementById('success-title');
    const subtitle = document.getElementById('success-subtitle');
    if (title) title.textContent = `Welcome to ${planName}!`;
    if (subtitle) {
        subtitle.textContent = planType === 'appsumo_lifetime'
            ? 'Your Royalty Pro add-on is now active.'
            : 'Your 14-day free trial has started. Cancel anytime.';
    }

    // Build metrics grid
    const metricsContainer = document.getElementById('success-metrics');
    if (metricsContainer) {
        metricsContainer.innerHTML = buildSuccessMetrics(tier, planType, org);
    }
}

function buildSuccessMetrics(tier, planType, org) {
    const metrics = [];

    if (planType === 'appsumo_lifetime' && org.has_royalty_pro) {
        // Royalty Pro add-on metrics
        metrics.push(
            { label: 'Emails/mo', value: '+10,000', icon: 'mail' },
            { label: 'SMS/mo', value: '500', icon: 'message' },
            { label: 'Royal AI', value: 'Unlimited', icon: 'brain' },
            { label: 'Autonomous Mode', value: 'Active', icon: 'zap' },
            { label: 'White-label', value: 'Enabled', icon: 'palette' },
            { label: 'Priority Support', value: 'Included', icon: 'headphones' }
        );
    } else if (tier === 'max') {
        metrics.push(
            { label: 'Customers', value: 'Unlimited', icon: 'users' },
            { label: 'Emails/mo', value: '50,000', icon: 'mail' },
            { label: 'SMS/mo', value: '2,000', icon: 'message' },
            { label: 'Royal AI', value: 'Unlimited', icon: 'brain' },
            { label: 'Visit Attribution', value: 'Active', icon: 'target' },
            { label: 'White-label', value: 'Enabled', icon: 'palette' }
        );
    } else {
        // Pro plan (default)
        metrics.push(
            { label: 'Customers', value: 'Unlimited', icon: 'users' },
            { label: 'Emails/mo', value: '10,000', icon: 'mail' },
            { label: 'SMS/mo', value: '500', icon: 'message' },
            { label: 'Royal AI', value: 'Unlimited', icon: 'brain' },
            { label: 'Autonomous Mode', value: 'Active', icon: 'zap' },
            { label: 'Business Learning', value: 'Active', icon: 'lightbulb' }
        );
    }

    const iconSVGs = {
        users: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        mail: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
        message: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        brain: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>',
        zap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        lightbulb: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>',
        target: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
        palette: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
        headphones: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>'
    };

    return metrics.map(m => `
        <div class="success-metric">
            <div class="success-metric-icon">${iconSVGs[m.icon] || ''}</div>
            <div class="success-metric-value">${m.value}</div>
            <div class="success-metric-label">${m.label}</div>
        </div>
    `).join('');
}

// ===== Init on DOM ready =====
document.addEventListener('DOMContentLoaded', initUpgrade);
