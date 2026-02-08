// ===== Onboarding Processor Module =====
// Process pending onboarding data after successful signup

const OnboardingProcessor = (function() {
    // Template definitions (must match ai-recommendations.js)
    const TEMPLATE_DEFINITIONS = {
        'birthday-rewards': {
            name: 'Birthday Rewards',
            description: 'Send personalized birthday offers to customers',
            type: 'scheduled',
            frequency: 'daily',
            icon: 'cake'
        },
        'loyalty-program': {
            name: 'Loyalty Points Program',
            description: 'Reward repeat customers automatically',
            type: 'triggered',
            frequency: 'on_purchase',
            icon: 'star'
        },
        'happy-hour': {
            name: 'Happy Hour Alerts',
            description: 'Notify nearby customers about happy hour specials',
            type: 'scheduled',
            frequency: 'daily',
            icon: 'location'
        },
        'appointment-reminders': {
            name: 'Appointment Reminders',
            description: 'Reduce no-shows with automated reminders',
            type: 'scheduled',
            frequency: 'daily',
            icon: 'calendar'
        },
        'post-visit': {
            name: 'Post-Visit Follow-up',
            description: 'Thank customers after their visit and ask for feedback',
            type: 'triggered',
            frequency: 'on_visit',
            icon: 'mail'
        },
        'win-back': {
            name: 'Win-Back Campaign',
            description: 'Re-engage customers who haven\'t visited in 30+ days',
            type: 'scheduled',
            frequency: 'weekly',
            icon: 'refresh'
        },
        'referral-program': {
            name: 'Referral Program',
            description: 'Encourage customers to refer friends with rewards',
            type: 'triggered',
            frequency: 'on_referral',
            icon: 'users'
        },
        'review-request': {
            name: 'Review Request',
            description: 'Ask happy customers for reviews at the right time',
            type: 'triggered',
            frequency: 'on_visit',
            icon: 'star'
        },
        'new-product': {
            name: 'New Product Announcements',
            description: 'Notify customers about new menu items or products',
            type: 'manual',
            frequency: 'on_demand',
            icon: 'sparkle'
        },
        'welcome-series': {
            name: 'Welcome Series',
            description: 'Onboard new customers with a series of welcome emails',
            type: 'triggered',
            frequency: 'on_signup',
            icon: 'mail'
        },
        'seasonal-promo': {
            name: 'Seasonal Promotions',
            description: 'Run targeted campaigns for holidays and seasons',
            type: 'scheduled',
            frequency: 'monthly',
            icon: 'sun'
        },
        'vip-program': {
            name: 'VIP Program',
            description: 'Exclusive perks for your most valuable customers',
            type: 'triggered',
            frequency: 'on_milestone',
            icon: 'crown'
        }
    };

    /**
     * Check if there's pending onboarding data
     */
    function hasPendingOnboarding() {
        if (typeof OnboardingStorage === 'undefined') return false;
        return OnboardingStorage.isComplete();
    }

    /**
     * Get the pending onboarding data
     */
    function getPendingData() {
        if (typeof OnboardingStorage === 'undefined') return null;
        return OnboardingStorage.get();
    }

    /**
     * Generate a project name from business context
     */
    function generateProjectName(businessContext) {
        if (businessContext?.industry) {
            const industryNames = {
                food: 'My Restaurant',
                retail: 'My Store',
                health: 'My Practice',
                service: 'My Business',
                technology: 'My Tech Company',
                education: 'My School'
            };
            return industryNames[businessContext.industry] || 'My Business';
        }
        return 'My Business';
    }

    /**
     * Process pending onboarding after signup
     * Creates a project and automations from selected templates
     *
     * @param {string} organizationId - The user's organization ID
     * @param {object} supabase - Supabase client instance
     * @returns {Promise<{project: object, automations: array}|null>}
     */
    async function process(organizationId, supabase) {
        const data = getPendingData();
        if (!data || !data.selectedTemplates?.length) {
            return null;
        }

        try {
            // 1. Create project with business context
            const projectName = generateProjectName(data.businessContext);
            const projectDescription = data.businessPrompt || '';

            const { data: project, error: projectError } = await supabase
                .from('projects')
                .insert({
                    organization_id: organizationId,
                    name: projectName,
                    description: projectDescription,
                    is_active: true
                })
                .select()
                .single();

            if (projectError) {
                throw projectError;
            }

            // 2. Create automations from selected templates
            const automations = [];
            for (const templateId of data.selectedTemplates) {
                const template = TEMPLATE_DEFINITIONS[templateId];
                if (!template) {
                    continue;
                }

                const { data: automation, error: automationError } = await supabase
                    .from('automations')
                    .insert({
                        project_id: project.id,
                        name: template.name,
                        description: template.description,
                        type: template.type,
                        frequency: template.frequency,
                        icon: template.icon,
                        template_id: templateId,
                        is_active: false // Start as draft
                    })
                    .select()
                    .single();

                if (!automationError) {
                    automations.push(automation);
                }
            }

            // 3. Clear onboarding data
            if (typeof OnboardingStorage !== 'undefined') {
                OnboardingStorage.clear();
            }

            return { project, automations };
        } catch (error) {
            return null;
        }
    }

    /**
     * Get template definition by ID
     */
    function getTemplateById(templateId) {
        return TEMPLATE_DEFINITIONS[templateId] || null;
    }

    /**
     * Get all template definitions
     */
    function getAllTemplates() {
        return { ...TEMPLATE_DEFINITIONS };
    }

    // Public API
    return {
        hasPendingOnboarding,
        getPendingData,
        process,
        getTemplateById,
        getAllTemplates,
        generateProjectName
    };
})();

// Make available globally
window.OnboardingProcessor = OnboardingProcessor;
