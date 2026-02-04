// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Mobile Menu Toggle =====
const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
const navLinks = document.querySelector('.nav-links');
const navCta = document.querySelector('.nav-cta');

if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        mobileMenuBtn.classList.toggle('active');
        // In a full implementation, this would toggle a mobile menu overlay
    });
}

// ===== Smooth Scroll for Anchor Links =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            e.preventDefault();
            const navHeight = document.querySelector('.navbar').offsetHeight;
            const targetPosition = targetElement.offsetTop - navHeight - 20;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// ===== Navbar Background on Scroll =====
const navbar = document.querySelector('.navbar');

// Throttled scroll handler (optimized - fires at most once per 50ms)
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - lastScrollTime < 50) return;
    lastScrollTime = now;

    if (window.pageYOffset > 100) {
        navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    } else {
        navbar.style.boxShadow = 'none';
    }
});

// ===== Rotating Word Animation =====
// Default English words (used before i18n loads)
let rotatingWords = ['Person', 'Founder', 'Entrepreneur', 'Owner', 'Creator', 'Mother', 'Woman'];
let titleTemplate = 'One {word}.';
let currentWordIndex = 0;
let rotationInterval = null;
const rotatingWordElement = document.getElementById('rotating-word');
const titleLine1Element = document.getElementById('title-line-1');

function updateTitleWithWord(word) {
    if (titleLine1Element && rotatingWordElement) {
        // Split template by {word} and build the structure
        const parts = titleTemplate.split('{word}');
        const beforeWord = parts[0] || '';
        const afterWord = parts[1] || '';

        // Clear and rebuild the title line
        titleLine1Element.innerHTML = '';
        titleLine1Element.appendChild(document.createTextNode(beforeWord));

        const wordSpan = document.createElement('span');
        wordSpan.className = 'rotating-word';
        wordSpan.id = 'rotating-word';
        wordSpan.textContent = word;
        titleLine1Element.appendChild(wordSpan);

        titleLine1Element.appendChild(document.createTextNode(afterWord));
    }
}

function startRotation() {
    if (rotationInterval) clearInterval(rotationInterval);

    const wordSpan = document.getElementById('rotating-word');
    if (!wordSpan || rotatingWords.length === 0) return;

    rotationInterval = setInterval(() => {
        // Fade out and scale down
        wordSpan.style.opacity = '0';
        wordSpan.style.transform = 'translateY(-8px) scale(0.95)';

        setTimeout(() => {
            // Change word
            currentWordIndex = (currentWordIndex + 1) % rotatingWords.length;
            wordSpan.textContent = rotatingWords[currentWordIndex];

            // Fade in and scale up with pop effect
            wordSpan.style.opacity = '1';
            wordSpan.style.transform = 'translateY(0) scale(1)';
        }, 250);
    }, 2500);
}

// Initialize with current language when i18n is ready
function initRotatingWords() {
    if (typeof I18n !== 'undefined' && I18n.t) {
        const translatedWords = I18n.t('hero.rotatingWords');
        const translatedTemplate = I18n.t('hero.titleLine1');

        // Update words array if translation exists and is an array
        if (Array.isArray(translatedWords) && translatedWords.length > 0) {
            rotatingWords = translatedWords;
        }

        // Update template if translation exists
        if (translatedTemplate && translatedTemplate !== 'hero.titleLine1') {
            titleTemplate = translatedTemplate;
        }

        // Reset to first word and update display
        currentWordIndex = 0;
        updateTitleWithWord(rotatingWords[0]);
        startRotation();
    }
}

// Listen for i18n events
window.addEventListener('i18n:ready', initRotatingWords);
window.addEventListener('i18n:changed', initRotatingWords);

// Start rotation immediately with defaults (will be updated when i18n loads)
if (rotatingWordElement) {
    startRotation();
}

// ===== Modal Functions =====
function showSuccessModal() {
    const modal = document.getElementById('success-modal');
    modal.classList.add('active');

    // Trigger confetti - big celebration!
    if (typeof confetti === 'function') {
        const duration = 1000;
        const end = Date.now() + duration;
        const confettiZIndex = 2100; // Above modal (2000)

        // Continuous confetti rain
        const frame = () => {
            confetti({
                particleCount: 4,
                angle: 60,
                spread: 80,
                origin: { x: 0, y: 0.5 },
                colors: ['#7c3aed', '#a855f7', '#a855f7', '#10b981', '#f59e0b'],
                zIndex: confettiZIndex
            });
            confetti({
                particleCount: 4,
                angle: 120,
                spread: 80,
                origin: { x: 1, y: 0.5 },
                colors: ['#7c3aed', '#a855f7', '#a855f7', '#10b981', '#f59e0b'],
                zIndex: confettiZIndex
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        };
        frame();

        // Big center bursts
        confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#7c3aed', '#a855f7', '#a855f7', '#10b981', '#f59e0b'],
            scalar: 1.2,
            zIndex: confettiZIndex
        });

        setTimeout(() => {
            confetti({
                particleCount: 100,
                spread: 120,
                origin: { y: 0.5 },
                colors: ['#7c3aed', '#a855f7', '#a855f7', '#10b981', '#f59e0b'],
                scalar: 1.5,
                zIndex: confettiZIndex
            });
        }, 300);

        setTimeout(() => {
            confetti({
                particleCount: 80,
                spread: 150,
                origin: { y: 0.4 },
                colors: ['#7c3aed', '#a855f7', '#a855f7', '#10b981', '#f59e0b'],
                scalar: 1.3,
                zIndex: confettiZIndex
            });
        }, 600);
    }
}

function closeModal() {
    const modal = document.getElementById('success-modal');
    modal.classList.remove('active');
}

// Close modal on overlay click
document.getElementById('success-modal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// ===== CAPTCHA State =====
let turnstileToken = null;
function onTurnstileSuccess(token) {
    turnstileToken = token;
    const captchaError = document.getElementById('captcha-error');
    if (captchaError) captchaError.style.display = 'none';
}

// ===== Form Submission =====
const signupForm = document.getElementById('signup-form');

if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = signupForm.querySelector('input[type="email"]');
        const submitBtn = signupForm.querySelector('button[type="submit"]');
        const email = emailInput.value.trim();

        if (!email) return;

        // Store original button text for restoration
        const originalText = submitBtn.innerHTML;

        // Validate CAPTCHA (skip if site key not configured)
        const captchaWidget = document.querySelector('.cf-turnstile');
        const siteKey = captchaWidget?.getAttribute('data-sitekey');
        if (siteKey && siteKey !== 'YOUR_SITE_KEY' && !turnstileToken) {
            const captchaError = document.getElementById('captcha-error');
            if (captchaError) captchaError.style.display = 'block';
            return;
        }

        // Check rate limiting first
        if (window.RateLimiter && window.RateLimiter.isRateLimited('waitlist')) {
            const errorMsg = window.RateLimiter.getRateLimitErrorMessage('waitlist');
            submitBtn.innerHTML = errorMsg;
            submitBtn.style.background = '#f59e0b';
            setTimeout(() => {
                submitBtn.innerHTML = originalText;
                submitBtn.style.background = '';
            }, 3000);
            return;
        }

        // Disable button and show loading state
        submitBtn.disabled = true;
        const processingText = (typeof I18n !== 'undefined' && I18n.t) ? (I18n.t('cta.processing') || 'Processing...') : 'Processing...';
        submitBtn.innerHTML = `
            <svg class="spinner" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="40" stroke-dashoffset="10">
                    <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="1s" repeatCount="indefinite"/>
                </circle>
            </svg>
            ${processingText}
        `;

        try {
            console.log('Attempting to insert email:', email);

            // Insert email into Supabase waitlist table
            const { data, error } = await supabaseClient
                .from('Waitlist')
                .insert([{ email: email }]);

            console.log('Supabase response:', { data, error });

            if (error) {
                console.error('Supabase error details:', error);
                // Check if it's a duplicate email error
                if (error.code === '23505') {
                    throw new Error('already_registered');
                }
                throw error;
            }

            // Record rate limit attempt on success
            if (window.RateLimiter) {
                window.RateLimiter.recordRateLimit('waitlist');
            }

            // Success - show modal with confetti
            emailInput.value = '';
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;

            showSuccessModal();

        } catch (error) {
            console.error('Signup error:', error);

            // Handle duplicate email
            if (error.message === 'already_registered') {
                submitBtn.innerHTML = (typeof I18n !== 'undefined' && I18n.t) ? (I18n.t('cta.alreadySigned') || 'Already signed up!') : 'Already signed up!';
                submitBtn.style.background = '#f59e0b';
            } else {
                submitBtn.innerHTML = (typeof I18n !== 'undefined' && I18n.t) ? (I18n.t('cta.errorTryAgain') || 'Error. Try again.') : 'Error. Try again.';
                submitBtn.style.background = '#ef4444';
            }

            submitBtn.disabled = false;

            setTimeout(() => {
                submitBtn.innerHTML = originalText;
                submitBtn.style.background = '';
            }, 2500);
        }
    });
}

// ===== Intersection Observer for Animations =====
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe elements for animation
document.querySelectorAll('.feature-card, .step, .pricing-card, .comparison-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
});

// Add animation class styles
const style = document.createElement('style');
style.textContent = `
    .animate-in {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }
`;
document.head.appendChild(style);

// ===== Start Automation Flow =====
function startAutomation(templateId) {
    // Store the selected template
    localStorage.setItem('automata_selected_template', templateId);

    // Redirect to signup/login with template context
    // In the future, this could open a modal to collect company info first
    window.location.href = '/app/login.html?template=' + templateId;
}

// ===== Stats Counter Animation =====
const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            animateStats();
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
    statsObserver.observe(heroStats);
}

function animateStats() {
    const statNumbers = document.querySelectorAll('.stat-number');

    statNumbers.forEach(stat => {
        const finalText = stat.textContent.trim();

        // Handle specific formats: "60s", "40%", "24/7"
        if (finalText.includes('/')) {
            // Don't animate fractions like "24/7" - just keep as-is
            return;
        }

        const hasS = finalText.includes('s');
        const hasPercent = finalText.includes('%');
        const finalNum = parseInt(finalText);

        if (isNaN(finalNum)) return;

        // Animate with easing
        const duration = 1500;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(finalNum * eased);

            let display = current.toString();
            if (hasS) display += 's';
            if (hasPercent) display += '%';
            stat.textContent = display;

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    });
}

// ===== Billing Toggle =====
const billingToggle = document.getElementById('billing-toggle');
if (billingToggle) {
    const monthlyLabel = document.querySelector('.toggle-label[data-period="monthly"]');
    const annualLabel = document.querySelector('.toggle-label[data-period="annual"]');
    const priceElements = document.querySelectorAll('.pricing-price .price[data-monthly]');

    // Set initial state
    updatePricing(false);

    billingToggle.addEventListener('change', () => {
        updatePricing(billingToggle.checked);
    });

    function updatePricing(isAnnual) {
        // Update labels
        if (monthlyLabel) monthlyLabel.classList.toggle('active', !isAnnual);
        if (annualLabel) annualLabel.classList.toggle('active', isAnnual);

        // Update prices
        priceElements.forEach(el => {
            const monthly = el.dataset.monthly;
            const annual = el.dataset.annual;
            if (monthly && annual) {
                el.textContent = '$' + (isAnnual ? annual : monthly);
            }
        });
    }
}

// ===== Onboarding Flow =====
const getRecommendationsBtn = document.getElementById('get-recommendations-btn');
const businessPromptInput = document.getElementById('business-prompt');
const industrySelect = document.getElementById('ctx-industry');
const goalsInput = document.getElementById('ctx-goals');
const painPointsInput = document.getElementById('ctx-pain-points');
const recommendationsSection = document.getElementById('recommendations-section');
const recommendationsGrid = document.getElementById('recommendations-grid');
const recommendationsContext = document.getElementById('recommendations-context');
const continueSignupBtn = document.getElementById('continue-signup-btn');

// Template icon map for recommendations
const templateIcons = {
    'birthday-rewards': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8V12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>`,
    'loyalty-program': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    'happy-hour': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M21 11.5C21 16.75 12 22 12 22C12 22 3 16.75 3 11.5C3 6.25 7.03 2 12 2C16.97 2 21 6.25 21 11.5Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="3" stroke="currentColor" stroke-width="2"/></svg>`,
    'appointment-reminders': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10H21M8 2V6M16 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    'post-visit': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'win-back': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 8L21 3M21 3V8M21 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'referral-program': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="3" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="11" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 19C3 16 5.5 14 9 14C10 14 10.8 14.2 11.5 14.5M17 17V21M15 19H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    'review-request': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M21 11.5C21 16.11 12 22 12 22C12 22 3 16.11 3 11.5C3 6.89 7.03 3 12 3C16.97 3 21 6.89 21 11.5Z" stroke="currentColor" stroke-width="2"/><path d="M12 7V13M12 16V16.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    'new-product': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    'welcome-series': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" stroke="currentColor" stroke-width="2"/><path d="M22 6L12 13L2 6" stroke="currentColor" stroke-width="2"/></svg>`,
    'seasonal-promo': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/><path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    'vip-program': `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M2 7L7 2L12 7L17 2L22 7V17L17 22L12 17L7 22L2 17V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`
};

if (getRecommendationsBtn) {
    getRecommendationsBtn.addEventListener('click', handleGetRecommendations);
}

if (continueSignupBtn) {
    continueSignupBtn.addEventListener('click', handleContinueToSignup);
}

// Restore onboarding data if available
function restoreOnboardingData() {
    if (typeof OnboardingStorage === 'undefined') return;

    const data = OnboardingStorage.get();
    if (data) {
        if (data.businessPrompt && businessPromptInput) {
            businessPromptInput.value = data.businessPrompt;
        }
        if (data.businessContext) {
            if (data.businessContext.industry && industrySelect) {
                industrySelect.value = data.businessContext.industry;
            }
            if (data.businessContext.goals?.length && goalsInput) {
                goalsInput.value = data.businessContext.goals.join('\n');
            }
            if (data.businessContext.painPoints?.length && painPointsInput) {
                painPointsInput.value = data.businessContext.painPoints.join('\n');
            }
        }
        // If user had recommendations, show them as preview
        if (data.aiRecommendations?.length > 0) {
            renderRecommendations(data.aiRecommendations);
            showRecommendationsSection();
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', restoreOnboardingData);

function handleGetRecommendations() {
    const prompt = businessPromptInput?.value?.trim() || '';

    if (!prompt) {
        businessPromptInput.focus();
        businessPromptInput.classList.add('shake');
        setTimeout(() => businessPromptInput.classList.remove('shake'), 500);
        return;
    }

    // Check rate limiting for AI analysis
    if (window.RateLimiter && window.RateLimiter.isRateLimited('ai_analysis')) {
        const errorMsg = window.RateLimiter.getRateLimitErrorMessage('ai_analysis');
        alert(errorMsg);
        return;
    }

    // Collect business context
    const context = {
        industry: industrySelect?.value || '',
        goals: goalsInput?.value?.split('\n').filter(g => g.trim()) || [],
        painPoints: painPointsInput?.value?.split('\n').filter(p => p.trim()) || []
    };

    // Save to onboarding storage
    if (typeof OnboardingStorage !== 'undefined') {
        OnboardingStorage.setBusinessPrompt(prompt);
        OnboardingStorage.setBusinessContext(context);
    }

    // Show loading state
    const btn = getRecommendationsBtn;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="spinner" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="40" stroke-dashoffset="10">
                <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="1s" repeatCount="indefinite"/>
            </circle>
        </svg>
        ${(typeof I18n !== 'undefined' && I18n.t) ? (I18n.t('onboarding.analyzing') || 'Analyzing...') : 'Analyzing...'}
    `;

    // Simulate brief delay for UX (recommendations are instant since they're local)
    setTimeout(() => {
        // Record rate limit attempt
        if (window.RateLimiter) {
            window.RateLimiter.recordRateLimit('ai_analysis');
        }

        // Get recommendations
        let recommendations = [];
        if (typeof AIRecommendations !== 'undefined') {
            recommendations = AIRecommendations.getRecommendations(prompt, context);
        }

        // Save recommendations
        if (typeof OnboardingStorage !== 'undefined') {
            OnboardingStorage.setRecommendations(recommendations);
        }

        // Render recommendations
        renderRecommendations(recommendations);

        // Show section and scroll to it
        showRecommendationsSection();

        // Reset button
        btn.disabled = false;
        btn.innerHTML = originalText;

        // Scroll to recommendations
        setTimeout(() => {
            recommendationsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }, 800);
}

function showRecommendationsSection() {
    if (recommendationsSection) {
        recommendationsSection.style.display = 'block';
    }
}

function renderRecommendations(recommendations) {
    if (!recommendationsGrid) return;

    // Get detected industry for context message
    const prompt = businessPromptInput?.value || '';
    let industry = industrySelect?.value || '';
    if (!industry && typeof AIRecommendations !== 'undefined') {
        industry = AIRecommendations.detectIndustry(prompt);
    }

    // Update context message
    if (recommendationsContext && industry && industry !== 'agnostic') {
        const industryNames = (typeof I18n !== 'undefined' && I18n.t) ? {
            food: I18n.t('onboarding.industries.food') || 'food & beverage',
            retail: I18n.t('onboarding.industries.retail') || 'retail',
            health: I18n.t('onboarding.industries.health') || 'health & wellness',
            service: I18n.t('onboarding.industries.service') || 'professional services',
            technology: I18n.t('onboarding.industries.technology') || 'technology',
            education: I18n.t('onboarding.industries.education') || 'education'
        } : {
            food: 'food & beverage',
            retail: 'retail',
            health: 'health & wellness',
            service: 'professional services',
            technology: 'technology',
            education: 'education'
        };
        recommendationsContext.textContent = `Based on your ${industryNames[industry] || industry} business, AI will automatically set up:`;
    }

    // Clear existing cards
    recommendationsGrid.innerHTML = '';

    // Render each recommendation as preview-only (no selection)
    recommendations.forEach(rec => {
        const card = createRecommendationCard(rec);
        recommendationsGrid.appendChild(card);
    });

    // No custom card needed - AI builds what it knows is best
}

function createRecommendationCard(rec) {
    const card = document.createElement('div');
    card.className = 'recommendation-card preview-only';
    card.dataset.templateId = rec.id;

    const icon = templateIcons[rec.id] || templateIcons['birthday-rewards'];

    card.innerHTML = `
        <div class="recommendation-card-icon">${icon}</div>
        <span class="recommendation-card-badge">${(typeof I18n !== 'undefined' && I18n.t) ? (I18n.t('onboarding.aiWillBuild') || 'AI Will Build') : 'AI Will Build'}</span>
        <h3 class="recommendation-card-name">${rec.name}</h3>
        <p class="recommendation-card-desc">${rec.description}</p>
        ${rec.reasoning ? `<p class="recommendation-card-reason">"${rec.reasoning}"</p>` : ''}
    `;

    // Preview-only, no click handler needed

    return card;
}

// Selection functions removed - preview-only mode now

function handleContinueToSignup() {
    // Save business context to localStorage for the Intelligence page to use
    const businessPrompt = businessPromptInput?.value?.trim() || '';
    const context = {
        industry: industrySelect?.value || '',
        goals: goalsInput?.value?.split('\n').filter(g => g.trim()) || [],
        painPoints: painPointsInput?.value?.split('\n').filter(p => p.trim()) || []
    };

    // Store for post-signup app creation
    localStorage.setItem('royalty_onboarding', JSON.stringify({
        businessPrompt,
        context,
        timestamp: Date.now()
    }));

    // Redirect to signup
    window.location.href = '/app/signup.html?onboarding=true';
}

// Add shake animation for validation
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-8px); }
        75% { transform: translateX(8px); }
    }
    .shake {
        animation: shake 0.3s ease-in-out;
        border-color: #ef4444 !important;
    }
`;
document.head.appendChild(shakeStyle);
