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

    // ===== Pricing Config =====
    const PRICING = {
        tiers: {
            free: { monthly: 0, annual: 0, maxCustomers: 250 },
            pro: { monthly: 299, annual: 239, maxCustomers: null },
            max: { monthly: 749, annual: 599, maxCustomers: null },
            enterprise: { monthly: null, annual: null, maxCustomers: null }
        },
        tierIncludesDefaults: {
            free: ['Up to 250 customers', 'Full loyalty program', '20 Royal chat queries/mo', 'Points, rewards & referrals'],
            pro: ['Unlimited customers', '10,000 emails + 500 SMS/mo', 'Unlimited Royal AI + Autonomous', 'Business learning & analytics'],
            max: ['Everything in Pro', '50,000 emails + 2,000 SMS/mo', 'Visit attribution (prove ROI)', 'White-label + priority support'],
            enterprise: ['Everything in Max', 'Dedicated support & SLAs', 'API access', 'Custom integrations']
        },
        setup: {
            base: 1500,
            customBranding: 500,
            premiumDesign: 1500,
            perIntegration: 250,
            customType: 1000
        },
        timelineDefaults: {
            standard: '1-2 weeks',
            custom: '2-3 weeks',
            premium: '3-5 weeks',
            customType: '4-6 weeks'
        }
    };

    // Integrations that count toward setup cost
    const PAID_ADDON_IDS = ['email_campaigns', 'sms_campaigns'];

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

    function getTierName(tierId) {
        const defaults = { free: 'Free', pro: 'Pro', max: 'Max', enterprise: 'Enterprise' };
        return tt(`estimate.tierNames.${tierId}`, defaults[tierId] || tierId);
    }

    function getTierIncludes(tierId) {
        // Try i18n array first, fall back to defaults
        const i18nKey = `estimate.tierIncludes.${tierId}`;
        if (window.t) {
            const val = window.t(i18nKey);
            if (val !== i18nKey && Array.isArray(val)) return val;
        }
        return PRICING.tierIncludesDefaults[tierId] || [];
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
            <p class="step-subtitle">${escapeHtml(tt('estimate.step1Subtitle', 'Choose the type of app that best fits your business.'))}</p>
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

        return `
            <div class="feature-toggle-card ${isChecked ? 'checked' : ''}">
                <div class="feature-toggle-info">
                    <div class="feature-toggle-icon">${feature.icon}</div>
                    <div class="feature-toggle-details">
                        <div class="feature-toggle-name">${escapeHtml(name)}</div>
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
        const tier = recommendTier();
        const tierData = PRICING.tiers[tier];
        const setup = calculateSetup();
        const timeline = estimateTimeline();
        const isEnterprise = tier === 'enterprise';

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
        const tierName = getTierName(tier);
        const tierIncludes = getTierIncludes(tier);

        container.innerHTML = `
            <h2>${escapeHtml(tt('estimate.step4Title', 'Your estimate'))}</h2>
            <p class="step-subtitle">${escapeHtml(tt('estimate.step4Subtitle', 'Here\'s what we recommend based on your selections.'))}</p>

            <div class="estimate-result">
                <div class="estimate-result-header ${isEnterprise ? 'enterprise' : ''}">
                    <div class="plan-label">${escapeHtml(tt('estimate.recommendedPlan', 'Recommended Plan'))}</div>
                    <div class="plan-name">${escapeHtml(tierName)}</div>
                    ${isEnterprise
                        ? `<div class="plan-price">${escapeHtml(tt('estimate.letsTalk', 'Let\'s talk'))}</div>`
                        : `<div class="plan-price">$${tierData.monthly}<span class="period">${escapeHtml(tt('estimate.perMonth', '/month'))}</span></div>
                           ${tierData.annual ? `<div class="plan-annual">$${tierData.annual}${escapeHtml(tt('estimate.perMonth', '/mo'))} ${escapeHtml(tt('estimate.billedAnnually', 'billed annually').replace('${price}', ''))}</div>` : ''}`
                    }
                </div>
                <div class="estimate-result-body">
                    <div class="estimate-section">
                        <div class="estimate-section-title">${escapeHtml(tt('estimate.planIncludes', 'Plan includes'))}</div>
                        <ul class="estimate-includes">
                            ${tierIncludes.map(item => `
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    ${escapeHtml(item)}
                                </li>
                            `).join('')}
                        </ul>
                    </div>

                    ${selectedFeatures.length > 0 ? `
                        <div class="estimate-section">
                            <div class="estimate-section-title">${escapeHtml(tt('estimate.yourAppFeatures', 'Your app features'))}</div>
                            <div class="estimate-features-list">
                                ${selectedFeatures.map(f => `<span class="estimate-feature-pill">${escapeHtml(f)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="estimate-section">
                        <div class="estimate-section-title">${escapeHtml(tt('estimate.setupDetails', 'Setup details'))}</div>
                        <div class="estimate-detail-row">
                            <span class="estimate-detail-label">${escapeHtml(tt('estimate.appTypeLabel', 'App type'))}</span>
                            <span class="estimate-detail-value">${escapeHtml(appTypeName)}</span>
                        </div>
                        <div class="estimate-detail-row">
                            <span class="estimate-detail-label">${escapeHtml(tt('estimate.oneTimeSetup', 'One-time setup'))}</span>
                            <span class="estimate-detail-value">$${setup.low.toLocaleString()} - $${setup.high.toLocaleString()}</span>
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
                    <textarea id="contact-message">${escapeHtml(buildEstimateSummary(tier, tierData, setup, timeline, selectedFeatures, appTypeName))}</textarea>
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

            // For now, use mailto fallback (Supabase integration later)
            const phone = document.getElementById('contact-phone').value.trim();
            const message = document.getElementById('contact-message').value.trim();

            const mailtoBody = encodeURIComponent(
                `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\n\n${message}`
            );
            const subject = encodeURIComponent(tt('estimate.emailSubject', 'Custom App Consultation Request'));
            const mailtoUrl = `mailto:hello@royaltyapp.ai?subject=${subject}&body=${mailtoBody}`;

            // Open mailto
            window.location.href = mailtoUrl;

            // Show success
            document.getElementById('contact-form').classList.remove('visible');
            document.getElementById('form-success').classList.add('visible');
        });
    }

    function buildEstimateSummary(tier, tierData, setup, timeline, selectedFeatures, appTypeName) {
        const lines = [
            tt('estimate.summaryIntro', 'Hi! I\'m interested in a custom {appType} built by Royalty.').replace('{appType}', appTypeName),
            '',
            tt('estimate.summaryPlan', 'Recommended plan: {plan}').replace('{plan}', getTierName(tier) + (tierData.monthly ? ` ($${tierData.monthly}/mo)` : '')),
            tt('estimate.summarySetup', 'Estimated setup: ${low} - ${high}').replace('{low}', setup.low.toLocaleString()).replace('{high}', setup.high.toLocaleString()),
            tt('estimate.summaryTimeline', 'Timeline: {timeline}').replace('{timeline}', timeline),
            '',
            tt('estimate.summaryFeatures', 'Features: {features}').replace('{features}', selectedFeatures.join(', ') || tt('estimate.summaryCoreFeatures', 'Core features')),
            '',
            selections.notes ? tt('estimate.summaryNotes', 'Additional notes: {notes}').replace('{notes}', selections.notes) : ''
        ];
        return lines.filter(l => l !== undefined).join('\n').trim();
    }

    // ===== Pricing Engine =====

    function recommendTier() {
        const scale = selections.scale;
        const hasWhiteLabel = selections.addOns.includes('white_label');
        const hasApiAccess = selections.addOns.includes('api_access');
        const hasAnyAddOns = selections.addOns.length > 0;

        // Enterprise scale always → enterprise
        if (scale === 'enterprise') return 'enterprise';

        // White-label or API → minimum Max
        if (hasWhiteLabel || hasApiAccess) return 'max';

        // Scaling → Max
        if (scale === 'scaling') return 'max';

        // Growing → Pro
        if (scale === 'growing') return 'pro';

        // Starter with add-ons → Pro
        if (scale === 'starter' && hasAnyAddOns) return 'pro';

        // Starter with core only → Free
        return 'free';
    }

    function calculateSetup() {
        let base = PRICING.setup.base;

        // Custom type discovery fee
        if (selections.appType === 'custom') {
            base += PRICING.setup.customType;
        }

        // Design level
        if (selections.design === 'custom') {
            base += PRICING.setup.customBranding;
        } else if (selections.design === 'premium') {
            base += PRICING.setup.premiumDesign;
        }

        // Integration add-ons
        const integrationCount = selections.addOns.filter(id => PAID_ADDON_IDS.includes(id)).length;
        base += integrationCount * PRICING.setup.perIntegration;

        return {
            low: base,
            high: Math.round(base * 1.3)
        };
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
