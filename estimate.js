/**
 * EstimatePage — Multi-step wizard for custom app cost estimation
 * IIFE pattern matching existing Automata codebase conventions
 * Fully translatable via i18n system (window.t / I18n.applyTranslations)
 */
const EstimatePage = (function () {
    // ===== i18n Helper =====
    // Returns translated string or English fallback if i18n hasn't loaded yet
    function tt(key, fallback) {
        if (window.t) {
            const val = window.t(key);
            if (val !== key) return val;
        }
        return fallback;
    }

    // HTML-escape user input to prevent XSS in innerHTML
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== State =====
    let currentStep = 1;
    const totalSteps = 4;
    let selections = {
        appType: null,
        features: {},
        addOns: [],
        scale: null,
        design: 'standard',
        notes: ''
    };

    // ===== App Type Config =====
    const APP_TYPES = [
        { id: 'loyalty', icon: '&#128081;', colorClass: 'loyalty' },
        { id: 'rewards', icon: '&#127873;', colorClass: 'rewards' },
        { id: 'membership', icon: '&#11088;', colorClass: 'membership' },
        { id: 'blog', icon: '&#128240;', colorClass: 'blog' },
        { id: 'social', icon: '&#127880;', colorClass: 'social' },
        { id: 'custom', icon: '&#128736;', colorClass: 'custom' }
    ];

    // Default English names/descriptions (used as fallback when i18n not loaded)
    const APP_TYPE_DEFAULTS = {
        loyalty: { name: 'Loyalty Program', desc: 'Points, rewards, tiers, referrals. Keep customers coming back.' },
        rewards: { name: 'Rewards App', desc: 'Points + rewards catalog, referral program, announcements.' },
        membership: { name: 'Membership Club', desc: 'VIP tiers, exclusive perks, member profiles.' },
        blog: { name: 'Blog / Newsletter', desc: 'Articles, subscriber signup, content series.' },
        social: { name: 'Social / Nightlife', desc: 'Map view, video feed, venue search, categories.' },
        custom: { name: 'Something Custom', desc: 'Tell us what you need. We\'ll figure it out together.' }
    };

    // ===== Feature Config (mirrors app-builder.js APP_TYPE_FEATURES) =====
    const FEATURES_BY_TYPE = {
        loyalty: [
            { id: 'points_enabled', icon: '&#127775;', checked: true },
            { id: 'leaderboard_enabled', icon: '&#127942;', checked: true },
            { id: 'rewards_enabled', icon: '&#127873;', checked: true },
            { id: 'menu_enabled', icon: '&#127860;', checked: false },
            { id: 'announcements_enabled', icon: '&#128227;', checked: true },
            { id: 'referrals_enabled', icon: '&#128101;', checked: false }
        ],
        rewards: [
            { id: 'points_enabled', icon: '&#127775;', checked: true },
            { id: 'rewards_enabled', icon: '&#127873;', checked: true },
            { id: 'leaderboard_enabled', icon: '&#127942;', checked: false },
            { id: 'referrals_enabled', icon: '&#128101;', checked: true },
            { id: 'announcements_enabled', icon: '&#128227;', checked: true }
        ],
        membership: [
            { id: 'tiers_enabled', icon: '&#128081;', checked: true },
            { id: 'points_enabled', icon: '&#127775;', checked: true },
            { id: 'rewards_enabled', icon: '&#127873;', checked: true },
            { id: 'profile_public', icon: '&#128100;', checked: false },
            { id: 'announcements_enabled', icon: '&#128227;', checked: true }
        ],
        blog: [
            { id: 'articles_enabled', icon: '&#128240;', checked: true },
            { id: 'series_enabled', icon: '&#128218;', checked: true },
            { id: 'topics_enabled', icon: '&#127991;', checked: true },
            { id: 'subscriber_signup', icon: '&#128231;', checked: true },
            { id: 'comments_enabled', icon: '&#128172;', checked: false }
        ],
        social: [
            { id: 'map_enabled', icon: '&#128205;', checked: true },
            { id: 'feed_enabled', icon: '&#127909;', checked: true },
            { id: 'search_enabled', icon: '&#128269;', checked: true },
            { id: 'categories_enabled', icon: '&#127991;', checked: true },
            { id: 'ugc_enabled', icon: '&#128247;', checked: false }
        ],
        custom: [] // Built dynamically as superset
    };

    // Default English feature names/descriptions (fallback)
    const FEATURE_DEFAULTS = {
        points_enabled: { name: 'Points System', desc: 'Customers earn points on visits or purchases' },
        leaderboard_enabled: { name: 'Leaderboard', desc: 'Show top customers and rankings' },
        rewards_enabled: { name: 'Rewards Catalog', desc: 'Let customers redeem points for prizes' },
        menu_enabled: { name: 'Menu Browser', desc: 'Show your products or services' },
        announcements_enabled: { name: 'Announcements', desc: 'Share updates and promotions' },
        referrals_enabled: { name: 'Referrals', desc: 'Let customers invite friends for bonus points' },
        tiers_enabled: { name: 'Membership Tiers', desc: 'VIP levels with exclusive perks' },
        profile_public: { name: 'Public Profiles', desc: 'Members can view each other' },
        articles_enabled: { name: 'Blog Articles', desc: 'Publish articles and posts' },
        series_enabled: { name: 'Article Series', desc: 'Group related articles together' },
        topics_enabled: { name: 'Categories & Topics', desc: 'Organize content by category' },
        subscriber_signup: { name: 'Subscriber Signup', desc: 'Collect email subscribers' },
        comments_enabled: { name: 'Comments', desc: 'Allow readers to comment' },
        map_enabled: { name: 'Map View', desc: 'Interactive map with venue pins' },
        feed_enabled: { name: 'Video Feed', desc: 'Instagram-style video scroll' },
        search_enabled: { name: 'Venue Search', desc: 'Search and filter venues' },
        categories_enabled: { name: 'Categories', desc: 'Filter by venue type' },
        ugc_enabled: { name: 'User Uploads', desc: 'Patrons can upload videos' }
    };

    // Build custom superset from all types
    (function buildCustomSuperset() {
        const seen = new Set();
        const superset = [];
        for (const type of Object.keys(FEATURES_BY_TYPE)) {
            if (type === 'custom') continue;
            for (const f of FEATURES_BY_TYPE[type]) {
                if (!seen.has(f.id)) {
                    seen.add(f.id);
                    superset.push({ ...f, checked: false });
                }
            }
        }
        FEATURES_BY_TYPE.custom = superset;
    })();

    // ===== Add-on Features (available for all types) =====
    const ADD_ONS = [
        { id: 'ai_dashboard', icon: '&#129504;', checked: false, premium: true },
        { id: 'email_campaigns', icon: '&#128231;', checked: false },
        { id: 'sms_campaigns', icon: '&#128241;', checked: false },
        { id: 'ai_automations', icon: '&#9889;', checked: false, premium: true },
        { id: 'white_label', icon: '&#127912;', checked: false, premium: true },
        { id: 'api_access', icon: '&#128268;', checked: false, premium: true }
    ];

    // Default English addon names/descriptions (fallback)
    const ADDON_DEFAULTS = {
        ai_dashboard: { name: 'AI Intelligence Dashboard', desc: 'Deep analytics powered by AI' },
        email_campaigns: { name: 'Email Campaigns', desc: 'SendGrid-powered email marketing' },
        sms_campaigns: { name: 'SMS Campaigns', desc: 'Twilio-powered text messaging' },
        ai_automations: { name: 'AI Automations', desc: 'Win-back, birthday, streak campaigns' },
        white_label: { name: 'Custom Branding / White-label', desc: 'Remove Royalty branding, use yours' },
        api_access: { name: 'API Access', desc: 'Programmatic access to your data' }
    };

    // ===== Pricing Config (Commitment-Based) =====
    const PRICING = {
        commitment: {
            standard:   { buildPhase: 499, afterCommitment: 299, months: 12, postTier: 'Pro' },
            custom:     { buildPhase: 749, afterCommitment: 299, months: 12, postTier: 'Pro' },
            complex:    { buildPhase: 999, afterCommitment: 749, months: 12, postTier: 'Max' },
            enterprise: { buildPhase: null, afterCommitment: null, months: null, postTier: 'Enterprise' }
        },
        platformIncludesDefaults: [
            'AI Intelligence Dashboard',
            'Automations & campaigns',
            'Analytics & business learning',
            'Hosting, updates & security',
            'Priority support during build phase',
            'Unlimited revisions (first 3 months)'
        ],
        timelineDefaults: {
            standard: '1-2 weeks',
            custom: '2-3 weeks',
            premium: '3-5 weeks',
            customType: '4-6 weeks'
        }
    };

    // ===== Platform Value Comparison (DIY vs Royalty) =====
    const PLATFORM_VALUE = {
        diy: {
            yearOneCost: '$40,000 - $80,000+',
            yearOneCostNote: 'dev + hosting + APIs + maintenance + security',
            itemDefaults: [
                '3-6 months to MVP',
                '$15K-$40K upfront development',
                'You handle security & compliance',
                'Build every integration from scratch',
                'You maintain servers & updates',
                'Build your own analytics'
            ]
        },
        royalty: {
            yearOneCostNote: 'platform + support + updates',
            itemDefaults: [
                '2-5 weeks to launch',
                'All-inclusive monthly pricing',
                'Enterprise-grade security included',
                'Twilio, SendGrid, AI pre-integrated',
                'We handle hosting & updates',
                'AI Intelligence Dashboard built-in'
            ]
        },
        detailDefaults: {
            security: {
                title: 'Security & Hardening',
                items: [
                    'OWASP top-10 vulnerability protection',
                    'Automated dependency scanning',
                    'SSL/TLS encryption everywhere',
                    'Rate limiting & DDoS protection',
                    'Regular security patches & updates'
                ]
            },
            integrations: {
                title: 'Production Integrations',
                items: [
                    'Twilio \u2014 SMS campaigns & notifications',
                    'SendGrid \u2014 Email marketing at scale',
                    'Anthropic AI \u2014 Intelligence & automations',
                    'Supabase \u2014 Database, auth & real-time',
                    'Stripe-ready \u2014 Payments when you need them'
                ]
            },
            intelligence: {
                title: 'AI Intelligence',
                items: [
                    'Business learning engine',
                    'Customer behavior analysis',
                    'Automated win-back & birthday campaigns',
                    'Predictive analytics & scoring',
                    'Natural language queries (Royal AI)'
                ]
            },
            operations: {
                title: 'Operations',
                items: [
                    'Global CDN hosting',
                    'Automatic platform updates',
                    'Database backups & recovery',
                    'Uptime monitoring & alerts',
                    'Priority support during build phase'
                ]
            }
        }
    };

    // ===== i18n Resolvers =====

    function getFeatureName(featureId) {
        const defaults = FEATURE_DEFAULTS[featureId] || { name: featureId };
        return tt(`estimate.features.${featureId}.name`, defaults.name);
    }

    function getFeatureDesc(featureId) {
        const defaults = FEATURE_DEFAULTS[featureId] || { desc: '' };
        return tt(`estimate.features.${featureId}.desc`, defaults.desc);
    }

    function getAddonName(addonId) {
        const defaults = ADDON_DEFAULTS[addonId] || { name: addonId };
        return tt(`estimate.addons.${addonId}.name`, defaults.name);
    }

    function getAddonDesc(addonId) {
        const defaults = ADDON_DEFAULTS[addonId] || { desc: '' };
        return tt(`estimate.addons.${addonId}.desc`, defaults.desc);
    }

    function getAppTypeName(typeId) {
        const defaults = APP_TYPE_DEFAULTS[typeId] || { name: typeId };
        return tt(`estimate.appTypes.${typeId}.name`, defaults.name);
    }

    function getAppTypeDesc(typeId) {
        const defaults = APP_TYPE_DEFAULTS[typeId] || { desc: '' };
        return tt(`estimate.appTypes.${typeId}.desc`, defaults.desc);
    }

    function getComplexityName(complexity) {
        const defaults = { standard: 'Standard Build', custom: 'Custom Build', complex: 'Complex Build', enterprise: 'Enterprise Build' };
        return tt(`estimate.complexityNames.${complexity}`, defaults[complexity] || complexity);
    }

    function getPlatformIncludes() {
        // Try i18n array first, fall back to defaults
        const i18nKey = 'estimate.platformIncludes';
        if (window.t) {
            const val = window.t(i18nKey);
            if (val !== i18nKey && Array.isArray(val)) return val;
        }
        return PRICING.platformIncludesDefaults;
    }

    function getTimeline(designOrType) {
        return tt(`estimate.timelines.${designOrType}`, PRICING.timelineDefaults[designOrType] || '');
    }

    // ===== Rendering =====

    function renderStep(n) {
        const body = document.getElementById('wizard-body');
        // Clone and replace container to remove all old event listeners (prevents leak on re-render)
        const freshBody = body.cloneNode(false);
        body.parentNode.replaceChild(freshBody, body);
        freshBody.id = 'wizard-body';

        switch (n) {
            case 1: renderAppTypes(freshBody); break;
            case 2:
                // Guard: if appType not selected, go back to step 1
                if (!selections.appType) { currentStep = 1; renderAppTypes(freshBody); break; }
                renderFeatures(freshBody);
                break;
            case 3: renderScale(freshBody); break;
            case 4: renderEstimate(freshBody); break;
        }
        updateProgress();
        updateButtons();
    }

    function renderAppTypes(container) {
        container.innerHTML = `
            <h2>${escapeHtml(tt('estimate.step1Title', 'What are you building?'))}</h2>
            <p class="step-subtitle">${escapeHtml(tt('estimate.step1Subtitle', 'Every app runs on the Royalty platform \u2014 AI intelligence, automations, and analytics included.'))}</p>
            <div class="app-type-grid">
                ${APP_TYPES.map(t => `
                    <div class="app-type-card ${selections.appType === t.id ? 'selected' : ''}" data-type="${t.id}">
                        <div class="app-type-icon ${t.colorClass}">${t.icon}</div>
                        <div class="app-type-name">${escapeHtml(getAppTypeName(t.id))}</div>
                        <div class="app-type-desc">${escapeHtml(getAppTypeDesc(t.id))}</div>
                    </div>
                `).join('')}
            </div>
        `;

        container.querySelectorAll('.app-type-card').forEach(card => {
            card.addEventListener('click', () => {
                const type = card.dataset.type;
                selections.appType = type;
                // Reset features when type changes
                selections.features = {};
                const features = FEATURES_BY_TYPE[type] || [];
                features.forEach(f => { selections.features[f.id] = f.checked; });
                // Reset add-ons
                selections.addOns = [];
                // Re-render to update selection state
                container.querySelectorAll('.app-type-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                updateButtons();
            });
        });
    }

    function renderFeatures(container) {
        const features = FEATURES_BY_TYPE[selections.appType] || [];

        container.innerHTML = `
            <h2>${escapeHtml(tt('estimate.step2Title', 'Pick your features'))}</h2>
            <p class="step-subtitle">${escapeHtml(tt('estimate.step2Subtitle', 'Toggle the features you need. We\'ll configure everything for you.'))}</p>

            <div class="features-section">
                <div class="features-section-title">${escapeHtml(tt('estimate.step2CoreFeatures', 'Core Features'))}</div>
                <div class="features-grid" id="core-features">
                    ${features.map(f => renderFeatureToggle(f, 'feature')).join('')}
                </div>
            </div>

            <div class="features-section">
                <div class="features-section-title">${escapeHtml(tt('estimate.step2Addons', 'Add-ons'))}</div>
                <div class="features-grid" id="addon-features">
                    ${ADD_ONS.map(f => renderFeatureToggle(f, 'addon')).join('')}
                </div>
            </div>
        `;

        // Attach toggle listeners
        container.querySelectorAll('.feature-toggle-card').forEach(card => {
            const input = card.querySelector('input');
            const featureId = input.dataset.featureId;
            const featureType = input.dataset.featureType;

            const toggleFn = () => {
                if (featureType === 'feature') {
                    selections.features[featureId] = input.checked;
                } else {
                    if (input.checked) {
                        if (!selections.addOns.includes(featureId)) selections.addOns.push(featureId);
                    } else {
                        selections.addOns = selections.addOns.filter(id => id !== featureId);
                    }
                }
                card.classList.toggle('checked', input.checked);
            };

            input.addEventListener('change', toggleFn);
            // Also toggle on card click (excluding the toggle itself)
            card.addEventListener('click', (e) => {
                if (e.target.closest('.toggle-switch-sm')) return;
                input.checked = !input.checked;
                toggleFn();
            });
        });
    }

    function renderFeatureToggle(feature, type) {
        let isChecked = false;
        if (type === 'feature') {
            isChecked = selections.features.hasOwnProperty(feature.id)
                ? selections.features[feature.id]
                : feature.checked;
        } else {
            isChecked = selections.addOns.includes(feature.id);
        }

        const name = type === 'feature' ? getFeatureName(feature.id) : getAddonName(feature.id);
        const desc = type === 'feature' ? getFeatureDesc(feature.id) : getAddonDesc(feature.id);

        const isPlatformIncluded = type === 'addon' && (feature.id === 'ai_dashboard' || feature.id === 'ai_automations');

        return `
            <div class="feature-toggle-card ${isChecked ? 'checked' : ''}">
                <div class="feature-toggle-info">
                    <div class="feature-toggle-icon">${feature.icon}</div>
                    <div class="feature-toggle-details">
                        <div class="feature-toggle-name">${escapeHtml(name)}${isPlatformIncluded ? ' <span class="platform-badge">' + escapeHtml(tt('estimate.includedWithPlatform', 'Included with platform')) + '</span>' : ''}</div>
                        <div class="feature-toggle-desc">${escapeHtml(desc)}</div>
                    </div>
                </div>
                <label class="toggle-switch-sm">
                    <input type="checkbox" data-feature-id="${feature.id}" data-feature-type="${type}" ${isChecked ? 'checked' : ''}>
                    <span class="toggle-slider-sm"></span>
                </label>
            </div>
        `;
    }

    function renderScale(container) {
        const scales = [
            { id: 'starter' },
            { id: 'growing' },
            { id: 'scaling' },
            { id: 'enterprise' }
        ];

        const scaleDefaults = {
            starter: { name: 'Starter', count: '< 250 customers' },
            growing: { name: 'Growing', count: '250 - 5,000' },
            scaling: { name: 'Scaling', count: '5,000 - 50,000' },
            enterprise: { name: 'Enterprise', count: '50,000+' }
        };

        const designs = [
            { id: 'standard' },
            { id: 'custom' },
            { id: 'premium' }
        ];

        const designDefaults = {
            standard: { name: 'Standard', desc: 'Our templates, your content' },
            custom: { name: 'Custom', desc: 'Your brand colors & logo' },
            premium: { name: 'Premium', desc: 'Bespoke design, custom graphics' }
        };

        container.innerHTML = `
            <h2>${escapeHtml(tt('estimate.step3Title', 'Scale & details'))}</h2>
            <p class="step-subtitle">${escapeHtml(tt('estimate.step3Subtitle', 'Help us understand the size and style of your app.'))}</p>

            <div class="scale-section">
                <div class="scale-label">${escapeHtml(tt('estimate.step3ExpectedCustomers', 'Expected customers'))}</div>
                <div class="scale-pills">
                    ${scales.map(s => `
                        <div class="scale-pill ${selections.scale === s.id ? 'selected' : ''}" data-scale="${s.id}">
                            ${escapeHtml(tt(`estimate.scales.${s.id}.name`, scaleDefaults[s.id].name))}
                            <span class="scale-pill-count">${escapeHtml(tt(`estimate.scales.${s.id}.count`, scaleDefaults[s.id].count))}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="scale-section">
                <div class="scale-label">${escapeHtml(tt('estimate.step3DesignLevel', 'Design level'))}</div>
                <div class="design-options">
                    ${designs.map(d => `
                        <div class="design-option ${selections.design === d.id ? 'selected' : ''}" data-design="${d.id}">
                            <div class="design-option-name">${escapeHtml(tt(`estimate.designs.${d.id}.name`, designDefaults[d.id].name))}</div>
                            <div class="design-option-desc">${escapeHtml(tt(`estimate.designs.${d.id}.desc`, designDefaults[d.id].desc))}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="scale-section">
                <div class="scale-label">${escapeHtml(tt('estimate.step3AnythingElse', 'Anything else?'))} <span style="font-weight:400;color:var(--color-text-muted)">${escapeHtml(tt('estimate.step3Optional', '(optional)'))}</span></div>
                <textarea class="notes-textarea" id="notes-input" data-i18n-placeholder="estimate.step3NotesPlaceholder" placeholder="${escapeHtml(tt('estimate.step3NotesPlaceholder', 'Tell us about your business, specific requirements, or questions...'))}">${escapeHtml(selections.notes)}</textarea>
            </div>
        `;

        // Scale pills
        container.querySelectorAll('.scale-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                selections.scale = pill.dataset.scale;
                container.querySelectorAll('.scale-pill').forEach(p => p.classList.remove('selected'));
                pill.classList.add('selected');
                updateButtons();
            });
        });

        // Design options
        container.querySelectorAll('.design-option').forEach(opt => {
            opt.addEventListener('click', () => {
                selections.design = opt.dataset.design;
                container.querySelectorAll('.design-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
        });

        // Notes
        const notesInput = document.getElementById('notes-input');
        notesInput.addEventListener('input', () => {
            selections.notes = notesInput.value;
        });
    }

    function renderEstimate(container) {
        const complexity = determineComplexity();
        const commitmentData = PRICING.commitment[complexity];
        const timeline = estimateTimeline();
        const isEnterprise = complexity === 'enterprise';
        const yearOneCost = calculateYearOneCost(complexity);

        // Gather selected feature names (translated)
        const selectedFeatures = [];
        const features = FEATURES_BY_TYPE[selections.appType] || [];
        features.forEach(f => {
            if (selections.features[f.id]) selectedFeatures.push(getFeatureName(f.id));
        });
        ADD_ONS.forEach(a => {
            if (selections.addOns.includes(a.id)) selectedFeatures.push(getAddonName(a.id));
        });

        const appTypeName = getAppTypeName(selections.appType || 'custom');
        const complexityName = getComplexityName(complexity);
        const platformIncludes = getPlatformIncludes();

        // i18n helpers for comparison items
        function getDiyItems() {
            const items = [];
            for (let i = 0; i < PLATFORM_VALUE.diy.itemDefaults.length; i++) {
                items.push(tt('estimate.diy.items.' + i, PLATFORM_VALUE.diy.itemDefaults[i]));
            }
            return items;
        }
        function getRoyaltyItems() {
            const items = [];
            for (let i = 0; i < PLATFORM_VALUE.royalty.itemDefaults.length; i++) {
                items.push(tt('estimate.royalty.items.' + i, PLATFORM_VALUE.royalty.itemDefaults[i]));
            }
            return items;
        }
        function getDetailCategory(key) {
            const defaults = PLATFORM_VALUE.detailDefaults[key];
            const title = tt('estimate.platform' + key.charAt(0).toUpperCase() + key.slice(1) + '.title', defaults.title);
            const items = [];
            for (let i = 0; i < defaults.items.length; i++) {
                items.push(tt('estimate.platform' + key.charAt(0).toUpperCase() + key.slice(1) + '.items.' + i, defaults.items[i]));
            }
            return { title, items };
        }

        const checkSvg = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const detailIcons = { security: '&#128274;', integrations: '&#128268;', intelligence: '&#129504;', operations: '&#128736;' };

        container.innerHTML = `
            <h2>${escapeHtml(tt('estimate.step4Title', 'Your estimate'))}</h2>
            <p class="step-subtitle">${escapeHtml(tt('estimate.step4Subtitle', 'Here\'s what we recommend based on your selections.'))}</p>

            <!-- Estimate Card -->
            <div class="estimate-result">
                <div class="estimate-result-header ${isEnterprise ? 'enterprise' : ''}">
                    <div class="plan-name">${escapeHtml(complexityName)}</div>
                    ${isEnterprise
                        ? `<div class="plan-price">${escapeHtml(tt('estimate.letsTalk', 'Let\'s talk'))}</div>`
                        : `<div class="plan-price">$${commitmentData.buildPhase}<span class="period">/${escapeHtml(tt('estimate.mo', 'mo'))}</span> <span class="commitment-duration">${escapeHtml(tt('estimate.forMonths', 'for {months} months').replace('{months}', commitmentData.months))}</span></div>
                           <div class="plan-after">${escapeHtml(tt('estimate.afterCommitment', 'After {months} months: ${price}/mo ({tier} plan)').replace('{months}', commitmentData.months).replace('{price}', commitmentData.afterCommitment).replace('{tier}', commitmentData.postTier))}</div>`
                    }
                </div>
                <div class="estimate-result-body">
                    <div class="estimate-section">
                        <div class="estimate-section-title">${escapeHtml(tt('estimate.platformTitle', 'Built & hosted on Royalty'))}</div>
                        <ul class="estimate-includes">
                            ${platformIncludes.map(item => `
                                <li>${checkSvg} ${escapeHtml(item)}</li>
                            `).join('')}
                        </ul>
                    </div>

                    ${selectedFeatures.length > 0 ? `
                        <div class="estimate-section">
                            <div class="estimate-section-title">${escapeHtml(tt('estimate.yourApp', 'Your app'))}</div>
                            <div class="estimate-features-list">
                                ${selectedFeatures.map(f => `<span class="estimate-feature-pill">${escapeHtml(f)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="estimate-section">
                        <div class="estimate-detail-row">
                            <span class="estimate-detail-label">${escapeHtml(tt('estimate.appTypeLabel', 'App type'))}</span>
                            <span class="estimate-detail-value">${escapeHtml(appTypeName)}</span>
                        </div>
                        <div class="estimate-detail-row">
                            <span class="estimate-detail-label">${escapeHtml(tt('estimate.buildTimeline', 'Build timeline'))}</span>
                            <span class="estimate-detail-value">${escapeHtml(timeline)}</span>
                        </div>
                    </div>

                    <div class="estimate-cta-area">
                        <button class="btn btn-primary" id="btn-consultation">${escapeHtml(tt('estimate.bookConsultation', 'Book a Free Consultation'))}</button>
                        <p class="self-service-link">${escapeHtml(tt('estimate.selfServicePrefix', 'Or '))}<a href="/app/signup.html">${escapeHtml(tt('estimate.selfServiceLink', 'start building it yourself'))}</a></p>
                    </div>
                </div>
            </div>

            <!-- DIY vs Royalty Comparison -->
            <div class="value-comparison">
                <h3 class="value-comparison-title">${escapeHtml(tt('estimate.whyRoyalty', 'Why build on Royalty?'))}</h3>
                <div class="comparison-columns">
                    <div class="comparison-column diy">
                        <div class="comparison-column-title">${escapeHtml(tt('estimate.diyTitle', 'Build It Yourself'))}</div>
                        <div class="comparison-items">
                            ${getDiyItems().map(item => `<div class="comparison-item"><span class="comparison-x">&times;</span> ${escapeHtml(item)}</div>`).join('')}
                        </div>
                        <div class="year-cost">
                            <div class="year-cost-label">${escapeHtml(tt('estimate.yearOneCost', '12-month cost'))}</div>
                            <div class="year-cost-amount diy">${escapeHtml(tt('estimate.diyYearCost', '$40,000 - $80,000+'))}</div>
                            <div class="year-cost-note">${escapeHtml(tt('estimate.diyYearNote', 'dev + hosting + APIs + maintenance + security'))}</div>
                        </div>
                    </div>
                    <div class="comparison-column royalty">
                        <div class="comparison-column-title">${escapeHtml(tt('estimate.royaltyTitle', 'Build on Royalty'))}</div>
                        <div class="comparison-items">
                            ${getRoyaltyItems().map(item => `<div class="comparison-item">${checkSvg} ${escapeHtml(item)}</div>`).join('')}
                        </div>
                        <div class="year-cost">
                            <div class="year-cost-label">${escapeHtml(tt('estimate.yearOneCost', '12-month cost'))}</div>
                            <div class="year-cost-amount royalty">${isEnterprise ? escapeHtml(tt('estimate.letsTalk', 'Let\'s talk')) : '$' + yearOneCost.toLocaleString()}</div>
                            <div class="year-cost-note">${escapeHtml(tt('estimate.royaltyYearNote', 'platform + support + updates'))}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Platform Details Grid -->
            <div class="platform-details">
                <h3 class="platform-details-title">${escapeHtml(tt('estimate.platformDetailsTitle', 'What\'s included in the platform'))}</h3>
                <div class="platform-details-grid">
                    ${['security', 'integrations', 'intelligence', 'operations'].map(key => {
                        const cat = getDetailCategory(key);
                        return `
                            <div class="detail-category">
                                <div class="detail-category-header">
                                    <span class="detail-category-icon">${detailIcons[key]}</span>
                                    <span class="detail-category-title">${escapeHtml(cat.title)}</span>
                                </div>
                                <ul class="detail-category-items">
                                    ${cat.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                                </ul>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Contact Form (hidden until CTA click) -->
            <div class="contact-form" id="contact-form">
                <h3>${escapeHtml(tt('estimate.bookConsultation', 'Book a Free Consultation'))}</h3>
                <div class="form-row">
                    <div class="form-field">
                        <label for="contact-name">${escapeHtml(tt('estimate.contactName', 'Name'))} ${escapeHtml(tt('estimate.required', '*'))}</label>
                        <input type="text" id="contact-name" required>
                    </div>
                    <div class="form-field">
                        <label for="contact-email">${escapeHtml(tt('estimate.contactEmail', 'Email'))} ${escapeHtml(tt('estimate.required', '*'))}</label>
                        <input type="email" id="contact-email" required>
                    </div>
                </div>
                <div class="form-field">
                    <label for="contact-phone">${escapeHtml(tt('estimate.contactPhone', 'Phone'))} <span style="color:var(--color-text-muted)">${escapeHtml(tt('estimate.step3Optional', '(optional)'))}</span></label>
                    <input type="tel" id="contact-phone">
                </div>
                <div class="form-field">
                    <label for="contact-message">${escapeHtml(tt('estimate.contactMessage', 'Message'))}</label>
                    <textarea id="contact-message">${escapeHtml(buildEstimateSummary(complexity, commitmentData, timeline, selectedFeatures, appTypeName))}</textarea>
                </div>
                <button class="btn btn-primary btn-block" id="btn-submit-consultation">${escapeHtml(tt('estimate.sendRequest', 'Send Request'))}</button>
            </div>

            <!-- Success state -->
            <div class="form-success" id="form-success">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                    <circle cx="32" cy="32" r="30" stroke="#10b981" stroke-width="4"/>
                    <path d="M20 32L28 40L44 24" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <h3>${escapeHtml(tt('estimate.requestSent', 'Request sent!'))}</h3>
                <p>${escapeHtml(tt('estimate.requestSentDesc', 'We\'ll be in touch within 24 hours to schedule your consultation.'))}</p>
            </div>
        `;

        // Show contact form on CTA click
        document.getElementById('btn-consultation').addEventListener('click', () => {
            document.getElementById('contact-form').classList.add('visible');
            document.getElementById('contact-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        // Submit consultation
        document.getElementById('btn-submit-consultation').addEventListener('click', () => {
            const name = document.getElementById('contact-name').value.trim();
            const email = document.getElementById('contact-email').value.trim();

            if (!name || !email) {
                alert(tt('estimate.fillRequired', 'Please fill in your name and email.'));
                return;
            }

            const phone = document.getElementById('contact-phone').value.trim();
            const message = document.getElementById('contact-message').value.trim();

            const mailtoBody = encodeURIComponent(
                `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\n\n${message}`
            );
            const subject = encodeURIComponent(tt('estimate.emailSubject', 'Custom App Consultation Request'));
            const mailtoUrl = `mailto:hello@royaltyapp.ai?subject=${subject}&body=${mailtoBody}`;

            window.location.href = mailtoUrl;

            document.getElementById('contact-form').classList.remove('visible');
            document.getElementById('form-success').classList.add('visible');
        });
    }

    function buildEstimateSummary(complexity, commitmentData, timeline, selectedFeatures, appTypeName) {
        const complexityName = getComplexityName(complexity);
        const isEnterprise = complexity === 'enterprise';
        const priceInfo = isEnterprise
            ? 'Custom pricing'
            : `$${commitmentData.buildPhase}/mo for ${commitmentData.months} months, then $${commitmentData.afterCommitment}/mo`;

        const lines = [
            tt('estimate.summaryIntro', 'Hi! I\'m interested in a custom {appType} built by Royalty.').replace('{appType}', appTypeName),
            '',
            tt('estimate.summaryPlan', 'Build plan: {plan}').replace('{plan}', complexityName),
            tt('estimate.summaryPricing', 'Pricing: {pricing}').replace('{pricing}', priceInfo),
            tt('estimate.summaryTimeline', 'Timeline: {timeline}').replace('{timeline}', timeline),
            '',
            tt('estimate.summaryFeatures', 'Features: {features}').replace('{features}', selectedFeatures.join(', ') || tt('estimate.summaryCoreFeatures', 'Core features')),
            '',
            selections.notes ? tt('estimate.summaryNotes', 'Additional notes: {notes}').replace('{notes}', selections.notes) : ''
        ];
        return lines.filter(l => l !== undefined).join('\n').trim();
    }

    // ===== Pricing Engine =====

    function determineComplexity() {
        const hasWhiteLabel = selections.addOns.includes('white_label');
        const hasApiAccess = selections.addOns.includes('api_access');

        // Enterprise scale → enterprise
        if (selections.scale === 'enterprise') return 'enterprise';

        // Custom app type, premium design, or white-label/API → complex
        if (selections.appType === 'custom' || selections.design === 'premium' || hasWhiteLabel || hasApiAccess) return 'complex';

        // Custom branding or 2+ add-ons → custom
        if (selections.design === 'custom' || selections.addOns.length >= 2) return 'custom';

        // Everything else → standard
        return 'standard';
    }

    function calculateYearOneCost(complexity) {
        const tier = PRICING.commitment[complexity];
        if (!tier || !tier.buildPhase) return null; // enterprise
        return tier.buildPhase * tier.months;
    }

    function estimateTimeline() {
        if (selections.appType === 'custom') return getTimeline('customType');
        if (selections.design === 'premium') return getTimeline('premium');
        if (selections.design === 'custom') return getTimeline('custom');
        return getTimeline('standard');
    }

    // ===== Navigation =====

    function updateProgress() {
        const steps = document.querySelectorAll('.wizard-step');
        const lines = document.querySelectorAll('.wizard-step-line');

        steps.forEach((step, i) => {
            const stepNum = i + 1;
            step.classList.remove('active', 'completed');
            if (stepNum === currentStep) {
                step.classList.add('active');
            } else if (stepNum < currentStep) {
                step.classList.add('completed');
                // Show checkmark for completed steps
                step.querySelector('.wizard-step-dot').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } else {
                step.querySelector('.wizard-step-dot').textContent = stepNum;
            }
        });

        lines.forEach((line, i) => {
            line.classList.toggle('completed', i + 1 < currentStep);
        });
    }

    function updateButtons() {
        const backBtn = document.getElementById('btn-back');
        const nextBtn = document.getElementById('btn-next');
        const footer = document.getElementById('wizard-footer');

        backBtn.disabled = currentStep === 1;

        // Hide footer on step 4 (estimate has its own CTAs)
        footer.style.display = currentStep === 4 ? 'none' : 'flex';

        // Next button validation
        switch (currentStep) {
            case 1:
                nextBtn.disabled = !selections.appType;
                break;
            case 2:
                nextBtn.disabled = false; // Features are optional
                break;
            case 3:
                nextBtn.disabled = !selections.scale;
                break;
        }

        // Update next button text for last navigable step
        const btnText = currentStep === 3
            ? tt('estimate.btnSeeEstimate', 'See Estimate')
            : tt('estimate.btnNext', 'Next');
        const nextSpan = nextBtn.querySelector('span');
        if (nextSpan) nextSpan.textContent = btnText;
    }

    function goNext() {
        if (currentStep >= totalSteps) return;
        currentStep++;
        renderStep(currentStep);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function goBack() {
        if (currentStep <= 1) return;
        currentStep--;
        renderStep(currentStep);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ===== Init =====

    function init() {
        renderStep(1);

        document.getElementById('btn-next').addEventListener('click', goNext);
        document.getElementById('btn-back').addEventListener('click', goBack);

        // Re-render when translations load or language changes
        window.addEventListener('i18n:ready', () => renderStep(currentStep));
        window.addEventListener('i18n:changed', () => renderStep(currentStep));
    }

    return { init };
})();
