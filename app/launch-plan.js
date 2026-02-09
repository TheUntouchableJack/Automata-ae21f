/**
 * Launch Plan - Admin Only
 * Go-to-market strategy tracking and platform launches
 */

(function() {
    'use strict';

    // =========================================
    // PLATFORM DATA
    // =========================================

    const LAUNCH_PLATFORMS = [
        // Priority Launch Platforms
        { id: 'product-hunt', name: 'Product Hunt', url: 'https://producthunt.com', desc: 'The #1 place to launch new products', priority: true, category: 'launch' },
        { id: 'appsumo', name: 'AppSumo', url: 'https://appsumo.com', desc: 'Lifetime deals marketplace - great for early revenue', priority: true, paid: true, category: 'marketplace' },
        { id: 'hacker-news', name: 'Hacker News', url: 'https://news.ycombinator.com', desc: 'Tech community, Show HN posts', priority: true, category: 'community' },

        // Launch Directories (from @pmitu list)
        { id: 'microlaunch', name: 'MicroLaunch', url: 'https://microlaunch.net', desc: 'Launch platform for indie hackers', category: 'directory' },
        { id: 'toolfolio', name: 'Toolfolio', url: 'https://toolfolio.co', desc: 'Curated tools directory', category: 'directory' },
        { id: 'lab-startups', name: 'Lab Startups', url: 'https://labstartups.com', desc: 'Startup discovery platform', category: 'directory' },
        { id: 'betalist', name: 'BetaList', url: 'https://betalist.com', desc: 'Early access startups - paid for faster review', paid: true, category: 'directory' },
        { id: 'devhunt', name: 'DevHunt', url: 'https://devhunt.org', desc: 'Launch platform for developer tools', category: 'directory' },
        { id: 'indie-hackers', name: 'Indie Hackers', url: 'https://indiehackers.com', desc: 'Community of bootstrapped founders', category: 'community' },
        { id: 'peerlist', name: 'Peerlist', url: 'https://peerlist.io', desc: 'Professional network for builders', category: 'directory' },
        { id: 'tiny-startups', name: 'Tiny Startups', url: 'https://tinystartups.com', desc: 'Small startup showcase', category: 'directory' },
        { id: 'fazier', name: 'Fazier', url: 'https://fazier.com', desc: 'Launch and grow your startup', category: 'directory' },
        { id: 'sideprojectors', name: 'SideProjectors', url: 'https://sideprojectors.com', desc: 'Buy and sell side projects', category: 'marketplace' },
        { id: 'launchigniter', name: 'LaunchIgniter', url: 'https://launchigniter.com', desc: 'Startup launch platform', category: 'directory' },
        { id: 'startupstash', name: 'Startup Stash', url: 'https://startupstash.com', desc: 'Curated directory of resources', category: 'directory' },
        { id: 'saashub', name: 'SaaSHub', url: 'https://saashub.com', desc: 'Software alternatives & reviews', category: 'directory' },
        { id: 'uneed', name: 'Uneed', url: 'https://uneed.best', desc: 'Best tools on the internet', category: 'directory' },
        { id: 'launching-next', name: 'Launching Next', url: 'https://launchingnext.com', desc: 'New startup launches daily', category: 'directory' },
        { id: 'alternativeto', name: 'AlternativeTo', url: 'https://alternativeto.net', desc: 'Crowdsourced software recommendations', category: 'directory' },
        { id: 'first-contact', name: 'FirstoContact', url: 'https://firstocontact.com', desc: 'Connect with early adopters', category: 'directory' },
        { id: 'peerpush', name: 'PeerPush', url: 'https://peerpush.net', desc: 'Share and discover projects', category: 'directory' },

        // Additional important platforms
        { id: 'g2', name: 'G2', url: 'https://g2.com', desc: 'Business software reviews - paid review campaigns available', paid: true, category: 'reviews' },
        { id: 'capterra', name: 'Capterra', url: 'https://capterra.com', desc: 'Software comparison - pay-per-click listings', paid: true, category: 'reviews' },

        // Lifetime Deal Marketplaces (Paid - revenue share model)
        { id: 'pitchground', name: 'PitchGround', url: 'https://pitchground.com', desc: 'Lifetime deals for SaaS - AppSumo alternative', paid: true, category: 'marketplace' },
        { id: 'stacksocial', name: 'StackSocial', url: 'https://stacksocial.com', desc: 'Tech deals marketplace - large audience', paid: true, category: 'marketplace' },
        { id: 'dealify', name: 'Dealify', url: 'https://dealify.com', desc: 'SaaS lifetime deals platform', paid: true, category: 'marketplace' },
        { id: 'saasmantra', name: 'SaaSMantra', url: 'https://saasmantra.com', desc: 'Curated SaaS lifetime deals', paid: true, category: 'marketplace' },
        { id: 'dealmirror', name: 'DealMirror', url: 'https://dealmirror.com', desc: 'Software deals aggregator', paid: true, category: 'marketplace' },
        { id: 'rockethub', name: 'RocketHub', url: 'https://rockethub.com', desc: 'Startup deals and crowdfunding', paid: true, category: 'marketplace' },

        // Additional Review Platforms (Paid options)
        { id: 'trustradius', name: 'TrustRadius', url: 'https://trustradius.com', desc: 'B2B software reviews - enterprise focused', paid: true, category: 'reviews' },
        { id: 'software-advice', name: 'Software Advice', url: 'https://softwareadvice.com', desc: 'Gartner-owned software comparison', paid: true, category: 'reviews' },
        { id: 'getapp', name: 'GetApp', url: 'https://getapp.com', desc: 'Business app discovery - Gartner network', paid: true, category: 'reviews' },
        { id: 'sourceforge', name: 'SourceForge', url: 'https://sourceforge.net', desc: 'Open source & software reviews', category: 'reviews' },
        { id: 'crozdesk', name: 'Crozdesk', url: 'https://crozdesk.com', desc: 'Software discovery platform', category: 'reviews' },
    ];

    // =========================================
    // STATE
    // =========================================

    let supabaseClient = null;
    let currentUser = null;
    let currentOrg = null;
    let userRole = null;
    let launchData = {
        completedPlatforms: [],
        notes: '',
        contentCount: 0,
        backlinkCount: 0
    };

    // =========================================
    // INITIALIZATION
    // =========================================

    async function init() {
        // Use existing Supabase client from auth.js (window.supabase is the client instance)
        supabaseClient = window.supabase;

        // Check auth
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        currentUser = session.user;

        // Load organization and check admin
        await loadOrganization();

        // Check if user is admin
        if (userRole !== 'owner' && userRole !== 'admin') {
            // Redirect non-admins
            alert(window.t ? window.t('errors.adminOnly') : 'This page is for administrators only.');
            window.location.href = 'dashboard.html';
            return;
        }

        // Initialize sidebar with user data
        const fullName = currentUser.user_metadata?.full_name ||
                        currentUser.user_metadata?.name ||
                        currentUser.email?.split('@')[0] ||
                        'User';

        // Get profile for is_admin flag
        let profileIsAdmin = false;
        if (typeof getUserProfile === 'function') {
            const profile = await getUserProfile(currentUser.id);
            profileIsAdmin = profile?.is_admin === true;
        }

        if (window.AppSidebar) {
            AppSidebar.init({
                name: fullName,
                email: currentUser.email,
                organization: currentOrg,
                role: userRole,
                isAdmin: profileIsAdmin
            });
        }

        // Load saved launch data
        await loadLaunchData();

        // Render platforms
        renderPlatforms();
        updateStats();

        // Setup event listeners
        setupEventListeners();
    }

    async function loadOrganization() {
        try {
            const { data: memberships } = await supabaseClient
                .from('organization_members')
                .select('organization_id, role')
                .eq('user_id', currentUser.id)
                .limit(1);

            if (memberships && memberships.length > 0) {
                userRole = memberships[0].role;

                const { data: org } = await supabaseClient
                    .from('organizations')
                    .select('*')
                    .eq('id', memberships[0].organization_id)
                    .single();

                currentOrg = org;
            }
        } catch (error) {
            console.error('Error loading organization:', error);
        }
    }

    async function loadLaunchData() {
        // Try to load from localStorage first (for now)
        // In future, could store in org settings JSONB
        const saved = localStorage.getItem('royalty_launch_plan');
        if (saved) {
            try {
                launchData = JSON.parse(saved);
            } catch (e) {
                console.error('Error parsing launch data:', e);
            }
        }

        // Load notes
        const notesArea = document.getElementById('launch-notes');
        if (notesArea && launchData.notes) {
            notesArea.value = launchData.notes;
        }
    }

    function saveLaunchData() {
        localStorage.setItem('royalty_launch_plan', JSON.stringify(launchData));
        showSaveIndicator();
    }

    // =========================================
    // RENDERING
    // =========================================

    function renderPlatforms() {
        const grid = document.getElementById('platforms-grid');
        if (!grid) return;

        const escapeHtml = AppUtils?.escapeHtml || ((s) => s);

        grid.innerHTML = LAUNCH_PLATFORMS.map(platform => {
            const isCompleted = launchData.completedPlatforms.includes(platform.id);

            return `
                <div class="platform-card ${isCompleted ? 'completed' : ''}" data-platform-id="${platform.id}">
                    <div class="platform-checkbox ${isCompleted ? 'checked' : ''}"
                         onclick="togglePlatform('${platform.id}')"></div>
                    <div class="platform-info">
                        <div class="platform-name">
                            <a href="${escapeHtml(platform.url)}" target="_blank" rel="noopener">${escapeHtml(platform.name)}</a>
                            ${platform.priority ? '<span class="platform-badge priority">Priority</span>' : ''}
                            ${platform.paid ? '<span class="platform-badge paid">Paid</span>' : ''}
                        </div>
                        <div class="platform-desc">${escapeHtml(platform.desc)}</div>
                        <div class="platform-meta">
                            <span>📁 ${escapeHtml(platform.category)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateStats() {
        const completed = launchData.completedPlatforms.length;
        const total = LAUNCH_PLATFORMS.length;
        const percentage = Math.round((completed / total) * 100);

        // Update stat cards
        document.getElementById('stat-platforms').textContent = `${completed}/${total}`;
        document.getElementById('stat-content').textContent = launchData.contentCount || 0;
        document.getElementById('stat-backlinks').textContent = launchData.backlinkCount || 0;

        // Update progress bar
        const progressFill = document.getElementById('platforms-progress');
        const progressText = document.getElementById('platforms-progress-text');
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressText) progressText.textContent = `${percentage}%`;
    }

    // =========================================
    // EVENT HANDLERS
    // =========================================

    function setupEventListeners() {
        // Notes auto-save
        const notesArea = document.getElementById('launch-notes');
        if (notesArea) {
            let saveTimeout;
            notesArea.addEventListener('input', () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    launchData.notes = notesArea.value;
                    saveLaunchData();
                }, 1000);
            });
        }
    }

    // Global function for toggling platform completion
    window.togglePlatform = function(platformId) {
        const index = launchData.completedPlatforms.indexOf(platformId);
        if (index === -1) {
            launchData.completedPlatforms.push(platformId);
        } else {
            launchData.completedPlatforms.splice(index, 1);
        }

        saveLaunchData();
        renderPlatforms();
        updateStats();
    };

    // Global function for toggling sections
    window.toggleSection = function(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.toggle('expanded');
        }
    };

    // =========================================
    // UI HELPERS
    // =========================================

    function showSaveIndicator() {
        const indicator = document.getElementById('save-indicator');
        const text = document.getElementById('save-text');
        if (!indicator) return;

        text.textContent = 'Saved!';
        indicator.classList.add('visible', 'success');

        setTimeout(() => {
            indicator.classList.remove('visible', 'success');
        }, 2000);
    }

    // =========================================
    // INIT ON LOAD
    // =========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
