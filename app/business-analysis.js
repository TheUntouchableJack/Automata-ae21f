// ===== Business Analysis Module =====
// Calls analyze-business-signup edge function and renders AI analysis
// into the signup page's left panel. Supports language switching,
// animated metrics, interactive opportunity cards, and staggered animations.

const BusinessAnalysis = (function() {
    const CACHE_PREFIX = 'royalty_signup_analysis';
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — only re-fetch on new onboarding
    const TIMEOUT_MS = 30000; // 30s — edge function needs time for cold start + AI
    let currentLang = 'en';
    let oppsListenerAttached = false;

    // Icon SVGs for opportunity types
    const ICONS = {
        loyalty: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
        automation: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        insights: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 3V9H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8L18 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        growth: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 12H18L15 21L9 3L6 12H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        engagement: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 21V19C17 17.9 16.1 17 15 17H9C7.9 17 7 17.9 7 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="11" r="4" stroke="currentColor" stroke-width="2"/><path d="M22 21V19C22 17.9 21.1 17 20 17H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 21V19C2 17.9 2.9 17 4 17H5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        retention: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 8L21 3M21 3V8M21 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    // Icon SVGs for impact metrics
    const METRIC_ICONS = {
        revenue: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2V22M17 5H9.5C8.57 5 7.68 5.37 7.02 6.02C6.37 6.68 6 7.57 6 8.5C6 9.43 6.37 10.32 7.02 10.98C7.68 11.63 8.57 12 9.5 12H14.5C15.43 12 16.32 12.37 16.98 13.02C17.63 13.68 18 14.57 18 15.5C18 16.43 17.63 17.32 16.98 17.98C16.32 18.63 15.43 19 14.5 19H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        retention: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 1L21 5L17 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11V9C3 7.93 3.42 6.93 4.17 6.17C4.93 5.42 5.93 5 7 5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 23L3 19L7 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13V15C21 16.07 20.58 17.07 19.83 17.83C19.07 18.58 18.07 19 17 19H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        engagement: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 12H18L15 21L9 3L6 12H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Cache (language-aware) ──

    function getCacheKey(lang) {
        return `${CACHE_PREFIX}_${lang || currentLang}`;
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
            const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];
            langs.forEach(l => localStorage.removeItem(getCacheKey(l)));
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
                language: language || currentLang
            }
        });

        const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

        if (error) throw error;
        if (!data?.success || !data?.analysis) throw new Error('Invalid response');

        return data.analysis;
    }

    // ── Sparkline generator ──

    function generateSparklineSVG(numericValue, color) {
        const seed = numericValue || 50;
        const base = Math.max(10, seed * 0.3);
        const points = [
            base * 0.4, base * 0.55, base * 0.45,
            base * 0.7, base * 0.85, base * 1.0
        ];
        const maxY = Math.max(...points);
        const coords = points.map((p, i) =>
            `${(i / (points.length - 1)) * 76 + 2},${24 - (p / maxY) * 20}`
        ).join(' ');

        const colorMap = { green: '#10b981', purple: '#a78bfa', blue: '#60a5fa' };
        const strokeColor = colorMap[color] || colorMap.green;

        return `<svg class="sparkline-svg" width="80" height="24" viewBox="0 0 80 24">
            <polyline points="${coords}" stroke="${strokeColor}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="${coords} 78,24 2,24" stroke="none" fill="${strokeColor}" opacity="0.12"/>
        </svg>`;
    }

    // ── Count-up animation ──

    function animateCountUp(element) {
        const target = parseFloat(element.dataset.target) || 0;
        const decimals = parseInt(element.dataset.decimals) || 0;
        const prefix = element.dataset.prefix || '';
        const suffix = element.dataset.suffix || '';
        const duration = 2000;
        const start = performance.now();

        function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const current = target * eased;
            element.textContent = prefix + (decimals > 0 ? current.toFixed(decimals) : Math.round(current)) + suffix;
            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                // Completion flash — scale up and green pulse
                element.classList.add('count-complete');
                setTimeout(() => element.classList.remove('count-complete'), 500);
            }
        }
        requestAnimationFrame(update);
    }

    // ── Render ──

    function render(analysis, businessName) {
        const skeleton = document.getElementById('analysis-skeleton');
        const results = document.getElementById('analysis-results');
        if (!results) return;

        // Business name in heading (use i18n if available)
        const headingEl = results.querySelector('.analysis-heading');
        const name = businessName || 'your business';
        if (headingEl) {
            let headingText = '';
            if (window.I18n) {
                const translated = I18n.t('analysis.heading', { businessName: name });
                // If i18n returns raw key (not yet loaded), use English fallback
                headingText = (translated && !translated.startsWith('analysis.'))
                    ? translated
                    : `Here's what we see for <span>${name}</span>`;
            } else {
                headingText = `Here's what we see for <span>${name}</span>`;
            }
            headingEl.innerHTML = headingText;
            headingEl.dataset.bizName = name; // store for language switch re-render
        }

        // Summary
        const summaryEl = document.getElementById('analysis-summary');
        if (summaryEl) summaryEl.textContent = analysis.businessSummary || '';

        // Impact Metrics (new multi-metric display)
        const metricsContainer = document.getElementById('analysis-metrics');
        if (metricsContainer) {
            const metrics = analysis.impactMetrics || (analysis.keyMetric ? [analysis.keyMetric] : []);
            metricsContainer.innerHTML = metrics.map((m, i) => {
                // Parse value — preserve decimals (e.g. "3.10x" → 3.10, not 310)
                const valStr = String(m.value || '');
                const numMatch = valStr.match(/[\d.]+/);
                const numVal = numMatch ? parseFloat(numMatch[0]) : (m.numericValue || 0);
                const isDecimal = numMatch && numMatch[0].includes('.');
                const decimalPlaces = isDecimal ? (numMatch[0].split('.')[1]?.length || 0) : 0;
                const matchIdx = numMatch ? valStr.indexOf(numMatch[0]) : -1;
                const prefix = matchIdx > 0 ? valStr.substring(0, matchIdx) : '';
                const suffix = matchIdx >= 0 ? valStr.substring(matchIdx + numMatch[0].length) : '';
                const color = m.color || 'green';
                // Normalize bars to 40-90% range for visual consistency
                const barWidth = Math.min(Math.max(numVal <= 10 ? numVal * 10 : numVal, 40), 90);

                return `
                <div class="impact-metric" style="transition-delay: ${i * 150}ms">
                    <div class="impact-metric-icon ${escapeHtml(color)}">
                        ${METRIC_ICONS[m.icon] || METRIC_ICONS.revenue}
                    </div>
                    <div class="impact-metric-body">
                        <div class="impact-metric-value">
                            <span class="metric-number" data-target="${numVal}" data-decimals="${decimalPlaces}" data-prefix="${escapeHtml(prefix)}" data-suffix="${escapeHtml(suffix)}">0</span>
                            <svg class="metric-arrow" width="16" height="16" viewBox="0 0 16 16"><path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </div>
                        <div class="impact-metric-label">${escapeHtml(m.label)}</div>
                        ${m.source ? `<div class="metric-source">${escapeHtml(m.source)}</div>` : ''}
                        <div class="impact-metric-bar">
                            <div class="impact-metric-bar-fill ${escapeHtml(color)}" data-width="${barWidth}"></div>
                        </div>
                    </div>
                    <div class="impact-metric-sparkline">
                        ${generateSparklineSVG(numVal, color)}
                    </div>
                </div>`;
            }).join('');
        }

        // Opportunity cards (with actionSteps for expansion)
        const oppsContainer = document.getElementById('analysis-opportunities');
        if (oppsContainer && analysis.opportunities) {
            oppsContainer.innerHTML = analysis.opportunities.map((opp, i) => `
                <div class="opportunity-card" data-index="${i}">
                    <div class="opportunity-icon">
                        ${ICONS[opp.icon] || ICONS.growth}
                    </div>
                    <div class="opportunity-title">${escapeHtml(opp.title)}</div>
                    <div class="opportunity-desc">${escapeHtml(opp.description)}</div>
                    <div class="opportunity-impact"><svg class="impact-arrow" width="14" height="14" viewBox="0 0 16 16"><path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHtml(opp.impact)}</div>
                    ${opp.actionSteps?.length ? `
                        <div class="opportunity-expand-hint" data-i18n="analysis.expandHint">Click to see the plan</div>
                        <div class="opportunity-action-steps">
                            ${opp.actionSteps.map((step, si) => `
                                <div class="action-step">
                                    <span class="action-step-number">${si + 1}</span>
                                    <span>${escapeHtml(step)}</span>
                                </div>
                            `).join('')}
                            ${opp.source ? `<div class="opportunity-source">${escapeHtml(opp.source)}</div>` : ''}
                        </div>
                    ` : ''}
                </div>
            `).join('');

            // Attach click handler once
            if (!oppsListenerAttached) {
                oppsContainer.addEventListener('click', (e) => {
                    const card = e.target.closest('.opportunity-card');
                    if (!card) return;
                    // Close other expanded cards
                    oppsContainer.querySelectorAll('.opportunity-card.expanded').forEach(c => {
                        if (c !== card) c.classList.remove('expanded');
                    });
                    card.classList.toggle('expanded');
                });
                oppsListenerAttached = true;
            }
        }

        // Platform highlights (replaces old automations list)
        const highlightsList = document.getElementById('highlights-list');
        const highlights = analysis.platformHighlights || analysis.topAutomations || [];
        if (highlightsList && highlights.length) {
            highlightsList.innerHTML = highlights.map(item => `
                <li class="highlight-item">
                    <span class="highlight-check">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M5 12L10 17L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <div class="highlight-reason">${escapeHtml(item.reason)}</div>
                    </div>
                </li>
            `).join('');
        }

        // Transition: hide skeleton, show results with staggered animation
        if (skeleton) skeleton.style.display = 'none';
        results.style.display = 'block';
        results.classList.remove('animate-in');

        // Double rAF ensures the browser has painted the display:block first
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                results.classList.add('animate-in');

                // Trigger metric animations after a short delay
                setTimeout(() => {
                    if (metricsContainer) {
                        metricsContainer.querySelectorAll('.impact-metric').forEach(m => m.classList.add('animate-in'));
                        metricsContainer.querySelectorAll('.metric-number').forEach(el => animateCountUp(el));
                        metricsContainer.querySelectorAll('.impact-metric-bar-fill').forEach(bar => {
                            bar.style.width = bar.dataset.width + '%';
                        });
                    }
                }, 300);
            });
        });
    }

    function showFallback() {
        const skeleton = document.getElementById('analysis-skeleton');
        const fallback = document.getElementById('analysis-fallback');
        if (skeleton) skeleton.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
    }

    // ── Init ──

    async function init(language) {
        currentLang = language || 'en';
        if (typeof OnboardingStorage === 'undefined') return false;
        const data = OnboardingStorage.get();
        if (!data || !data.businessPrompt) return false;

        const businessName = data.businessDetails?.businessName || '';

        // Check cache first
        const cached = getCached(currentLang);
        if (cached) {
            render(cached, businessName);
            return true;
        }

        // Fire API call
        try {
            const analysis = await fetchAnalysis(data, currentLang);
            setCache(analysis, currentLang);
            render(analysis, businessName);
            return true;
        } catch (e) {
            console.error('Business analysis failed:', e);
            showFallback();
            return false;
        }
    }

    // ── Language refresh ──

    async function refresh(language) {
        currentLang = language || 'en';
        if (typeof OnboardingStorage === 'undefined') return false;
        const data = OnboardingStorage.get();
        if (!data || !data.businessPrompt) return false;

        const businessName = data.businessDetails?.businessName || '';

        // Check cache for this language
        const cached = getCached(currentLang);
        if (cached) {
            render(cached, businessName);
            return true;
        }

        // Show skeleton while re-fetching
        const skeleton = document.getElementById('analysis-skeleton');
        const results = document.getElementById('analysis-results');
        if (results) {
            results.style.display = 'none';
            results.classList.remove('animate-in');
        }
        if (skeleton) skeleton.style.display = 'block';

        try {
            const analysis = await fetchAnalysis(data, currentLang);
            setCache(analysis, currentLang);
            render(analysis, businessName);
            return true;
        } catch (e) {
            console.error('Business analysis refresh failed:', e);
            // Try to re-show previous results
            if (results && results.innerHTML.trim()) {
                results.style.display = 'block';
                results.classList.add('animate-in');
            }
            if (skeleton) skeleton.style.display = 'none';
            return false;
        }
    }

    // Re-render heading on language change (for already-rendered analysis)
    window.addEventListener('i18n:changed', (e) => {
        const headingEl = document.querySelector('#analysis-results .analysis-heading');
        if (headingEl && headingEl.dataset.bizName && window.I18n) {
            const translated = I18n.t('analysis.heading', { businessName: headingEl.dataset.bizName });
            if (translated && !translated.startsWith('analysis.')) {
                headingEl.innerHTML = translated;
            }
        }
    });

    return { init, clearCache, getCached, refresh };
})();

window.BusinessAnalysis = BusinessAnalysis;
