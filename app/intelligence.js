// ===== AI Intelligence Page =====
// Full-featured AI recommendations with filtering, stats, and one-click implementation
//
// BUSINESS MODEL NOTE: Royalty is visits-based loyalty, NOT purchases/payments.
// - Customers earn points by visiting (scanning QR codes), not by purchasing
// - No in-app sales or payment processing
// - Do NOT recommend product pricing, purchase incentives, or checkout-related features
// - Focus on: visits, engagement, retention, referrals, milestones, birthdays

const IntelligencePage = (function() {
    let organizationId = null;
    let currentUserId = null;
    let isAnalyzing = false;
    let allRecommendations = [];
    let currentFilter = 'all';
    let currentType = '';

    // Icons for recommendation types
    const typeIcons = {
        opportunity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
        efficiency: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        risk: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        growth: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
        automation: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    };

    // Type labels
    const typeLabels = {
        opportunity: 'Opportunity',
        efficiency: 'Efficiency',
        risk: 'Risk Alert',
        growth: 'Growth',
        automation: 'Automation'
    };

    // Impact labels
    const impactLabels = {
        high: 'High Impact',
        medium: 'Medium Impact',
        low: 'Low Impact'
    };

    // AI Recommendation Templates - loaded from shared/ai-templates.js
    const AI_TEMPLATES = window.AI_TEMPLATES;

    // Track created app for the banner
    let createdAppSlug = null;

    // Track if banner listeners are already attached (prevents listener leak)
    let bannerListenersAttached = false;

    // ===== SECURITY: Validate and sanitize onboarding data from localStorage =====
    // Prevents XSS via localStorage tampering
    function validateOnboardingData(rawData) {
        if (!rawData || typeof rawData !== 'string') {
            return { isValid: false, data: null };
        }

        try {
            const parsed = JSON.parse(rawData);

            // Validate structure
            if (typeof parsed !== 'object' || parsed === null) {
                return { isValid: false, data: null };
            }

            // Validate and sanitize businessPrompt (limit length, trim)
            let businessPrompt = '';
            if (typeof parsed.businessPrompt === 'string') {
                // Limit to 500 chars and trim
                businessPrompt = parsed.businessPrompt.trim().substring(0, 500);
            }

            // Validate context - only extract known safe fields (check both field names)
            let context = {};
            const ctxSource = parsed.context || parsed.businessContext || {};
            if (ctxSource && typeof ctxSource === 'object') {
                if (typeof ctxSource.industry === 'string') {
                    // Whitelist valid industries
                    const validIndustries = ['food', 'retail', 'health', 'service', 'technology', 'education', ''];
                    const industry = ctxSource.industry.trim().substring(0, 100);
                    context.industry = validIndustries.includes(industry) ? industry : '';
                }
            }

            // Validate selectedPlans array (check both field names for compat)
            let selectedPlans = [];
            const plansSource = parsed.selectedPlans || parsed.selectedTemplates || [];
            if (Array.isArray(plansSource)) {
                selectedPlans = plansSource
                    .filter(id => typeof id === 'string')
                    .map(id => id.trim().substring(0, 100))
                    .slice(0, 20);
            }

            // Validate businessDetails
            let businessDetails = {};
            if (parsed.businessDetails && typeof parsed.businessDetails === 'object') {
                if (typeof parsed.businessDetails.businessName === 'string') {
                    businessDetails.businessName = parsed.businessDetails.businessName.trim().substring(0, 200);
                }
                if (typeof parsed.businessDetails.businessType === 'string') {
                    businessDetails.businessType = parsed.businessDetails.businessType.trim().substring(0, 100);
                }
                if (typeof parsed.businessDetails.customerCount === 'string') {
                    businessDetails.customerCount = parsed.businessDetails.customerCount.trim().substring(0, 20);
                }
                if (typeof parsed.businessDetails.websiteUrl === 'string') {
                    businessDetails.websiteUrl = parsed.businessDetails.websiteUrl.trim().substring(0, 500);
                }
            }

            return { isValid: true, data: { businessPrompt, context, selectedPlans, businessDetails } };
        } catch (e) {
            console.error('Invalid onboarding data format:', e);
            return { isValid: false, data: null };
        }
    }

    // Initialize the page
    async function init() {
        // Get auth data
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            window.location.href = '/app/login.html';
            return;
        }
        currentUserId = user.id;

        // Get organization and user info
        const [memberResult, userInfoResult, orgResult] = await Promise.all([
            supabase
                .from('organization_members')
                .select('organization_id, role')
                .eq('user_id', user.id)
                .single(),
            supabase
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', user.id)
                .single(),
            supabase
                .from('organization_members')
                .select('organization_id, organizations(id, name)')
                .eq('user_id', user.id)
                .single()
        ]);

        const member = memberResult.data;
        if (!member) {
            window.location.href = '/app/dashboard.html';
            return;
        }

        organizationId = member.organization_id;
        const userInfo = userInfoResult.data;
        const orgData = orgResult.data;

        // Setup sidebar with proper data
        if (typeof AppSidebar !== 'undefined') {
            AppSidebar.init({
                name: userInfo ? `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim() || user.email : user.email,
                email: user.email,
                organization: orgData?.organizations || { name: 'My Organization' },
                role: member.role,
                isAdmin: (userInfo?.is_admin === true) || (userInfo?.profile?.is_admin === true)
            });
        }

        // Setup event listeners
        setupEventListeners();

        // Check for first login flow AFTER we have organizationId
        const urlParams = new URLSearchParams(window.location.search);
        const isFirstLogin = urlParams.get('firstLogin') === 'true' ||
                             localStorage.getItem('royalty_onboarding');

        if (isFirstLogin && organizationId) {
            // Clear the URL param
            history.replaceState(null, '', '/app/intelligence.html');
            await runFirstLoginFlow();
        } else {
            // Normal flow - load recommendations
            await loadRecommendations();
            updateStats();
        }

        // Initialize Crown 3D Dashboard (after auth + data loaded)
        const crownOptions = { organization: orgData?.organizations };
        if (typeof CrownDashboard !== 'undefined') {
            CrownDashboard.init(crownOptions);
        } else {
            // Module script may not have loaded yet — wait for it
            window.addEventListener('crown-ready', () => {
                if (typeof CrownDashboard !== 'undefined') {
                    CrownDashboard.init(crownOptions);
                }
            });
        }
    }

    // First login flow - show loading modal, create app, show banner
    async function runFirstLoginFlow() {
        const modal = document.getElementById('first-login-modal');
        if (!modal) return;

        // ===== QA FIX: Prevent duplicate app creation on refresh =====
        const inProgress = sessionStorage.getItem('royalty_app_creation_in_progress');
        if (inProgress === 'true') {
            return;
        }

        // Check if app already exists from onboarding (handles refresh after creation)
        try {
            const { data: existingApp } = await supabase
                .from('customer_apps')
                .select('id, slug')
                .eq('organization_id', organizationId)
                .filter('settings->>created_from', 'eq', 'onboarding')
                .limit(1)
                .single();

            if (existingApp) {
                createdAppSlug = existingApp.slug;
                localStorage.removeItem('royalty_onboarding');
                showAppReadyBanner();
                loadRecommendations();
                updateStats();
                return;
            }
        } catch (e) {
            // No existing app found, continue with creation
        }

        // Mark as in progress
        sessionStorage.setItem('royalty_app_creation_in_progress', 'true');

        // Show modal
        modal.style.display = 'flex';

        // Start particle animation
        const particleCleanup = initLoadingParticles();

        // Set context text from onboarding data
        const rawData = localStorage.getItem('royalty_onboarding');
        const { data: onboardingData } = validateOnboardingData(rawData);
        const contextEl = document.getElementById('loading-context-text');
        if (contextEl && onboardingData) {
            const planCount = onboardingData.selectedPlans?.length || 0;
            const bizName = onboardingData.businessDetails?.businessName || '';
            if (planCount > 0 && bizName) {
                contextEl.textContent = `Creating ${planCount} plan${planCount > 1 ? 's' : ''} for ${bizName}`;
            } else if (planCount > 0) {
                contextEl.textContent = `Setting up ${planCount} plan${planCount > 1 ? 's' : ''} for your business`;
            } else if (bizName) {
                contextEl.textContent = `Personalizing for ${bizName}`;
            }
        }

        const steps = modal.querySelectorAll('.step-item');
        const progressFill = document.getElementById('loading-progress-fill');
        const progressSteps = [20, 40, 60, 85, 100]; // percentage per step
        let appCreationResult = null;

        // Helper to update progress bar
        function setProgress(percent) {
            if (progressFill) progressFill.style.width = percent + '%';
        }

        // Animate through steps
        for (let i = 0; i < steps.length; i++) {
            // Shorter initial delay for steps with real async work; longer for cosmetic-only steps
            const delay = (i === 2 || i === 3) ? 400 : 800;
            await new Promise(r => setTimeout(r, delay));

            const currentIcon = steps[i].querySelector('.step-icon');

            // Step 3 (index 2): Create the loyalty app
            if (i === 2) {
                appCreationResult = await createLoyaltyAppFromOnboarding();

                if (!appCreationResult.success) {
                    currentIcon.classList.remove('pending', 'active');
                    currentIcon.classList.add('error');
                    if (particleCleanup) particleCleanup();
                    await new Promise(r => setTimeout(r, 500));
                    modal.style.display = 'none';
                    sessionStorage.removeItem('royalty_app_creation_in_progress');
                    showAppCreationError(appCreationResult.error);
                    return;
                }
            }

            // Step 4 (index 3): Create automations from selected plans
            if (i === 3 && appCreationResult?.success && appCreationResult.app) {
                await createAutomationsFromSelectedPlans(appCreationResult.app.id, onboardingData);
            }

            // Update progress bar
            setProgress(progressSteps[i] || 100);

            // Mark current step as complete
            currentIcon.classList.remove('pending', 'active');
            currentIcon.classList.add('complete');

            // Mark next step as active (if exists)
            if (i < steps.length - 1) {
                const nextIcon = steps[i + 1].querySelector('.step-icon');
                nextIcon.classList.remove('pending');
                nextIcon.classList.add('active');
            }
        }

        // Small delay before hiding modal
        await new Promise(r => setTimeout(r, 600));

        // Cleanup particles
        if (particleCleanup) particleCleanup();

        // Fade out modal
        modal.style.opacity = '0';
        await new Promise(r => setTimeout(r, 400));
        modal.style.display = 'none';

        // Clear flags and onboarding data
        sessionStorage.removeItem('royalty_app_creation_in_progress');
        localStorage.removeItem('royalty_onboarding');

        // Only show banner if app was created successfully
        if (appCreationResult?.success) {
            showAppReadyBanner();
            // Celebration!
            if (typeof celebrate === 'function') celebrate();
        }

        // Load recommendations in background
        loadRecommendations();
        updateStats();
    }

    // Create automations from the user's selected plans
    async function createAutomationsFromSelectedPlans(appId, onboardingData) {
        const selectedPlans = onboardingData?.selectedPlans || [];
        if (selectedPlans.length === 0) return;

        for (const planId of selectedPlans) {
            // Look up template info (templates-library.js is loaded globally)
            const template = (typeof getTemplateById === 'function') ? getTemplateById(planId) : null;
            if (!template) continue;

            try {
                await supabase.from('automations').insert({
                    organization_id: organizationId,
                    name: template.name,
                    description: template.description,
                    type: template.type || 'email',
                    trigger_type: 'schedule',
                    is_active: true,
                    settings: {
                        created_from: 'onboarding',
                        template_id: planId,
                        frequency: template.frequency || 'daily',
                        ...(template.config || {})
                    }
                });
            } catch (err) {
                console.error('Error creating automation for', planId, err);
            }
        }
    }

    // Lightweight canvas particle system for loading screen
    function initLoadingParticles() {
        const canvas = document.getElementById('loading-particles');
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        let animationId = null;
        let particles = [];
        const PARTICLE_COUNT = 40;

        function resize() {
            canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
            canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
            ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        }
        resize();
        window.addEventListener('resize', resize);

        // Initialize particles
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * canvas.offsetWidth,
                y: Math.random() * canvas.offsetHeight,
                radius: Math.random() * 2.5 + 0.5,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -(Math.random() * 0.4 + 0.1),
                alpha: Math.random() * 0.4 + 0.1
            });
        }

        function draw() {
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            ctx.clearRect(0, 0, w, h);

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;

                // Wrap around
                if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
                if (p.x < -10) p.x = w + 10;
                if (p.x > w + 10) p.x = -10;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
                ctx.fill();
            }

            animationId = requestAnimationFrame(draw);
        }
        draw();

        // Return cleanup function
        return function cleanup() {
            if (animationId) cancelAnimationFrame(animationId);
            window.removeEventListener('resize', resize);
            particles = [];
        };
    }

    // ===== ERROR HANDLING: Show error banner when app creation fails =====
    function showAppCreationError(errorMessage) {
        const container = document.querySelector('.app-main') || document.querySelector('main');
        if (!container) {
            alert(window.t ? window.t('errors.creatingApp') : 'Failed to create your loyalty app. Please try again.');
            return;
        }

        // Remove existing error banners
        container.querySelectorAll('.app-error-banner').forEach(el => el.remove());

        const banner = document.createElement('div');
        banner.className = 'app-error-banner';
        banner.innerHTML = `
            <div class="error-banner-content">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span data-i18n="intelligence.appCreationError">Failed to create your loyalty app</span>
                <button class="btn btn-secondary btn-sm" onclick="location.reload()">
                    <span data-i18n="common.tryAgain">Try Again</span>
                </button>
                <a href="/app/apps.html" class="btn btn-ghost btn-sm" data-i18n="intelligence.createManually">Create Manually</a>
            </div>
        `;

        container.insertBefore(banner, container.firstChild);

        // Apply translations if i18n is available
        if (typeof I18n !== 'undefined') {
            I18n.applyTranslations();
        }
    }

    // Create loyalty app from onboarding data
    // Returns: { success: boolean, app?: object, error?: string }
    async function createLoyaltyAppFromOnboarding() {
        // ===== SECURITY: Verify organizationId before any database operations =====
        if (!organizationId) {
            console.error('Cannot create app: organizationId is null');
            return { success: false, error: 'missing_org_id' };
        }

        // ===== SECURITY: Verify organization still exists and user has access =====
        try {
            const { data: orgCheck, error: orgError } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', currentUserId)
                .eq('organization_id', organizationId)
                .single();

            if (orgError || !orgCheck) {
                console.error('Organization verification failed:', orgError);
                return { success: false, error: 'org_verification_failed' };
            }
        } catch (verifyErr) {
            console.error('Error verifying organization:', verifyErr);
            return { success: false, error: 'org_verification_error' };
        }

        // ===== SECURITY: Use validated/sanitized onboarding data =====
        const rawData = localStorage.getItem('royalty_onboarding');
        const { isValid, data } = validateOnboardingData(rawData);

        let businessPrompt = '';
        let industry = '';
        let businessName = '';
        let selectedPlans = [];

        if (isValid && data) {
            businessPrompt = data.businessPrompt;
            industry = data.context?.industry || '';
            businessName = data.businessDetails?.businessName || '';
            selectedPlans = data.selectedPlans || [];
        }

        // Use business name from info-gathering, fall back to extraction from prompt
        const appName = businessName || (businessPrompt ? extractBusinessName(businessPrompt) : 'My Loyalty Program');

        // Generate a unique slug
        const slug = 'app-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

        // Create the app
        try {
            const { data: app, error } = await supabase
                .from('customer_apps')
                .insert({
                    organization_id: organizationId,
                    name: appName,
                    slug: slug,
                    app_type: 'loyalty',
                    description: businessPrompt || 'AI-powered loyalty program',
                    branding: {
                        primary_color: '#7c3aed',
                        secondary_color: '#a855f7',
                        logo_text: appName.charAt(0).toUpperCase() || 'R'
                    },
                    features: {
                        points: true,
                        tiers: true,
                        rewards: true,
                        referrals: true,
                        leaderboard: true
                    },
                    settings: {
                        points_per_visit: 10,
                        created_from: 'onboarding',
                        business_context: businessPrompt,
                        industry: industry,
                        selected_plans: selectedPlans,
                        business_details: data?.businessDetails || {}
                    },
                    ai_autonomy_mode: 'auto_pilot',
                    is_active: true
                })
                .select()
                .single();

            if (error) {
                return { success: false, error: error.message };
            }

            createdAppSlug = app.slug;

            // Create default rewards (non-blocking error)
            await createDefaultRewards(app.id);

            return { success: true, app };

        } catch (err) {
            return { success: false, error: err.message || 'Unknown error' };
        }
    }

    // Extract business name from prompt
    function extractBusinessName(prompt) {
        // Look for patterns like "I run a X" or "my X"
        const patterns = [
            /i (?:run|own|have|manage) (?:a |an )?([^.,:]+)/i,
            /my ([^.,:]+)/i,
            /(?:a |an )?([^.,:]+) (?:in|based|located)/i
        ];

        for (const pattern of patterns) {
            const match = prompt.match(pattern);
            if (match && match[1]) {
                // Clean up and capitalize
                let name = match[1].trim();
                if (name.length > 50) name = name.substring(0, 47) + '...';
                return name.charAt(0).toUpperCase() + name.slice(1);
            }
        }

        return 'My Loyalty Program';
    }

    // Create default rewards for the app
    async function createDefaultRewards(appId) {
        const defaultRewards = [
            { name: 'Free Item', description: 'Redeem for a free item of your choice', points_cost: 100, tier_required: 'bronze' },
            { name: '10% Off', description: 'Get 10% off your next visit', points_cost: 50, tier_required: 'bronze' },
            { name: 'VIP Treatment', description: 'Special VIP experience', points_cost: 250, tier_required: 'silver' },
            { name: 'Birthday Bonus', description: 'Double points on your birthday', points_cost: 0, tier_required: 'bronze' }
        ];

        try {
            await supabase
                .from('app_rewards')
                .insert(defaultRewards.map(r => ({
                    ...r,
                    app_id: appId,
                    is_active: true
                })));
        } catch (err) {
            console.error('Error creating default rewards:', err);
        }
    }

    // Show the app ready banner
    function showAppReadyBanner() {
        const banner = document.getElementById('app-ready-banner');
        if (!banner) return;

        banner.style.display = 'flex';

        // Set preview link
        const previewBtn = document.getElementById('preview-app-btn');
        if (previewBtn && createdAppSlug) {
            previewBtn.href = `/customer-app/index.html?app=${createdAppSlug}`;
        }

        // Set test app link (opens customer-facing app)
        const testBtn = document.getElementById('test-app-btn');
        if (testBtn && createdAppSlug) {
            testBtn.href = `/a/${createdAppSlug}`;
        }

        // Show automation count stats
        const statsEl = document.getElementById('app-ready-stats');
        if (statsEl) {
            // Count automations created from onboarding
            supabase.from('automations')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .filter('settings->>created_from', 'eq', 'onboarding')
                .then(({ count }) => {
                    if (count && count > 0) {
                        statsEl.textContent = `${count} automation${count > 1 ? 's' : ''} activated`;
                        statsEl.style.display = 'block';
                    }
                });
        }

        // ===== CODE QUALITY FIX: Only attach listeners once (prevents listener leak) =====
        if (bannerListenersAttached) return;
        bannerListenersAttached = true;

        // Use event delegation on banner container
        banner.addEventListener('click', async (event) => {
            const saveBtn = event.target.closest('#save-autonomy-btn');
            if (!saveBtn) return;

            // ===== QA FIX: Double-click prevention =====
            if (saveBtn.disabled) return;
            saveBtn.disabled = true;

            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

            try {
                const selectedMode = document.querySelector('input[name="autonomy"]:checked')?.value || 'auto_pilot';

                // Update the app
                if (createdAppSlug) {
                    const { error } = await supabase
                        .from('customer_apps')
                        .update({ ai_autonomy_mode: selectedMode })
                        .eq('slug', createdAppSlug);

                    if (error) throw error;
                }

                // Success - close banner with celebration
                if (typeof celebrate === 'function') {
                    celebrate();
                }

                banner.style.opacity = '0';
                setTimeout(() => {
                    banner.style.display = 'none';
                    banner.style.opacity = '1';
                }, 300);

            } catch (err) {
                console.error('Error saving autonomy mode:', err);
                // Re-enable button on error
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        });
    }

    // Setup event listeners
    function setupEventListeners() {
        // Analyze button
        const analyzeBtn = document.getElementById('analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', handleAnalyze);
        }

        // Empty state analyze button
        const emptyAnalyzeBtn = document.getElementById('empty-analyze-btn');
        if (emptyAnalyzeBtn) {
            emptyAnalyzeBtn.addEventListener('click', handleAnalyze);
        }

        // Filter tabs
        const filterTabs = document.querySelectorAll('.filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentFilter = tab.dataset.filter;
                renderFilteredRecommendations();
            });
        });

        // Type filter dropdown
        const typeFilter = document.getElementById('type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                currentType = typeFilter.value;
                renderFilteredRecommendations();
            });
        }

        // Event delegation for recommendation actions
        const recommendationsList = document.getElementById('recommendations-list');
        if (recommendationsList) {
            recommendationsList.addEventListener('click', handleRecommendationAction);
        }
    }

    // Load recommendations from database
    async function loadRecommendations() {
        if (!organizationId) return;

        showLoading();

        try {
            // Try RPC first
            const { data, error } = await supabase.rpc('get_pending_recommendations', {
                org_id: organizationId,
                limit_count: 100
            });

            if (error) {
                // Fallback to direct query
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('ai_recommendations')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .order('created_at', { ascending: false })
                    .limit(100);

                if (!fallbackError && fallbackData) {
                    allRecommendations = fallbackData;
                } else {
                    allRecommendations = [];
                }
            } else {
                // RPC only returns pending, get all for this page
                const { data: allData } = await supabase
                    .from('ai_recommendations')
                    .select('*')
                    .eq('organization_id', organizationId)
                    .order('created_at', { ascending: false })
                    .limit(100);

                allRecommendations = allData || [];
            }

            renderFilteredRecommendations();
            updateStats();

            // Notify Crown Dashboard of loaded recommendations
            document.dispatchEvent(new CustomEvent('crown:recommendations-loaded', {
                detail: { recommendations: allRecommendations }
            }));
        } catch (err) {
            allRecommendations = [];
            showEmptyState();
        }
    }

    // Render recommendations based on current filters
    function renderFilteredRecommendations() {
        let filtered = [...allRecommendations];

        // Apply status filter
        if (currentFilter !== 'all') {
            filtered = filtered.filter(rec => rec.status === currentFilter);
        }

        // Apply type filter
        if (currentType) {
            filtered = filtered.filter(rec => rec.recommendation_type === currentType);
        }

        // Sort by impact (high first), then by confidence
        filtered.sort((a, b) => {
            const impactOrder = { high: 0, medium: 1, low: 2 };
            const aImpact = impactOrder[a.potential_impact] ?? 1;
            const bImpact = impactOrder[b.potential_impact] ?? 1;
            if (aImpact !== bImpact) return aImpact - bImpact;
            return (b.confidence_score || 0) - (a.confidence_score || 0);
        });

        renderRecommendations(filtered);
    }

    // Render recommendations
    function renderRecommendations(recommendations) {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'none';

        if (!recommendations || recommendations.length === 0) {
            if (empty) empty.style.display = 'block';
            if (list) list.style.display = 'none';
            return;
        }

        if (empty) empty.style.display = 'none';
        if (list) {
            list.style.display = 'flex';
            list.innerHTML = recommendations.map(renderRecommendationCard).join('');
        }
    }

    // Render a single recommendation card
    function renderRecommendationCard(rec) {
        const type = rec.recommendation_type || 'opportunity';
        const impact = rec.potential_impact || 'medium';
        const status = rec.status || 'pending';
        const confidence = rec.confidence_score || 0.8;
        const confidencePercent = Math.round(confidence * 100);
        const payload = rec.action_payload || {};
        const createdAt = new Date(rec.created_at).toLocaleDateString();

        // Get what will be created
        const template = AI_TEMPLATES[payload.template_id] || {};
        const willCreate = template.projectName
            ? `<strong>Will create:</strong> "${template.projectName}" project with "${template.automation?.name}" automation`
            : '';

        // Status badge
        let statusBadge = '';
        if (status === 'implemented') {
            statusBadge = '<span class="status-badge implemented"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Implemented</span>';
        } else if (status === 'dismissed') {
            statusBadge = '<span class="status-badge dismissed">Dismissed</span>';
        }

        // Action buttons based on status
        let actionButtons = '';
        if (status === 'pending') {
            actionButtons = `
                <button class="btn btn-primary" data-action="implement" data-id="${rec.id}" data-payload='${JSON.stringify(payload).replace(/'/g, "&#39;")}'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Accept & Create
                </button>
                <button class="btn btn-ghost" data-action="dismiss" data-id="${rec.id}">
                    Dismiss
                </button>
            `;
        } else if (status === 'implemented') {
            actionButtons = `
                <button class="btn btn-success" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Implemented
                </button>
            `;
        }

        return `
            <div class="recommendation-card ${status}" data-recommendation-id="${rec.id}">
                <div class="recommendation-header">
                    <div class="recommendation-meta">
                        <div class="recommendation-type-icon ${type}">
                            ${typeIcons[type] || typeIcons.opportunity}
                        </div>
                        <div class="recommendation-type-info">
                            <span class="recommendation-type-label ${type}">${typeLabels[type] || 'Insight'}</span>
                            <span class="recommendation-date">${createdAt}</span>
                        </div>
                    </div>
                    <div class="recommendation-impact ${impact}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                        </svg>
                        ${impactLabels[impact]}
                        ${statusBadge}
                    </div>
                </div>
                <h3 class="recommendation-title">${AppUtils.escapeHtml(rec.title)}</h3>
                <p class="recommendation-description">${AppUtils.escapeHtml(rec.description)}</p>
                ${willCreate ? `<div class="recommendation-will-create">${willCreate}</div>` : ''}
                <div class="recommendation-footer">
                    <div class="recommendation-actions">
                        ${actionButtons}
                    </div>
                    <div class="recommendation-confidence">
                        <span>Confidence</span>
                        <div class="confidence-bar-lg">
                            <div class="confidence-fill-lg" style="width: ${confidencePercent}%"></div>
                        </div>
                        <span>${confidencePercent}%</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Update stats display
    function updateStats() {
        const pending = allRecommendations.filter(r => r.status === 'pending').length;
        const implemented = allRecommendations.filter(r => r.status === 'implemented').length;
        const highImpact = allRecommendations.filter(r => r.status === 'pending' && r.potential_impact === 'high').length;

        const statPending = document.getElementById('stat-pending');
        const statImplemented = document.getElementById('stat-implemented');
        const statHighImpact = document.getElementById('stat-high-impact');
        const statLastAnalysis = document.getElementById('stat-last-analysis');

        if (statPending) statPending.textContent = pending;
        if (statImplemented) statImplemented.textContent = implemented;
        if (statHighImpact) statHighImpact.textContent = highImpact;

        // Get last analysis time
        if (statLastAnalysis && allRecommendations.length > 0) {
            const latest = allRecommendations.reduce((a, b) =>
                new Date(a.created_at) > new Date(b.created_at) ? a : b
            );
            const date = new Date(latest.created_at);
            const now = new Date();
            const diffMs = now - date;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffHours / 24);

            if (diffHours < 1) {
                statLastAnalysis.textContent = 'Just now';
            } else if (diffHours < 24) {
                statLastAnalysis.textContent = `${diffHours}h ago`;
            } else if (diffDays === 1) {
                statLastAnalysis.textContent = 'Yesterday';
            } else if (diffDays < 7) {
                statLastAnalysis.textContent = `${diffDays}d ago`;
            } else {
                statLastAnalysis.textContent = date.toLocaleDateString();
            }
        }
    }

    // Show loading state
    function showLoading() {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'block';
        if (empty) empty.style.display = 'none';
        if (list) list.style.display = 'none';
    }

    // Show empty state
    function showEmptyState() {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');

        if (loading) loading.style.display = 'none';
        if (empty) empty.style.display = 'block';
        if (list) list.style.display = 'none';
    }

    // Show upgrade state
    function showUpgradeState(used, limit, isFreePlan) {
        const loading = document.getElementById('intelligence-loading');
        const empty = document.getElementById('intelligence-empty');
        const list = document.getElementById('recommendations-list');
        const upgrade = document.getElementById('intelligence-upgrade');

        if (loading) loading.style.display = 'none';
        if (empty) empty.style.display = 'none';
        if (list) list.style.display = 'none';
        if (upgrade) {
            upgrade.style.display = 'block';

            // Update title and description based on plan type
            const title = document.getElementById('upgrade-title');
            const desc = document.getElementById('upgrade-desc');
            const usageDiv = document.getElementById('upgrade-usage');
            const usageCount = document.getElementById('usage-count');

            if (isFreePlan) {
                if (title) title.textContent = 'Unlock AI Intelligence';
                if (desc) desc.textContent = 'Get AI-powered insights to grow your loyalty program. Upgrade to access smart recommendations.';
                if (usageDiv) usageDiv.style.display = 'none';
            } else {
                if (title) title.textContent = 'Monthly Limit Reached';
                if (desc) desc.textContent = 'You\'ve used all your AI insights for this month. Upgrade for more or wait until next month.';
                if (usageDiv) usageDiv.style.display = 'inline-flex';
                if (usageCount) usageCount.textContent = `${used} / ${limit} insights used`;
            }
        }
    }

    // Handle analyze button
    async function handleAnalyze() {
        if (isAnalyzing) return;

        const analyzeBtn = document.getElementById('analyze-btn');
        if (!analyzeBtn) return;

        // Check if user can use intelligence
        if (typeof canUseIntelligence === 'function') {
            const canUse = await canUseIntelligence(organizationId);
            if (!canUse.allowed) {
                showUpgradeState(canUse.used || 0, canUse.limit || 0, canUse.limit === 0);
                return;
            }
        }

        isAnalyzing = true;
        const originalContent = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
        analyzeBtn.disabled = true;

        // Notify Crown Dashboard
        document.dispatchEvent(new Event('crown:analyzing'));

        showLoading();

        try {
            // Gather data
            const analysisData = await gatherAnalysisData();

            // Generate recommendations
            const recommendations = await generateRecommendations(analysisData);

            // Save to database
            if (recommendations.length > 0) {
                await saveRecommendations(recommendations);
            }

            // Reload
            await loadRecommendations();

            // Celebrate
            if (recommendations.length > 0 && typeof celebrate === 'function') {
                celebrate();
            }

            // Notify Crown Dashboard — analysis complete
            document.dispatchEvent(new CustomEvent('crown:analyzed', {
                detail: { recommendations: allRecommendations }
            }));

        } catch (error) {
            console.error('Error analyzing business:', error);
            alert(window.t ? window.t('errors.analyzingBusiness') : 'Error analyzing business data. Please try again.');
            showEmptyState();
        } finally {
            isAnalyzing = false;
            analyzeBtn.innerHTML = originalContent;
            analyzeBtn.disabled = false;
        }
    }

    // Gather organization data for analysis
    async function gatherAnalysisData() {
        const data = {
            customers: { total: 0, recent: 0, bySource: {} },
            projects: { total: 0, byIndustry: {}, list: [] },
            automations: { total: 0, active: 0, byType: {}, byTemplate: {} }
        };

        try {
            // Get customer stats
            const { count: totalCustomers } = await supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null);

            data.customers.total = totalCustomers || 0;

            // Recent customers (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { count: recentCustomers } = await supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .is('deleted_at', null)
                .gte('created_at', thirtyDaysAgo.toISOString());

            data.customers.recent = recentCustomers || 0;

            // Get project stats
            const { data: projects } = await supabase
                .from('projects')
                .select('id, name, industry')
                .eq('organization_id', organizationId)
                .is('deleted_at', null);

            data.projects.total = projects?.length || 0;
            data.projects.list = projects || [];
            if (projects) {
                projects.forEach(p => {
                    const industry = p.industry || 'unset';
                    data.projects.byIndustry[industry] = (data.projects.byIndustry[industry] || 0) + 1;
                });
            }

            // Get automation stats
            if (projects && projects.length > 0) {
                const projectIds = projects.map(p => p.id);
                const { data: automations } = await supabase
                    .from('automations')
                    .select('id, type, is_active, template_id')
                    .in('project_id', projectIds)
                    .is('deleted_at', null);

                data.automations.total = automations?.length || 0;
                if (automations) {
                    automations.forEach(a => {
                        if (a.is_active) data.automations.active++;
                        const type = a.type || 'other';
                        data.automations.byType[type] = (data.automations.byType[type] || 0) + 1;
                        if (a.template_id) {
                            data.automations.byTemplate[a.template_id] = true;
                        }
                    });
                }
            }

        } catch (error) {
            console.error('Error gathering analysis data:', error);
        }

        return data;
    }

    // Generate recommendations
    async function generateRecommendations(data) {
        const recommendations = [];
        const hasTemplate = (id) => data.automations.byTemplate[id];

        // Priority 1: No automations - suggest welcome series
        if (data.automations.total === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'automation',
                title: 'Start with a Welcome Email Series',
                description: `You have ${data.customers.total || 'no'} customers but no automations. A welcome series is the foundation - it engages new customers from day one and sets the tone for your relationship.`,
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Create a welcome email automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'welcome-email' }
            });
        }

        // Suggest follow-up
        if (!hasTemplate('post-visit-follow-up') && data.customers.total > 5) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'efficiency',
                title: 'Automate Post-Visit Follow-ups',
                description: `With ${data.customers.total} customers, manual follow-ups don't scale. Automated follow-ups after visits increase repeat business by 23% on average.`,
                confidence_score: 0.88,
                potential_impact: 'high',
                suggested_action: 'Create a follow-up automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'follow-up' }
            });
        }

        // Suggest win-back
        if (!hasTemplate('win-back-campaign') && data.customers.total > 20) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Win Back Inactive Customers',
                description: `Some of your ${data.customers.total} customers likely haven't engaged recently. A win-back campaign can recover 5-15% of churned customers with minimal effort.`,
                confidence_score: 0.85,
                potential_impact: 'medium',
                suggested_action: 'Create a win-back campaign',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 're-engagement' }
            });
        }

        // Suggest birthday rewards
        if (!hasTemplate('birthday-rewards') && data.customers.total > 10) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Celebrate Customer Birthdays',
                description: `Birthday messages have 481% higher engagement rates than regular communications. With ${data.customers.total} customers, this builds lasting loyalty.`,
                confidence_score: 0.90,
                potential_impact: 'high',
                suggested_action: 'Create birthday rewards automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'birthday' }
            });
        }

        // Suggest reviews
        if (!hasTemplate('review-request') && data.customers.total > 15) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Build Your Online Reputation',
                description: 'Automated review requests at the right moment dramatically increase your review count. More reviews = more trust = more customers.',
                confidence_score: 0.82,
                potential_impact: 'medium',
                suggested_action: 'Create review request automation',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'review-request' }
            });
        }

        // Suggest newsletter
        if (!hasTemplate('monthly-newsletter') && data.customers.total > 50) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Start a Monthly Newsletter',
                description: `${data.customers.total} customers is a valuable audience. A monthly newsletter keeps you top-of-mind and drives consistent engagement.`,
                confidence_score: 0.78,
                potential_impact: 'medium',
                suggested_action: 'Create monthly newsletter',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'newsletter' }
            });
        }

        // Suggest loyalty program
        if (!hasTemplate('loyalty-program') && data.customers.total > 100) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'growth',
                title: 'Launch a Loyalty Program',
                description: 'With over 100 customers, a loyalty program can increase customer lifetime value by 30%. Reward your best customers automatically.',
                confidence_score: 0.80,
                potential_impact: 'high',
                suggested_action: 'Create loyalty program',
                action_type: 'create_project_with_automation',
                action_payload: { template_id: 'loyalty' }
            });
        }

        // Check for inactive automations
        if (data.automations.total > 0 && data.automations.active === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'risk',
                title: 'Your Automations Are Inactive',
                description: `You have ${data.automations.total} automations but none are active. Review and activate them to start seeing results.`,
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Review automations',
                action_type: 'navigate',
                action_payload: { url: '/app/automations.html' }
            });
        }

        // No customers
        if (data.customers.total === 0) {
            recommendations.push({
                organization_id: organizationId,
                recommendation_type: 'opportunity',
                title: 'Import Your Customer Data',
                description: 'Get started by importing your existing customers. This enables all AI-powered features and personalized recommendations.',
                confidence_score: 0.95,
                potential_impact: 'high',
                suggested_action: 'Go to Customers',
                action_type: 'navigate',
                action_payload: { url: '/app/customers.html' }
            });
        }

        return recommendations.slice(0, 10);
    }

    // Save recommendations
    async function saveRecommendations(recommendations) {
        try {
            const { error } = await supabase
                .from('ai_recommendations')
                .insert(recommendations);

            if (error) {
                console.error('Error saving recommendations:', error);
            }
        } catch (err) {
            console.log('Could not save recommendations:', err);
        }
    }

    // Handle recommendation action clicks
    async function handleRecommendationAction(event) {
        const button = event.target.closest('[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const recId = button.dataset.id;

        switch (action) {
            case 'dismiss':
                await dismissRecommendation(recId);
                break;
            case 'implement':
                const payloadStr = button.dataset.payload;
                const payload = payloadStr ? JSON.parse(payloadStr.replace(/&#39;/g, "'")) : {};
                await implementRecommendation(recId, payload);
                break;
        }
    }

    // Dismiss recommendation
    async function dismissRecommendation(recId) {
        try {
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'dismissed',
                    dismissed_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Update local data
            const rec = allRecommendations.find(r => r.id === recId);
            if (rec) {
                rec.status = 'dismissed';
                rec.dismissed_at = new Date().toISOString();
            }

            // Re-render
            renderFilteredRecommendations();
            updateStats();

        } catch (err) {
            console.error('Error dismissing recommendation:', err);
        }
    }

    // Implement recommendation - THE MAGIC
    async function implementRecommendation(recId, payload) {
        const card = document.querySelector(`[data-recommendation-id="${recId}"]`);
        const button = card?.querySelector('[data-action="implement"]');

        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="spinner"></span> Creating...';
        }

        try {
            // Handle navigation
            if (payload.url) {
                window.location.href = payload.url;
                return;
            }

            // Get template
            const template = AI_TEMPLATES[payload.template_id];
            if (!template) {
                alert(window.t ? window.t('errors.templateNotFound') : 'Template not found. Please try again.');
                return;
            }

            // CREATE PROJECT
            const { data: project, error: projectError } = await supabase
                .from('projects')
                .insert({
                    organization_id: organizationId,
                    name: template.projectName,
                    description: template.projectDesc,
                    settings: { created_from: 'ai_recommendation', recommendation_id: recId }
                })
                .select()
                .single();

            if (projectError) {
                console.error('Error creating project:', projectError);
                alert(window.t ? window.t('errors.creatingProject') : 'Error creating project. Please try again.');
                return;
            }

            // CREATE AUTOMATION
            const { data: automation, error: automationError } = await supabase
                .from('automations')
                .insert({
                    project_id: project.id,
                    name: template.automation.name,
                    description: template.automation.description,
                    type: template.automation.type,
                    frequency: template.automation.frequency,
                    icon: template.automation.icon,
                    template_id: template.automation.template_id,
                    is_active: false,
                    settings: { created_from: 'ai_recommendation' }
                })
                .select()
                .single();

            if (automationError) {
                console.error('Error creating automation:', automationError);
            }

            // Mark as implemented
            await supabase
                .from('ai_recommendations')
                .update({
                    status: 'implemented',
                    implemented_at: new Date().toISOString()
                })
                .eq('id', recId);

            // Log audit
            if (typeof AuditLog !== 'undefined') {
                AuditLog.logProjectCreate(organizationId, project);
            }

            // Celebrate!
            if (typeof celebrate === 'function') {
                celebrate();
            }

            // Notify Crown Dashboard
            document.dispatchEvent(new CustomEvent('crown:implemented', {
                detail: { name: template?.automation?.name || payload?.title || 'Recommendation', recId }
            }));

            // Show success
            if (card) {
                card.style.background = 'rgba(16, 185, 129, 0.1)';
                if (button) {
                    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Created!';
                    button.classList.remove('btn-primary');
                    button.classList.add('btn-success');
                }
            }

            // Navigate
            setTimeout(() => {
                if (automation) {
                    window.location.href = `/app/automation.html#${automation.id}`;
                } else {
                    window.location.href = `/app/project.html#${project.id}`;
                }
            }, 800);

        } catch (err) {
            console.error('Error implementing recommendation:', err);
            alert(window.t ? window.t('errors.creatingProject') : 'Error creating project. Please try again.');

            if (button) {
                button.disabled = false;
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Accept & Create';
            }
        }
    }

    // Public API
    return {
        init
    };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    IntelligencePage.init();
});
