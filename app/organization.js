/**
 * Organization Management Page
 * Displays org overview, stats, team members, and plan info
 */

// ===== State =====
let currentUser = null;
let currentOrganization = null;
let currentUserRole = null;

// Plan limits by tier
const PLAN_LIMITS = {
    free: { projects: 3, automations: 5, apps: 1, members: 2 },
    starter: { projects: 10, automations: 25, apps: 5, members: 5 },
    pro: { projects: 50, automations: 100, apps: 20, members: 20 },
    enterprise: { projects: Infinity, automations: Infinity, apps: Infinity, members: Infinity }
};

// ===== Initialization =====
async function initOrganization() {
    try {
        // Check authentication
        currentUser = await requireAuth();
        if (!currentUser) return;

        // Load organization info
        await loadOrganizationInfo();

        // Initialize sidebar with user role for admin features
        if (typeof AppSidebar !== 'undefined') {
            const profile = await getUserProfile(currentUser.id);
            AppSidebar.init({
                name: profile?.full_name || profile?.first_name || currentUser.email.split('@')[0],
                email: currentUser.email,
                organization: currentOrganization,
                role: currentUserRole,
                isAdmin: profile?.is_admin === true
            });
        }

        // Load stats and members
        await Promise.all([
            loadStats(),
            loadTeamMembers()
        ]);

        // Show content
        document.getElementById('loading').style.display = 'none';
        document.getElementById('org-content').style.display = 'block';

    } catch (error) {
        console.error('Failed to initialize organization page:', error);
        document.getElementById('loading').innerHTML = '<p style="color: var(--color-error);">Failed to load organization. Please refresh.</p>';
    }
}

// ===== Load Organization Info =====
async function loadOrganizationInfo() {
    const { data: membership, error } = await supabase
        .from('organization_members')
        .select(`
            role,
            organizations (
                id,
                name,
                plan,
                created_at
            )
        `)
        .eq('user_id', currentUser.id)
        .limit(1)
        .single();

    if (error) {
        console.error('Failed to load organization:', error);
        throw error;
    }

    currentOrganization = membership?.organizations;
    currentUserRole = membership?.role;

    if (!currentOrganization) {
        throw new Error('No organization found');
    }

    // Update UI
    const orgName = currentOrganization.name || 'My Organization';
    document.getElementById('org-name').textContent = orgName;
    document.getElementById('org-avatar').textContent = orgName.charAt(0).toUpperCase();

    const plan = currentOrganization.plan || 'free';
    const planLabels = {
        free: 'Free Plan',
        starter: 'Starter Plan',
        pro: 'Pro Plan',
        enterprise: 'Enterprise'
    };
    document.getElementById('org-plan').textContent = planLabels[plan] || 'Free Plan';
    document.getElementById('plan-name').textContent = planLabels[plan] || 'Free Plan';

    // Hide upgrade button for paid plans
    if (plan !== 'free') {
        document.getElementById('upgrade-btn').style.display = 'none';
    }
}

// ===== Load Stats =====
async function loadStats() {
    const orgId = currentOrganization.id;
    const plan = currentOrganization.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    try {
        // First get projects for this org
        const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .select('id')
            .eq('organization_id', orgId);

        if (projectsError) {
            console.error('Failed to load projects:', projectsError);
        }

        const projectIds = projects?.map(p => p.id) || [];
        const projectCount = projectIds.length;

        // Now load other counts in parallel
        const [automationsRes, appsRes, membersRes] = await Promise.all([
            // Only query automations if there are projects
            projectIds.length > 0
                ? supabase.from('automations').select('id', { count: 'exact', head: true }).in('project_id', projectIds)
                : Promise.resolve({ count: 0 }),
            supabase.from('customer_apps').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null),
            supabase.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
        ]);

        const automationCount = automationsRes.count || 0;
        const appCount = appsRes.count || 0;
        const memberCount = membersRes.count || 0;

        // Update stat cards
        document.getElementById('stat-projects').textContent = projectCount;
        document.getElementById('stat-automations').textContent = automationCount;
        document.getElementById('stat-apps').textContent = appCount;
        document.getElementById('stat-members').textContent = memberCount;

        // Update usage bars
        updateUsageBar('projects', projectCount, limits.projects);
        updateUsageBar('automations', automationCount, limits.automations);
        updateUsageBar('apps', appCount, limits.apps);

    } catch (error) {
        console.error('Error loading stats:', error);
        // Set default values on error
        document.getElementById('stat-projects').textContent = '0';
        document.getElementById('stat-automations').textContent = '0';
        document.getElementById('stat-apps').textContent = '0';
        document.getElementById('stat-members').textContent = '0';
    }
}

function updateUsageBar(type, current, limit) {
    const labelEl = document.getElementById(`usage-${type}`);
    const barEl = document.getElementById(`usage-${type}-bar`);

    if (!labelEl || !barEl) return;

    const limitLabel = limit === Infinity ? 'Unlimited' : limit;
    labelEl.textContent = `${current} / ${limitLabel}`;

    if (limit === Infinity) {
        barEl.style.width = '10%';
        barEl.classList.remove('warning', 'danger');
    } else {
        const percent = Math.min((current / limit) * 100, 100);
        barEl.style.width = `${percent}%`;

        barEl.classList.remove('warning', 'danger');
        if (percent >= 90) {
            barEl.classList.add('danger');
        } else if (percent >= 70) {
            barEl.classList.add('warning');
        }
    }
}

// ===== Load Team Members =====
async function loadTeamMembers() {
    const { data: members, error } = await supabase
        .from('organization_members')
        .select(`
            role,
            joined_at,
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
        console.error('Failed to load team members:', error);
        return;
    }

    const memberList = document.getElementById('member-list');

    if (!members || members.length === 0) {
        memberList.innerHTML = '<div class="empty-members">No team members found</div>';
        return;
    }

    memberList.innerHTML = members.map(member => {
        const profile = member.profiles || {};
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email?.split('@')[0] || 'Unknown';
        const email = profile.email || '';
        const initials = getInitials(profile.first_name, profile.last_name, email);
        const isOwner = member.role === 'owner';

        return `
            <div class="member-item">
                <div class="member-avatar">${initials}</div>
                <div class="member-info">
                    <div class="member-name">${escapeHtml(name)}</div>
                    <div class="member-email">${escapeHtml(email)}</div>
                </div>
                <span class="member-role ${isOwner ? 'owner' : ''}">${escapeHtml(member.role || 'member')}</span>
            </div>
        `;
    }).join('');
}

// ===== Utility Functions =====
function getInitials(firstName, lastName, email) {
    if (firstName && lastName) {
        return (firstName[0] + lastName[0]).toUpperCase();
    } else if (firstName) {
        return firstName.substring(0, 2).toUpperCase();
    } else if (email) {
        return email.substring(0, 2).toUpperCase();
    }
    return '?';
}

function escapeHtml(text) {
    if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
        return AppUtils.escapeHtml(text);
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Failed to load profile:', error);
        return null;
    }
    return data;
}

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', initOrganization);
