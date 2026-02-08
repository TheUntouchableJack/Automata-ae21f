// ===== Onboarding Storage Module =====
// LocalStorage-based persistence for pre-signup onboarding data

const OnboardingStorage = (function() {
    const STORAGE_KEY = 'royalty_onboarding';
    const EXPIRY_DAYS = 7;
    const VERSION = 1;

    // Default data structure
    function getDefaultData() {
        const now = Date.now();
        return {
            version: VERSION,
            businessPrompt: '',
            businessContext: {
                industry: '',
                description: '',
                goals: [],
                painPoints: [],
                targetMarket: '',
                location: ''
            },
            selectedTemplates: [],
            customAutomation: '', // User-described custom automation
            aiRecommendations: [],
            businessDetails: {
                businessName: '',
                businessType: '',
                customerCount: '',
                websiteUrl: ''
            },
            createdAt: now,
            expiresAt: now + (EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        };
    }

    // Get onboarding data with expiry check
    function get() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;

            const data = JSON.parse(stored);

            // Check version compatibility
            if (data.version !== VERSION) {
                clear();
                return null;
            }

            // Check expiry
            if (data.expiresAt && Date.now() > data.expiresAt) {
                clear();
                return null;
            }

            return data;
        } catch (e) {
            console.warn('Error reading onboarding data:', e);
            return null;
        }
    }

    // Save onboarding data (merges with existing)
    function save(updates) {
        try {
            const existing = get() || getDefaultData();
            const merged = deepMerge(existing, updates);

            // Update timestamps
            if (!merged.createdAt) {
                merged.createdAt = Date.now();
            }
            merged.expiresAt = Date.now() + (EXPIRY_DAYS * 24 * 60 * 60 * 1000);

            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            return merged;
        } catch (e) {
            console.warn('Error saving onboarding data:', e);
            return null;
        }
    }

    // Clear onboarding data
    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('Error clearing onboarding data:', e);
        }
    }

    // Check if onboarding is in progress
    function isInProgress() {
        const data = get();
        return data !== null && (
            data.businessPrompt.trim() !== '' ||
            data.selectedTemplates.length > 0
        );
    }

    // Check if onboarding has minimum data to proceed to signup
    // AI auto-selects templates, so we only require a business prompt
    function isComplete() {
        const data = get();
        return data !== null && data.businessPrompt.trim() !== '';
    }

    // Get selected template IDs
    function getSelectedTemplates() {
        const data = get();
        return data?.selectedTemplates || [];
    }

    // Get total selection count (templates + custom if filled)
    function getSelectionCount() {
        const data = get();
        const templateCount = data?.selectedTemplates?.length || 0;
        const hasCustom = data?.customAutomation?.trim()?.length > 0 ? 1 : 0;
        return templateCount + hasCustom;
    }

    // Set custom automation description
    function setCustomAutomation(description) {
        save({ customAutomation: description || '' });
    }

    // Get custom automation description
    function getCustomAutomation() {
        const data = get();
        return data?.customAutomation || '';
    }

    // Check if can add more selections (unlimited)
    function canAddMore() {
        return true;
    }

    // Add a template to selection
    function addTemplate(templateId) {
        const data = get() || getDefaultData();
        if (!data.selectedTemplates.includes(templateId)) {
            data.selectedTemplates.push(templateId);
            save(data);
        }
        return true;
    }

    // Remove a template from selection
    function removeTemplate(templateId) {
        const data = get();
        if (!data) return;

        data.selectedTemplates = data.selectedTemplates.filter(id => id !== templateId);
        save(data);
    }

    // Toggle template selection
    function toggleTemplate(templateId) {
        const data = get() || getDefaultData();
        if (data.selectedTemplates.includes(templateId)) {
            removeTemplate(templateId);
            return false;
        } else {
            return addTemplate(templateId);
        }
    }

    // Set business prompt
    function setBusinessPrompt(prompt) {
        save({ businessPrompt: prompt });
    }

    // Set business context
    function setBusinessContext(context) {
        save({ businessContext: context });
    }

    // Set business details (info-gathering step)
    function setBusinessDetails(details) {
        save({ businessDetails: details || {} });
    }

    // Get business details
    function getBusinessDetails() {
        const data = get();
        return data?.businessDetails || {};
    }

    // Set AI recommendations (cache them)
    function setRecommendations(recommendations) {
        save({ aiRecommendations: recommendations });
    }

    // Get days until expiry
    function getDaysUntilExpiry() {
        const data = get();
        if (!data?.expiresAt) return 0;
        const msRemaining = data.expiresAt - Date.now();
        return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
    }

    // Deep merge helper
    function deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    // Public API
    return {
        get,
        save,
        clear,
        isInProgress,
        isComplete,
        getSelectedTemplates,
        getSelectionCount,
        addTemplate,
        removeTemplate,
        toggleTemplate,
        setBusinessPrompt,
        setBusinessContext,
        setRecommendations,
        setCustomAutomation,
        getCustomAutomation,
        setBusinessDetails,
        getBusinessDetails,
        canAddMore,
        getDaysUntilExpiry
    };
})();

// Make available globally
window.OnboardingStorage = OnboardingStorage;
