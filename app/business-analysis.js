// ===== Business Analysis Module =====
// Holds the AI business analysis (analyze-business-signup) in a language-aware
// localStorage cache. OnboardingSave.commit() reads it after signup and stores
// it as ai_recommendations + projects.settings.signup_analysis.
//
// 2026-11-22: this module no longer renders anything. The signup page used to
// gate the form behind a full-screen analysis report (and, whenever the AI step
// failed, a generic four-card "Your Royalty Platform" report). It now shows the
// visitor's own app next to the form instead (see signup-preview.js), so all
// that is left here is the cache, plus a silent prefetch for visitors whose
// homepage analysis didn't finish, so the data still reaches their account.

const BusinessAnalysis = (function() {
    const CACHE_PREFIX = 'royalty_signup_analysis';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — only re-fetch on new onboarding
    const TIMEOUT_MS = 30000; // 30s — edge function needs time for cold start + AI
    const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];
    let inFlight = null;

    // ── Cache (language-aware) ──

    function getCacheKey(lang) {
        return `${CACHE_PREFIX}_${lang || 'en'}`;
    }

    function getCached(lang) {
        try {
            const stored = localStorage.getItem(getCacheKey(lang));
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (parsed.status === 'complete' && parsed.analysis &&
                (Date.now() - parsed.timestamp) < CACHE_TTL) {
                return parsed.analysis;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function getAnyCached() {
        for (const l of LANGS) {
            const hit = getCached(l);
            if (hit) return hit;
        }
        return null;
    }

    function setCache(analysis, lang) {
        try {
            localStorage.setItem(getCacheKey(lang), JSON.stringify({
                status: 'complete',
                timestamp: Date.now(),
                analysis
            }));
        } catch (e) { /* ignore */ }
    }

    function clearCache() {
        try {
            LANGS.forEach(l => localStorage.removeItem(getCacheKey(l)));
            // Also clear the old non-language key
            localStorage.removeItem(CACHE_PREFIX);
        } catch (e) { /* ignore */ }
    }

    // ── API ──

    async function fetchAnalysis(onboardingData, language) {
        const client = window.supabase || window.db;
        if (!client || !client.functions) {
            throw new Error('Supabase client not available');
        }

        // Real timeout using Promise.race (AbortController doesn't work with functions.invoke)
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Analysis timeout')), TIMEOUT_MS)
        );

        const fetchPromise = client.functions.invoke('analyze-business-signup', {
            body: {
                businessPrompt: onboardingData.businessPrompt || '',
                businessContext: {
                    industry: onboardingData.businessContext?.industry || '',
                    goals: onboardingData.businessContext?.goals || [],
                    painPoints: onboardingData.businessContext?.painPoints || []
                },
                businessDetails: {
                    businessName: onboardingData.businessDetails?.businessName || '',
                    businessType: onboardingData.businessDetails?.businessType || '',
                    customerCount: onboardingData.businessDetails?.customerCount || '',
                    websiteUrl: onboardingData.businessDetails?.websiteUrl || ''
                },
                language: language || 'en'
            }
        });

        const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success || !data?.analysis) throw new Error('Invalid response');

        return data.analysis;
    }

    /**
     * Fetch and cache the analysis in the background if no language has it yet.
     * Never renders, never throws: a failure just means the account is created
     * without the stored analysis, which is what happened before as well.
     * @returns {Promise<boolean>} whether an analysis is cached afterwards
     */
    async function prefetch(language) {
        if (getAnyCached()) return true;
        if (typeof OnboardingStorage === 'undefined') return false;
        const data = OnboardingStorage.get();
        if (!data || !data.businessPrompt) return false;
        if (inFlight) return inFlight;
        inFlight = (async () => {
            try {
                const analysis = await fetchAnalysis(data, language);
                setCache(analysis, language || 'en');
                return true;
            } catch (e) {
                console.warn('Business analysis prefetch failed:', e && e.message ? e.message : e);
                return false;
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    }

    return { getCached, getAnyCached, clearCache, prefetch };
})();

window.BusinessAnalysis = BusinessAnalysis;
