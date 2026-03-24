// ===== Onboarding Transition Module =====
// Animated "setting up your workspace" screen between signup and dashboard

const OnboardingTransition = (function() {

    const STEPS = [
        { key: 'confirming', fallback: 'Confirming your account...' },
        { key: 'settingUp', fallback: 'Setting up your workspace...' },
        { key: 'activatingAI', fallback: 'Activating your AI assistant...' },
        { key: 'preparing', fallback: 'Preparing your dashboard...' }
    ];

    function t(key, fallback) {
        if (typeof I18n !== 'undefined' && I18n.t) {
            const val = I18n.t('onboarding.transition.' + key);
            return (val && !val.includes('onboarding.transition.')) ? val : fallback;
        }
        return fallback;
    }

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-transition-overlay';
        overlay.innerHTML = `
            <div class="onboarding-transition-content">
                <div class="onboarding-transition-orb">
                    <div class="orb-sphere"></div>
                    <div class="orb-glow"></div>
                    <div class="orb-particle orb-particle-1"></div>
                    <div class="orb-particle orb-particle-2"></div>
                    <div class="orb-particle orb-particle-3"></div>
                    <div class="orb-particle orb-particle-4"></div>
                    <div class="orb-particle orb-particle-5"></div>
                    <div class="orb-particle orb-particle-6"></div>
                </div>
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
                <p class="onboarding-transition-subtitle">This can take 10–20 seconds to complete, thank you for your patience.</p>
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
                background: #ffffff;
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

            /* ---- Bouncing Orb ---- */
            .onboarding-transition-orb {
                position: relative;
                width: 120px;
                height: 120px;
                margin: 0 auto 32px;
                animation: orbFloat 2.4s ease-in-out infinite;
            }
            .orb-sphere {
                position: absolute;
                inset: 10px;
                border-radius: 50%;
                background: radial-gradient(circle at 35% 35%,
                    rgba(167, 139, 250, 0.6) 0%,
                    rgba(124, 58, 237, 0.45) 40%,
                    rgba(99, 102, 241, 0.3) 70%,
                    rgba(79, 70, 229, 0.15) 100%
                );
                box-shadow:
                    inset 0 -8px 20px rgba(124, 58, 237, 0.2),
                    inset 0 8px 16px rgba(255, 255, 255, 0.4),
                    0 0 40px rgba(124, 58, 237, 0.15);
                backdrop-filter: blur(2px);
                animation: orbPulse 3s ease-in-out infinite;
            }
            .orb-glow {
                position: absolute;
                inset: -8px;
                border-radius: 50%;
                background: radial-gradient(circle,
                    rgba(124, 58, 237, 0.12) 0%,
                    rgba(124, 58, 237, 0.04) 50%,
                    transparent 70%
                );
                animation: orbGlow 3s ease-in-out infinite;
            }
            .orb-particle {
                position: absolute;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                top: 50%;
                left: 50%;
                margin: -3px 0 0 -3px;
            }
            .orb-particle-1 {
                background: rgba(124, 58, 237, 0.5);
                animation: orbOrbit1 4s linear infinite;
            }
            .orb-particle-2 {
                background: rgba(99, 102, 241, 0.4);
                width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
                animation: orbOrbit2 5s linear infinite;
            }
            .orb-particle-3 {
                background: rgba(168, 85, 247, 0.45);
                width: 4px; height: 4px; margin: -2px 0 0 -2px;
                animation: orbOrbit3 3.5s linear infinite;
            }
            .orb-particle-4 {
                background: rgba(6, 182, 212, 0.35);
                width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
                animation: orbOrbit4 4.5s linear infinite;
            }
            .orb-particle-5 {
                background: rgba(124, 58, 237, 0.3);
                width: 4px; height: 4px; margin: -2px 0 0 -2px;
                animation: orbOrbit5 5.5s linear infinite;
            }
            .orb-particle-6 {
                background: rgba(167, 139, 250, 0.4);
                width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px;
                animation: orbOrbit6 3s linear infinite;
            }
            @keyframes orbFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-12px); }
            }
            @keyframes orbPulse {
                0%, 100% { transform: scale(1); opacity: 0.9; }
                50% { transform: scale(1.04); opacity: 1; }
            }
            @keyframes orbGlow {
                0%, 100% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.08); }
            }
            @keyframes orbOrbit1 {
                from { transform: rotate(0deg) translateX(52px) rotate(0deg); }
                to { transform: rotate(360deg) translateX(52px) rotate(-360deg); }
            }
            @keyframes orbOrbit2 {
                from { transform: rotate(60deg) translateX(58px) rotate(-60deg); }
                to { transform: rotate(420deg) translateX(58px) rotate(-420deg); }
            }
            @keyframes orbOrbit3 {
                from { transform: rotate(120deg) translateX(48px) rotate(-120deg); }
                to { transform: rotate(480deg) translateX(48px) rotate(-480deg); }
            }
            @keyframes orbOrbit4 {
                from { transform: rotate(200deg) translateX(55px) rotate(-200deg); }
                to { transform: rotate(560deg) translateX(55px) rotate(-560deg); }
            }
            @keyframes orbOrbit5 {
                from { transform: rotate(280deg) translateX(50px) rotate(-280deg); }
                to { transform: rotate(640deg) translateX(50px) rotate(-640deg); }
            }
            @keyframes orbOrbit6 {
                from { transform: rotate(340deg) translateX(45px) rotate(-340deg); }
                to { transform: rotate(700deg) translateX(45px) rotate(-700deg); }
            }

            /* ---- Logo ---- */
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
                color: #1a1a2e;
                letter-spacing: -0.02em;
            }

            .onboarding-transition-subtitle {
                font-size: 13px;
                color: #6b7280;
                margin: -8px 0 24px;
                font-weight: 400;
            }

            /* ---- Steps ---- */
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
                background: rgba(124, 58, 237, 0.08);
            }
            .onboarding-transition-step.active .step-icon {
                background: rgba(124, 58, 237, 0.15);
                box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.3);
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
                background: rgba(0, 0, 0, 0.2);
            }
            .onboarding-transition-step.active .step-dot {
                background: #7c3aed;
            }
            .onboarding-transition-step.complete .step-dot {
                display: none;
            }
            .step-text {
                font-size: 15px;
                color: rgba(0, 0, 0, 0.35);
                transition: color 0.3s ease;
            }
            .onboarding-transition-step.active .step-text {
                color: #1a1a2e;
                font-weight: 500;
            }
            .onboarding-transition-step.complete .step-text {
                color: rgba(0, 0, 0, 0.5);
            }

            /* ---- Progress Bar ---- */
            .onboarding-transition-progress {
                opacity: 0;
                animation: transitionFadeIn 0.6s ease 0.3s forwards;
            }
            .progress-track {
                height: 4px;
                background: rgba(0, 0, 0, 0.08);
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

            /* ---- Keyframes ---- */
            @keyframes transitionFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes transitionPulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.3); }
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
                .onboarding-transition-orb,
                .orb-sphere,
                .orb-glow,
                .orb-particle,
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
     * @param {function} options.onBuild - Async function to run during "Activating AI" step (e.g., OnboardingProcessor)
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

            // If this is the "activating AI" step (index 2), run the actual DB work
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
