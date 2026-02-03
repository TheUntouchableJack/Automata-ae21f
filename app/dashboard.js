// ===== Dashboard Initialization =====
let currentUser = null;
let currentOrganization = null;
let currentUsage = null;
let orgLimits = null;
let isSubmitting = false;  // Guard against double-submit
let currentApp = null;      // User's loyalty app
let memberGrowthChart = null;
let tierDistributionChart = null;
let currentPeriodDays = 30; // Default chart period

async function initDashboard() {
    // Require authentication
    currentUser = await requireAuth();
    if (!currentUser) return;

    // Load user info and organization in parallel (optimized)
    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;
    orgLimits = orgData.limits;

    // Initialize sidebar with user data (including role for admin features)
    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    // Process pending onboarding (if user just signed up with onboarding data)
    const onboardingResult = await processPendingOnboarding();

    // If onboarding created a project, redirect to it with guided mode
    if (onboardingResult?.project && onboardingResult?.automations?.length > 0) {
        // Celebrate the successful onboarding!
        if (typeof celebrateBig === 'function') {
            celebrateBig();
        }

        // Redirect to the first automation in guided mode
        setTimeout(() => {
            const firstAutomation = onboardingResult.automations[0];
            window.location.href = `/app/automation.html#${firstAutomation.id}?guided=true`;
        }, 1500);
        return;
    }

    // Load usage data, projects, and app metrics in parallel (optimized)
    await Promise.all([
        loadUsageData(),
        loadProjects(),
        loadAppMetrics()
    ]);

    // Initialize AI Intelligence Feed (admin only)
    if (typeof AIFeed !== 'undefined' && currentOrganization) {
        AIFeed.init(currentOrganization.id, orgData.role);
    }

    // Setup event listeners
    setupEventListeners();

    // Check for deleted project (redirect from project.js soft delete)
    checkForDeletedProject();

    // Show coaching tour for new users with no projects
    showCoachingTourIfNeeded();
}

// ===== Check for Deleted Project (Undo Toast) =====
function checkForDeletedProject() {
    const urlParams = new URLSearchParams(window.location.search);
    const deletedName = urlParams.get('deleted');
    const deletedId = urlParams.get('deletedId');

    if (deletedName && deletedId && typeof UndoToast !== 'undefined') {
        // Clean URL without reloading
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);

        // Show undo toast
        UndoToast.show({
            message: `"${deletedName}" deleted`,
            entityType: 'projects',
            entityId: deletedId,
            entityName: deletedName,
            onUndo: async () => {
                // Reload projects list after restore
                await loadProjects();
            }
        });
    }
}

// ===== Process Pending Onboarding =====
async function processPendingOnboarding() {
    if (typeof OnboardingProcessor === 'undefined') return null;
    if (!OnboardingProcessor.hasPendingOnboarding()) return null;
    if (!currentOrganization) return null;

    console.log('Processing pending onboarding data...');
    return await OnboardingProcessor.process(currentOrganization.id, supabase);
}

// ===== Coaching Tour =====
function showCoachingTourIfNeeded() {
    if (typeof Coaching === 'undefined') return;

    // Check if we have any projects
    const projectsGrid = document.getElementById('projects-grid');
    const emptyState = document.getElementById('empty-state');

    // Show tour if empty state is visible (no projects)
    if (emptyState && emptyState.style.display !== 'none') {
        // Slight delay to ensure UI is ready
        setTimeout(() => {
            Coaching.showTour('dashboard');
        }, 500);
    }
}

// Use shared utilities for loadOrganization
// See: /app/utils.js

// ===== Load Usage Data =====
async function loadUsageData() {
    if (!currentOrganization) return;

    try {
        // Try to get current usage period
        const { data: usage, error } = await supabase
            .rpc('get_current_usage', { org_id: currentOrganization.id });

        if (error) {
            // If RPC doesn't exist yet, calculate manually
            console.log('get_current_usage not available, calculating manually');
            await calculateUsageManually();
            return;
        }

        currentUsage = usage;

        // Update snapshot counts (non-blocking, errors logged but don't break flow)
        const { error: snapshotError } = await supabase.rpc('update_usage_snapshots', { org_id: currentOrganization.id });
        if (snapshotError) {
            console.warn('Failed to update usage snapshots:', snapshotError.message);
        }

        // Re-fetch updated usage
        const { data: updatedUsage, error: refetchError } = await supabase
            .rpc('get_current_usage', { org_id: currentOrganization.id });

        if (refetchError) {
            console.warn('Failed to refetch usage:', refetchError.message);
        } else if (updatedUsage) {
            currentUsage = updatedUsage;
        }

        renderUsageDashboard();
    } catch (error) {
        console.error('Error loading usage data:', error);
        // Fall back to manual calculation
        await calculateUsageManually();
    }
}

// ===== Load App Metrics (SMB Dashboard) =====
async function loadAppMetrics() {
    if (!currentOrganization) return;

    try {
        // Get the organization's customer app(s)
        const { data: apps, error: appsError } = await supabase
            .from('customer_apps')
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1);

        if (appsError) {
            console.error('Error fetching apps:', appsError);
            return;
        }

        if (!apps || apps.length === 0) {
            // No app yet - show empty state or hide section
            showNoAppState();
            return;
        }

        currentApp = apps[0];

        // Show the metrics section
        const metricsSection = document.getElementById('app-metrics-section');
        if (metricsSection) {
            metricsSection.style.display = 'block';
        }

        // Load dashboard summary
        await loadDashboardSummary();

        // Load member growth chart
        await loadMemberGrowthChart(currentPeriodDays);

        // Load recent activity
        await loadRecentActivity();

        // Setup chart period selector
        setupChartPeriodSelector();

    } catch (error) {
        console.error('Error loading app metrics:', error);
    }
}

// ===== Show No App State =====
function showNoAppState() {
    const metricsSection = document.getElementById('app-metrics-section');
    if (!metricsSection) return;

    metricsSection.style.display = 'block';
    metricsSection.querySelector('.container').innerHTML = `
        <div class="no-app-state">
            <div class="no-app-state-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
            </div>
            <h3 data-i18n="dashboard.noAppTitle">Create Your Loyalty Program</h3>
            <p data-i18n="dashboard.noAppDesc">Set up your first customer app to start tracking members, visits, and rewards.</p>
            <a href="/app/app-builder.html" class="btn btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span data-i18n="dashboard.createApp">Create App</span>
            </a>
        </div>
    `;

    // Re-apply translations
    if (typeof i18n !== 'undefined' && i18n.updatePageTranslations) {
        i18n.updatePageTranslations();
    }
}

// ===== Load Dashboard Summary =====
async function loadDashboardSummary() {
    if (!currentApp) return;

    try {
        // Try RPC function first
        const { data: summary, error } = await supabase
            .rpc('get_app_dashboard_summary', { p_app_id: currentApp.id });

        if (error) {
            console.warn('get_app_dashboard_summary not available, calculating manually');
            await calculateMetricsManually();
            return;
        }

        // Update metric cards with animated counters
        animateCounter('metric-total-members', summary.total_members || 0);
        animateCounter('metric-today-checkins', summary.today_checkins || 0);
        animateCounter('metric-new-week', summary.new_this_week || 0);
        animateCounter('metric-points-week', summary.points_this_week || 0);

        // Update quick stats
        document.getElementById('stat-active-members').textContent =
            (summary.active_members_30d || 0).toLocaleString();
        document.getElementById('stat-total-visits').textContent =
            (summary.total_visits || 0).toLocaleString();

        const avgVisits = summary.total_members > 0
            ? (summary.total_visits / summary.total_members).toFixed(1)
            : '0';
        document.getElementById('stat-avg-visits').textContent = avgVisits;
        document.getElementById('stat-referrals').textContent =
            (summary.referral_count || 0).toLocaleString();

        // Render tier distribution chart
        if (summary.tier_distribution) {
            renderTierDistributionChart(summary.tier_distribution);
        }

    } catch (error) {
        console.error('Error loading dashboard summary:', error);
        await calculateMetricsManually();
    }
}

// ===== Calculate Metrics Manually (Fallback) =====
async function calculateMetricsManually() {
    if (!currentApp) return;

    try {
        // Count total members
        const { count: totalMembers } = await supabase
            .from('app_members')
            .select('*', { count: 'exact', head: true })
            .eq('app_id', currentApp.id)
            .is('deleted_at', null);

        // Count today's check-ins
        const today = new Date().toISOString().split('T')[0];
        const { count: todayCheckins } = await supabase
            .from('member_visits')
            .select('*', { count: 'exact', head: true })
            .eq('app_id', currentApp.id)
            .gte('visited_at', today);

        // Count new members this week
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count: newWeek } = await supabase
            .from('app_members')
            .select('*', { count: 'exact', head: true })
            .eq('app_id', currentApp.id)
            .gte('created_at', weekAgo)
            .is('deleted_at', null);

        // Update metric cards
        animateCounter('metric-total-members', totalMembers || 0);
        animateCounter('metric-today-checkins', todayCheckins || 0);
        animateCounter('metric-new-week', newWeek || 0);
        animateCounter('metric-points-week', 0); // Can't easily calculate without RPC

        // Get tier distribution
        const { data: tierData } = await supabase
            .from('app_members')
            .select('tier')
            .eq('app_id', currentApp.id)
            .is('deleted_at', null);

        if (tierData) {
            const distribution = tierData.reduce((acc, member) => {
                const tier = member.tier || 'bronze';
                acc[tier] = (acc[tier] || 0) + 1;
                return acc;
            }, {});
            renderTierDistributionChart(distribution);
        }

        // Update quick stats
        document.getElementById('stat-active-members').textContent = '-';
        document.getElementById('stat-total-visits').textContent = '-';
        document.getElementById('stat-avg-visits').textContent = '-';
        document.getElementById('stat-referrals').textContent = '-';

    } catch (error) {
        console.error('Error calculating metrics:', error);
    }
}

// ===== Animate Counter =====
function animateCounter(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const startValue = 0;
    const duration = 1000; // ms
    const startTime = performance.now();

    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentValue = Math.round(startValue + (targetValue - startValue) * easeOut);

        element.textContent = currentValue.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        }
    }

    requestAnimationFrame(updateCounter);
}

// ===== Load Member Growth Chart =====
async function loadMemberGrowthChart(days) {
    if (!currentApp) return;

    try {
        // Try RPC function first
        const { data: growthData, error } = await supabase
            .rpc('get_member_growth', { p_app_id: currentApp.id, p_days: days });

        if (error) {
            console.warn('get_member_growth not available');
            renderEmptyChart();
            return;
        }

        if (!growthData || growthData.length === 0) {
            renderEmptyChart();
            return;
        }

        renderMemberGrowthChart(growthData);

    } catch (error) {
        console.error('Error loading member growth:', error);
        renderEmptyChart();
    }
}

// ===== Render Member Growth Chart =====
function renderMemberGrowthChart(data) {
    const chartContainer = document.getElementById('member-growth-chart');
    if (!chartContainer) return;

    // Destroy existing chart
    if (memberGrowthChart) {
        memberGrowthChart.destroy();
    }

    const dates = data.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const newMembers = data.map(d => parseInt(d.new_members) || 0);
    const cumulative = data.map(d => parseInt(d.cumulative) || 0);

    const options = {
        series: [{
            name: 'Total Members',
            type: 'area',
            data: cumulative
        }, {
            name: 'New Members',
            type: 'bar',
            data: newMembers
        }],
        chart: {
            height: 250,
            type: 'line',
            toolbar: { show: false },
            fontFamily: 'Inter, system-ui, sans-serif',
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 800
            }
        },
        colors: ['#7c3aed', '#10b981'],
        fill: {
            type: ['gradient', 'solid'],
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.4,
                opacityTo: 0.1,
                stops: [0, 90, 100]
            }
        },
        stroke: {
            width: [3, 0],
            curve: 'smooth'
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                columnWidth: '50%'
            }
        },
        xaxis: {
            categories: dates,
            labels: {
                style: {
                    colors: '#94a3b8',
                    fontSize: '11px'
                },
                rotate: 0
            },
            axisBorder: { show: false },
            axisTicks: { show: false },
            tickAmount: Math.min(dates.length, 7)
        },
        yaxis: [{
            title: { text: '' },
            labels: {
                style: {
                    colors: '#94a3b8',
                    fontSize: '11px'
                },
                formatter: (val) => Math.round(val).toLocaleString()
            }
        }, {
            opposite: true,
            title: { text: '' },
            labels: {
                style: {
                    colors: '#94a3b8',
                    fontSize: '11px'
                },
                formatter: (val) => Math.round(val).toLocaleString()
            }
        }],
        grid: {
            borderColor: '#e2e8f0',
            strokeDashArray: 4,
            xaxis: { lines: { show: false } }
        },
        legend: {
            position: 'top',
            horizontalAlign: 'right',
            fontSize: '12px',
            markers: { radius: 3 }
        },
        tooltip: {
            shared: true,
            intersect: false,
            y: {
                formatter: (val) => val.toLocaleString()
            }
        }
    };

    memberGrowthChart = new ApexCharts(chartContainer, options);
    memberGrowthChart.render();
}

// ===== Render Empty Chart =====
function renderEmptyChart() {
    const chartContainer = document.getElementById('member-growth-chart');
    if (!chartContainer) return;

    chartContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 250px; color: var(--color-text-muted);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5; margin-bottom: 12px;">
                <path d="M3 3v18h18"/>
                <path d="M18 17l-5-6-4 4-5-6"/>
            </svg>
            <p style="font-size: 14px;">No data yet</p>
            <p style="font-size: 12px; opacity: 0.7;">Member data will appear here once you have signups</p>
        </div>
    `;
}

// ===== Render Tier Distribution Chart =====
function renderTierDistributionChart(distribution) {
    const chartContainer = document.getElementById('tier-distribution-chart');
    const legendContainer = document.getElementById('tier-legend');
    if (!chartContainer) return;

    // Destroy existing chart
    if (tierDistributionChart) {
        tierDistributionChart.destroy();
    }

    const tiers = ['bronze', 'silver', 'gold', 'platinum'];
    const tierColors = {
        bronze: '#cd7f32',
        silver: '#c0c0c0',
        gold: '#ffd700',
        platinum: '#b8b8d1'
    };
    const tierLabels = {
        bronze: 'Bronze',
        silver: 'Silver',
        gold: 'Gold',
        platinum: 'Platinum'
    };

    const values = tiers.map(t => distribution[t] || 0);
    const total = values.reduce((a, b) => a + b, 0);

    if (total === 0) {
        chartContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--color-text-muted);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5; margin-bottom: 8px;">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                <p style="font-size: 13px;">No members yet</p>
            </div>
        `;
        if (legendContainer) legendContainer.innerHTML = '';
        return;
    }

    const options = {
        series: values,
        chart: {
            type: 'donut',
            height: 200,
            fontFamily: 'Inter, system-ui, sans-serif'
        },
        colors: tiers.map(t => tierColors[t]),
        labels: tiers.map(t => tierLabels[t]),
        plotOptions: {
            pie: {
                donut: {
                    size: '65%',
                    labels: {
                        show: true,
                        total: {
                            show: true,
                            label: 'Total',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#1e293b',
                            formatter: () => total.toLocaleString()
                        }
                    }
                }
            }
        },
        dataLabels: { enabled: false },
        legend: { show: false },
        stroke: {
            width: 2,
            colors: ['#fff']
        },
        tooltip: {
            y: {
                formatter: (val) => `${val} members (${((val / total) * 100).toFixed(1)}%)`
            }
        }
    };

    tierDistributionChart = new ApexCharts(chartContainer, options);
    tierDistributionChart.render();

    // Render custom legend
    if (legendContainer) {
        legendContainer.innerHTML = tiers.map(tier => {
            const count = distribution[tier] || 0;
            const percent = total > 0 ? ((count / total) * 100).toFixed(0) : 0;
            return `
                <div class="tier-legend-item">
                    <span class="tier-legend-dot ${tier}"></span>
                    <span class="tier-legend-label">${tierLabels[tier]}</span>
                    <span class="tier-legend-count">${count} (${percent}%)</span>
                </div>
            `;
        }).join('');
    }
}

// ===== Load Recent Activity =====
async function loadRecentActivity() {
    if (!currentApp) return;

    const activityList = document.getElementById('activity-list');
    if (!activityList) return;

    try {
        // Try RPC function first
        const { data: activities, error } = await supabase
            .rpc('get_recent_activity', { p_app_id: currentApp.id, p_limit: 10 });

        if (error) {
            console.warn('get_recent_activity not available, fetching manually');
            await loadActivityManually();
            return;
        }

        if (!activities || activities.length === 0) {
            activityList.innerHTML = `
                <div class="activity-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>No activity yet</p>
                </div>
            `;
            return;
        }

        renderActivityList(activities);

    } catch (error) {
        console.error('Error loading activity:', error);
        activityList.innerHTML = `<div class="activity-empty"><p>Error loading activity</p></div>`;
    }
}

// ===== Load Activity Manually (Fallback) =====
async function loadActivityManually() {
    const activityList = document.getElementById('activity-list');
    if (!activityList || !currentApp) return;

    try {
        // Get recent members (joins)
        const { data: members } = await supabase
            .from('app_members')
            .select('id, first_name, last_name, created_at')
            .eq('app_id', currentApp.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(10);

        if (!members || members.length === 0) {
            activityList.innerHTML = `
                <div class="activity-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>No activity yet</p>
                </div>
            `;
            return;
        }

        const activities = members.map(m => ({
            event_type: 'join',
            member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Member',
            description: 'joined the program',
            created_at: m.created_at
        }));

        renderActivityList(activities);

    } catch (error) {
        console.error('Error loading activity manually:', error);
    }
}

// ===== Render Activity List =====
function renderActivityList(activities) {
    const activityList = document.getElementById('activity-list');
    if (!activityList) return;

    const icons = {
        join: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
        visit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        redeem: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        referral: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    };

    activityList.innerHTML = activities.map(activity => {
        const timeAgo = getTimeAgo(activity.created_at);
        const icon = icons[activity.event_type] || icons.join;
        const points = activity.points && activity.points > 0
            ? `<span class="activity-points">+${activity.points}</span>`
            : '';

        return `
            <div class="activity-item">
                <div class="activity-icon ${activity.event_type}">
                    ${icon}
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong>${escapeHtml(activity.member_name || 'Member')}</strong> ${escapeHtml(activity.description || '')}
                    </div>
                    <div class="activity-time">${timeAgo}</div>
                </div>
                ${points}
            </div>
        `;
    }).join('');
}

// ===== Get Time Ago =====
function getTimeAgo(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ===== Setup Chart Period Selector =====
function setupChartPeriodSelector() {
    const buttons = document.querySelectorAll('.period-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
            // Update active state
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Load chart with new period
            const days = parseInt(btn.dataset.days);
            currentPeriodDays = days;
            await loadMemberGrowthChart(days);
        });
    });
}

// ===== Refresh Dashboard =====
async function refreshDashboard() {
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `
            <div class="loading-spinner small" style="width: 18px; height: 18px; border-width: 2px;"></div>
            <span>Refreshing...</span>
        `;
    }

    try {
        await Promise.all([
            loadDashboardSummary(),
            loadMemberGrowthChart(currentPeriodDays),
            loadRecentActivity()
        ]);
    } catch (error) {
        console.error('Error refreshing dashboard:', error);
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9"/>
                </svg>
                <span data-i18n="dashboard.refresh">Refresh</span>
            `;
        }
    }
}

// ===== Calculate Usage Manually (fallback) =====
async function calculateUsageManually() {
    if (!currentOrganization) return;

    try {
        // Count members across all apps for this organization
        let membersCount = 0;
        const { data: apps } = await supabase
            .from('customer_apps')
            .select('id')
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null);

        if (apps && apps.length > 0) {
            const appIds = apps.map(a => a.id);
            const { count } = await supabase
                .from('app_members')
                .select('*', { count: 'exact', head: true })
                .in('app_id', appIds)
                .is('deleted_at', null);
            membersCount = count || 0;
        }

        // Count AI analyses used this month
        let aiAnalysesUsed = 0;
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count: aiCount } = await supabase
            .from('ai_recommendations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id)
            .gte('created_at', startOfMonth.toISOString());

        aiAnalysesUsed = aiCount || 0;

        // Legacy counts for backwards compatibility
        const { count: customersCount } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null);

        currentUsage = {
            members_count: membersCount,
            customers_count: customersCount || 0,
            ai_analyses_used: aiAnalysesUsed
        };

        renderUsageDashboard();
    } catch (error) {
        console.error('Error calculating usage:', error);
    }
}

// ===== Render Usage Dashboard =====
function renderUsageDashboard() {
    const usageSection = document.getElementById('usage-section');
    const usageMetrics = document.getElementById('usage-metrics');
    const planName = document.getElementById('usage-plan-name');
    const planBadge = document.getElementById('usage-plan-badge');
    const redeemBtn = document.getElementById('redeem-code-btn');
    const upgradeBtn = document.getElementById('upgrade-btn');
    const usageFooter = document.getElementById('usage-footer');

    if (!usageSection || !currentUsage || !orgLimits) return;

    // Show the section
    usageSection.style.display = 'block';

    // Set plan name and badge
    planName.textContent = orgLimits.name || 'Free';

    if (orgLimits.badge) {
        planBadge.textContent = orgLimits.badge;
        planBadge.style.display = 'inline-block';
    }

    // Show redeem button for free users or AppSumo users who can stack
    if (currentOrganization.plan_type === 'free' ||
        (currentOrganization.plan_type === 'appsumo_lifetime' && currentOrganization.appsumo_tier < 3)) {
        redeemBtn.style.display = 'inline-flex';
    }

    // Hide upgrade button for max tier AppSumo or enterprise
    if (currentOrganization.plan_type === 'appsumo_lifetime' && currentOrganization.appsumo_tier === 3) {
        upgradeBtn.textContent = 'Stack Code';
        upgradeBtn.href = '/app/redeem.html';
    } else if (currentOrganization.subscription_tier === 'enterprise') {
        upgradeBtn.style.display = 'none';
    }

    // Render metrics based on new Royalty pricing model
    const metrics = [];

    // Members metric (always shown)
    metrics.push({
        key: 'members',
        label: 'Members',
        used: currentUsage.members_count || currentUsage.customers_count || 0,
        limit: orgLimits.members,
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    });

    // Intelligence metric (only shown if user has access to intelligence)
    if (orgLimits.intelligence_monthly !== 0) {
        metrics.push({
            key: 'intelligence',
            label: 'AI Insights',
            used: currentUsage.ai_analyses_used || 0,
            limit: orgLimits.intelligence_monthly,
            icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/><circle cx="12" cy="12" r="3"/></svg>',
            resets: true
        });
    }

    usageMetrics.innerHTML = metrics.map(m => {
        const isUnlimited = m.limit === -1;
        const percent = isUnlimited ? 0 : Math.min(Math.round((m.used / m.limit) * 100), 100);
        const status = getUsageStatusClass(percent);

        return `
            <div class="usage-metric ${isUnlimited ? 'unlimited' : ''}">
                <div class="usage-metric-header">
                    <div class="usage-metric-label">
                        ${m.icon}
                        ${m.label}
                    </div>
                    ${m.resets ? '<span class="usage-metric-value">This month</span>' : ''}
                </div>
                ${!isUnlimited ? `
                    <div class="usage-metric-bar">
                        <div class="usage-metric-fill ${status}" style="width: ${percent}%"></div>
                    </div>
                ` : ''}
                <div class="usage-metric-numbers">
                    <span class="usage-metric-used">${m.used.toLocaleString()}</span>
                    <span class="usage-metric-limit">/ ${isUnlimited ? 'Unlimited' : m.limit.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');

    // Show footer with reset date
    usageFooter.style.display = 'flex';
    const resetDate = document.getElementById('reset-date');
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    resetDate.textContent = nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getUsageStatusClass(percent) {
    if (percent >= 100) return 'critical';
    if (percent >= 80) return 'warning';
    if (percent >= 50) return 'moderate';
    return 'healthy';
}

// Use shared utilities for loadUserInfo and getInitials
// See: /app/utils.js

// ===== Load Projects =====
async function loadProjects() {
    const loading = document.getElementById('loading');
    const projectsGrid = document.getElementById('projects-grid');
    const emptyState = document.getElementById('empty-state');

    if (!currentOrganization) {
        loading.innerHTML = '<p style="color: var(--color-error);">No organization found. Please contact support.</p>';
        return;
    }

    try {
        const { data: projects, error } = await supabase
            .from('projects')
            .select(`
                *,
                automations(count)
            `)
            .eq('organization_id', currentOrganization.id)
            .is('deleted_at', null)  // Exclude soft-deleted projects
            .order('updated_at', { ascending: false });

        if (error) throw error;

        loading.style.display = 'none';

        if (!projects || projects.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        projectsGrid.style.display = 'grid';
        renderProjects(projects);

    } catch (error) {
        console.error('Error loading projects:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading projects. Please refresh.</p>';
    }
}

function renderProjects(projects) {
    const projectsGrid = document.getElementById('projects-grid');

    const projectCards = projects.map(project => {
        const automationCount = project.automations?.[0]?.count || 0;
        const createdDate = new Date(project.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });

        return `
            <div class="project-card" data-project-id="${project.id}">
                <div class="project-card-header">
                    <div class="project-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                            <path d="M8 10H16M8 14H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </div>
                    ${project.industry ? `<span class="project-industry">${escapeHtml(project.industry)}</span>` : ''}
                </div>
                <h3 class="project-name">${escapeHtml(project.name)}</h3>
                <p class="project-description">${escapeHtml(project.description || 'No description')}</p>
                <div class="project-meta">
                    <span class="project-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                            <path d="M8 5V8L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        ${createdDate}
                    </span>
                    <span class="project-meta-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8L7 12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        ${automationCount} automation${automationCount !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // Add create project card at the end
    const createCard = `
        <div class="create-project-card" id="create-project-card">
            <div class="create-project-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <span>Create New Project</span>
        </div>
    `;

    projectsGrid.innerHTML = projectCards + createCard;

    // Use event delegation instead of per-element listeners (optimized)
    AppUtils.delegate(projectsGrid, 'click', '.project-card[data-project-id]', (event, card) => {
        const projectId = card.dataset.projectId;
        if (projectId) {
            window.location.href = `/app/project.html#${projectId}`;
        }
    });

    AppUtils.delegate(projectsGrid, 'click', '.create-project-card', () => {
        openCreateModal();
    });
}

// ===== Event Listeners =====
function setupEventListeners() {
    // User menu and logout are now handled by sidebar.js

    // Refresh dashboard button
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshDashboard);
    }

    // New project buttons (admin only)
    const newProjectBtn = document.getElementById('new-project-btn');
    if (newProjectBtn) {
        newProjectBtn.addEventListener('click', openCreateModal);
    }
    document.getElementById('empty-new-project-btn')?.addEventListener('click', openCreateModal);

    // Modal controls
    document.getElementById('modal-close').addEventListener('click', closeCreateModal);
    document.getElementById('modal-cancel').addEventListener('click', closeCreateModal);

    // Close modal on overlay click
    document.getElementById('create-project-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCreateModal();
        }
    });

    // Create project form
    document.getElementById('create-project-form').addEventListener('submit', handleCreateProject);

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCreateModal();
        }
    });
}

// ===== Modal Functions =====
function openCreateModal() {
    document.getElementById('create-project-modal').classList.add('active');
    document.getElementById('project-name').focus();
}

function closeCreateModal() {
    document.getElementById('create-project-modal').classList.remove('active');
    document.getElementById('create-project-form').reset();
}

// ===== Create Project =====
async function handleCreateProject(e) {
    e.preventDefault();

    // Prevent double-submit
    if (isSubmitting) return;
    isSubmitting = true;

    const createBtn = document.getElementById('create-btn');
    const originalText = createBtn.textContent;

    // Check limit before creating
    if (orgLimits && currentUsage && typeof checkLimit === 'function') {
        const limitCheck = checkLimit(
            currentOrganization,
            { projects: currentUsage.projects_count || 0 },
            'projects'
        );

        if (!limitCheck.allowed) {
            showUpgradeModal('projects', limitCheck);
            return;
        }
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    const name = document.getElementById('project-name').value.trim();
    const description = document.getElementById('project-description').value.trim();
    const industry = document.getElementById('project-industry').value;

    try {
        const { data, error } = await supabase
            .from('projects')
            .insert([{
                organization_id: currentOrganization.id,
                created_by: currentUser.id,
                name,
                description,
                industry: industry || null,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Log the creation
        AuditLog.logProjectCreate(currentOrganization.id, data);

        // Update local usage count
        if (currentUsage) {
            currentUsage.projects_count = (currentUsage.projects_count || 0) + 1;
            renderUsageDashboard();
        }

        // Celebrate!
        celebrate();
        createBtn.textContent = 'Created!';
        createBtn.classList.add('btn-success');

        // Redirect to the new project after brief celebration
        setTimeout(() => {
            window.location.href = `/app/project.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating project:', error);
        showToast('Error creating project', 'error');
        createBtn.disabled = false;
        createBtn.textContent = originalText;
        isSubmitting = false;  // Reset guard on error
    }
}

// ===== Upgrade Modal =====
function showUpgradeModal(limitType, limitCheck) {
    const modal = document.getElementById('upgrade-modal');
    if (!modal) {
        // Create modal if it doesn't exist
        createUpgradeModal();
    }

    const upgradeTitle = document.getElementById('upgrade-title');
    const upgradeMessage = document.getElementById('upgrade-message');
    const upgradeOptions = document.getElementById('upgrade-options');

    // Set title and message
    const limitNames = {
        projects: 'Projects',
        automations: 'Automations',
        customers: 'Customers',
        emails_monthly: 'Monthly Emails',
        ai_analyses: 'AI Analyses'
    };

    upgradeTitle.textContent = `${limitNames[limitType] || 'Limit'} Reached`;
    upgradeMessage.textContent = limitCheck.message;

    // Get upgrade options
    const options = typeof getUpgradeOptions === 'function'
        ? getUpgradeOptions(currentOrganization)
        : [];

    upgradeOptions.innerHTML = options.map(opt => `
        <a href="${opt.action === 'redeem' ? '/app/redeem.html' : '/pricing.html'}" class="upgrade-option">
            <div class="upgrade-option-icon">
                ${opt.type === 'stack_code' || opt.type === 'appsumo'
                    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>'
                    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
                }
            </div>
            <div class="upgrade-option-content">
                <h4>${opt.label}</h4>
                <p>${opt.description}</p>
            </div>
        </a>
    `).join('');

    document.getElementById('upgrade-modal').classList.add('active');
}

function createUpgradeModal() {
    const modalHtml = `
        <div class="modal-overlay upgrade-modal" id="upgrade-modal">
            <div class="modal">
                <div class="modal-header">
                    <h2 id="upgrade-title">Limit Reached</h2>
                    <button class="modal-close" onclick="closeUpgradeModal()">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="upgrade-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <p class="upgrade-message" id="upgrade-message">You've reached your limit.</p>
                    <div class="upgrade-options" id="upgrade-options">
                        <!-- Options populated by JS -->
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeUpgradeModal()">Maybe Later</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Close on overlay click
    document.getElementById('upgrade-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeUpgradeModal();
        }
    });
}

function closeUpgradeModal() {
    const modal = document.getElementById('upgrade-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ===== Utility Functions =====
// Use shared utilities
const escapeHtml = AppUtils.escapeHtml;

// Initialize on page load
document.addEventListener('DOMContentLoaded', initDashboard);
