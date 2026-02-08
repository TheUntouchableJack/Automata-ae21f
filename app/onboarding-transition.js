// ===== Onboarding Transition Module =====
// Animated "building your workspace" screen between signup and dashboard

const OnboardingTransition = (function() {

    const STEPS = [
        { key: 'analyzing', fallback: 'Analyzing your business...' },
        { key: 'selecting', fallback: 'Selecting best strategies...' },
        { key: 'building', fallback: 'Building your workspace...' },
        { key: 'preparing', fallback: 'Preparing your dashboard...' }
    ];

    function t(key, fallback) {
        if (typeof I18n !== 'undefined' && I18n.t) {
            return I18n.t('onboarding.transition.' + key) || fallback;
        }
        return fallback;
    }

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-transition-overlay';
        overlay.innerHTML = `
            <div class="onboarding-transition-content">
                <div class="onboarding-transition-logo">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                        <rect width="40" height="40" rx="10" fill="#7c3aed"/>
                        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="20" font-weight="700">R</text>
                    </svg>
                    <span class="onboarding-transition-brand">Royalty</span>
                </div>
                <div class="onboarding-transition-steps" id="transition-steps">
                    ${STEPS.map((step, i) => `
                        <div class="onboarding-transition-step ${i === 0 ? 'active' : 'pending'}" data-step="${i}">
                            <div class="step-icon">
                                <svg class="step-check" width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path d="M5 12l5 5L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <div class="step-dot"></div>
                            </div>
                            <span class="step-text">${t(step.key, step.fallback)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="onboarding-transition-progress">
                    <div class="progress-track">
                        <div class="progress-fill" id="transition-progress-fill"></div>
                    </div>
                </div>
            </div>
        `;
        return overlay;
    }

    function injectStyles() {
        if (document.getElementById('onboarding-transition-styles')) return;

        const style = document.createElement('style');
        style.id = 'onboarding-transition-styles';
        style.textContent = `
            .onboarding-transition-overlay {
                position: fixed;
                inset: 0;
                z-index: 10000;
                background: linear-gradient(135deg, #0f0a1e 0%, #1a1033 50%, #0f0a1e 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.5s ease;
            }
            .onboarding-transition-overlay.visible {
                opacity: 1;
            }
            .onboarding-transition-overlay.fade-out {
                opacity: 0;
            }
            .onboarding-transition-content {
                text-align: center;
                max-width: 400px;
                padding: 40px;
            }
            .onboarding-transition-logo {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                margin-bottom: 48px;
                opacity: 0;
                animation: transitionFadeIn 0.6s ease forwards;
            }
            .onboarding-transition-brand {
                font-size: 24px;
                font-weight: 700;
                color: white;
                letter-spacing: -0.02em;
            }
            .onboarding-transition-steps {
                display: flex;
                flex-direction: column;
                gap: 20px;
                margin-bottom: 40px;
                text-align: left;
            }
            .onboarding-transition-step {
                display: flex;
                align-items: center;
                gap: 14px;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.4s ease, transform 0.4s ease;
            }
            .onboarding-transition-step.active,
            .onboarding-transition-step.complete {
                opacity: 1;
                transform: translateY(0);
            }
            .onboarding-transition-step.pending {
                opacity: 0.3;
                transform: translateY(0);
            }
            .onboarding-transition-step.pending.revealed {
                opacity: 0.3;
                transform: translateY(0);
            }
            .step-icon {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .onboarding-transition-step.pending .step-icon {
                background: rgba(255,255,255,0.08);
            }
            .onboarding-transition-step.active .step-icon {
                background: rgba(124, 58, 237, 0.3);
                box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4);
                animation: transitionPulse 1.5s ease infinite;
            }
            .onboarding-transition-step.complete .step-icon {
                background: #10b981;
                animation: none;
                transform: scale(1);
            }
            .step-check {
                display: none;
                color: white;
            }
            .onboarding-transition-step.complete .step-check {
                display: block;
                animation: transitionCheckIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .step-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255,255,255,0.4);
            }
            .onboarding-transition-step.active .step-dot {
                background: #7c3aed;
            }
            .onboarding-transition-step.complete .step-dot {
                display: none;
            }
            .step-text {
                font-size: 15px;
                color: rgba(255,255,255,0.5);
                transition: color 0.3s ease;
            }
            .onboarding-transition-step.active .step-text {
                color: white;
                font-weight: 500;
            }
            .onboarding-transition-step.complete .step-text {
                color: rgba(255,255,255,0.7);
            }
            .onboarding-transition-progress {
                opacity: 0;
                animation: transitionFadeIn 0.6s ease 0.3s forwards;
            }
            .progress-track {
                height: 4px;
                background: rgba(255,255,255,0.1);
                border-radius: 2px;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #7c3aed, #a78bfa);
                border-radius: 2px;
                transition: width 0.8s ease;
            }
            @keyframes transitionFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes transitionPulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
                50% { box-shadow: 0 0 0 8px rgba(124, 58, 237, 0); }
            }
            @keyframes transitionCheckIn {
                from { transform: scale(0); }
                to { transform: scale(1); }
            }
            @media (prefers-reduced-motion: reduce) {
                .onboarding-transition-step,
                .onboarding-transition-logo,
                .onboarding-transition-progress,
                .progress-fill {
                    animation: none !important;
                    transition: none !important;
                    opacity: 1 !important;
                    transform: none !important;
                }
                .onboarding-transition-step.active .step-icon {
                    animation: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Show the transition overlay and run through steps.
     * @param {object} options
     * @param {function} options.onBuild - Async function to run during "Building" step (e.g., OnboardingProcessor)
     * @param {function} options.onComplete - Called when all steps finish (before fade-out)
     * @param {string} options.redirectUrl - URL to redirect to after completion
     */
    async function show({ onBuild, onComplete, redirectUrl } = {}) {
        injectStyles();

        const overlay = createOverlay();
        document.body.appendChild(overlay);

        // Trigger visibility
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });

        const steps = overlay.querySelectorAll('.onboarding-transition-step');
        const progressFill = overlay.querySelector('#transition-progress-fill');

        // Reveal all steps as dimmed first
        await sleep(300);
        steps.forEach(s => s.classList.add('revealed'));

        const durations = [1200, 1000, 1500, 800];

        for (let i = 0; i < steps.length; i++) {
            // Activate current step
            steps[i].classList.remove('pending');
            steps[i].classList.add('active');

            // Update progress bar
            const progress = ((i + 0.5) / steps.length) * 100;
            if (progressFill) progressFill.style.width = progress + '%';

            // If this is the "building" step (index 2), run the actual DB work
            if (i === 2 && typeof onBuild === 'function') {
                try {
                    await Promise.all([
                        onBuild(),
                        sleep(durations[i])
                    ]);
                } catch (err) {
                    console.error('Error during onboarding build:', err);
                    await sleep(durations[i]);
                }
            } else {
                await sleep(durations[i]);
            }

            // Mark as complete
            steps[i].classList.remove('active');
            steps[i].classList.add('complete');
        }

        // Fill progress to 100%
        if (progressFill) progressFill.style.width = '100%';

        // Fire confetti if available
        if (typeof celebrateBig === 'function') {
            celebrateBig();
        } else if (typeof confetti === 'function') {
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }

        // Callback
        if (typeof onComplete === 'function') {
            onComplete();
        }

        // Pause for celebration
        await sleep(1200);

        // Fade out
        overlay.classList.add('fade-out');
        await sleep(500);

        // Redirect
        if (redirectUrl) {
            window.location.href = redirectUrl;
        }

        // Cleanup
        overlay.remove();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    return { show };
})();

// Make available globally
window.OnboardingTransition = OnboardingTransition;
