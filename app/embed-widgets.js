/**
 * Embed Widgets System
 * Parses article content and renders dynamic Royalty widgets
 *
 * Embed Syntax:
 * [royalty:automation type="email-sequence" industry="restaurant"]
 * [royalty:app type="loyalty" features="points,rewards,tiers"]
 * [royalty:custom-request]
 * [royalty:cta text="Start Free Trial" href="/signup"]
 */

// Widget Types and their templates
const AUTOMATION_TYPES = {
    'email-sequence': {
        icon: '📧',
        title: 'Email Sequence Automation',
        description: 'Automatically nurture customers with perfectly-timed follow-ups',
        features: ['Welcome series', 'Re-engagement campaigns', 'Birthday rewards']
    },
    'social-media': {
        icon: '📱',
        title: 'Social Media Automation',
        description: 'Schedule and publish content across all your social channels',
        features: ['Auto-posting', 'Content calendar', 'Analytics tracking']
    },
    'sms-marketing': {
        icon: '💬',
        title: 'SMS Marketing Automation',
        description: 'Send targeted text messages to customers at the right time',
        features: ['Appointment reminders', 'Flash sales', 'Order updates']
    },
    'review-request': {
        icon: '⭐',
        title: 'Review Request Automation',
        description: 'Automatically ask happy customers to leave reviews',
        features: ['Timing optimization', 'Multi-platform', 'Follow-up sequences']
    },
    'loyalty-alerts': {
        icon: '🎁',
        title: 'Loyalty Alert Automation',
        description: 'Notify customers about rewards and tier upgrades',
        features: ['Points reminders', 'Tier celebrations', 'Expiry warnings']
    },
    'blog-content': {
        icon: '📝',
        title: 'Blog Content Automation',
        description: 'AI-powered content creation for your business blog',
        features: ['Topic suggestions', 'Multi-language', 'SEO optimization']
    }
};

const APP_TYPES = {
    'loyalty': {
        icon: '⭐',
        title: 'Loyalty App',
        description: 'Turn one-time buyers into repeat customers',
        features: ['Points System', 'Reward Tiers', 'Custom Branding']
    },
    'newsletter': {
        icon: '📰',
        title: 'Newsletter App',
        description: 'Share updates and build your audience',
        features: ['SEO Optimized', 'Multi-Language', 'Email Campaigns']
    },
    'rewards': {
        icon: '🎁',
        title: 'Rewards Club',
        description: 'Offer redeemable rewards for loyal customers',
        features: ['Reward Catalog', 'Redemption Tracking', 'Member Tiers']
    },
    'membership': {
        icon: '👑',
        title: 'VIP Membership',
        description: 'Exclusive access and perks for your best customers',
        features: ['Exclusive Content', 'Early Access', 'Special Discounts']
    }
};

/**
 * Parse attributes from embed tag
 * @param {string} attrString - Attribute string like 'type="value" key="value2"'
 * @returns {Object} Parsed attributes
 */
function parseAttributes(attrString) {
    const attrs = {};
    const pattern = /(\w+)=["']([^"']+)["']/g;
    let match;

    while ((match = pattern.exec(attrString)) !== null) {
        attrs[match[1]] = match[2];
    }

    return attrs;
}

/**
 * Render an automation card widget
 * @param {Object} attrs - Widget attributes
 * @returns {string} HTML string
 */
function renderAutomationCard(attrs) {
    const type = attrs.type || 'email-sequence';
    const automation = AUTOMATION_TYPES[type] || AUTOMATION_TYPES['email-sequence'];
    const industry = attrs.industry ? ` for ${escapeHtml(attrs.industry)}` : '';

    return `
        <div class="royalty-embed automation-card" data-type="${escapeHtml(type)}">
            <div class="embed-icon">${automation.icon}</div>
            <div class="embed-content">
                <h4 class="embed-title">${escapeHtml(automation.title)}${industry}</h4>
                <p class="embed-desc">${escapeHtml(automation.description)}</p>
                <ul class="embed-features">
                    ${automation.features.map(f => `<li>✓ ${escapeHtml(f)}</li>`).join('')}
                </ul>
            </div>
            <button class="embed-cta" onclick="window.openRoyaltySignup && window.openRoyaltySignup('${escapeHtml(type)}')">
                Try This Automation →
            </button>
        </div>
    `;
}

/**
 * Render an app card widget
 * @param {Object} attrs - Widget attributes
 * @returns {string} HTML string
 */
function renderAppCard(attrs) {
    const type = attrs.type || 'loyalty';
    const app = APP_TYPES[type] || APP_TYPES['loyalty'];

    // Parse custom features if provided
    let features = app.features;
    if (attrs.features) {
        const customFeatures = attrs.features.split(',').map(f => f.trim());
        if (customFeatures.length > 0) {
            features = customFeatures;
        }
    }

    return `
        <div class="royalty-embed app-card" data-type="${escapeHtml(type)}">
            <div class="app-preview-badge">${app.icon}</div>
            <div class="embed-content">
                <h4 class="embed-title">${escapeHtml(app.title)}</h4>
                <p class="embed-desc">${escapeHtml(app.description)}</p>
                <div class="embed-badges">
                    ${features.map(f => `<span class="feature-badge">${escapeHtml(f)}</span>`).join('')}
                </div>
            </div>
            <button class="embed-cta" onclick="window.openAppBuilder && window.openAppBuilder('${escapeHtml(type)}')">
                Build Your App →
            </button>
        </div>
    `;
}

/**
 * Render a custom app request form
 * @returns {string} HTML string
 */
function renderCustomRequestForm() {
    return `
        <div class="royalty-embed custom-request-card">
            <div class="embed-icon">💡</div>
            <div class="embed-content">
                <h4 class="embed-title">Need Something Custom?</h4>
                <p class="embed-desc">Describe your ideal app and our team will review it</p>
                <form class="custom-request-form" onsubmit="window.submitCustomRequest && window.submitCustomRequest(event, this)">
                    <textarea name="description" placeholder="I need an app that..." required rows="3"></textarea>
                    <input type="email" name="email" placeholder="Your email" required>
                    <button type="submit" class="embed-cta">Submit for Review</button>
                </form>
                <p class="embed-note">Our team reviews all requests within 48 hours</p>
            </div>
        </div>
    `;
}

/**
 * Render a CTA button
 * @param {Object} attrs - Widget attributes
 * @returns {string} HTML string
 */
function renderCTAButton(attrs) {
    const text = attrs.text || 'Learn More';
    const href = attrs.href || '/signup';
    const style = attrs.style || 'primary'; // primary, secondary, outline

    return `
        <div class="royalty-embed cta-embed">
            <a href="${escapeHtml(href)}" class="embed-cta-link embed-cta-${escapeHtml(style)}">
                ${escapeHtml(text)}
            </a>
        </div>
    `;
}

/**
 * Parse article content and replace embed tags with rendered widgets
 * @param {string} content - Article content with embed tags
 * @returns {string} Content with rendered HTML widgets
 */
function parseEmbeds(content) {
    if (!content) return '';

    // Pattern: [royalty:type key="value" key2="value2"]
    const embedPattern = /\[royalty:(\w+(?:-\w+)*)\s*([^\]]*)\]/g;

    return content.replace(embedPattern, (match, type, attrs) => {
        try {
            const attributes = parseAttributes(attrs);

            switch (type) {
                case 'automation':
                    return renderAutomationCard(attributes);
                case 'app':
                    return renderAppCard(attributes);
                case 'custom-request':
                    return renderCustomRequestForm();
                case 'cta':
                    return renderCTAButton(attributes);
                default:
                    // Unknown embed type, leave as-is for debugging
                    console.warn(`Unknown embed type: ${type}`);
                    return match;
            }
        } catch (error) {
            console.error('Error parsing embed:', error);
            return match;
        }
    });
}

/**
 * Handler for opening signup with automation context
 * @param {string} automationType - The automation type to pre-select
 */
function openRoyaltySignup(automationType) {
    // Store context for signup flow
    sessionStorage.setItem('signup_context', JSON.stringify({
        type: 'automation',
        automation_type: automationType,
        source: 'embed_widget'
    }));

    // Redirect to signup
    window.location.href = '/signup.html?ref=automation-' + encodeURIComponent(automationType);
}

/**
 * Handler for opening app builder with type pre-selected
 * @param {string} appType - The app type to pre-select
 */
function openAppBuilder(appType) {
    // Check if authenticated
    if (window.supabase) {
        window.supabase.auth.getSession().then(({ data }) => {
            if (data.session) {
                // Authenticated - go to app builder
                window.location.href = '/app/app-builder.html?type=' + encodeURIComponent(appType);
            } else {
                // Not authenticated - go to signup with context
                sessionStorage.setItem('signup_context', JSON.stringify({
                    type: 'app',
                    app_type: appType,
                    source: 'embed_widget'
                }));
                window.location.href = '/signup.html?ref=app-' + encodeURIComponent(appType);
            }
        });
    } else {
        // Fallback - go to signup
        window.location.href = '/signup.html?ref=app-' + encodeURIComponent(appType);
    }
}

/**
 * Handler for custom app request submission
 * @param {Event} event - Form submit event
 * @param {HTMLFormElement} form - The form element
 */
async function submitCustomRequest(event, form) {
    event.preventDefault();

    const description = form.description.value.trim();
    const email = form.email.value.trim();

    if (!description || !email) {
        alert(window.t ? window.t('errors.fillAllFields') : 'Please fill in all fields');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;

    try {
        // Try to submit via Supabase if available
        if (window.supabase) {
            const { error } = await window.supabase
                .from('custom_app_requests')
                .insert({
                    email: email,
                    description: description,
                    source: 'embed_widget',
                    source_article_id: window.currentArticleId || null
                });

            if (error) throw error;
        }

        // Show success
        form.innerHTML = `
            <div class="request-success">
                <div class="success-icon">✓</div>
                <p>Thank you! We'll review your request and get back to you within 48 hours.</p>
            </div>
        `;
    } catch (error) {
        console.error('Error submitting request:', error);
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        alert(window.t ? window.t('errors.submitFailed') : 'Failed to submit. Please try again.');
    }
}

// Expose functions globally
window.parseEmbeds = parseEmbeds;
window.openRoyaltySignup = openRoyaltySignup;
window.openAppBuilder = openAppBuilder;
window.submitCustomRequest = submitCustomRequest;

// Also export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseEmbeds,
        parseAttributes,
        renderAutomationCard,
        renderAppCard,
        renderCustomRequestForm,
        renderCTAButton,
        AUTOMATION_TYPES,
        APP_TYPES
    };
}
