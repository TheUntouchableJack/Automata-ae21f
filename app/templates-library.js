// ===== Templates Library for Automations =====
// 12 pre-built automation templates

const TEMPLATES_LIBRARY = [
    {
        id: 'birthday-rewards',
        name: 'Birthday Rewards',
        description: 'Automatically send personalized birthday greetings with special offers to celebrate your customers on their special day.',
        icon: 'birthday',
        type: 'email',
        frequency: 'daily',
        industries: ['all'],
        targetSegment: 'all',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            triggerField: 'birthday',
            daysBeforeOrAfter: 0
        }
    },
    {
        id: 'loyalty-program',
        name: 'Loyalty Program',
        description: 'Reward your best customers with exclusive perks, points updates, and VIP offers to increase retention.',
        icon: 'loyalty',
        type: 'workflow',
        frequency: 'weekly',
        industries: ['retail', 'food'],
        targetSegment: 'tag:vip',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            pointsThreshold: 100
        }
    },
    {
        id: 'happy-hour-alerts',
        name: 'Happy Hour Alerts',
        description: 'Send timely notifications about happy hour specials, daily deals, and limited-time offers.',
        icon: 'promotion',
        type: 'email',
        frequency: 'daily',
        industries: ['food'],
        targetSegment: 'all',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            sendTime: '15:00'
        }
    },
    {
        id: 'appointment-reminders',
        name: 'Appointment Reminders',
        description: 'Reduce no-shows with automated reminders sent before scheduled appointments.',
        icon: 'appointment',
        type: 'email',
        frequency: 'daily',
        industries: ['health', 'service'],
        targetSegment: 'project',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            reminderDays: [1, 7]
        }
    },
    {
        id: 'post-visit-follow-up',
        name: 'Post-Visit Follow-up',
        description: 'Engage customers after their visit with thank you messages and requests for feedback.',
        icon: 'follow_up',
        type: 'email',
        frequency: 'daily',
        industries: ['all'],
        targetSegment: 'project',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            daysAfterVisit: 1
        }
    },
    {
        id: 'win-back-campaign',
        name: 'Win-Back Campaign',
        description: 'Re-engage inactive customers with personalized offers to bring them back.',
        icon: 'win_back',
        type: 'email',
        frequency: 'weekly',
        industries: ['all'],
        targetSegment: 'tag:inactive',
        difficulty: 'medium',
        estimatedCost: '$0',
        timeframe: '2-3 days',
        config: {
            inactiveDays: 30
        }
    },
    {
        id: 'welcome-series',
        name: 'Welcome Series',
        description: 'Onboard new customers with a warm welcome sequence introducing your brand and offerings.',
        icon: 'welcome',
        type: 'email',
        frequency: 'daily',
        industries: ['all'],
        targetSegment: 'tag:new',
        difficulty: 'medium',
        estimatedCost: '$0',
        timeframe: '3-5 days',
        config: {
            emailCount: 3,
            daysBetween: 2
        }
    },
    {
        id: 'monthly-newsletter',
        name: 'Monthly Newsletter',
        description: 'Keep customers informed with monthly updates, news, and curated content.',
        icon: 'newsletter',
        type: 'email',
        frequency: 'monthly',
        industries: ['all'],
        targetSegment: 'all',
        difficulty: 'medium',
        estimatedCost: '$0',
        timeframe: '1 week',
        config: {
            sendDay: 1
        }
    },
    {
        id: 'review-request',
        name: 'Review Request',
        description: 'Collect valuable feedback by asking satisfied customers for reviews and ratings.',
        icon: 'feedback',
        type: 'email',
        frequency: 'weekly',
        industries: ['all'],
        targetSegment: 'project',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            daysAfterPurchase: 7
        }
    },
    {
        id: 'renewal-reminder',
        name: 'Renewal Reminder',
        description: 'Prevent churn by reminding customers when their subscription or membership is about to expire.',
        icon: 'renewal',
        type: 'email',
        frequency: 'daily',
        industries: ['service'],
        targetSegment: 'project',
        difficulty: 'medium',
        estimatedCost: '$0',
        timeframe: '2-3 days',
        config: {
            reminderDays: [30, 7, 1]
        }
    },
    {
        id: 'abandoned-cart',
        name: 'Abandoned Cart',
        description: 'Recover lost sales by reminding customers about items left in their shopping cart.',
        icon: 'cart',
        type: 'email',
        frequency: 'daily',
        industries: ['retail'],
        targetSegment: 'all',
        difficulty: 'hard',
        estimatedCost: '$50/mo',
        timeframe: '1-2 weeks',
        config: {
            hoursAfterAbandon: 24
        }
    },
    {
        id: 'thank-you-note',
        name: 'Thank You Note',
        description: 'Show appreciation with personalized thank you messages after purchases or interactions.',
        icon: 'thank_you',
        type: 'email',
        frequency: 'daily',
        industries: ['all'],
        targetSegment: 'project',
        difficulty: 'easy',
        estimatedCost: '$0',
        timeframe: '1 day',
        config: {
            triggerEvent: 'purchase'
        }
    }
];

/**
 * Get all templates
 */
function getAllTemplates() {
    return TEMPLATES_LIBRARY;
}

/**
 * Get templates filtered by industry
 */
function getTemplatesByIndustry(industry) {
    if (!industry) return TEMPLATES_LIBRARY;

    return TEMPLATES_LIBRARY.filter(template =>
        template.industries.includes('all') ||
        template.industries.includes(industry)
    );
}

/**
 * Get a template by its ID
 */
function getTemplateById(templateId) {
    return TEMPLATES_LIBRARY.find(t => t.id === templateId);
}

/**
 * Get templates filtered by type
 */
function getTemplatesByType(type) {
    if (!type) return TEMPLATES_LIBRARY;
    return TEMPLATES_LIBRARY.filter(t => t.type === type);
}

// Make functions available globally
window.TEMPLATES_LIBRARY = TEMPLATES_LIBRARY;
window.getAllTemplates = getAllTemplates;
window.getTemplatesByIndustry = getTemplatesByIndustry;
window.getTemplateById = getTemplateById;
window.getTemplatesByType = getTemplatesByType;
