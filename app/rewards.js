// ===== Rewards Management Page =====
let currentUser = null;
let currentOrganization = null;
let currentApp = null;
let allRewards = [];
let allSuggestions = [];
let currentFilter = 'all';
let editingRewardId = null;
let approvingSuggestionId = null;

async function initRewards() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    // Load the organization's app
    await loadApp();

    if (!currentApp) {
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('rewards-grid').style.display = 'none';
        return;
    }

    await Promise.all([loadRewards(), loadSuggestions()]);
    setupEventListeners();

    // Onboarding: auto-switch to Suggestions tab and show banner
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarding') === 'true') {
        document.querySelector('[data-filter="suggestions"]')?.click();
        showOnboardingRewardBanner();
        history.replaceState({}, '', '/app/rewards.html');
    } else {
        // Auto-switch to Suggestions if new AI proposals exist (non-onboarding visits)
        const aiNewCount = allSuggestions.filter(s => s.source_type === 'ai_proactive' && s.status === 'new').length;
        if (aiNewCount > 0 && !sessionStorage.getItem('rewards-seen-ai')) {
            sessionStorage.setItem('rewards-seen-ai', '1');
            document.querySelector('[data-filter="suggestions"]')?.click();
        }
    }
}

async function loadApp() {
    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('id, name, slug')
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!error && data) {
            currentApp = data;
        }
    } catch (e) {
        console.error('Failed to load app:', e);
    }
}

async function loadRewards() {
    try {
        const { data, error } = await supabase
            .from('app_rewards')
            .select('*')
            .eq('app_id', currentApp.id)
            .is('deleted_at', null)
            .order('display_order', { ascending: true });

        if (error) {
            console.error('Error loading rewards:', error);
            return;
        }

        allRewards = data || [];
        updateStats();
        renderRewards();
    } catch (e) {
        console.error('Failed to load rewards:', e);
    }
}

function updateStats() {
    const active = allRewards.filter(r => r.is_active);
    const totalRedeemed = allRewards.reduce((sum, r) => sum + (r.quantity_redeemed || 0), 0);
    const featured = allRewards.filter(r => r.featured);

    document.getElementById('stat-total').textContent = allRewards.length;
    document.getElementById('stat-active').textContent = active.length;
    document.getElementById('stat-redeemed').textContent = totalRedeemed;
    document.getElementById('stat-featured').textContent = featured.length;
}

function renderRewards() {
    const grid = document.getElementById('rewards-grid');
    const emptyState = document.getElementById('empty-state');

    // Suggestions tab — delegate to renderSuggestions
    if (currentFilter === 'suggestions') {
        emptyState.style.display = 'none';
        grid.style.display = 'grid';
        renderSuggestions(grid);
        return;
    }

    let filtered = allRewards;
    if (currentFilter === 'active') filtered = allRewards.filter(r => r.is_active);
    else if (currentFilter === 'inactive') filtered = allRewards.filter(r => !r.is_active);
    else if (currentFilter === 'featured') filtered = allRewards.filter(r => r.featured);

    if (allRewards.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    grid.style.display = 'grid';

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-muted);">No rewards match this filter.</div>';
        return;
    }

    grid.innerHTML = filtered.map(reward => {
        const stockLabel = getStockLabel(reward);
        const badges = [];
        if (reward.is_active) badges.push('<span class="badge badge-active">Active</span>');
        else badges.push('<span class="badge badge-inactive">Inactive</span>');
        if (reward.featured) badges.push('<span class="badge badge-featured">Featured</span>');

        return `
            <div class="reward-card ${reward.is_active ? '' : 'inactive'}" onclick="openRewardModal('${reward.id}')">
                <div class="reward-card-actions" onclick="event.stopPropagation();">
                    <button class="card-action-btn" onclick="toggleRewardActive('${reward.id}')" title="${reward.is_active ? 'Deactivate' : 'Activate'}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${reward.is_active
                                ? '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'
                                : '<polygon points="5 3 19 12 5 21 5 3"/>'}
                        </svg>
                    </button>
                    <button class="card-action-btn delete" onclick="deleteReward('${reward.id}')" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
                <div class="reward-card-header">
                    <div class="reward-card-image">
                        ${reward.image_url ? `<img src="${escapeHtml(reward.image_url)}" alt="">` : '&#127873;'}
                    </div>
                    <div class="reward-card-badge">${badges.join('')}</div>
                </div>
                <div class="reward-card-name">${escapeHtml(reward.name)}</div>
                <div class="reward-card-description">${escapeHtml(reward.description || 'No description')}</div>
                <div class="reward-card-meta">
                    <div class="reward-card-points">
                        ${reward.points_cost.toLocaleString()} <span>pts</span>
                    </div>
                    <div class="reward-card-stock ${stockLabel.class}">${stockLabel.text}</div>
                </div>
            </div>
        `;
    }).join('');
}

function getStockLabel(reward) {
    if (reward.quantity_available === null || reward.quantity_available === undefined) {
        return { text: 'Unlimited', class: '' };
    }
    const remaining = reward.quantity_available - (reward.quantity_redeemed || 0);
    if (remaining <= 0) return { text: 'Out of stock', class: 'out' };
    if (remaining <= 5) return { text: `${remaining} left`, class: 'low' };
    return { text: `${remaining} left`, class: '' };
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Modal =====

function openRewardModal(rewardId) {
    const modal = document.getElementById('reward-modal');
    const form = document.getElementById('reward-form');
    form.reset();

    if (rewardId) {
        const reward = allRewards.find(r => r.id === rewardId);
        if (!reward) return;

        editingRewardId = rewardId;
        document.getElementById('modal-title').textContent = 'Edit Reward';
        document.getElementById('save-reward-btn').textContent = 'Save Changes';
        document.getElementById('reward-id').value = reward.id;
        document.getElementById('reward-name').value = reward.name;
        document.getElementById('reward-description').value = reward.description || '';
        document.getElementById('reward-points').value = reward.points_cost;
        document.getElementById('reward-value').value = reward.retail_value || '';
        document.getElementById('reward-quantity').value = reward.quantity_available ?? '';
        document.getElementById('reward-max-per-member').value = reward.max_per_member ?? '';
        document.getElementById('reward-tier').value = reward.tier_required || '';
        document.getElementById('reward-category').value = reward.category || '';
        document.getElementById('reward-image').value = reward.image_url || '';
        document.getElementById('reward-featured').checked = reward.featured || false;
        document.getElementById('reward-active').checked = reward.is_active !== false;
    } else {
        editingRewardId = null;
        document.getElementById('modal-title').textContent = 'New Reward';
        document.getElementById('save-reward-btn').textContent = 'Create Reward';
        document.getElementById('reward-active').checked = true;
    }

    modal.classList.add('active');
}

function closeRewardModal() {
    document.getElementById('reward-modal').classList.remove('active');
    editingRewardId = null;
    approvingSuggestionId = null;
}

async function saveReward(e) {
    e.preventDefault();

    const btn = document.getElementById('save-reward-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const quantityVal = document.getElementById('reward-quantity').value;
    const maxPerVal = document.getElementById('reward-max-per-member').value;
    const retailVal = document.getElementById('reward-value').value;

    const rewardData = {
        app_id: currentApp.id,
        name: document.getElementById('reward-name').value.trim(),
        description: document.getElementById('reward-description').value.trim() || null,
        points_cost: parseInt(document.getElementById('reward-points').value),
        retail_value: retailVal ? parseFloat(retailVal) : null,
        quantity_available: quantityVal ? parseInt(quantityVal) : null,
        max_per_member: maxPerVal ? parseInt(maxPerVal) : null,
        tier_required: document.getElementById('reward-tier').value || null,
        category: document.getElementById('reward-category').value.trim() || null,
        image_url: document.getElementById('reward-image').value.trim() || null,
        featured: document.getElementById('reward-featured').checked,
        is_active: document.getElementById('reward-active').checked
    };

    try {
        if (editingRewardId) {
            const { error } = await supabase
                .from('app_rewards')
                .update(rewardData)
                .eq('id', editingRewardId);

            if (error) throw error;
            showToast('Reward updated', 'success');
        } else {
            rewardData.display_order = allRewards.length;
            const { data: newReward, error } = await supabase
                .from('app_rewards')
                .insert(rewardData)
                .select('id')
                .single();

            if (error) throw error;

            // If created from a suggestion, mark it approved
            if (approvingSuggestionId && newReward) {
                await supabase
                    .from('reward_suggestions')
                    .update({
                        status: 'approved',
                        created_reward_id: newReward.id,
                        reviewed_at: new Date().toISOString()
                    })
                    .eq('id', approvingSuggestionId);
                approvingSuggestionId = null;
                await loadSuggestions();
            }

            showToast('Reward created', 'success');
            if (typeof celebrate === 'function') celebrate();
        }

        closeRewardModal();
        await loadRewards();
    } catch (err) {
        console.error('Error saving reward:', err);
        showToast('Failed to save reward', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = editingRewardId ? 'Save Changes' : 'Create Reward';
    }
}

async function toggleRewardActive(rewardId) {
    const reward = allRewards.find(r => r.id === rewardId);
    if (!reward) return;

    try {
        const { error } = await supabase
            .from('app_rewards')
            .update({ is_active: !reward.is_active })
            .eq('id', rewardId);

        if (error) throw error;
        showToast(reward.is_active ? 'Reward deactivated' : 'Reward activated', 'success');
        await loadRewards();
    } catch (err) {
        console.error('Error toggling reward:', err);
        showToast('Failed to update reward', 'error');
    }
}

async function deleteReward(rewardId) {
    if (!confirm('Delete this reward? Members who already redeemed it won\'t be affected.')) return;

    try {
        const { error } = await supabase
            .from('app_rewards')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', rewardId);

        if (error) throw error;
        showToast('Reward deleted', 'success');
        await loadRewards();
    } catch (err) {
        console.error('Error deleting reward:', err);
        showToast('Failed to delete reward', 'error');
    }
}

function showToast(message, type = 'info') {
    if (typeof AppUtils !== 'undefined' && AppUtils.showToast) {
        AppUtils.showToast(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// ===== Suggestions =====

async function loadSuggestions() {
    try {
        const { data } = await supabase
            .from('reward_suggestions')
            .select('*, app_members(display_name, tier)')
            .eq('app_id', currentApp.id)
            .order('created_at', { ascending: false });

        allSuggestions = data || [];

        // Update badge count (new suggestions only)
        const newCount = allSuggestions.filter(s => s.status === 'new').length;
        const badge = document.getElementById('suggestion-count');
        if (newCount > 0) {
            badge.textContent = newCount;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        console.error('Failed to load suggestions:', e);
    }
}

function renderSuggestions(grid) {
    if (allSuggestions.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-muted);">No suggestions yet. Customers can suggest rewards from the app when no rewards are configured.</div>';
        return;
    }

    grid.innerHTML = allSuggestions.map(s => {
        const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const isAiProposal = s.source_type === 'ai_proactive';
        const memberName = s.app_members?.display_name || 'Anonymous';
        const memberTier = s.app_members?.tier ? ` (${s.app_members.tier})` : '';
        const statusBadge = `<span class="badge badge-${s.status}">${s.status.charAt(0).toUpperCase() + s.status.slice(1)}</span>`;

        const actions = s.status === 'new' || s.status === 'reviewed' ? `
            <div class="suggestion-actions">
                <button class="btn btn-secondary btn-sm" onclick="dismissSuggestion('${s.id}')">Dismiss</button>
                <button class="btn btn-primary btn-sm" onclick="approveSuggestion('${s.id}')">Create Reward</button>
            </div>
        ` : s.status === 'approved' ? `
            <div class="suggestion-actions">
                <span style="font-size: 12px; color: #10b981;">Reward created</span>
            </div>
        ` : `
            <div class="suggestion-actions">
                <span style="font-size: 12px; color: var(--color-text-muted);">Dismissed</span>
            </div>
        `;

        // AI-proactive proposals show reasoning directly (no "Analyzing..." state)
        // Customer suggestions show AI analysis if available, or "Analyzing..." if new
        const aiSection = isAiProposal ? `
            <div class="ai-proposal ai-proactive-proposal">
                <div class="ai-proposal-detail"><strong>${escapeHtml(s.ai_proposal?.reward_name || s.reward_name)}</strong> — ${(s.ai_proposal?.points_cost || s.suggested_points)?.toLocaleString()} pts</div>
                <div class="ai-proposal-reasoning">${escapeHtml(s.ai_proposal?.reasoning || '')}</div>
            </div>
        ` : s.ai_proposal ? `
            <div class="ai-proposal">
                <div class="ai-proposal-header">Royal AI recommends</div>
                <div class="ai-proposal-detail"><strong>${escapeHtml(s.ai_proposal.reward_name)}</strong> — ${s.ai_proposal.points_cost?.toLocaleString()} pts</div>
                <div class="ai-proposal-reasoning">${escapeHtml(s.ai_proposal.reasoning || '')}</div>
            </div>
        ` : s.status === 'new' ? `
            <div class="ai-proposal analyzing">Analyzing suggestion...</div>
        ` : '';

        // Header differs: AI proposals vs customer suggestions
        const sourceHeader = isAiProposal
            ? `<div class="suggestion-member suggestion-ai-source"><span class="ai-source-icon">&#x1F9E0;</span> Royal AI suggests</div>`
            : `<div class="suggestion-member">Suggested by ${escapeHtml(memberName)}${memberTier}${s.suggested_points ? ` &middot; ${s.suggested_points} pts suggested` : ''}</div>`;

        return `
            <div class="reward-card suggestion-card${isAiProposal ? ' ai-proactive-card' : ''}">
                <div class="suggestion-meta">
                    ${statusBadge}
                    <span class="suggestion-date">${date}</span>
                </div>
                <div class="reward-card-name">"${escapeHtml(s.reward_name)}"</div>
                <div class="reward-card-description">${escapeHtml(s.description || 'No description provided')}</div>
                <div class="suggestion-app-name">For: ${escapeHtml(currentApp?.name || 'Your App')}</div>
                ${sourceHeader}
                ${aiSection}
                ${actions}
            </div>
        `;
    }).join('');
}

function approveSuggestion(suggestionId) {
    const suggestion = allSuggestions.find(s => s.id === suggestionId);
    if (!suggestion) return;

    // Open the reward create modal pre-filled with AI proposal (or raw suggestion)
    approvingSuggestionId = suggestionId;
    openRewardModal();

    const proposal = suggestion.ai_proposal;
    document.getElementById('reward-name').value = proposal?.reward_name || suggestion.reward_name;
    document.getElementById('reward-description').value = proposal?.description || suggestion.description || '';
    if (proposal?.points_cost) {
        document.getElementById('reward-points').value = proposal.points_cost;
    } else if (suggestion.suggested_points) {
        document.getElementById('reward-points').value = suggestion.suggested_points;
    }
    if (proposal?.category || suggestion.category) {
        document.getElementById('reward-category').value = proposal?.category || suggestion.category;
    }
    document.getElementById('modal-title').textContent = proposal
        ? 'Create Reward (AI Recommended)'
        : 'Create Reward from Suggestion';
}

async function dismissSuggestion(suggestionId) {
    if (!confirm('Dismiss this suggestion?')) return;

    try {
        const { error } = await supabase
            .from('reward_suggestions')
            .update({ status: 'dismissed', reviewed_at: new Date().toISOString() })
            .eq('id', suggestionId);

        if (error) throw error;
        showToast('Suggestion dismissed', 'success');
        await loadSuggestions();
        renderRewards();
    } catch (err) {
        console.error('Error dismissing suggestion:', err);
        showToast('Failed to dismiss suggestion', 'error');
    }
}

// ===== AI Generate Rewards =====

const INDUSTRY_REWARD_PROPOSALS = {
    food: [
        { reward_name: 'Free Appetizer', description: 'Complimentary starter with any entree', points_cost: 100, category: 'food', reasoning: 'Appetizers have high margins and encourage larger orders' },
        { reward_name: '20% Off Next Visit', description: 'Discount on your next meal', points_cost: 150, category: 'discount', reasoning: 'Percentage discounts drive repeat visits within 7 days' },
        { reward_name: 'Free Dessert', description: 'Any dessert on the house', points_cost: 75, category: 'food', reasoning: 'Low-cost reward that creates a memorable dining experience' }
    ],
    retail: [
        { reward_name: '15% Off Purchase', description: 'Discount on any single item', points_cost: 120, category: 'discount', reasoning: 'Percentage discounts are retail gold — customers spend 20% more to earn the discount' },
        { reward_name: 'Free Gift Wrapping', description: 'Complimentary gift wrap service', points_cost: 50, category: 'experience', reasoning: 'Zero-cost perk that increases perceived value' },
        { reward_name: 'Early Access Sale', description: 'Shop sales 24 hours before public', points_cost: 200, category: 'experience', reasoning: 'Exclusivity drives loyalty — VIP feeling at zero cost' }
    ],
    health: [
        { reward_name: 'Free Consultation Add-on', description: 'Complimentary extra service during visit', points_cost: 150, category: 'experience', reasoning: 'Upsells naturally when customers experience premium service' },
        { reward_name: '15% Off Next Visit', description: 'Discount on your next appointment', points_cost: 120, category: 'discount', reasoning: 'Rebooking discounts reduce churn by 25%' },
        { reward_name: 'Priority Booking', description: 'Book preferred time slots before others', points_cost: 100, category: 'experience', reasoning: 'Scheduling priority costs nothing but feels premium' }
    ],
    service: [
        { reward_name: '10% Off Next Service', description: 'Discount on your next booking', points_cost: 100, category: 'discount', reasoning: 'Universal reward that drives return visits' },
        { reward_name: 'Priority Scheduling', description: 'Get preferred time slots', points_cost: 120, category: 'experience', reasoning: 'Costs nothing to offer but creates VIP feeling' },
        { reward_name: 'Free Upgrade', description: 'Complimentary upgrade on your next service', points_cost: 150, category: 'experience', reasoning: 'Upgrades showcase premium offerings and drive future upsells' }
    ]
};

async function generateAiRewards() {
    const btn = document.getElementById('ai-generate-rewards-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating...';
    }

    try {
        // Try to determine industry from project
        let industry = 'service';
        const { data: project } = await supabase
            .from('projects')
            .select('industry')
            .eq('organization_id', currentOrganization.id)
            .limit(1)
            .single();
        if (project?.industry) industry = project.industry;

        const proposals = INDUSTRY_REWARD_PROPOSALS[industry] || INDUSTRY_REWARD_PROPOSALS.service;

        for (const r of proposals) {
            await supabase
                .from('reward_suggestions')
                .insert({
                    app_id: currentApp.id,
                    organization_id: currentOrganization.id,
                    member_id: null,
                    reward_name: r.reward_name,
                    description: r.description,
                    suggested_points: r.points_cost,
                    category: r.category,
                    source_type: 'ai_proactive',
                    ai_proposal: {
                        reward_name: r.reward_name,
                        description: r.description,
                        points_cost: r.points_cost,
                        category: r.category,
                        reasoning: r.reasoning
                    },
                    status: 'new'
                });
        }

        showToast('AI rewards generated! Review them in the Suggestions tab.', 'success');
        await loadSuggestions();
        // Switch to suggestions tab
        document.querySelector('[data-filter="suggestions"]')?.click();
    } catch (err) {
        console.error('Error generating AI rewards:', err);
        showToast('Failed to generate rewards', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
                    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                    <path d="M12 5v13"/>
                </svg>
                Generate AI Rewards`;
        }
    }
}

// ===== Onboarding Reward Banner =====
function showOnboardingRewardBanner() {
    const grid = document.getElementById('rewards-grid');
    if (!grid) return;

    const banner = document.createElement('div');
    banner.className = 'onboarding-reward-banner';
    banner.innerHTML = `
        <div class="onboarding-reward-banner-icon">&#x1F381;</div>
        <div class="onboarding-reward-banner-content">
            <div class="onboarding-reward-banner-title">Review your reward suggestions</div>
            <div class="onboarding-reward-banner-text">Royal AI has proposed rewards based on your industry. Approve the ones you like, edit them, or create your own.</div>
        </div>
        <button class="onboarding-reward-banner-close" onclick="this.closest('.onboarding-reward-banner').remove()">&times;</button>
    `;
    grid.parentNode.insertBefore(banner, grid);
}

// ===== Event Listeners =====

function setupEventListeners() {
    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderRewards();
        });
    });

    // Close modal on overlay click
    document.getElementById('reward-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeRewardModal();
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeRewardModal();
    });
}

document.addEventListener('DOMContentLoaded', initRewards);
