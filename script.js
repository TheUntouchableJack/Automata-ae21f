// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Mobile Menu =====
const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
const mobileMenuDrawer = document.getElementById('mobile-menu-drawer');
const mobileMenuClose = document.querySelector('.mobile-menu-close');
const mobileMenuLinks = document.querySelectorAll('.mobile-menu-link');
const mobileMenuCTA = document.querySelectorAll('.mobile-menu-cta a');

// Store the last focused element before opening menu
let lastFocusedElement = null;

// All focusable elements in the drawer
function getFocusableElements() {
    return mobileMenuDrawer?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || [];
}

function openMobileMenu() {
    if (!mobileMenuDrawer) return;

    // Store current focus
    lastFocusedElement = document.activeElement;

    // Add active classes
    mobileMenuBtn?.classList.add('active');
    mobileMenuOverlay?.classList.add('active');
    mobileMenuDrawer.classList.add('active');
    document.body.classList.add('mobile-menu-open');

    // Update ARIA
    mobileMenuOverlay?.setAttribute('aria-hidden', 'false');
    mobileMenuDrawer.setAttribute('aria-hidden', 'false');
    mobileMenuBtn?.setAttribute('aria-expanded', 'true');

    // Focus the close button
    setTimeout(() => {
        mobileMenuClose?.focus();
    }, 100);
}

function closeMobileMenu() {
    if (!mobileMenuDrawer) return;

    // Remove active classes
    mobileMenuBtn?.classList.remove('active');
    mobileMenuOverlay?.classList.remove('active');
    mobileMenuDrawer.classList.remove('active');
    document.body.classList.remove('mobile-menu-open');

    // Update ARIA
    mobileMenuOverlay?.setAttribute('aria-hidden', 'true');
    mobileMenuDrawer.setAttribute('aria-hidden', 'true');
    mobileMenuBtn?.setAttribute('aria-expanded', 'false');

    // Restore focus
    if (lastFocusedElement) {
        lastFocusedElement.focus();
    }
}

// Focus trap - keep focus within drawer when open
function handleFocusTrap(e) {
    if (!mobileMenuDrawer || !mobileMenuDrawer.classList.contains('active')) return;

    const focusable = getFocusableElements();
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    if (e.key === 'Tab') {
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable?.focus();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable?.focus();
            }
        }
    }
}

// Event listeners
if (mobileMenuBtn && mobileMenuDrawer) {
    // Toggle button
    mobileMenuBtn.addEventListener('click', () => {
        if (mobileMenuDrawer.classList.contains('active')) {
            closeMobileMenu();
        } else {
            openMobileMenu();
        }
    });

    // Close button
    mobileMenuClose?.addEventListener('click', closeMobileMenu);

    // Overlay click
    mobileMenuOverlay?.addEventListener('click', closeMobileMenu);

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenuDrawer.classList.contains('active')) {
            closeMobileMenu();
        }
    });

    // Focus trap
    document.addEventListener('keydown', handleFocusTrap);

    // Close on navigation link click
    mobileMenuLinks.forEach(link => {
        link.addEventListener('click', () => {
            const href = link.getAttribute('href');
            if (href?.startsWith('#')) {
                setTimeout(closeMobileMenu, 150);
            }
        });
    });

    // Close on CTA click for anchor links
    mobileMenuCTA.forEach(link => {
        link.addEventListener('click', () => {
            const href = link.getAttribute('href');
            if (href?.startsWith('#')) {
                setTimeout(closeMobileMenu, 150);
            }
        });
    });

    // Close on window resize above breakpoint
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768 && mobileMenuDrawer.classList.contains('active')) {
                closeMobileMenu();
            }
        }, 100);
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
    localStorage.setItem('royalty_selected_template', templateId);

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

if (getRecommendationsBtn) {
    getRecommendationsBtn.addEventListener('click', handleStartOnboarding);
}

// Restore onboarding data if available
function restoreOnboardingData() {
    if (typeof OnboardingStorage === 'undefined') return;

    const data = OnboardingStorage.get();
    if (!data) return;

    // Clear fields synchronously first to prevent browser auto-fill showing stale data
    if (businessPromptInput) businessPromptInput.value = '';
    if (industrySelect) industrySelect.value = '';
    if (goalsInput) goalsInput.value = '';
    if (painPointsInput) painPointsInput.value = '';

    // Check auth — if authenticated, discard onboarding data; otherwise restore it
    if (supabaseClient) {
        supabaseClient.auth.getSession().then(({ data: sessionData }) => {
            if (sessionData?.session) {
                OnboardingStorage.clear();
            } else {
                applyOnboardingData(data);
            }
        });
        return;
    }

    // No Supabase client — restore normally
    applyOnboardingData(data);
}

function applyOnboardingData(data) {
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
}

// Restore saved onboarding data (DOM is already ready since script loads at end of body)
restoreOnboardingData();

// Main onboarding entry point — AI auto-selects templates, then shows optional info step
function handleStartOnboarding() {
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

    // Show loading state on button
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

    // AI runs silently — auto-selects best templates
    setTimeout(() => {
        // Record rate limit
        if (window.RateLimiter) {
            window.RateLimiter.recordRateLimit('ai_analysis');
        }

        // Get AI recommendations
        let recommendations = [];
        if (typeof AIRecommendations !== 'undefined') {
            recommendations = AIRecommendations.getRecommendations(prompt, context);
        }

        // Save recommendations and auto-select all of them
        if (typeof OnboardingStorage !== 'undefined') {
            OnboardingStorage.setRecommendations(recommendations);
            recommendations.forEach(rec => OnboardingStorage.addTemplate(rec.id));
        }

        // Reset button
        btn.disabled = false;
        btn.innerHTML = originalText;

        // Show optional info-gathering section
        onboardingShowInfoGathering();
    }, 800);
}

function onboardingShowInfoGathering() {
    const section = document.getElementById('info-gathering-section');
    if (!section) return;

    section.style.display = 'block';

    // Pre-fill business type from detected industry
    const industryVal = industrySelect?.value || '';
    if (industryVal) {
        const typeSelect = document.getElementById('info-business-type');
        if (typeSelect) typeSelect.value = industryVal;
    }

    // Smooth scroll to the section
    setTimeout(() => {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

// Continue to signup with optional business details
function handleContinueToSignup() {
    const businessDetails = {
        businessName: document.getElementById('info-business-name')?.value?.trim() || '',
        businessType: document.getElementById('info-business-type')?.value || '',
        customerCount: document.getElementById('info-customer-count')?.value || '',
        websiteUrl: document.getElementById('info-website-url')?.value?.trim() || ''
    };

    if (typeof OnboardingStorage !== 'undefined') {
        OnboardingStorage.setBusinessDetails(businessDetails);
    }

    // Signal that analysis should be triggered on signup page
    try {
        localStorage.setItem('royalty_signup_analysis', JSON.stringify({
            status: 'pending',
            timestamp: Date.now()
        }));
    } catch (e) { /* ignore */ }

    window.location.href = '/app/signup.html?onboarding=true';
}

// Skip info-gathering and go straight to signup
function handleSkipToSignup() {
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

// ===== Scroll to Top Button =====
(function() {
    const scrollBtn = document.getElementById('scroll-to-top');
    if (!scrollBtn) return;

    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            scrollBtn.classList.add('visible');
        } else {
            scrollBtn.classList.remove('visible');
        }
    }, { passive: true });

    scrollBtn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
})();
