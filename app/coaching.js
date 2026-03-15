// ===== In-App Coaching System =====
// Lightweight, skippable coaching marks that highlight key UI elements for new users

const Coaching = (function() {
    const STORAGE_KEY = 'royalty_coaching_completed';
    let currentOverlay = null;
    let currentTour = null;
    let currentStepIndex = 0;

    // Define coaching tours for different pages
    const TOURS = {
        dashboard: [
            {
                target: '[data-nav="intelligence"]',
                title: 'Meet Royal AI',
                description: 'Your AI business advisor — it scans your data, spots opportunities, and acts on them automatically.',
                position: 'right'
            },
            {
                target: '[data-nav="automations"]',
                title: 'Automations',
                description: 'Win-back campaigns, birthday rewards, streak bonuses — all running automatically for your customers.',
                position: 'right'
            },
            {
                target: '[data-nav="customers"]',
                title: 'Customer Database',
                description: 'Import your customer list, view activity, and segment by tier or behavior.',
                position: 'right'
            },
            {
                target: '[data-nav="settings"]',
                title: 'Settings & Security',
                description: 'Update your profile, invite teammates, and enable two-factor authentication to keep your account safe.',
                position: 'right'
            }
        ],
        settings: [
            {
                target: '.settings-nav-item[data-tab="profile"]',
                title: 'Your Profile',
                description: 'Keep your name and contact info up to date so your team knows who you are.',
                position: 'right'
            },
            {
                target: '.settings-nav-item[data-tab="security"]',
                title: 'Password & Security',
                description: 'Update your password here. You can also enable Two-Factor Authentication — a 6-digit code from an authenticator app on every login.',
                position: 'right'
            },
            {
                target: '.settings-nav-item[data-tab="team"]',
                title: 'Invite Your Team',
                description: 'Add teammates so they can help manage your loyalty program alongside you.',
                position: 'right'
            },
            {
                target: '.settings-nav-item[data-tab="plan"]',
                title: 'Plan & Billing',
                description: 'View your current plan, usage limits, and upgrade options as your business grows.',
                position: 'right'
            }
        ],
        project: [
            {
                target: '#new-automation-btn',
                title: 'Create Automations',
                description: 'Add email campaigns, workflows, and more to this project.',
                position: 'left'
            },
            {
                target: '#run-diagnosis-btn',
                title: 'AI Suggestions',
                description: 'Let AI analyze your business and suggest tailored automations.',
                position: 'left'
            },
            {
                target: '.tab[data-tab="customers"]',
                title: 'Add Customers',
                description: 'Assign customers to this project for targeted automations.',
                position: 'bottom'
            }
        ],
        automation: [
            {
                target: '#automation-name, .automation-name-input',
                title: 'Name Your Automation',
                description: 'Give it a clear, descriptive name that explains what it does.',
                position: 'bottom'
            },
            {
                target: '#automation-frequency, .frequency-select',
                title: 'Set Frequency',
                description: 'Choose how often this automation should run.',
                position: 'bottom'
            },
            {
                target: '#publish-btn, .publish-btn, #activate-btn',
                title: 'Publish When Ready',
                description: 'Review your settings, then publish to activate the automation.',
                position: 'left'
            }
        ],
        apps: [
            {
                target: '.template-cards, .template-card',
                title: 'Start with a Template',
                description: 'Choose from pre-built app templates like Loyalty Programs, Rewards Clubs, or VIP Memberships.',
                position: 'bottom'
            },
            {
                target: '#new-app-btn',
                title: 'Or Create Custom',
                description: 'Build a custom app from scratch with exactly the features you need.',
                position: 'bottom'
            },
            {
                target: '#apps-grid, .apps-grid',
                title: 'Your Apps',
                description: 'All your customer-facing apps appear here. Click any app to edit it.',
                position: 'top'
            }
        ],
        appBuilder: [
            {
                target: '.wizard-steps, .step-indicator',
                title: 'Step-by-Step Builder',
                description: 'Follow these steps to configure your customer app.',
                position: 'bottom'
            },
            {
                target: '.features-section, .feature-toggles',
                title: 'Choose Features',
                description: 'Enable or disable features like points, leaderboards, and rewards.',
                position: 'right'
            },
            {
                target: '.branding-section, .brand-settings',
                title: 'Match Your Brand',
                description: 'Customize colors and upload your logo to match your brand.',
                position: 'left'
            },
            {
                target: '.phone-mockup, .preview-section',
                title: 'Live Preview',
                description: 'See how your app looks on a phone in real-time as you make changes.',
                position: 'left'
            },
            {
                target: '.qr-section, #generate-qr-btn',
                title: 'Share with QR Code',
                description: 'Generate a QR code for customers to scan and join your app.',
                position: 'bottom'
            }
        ]
    };

    // Active tooltips tracking
    let activeTooltips = [];

    // Active banners tracking
    let activeBanners = [];

    /**
     * Check if a tour has been completed
     */
    function isCompleted(tourName) {
        try {
            const completed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return completed[tourName] === true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Mark a tour as completed
     */
    function markCompleted(tourName) {
        try {
            const completed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            completed[tourName] = true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
        } catch (e) {
            console.warn('Could not save coaching completion:', e);
        }
    }

    /**
     * Reset all tours (for testing)
     */
    function resetTours() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('Could not reset coaching tours:', e);
        }
    }

    /**
     * Show a coaching tour
     */
    function showTour(tourName) {
        // Don't show if already completed
        if (isCompleted(tourName)) return;

        const steps = TOURS[tourName];
        if (!steps || steps.length === 0) return;

        currentTour = tourName;
        currentStepIndex = 0;

        // Find first valid step
        while (currentStepIndex < steps.length) {
            const target = document.querySelector(steps[currentStepIndex].target);
            if (target) break;
            currentStepIndex++;
        }

        if (currentStepIndex >= steps.length) {
            // No valid targets found
            return;
        }

        renderOverlay(steps);
        showStep(currentStepIndex);
    }

    /**
     * Render the coaching overlay
     */
    function renderOverlay(steps) {
        // Remove any existing overlay
        if (currentOverlay) {
            currentOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 'coaching-overlay';
        overlay.innerHTML = `
            <div class="coaching-backdrop"></div>
            <div class="coaching-spotlight"></div>
            <div class="coaching-tooltip">
                <div class="coaching-step-indicator">
                    ${steps.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}"></span>`).join('')}
                </div>
                <h4 class="coaching-title"></h4>
                <p class="coaching-description"></p>
                <div class="coaching-actions">
                    <button class="coaching-skip">Skip Tour</button>
                    <button class="coaching-next">Next</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        currentOverlay = overlay;

        // Add event listeners
        overlay.querySelector('.coaching-skip').addEventListener('click', skipTour);
        overlay.querySelector('.coaching-next').addEventListener('click', nextStep);
        overlay.querySelector('.coaching-backdrop').addEventListener('click', skipTour);

        // Handle keyboard
        document.addEventListener('keydown', handleKeydown);
    }

    /**
     * Show a specific step
     */
    function showStep(index) {
        const steps = TOURS[currentTour];
        if (!steps || index >= steps.length) {
            completeTour();
            return;
        }

        const step = steps[index];
        const target = document.querySelector(step.target);

        if (!target) {
            // Skip to next step if target doesn't exist
            nextStep();
            return;
        }

        // Update spotlight position
        positionSpotlight(target);

        // Update tooltip content and position
        updateTooltip(step, index, steps.length);

        // Add highlight class to target
        document.querySelectorAll('.coaching-highlight').forEach(el => {
            el.classList.remove('coaching-highlight');
        });
        target.classList.add('coaching-highlight');

        // Scroll target into view if needed
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * Position the spotlight around the target element
     */
    function positionSpotlight(target) {
        const spotlight = currentOverlay.querySelector('.coaching-spotlight');
        const rect = target.getBoundingClientRect();
        const padding = 8;

        spotlight.style.top = `${rect.top - padding + window.scrollY}px`;
        spotlight.style.left = `${rect.left - padding}px`;
        spotlight.style.width = `${rect.width + padding * 2}px`;
        spotlight.style.height = `${rect.height + padding * 2}px`;
    }

    /**
     * Update tooltip content and position
     */
    function updateTooltip(step, index, total) {
        const tooltip = currentOverlay.querySelector('.coaching-tooltip');
        const target = document.querySelector(step.target);
        const rect = target.getBoundingClientRect();

        // Update content
        tooltip.querySelector('.coaching-title').textContent = step.title;
        tooltip.querySelector('.coaching-description').textContent = step.description;

        // Update step indicators
        const dots = tooltip.querySelectorAll('.coaching-step-indicator .dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i <= index);
            dot.classList.toggle('current', i === index);
        });

        // Update button text
        const nextBtn = tooltip.querySelector('.coaching-next');
        nextBtn.textContent = index === total - 1 ? 'Got it!' : 'Next';

        // Position tooltip based on step.position
        const tooltipWidth = 300;
        const tooltipHeight = tooltip.offsetHeight || 200;
        const margin = 16;

        let top, left;

        switch (step.position) {
            case 'top':
                top = rect.top - tooltipHeight - margin + window.scrollY;
                left = rect.left + rect.width / 2 - tooltipWidth / 2;
                break;
            case 'bottom':
                top = rect.bottom + margin + window.scrollY;
                left = rect.left + rect.width / 2 - tooltipWidth / 2;
                break;
            case 'left':
                top = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
                left = rect.left - tooltipWidth - margin;
                break;
            case 'right':
                top = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
                left = rect.right + margin;
                break;
            default:
                top = rect.bottom + margin + window.scrollY;
                left = rect.left + rect.width / 2 - tooltipWidth / 2;
        }

        // Keep tooltip within viewport
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
        top = Math.max(margin, top);

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    /**
     * Go to next step
     */
    function nextStep() {
        currentStepIndex++;
        const steps = TOURS[currentTour];

        // Find next valid step
        while (currentStepIndex < steps.length) {
            const target = document.querySelector(steps[currentStepIndex].target);
            if (target) break;
            currentStepIndex++;
        }

        if (currentStepIndex >= steps.length) {
            completeTour();
        } else {
            showStep(currentStepIndex);
        }
    }

    /**
     * Skip/close the tour
     */
    function skipTour() {
        completeTour();
    }

    /**
     * Complete the tour (mark as done and clean up)
     */
    function completeTour() {
        markCompleted(currentTour);
        cleanup();

        // Subtle celebration
        if (typeof celebrateSubtle === 'function') {
            celebrateSubtle();
        }
    }

    /**
     * Clean up overlay and event listeners
     */
    function cleanup() {
        if (currentOverlay) {
            currentOverlay.remove();
            currentOverlay = null;
        }

        // Remove highlight from any elements
        document.querySelectorAll('.coaching-highlight').forEach(el => {
            el.classList.remove('coaching-highlight');
        });

        // Remove keyboard listener
        document.removeEventListener('keydown', handleKeydown);

        currentTour = null;
        currentStepIndex = 0;
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeydown(e) {
        if (e.key === 'Escape') {
            skipTour();
        } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
            nextStep();
        }
    }

    /**
     * Check if any tour is currently active
     */
    function isActive() {
        return currentOverlay !== null;
    }

    /**
     * Add a custom tour programmatically
     */
    function addTour(name, steps) {
        TOURS[name] = steps;
    }

    /**
     * Show a tooltip near a target element
     */
    function showTooltip(targetSelector, content, options = {}) {
        const target = document.querySelector(targetSelector);
        if (!target) return null;

        const tipId = options.id || targetSelector;

        // Check if already dismissed
        if (isDismissed(tipId)) return null;

        // Remove existing tooltip on this target
        const existing = activeTooltips.find(t => t.id === tipId);
        if (existing) {
            existing.element?.remove();
            activeTooltips = activeTooltips.filter(t => t.id !== tipId);
        }

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = 'coaching-inline-tooltip';
        tooltip.setAttribute('data-tip-id', tipId);
        tooltip.innerHTML = `
            <div class="coaching-inline-tooltip-content">
                ${content}
                ${options.dismissible !== false ?
                    `<button class="coaching-inline-tooltip-dismiss" data-tip-id="${tipId}">Got it</button>` :
                    ''
                }
            </div>
            <div class="coaching-inline-tooltip-arrow"></div>
        `;

        // Position based on options
        const position = options.position || 'top';
        tooltip.setAttribute('data-position', position);

        // Add dismiss handler
        const dismissBtn = tooltip.querySelector('.coaching-inline-tooltip-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                dismissTooltip(tipId);
            });
        }

        // Add to DOM
        target.style.position = target.style.position || 'relative';
        target.appendChild(tooltip);

        // Track
        activeTooltips.push({ id: tipId, element: tooltip });

        return tooltip;
    }

    /**
     * Dismiss a tooltip permanently
     */
    function dismissTooltip(tipId) {
        // Remove from DOM
        const tooltip = document.querySelector(`.coaching-inline-tooltip[data-tip-id="${tipId}"]`);
        if (tooltip) {
            tooltip.remove();
        }

        // Remove from tracking
        activeTooltips = activeTooltips.filter(t => t.id !== tipId);

        // Save to dismissed list
        try {
            const dismissed = JSON.parse(localStorage.getItem('royalty_coaching_dismissed') || '[]');
            if (!dismissed.includes(tipId)) {
                dismissed.push(tipId);
                localStorage.setItem('royalty_coaching_dismissed', JSON.stringify(dismissed));
            }
        } catch (e) {
            console.warn('Could not save tooltip dismissal:', e);
        }
    }

    /**
     * Check if a tooltip/banner has been dismissed
     */
    function isDismissed(id) {
        try {
            const dismissed = JSON.parse(localStorage.getItem('royalty_coaching_dismissed') || '[]');
            return dismissed.includes(id);
        } catch (e) {
            return false;
        }
    }

    /**
     * Show a feature announcement banner
     */
    function showBanner(message, options = {}) {
        const bannerId = options.id || 'banner-' + Date.now();

        // Check if already dismissed
        if (isDismissed(bannerId)) return null;

        // Remove existing banner with same ID
        const existing = document.querySelector(`.coaching-banner[data-banner-id="${bannerId}"]`);
        if (existing) {
            existing.remove();
        }

        // Create banner
        const banner = document.createElement('div');
        banner.className = 'coaching-banner' + (options.type ? ` coaching-banner-${options.type}` : '');
        banner.setAttribute('data-banner-id', bannerId);
        banner.innerHTML = `
            <div class="coaching-banner-content">
                ${options.icon ? `<span class="coaching-banner-icon">${options.icon}</span>` : ''}
                <span class="coaching-banner-message">${message}</span>
                ${options.action ?
                    `<a href="${escapeHtml(options.action.href)}" class="coaching-banner-action">${escapeHtml(options.action.text)}</a>` :
                    ''
                }
            </div>
            <button class="coaching-banner-close" data-banner-id="${bannerId}" aria-label="Dismiss">&times;</button>
        `;

        // Add dismiss handler
        const closeBtn = banner.querySelector('.coaching-banner-close');
        closeBtn.addEventListener('click', () => {
            dismissBanner(bannerId);
        });

        // Insert at appropriate location
        const main = document.querySelector('main, .main-content, .app-content');
        if (main) {
            main.insertBefore(banner, main.firstChild);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }

        // Track
        activeBanners.push({ id: bannerId, element: banner });

        return banner;
    }

    /**
     * Dismiss a banner permanently
     */
    function dismissBanner(bannerId) {
        const banner = document.querySelector(`.coaching-banner[data-banner-id="${bannerId}"]`);
        if (banner) {
            banner.classList.add('coaching-banner-dismissing');
            setTimeout(() => banner.remove(), 300);
        }

        // Remove from tracking
        activeBanners = activeBanners.filter(b => b.id !== bannerId);

        // Save to dismissed list
        try {
            const dismissed = JSON.parse(localStorage.getItem('royalty_coaching_dismissed') || '[]');
            if (!dismissed.includes(bannerId)) {
                dismissed.push(bannerId);
                localStorage.setItem('royalty_coaching_dismissed', JSON.stringify(dismissed));
            }
        } catch (e) {
            console.warn('Could not save banner dismissal:', e);
        }
    }

    /**
     * Track first-time page visit
     */
    function trackFirstVisit(pageId) {
        try {
            const visits = JSON.parse(localStorage.getItem('royalty_coaching_visits') || '{}');
            if (!visits[pageId]) {
                visits[pageId] = new Date().toISOString();
                localStorage.setItem('royalty_coaching_visits', JSON.stringify(visits));
                return true; // First visit
            }
            return false; // Repeat visit
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if this is a first visit to a page
     */
    function isFirstVisit(pageId) {
        try {
            const visits = JSON.parse(localStorage.getItem('royalty_coaching_visits') || '{}');
            return !visits[pageId];
        } catch (e) {
            return true;
        }
    }

    /**
     * Reset all dismissals (for testing)
     */
    function resetDismissals() {
        try {
            localStorage.removeItem('royalty_coaching_dismissed');
            localStorage.removeItem('royalty_coaching_visits');
        } catch (e) {
            console.warn('Could not reset dismissals:', e);
        }
    }

    /**
     * Escape HTML helper - delegates to AppUtils
     */
    function escapeHtml(text) {
        if (typeof AppUtils !== 'undefined' && typeof AppUtils.escapeHtml === 'function') {
            return AppUtils.escapeHtml(text);
        }
        // Fallback for safety
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // Public API
    return {
        showTour,
        isCompleted,
        markCompleted,
        resetTours,
        isActive,
        addTour,
        showTooltip,
        dismissTooltip,
        showBanner,
        dismissBanner,
        trackFirstVisit,
        isFirstVisit,
        isDismissed,
        resetDismissals
    };
})();

// Make available globally
window.Coaching = Coaching;
