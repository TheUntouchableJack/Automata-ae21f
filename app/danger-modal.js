// ===== Danger Confirmation Modal =====
// A reusable modal for destructive actions with EXPLODING CATS and meows

const DangerModal = (function() {
    let modalElement = null;
    let flamesOverlay = null;
    let currentCallback = null;
    let requiredPhrase = '';
    let audioContext = null;

    // Initialize the modal HTML
    function init() {
        if (document.getElementById('danger-modal-overlay')) return;

        // Create modal HTML
        const modalHTML = `
            <div class="danger-modal-overlay" id="danger-modal-overlay">
                <div class="danger-modal">
                    <div class="danger-banner">
                        <div class="danger-banner-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                            </svg>
                        </div>
                        <div class="danger-banner-content">
                            <div class="danger-banner-title" id="danger-banner-title">Danger Zone</div>
                            <div class="danger-banner-subtitle">This action cannot be undone</div>
                        </div>
                    </div>
                    <div class="danger-modal-body">
                        <div class="danger-item-name" id="danger-item-name"></div>
                        <p class="danger-warning-text" id="danger-warning-text"></p>
                        <label class="danger-confirmation-label">Type the following to confirm:</label>
                        <div class="danger-confirmation-phrase" id="danger-confirmation-phrase"></div>
                        <input type="text" class="danger-confirmation-input" id="danger-confirmation-input" autocomplete="off" spellcheck="false">
                    </div>
                    <div class="danger-modal-footer">
                        <button class="btn-cancel" id="danger-cancel-btn">Cancel</button>
                        <button class="btn-destroy" id="danger-confirm-btn" disabled>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M3 4H13M6 4V3C6 2.44772 6.44772 2 7 2H9C9.55228 2 10 2.44772 10 3V4M12 4V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V4H12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span id="danger-confirm-text">Destroy</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Create flames overlay HTML
        const flamesHTML = `
            <div class="flames-overlay" id="flames-overlay">
                <div class="flames-container" id="flames-container"></div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        document.body.insertAdjacentHTML('beforeend', flamesHTML);

        modalElement = document.getElementById('danger-modal-overlay');
        flamesOverlay = document.getElementById('flames-overlay');

        // Event listeners
        document.getElementById('danger-cancel-btn').addEventListener('click', close);
        document.getElementById('danger-confirm-btn').addEventListener('click', handleConfirm);

        const input = document.getElementById('danger-confirmation-input');
        input.addEventListener('input', checkConfirmation);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('danger-confirm-btn').disabled) {
                handleConfirm();
            }
        });

        modalElement.addEventListener('click', (e) => {
            if (e.target === modalElement) close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalElement.classList.contains('active')) {
                close();
            }
        });
    }

    // Show the modal
    function show(options) {
        init();

        const {
            title = 'Danger Zone',
            itemName = '',
            warningText = 'This action is permanent and cannot be undone. All associated data will be permanently deleted.',
            confirmPhrase = 'DELETE',
            confirmButtonText = 'Destroy',
            onConfirm = null
        } = options;

        document.getElementById('danger-banner-title').textContent = title;
        document.getElementById('danger-item-name').textContent = itemName;
        document.getElementById('danger-warning-text').textContent = warningText;
        document.getElementById('danger-confirmation-phrase').textContent = confirmPhrase;
        document.getElementById('danger-confirm-text').textContent = confirmButtonText;
        document.getElementById('danger-confirmation-input').value = '';

        requiredPhrase = confirmPhrase;
        currentCallback = onConfirm;

        const confirmBtn = document.getElementById('danger-confirm-btn');
        confirmBtn.disabled = true;
        confirmBtn.classList.remove('enabled');

        modalElement.classList.add('active');

        // Focus the input after animation
        setTimeout(() => {
            document.getElementById('danger-confirmation-input').focus();
        }, 300);
    }

    // Check if confirmation phrase matches
    function checkConfirmation() {
        const input = document.getElementById('danger-confirmation-input');
        const confirmBtn = document.getElementById('danger-confirm-btn');
        const value = input.value.toUpperCase();

        if (value === requiredPhrase) {
            confirmBtn.disabled = false;
            confirmBtn.classList.add('enabled');
            input.classList.add('matched');
        } else {
            confirmBtn.disabled = true;
            confirmBtn.classList.remove('enabled');
            input.classList.remove('matched');
        }
    }

    // Handle confirmation
    async function handleConfirm() {
        const confirmBtn = document.getElementById('danger-confirm-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `
            <span style="font-size: 16px;">🐱💥</span>
            <span>Releasing cats...</span>
        `;

        // Close modal first
        modalElement.classList.remove('active');

        // Play the destruction animation
        await playDestructionAnimation();

        // Execute callback
        if (currentCallback) {
            try {
                await currentCallback();
            } catch (error) {
                console.error('Error during destruction:', error);
            }
        }

        // Reset button
        confirmBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 4H13M6 4V3C6 2.44772 6.44772 2 7 2H9C9.55228 2 10 2.44772 10 3V4M12 4V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V4H12Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span id="danger-confirm-text">Destroy</span>
        `;
    }

    // Play destruction animation with EXPLODING CATS and meows
    async function playDestructionAnimation() {
        return new Promise((resolve) => {
            // Add shake effect
            document.body.classList.add('shaking');

            // Play chaotic meowing
            playCatMeows();

            // Show explosions overlay
            flamesOverlay.classList.add('active');
            createExplosions();

            // Launch exploding cats from center
            launchExplodingCats();

            // Clean up after animation
            setTimeout(() => {
                document.body.classList.remove('shaking');
                flamesOverlay.classList.remove('active');
                document.getElementById('flames-container').innerHTML = '';
                // Remove any lingering cats
                document.querySelectorAll('.exploding-cat').forEach(cat => cat.remove());
                resolve();
            }, 2500);
        });
    }

    // Launch cats that explode outward from center
    function launchExplodingCats() {
        const catEmojis = ['🐱', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐈', '🐈‍⬛'];
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Create explosion bursts
        for (let burst = 0; burst < 3; burst++) {
            setTimeout(() => {
                // Each burst launches cats in all directions
                for (let i = 0; i < 12; i++) {
                    const cat = document.createElement('div');
                    cat.className = 'exploding-cat';
                    cat.innerHTML = catEmojis[Math.floor(Math.random() * catEmojis.length)];
                    cat.style.cssText = `
                        position: fixed;
                        left: ${centerX}px;
                        top: ${centerY}px;
                        font-size: ${30 + Math.random() * 40}px;
                        z-index: 100001;
                        pointer-events: none;
                        transform: translate(-50%, -50%);
                        transition: all ${0.5 + Math.random() * 0.5}s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                    `;
                    document.body.appendChild(cat);

                    // Calculate explosion trajectory
                    const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
                    const distance = 200 + Math.random() * 400;
                    const targetX = centerX + Math.cos(angle) * distance;
                    const targetY = centerY + Math.sin(angle) * distance;
                    const rotation = (Math.random() - 0.5) * 720;

                    // Trigger explosion animation
                    requestAnimationFrame(() => {
                        cat.style.left = `${targetX}px`;
                        cat.style.top = `${targetY}px`;
                        cat.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${0.3 + Math.random() * 0.7})`;
                        cat.style.opacity = '0';
                    });

                    // Remove after animation
                    setTimeout(() => cat.remove(), 1500);
                }
            }, burst * 400);
        }
    }

    // Create explosion particles
    function createExplosions() {
        const container = document.getElementById('flames-container');
        container.innerHTML = '';

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Create explosion flash
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            left: ${centerX}px;
            top: ${centerY}px;
            width: 10px;
            height: 10px;
            background: radial-gradient(circle, #fff 0%, #ffff00 30%, #ff6600 60%, transparent 70%);
            border-radius: 50%;
            transform: translate(-50%, -50%) scale(1);
            animation: explosionFlash 0.5s ease-out forwards;
            z-index: 100000;
        `;
        container.appendChild(flash);

        // Create explosion particles
        const colors = ['#ff6600', '#ff9900', '#ffcc00', '#ff3300', '#ffff00', '#ff0066'];
        for (let i = 0; i < 80; i++) {
            const particle = document.createElement('div');
            const angle = Math.random() * Math.PI * 2;
            const velocity = 100 + Math.random() * 400;
            const size = 4 + Math.random() * 12;

            particle.style.cssText = `
                position: fixed;
                left: ${centerX}px;
                top: ${centerY}px;
                width: ${size}px;
                height: ${size}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: 50%;
                transform: translate(-50%, -50%);
                animation: explosionParticle ${0.5 + Math.random() * 1}s ease-out forwards;
                --tx: ${Math.cos(angle) * velocity}px;
                --ty: ${Math.sin(angle) * velocity}px;
                z-index: 99999;
            `;
            container.appendChild(particle);
        }

        // Create sparkles
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const sparkle = document.createElement('div');
                sparkle.innerHTML = '✨';
                sparkle.style.cssText = `
                    position: fixed;
                    left: ${centerX + (Math.random() - 0.5) * 300}px;
                    top: ${centerY + (Math.random() - 0.5) * 300}px;
                    font-size: ${20 + Math.random() * 20}px;
                    animation: sparkle 0.6s ease-out forwards;
                    z-index: 99998;
                `;
                container.appendChild(sparkle);
            }, Math.random() * 800);
        }

        // Inject explosion animations if not already present
        if (!document.getElementById('explosion-styles')) {
            const style = document.createElement('style');
            style.id = 'explosion-styles';
            style.textContent = `
                @keyframes explosionFlash {
                    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                    100% { transform: translate(-50%, -50%) scale(100); opacity: 0; }
                }
                @keyframes explosionParticle {
                    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                    100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity: 0; }
                }
                @keyframes sparkle {
                    0% { transform: scale(0) rotate(0deg); opacity: 1; }
                    50% { transform: scale(1.5) rotate(180deg); opacity: 1; }
                    100% { transform: scale(0) rotate(360deg); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // Play a single clear "Meow" sound
    function playCatMeows() {
        try {
            // Create audio context if not exists
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Play one clear meow
            playMeow(500, 0.4);

        } catch (e) {
            console.log('Could not play cat meow:', e);
        }
    }

    // Generate a single "Meow" sound
    function playMeow(baseFreq, duration) {
        if (!audioContext) return;

        const sampleRate = audioContext.sampleRate;
        const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < data.length; i++) {
            const t = i / sampleRate;
            const progress = t / duration;

            // Envelope: quick attack, sustain, decay
            let envelope;
            if (progress < 0.05) {
                envelope = progress / 0.05; // Quick attack
            } else if (progress < 0.6) {
                envelope = 1.0; // Sustain
            } else {
                envelope = 1.0 - ((progress - 0.6) / 0.4); // Decay
            }

            // Classic meow frequency sweep: "me" (rise) then "ow" (fall)
            let freq;
            if (progress < 0.25) {
                // "Me-" rising quickly
                freq = baseFreq + (progress / 0.25) * 300;
            } else {
                // "-ow" falling
                freq = (baseFreq + 300) - ((progress - 0.25) / 0.75) * 400;
            }

            // Slight vibrato for realism
            const vibrato = Math.sin(t * 25 * Math.PI) * 15;
            freq += vibrato;

            // Generate sound with harmonics for richer tone
            let sample = 0;
            sample += Math.sin(2 * Math.PI * freq * t) * 0.5;
            sample += Math.sin(2 * Math.PI * freq * 2 * t) * 0.3;
            sample += Math.sin(2 * Math.PI * freq * 3 * t) * 0.15;

            data[i] = sample * envelope * 0.5;
        }

        const source = audioContext.createBufferSource();
        source.buffer = buffer;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.7;

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        source.start();
    }

    // Close the modal
    function close() {
        if (modalElement) {
            modalElement.classList.remove('active');
        }
        currentCallback = null;
    }

    // Public API
    return {
        show,
        close
    };
})();

// Make available globally
window.DangerModal = DangerModal;
