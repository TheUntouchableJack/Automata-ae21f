// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Auth Code Exchange (safety net for email verification landing here) =====
(function handleAuthCodeOnLandingPage() {
    const authCode = new URLSearchParams(window.location.search).get('code');
    if (authCode && supabaseClient) {
        supabaseClient.auth.exchangeCodeForSession(authCode).then(({ error }) => {
            if (!error) {
                window.location.href = '/app/intelligence.html';
            }
        });
    }
})();

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

// ===== Hybrid AI Onboarding Flow =====
// States: CTA → Prompt (textarea) → Loading → Confirmation → Signup redirect

const EDGE_FUNCTION_URL = SUPABASE_URL + '/functions/v1/analyze-business-signup';

// Store analysis result between states
let _analysisResult = null;
let _loadingStepTimer = null;
let _typewriterInterval = null;

// Store original text for each step on first call
function _initStepTexts() {
    document.querySelectorAll('#hero-loading-state .extraction-step-text').forEach(el => {
        if (!el.dataset.fulltext) el.dataset.fulltext = el.textContent;
    });
}

// Typewriter effect: reveals text character by character
function _typewriteStep(stepEl) {
    if (_typewriterInterval) { clearInterval(_typewriterInterval); _typewriterInterval = null; }
    const textEl = stepEl.querySelector('.extraction-step-text');
    if (!textEl || !textEl.dataset.fulltext) return;

    const fullText = textEl.dataset.fulltext;
    let i = 0;
    textEl.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    cursor.textContent = '|';
    textEl.appendChild(cursor);

    _typewriterInterval = setInterval(() => {
        if (i < fullText.length) {
            textEl.textContent = fullText.slice(0, i + 1);
            textEl.appendChild(cursor);
            i++;
        } else {
            clearInterval(_typewriterInterval);
            _typewriterInterval = null;
            cursor.remove();
        }
    }, 30);
}

// Show/hide the orb (centered above progress bar, no positioning needed)
function _showOrb(show) {
    const orb = document.getElementById('ai-thinking-orb');
    if (orb) orb.classList.toggle('visible', show);
}

// Update progress percentage text
function _updatePct(text) {
    const pctEl = document.getElementById('extraction-progress-pct');
    if (pctEl) pctEl.textContent = text;
}

// Cycle through loading steps for visual progress
function startLoadingSteps() {
    const steps = document.querySelectorAll('#hero-loading-state .extraction-step');
    const progressFill = document.getElementById('extraction-progress-fill');
    if (!steps.length) return;

    _initStepTexts();

    let currentStep = 0;
    const durations = [1200, 1500, 1800, 2500];
    const widths = ['20%', '45%', '70%', '88%'];

    // First step is already active via HTML class
    if (progressFill) progressFill.style.width = widths[0];
    _updatePct(widths[0]);
    _typewriteStep(steps[0]);
    _showOrb(true);

    function advanceStep() {
        if (currentStep < steps.length - 1) {
            // Complete current step
            steps[currentStep].classList.remove('active');
            steps[currentStep].classList.add('completed');
            // Snap completed step to full text
            const completedText = steps[currentStep].querySelector('.extraction-step-text');
            if (completedText && completedText.dataset.fulltext) {
                if (_typewriterInterval) { clearInterval(_typewriterInterval); _typewriterInterval = null; }
                completedText.textContent = completedText.dataset.fulltext;
                const cursor = completedText.querySelector('.typing-cursor');
                if (cursor) cursor.remove();
            }

            currentStep++;
            steps[currentStep].classList.add('active');
            if (progressFill) progressFill.style.width = widths[currentStep];
            _updatePct(widths[currentStep]);
            _typewriteStep(steps[currentStep]);
        }
        if (currentStep < steps.length - 1) {
            _loadingStepTimer = setTimeout(advanceStep, durations[currentStep]);
        }
    }

    _loadingStepTimer = setTimeout(advanceStep, durations[0]);
}

function completeLoadingSteps(callback) {
    if (_loadingStepTimer) { clearTimeout(_loadingStepTimer); _loadingStepTimer = null; }
    if (_typewriterInterval) { clearInterval(_typewriterInterval); _typewriterInterval = null; }
    const steps = document.querySelectorAll('#hero-loading-state .extraction-step');
    const progressFill = document.getElementById('extraction-progress-fill');
    const orb = document.getElementById('ai-thinking-orb');

    steps.forEach(s => {
        s.classList.remove('active');
        s.classList.add('completed');
        // Snap all text to full
        const textEl = s.querySelector('.extraction-step-text');
        if (textEl && textEl.dataset.fulltext) {
            textEl.textContent = textEl.dataset.fulltext;
            const cursor = textEl.querySelector('.typing-cursor');
            if (cursor) cursor.remove();
        }
    });
    if (progressFill) progressFill.style.width = '100%';
    _updatePct('100%');
    _showOrb(false);
    setTimeout(callback, 200);
}

function clearLoadingSteps() {
    if (_loadingStepTimer) { clearTimeout(_loadingStepTimer); _loadingStepTimer = null; }
    if (_typewriterInterval) { clearInterval(_typewriterInterval); _typewriterInterval = null; }
    const steps = document.querySelectorAll('#hero-loading-state .extraction-step');
    const progressFill = document.getElementById('extraction-progress-fill');
    const orb = document.getElementById('ai-thinking-orb');

    steps.forEach(s => {
        s.classList.remove('active', 'completed');
        // Restore full text
        const textEl = s.querySelector('.extraction-step-text');
        if (textEl && textEl.dataset.fulltext) {
            textEl.textContent = textEl.dataset.fulltext;
            const cursor = textEl.querySelector('.typing-cursor');
            if (cursor) cursor.remove();
        }
    });
    steps[0]?.classList.add('active');
    if (progressFill) progressFill.style.width = '0%';
    _updatePct('0%');
    _showOrb(false);
}

function showHeroState(stateId) {
    ['hero-cta-state', 'hero-prompt-state', 'hero-loading-state', 'hero-confirm-state'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === stateId ? 'block' : 'none';
    });
}

// CTA button → show prompt textarea
const heroCTABtn = document.getElementById('hero-cta-btn');
if (heroCTABtn) {
    heroCTABtn.addEventListener('click', () => {
        showHeroState('hero-prompt-state');
        document.getElementById('hero-business-prompt')?.focus();
    });
}

// Nav "Get Started Free" → mirror hero CTA behavior (smooth scroll + transition)
const navCTABtn = document.getElementById('nav-cta-btn');
if (navCTABtn) {
    navCTABtn.addEventListener('click', (e) => {
        e.preventDefault();
        const card = document.getElementById('discovery-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Fire the same transition as the hero CTA
        heroCTABtn?.click();
    });
}

// Analyze button → call edge function → show confirmation
const analyzeBtn = document.getElementById('analyze-business-btn');
if (analyzeBtn) {
    analyzeBtn.addEventListener('click', handleAnalyzeBusiness);
}

// Confirm button → save to OnboardingStorage → redirect to signup
const confirmBtn = document.getElementById('confirm-and-signup-btn');
if (confirmBtn) {
    confirmBtn.addEventListener('click', handleConfirmAndSignup);
}

// Retry button → go back to prompt state
const retryBtn = document.getElementById('retry-prompt-btn');
if (retryBtn) {
    retryBtn.addEventListener('click', () => {
        _analysisResult = null;
        _analysisToken++;  // invalidate any in-flight analysis so its results don't land
        stopOrbWordCycle();
        const statusRow = document.getElementById('confirm-status-row');
        if (statusRow) statusRow.classList.add('hidden');
        // Clear the confirm-state fields so the next analysis starts clean
        ['extracted-name','extracted-industry','extracted-customers','extracted-location','extracted-website']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        showHeroState('hero-prompt-state');
        document.getElementById('hero-business-prompt')?.focus();
    });
}

// Restore onboarding data if returning user has saved data
function restoreOnboardingData() {
    if (typeof OnboardingStorage === 'undefined') return;

    const data = OnboardingStorage.get();
    if (!data) return;

    // Check auth — if authenticated, discard onboarding data and go to dashboard
    if (supabaseClient) {
        supabaseClient.auth.getSession().then(({ data: sessionData }) => {
            if (sessionData?.session) {
                OnboardingStorage.clear();
                window.location.href = '/app/intelligence.html';
                return;
            } else {
                applyOnboardingData(data);
            }
        });
        return;
    }

    applyOnboardingData(data);
}

function applyOnboardingData(data) {
    // If they have a business prompt, show the prompt state with their text pre-filled
    if (data.businessPrompt) {
        showHeroState('hero-prompt-state');
        const promptEl = document.getElementById('hero-business-prompt');
        if (promptEl) promptEl.value = data.businessPrompt;
    }
}

restoreOnboardingData();

// ─── Word-cycling utility for the AI orb (item 3) ──────────────────
const ORB_WORD_KEYS = [
    'orbStatus.thinking',
    'orbStatus.ruminating',
    'orbStatus.analyzing',
    'orbStatus.building',
    'orbStatus.refining',
    'orbStatus.almostThere'
];
const ORB_WORD_FALLBACKS = {
    'orbStatus.thinking': 'Thinking',
    'orbStatus.ruminating': 'Ruminating',
    'orbStatus.analyzing': 'Analyzing',
    'orbStatus.building': 'Building',
    'orbStatus.refining': 'Refining',
    'orbStatus.almostThere': 'Almost there'
};
let _orbWordTimers = [];
let _analysisToken = 0;  // increments per analyze call; stale fetches are ignored
function _translateOrbWord(key) {
    if (window.I18n) {
        const t = I18n.t(key);
        if (t && !t.startsWith('orbStatus.')) return t;
    }
    return ORB_WORD_FALLBACKS[key] || 'Thinking';
}
function startOrbWordCycle(spanId) {
    const span = document.getElementById(spanId);
    if (!span) return;
    let idx = 0;
    span.textContent = _translateOrbWord(ORB_WORD_KEYS[idx]);
    const tick = setInterval(() => {
        idx = (idx + 1) % ORB_WORD_KEYS.length;
        span.classList.add('fade-out');
        const swap = setTimeout(() => {
            span.textContent = _translateOrbWord(ORB_WORD_KEYS[idx]);
            span.classList.remove('fade-out');
        }, 350);
        _orbWordTimers.push(swap);
    }, 1800);
    _orbWordTimers.push(tick);
}
function stopOrbWordCycle() {
    _orbWordTimers.forEach(t => { clearInterval(t); clearTimeout(t); });
    _orbWordTimers = [];
}

// ─── Smart business name guess from prompt text ────────────────────
function guessBusinessNameFromPrompt(prompt) {
    if (!prompt) return '';
    const trimmed = prompt.trim();
    // Look for patterns like "I own X", "my shop X", "X is a ramen shop"
    const patterns = [
        /(?:own|run|operate|have)\s+(?:a\s+|an\s+|the\s+)?([A-Z][\w'&.\- ]{1,40}?)(?:\s+(?:which|that|is|in|where|shop|store|restaurant|business|cafe|company))/i,
        /(?:called|named)\s+["']?([A-Z][\w'&.\- ]{1,40}?)["']?(?:\s|$|\.|,)/i,
        /^([A-Z][\w'&.\- ]{1,40}?)\s+(?:is|was)\s+(?:a|an|the)\s+/i,
    ];
    for (const re of patterns) {
        const m = trimmed.match(re);
        if (m && m[1]) return m[1].trim();
    }
    // Fallback: first 2-3 capitalized words
    const caps = trimmed.match(/\b[A-Z][\w'&.\-]*(?:\s+[A-Z][\w'&.\-]*){0,2}/);
    return caps ? caps[0] : '';
}

// Main analysis handler — skips loader, streams AI into editable fields (item 2)
async function handleAnalyzeBusiness() {
    const promptEl = document.getElementById('hero-business-prompt');
    const prompt = promptEl?.value?.trim() || '';

    if (prompt.length < 10) {
        promptEl?.focus();
        promptEl?.classList.add('shake');
        setTimeout(() => promptEl?.classList.remove('shake'), 500);
        return;
    }

    // Bump the analysis token so any prior in-flight fetch gets ignored
    const myToken = ++_analysisToken;

    // Save prompt immediately
    if (typeof OnboardingStorage !== 'undefined') {
        OnboardingStorage.setBusinessPrompt(prompt);
    }

    // Pre-fill the name field with a smart guess so the user has something
    // to look at instantly instead of a blank form.
    const nameEl = document.getElementById('extracted-name');
    const industryEl = document.getElementById('extracted-industry');
    const customersEl = document.getElementById('extracted-customers');
    const locationEl = document.getElementById('extracted-location');
    const websiteEl = document.getElementById('extracted-website');
    const summaryEl = document.getElementById('hero-business-summary');

    const guess = guessBusinessNameFromPrompt(prompt);
    if (nameEl) nameEl.value = guess;

    // Track which fields the user has touched so we don't overwrite their edits
    const fieldsToTrack = [nameEl, industryEl, customersEl, locationEl, websiteEl].filter(Boolean);
    const touched = new Set();
    // Pre-mark the name as "touched by user" only if they actually edit it
    fieldsToTrack.forEach(el => {
        const onDirty = () => touched.add(el.id);
        el.addEventListener('input', onDirty, { once: true });
        el.addEventListener('change', onDirty, { once: true });
    });

    // Jump straight to the confirm state — no loader
    showHeroState('hero-confirm-state');

    // Show the inline "Refining your details" status row with orb + cycling words
    const statusRow = document.getElementById('confirm-status-row');
    if (statusRow) statusRow.classList.remove('hidden');
    startOrbWordCycle('confirm-status-word');

    // Detect language
    const lang = document.documentElement.lang || 'en';

    try {
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({
                businessPrompt: prompt,
                language: lang
            })
        });

        const data = await response.json();

        // If the user hit Start Over or triggered a new analyze, this fetch is stale
        if (myToken !== _analysisToken) return;

        if (!data.success || !data.analysis) {
            throw new Error(data.error || 'Analysis failed');
        }

        _analysisResult = data.analysis;

        // Stream AI results into fields the user hasn't touched
        const extracted = data.analysis.extractedDetails || {};
        const maybeFill = (el, value) => {
            if (!el || !value) return;
            if (touched.has(el.id)) return;  // user has edited — don't overwrite
            el.value = value;
        };
        maybeFill(nameEl, extracted.businessName);
        maybeFill(industryEl, extracted.industry);
        maybeFill(customersEl, extracted.customerCount);
        maybeFill(locationEl, extracted.location);
        maybeFill(websiteEl, extracted.websiteUrl);
        if (summaryEl && !summaryEl.textContent.trim()) {
            summaryEl.textContent = data.analysis.businessSummary || '';
        }

        // Hide the status row — analysis complete
        stopOrbWordCycle();
        if (statusRow) statusRow.classList.add('hidden');
    } catch (err) {
        if (myToken !== _analysisToken) return;  // stale — user has moved on
        console.error('Analysis error:', err);
        stopOrbWordCycle();
        if (statusRow) statusRow.classList.add('hidden');
        // User is already in confirm state with their smart-guess name — leave them
        // there so they can edit and proceed even if AI failed. Show a subtle retry hint.
        const confirmState = document.getElementById('hero-confirm-state');
        confirmState?.querySelector('.extraction-error-msg')?.remove();
        if (confirmState) {
            const errMsg = document.createElement('p');
            errMsg.className = 'extraction-error-msg';
            errMsg.style.cssText = 'color: #dc2626; font-size: 0.8rem; text-align: center; margin-top: 4px;';
            errMsg.textContent = 'Couldn\u2019t auto-fill your details \u2014 please review and edit the fields above.';
            confirmState.querySelector('.extracted-edit-hint')?.after(errMsg);
            setTimeout(() => errMsg.remove(), 8000);
        }
    }
}

// Confirm extracted data and redirect to signup
function handleConfirmAndSignup() {
    const businessName = document.getElementById('extracted-name')?.value?.trim() || '';
    const industry = document.getElementById('extracted-industry')?.value || '';
    const customerCount = document.getElementById('extracted-customers')?.value || '';
    const location = document.getElementById('extracted-location')?.value?.trim() || '';
    const websiteUrl = document.getElementById('extracted-website')?.value?.trim() || '';

    if (typeof OnboardingStorage !== 'undefined') {
        // Save business details from confirmed extraction
        OnboardingStorage.setBusinessDetails({
            businessName: businessName,
            businessType: industry,
            customerCount: customerCount,
            websiteUrl: websiteUrl,
            location: location
        });

        // Save context
        OnboardingStorage.setBusinessContext({
            industry: industry,
            goals: [],
            painPoints: []
        });

        // Run local keyword recommendations as fallback
        const prompt = OnboardingStorage.get()?.businessPrompt || '';
        if (prompt && typeof AIRecommendations !== 'undefined') {
            const recommendations = AIRecommendations.getRecommendations(prompt, { industry });
            OnboardingStorage.setRecommendations(recommendations);
            recommendations.forEach(rec => OnboardingStorage.addTemplate(rec.id));
        }
    }

    // Cache analysis result so signup page's BusinessAnalysis module picks it up
    try {
        const lang = document.documentElement.lang || 'en';
        const cacheKey = `royalty_signup_analysis_${lang}`;
        if (_analysisResult) {
            localStorage.setItem(cacheKey, JSON.stringify({
                status: 'complete',
                analysis: _analysisResult,
                timestamp: Date.now()
            }));
        } else {
            localStorage.setItem(cacheKey, JSON.stringify({
                status: 'pending',
                timestamp: Date.now()
            }));
        }
    } catch (e) { /* ignore */ }

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
