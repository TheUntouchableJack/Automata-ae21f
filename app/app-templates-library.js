/**
 * App Templates Library
 * Pre-built templates for customer-facing apps
 */

const APP_TEMPLATES_LIBRARY = [
    {
        id: 'loyalty-points',
        name: 'Loyalty Points Program',
        description: 'Customers earn points per visit or purchase. Perfect for cafes, restaurants, and retail stores.',
        app_type: 'loyalty',
        icon: 'star',
        industries: ['food', 'retail', 'service'],
        features: {
            points_enabled: true,
            leaderboard_enabled: true,
            rewards_enabled: true,
            menu_enabled: false,
            announcements_enabled: true,
            profile_public: false,
            referrals_enabled: false
        },
        settings: {
            points_per_scan: 10,
            points_per_dollar: 1,
            daily_scan_limit: 5,
            welcome_points: 50,
            require_email: true,
            require_phone: false,
            tier_thresholds: {
                silver: 500,
                gold: 1500,
                platinum: 5000
            }
        }
    },
    {
        id: 'rewards-club',
        name: 'Rewards Club',
        description: 'Offer redeemable rewards for loyal customers. Great for businesses with a variety of perks to offer.',
        app_type: 'rewards',
        icon: 'gift',
        industries: ['retail', 'food', 'service'],
        features: {
            points_enabled: true,
            leaderboard_enabled: false,
            rewards_enabled: true,
            menu_enabled: true,
            announcements_enabled: true,
            profile_public: false,
            referrals_enabled: true
        },
        settings: {
            points_per_scan: 25,
            points_per_dollar: 2,
            daily_scan_limit: 3,
            welcome_points: 100,
            require_email: true,
            require_phone: true,
            tier_thresholds: {
                silver: 300,
                gold: 1000,
                platinum: 3000
            }
        }
    },
    {
        id: 'vip-membership',
        name: 'VIP Membership',
        description: 'Exclusive access and perks for your best customers. Ideal for premium experiences.',
        app_type: 'membership',
        icon: 'crown',
        industries: ['service', 'health', 'food'],
        features: {
            points_enabled: false,
            leaderboard_enabled: false,
            rewards_enabled: false,
            menu_enabled: true,
            announcements_enabled: true,
            profile_public: false,
            referrals_enabled: false
        },
        settings: {
            points_per_scan: 0,
            points_per_dollar: 0,
            daily_scan_limit: 10,
            welcome_points: 0,
            require_email: true,
            require_phone: true,
            tier_thresholds: {
                silver: 0,
                gold: 0,
                platinum: 0
            }
        }
    },
    {
        id: 'cafe-rewards',
        name: 'Cafe Rewards',
        description: 'Buy 9, get the 10th free. Classic punch card style loyalty for coffee shops.',
        app_type: 'loyalty',
        icon: 'coffee',
        industries: ['food'],
        features: {
            points_enabled: true,
            leaderboard_enabled: true,
            rewards_enabled: true,
            menu_enabled: true,
            announcements_enabled: true,
            profile_public: false,
            referrals_enabled: false
        },
        settings: {
            points_per_scan: 1,
            points_per_dollar: 0,
            daily_scan_limit: 5,
            welcome_points: 1,
            require_email: true,
            require_phone: false,
            tier_thresholds: {
                silver: 50,
                gold: 150,
                platinum: 500
            }
        }
    },
    {
        id: 'fitness-club',
        name: 'Fitness Club',
        description: 'Track gym visits and reward consistent members. Perfect for gyms and wellness centers.',
        app_type: 'membership',
        icon: 'activity',
        industries: ['health'],
        features: {
            points_enabled: true,
            leaderboard_enabled: true,
            rewards_enabled: true,
            menu_enabled: false,
            announcements_enabled: true,
            profile_public: true,
            referrals_enabled: true
        },
        settings: {
            points_per_scan: 10,
            points_per_dollar: 0,
            daily_scan_limit: 2,
            welcome_points: 25,
            require_email: true,
            require_phone: false,
            tier_thresholds: {
                silver: 200,
                gold: 500,
                platinum: 1000
            }
        }
    },
    {
        id: 'restaurant-rewards',
        name: 'Restaurant Rewards',
        description: 'Earn points on every meal, redeem for free dishes. Perfect for dine-in establishments.',
        app_type: 'loyalty',
        icon: 'utensils',
        industries: ['food'],
        features: {
            points_enabled: true,
            leaderboard_enabled: false,
            rewards_enabled: true,
            menu_enabled: true,
            announcements_enabled: true,
            profile_public: false,
            referrals_enabled: true
        },
        settings: {
            points_per_scan: 0,
            points_per_dollar: 5,
            daily_scan_limit: 3,
            welcome_points: 50,
            require_email: true,
            require_phone: true,
            tier_thresholds: {
                silver: 500,
                gold: 2000,
                platinum: 5000
            }
        }
    },
    // Newsletter / Blogger Templates
    {
        id: 'newsletter-standard',
        name: 'Newsletter',
        description: 'Share updates, articles, and insights with your audience. Perfect for businesses and creators.',
        app_type: 'newsletter',
        icon: 'mail',
        industries: ['all'],
        features: {
            articles_enabled: true,
            series_enabled: true,
            topics_enabled: true,
            subscriber_signup: true,
            comments_enabled: false,
            multi_language: false,
            email_campaigns: true,
            dynamic_embeds: true
        },
        settings: {
            default_language: 'en',
            enabled_languages: ['en'],
            publish_frequency: 'weekly',
            double_optin: true,
            welcome_email_enabled: true,
            ai_topic_enabled: false,
            max_subscribers: 1000
        }
    },
    {
        id: 'company-blog',
        name: 'Company Blog',
        description: 'SEO-optimized blog with categories, series, and subscriber management. Build your content authority.',
        app_type: 'newsletter',
        icon: 'file-text',
        industries: ['all'],
        features: {
            articles_enabled: true,
            series_enabled: true,
            topics_enabled: true,
            subscriber_signup: true,
            comments_enabled: true,
            multi_language: true,
            email_campaigns: true,
            dynamic_embeds: true
        },
        settings: {
            default_language: 'en',
            enabled_languages: ['en', 'es', 'fr'],
            publish_frequency: 'weekly',
            double_optin: true,
            welcome_email_enabled: true,
            ai_topic_enabled: true,
            max_subscribers: 5000
        }
    },
    {
        id: 'creator-newsletter',
        name: 'Creator Newsletter',
        description: 'Grow your audience with a personal newsletter. Share your expertise and build a community.',
        app_type: 'newsletter',
        icon: 'pen-tool',
        industries: ['all'],
        features: {
            articles_enabled: true,
            series_enabled: true,
            topics_enabled: false,
            subscriber_signup: true,
            comments_enabled: true,
            multi_language: false,
            email_campaigns: true,
            dynamic_embeds: false
        },
        settings: {
            default_language: 'en',
            enabled_languages: ['en'],
            publish_frequency: 'weekly',
            double_optin: true,
            welcome_email_enabled: true,
            ai_topic_enabled: false,
            max_subscribers: 2500
        }
    },
    {
        id: 'industry-insights',
        name: 'Industry Insights',
        description: 'Establish thought leadership with in-depth industry analysis and trends. Great for B2B.',
        app_type: 'newsletter',
        icon: 'trending-up',
        industries: ['service', 'technology'],
        features: {
            articles_enabled: true,
            series_enabled: true,
            topics_enabled: true,
            subscriber_signup: true,
            comments_enabled: false,
            multi_language: true,
            email_campaigns: true,
            dynamic_embeds: true
        },
        settings: {
            default_language: 'en',
            enabled_languages: ['en', 'es', 'de', 'fr'],
            publish_frequency: 'biweekly',
            double_optin: true,
            welcome_email_enabled: true,
            ai_topic_enabled: true,
            max_subscribers: 10000
        }
    }
];

/**
 * Get all app templates
 */
function getAllAppTemplates() {
    return APP_TEMPLATES_LIBRARY;
}

/**
 * Get app templates filtered by industry
 */
function getAppTemplatesByIndustry(industry) {
    if (!industry) return APP_TEMPLATES_LIBRARY;

    return APP_TEMPLATES_LIBRARY.filter(template =>
        template.industries.includes('all') ||
        template.industries.includes(industry)
    );
}

/**
 * Get an app template by its ID
 */
function getAppTemplateById(templateId) {
    return APP_TEMPLATES_LIBRARY.find(t => t.id === templateId);
}

/**
 * Get app templates by type
 */
function getAppTemplatesByType(type) {
    if (!type) return APP_TEMPLATES_LIBRARY;
    return APP_TEMPLATES_LIBRARY.filter(t => t.app_type === type);
}

/**
 * Get suggested app templates based on business description
 */
function getSuggestedAppTemplates(businessDescription, industry) {
    const desc = (businessDescription || '').toLowerCase();

    // Keyword mapping to templates
    const keywords = {
        'coffee': ['cafe-rewards', 'loyalty-points'],
        'cafe': ['cafe-rewards', 'loyalty-points'],
        'restaurant': ['restaurant-rewards', 'loyalty-points'],
        'food': ['restaurant-rewards', 'loyalty-points'],
        'gym': ['fitness-club', 'vip-membership'],
        'fitness': ['fitness-club', 'vip-membership'],
        'health': ['fitness-club', 'vip-membership'],
        'wellness': ['fitness-club', 'vip-membership'],
        'retail': ['rewards-club', 'loyalty-points'],
        'shop': ['rewards-club', 'loyalty-points'],
        'store': ['rewards-club', 'loyalty-points'],
        'salon': ['vip-membership', 'loyalty-points'],
        'spa': ['vip-membership', 'loyalty-points'],
        'bar': ['loyalty-points', 'rewards-club'],
        'pub': ['loyalty-points', 'rewards-club'],
        // Newsletter keywords
        'blog': ['company-blog', 'creator-newsletter'],
        'newsletter': ['newsletter-standard', 'creator-newsletter'],
        'content': ['company-blog', 'industry-insights'],
        'articles': ['company-blog', 'newsletter-standard'],
        'updates': ['newsletter-standard', 'company-blog'],
        'insights': ['industry-insights', 'company-blog'],
        'thought leader': ['industry-insights', 'company-blog'],
        'creator': ['creator-newsletter', 'newsletter-standard'],
        'audience': ['creator-newsletter', 'newsletter-standard'],
        'subscribe': ['newsletter-standard', 'creator-newsletter']
    };

    const matchedTemplateIds = new Set();

    // Match keywords
    for (const [keyword, templateIds] of Object.entries(keywords)) {
        if (desc.includes(keyword)) {
            templateIds.forEach(id => matchedTemplateIds.add(id));
        }
    }

    // Filter by industry if provided
    if (industry) {
        const industryTemplates = getAppTemplatesByIndustry(industry);
        industryTemplates.forEach(t => matchedTemplateIds.add(t.id));
    }

    // Get matched templates
    const suggestions = [];
    for (const id of matchedTemplateIds) {
        const template = getAppTemplateById(id);
        if (template) suggestions.push(template);
    }

    // If no matches, return top 3 defaults
    if (suggestions.length === 0) {
        return [
            getAppTemplateById('loyalty-points'),
            getAppTemplateById('rewards-club'),
            getAppTemplateById('vip-membership')
        ].filter(Boolean);
    }

    return suggestions.slice(0, 5);
}

// Make functions available globally
window.APP_TEMPLATES_LIBRARY = APP_TEMPLATES_LIBRARY;
window.getAllAppTemplates = getAllAppTemplates;
window.getAppTemplatesByIndustry = getAppTemplatesByIndustry;
window.getAppTemplateById = getAppTemplateById;
window.getAppTemplatesByType = getAppTemplatesByType;
window.getSuggestedAppTemplates = getSuggestedAppTemplates;
