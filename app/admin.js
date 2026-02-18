// ===== Super Admin Panel =====
let currentUser = null;
let organizations = [];
let allOrganizations = []; // unfiltered
let users = [];
let allUsers = []; // unfiltered
let currentTab = 'orgs';
let orgPage = 1;
let userPage = 1;
const PAGE_SIZE = 50;
let planOverrideOrgId = null;

// ===== Initialization =====
async function initAdmin() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Verify admin status (client-side guard)
    const userInfo = await AppUtils.loadUserInfo(currentUser.id, currentUser.email);
    if (!userInfo.profile?.is_admin) {
        window.location.href = '/app/dashboard.html';
        return;
    }

    // Initialize sidebar
    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: { name: 'Super Admin' },
            isAdmin: true
        });
    }

    // Load organizations
    await loadOrganizations();

    // Setup event listeners
    setupEventListeners();
}

// ===== Load Organizations =====
async function loadOrganizations() {
    const loading = document.getElementById('orgs-loading');
    const container = document.getElementById('orgs-container');
    const emptyState = document.getElementById('orgs-empty-state');

    try {
        const { data, error } = await supabase.rpc('admin_get_all_organizations');
        if (error) throw error;

        allOrganizations = data || [];
        applyOrgFilters();
        loading.style.display = 'none';

    } catch (error) {
        console.error('Error loading organizations:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading organizations. Are you an admin?</p>';
    }
}

function applyOrgFilters() {
    const search = (document.getElementById('org-search-input')?.value || '').trim().toLowerCase();
    const planFilter = document.getElementById('plan-filter')?.value || '';

    let filtered = allOrganizations;

    if (search) {
        filtered = filtered.filter(org =>
            (org.name || '').toLowerCase().includes(search) ||
            (org.owner_email || '').toLowerCase().includes(search) ||
            (org.owner_name || '').toLowerCase().includes(search)
        );
    }

    if (planFilter) {
        filtered = filtered.filter(org => org.plan_type === planFilter);
    }

    organizations = filtered;
    orgPage = 1;

    const container = document.getElementById('orgs-container');
    const emptyState = document.getElementById('orgs-empty-state');

    if (organizations.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'block';
    } else {
        container.style.display = 'block';
        emptyState.style.display = 'none';
        renderOrganizations();
        updateOrgPagination();
    }

    updateOrgStats();
}

function updateOrgStats() {
    document.getElementById('stat-total-orgs').textContent = allOrganizations.length;
    document.getElementById('stat-free-orgs').textContent = allOrganizations.filter(o => o.plan_type === 'free').length;
    document.getElementById('stat-pro-orgs').textContent = allOrganizations.filter(o =>
        o.plan_type === 'subscription' && o.subscription_tier === 'pro'
    ).length;
    document.getElementById('stat-max-orgs').textContent = allOrganizations.filter(o =>
        o.plan_type === 'subscription' && o.subscription_tier === 'max'
    ).length;
    document.getElementById('stat-appsumo-orgs').textContent = allOrganizations.filter(o =>
        o.plan_type === 'appsumo_lifetime'
    ).length;
}

function renderOrganizations() {
    const tbody = document.getElementById('orgs-table-body');
    const start = (orgPage - 1) * PAGE_SIZE;
    const pageOrgs = organizations.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageOrgs.map(org => {
        const initial = (org.name || '?').charAt(0).toUpperCase();
        const planBadge = getPlanBadge(org);
        const createdDate = formatRelativeDate(org.created_at);
        const lastActive = org.last_activity ? formatRelativeDate(org.last_activity) : 'Never';
        const hasOverride = org.plan_limits_override && Object.keys(org.plan_limits_override).length > 0;

        return `
            <tr data-org-id="${org.id}" onclick="openOrgDetail('${org.id}')">
                <td>
                    <div class="org-name-cell">
                        <div class="org-avatar">${initial}</div>
                        <span class="org-name-text">${escapeHtml(org.name || 'Unnamed')}</span>
                    </div>
                </td>
                <td>
                    <span class="text-muted">${escapeHtml(org.owner_email || '-')}</span>
                </td>
                <td>
                    <span class="plan-badge ${planBadge.className}${hasOverride ? ' has-override' : ''}">${planBadge.label}</span>
                </td>
                <td>${org.member_count || 0}</td>
                <td>${org.customer_count || 0}</td>
                <td><span class="text-muted">${createdDate}</span></td>
                <td><span class="text-muted">${lastActive}</span></td>
                <td>
                    <div class="row-actions" onclick="event.stopPropagation()">
                        <button class="action-btn view-as" onclick="viewAsOrg('${org.id}', '${escapeHtml(org.name)}')" title="View as this org">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="openPlanOverride('${org.id}')" title="Edit plan">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="action-btn danger" onclick="confirmDeleteOrg('${org.id}')" title="Delete org">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M3 4H13M6 4V3C6 2.44772 6.44772 2 7 2H9C9.55228 2 10 2.44772 10 3V4M12 4V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V4H12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function updateOrgPagination() {
    const pagination = document.getElementById('orgs-pagination');
    const totalPages = Math.ceil(organizations.length / PAGE_SIZE);

    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';
    document.getElementById('orgs-pagination-info').textContent = `Page ${orgPage} of ${totalPages}`;
    document.getElementById('orgs-prev-page').disabled = orgPage === 1;
    document.getElementById('orgs-next-page').disabled = orgPage === totalPages;
}

// ===== Load Users =====
async function loadUsers() {
    const loading = document.getElementById('users-loading');
    const container = document.getElementById('users-container');

    try {
        const { data, error } = await supabase.rpc('admin_get_all_users');
        if (error) throw error;

        allUsers = data || [];
        applyUserFilters();
        loading.style.display = 'none';

    } catch (error) {
        console.error('Error loading users:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading users.</p>';
    }
}

function applyUserFilters() {
    const search = (document.getElementById('user-search-input')?.value || '').trim().toLowerCase();

    let filtered = allUsers;

    if (search) {
        filtered = filtered.filter(user =>
            (user.email || '').toLowerCase().includes(search) ||
            (user.first_name || '').toLowerCase().includes(search) ||
            (user.last_name || '').toLowerCase().includes(search)
        );
    }

    users = filtered;
    userPage = 1;

    const container = document.getElementById('users-container');
    if (users.length === 0) {
        container.style.display = 'none';
    } else {
        container.style.display = 'block';
        renderUsers();
        updateUserPagination();
    }

    updateUserStats();
}

function updateUserStats() {
    document.getElementById('stat-total-users').textContent = allUsers.length;
    document.getElementById('stat-admin-users').textContent = allUsers.filter(u => u.is_admin).length;
}

function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    const start = (userPage - 1) * PAGE_SIZE;
    const pageUsers = users.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageUsers.map(user => {
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
        const initials = AppUtils.getInitials(user.first_name, user.last_name);
        const joinedDate = formatRelativeDate(user.created_at);
        const orgs = user.orgs || [];

        return `
            <tr>
                <td>
                    <div class="user-name-cell">
                        <div class="user-avatar">${initials}</div>
                        <span>${escapeHtml(name)}</span>
                    </div>
                </td>
                <td><span class="text-muted">${escapeHtml(user.email || '-')}</span></td>
                <td>
                    ${user.is_admin ? '<span class="role-badge admin">Admin</span>' : '<span class="role-badge member">User</span>'}
                </td>
                <td>
                    <div class="user-orgs-list">
                        ${orgs.map(org => `
                            <span class="user-org-chip">
                                ${escapeHtml(org.org_name)}
                                <span class="org-role">${org.role}</span>
                            </span>
                        `).join('')}
                        ${orgs.length === 0 ? '<span class="text-muted">None</span>' : ''}
                    </div>
                </td>
                <td><span class="text-muted">${joinedDate}</span></td>
                <td>
                    <div class="row-actions" style="opacity: 1;">
                        <button class="action-btn" onclick="resetPassword('${user.id}', '${escapeHtml(user.email)}')" title="Reset password">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                                <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                        ${orgs.length > 0 ? `
                            <button class="action-btn danger" onclick="showRemoveUserOptions('${user.id}', '${escapeHtml(name)}')" title="Remove from org">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M10 8H14M1 13c0-2.21 2.24-4 5-4s5 1.79 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                    <circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function updateUserPagination() {
    const pagination = document.getElementById('users-pagination');
    const totalPages = Math.ceil(users.length / PAGE_SIZE);

    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';
    document.getElementById('users-pagination-info').textContent = `Page ${userPage} of ${totalPages}`;
    document.getElementById('users-prev-page').disabled = userPage === 1;
    document.getElementById('users-next-page').disabled = userPage === totalPages;
}

// ===== Plan Badge Helper =====
function getPlanBadge(org) {
    if (org.plan_type === 'subscription') {
        if (org.subscription_tier === 'max') return { className: 'max', label: 'Max' };
        return { className: 'pro', label: 'Pro' };
    }
    if (org.plan_type === 'appsumo_lifetime') {
        return { className: 'appsumo', label: `AppSumo T${org.appsumo_tier || 1}` };
    }
    return { className: 'free', label: 'Free' };
}

// ===== Org Detail Modal =====
async function openOrgDetail(orgId) {
    const modal = document.getElementById('org-detail-modal');
    const body = document.getElementById('org-detail-body');
    const title = document.getElementById('org-detail-title');

    body.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div></div>';
    modal.classList.add('active');

    try {
        const { data, error } = await supabase.rpc('admin_get_organization_detail', { p_org_id: orgId });
        if (error) throw error;

        const org = data.organization;
        const members = data.members || [];
        const apps = data.customer_apps || [];
        const audit = data.recent_audit || [];
        const usage = data.usage || {};

        title.textContent = org.name || 'Organization';

        const planBadge = getPlanBadge(org);
        const hasOverride = org.plan_limits_override && Object.keys(org.plan_limits_override).length > 0;

        body.innerHTML = `
            <div class="org-detail-grid">
                <div class="org-detail-item">
                    <div class="detail-label">Plan</div>
                    <div class="detail-value">
                        <span class="plan-badge ${planBadge.className}${hasOverride ? ' has-override' : ''}">${planBadge.label}</span>
                        ${hasOverride ? '<span class="text-muted" style="margin-left: 8px;">(has overrides)</span>' : ''}
                    </div>
                </div>
                <div class="org-detail-item">
                    <div class="detail-label">Created</div>
                    <div class="detail-value">${new Date(org.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                </div>
                <div class="org-detail-item">
                    <div class="detail-label">Customers</div>
                    <div class="detail-value">${(usage.customers || 0).toLocaleString()}</div>
                </div>
                <div class="org-detail-item">
                    <div class="detail-label">Automations</div>
                    <div class="detail-value">${(usage.automations || 0).toLocaleString()}</div>
                </div>
                <div class="org-detail-item">
                    <div class="detail-label">Knowledge Facts</div>
                    <div class="detail-value">${(usage.knowledge_facts || 0).toLocaleString()}</div>
                </div>
                <div class="org-detail-item">
                    <div class="detail-label">Stripe Customer</div>
                    <div class="detail-value">${escapeHtml(org.stripe_customer_id || 'None')}</div>
                </div>
            </div>

            ${hasOverride ? `
                <div class="detail-section">
                    <div class="detail-section-title">Plan Overrides</div>
                    <pre style="font-size: 12px; background: var(--color-bg-secondary); padding: 12px; border-radius: var(--radius-md); overflow-x: auto;">${JSON.stringify(org.plan_limits_override, null, 2)}</pre>
                </div>
            ` : ''}

            <div class="detail-section">
                <div class="detail-section-title">Team Members (${members.length})</div>
                <div class="detail-members-list">
                    ${members.map(m => `
                        <div class="detail-member-row">
                            <div class="detail-member-info">
                                <span class="detail-member-name">${escapeHtml(m.first_name || '')} ${escapeHtml(m.last_name || '')}</span>
                                <span class="detail-member-email">${escapeHtml(m.email)}</span>
                            </div>
                            <span class="role-badge ${m.role}">${m.role}</span>
                        </div>
                    `).join('')}
                    ${members.length === 0 ? '<p class="text-muted">No team members</p>' : ''}
                </div>
            </div>

            ${apps.length > 0 ? `
                <div class="detail-section">
                    <div class="detail-section-title">Customer Apps (${apps.length})</div>
                    <div class="detail-members-list">
                        ${apps.map(app => `
                            <div class="detail-member-row">
                                <span class="detail-member-name">${escapeHtml(app.name)}</span>
                                <span class="text-muted">${formatRelativeDate(app.created_at)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${audit.length > 0 ? `
                <div class="detail-section">
                    <div class="detail-section-title">Recent Activity</div>
                    <div class="detail-audit-list">
                        ${audit.map(a => `
                            <div class="detail-audit-row">
                                <div>
                                    <span class="audit-action">${escapeHtml(a.action)}</span>
                                    <span class="audit-entity">${escapeHtml(a.entity_type || '')} ${escapeHtml(a.entity_name || '')}</span>
                                </div>
                                <span class="audit-time">${formatRelativeDate(a.created_at)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;

    } catch (error) {
        console.error('Error loading org detail:', error);
        body.innerHTML = '<p style="color: var(--color-error); padding: 24px;">Error loading organization details.</p>';
    }
}

// ===== Plan Override Modal =====
function openPlanOverride(orgId) {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    planOverrideOrgId = orgId;
    const modal = document.getElementById('plan-override-modal');

    // Set current plan values
    document.getElementById('override-plan-type').value = org.plan_type || 'free';
    document.getElementById('override-sub-tier').value = org.subscription_tier || '';

    // Set override values if they exist
    const overrides = org.plan_limits_override || {};
    document.getElementById('override-members').value = overrides.members ?? '';
    document.getElementById('override-emails').value = overrides.emails_monthly ?? '';
    document.getElementById('override-sms').value = overrides.sms_monthly ?? '';
    document.getElementById('override-ai-queries').value = overrides.royal_queries_monthly ?? '';
    document.getElementById('override-automations').value = overrides.max_automations ?? '';

    // Feature toggles - use override if set, otherwise use plan defaults
    const limits = typeof getOrgLimits === 'function' ? getOrgLimits(org) : {};
    document.getElementById('override-royal-chat').checked = overrides.royal_chat ?? limits.royal_chat ?? false;
    document.getElementById('override-autonomous').checked = overrides.autonomous_mode ?? limits.autonomous_mode ?? false;
    document.getElementById('override-learning').checked = overrides.business_learning ?? limits.business_learning ?? false;
    document.getElementById('override-fatigue').checked = overrides.fatigue_protection ?? limits.fatigue_protection ?? false;
    document.getElementById('override-metrics').checked = overrides.performance_metrics ?? limits.performance_metrics ?? false;
    document.getElementById('override-attribution').checked = overrides.visit_attribution ?? limits.visit_attribution ?? false;
    document.getElementById('override-whitelabel').checked = overrides.white_label ?? limits.white_label ?? false;

    // Highlight active quick-set button
    document.querySelectorAll('.plan-quickset-btn').forEach(btn => {
        btn.classList.remove('active');
        if (org.plan_type === 'free' && btn.dataset.plan === 'free') btn.classList.add('active');
        if (org.plan_type === 'subscription' && org.subscription_tier === btn.dataset.plan) btn.classList.add('active');
    });

    modal.classList.add('active');
}

async function savePlanOverride() {
    if (!planOverrideOrgId) return;

    const planType = document.getElementById('override-plan-type').value;
    const subTier = document.getElementById('override-sub-tier').value || null;

    // Build override JSONB from filled fields
    const overrides = {};
    const membersVal = document.getElementById('override-members').value;
    const emailsVal = document.getElementById('override-emails').value;
    const smsVal = document.getElementById('override-sms').value;
    const aiVal = document.getElementById('override-ai-queries').value;
    const autoVal = document.getElementById('override-automations').value;

    if (membersVal !== '') overrides.members = parseInt(membersVal);
    if (emailsVal !== '') overrides.emails_monthly = parseInt(emailsVal);
    if (smsVal !== '') overrides.sms_monthly = parseInt(smsVal);
    if (aiVal !== '') overrides.royal_queries_monthly = parseInt(aiVal);
    if (autoVal !== '') overrides.max_automations = parseInt(autoVal);

    // Feature toggles - only include if different from plan default
    overrides.royal_chat = document.getElementById('override-royal-chat').checked;
    overrides.autonomous_mode = document.getElementById('override-autonomous').checked;
    overrides.business_learning = document.getElementById('override-learning').checked;
    overrides.fatigue_protection = document.getElementById('override-fatigue').checked;
    overrides.performance_metrics = document.getElementById('override-metrics').checked;
    overrides.visit_attribution = document.getElementById('override-attribution').checked;
    overrides.white_label = document.getElementById('override-whitelabel').checked;

    const saveBtn = document.getElementById('plan-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const { data, error } = await supabase.rpc('admin_update_organization_plan', {
            p_org_id: planOverrideOrgId,
            p_plan_type: planType,
            p_subscription_tier: subTier,
            p_plan_limits_override: Object.keys(overrides).length > 0 ? overrides : null
        });

        if (error) throw error;

        // Log the action
        if (typeof AuditLog !== 'undefined') {
            const org = allOrganizations.find(o => o.id === planOverrideOrgId);
            AuditLog.log({
                organizationId: planOverrideOrgId,
                entityType: 'organization',
                entityId: planOverrideOrgId,
                entityName: org?.name || 'Unknown',
                action: 'plan_change',
                newData: { plan_type: planType, subscription_tier: subTier, overrides }
            });
        }

        closePlanOverride();
        showToast('Plan updated successfully', 'success');
        await loadOrganizations();

    } catch (error) {
        console.error('Error saving plan:', error);
        showToast('Error saving plan changes', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Plan';
    }
}

function clearPlanOverrides() {
    document.getElementById('override-members').value = '';
    document.getElementById('override-emails').value = '';
    document.getElementById('override-sms').value = '';
    document.getElementById('override-ai-queries').value = '';
    document.getElementById('override-automations').value = '';
    document.getElementById('override-royal-chat').checked = false;
    document.getElementById('override-autonomous').checked = false;
    document.getElementById('override-learning').checked = false;
    document.getElementById('override-fatigue').checked = false;
    document.getElementById('override-metrics').checked = false;
    document.getElementById('override-attribution').checked = false;
    document.getElementById('override-whitelabel').checked = false;
}

function closePlanOverride() {
    document.getElementById('plan-override-modal').classList.remove('active');
    planOverrideOrgId = null;
}

// ===== Delete Organization =====
function confirmDeleteOrg(orgId) {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    DangerModal.show({
        title: 'Delete Organization',
        itemName: org.name,
        warningText: 'This will PERMANENTLY delete this organization and ALL its data: customers, automations, messages, knowledge, apps. This CANNOT be undone.',
        confirmPhrase: `DELETE ${(org.name || '').toUpperCase()}`,
        confirmButtonText: 'Delete Forever',
        onConfirm: async () => {
            try {
                const { error } = await supabase.rpc('admin_delete_organization', { p_org_id: orgId });
                if (error) throw error;

                showToast(`"${org.name}" deleted`, 'success');
                await loadOrganizations();
            } catch (error) {
                console.error('Error deleting org:', error);
                showToast('Error deleting organization', 'error');
            }
        }
    });
}

// ===== Remove User from Org =====
function showRemoveUserOptions(userId, userName) {
    const user = allUsers.find(u => u.id === userId);
    if (!user || !user.orgs || user.orgs.length === 0) return;

    if (user.orgs.length === 1) {
        confirmRemoveUser(userId, userName, user.orgs[0].org_id, user.orgs[0].org_name);
    } else {
        const orgList = user.orgs.map((o, i) => `${i + 1}. ${o.org_name}`).join('\n');
        const choice = prompt(`${userName} belongs to multiple organizations:\n\n${orgList}\n\nEnter the number to remove from:`);
        if (!choice) return;
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < user.orgs.length) {
            confirmRemoveUser(userId, userName, user.orgs[idx].org_id, user.orgs[idx].org_name);
        }
    }
}

function confirmRemoveUser(userId, userName, orgId, orgName) {
    DangerModal.show({
        title: 'Remove User from Organization',
        itemName: `${userName} from ${orgName}`,
        warningText: 'This user will lose access to this organization and all its data.',
        confirmPhrase: 'REMOVE USER',
        confirmButtonText: 'Remove User',
        onConfirm: async () => {
            try {
                const { error } = await supabase.rpc('admin_remove_user_from_org', {
                    p_user_id: userId,
                    p_org_id: orgId
                });
                if (error) throw error;

                showToast(`Removed ${userName} from ${orgName}`, 'success');
                await loadUsers();
            } catch (error) {
                console.error('Error removing user:', error);
                showToast('Error removing user', 'error');
            }
        }
    });
}

// ===== Password Reset =====
async function resetPassword(userId, email) {
    if (!confirm(`Send a password reset email to ${email}?`)) return;

    try {
        const session = await getValidSession();
        const response = await fetch(`${supabase.supabaseUrl}/functions/v1/admin-actions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                action: 'reset_password',
                email: email
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to reset password');
        }

        showToast(`Password reset email sent to ${email}`, 'success');

    } catch (error) {
        console.error('Error resetting password:', error);
        showToast('Error sending password reset', 'error');
    }
}

// ===== Impersonation: View as Org =====
async function viewAsOrg(orgId, orgName) {
    if (!confirm(`Switch to viewing as "${orgName}"? You'll see the app from their perspective.`)) return;

    try {
        const { data, error } = await supabase.rpc('admin_start_impersonation', { p_org_id: orgId });
        if (error) throw error;

        // Store in sessionStorage for the impersonation check in utils.js
        sessionStorage.setItem('adminViewAsOrg', JSON.stringify({
            orgId: orgId,
            orgName: orgName
        }));

        // Redirect to dashboard
        window.location.href = '/app/dashboard.html';

    } catch (error) {
        console.error('Error starting impersonation:', error);
        showToast('Error switching to org view', 'error');
    }
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            switchTab(tabId);
        });
    });

    // Org search (debounced)
    let orgSearchTimeout;
    document.getElementById('org-search-input').addEventListener('input', () => {
        clearTimeout(orgSearchTimeout);
        orgSearchTimeout = setTimeout(applyOrgFilters, 300);
    });

    // Plan filter
    document.getElementById('plan-filter').addEventListener('change', applyOrgFilters);

    // Org pagination
    document.getElementById('orgs-prev-page').addEventListener('click', () => {
        if (orgPage > 1) { orgPage--; renderOrganizations(); updateOrgPagination(); }
    });
    document.getElementById('orgs-next-page').addEventListener('click', () => {
        const totalPages = Math.ceil(organizations.length / PAGE_SIZE);
        if (orgPage < totalPages) { orgPage++; renderOrganizations(); updateOrgPagination(); }
    });

    // User search (debounced)
    let userSearchTimeout;
    document.getElementById('user-search-input').addEventListener('input', () => {
        clearTimeout(userSearchTimeout);
        userSearchTimeout = setTimeout(applyUserFilters, 300);
    });

    // User pagination
    document.getElementById('users-prev-page').addEventListener('click', () => {
        if (userPage > 1) { userPage--; renderUsers(); updateUserPagination(); }
    });
    document.getElementById('users-next-page').addEventListener('click', () => {
        const totalPages = Math.ceil(users.length / PAGE_SIZE);
        if (userPage < totalPages) { userPage++; renderUsers(); updateUserPagination(); }
    });

    // Org detail modal
    document.getElementById('org-detail-close').addEventListener('click', () => {
        document.getElementById('org-detail-modal').classList.remove('active');
    });
    document.getElementById('org-detail-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            document.getElementById('org-detail-modal').classList.remove('active');
        }
    });

    // Plan override modal
    document.getElementById('plan-override-close').addEventListener('click', closePlanOverride);
    document.getElementById('plan-override-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closePlanOverride();
    });
    document.getElementById('plan-save-btn').addEventListener('click', savePlanOverride);
    document.getElementById('plan-clear-override').addEventListener('click', clearPlanOverrides);

    // Plan quick-set buttons
    document.querySelectorAll('.plan-quickset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const plan = btn.dataset.plan;
            document.querySelectorAll('.plan-quickset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (plan === 'free') {
                document.getElementById('override-plan-type').value = 'free';
                document.getElementById('override-sub-tier').value = '';
            } else {
                document.getElementById('override-plan-type').value = 'subscription';
                document.getElementById('override-sub-tier').value = plan;
            }
        });
    });

    // Escape key for modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('org-detail-modal').classList.remove('active');
            closePlanOverride();
        }
    });
}

async function switchTab(tabId) {
    currentTab = tabId;

    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.admin-tab[data-tab="${tabId}"]`).classList.add('active');

    document.getElementById('tab-orgs').style.display = tabId === 'orgs' ? 'block' : 'none';
    document.getElementById('tab-users').style.display = tabId === 'users' ? 'block' : 'none';

    // Lazy-load users on first tab switch
    if (tabId === 'users' && allUsers.length === 0) {
        await loadUsers();
    }
}

// ===== Utility Functions =====
const escapeHtml = AppUtils.escapeHtml;

function formatRelativeDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Global function references for onclick handlers
window.openOrgDetail = openOrgDetail;
window.openPlanOverride = openPlanOverride;
window.confirmDeleteOrg = confirmDeleteOrg;
window.viewAsOrg = viewAsOrg;
window.resetPassword = resetPassword;
window.showRemoveUserOptions = showRemoveUserOptions;

// Initialize on page load
document.addEventListener('DOMContentLoaded', initAdmin);
