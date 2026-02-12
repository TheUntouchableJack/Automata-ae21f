// =====================================================
// SETTINGS PAGE
// =====================================================

let currentUser = null;
let currentProfile = null;
let currentOrganization = null;
let currentMembership = null;
let teamMembers = [];
let pendingInvitations = [];
let orgLimits = null;

// Activity Log state
let activityLogs = [];
let activityPage = 1;
const ACTIVITY_PAGE_SIZE = 20;
let hasMoreActivity = true;
let activityLoaded = false;

// AI Settings state
let aiSettingsLoaded = false;

// Promo code state
let appliedPromoCode = null;

// ===== Initialization =====
async function initSettings() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    await loadUserProfile();
    await loadOrganization();
    await loadTeamMembers();
    await loadPendingInvitations();

    // Initialize sidebar with user data (including role for admin features)
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

    renderProfile();
    renderTeam();
    renderPlan();

    setupEventListeners();
    setupUserMenu();
}

// ===== Load Data =====
async function loadUserProfile() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error) {
        console.error('Error loading profile:', error);
        showToast(window.t ? window.t('toasts.profileLoading') : 'Unable to load your profile', 'error');
        return;
    }

    currentProfile = data;
    updateHeaderUserInfo();
}

async function loadOrganization() {
    // Get user's organization membership
    const { data: memberships, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', currentUser.id);

    if (memberError || !memberships || memberships.length === 0) {
        console.error('No organization found');
        showToast(window.t ? window.t('toasts.orgLoading') : 'Unable to load organization. Please refresh.', 'error');
        return;
    }

    currentMembership = memberships[0];

    // Get organization details
    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', currentMembership.organization_id)
        .single();

    if (orgError) {
        console.error('Error loading organization:', orgError);
        showToast(window.t ? window.t('toasts.orgDetailsLoading') : 'Unable to load organization details', 'error');
        return;
    }

    currentOrganization = org;

    // Get plan limits
    if (typeof PlanLimits !== 'undefined') {
        orgLimits = PlanLimits.getOrgLimits(org);
    } else {
        orgLimits = { name: 'Free', projects: 1, automations: 3, customers: 100, emails_monthly: 500, ai_analyses: 5, team_members: 1 };
    }
}

async function loadTeamMembers() {
    if (!currentOrganization) return;

    const { data, error } = await supabase
        .from('organization_members')
        .select(`
            id,
            role,
            joined_at,
            user_id,
            profiles (
                id,
                email,
                first_name,
                last_name,
                avatar_url
            )
        `)
        .eq('organization_id', currentOrganization.id)
        .order('joined_at', { ascending: true });

    if (error) {
        console.error('Error loading team members:', error);
        showToast(window.t ? window.t('toasts.teamLoading') : 'Unable to load team members', 'error');
        return;
    }

    teamMembers = data || [];
}

async function loadPendingInvitations() {
    if (!currentOrganization) return;

    const { data, error } = await supabase
        .from('organization_invitations')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        // Table might not exist yet
        console.log('Invitations table may not exist:', error);
        return;
    }

    pendingInvitations = data || [];
}

// ===== Render Functions =====
function renderProfile() {
    if (!currentProfile) return;

    // Update form fields
    document.getElementById('first-name').value = currentProfile.first_name || '';
    document.getElementById('last-name').value = currentProfile.last_name || '';
    document.getElementById('email-display').value = currentProfile.email || currentUser.email;
    document.getElementById('phone').value = currentProfile.phone || '';

    // Update avatar
    updateAvatarDisplay();

    // Initialize advanced mode toggle from localStorage
    const advancedModeToggle = document.getElementById('advanced-mode-toggle');
    if (advancedModeToggle) {
        const isAdvanced = localStorage.getItem('advancedMode') === 'true';
        advancedModeToggle.checked = isAdvanced;
    }
}

function updateAvatarDisplay() {
    const preview = document.getElementById('avatar-preview');
    const initials = document.getElementById('avatar-initials');
    const image = document.getElementById('avatar-image');
    const removeBtn = document.getElementById('remove-avatar-btn');

    if (currentProfile.avatar_url) {
        initials.style.display = 'none';
        image.style.display = 'block';
        image.src = currentProfile.avatar_url;
        removeBtn.style.display = 'inline-flex';
    } else {
        initials.style.display = 'flex';
        image.style.display = 'none';
        initials.textContent = getInitials(currentProfile.first_name, currentProfile.last_name);
        removeBtn.style.display = 'none';
    }
}

function updateHeaderUserInfo() {
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');

    if (!userAvatar || !userName) return;

    if (currentProfile && (currentProfile.first_name || currentProfile.last_name)) {
        const fullName = [currentProfile.first_name, currentProfile.last_name].filter(Boolean).join(' ');
        userAvatar.textContent = getInitials(currentProfile.first_name, currentProfile.last_name);
        userName.textContent = fullName;
    } else {
        userAvatar.textContent = currentUser.email.substring(0, 2).toUpperCase();
        userName.textContent = currentUser.email.split('@')[0];
    }
}

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

function renderTeam() {
    const membersList = document.getElementById('team-members-list');
    const invitationsSection = document.getElementById('pending-invitations-section');
    const invitationsList = document.getElementById('pending-invitations-list');

    // Render team members
    if (teamMembers.length === 0) {
        membersList.innerHTML = '<p class="empty-text">No team members found.</p>';
    } else {
        membersList.innerHTML = teamMembers.map(member => {
            const profile = member.profiles;
            const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || 'Unknown';
            const initials = getInitials(profile?.first_name, profile?.last_name);
            const isCurrentUser = member.user_id === currentUser.id;
            const canManage = currentMembership.role === 'owner' || currentMembership.role === 'admin';

            return `
                <div class="team-member-card" data-member-id="${member.id}">
                    <div class="team-member-info">
                        <div class="team-member-avatar">
                            ${profile?.avatar_url
                                ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">`
                                : escapeHtml(initials)
                            }
                        </div>
                        <div class="team-member-details">
                            <h4>${escapeHtml(name)} ${isCurrentUser ? '<span class="team-member-you">(you)</span>' : ''}</h4>
                            <p>${escapeHtml(profile?.email || '')}</p>
                        </div>
                    </div>
                    <div class="team-member-meta">
                        <span class="team-member-role ${member.role}">${escapeHtml(member.role)}</span>
                        ${canManage && !isCurrentUser && member.role !== 'owner' ? `
                            <div class="team-member-actions">
                                <select class="btn btn-sm btn-secondary role-select" data-member-id="${member.id}">
                                    <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
                                    <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                                </select>
                                <button class="btn btn-sm btn-ghost remove-member-btn" data-member-id="${member.id}">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render pending invitations
    if (pendingInvitations.length > 0) {
        invitationsSection.style.display = 'block';
        invitationsList.innerHTML = pendingInvitations.map(inv => `
            <div class="invitation-card" data-invitation-id="${inv.id}">
                <div class="invitation-info">
                    <div class="invitation-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                    </div>
                    <div class="invitation-details">
                        <p>${escapeHtml(inv.email)}</p>
                        <span>${escapeHtml(inv.role)} - Pending</span>
                    </div>
                </div>
                <div class="invitation-actions">
                    <button class="btn btn-sm btn-ghost cancel-invite-btn" data-invitation-id="${inv.id}">Cancel</button>
                </div>
            </div>
        `).join('');
    } else {
        invitationsSection.style.display = 'none';
    }
}

function renderPlan() {
    if (!orgLimits) return;

    const planName = document.getElementById('plan-name');
    const planFeatures = document.getElementById('plan-features');
    const planStatus = document.getElementById('plan-status');
    const upgradeSection = document.getElementById('upgrade-section');
    const manageSection = document.getElementById('manage-subscription-section');

    planName.textContent = orgLimits.name || 'Free';

    // Show subscription status
    if (currentOrganization?.subscription_status) {
        const status = currentOrganization.subscription_status;
        planStatus.textContent = status === 'trialing' ? '(Trial)' :
                                  status === 'active' ? '(Active)' :
                                  status === 'past_due' ? '(Past Due)' : '';
        planStatus.className = `plan-status ${status}`;

        // Show payment warning banner if past due
        const warningBanner = document.getElementById('payment-warning-banner');
        if (warningBanner) {
            if (status === 'past_due') {
                warningBanner.style.display = 'flex';
                const failureCount = currentOrganization.payment_failure_count || 1;
                const warningMessage = document.getElementById('payment-warning-message');
                if (warningMessage) {
                    if (failureCount >= 3) {
                        warningMessage.textContent = 'Your subscription will be canceled soon. Please update your payment method immediately to keep your account active.';
                    } else if (failureCount === 2) {
                        warningMessage.textContent = 'This is our second attempt to process your payment. Please update your payment method to avoid service interruption.';
                    } else {
                        warningMessage.textContent = "We couldn't process your last payment. Please update your payment method to avoid service interruption.";
                    }
                }
            } else {
                warningBanner.style.display = 'none';
            }
        }
    }

    // Build features list based on new pricing model
    const featuresHtml = [];

    featuresHtml.push(`
        <div class="feature-item">
            <span class="feature-label">Customers</span>
            <span class="feature-value">${formatLimit(orgLimits.members)}</span>
        </div>
    `);

    featuresHtml.push(`
        <div class="feature-item">
            <span class="feature-label">AI Insights/month</span>
            <span class="feature-value">${orgLimits.intelligence_monthly === 0 ? 'Not included' : formatLimit(orgLimits.intelligence_monthly)}</span>
        </div>
    `);

    featuresHtml.push(`
        <div class="feature-item">
            <span class="feature-label">Automations</span>
            <span class="feature-value">${orgLimits.automations ? 'Included' : 'Not included'}</span>
        </div>
    `);

    featuresHtml.push(`
        <div class="feature-item">
            <span class="feature-label">White-label</span>
            <span class="feature-value">${orgLimits.white_label ? 'Included' : 'Not included'}</span>
        </div>
    `);

    // Show Royalty Pro badge if LTD user has it
    if (orgLimits.has_royalty_pro) {
        featuresHtml.push(`
            <div class="feature-item royalty-pro-badge-item">
                <span class="feature-label">Royalty Pro</span>
                <span class="feature-value royalty-pro-active">Active</span>
            </div>
        `);
    }

    planFeatures.innerHTML = featuresHtml.join('');

    // Show/hide upgrade vs manage sections based on plan
    const isPayingUser = currentOrganization?.plan_type === 'subscription' ||
                         currentOrganization?.plan_type === 'appsumo_lifetime';

    if (isPayingUser && currentOrganization?.stripe_customer_id) {
        manageSection.style.display = 'block';
        updateUpgradePlansVisibility();
        updateCancelNotice();
    } else {
        upgradeSection.style.display = 'block';
        manageSection.style.display = 'none';
    }
}

function updateUpgradePlansVisibility() {
    const currentTier = currentOrganization?.subscription_tier;
    const planType = currentOrganization?.plan_type;
    const tierOrder = ['pro', 'max'];
    const currentIndex = tierOrder.indexOf(currentTier);
    const upgradeSection = document.getElementById('upgrade-section');
    const royaltyProSection = document.getElementById('royalty-pro-section');

    // Handle subscription users
    if (planType === 'subscription') {
        document.querySelectorAll('.upgrade-plan-card').forEach(card => {
            const planTier = card.dataset.plan;
            if (planTier === 'royalty_pro' || planTier === 'enterprise') return; // Skip Royalty Pro and Enterprise cards

            const planIndex = tierOrder.indexOf(planTier);

            if (currentIndex >= 0 && planIndex <= currentIndex) {
                card.style.display = 'none';
            } else {
                card.style.display = '';
            }
        });

        // If on max (highest subscription tier), hide upgrade section
        if (currentTier === 'max') {
            upgradeSection.style.display = 'none';
        }

        // Hide Royalty Pro for subscription users
        if (royaltyProSection) {
            royaltyProSection.style.display = 'none';
        }
    }

    // Handle AppSumo LTD users
    if (planType === 'appsumo_lifetime') {
        // Hide subscription upgrade cards for LTD users
        document.querySelectorAll('.upgrade-plan-card').forEach(card => {
            const planTier = card.dataset.plan;
            if (planTier !== 'royalty_pro') {
                card.style.display = 'none';
            }
        });

        // Show Royalty Pro section if they don't have it yet
        if (royaltyProSection) {
            if (currentOrganization?.has_royalty_pro) {
                royaltyProSection.style.display = 'none';
            } else {
                royaltyProSection.style.display = 'block';
                upgradeSection.style.display = 'block';
            }
        }
    }
}

// ===== Stripe Checkout =====
// Stripe publishable key (safe to expose - this is NOT the secret key)
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51HWGJPGNy14i1og8J56avjT0UdlWrPSUdRRHwUhkVKLnqAb2L4WfMPBj6vMq1X3aKl8WxwOwQvnCXYd8C63sDCXI00TN8OAJgM';
let stripeInstance = null;
let embeddedCheckout = null;

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

        // Request embedded checkout session
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

        // Open modal and mount embedded checkout
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

async function handleBundlePurchase(bundleKey) {
    const btn = document.querySelector(`.bundle-buy-btn[data-bundle="${bundleKey}"]`);
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Loading...';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        // Request embedded checkout session for bundle
        const response = await fetch(
            'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/create-checkout-session',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    priceKey: bundleKey,
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

        // Open modal and mount embedded checkout
        if (data.clientSecret) {
            await openCheckoutModal(data.clientSecret);
        }

        btn.disabled = false;
        btn.innerHTML = originalText;

    } catch (err) {
        console.error('Bundle purchase error:', err);
        showToast(err.message || 'Failed to start checkout', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function openCheckoutModal(clientSecret) {
    const modal = document.getElementById('checkout-modal');
    const container = document.getElementById('checkout-container');

    // Show modal with loading state
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const stripe = getStripe();

        // Destroy previous checkout if exists
        if (embeddedCheckout) {
            embeddedCheckout.destroy();
        }

        // Initialize embedded checkout
        embeddedCheckout = await stripe.initEmbeddedCheckout({
            clientSecret,
            onComplete: handleCheckoutComplete
        });

        // Clear container and mount checkout
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

    // Destroy embedded checkout
    if (embeddedCheckout) {
        embeddedCheckout.destroy();
        embeddedCheckout = null;
    }

    // Reset container to loading state
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

    // Show checking state
    promoStatus.textContent = 'Checking...';
    promoStatus.className = 'promo-status checking';
    applyBtn.disabled = true;

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Call the RPC function to validate the code
        const { data, error } = await supabase.rpc('check_appsumo_code', {
            code_to_check: code
        });

        if (error) throw error;

        if (data.valid) {
            // Handle based on code type
            if (data.code_type === 'appsumo') {
                // AppSumo codes should be redeemed on /app/redeem.html, not checkout
                promoInput.classList.add('invalid');
                promoInput.classList.remove('valid');
                promoStatus.textContent = 'AppSumo codes must be redeemed on the Redeem page';
                promoStatus.className = 'promo-status invalid';
                appliedPromoCode = null;
            } else {
                // Tester/promo code - save for checkout
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

async function handleCheckoutComplete() {
    // Close modal
    closeCheckoutModal();

    // Show success message
    showToast(window.t ? window.t('toasts.subscriptionActivated') : 'Subscription activated! Welcome to your new plan.', 'success');
    celebrate();

    // Reload organization data to reflect new plan
    await loadOrganization();
    renderPlan();
}

async function handleManageBilling() {
    const btn = document.getElementById('manage-billing-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Loading...';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        const response = await fetch(
            'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/create-portal-session',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    organizationId: currentOrganization.id
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.url) {
            window.location.href = data.url;
        }
    } catch (err) {
        console.error('Portal error:', err);
        showToast(err.message || 'Failed to open billing portal', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ===== Subscription Cancellation =====
async function cancelSubscription() {
    // Show confirmation using DangerModal
    DangerModal.show({
        title: 'Cancel Subscription',
        itemName: orgLimits?.name || 'your subscription',
        warningText: 'Your subscription will remain active until the end of your current billing period. You\'ll keep full access until then, and no further charges will be made.',
        confirmPhrase: 'CANCEL',
        confirmButtonText: 'Cancel Subscription',
        onConfirm: async () => {
            const btn = document.getElementById('cancel-subscription-btn');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = 'Canceling...';

            try {
                const session = await getValidSession();
                if (!session) {
                    throw new Error('Session expired. Please refresh the page and log in again.');
                }

                const response = await fetch(
                    'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/cancel-subscription',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({
                            organizationId: currentOrganization.id,
                            reactivate: false
                        })
                    }
                );

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                // Reload organization to get updated subscription_cancel_at
                await loadOrganization();
                renderPlan();
                updateCancelNotice();

                showToast('Subscription scheduled to cancel. You\'ll keep access until the end of your billing period.', 'success');
            } catch (err) {
                console.error('Cancel subscription error:', err);
                showToast(err.message || 'Failed to cancel subscription', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    });
}

async function reactivateSubscription() {
    const btn = document.getElementById('reactivate-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Reactivating...';

    try {
        const session = await getValidSession();
        if (!session) {
            throw new Error('Session expired. Please refresh the page and log in again.');
        }

        const response = await fetch(
            'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/cancel-subscription',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    organizationId: currentOrganization.id,
                    reactivate: true
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // Reload organization to get updated state
        await loadOrganization();
        renderPlan();
        updateCancelNotice();

        showToast('Subscription reactivated! Your plan will continue as normal.', 'success');
        celebrate();
    } catch (err) {
        console.error('Reactivate subscription error:', err);
        showToast(err.message || 'Failed to reactivate subscription', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function updateCancelNotice() {
    const cancelNotice = document.getElementById('cancel-notice');
    const cancelDate = document.getElementById('cancel-date');
    const cancelBtn = document.getElementById('cancel-subscription-btn');

    if (!cancelNotice) return;

    // Check if subscription is scheduled to cancel
    if (currentOrganization?.subscription_cancel_at) {
        const cancelAt = new Date(currentOrganization.subscription_cancel_at);
        const formattedDate = cancelAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        cancelDate.textContent = formattedDate;
        cancelNotice.style.display = 'flex';

        // Hide the cancel button since already scheduled
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
    } else {
        cancelNotice.style.display = 'none';

        // Show the cancel button
        if (cancelBtn) {
            cancelBtn.style.display = '';
        }
    }
}

function formatLimit(value) {
    if (value === undefined || value === null) return '—';
    if (value === -1 || value === Infinity) return 'Unlimited';
    return value.toLocaleString();
}

// ===== Activity Log =====
async function loadActivityLogs(reset = false) {
    if (!currentOrganization) return;

    if (reset) {
        activityPage = 1;
        hasMoreActivity = true;
        activityLogs = [];
    }

    const feed = document.getElementById('activity-feed');
    const empty = document.getElementById('activity-empty');
    const pagination = document.getElementById('activity-pagination');

    if (reset) {
        feed.innerHTML = '<div class="loading-spinner"></div>';
        empty.style.display = 'none';
    }

    try {
        const entityFilter = document.getElementById('activity-entity-filter').value;
        const dateFilter = document.getElementById('activity-date-filter').value;

        let query = supabase
            .from('audit_logs')
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .order('created_at', { ascending: false })
            .range((activityPage - 1) * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE - 1);

        // Entity type filter
        if (entityFilter) {
            if (entityFilter === 'team') {
                query = query.in('entity_type', ['team_member', 'team_invite']);
            } else {
                query = query.eq('entity_type', entityFilter);
            }
        }

        // Date filter
        if (dateFilter !== 'all') {
            const daysAgo = new Date();
            daysAgo.setDate(daysAgo.getDate() - parseInt(dateFilter));
            query = query.gte('created_at', daysAgo.toISOString());
        }

        const { data, error } = await query;

        if (error) {
            // Table might not exist yet
            console.log('Audit logs table may not exist:', error);
            feed.innerHTML = '';
            empty.style.display = 'block';
            pagination.style.display = 'none';
            return;
        }

        // Check if we have more data
        hasMoreActivity = data && data.length === ACTIVITY_PAGE_SIZE;

        if (reset) {
            activityLogs = data || [];
        } else {
            activityLogs = [...activityLogs, ...(data || [])];
        }

        if (activityLogs.length === 0) {
            feed.innerHTML = '';
            empty.style.display = 'block';
            pagination.style.display = 'none';
        } else {
            empty.style.display = 'none';
            renderActivityFeed();
            pagination.style.display = hasMoreActivity ? 'flex' : 'none';
        }

        activityLoaded = true;

    } catch (error) {
        console.error('Error loading activity logs:', error);
        showToast(window.t ? window.t('toasts.activityLoading') : 'Unable to load activity logs', 'error');
        feed.innerHTML = '';
        empty.style.display = 'block';
    }
}

function renderActivityFeed() {
    const feed = document.getElementById('activity-feed');

    feed.innerHTML = activityLogs.map(log => {
        const icon = getActivityIcon(log.action);
        const description = getActivityDescription(log);
        const timeAgo = formatTimeAgo(log.created_at);
        const changesHtml = renderActivityChanges(log.changes_summary);

        return `
            <div class="activity-item">
                <div class="activity-icon ${log.action}">
                    ${icon}
                </div>
                <div class="activity-content">
                    <div class="activity-description">${description}</div>
                    ${changesHtml}
                    <div class="activity-meta">
                        <span>${escapeHtml(log.user_name || log.user_email)}</span>
                        <span>${timeAgo}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getActivityIcon(action) {
    const icons = {
        create: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg>',
        update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>',
        delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>',
        activate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>',
        deactivate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
        invite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>',
        remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"/></svg>',
        role_change: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>',
        cancel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>'
    };
    return icons[action] || icons.update;
}

function getActivityDescription(log) {
    const entityName = log.entity_name ? `<span class="entity-name">${escapeHtml(log.entity_name)}</span>` : '';

    const descriptions = {
        // Projects
        'project:create': `Created project ${entityName}`,
        'project:update': `Updated project ${entityName}`,
        'project:delete': `Deleted project ${entityName}`,

        // Automations
        'automation:create': `Created automation ${entityName}`,
        'automation:update': `Updated automation ${entityName}`,
        'automation:delete': `Deleted automation ${entityName}`,
        'automation:activate': `Activated automation ${entityName}`,
        'automation:deactivate': `Paused automation ${entityName}`,

        // Customers
        'customer:create': `Added customer ${entityName}`,
        'customer:update': `Updated customer ${entityName}`,
        'customer:delete': `Deleted customer ${entityName}`,

        // Team
        'team_member:role_change': `Changed role for ${entityName}`,
        'team_member:remove': `Removed team member ${entityName}`,
        'team_invite:invite': `Invited ${entityName} to the team`,
        'team_invite:cancel': `Cancelled invitation for ${entityName}`,

        // Settings
        'settings:update': `Updated settings`
    };

    const key = `${log.entity_type}:${log.action}`;
    return descriptions[key] || `${capitalizeFirst(log.action)} ${log.entity_type.replace('_', ' ')} ${entityName}`;
}

function renderActivityChanges(changesSummary) {
    if (!changesSummary || Object.keys(changesSummary).length === 0) return '';

    const items = Object.entries(changesSummary).map(([field, change]) => {
        const fieldLabel = formatFieldLabel(field);
        const oldVal = formatActivityValue(change.old);
        const newVal = formatActivityValue(change.new);

        return `
            <div class="activity-change-item">
                <span class="field">${fieldLabel}:</span>
                <span class="old-value">${oldVal}</span>
                <span class="arrow">→</span>
                <span class="new-value">${newVal}</span>
            </div>
        `;
    }).join('');

    return `<div class="activity-changes">${items}</div>`;
}

function formatFieldLabel(field) {
    const labels = {
        name: 'Name',
        description: 'Description',
        industry: 'Industry',
        is_active: 'Status',
        role: 'Role',
        frequency: 'Frequency',
        email: 'Email',
        first_name: 'First Name',
        last_name: 'Last Name'
    };
    return labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatActivityValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Active' : 'Inactive';
    if (Array.isArray(value)) return value.join(', ') || '-';
    return escapeHtml(String(value));
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ===== AI Settings =====
async function loadAISettings() {
    if (!currentOrganization || aiSettingsLoaded) return;

    try {
        // Set form values from organization data
        const autoExecuteToggle = document.getElementById('ai-auto-execute-toggle');
        const confidenceSlider = document.getElementById('ai-confidence-slider');
        const confidenceValue = document.getElementById('confidence-value');
        const dailyLimitInput = document.getElementById('ai-daily-limit');

        if (autoExecuteToggle) {
            autoExecuteToggle.checked = currentOrganization.ai_auto_execute_enabled || false;
        }

        if (confidenceSlider && confidenceValue) {
            const threshold = Math.round((currentOrganization.ai_confidence_threshold || 0.8) * 100);
            confidenceSlider.value = threshold;
            confidenceValue.textContent = `${threshold}%`;
        }

        if (dailyLimitInput) {
            dailyLimitInput.value = currentOrganization.ai_daily_action_limit || 20;
        }

        // Load allowed action types from metadata if stored
        const allowedActions = currentOrganization.ai_allowed_actions || ['announcements', 'messages', 'promotions', 'automations'];
        document.getElementById('ai-allow-announcements').checked = allowedActions.includes('announcements');
        document.getElementById('ai-allow-messages').checked = allowedActions.includes('messages');
        document.getElementById('ai-allow-promotions').checked = allowedActions.includes('promotions');
        document.getElementById('ai-allow-points').checked = allowedActions.includes('points');
        document.getElementById('ai-allow-automations').checked = allowedActions.includes('automations');

        // Load usage stats
        await loadAIUsageStats();

        aiSettingsLoaded = true;
    } catch (err) {
        console.error('Error loading AI settings:', err);
    }
}

async function loadAIUsageStats() {
    if (!currentOrganization) return;

    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Get actions executed today
        const { count: executedCount } = await supabase
            .from('ai_action_queue')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id)
            .in('status', ['executed', 'executing'])
            .gte('executed_at', todayStart.toISOString());

        // Get pending actions
        const { count: pendingCount } = await supabase
            .from('ai_action_queue')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id)
            .eq('status', 'pending');

        const dailyLimit = currentOrganization.ai_daily_action_limit || 20;
        const used = executedCount || 0;
        const remaining = Math.max(0, dailyLimit - used);

        document.getElementById('ai-actions-today').textContent = used;
        document.getElementById('ai-pending-count').textContent = pendingCount || 0;
        document.getElementById('ai-remaining').textContent = remaining;
    } catch (err) {
        console.error('Error loading AI usage stats:', err);
        // Set defaults on error
        document.getElementById('ai-actions-today').textContent = '0';
        document.getElementById('ai-pending-count').textContent = '0';
        document.getElementById('ai-remaining').textContent = currentOrganization?.ai_daily_action_limit || 20;
    }
}

async function handleSaveAISettings() {
    const btn = document.getElementById('save-ai-settings-btn');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span>Saving...</span>';

    try {
        const autoExecute = document.getElementById('ai-auto-execute-toggle').checked;
        const confidenceThreshold = parseInt(document.getElementById('ai-confidence-slider').value) / 100;
        const dailyLimit = parseInt(document.getElementById('ai-daily-limit').value) || 20;

        // Collect allowed action types
        const allowedActions = [];
        if (document.getElementById('ai-allow-announcements').checked) allowedActions.push('announcements');
        if (document.getElementById('ai-allow-messages').checked) allowedActions.push('messages');
        if (document.getElementById('ai-allow-promotions').checked) allowedActions.push('promotions');
        if (document.getElementById('ai-allow-points').checked) allowedActions.push('points');
        if (document.getElementById('ai-allow-automations').checked) allowedActions.push('automations');

        // Validate
        if (dailyLimit < 1 || dailyLimit > 100) {
            showToast(window.t ? window.t('toasts.dailyLimitInvalid') : 'Daily limit must be between 1 and 100', 'error');
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }

        const { error } = await supabase
            .from('organizations')
            .update({
                ai_auto_execute_enabled: autoExecute,
                ai_confidence_threshold: confidenceThreshold,
                ai_daily_action_limit: dailyLimit,
                ai_allowed_actions: allowedActions
            })
            .eq('id', currentOrganization.id);

        if (error) throw error;

        // Update local state
        currentOrganization.ai_auto_execute_enabled = autoExecute;
        currentOrganization.ai_confidence_threshold = confidenceThreshold;
        currentOrganization.ai_daily_action_limit = dailyLimit;
        currentOrganization.ai_allowed_actions = allowedActions;

        showToast(window.t ? window.t('toasts.aiSettingsSaved') : 'AI settings saved!', 'success');
        celebrate();
    } catch (err) {
        console.error('Error saving AI settings:', err);
        showToast(window.t ? window.t('toasts.aiSettingsFailed') : 'Failed to save AI settings', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function handleConfidenceSliderChange(e) {
    const value = e.target.value;
    document.getElementById('confidence-value').textContent = `${value}%`;
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });

    // Profile form
    document.getElementById('profile-form').addEventListener('submit', handleProfileSave);

    // Avatar upload
    document.getElementById('avatar-input').addEventListener('change', handleAvatarUpload);
    document.getElementById('remove-avatar-btn').addEventListener('click', handleAvatarRemove);

    // Advanced mode toggle
    const advancedModeToggle = document.getElementById('advanced-mode-toggle');
    if (advancedModeToggle) {
        advancedModeToggle.addEventListener('change', handleAdvancedModeToggle);
    }

    // Password form
    document.getElementById('password-form').addEventListener('submit', handlePasswordChange);

    // Password strength indicator
    document.getElementById('new-password').addEventListener('input', updatePasswordStrength);

    // Invite form
    document.getElementById('invite-form').addEventListener('submit', handleInvite);

    // Team member actions (event delegation)
    document.getElementById('team-members-list').addEventListener('change', (e) => {
        if (e.target.classList.contains('role-select')) {
            handleRoleChange(e.target.dataset.memberId, e.target.value);
        }
    });

    document.getElementById('team-members-list').addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-member-btn');
        if (removeBtn) {
            handleRemoveMember(removeBtn.dataset.memberId);
        }
    });

    // Invitation actions
    document.getElementById('pending-invitations-list')?.addEventListener('click', (e) => {
        const cancelBtn = e.target.closest('.cancel-invite-btn');
        if (cancelBtn) {
            handleCancelInvitation(cancelBtn.dataset.invitationId);
        }
    });

    // Delete account
    document.getElementById('delete-account-btn')?.addEventListener('click', handleDeleteAccount);

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', signOut);

    // Activity log filters
    document.getElementById('activity-entity-filter')?.addEventListener('change', () => loadActivityLogs(true));
    document.getElementById('activity-date-filter')?.addEventListener('change', () => loadActivityLogs(true));

    // Activity load more
    document.getElementById('activity-load-more')?.addEventListener('click', () => {
        activityPage++;
        loadActivityLogs(false);
    });

    // Stripe checkout buttons
    document.querySelectorAll('.checkout-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleCheckout(btn.dataset.plan);
        });
    });

    // Billing toggle (monthly/annual)
    document.getElementById('billing-toggle')?.addEventListener('change', (e) => {
        const isAnnual = e.target.checked;
        document.querySelectorAll('.price-amount').forEach(el => {
            const price = isAnnual ? el.dataset.annual : el.dataset.monthly;
            el.textContent = `$${price}`;
        });
    });

    // Manage billing button
    document.getElementById('manage-billing-btn')?.addEventListener('click', handleManageBilling);

    // Cancel subscription button
    document.getElementById('cancel-subscription-btn')?.addEventListener('click', cancelSubscription);

    // Reactivate subscription button
    document.getElementById('reactivate-btn')?.addEventListener('click', reactivateSubscription);

    // Update payment button (in warning banner)
    document.getElementById('update-payment-btn')?.addEventListener('click', handleManageBilling);

    // Bundle purchase buttons
    document.querySelectorAll('.bundle-buy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleBundlePurchase(btn.dataset.bundle);
        });
    });

    // Checkout modal close button
    document.getElementById('checkout-close-btn')?.addEventListener('click', closeCheckoutModal);

    // Close modal on overlay click
    document.getElementById('checkout-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'checkout-modal') {
            closeCheckoutModal();
        }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('checkout-modal')?.style.display === 'flex') {
            closeCheckoutModal();
        }
    });

    // Promo code handling
    const promoInput = document.getElementById('checkout-promo-code');
    const applyPromoBtn = document.getElementById('apply-promo-btn');
    const promoStatus = document.getElementById('promo-status');

    if (promoInput && applyPromoBtn) {
        // Apply promo code on button click
        applyPromoBtn.addEventListener('click', () => validatePromoCode());

        // Apply promo code on Enter key
        promoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                validatePromoCode();
            }
        });

        // Clear status on input change
        promoInput.addEventListener('input', () => {
            promoInput.classList.remove('valid', 'invalid');
            promoStatus.textContent = '';
            promoStatus.className = 'promo-status';
            appliedPromoCode = null;
        });
    }

    // AI Settings
    document.getElementById('save-ai-settings-btn')?.addEventListener('click', handleSaveAISettings);
    document.getElementById('ai-confidence-slider')?.addEventListener('input', handleConfidenceSliderChange);

    // Check for successful checkout return
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
        showToast(window.t ? window.t('toasts.subscriptionActivated') : 'Subscription activated! Welcome to your new plan.', 'success');
        celebrate();
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('canceled') === 'true') {
        showToast(window.t ? window.t('toasts.checkoutCanceled') : 'Checkout canceled. No charges were made.', 'info');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

function setupUserMenu() {
    // User menu is now handled by sidebar.js
}

function switchTab(tabName) {
    // Update nav
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });

    const activeTab = document.getElementById(`${tabName}-tab`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.display = 'block';
    }

    // Load activity logs when switching to activity tab
    if (tabName === 'activity' && !activityLoaded) {
        loadActivityLogs(true);
    }

    // Load AI settings when switching to AI tab
    if (tabName === 'ai' && !aiSettingsLoaded) {
        loadAISettings();
    }
}

// ===== Handlers =====
async function handleProfileSave(e) {
    e.preventDefault();

    const btn = document.getElementById('save-profile-btn');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span>Saving...</span>';

    const updates = {
        first_name: document.getElementById('first-name').value.trim(),
        last_name: document.getElementById('last-name').value.trim(),
        phone: document.getElementById('phone').value.trim()
    };

    try {
        const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', currentUser.id);

        if (error) throw error;

        currentProfile = { ...currentProfile, ...updates };
        updateHeaderUserInfo();
        updateAvatarDisplay();

        showToast(window.t ? window.t('toasts.profileSaved') : 'Profile saved!', 'success');
        celebrate();
    } catch (err) {
        console.error('Error saving profile:', err);
        showToast(window.t ? window.t('toasts.profileSaveFailed') : 'Failed to save profile', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 2 * 1024 * 1024; // 2MB

    if (!allowedTypes.includes(file.type)) {
        showToast(window.t ? window.t('toasts.invalidImage') : 'Please upload a valid image (JPG, PNG, GIF, or WebP)', 'error');
        return;
    }

    if (file.size > maxSize) {
        showToast(window.t ? window.t('toasts.imageTooLarge') : 'Image must be smaller than 2MB', 'error');
        return;
    }

    try {
        // Delete old avatar if exists
        if (currentProfile.avatar_url) {
            await deleteOldAvatar();
        }

        // Upload new avatar
        const filePath = `${currentUser.id}/${Date.now()}-avatar`;
        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath);

        // Update profile
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ avatar_url: urlData.publicUrl })
            .eq('id', currentUser.id);

        if (updateError) throw updateError;

        currentProfile.avatar_url = urlData.publicUrl;
        updateAvatarDisplay();
        updateHeaderUserInfo();

        showToast(window.t ? window.t('toasts.photoUploaded') : 'Photo uploaded!', 'success');
        celebrate();
    } catch (err) {
        console.error('Error uploading avatar:', err);
        showToast(window.t ? window.t('toasts.photoUploadFailed') : 'Failed to upload photo. Make sure the avatars bucket exists.', 'error');
    }

    // Reset input
    e.target.value = '';
}

async function deleteOldAvatar() {
    if (!currentProfile.avatar_url) return;

    try {
        const urlParts = currentProfile.avatar_url.split('/avatars/');
        if (urlParts.length > 1) {
            await supabase.storage.from('avatars').remove([urlParts[1]]);
        }
    } catch (err) {
        console.log('Could not delete old avatar:', err);
    }
}

async function handleAvatarRemove() {
    try {
        await deleteOldAvatar();

        const { error } = await supabase
            .from('profiles')
            .update({ avatar_url: null })
            .eq('id', currentUser.id);

        if (error) throw error;

        currentProfile.avatar_url = null;
        updateAvatarDisplay();
        updateHeaderUserInfo();

        showToast(window.t ? window.t('toasts.photoRemoved') : 'Photo removed', 'success');
    } catch (err) {
        console.error('Error removing avatar:', err);
        showToast(window.t ? window.t('toasts.photoRemoveFailed') : 'Failed to remove photo', 'error');
    }
}

async function handlePasswordChange(e) {
    e.preventDefault();

    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        showToast(window.t ? window.t('toasts.passwordMismatch') : 'Passwords do not match', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showToast(window.t ? window.t('toasts.passwordTooShort') : 'Password must be at least 6 characters', 'error');
        return;
    }

    const btn = document.getElementById('update-password-btn');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span>Updating...</span>';

    try {
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        document.getElementById('password-form').reset();
        document.getElementById('password-strength').style.display = 'none';

        showToast(window.t ? window.t('toasts.passwordUpdated') : 'Password updated successfully!', 'success');
        celebrate();
    } catch (err) {
        console.error('Error updating password:', err);
        showToast(err.message || 'Failed to update password', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function updatePasswordStrength() {
    const password = document.getElementById('new-password').value;
    const strengthDiv = document.getElementById('password-strength');
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');

    if (!password) {
        strengthDiv.style.display = 'none';
        return;
    }

    strengthDiv.style.display = 'flex';

    let strength = 'weak';
    if (password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password)) {
        strength = 'strong';
    } else if (password.length >= 6 && (/[A-Z]/.test(password) || /[0-9]/.test(password))) {
        strength = 'medium';
    }

    fill.className = 'strength-fill ' + strength;
    text.className = 'strength-text ' + strength;
    text.textContent = strength.charAt(0).toUpperCase() + strength.slice(1);
}

async function handleInvite(e) {
    e.preventDefault();

    const email = document.getElementById('invite-email').value.trim().toLowerCase();
    const role = document.getElementById('invite-role').value;

    if (!email) return;

    // Check team member limit
    const totalMembers = teamMembers.length + pendingInvitations.length;
    if (orgLimits.team_members !== -1 && totalMembers >= orgLimits.team_members) {
        showToast(window.t ? window.t('toasts.teamLimitReached') : 'You\'ve reached your team member limit. Upgrade to invite more.', 'error');
        return;
    }

    try {
        const { error } = await supabase
            .from('organization_invitations')
            .insert({
                organization_id: currentOrganization.id,
                email: email,
                role: role,
                invited_by: currentUser.id
            });

        if (error) {
            if (error.code === '23505') {
                showToast(window.t ? window.t('toasts.emailAlreadyInvited') : 'This email has already been invited', 'error');
            } else {
                throw error;
            }
            return;
        }

        // Log the invite
        AuditLog.logTeamInvite(currentOrganization.id, email, role);

        document.getElementById('invite-form').reset();
        await loadPendingInvitations();
        renderTeam();

        showToast(`Invitation sent to ${email}`, 'success');
        celebrate();
    } catch (err) {
        console.error('Error sending invitation:', err);
        showToast(window.t ? window.t('toasts.inviteFailed') : 'Failed to send invitation', 'error');
    }
}

async function handleRoleChange(memberId, newRole) {
    // Find member for logging
    const member = teamMembers.find(m => m.id === memberId);
    const oldRole = member?.role;
    const memberName = member ? [member.profiles?.first_name, member.profiles?.last_name].filter(Boolean).join(' ') || member.profiles?.email : 'Unknown';

    try {
        const { error } = await supabase
            .from('organization_members')
            .update({ role: newRole })
            .eq('id', memberId);

        if (error) throw error;

        // Log the role change
        AuditLog.logTeamRoleChange(currentOrganization.id, memberId, memberName, oldRole, newRole);

        await loadTeamMembers();
        renderTeam();

        showToast(window.t ? window.t('toasts.roleUpdated') : 'Role updated', 'success');
    } catch (err) {
        console.error('Error updating role:', err);
        showToast(window.t ? window.t('toasts.roleUpdateFailed') : 'Failed to update role', 'error');
    }
}

async function handleRemoveMember(memberId) {
    const member = teamMembers.find(m => m.id === memberId);
    if (!member) return;

    const name = [member.profiles?.first_name, member.profiles?.last_name].filter(Boolean).join(' ') || member.profiles?.email || 'this member';
    const memberData = {
        name,
        email: member.profiles?.email,
        role: member.role
    };

    DangerModal.show({
        title: 'Remove Team Member',
        itemName: name,
        warningText: 'This will remove the user from your organization. They will lose access to all projects and data.',
        confirmPhrase: 'REMOVE MEMBER',
        confirmButtonText: 'Remove',
        onConfirm: async () => {
            try {
                // Log before deletion
                await AuditLog.logTeamRemove(currentOrganization.id, memberId, memberData);

                const { error } = await supabase
                    .from('organization_members')
                    .delete()
                    .eq('id', memberId);

                if (error) throw error;

                await loadTeamMembers();
                renderTeam();

                showToast(window.t ? window.t('toasts.memberRemoved') : 'Member removed', 'success');
            } catch (err) {
                console.error('Error removing member:', err);
                showToast(window.t ? window.t('toasts.memberRemoveFailed') : 'Failed to remove member', 'error');
            }
        }
    });
}

async function handleCancelInvitation(invitationId) {
    // Find invitation for logging
    const invitation = pendingInvitations.find(i => i.id === invitationId);
    const email = invitation?.email || 'Unknown';

    try {
        const { error } = await supabase
            .from('organization_invitations')
            .update({ status: 'cancelled' })
            .eq('id', invitationId);

        if (error) throw error;

        // Log the cancellation
        AuditLog.logTeamInviteCancel(currentOrganization.id, email);

        await loadPendingInvitations();
        renderTeam();

        showToast(window.t ? window.t('toasts.inviteCanceled') : 'Invitation cancelled', 'success');
    } catch (err) {
        console.error('Error cancelling invitation:', err);
        showToast(window.t ? window.t('toasts.inviteCancelFailed') : 'Failed to cancel invitation', 'error');
    }
}

function handleDeleteAccount() {
    DangerModal.show({
        title: 'Delete Account',
        itemName: currentProfile?.email || currentUser.email,
        warningText: 'This will permanently delete your account, all your data, projects, automations, and customer records. If you are the only owner of an organization, it will also be deleted. This action cannot be undone.',
        confirmPhrase: 'DELETE MY ACCOUNT',
        confirmButtonText: 'Delete Account Forever',
        onConfirm: async () => {
            try {
                // Actually delete all user data via RPC (GDPR compliance)
                const { data, error } = await supabase.rpc('delete_my_account');

                if (error) {
                    console.error('Account deletion error:', error);
                    throw new Error(error.message || 'Failed to delete account data');
                }

                if (data && data.length > 0 && !data[0].success) {
                    throw new Error(data[0].message || 'Failed to delete account');
                }

                // Log deletion counts for debugging
                if (data && data.length > 0) {
                    console.log('Account deleted:', data[0].deleted_counts);
                }

                // Sign out and redirect
                await supabase.auth.signOut();
                window.location.href = '/?account_deleted=true';
            } catch (err) {
                console.error('Error deleting account:', err);
                showToast(window.t ? window.t('toasts.deleteAccountFailed') : 'Failed to delete account. Please contact support.', 'error');
            }
        }
    });
}

// ===== Advanced Mode Toggle =====
function handleAdvancedModeToggle(e) {
    const isAdvanced = e.target.checked;
    localStorage.setItem('advancedMode', isAdvanced.toString());

    // Re-initialize sidebar to reflect the change
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
            isAdmin: currentProfile?.is_admin === true,
            advancedMode: isAdvanced
        });
    }

    const advMsg = isAdvanced
        ? (window.t ? window.t('toasts.advancedModeEnabled') : 'Advanced mode enabled')
        : (window.t ? window.t('toasts.simplifiedViewEnabled') : 'Simplified view enabled');
    showToast(advMsg, 'success');
}

// ===== Utilities =====
function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function celebrate() {
    if (typeof confetti !== 'undefined') {
        confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 }
        });
    }
}

function escapeHtml(text) {
    // Use AppUtils if available (preferred), otherwise fallback to DOM method
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
        return AppUtils.escapeHtml(text);
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', initSettings);
