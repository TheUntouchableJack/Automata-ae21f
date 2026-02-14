// ===== Celebration Utilities =====
// Confetti and sound effects for success actions

// Preload a simple success sound
function playSuccessSound() {
    try {
        // Create a simple beep using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (e) {
        // Audio not supported, fail silently
    }
}

// Main celebration function
function celebrate(options = {}) {
    const {
        sound = true,
        intensity = 'normal' // 'subtle', 'normal', 'big'
    } = options;

    // Play sound
    if (sound) {
        playSuccessSound();
    }

    // Fire confetti based on intensity
    const configs = {
        subtle: { count: 50, spread: 40 },
        normal: { count: 100, spread: 70 },
        big: { count: 200, spread: 100 }
    };

    const config = configs[intensity] || configs.normal;
    const count = config.count;
    const defaults = {
        origin: { y: 0.7 },
        zIndex: 9999
    };

    function fire(particleRatio, opts) {
        confetti({
            ...defaults,
            ...opts,
            particleCount: Math.floor(count * particleRatio)
        });
    }

    fire(0.25, { spread: config.spread * 0.4, startVelocity: 55 });
    fire(0.2, { spread: config.spread * 0.85 });
    fire(0.35, { spread: config.spread, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: config.spread * 1.2, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: config.spread * 1.2, startVelocity: 45 });
}

// Quick celebration for smaller actions (save, toggle, etc.)
function celebrateSubtle() {
    celebrate({ intensity: 'subtle' });
}

// Big celebration for major milestones (signup, first project, etc.)
function celebrateBig() {
    celebrate({ intensity: 'big' });
}
