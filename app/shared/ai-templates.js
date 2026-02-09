/**
 * Shared AI Recommendation Templates
 * Used by crown-dashboard.js, intelligence.js, and ai-feed.js
 *
 * Defines what gets created when accepting automation recommendation cards.
 */
(function() {
    'use strict';

    window.AI_TEMPLATES = {
        'welcome-email': {
            projectName: 'Customer Onboarding',
            projectDesc: 'Automated welcome and onboarding for new customers',
            automation: {
                name: 'Welcome Email Series',
                description: 'Automatically welcome new customers with a personalized email series',
                type: 'email',
                frequency: 'daily',
                icon: 'welcome',
                template_id: 'welcome-series'
            }
        },
        'follow-up': {
            projectName: 'Customer Follow-ups',
            projectDesc: 'Automated follow-up communications after customer interactions',
            automation: {
                name: 'Post-Visit Follow-up',
                description: 'Send thank you messages and collect feedback after visits',
                type: 'email',
                frequency: 'daily',
                icon: 'follow_up',
                template_id: 'post-visit-follow-up'
            }
        },
        're-engagement': {
            projectName: 'Customer Retention',
            projectDesc: 'Win back inactive customers and prevent churn',
            automation: {
                name: 'Win-Back Campaign',
                description: 'Re-engage customers who haven\'t visited in 30+ days',
                type: 'email',
                frequency: 'weekly',
                icon: 'win_back',
                template_id: 'win-back-campaign'
            }
        },
        'birthday': {
            projectName: 'Customer Celebrations',
            projectDesc: 'Celebrate customer milestones and special days',
            automation: {
                name: 'Birthday Rewards',
                description: 'Send personalized birthday greetings with special offers',
                type: 'email',
                frequency: 'daily',
                icon: 'birthday',
                template_id: 'birthday-rewards'
            }
        },
        'review-request': {
            projectName: 'Reputation Management',
            projectDesc: 'Build your online reputation through customer reviews',
            automation: {
                name: 'Review Requests',
                description: 'Ask satisfied customers for reviews at the right time',
                type: 'email',
                frequency: 'weekly',
                icon: 'feedback',
                template_id: 'review-request'
            }
        },
        'newsletter': {
            projectName: 'Customer Communications',
            projectDesc: 'Keep customers informed and engaged',
            automation: {
                name: 'Monthly Newsletter',
                description: 'Monthly updates, news, and curated content for your audience',
                type: 'email',
                frequency: 'monthly',
                icon: 'newsletter',
                template_id: 'monthly-newsletter'
            }
        },
        'loyalty': {
            projectName: 'Loyalty Program',
            projectDesc: 'Reward and retain your best customers',
            automation: {
                name: 'Loyalty Rewards',
                description: 'Automatically reward customers with points and VIP perks',
                type: 'workflow',
                frequency: 'weekly',
                icon: 'loyalty',
                template_id: 'loyalty-program'
            }
        },
        'thank-you': {
            projectName: 'Customer Appreciation',
            projectDesc: 'Show gratitude to your customers',
            automation: {
                name: 'Thank You Notes',
                description: 'Send personalized thank you messages after visits',
                type: 'email',
                frequency: 'daily',
                icon: 'thank_you',
                template_id: 'thank-you-note'
            }
        }
    };
})();
