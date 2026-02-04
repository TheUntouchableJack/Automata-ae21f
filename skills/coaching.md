# Skill: Coaching & Tutorials

## Overview

This skill implements a coaching system for guiding first-time users through new features. It provides contextual tooltips, step-by-step tutorials, and progressive disclosure to help users learn Royalty's capabilities without overwhelming them.

## When to Use

Invoke this skill when:
- Adding a new feature that needs user onboarding
- User asks for help understanding a feature
- Implementing tutorials or guided tours
- Adding contextual help or tooltips
- Tracking first-time user experiences

## Core Concepts

### Coaching Types

| Type | Description | Best For |
|------|-------------|----------|
| **Spotlight** | Highlights a single element with explanation | New buttons, key features |
| **Tour** | Multi-step guided walkthrough | Complex features, onboarding |
| **Tooltip** | Small hint on hover/focus | Subtle guidance |
| **Banner** | Dismissible announcement | New feature announcements |
| **Checklist** | Progress-tracked task list | Onboarding completion |

### User State Tracking

Track which tutorials a user has seen:

```javascript
// Store in profiles.settings JSONB
{
    "coaching": {
        "completed_tours": ["dashboard-intro", "automation-basics"],
        "dismissed_tips": ["tip-keyboard-shortcuts"],
        "onboarding_progress": {
            "created_automation": true,
            "invited_team": false,
            "connected_channel": false
        },
        "first_seen": {
            "apps_page": "2026-01-28T12:00:00Z",
            "app_builder": null
        }
    }
}
```

## Implementation

### 1. Coaching Component

Create `/app/coaching.js`:

```javascript
/**
 * Coaching System
 * Provides tutorials, tooltips, and guided tours for first-time users
 */

const Coaching = {
    // State
    currentTour: null,
    currentStep: 0,
    settings: {},

    // Initialize with user settings
    async init(userId) {
        const { data } = await supabase
            .from('profiles')
            .select('settings')
            .eq('id', userId)
            .single();

        this.settings = data?.settings?.coaching || {
            completed_tours: [],
            dismissed_tips: [],
            first_seen: {}
        };
    },

    // Check if user has seen a tour
    hasCompletedTour(tourId) {
        return this.settings.completed_tours?.includes(tourId);
    },

    // Mark tour as complete
    async completeTour(tourId) {
        if (!this.settings.completed_tours) {
            this.settings.completed_tours = [];
        }
        if (!this.settings.completed_tours.includes(tourId)) {
            this.settings.completed_tours.push(tourId);
            await this.saveSettings();
        }
    },

    // Save settings to database
    async saveSettings() {
        await supabase
            .from('profiles')
            .update({
                settings: {
                    ...currentProfile.settings,
                    coaching: this.settings
                }
            })
            .eq('id', currentUser.id);
    },

    // Start a guided tour
    startTour(tourConfig) {
        if (this.hasCompletedTour(tourConfig.id)) {
            return false;
        }

        this.currentTour = tourConfig;
        this.currentStep = 0;
        this.showStep();
        return true;
    },

    // Show current step
    showStep() {
        const step = this.currentTour.steps[this.currentStep];
        if (!step) {
            this.endTour();
            return;
        }

        // Remove previous spotlight
        document.querySelector('.coaching-spotlight')?.remove();
        document.querySelector('.coaching-overlay')?.remove();

        // Find target element
        const target = document.querySelector(step.target);
        if (!target) {
            console.warn('Coaching target not found:', step.target);
            this.nextStep();
            return;
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'coaching-overlay';
        document.body.appendChild(overlay);

        // Create spotlight
        const spotlight = document.createElement('div');
        spotlight.className = 'coaching-spotlight';
        spotlight.innerHTML = `
            <div class="coaching-card">
                <div class="coaching-header">
                    <span class="coaching-step-indicator">
                        ${this.currentStep + 1} of ${this.currentTour.steps.length}
                    </span>
                    <button class="coaching-close" onclick="Coaching.endTour()">×</button>
                </div>
                <h3 class="coaching-title">${step.title}</h3>
                <p class="coaching-content">${step.content}</p>
                <div class="coaching-actions">
                    ${this.currentStep > 0 ?
                        '<button class="coaching-btn secondary" onclick="Coaching.prevStep()">Back</button>' :
                        '<button class="coaching-btn secondary" onclick="Coaching.endTour()">Skip</button>'
                    }
                    <button class="coaching-btn primary" onclick="Coaching.nextStep()">
                        ${this.currentStep === this.currentTour.steps.length - 1 ? 'Done' : 'Next'}
                    </button>
                </div>
            </div>
        `;

        // Position spotlight near target
        const rect = target.getBoundingClientRect();
        const position = step.position || 'bottom';

        document.body.appendChild(spotlight);

        // Add highlight to target
        target.classList.add('coaching-highlight');

        // Position the card
        this.positionCard(spotlight.querySelector('.coaching-card'), rect, position);

        // Scroll into view if needed
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    positionCard(card, targetRect, position) {
        const cardRect = card.getBoundingClientRect();
        const padding = 16;

        let top, left;

        switch (position) {
            case 'top':
                top = targetRect.top - cardRect.height - padding;
                left = targetRect.left + (targetRect.width / 2) - (cardRect.width / 2);
                break;
            case 'bottom':
                top = targetRect.bottom + padding;
                left = targetRect.left + (targetRect.width / 2) - (cardRect.width / 2);
                break;
            case 'left':
                top = targetRect.top + (targetRect.height / 2) - (cardRect.height / 2);
                left = targetRect.left - cardRect.width - padding;
                break;
            case 'right':
                top = targetRect.top + (targetRect.height / 2) - (cardRect.height / 2);
                left = targetRect.right + padding;
                break;
        }

        // Keep within viewport
        top = Math.max(padding, Math.min(top, window.innerHeight - cardRect.height - padding));
        left = Math.max(padding, Math.min(left, window.innerWidth - cardRect.width - padding));

        card.style.position = 'fixed';
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
    },

    nextStep() {
        document.querySelector('.coaching-highlight')?.classList.remove('coaching-highlight');
        this.currentStep++;

        if (this.currentStep >= this.currentTour.steps.length) {
            this.endTour();
        } else {
            this.showStep();
        }
    },

    prevStep() {
        document.querySelector('.coaching-highlight')?.classList.remove('coaching-highlight');
        if (this.currentStep > 0) {
            this.currentStep--;
            this.showStep();
        }
    },

    endTour() {
        document.querySelector('.coaching-spotlight')?.remove();
        document.querySelector('.coaching-overlay')?.remove();
        document.querySelector('.coaching-highlight')?.classList.remove('coaching-highlight');

        if (this.currentTour) {
            this.completeTour(this.currentTour.id);
        }

        this.currentTour = null;
        this.currentStep = 0;
    },

    // Show a tooltip
    showTooltip(targetSelector, content, options = {}) {
        const target = document.querySelector(targetSelector);
        if (!target) return;

        const tipId = options.id || targetSelector;
        if (this.settings.dismissed_tips?.includes(tipId)) return;

        const tooltip = document.createElement('div');
        tooltip.className = 'coaching-tooltip';
        tooltip.innerHTML = `
            <div class="coaching-tooltip-content">
                ${content}
                ${options.dismissible !== false ?
                    `<button class="coaching-tooltip-dismiss" onclick="Coaching.dismissTip('${tipId}', this)">Got it</button>` :
                    ''
                }
            </div>
        `;

        target.style.position = 'relative';
        target.appendChild(tooltip);
    },

    async dismissTip(tipId, button) {
        if (!this.settings.dismissed_tips) {
            this.settings.dismissed_tips = [];
        }
        this.settings.dismissed_tips.push(tipId);
        await this.saveSettings();
        button.closest('.coaching-tooltip').remove();
    },

    // Show a feature announcement banner
    showBanner(message, options = {}) {
        const bannerId = options.id || 'banner-' + Date.now();
        if (this.settings.dismissed_tips?.includes(bannerId)) return;

        const banner = document.createElement('div');
        banner.className = 'coaching-banner';
        banner.innerHTML = `
            <div class="coaching-banner-content">
                ${options.icon ? `<span class="coaching-banner-icon">${options.icon}</span>` : ''}
                <span>${message}</span>
                ${options.action ?
                    `<a href="${options.action.href}" class="coaching-banner-action">${options.action.text}</a>` :
                    ''
                }
            </div>
            <button class="coaching-banner-close" onclick="Coaching.dismissBanner('${bannerId}', this)">×</button>
        `;

        document.body.insertBefore(banner, document.body.firstChild);
    },

    async dismissBanner(bannerId, button) {
        await this.dismissTip(bannerId, button);
    },

    // Track first-time page visits
    async trackFirstVisit(pageId) {
        if (!this.settings.first_seen) {
            this.settings.first_seen = {};
        }

        if (!this.settings.first_seen[pageId]) {
            this.settings.first_seen[pageId] = new Date().toISOString();
            await this.saveSettings();
            return true; // First visit
        }

        return false; // Repeat visit
    }
};

// Make globally available
window.Coaching = Coaching;
```

### 2. Coaching Styles

Add to `/app/coaching.css`:

```css
/* Coaching Overlay */
.coaching-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9998;
}

/* Spotlight Container */
.coaching-spotlight {
    position: fixed;
    z-index: 9999;
}

/* Coaching Card */
.coaching-card {
    background: white;
    border-radius: 12px;
    padding: 20px;
    width: 320px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    animation: coaching-fade-in 0.3s ease;
}

@keyframes coaching-fade-in {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.coaching-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.coaching-step-indicator {
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
}

.coaching-close {
    width: 24px;
    height: 24px;
    border: none;
    background: #f1f5f9;
    border-radius: 50%;
    cursor: pointer;
    font-size: 16px;
    color: #64748b;
}

.coaching-close:hover {
    background: #e2e8f0;
}

.coaching-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px 0;
    color: #1e293b;
}

.coaching-content {
    font-size: 14px;
    color: #64748b;
    line-height: 1.5;
    margin: 0 0 16px 0;
}

.coaching-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.coaching-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
}

.coaching-btn.primary {
    background: var(--color-primary, #6366f1);
    color: white;
}

.coaching-btn.primary:hover {
    background: var(--color-primary-dark, #4f46e5);
}

.coaching-btn.secondary {
    background: #f1f5f9;
    color: #64748b;
}

.coaching-btn.secondary:hover {
    background: #e2e8f0;
}

/* Highlight Effect */
.coaching-highlight {
    position: relative;
    z-index: 9999;
    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.3),
                0 0 0 8px rgba(99, 102, 241, 0.1);
    border-radius: 8px;
}

/* Tooltips */
.coaching-tooltip {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
}

.coaching-tooltip-content {
    background: #1e293b;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.4;
    max-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.coaching-tooltip-content::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: #1e293b;
}

.coaching-tooltip-dismiss {
    display: block;
    margin-top: 8px;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
}

.coaching-tooltip-dismiss:hover {
    background: rgba(255, 255, 255, 0.3);
}

/* Banners */
.coaching-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    padding: 12px 20px;
    font-size: 14px;
}

.coaching-banner-content {
    display: flex;
    align-items: center;
    gap: 12px;
}

.coaching-banner-icon {
    font-size: 20px;
}

.coaching-banner-action {
    color: white;
    font-weight: 600;
    text-decoration: underline;
}

.coaching-banner-close {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 14px;
}

.coaching-banner-close:hover {
    background: rgba(255, 255, 255, 0.3);
}
```

### 3. Pre-built Tours

Create `/app/coaching-tours.js`:

```javascript
/**
 * Pre-built coaching tours for Royalty features
 */

const COACHING_TOURS = {
    // Dashboard introduction for new users
    'dashboard-intro': {
        id: 'dashboard-intro',
        name: 'Welcome to Royalty',
        trigger: 'first_visit',
        steps: [
            {
                target: '.sidebar',
                title: 'Navigation',
                content: 'Use the sidebar to navigate between different sections of your workspace.',
                position: 'right'
            },
            {
                target: '[data-nav="projects"]',
                title: 'Projects',
                content: 'Organize your work into projects. Each project can contain multiple automations.',
                position: 'right'
            },
            {
                target: '[data-nav="automations"]',
                title: 'Automations',
                content: 'Build powerful workflows that run automatically based on triggers.',
                position: 'right'
            },
            {
                target: '.quick-action-btn',
                title: 'Quick Actions',
                content: 'Click here to quickly create a new automation from templates.',
                position: 'bottom'
            }
        ]
    },

    // Automation builder tour
    'automation-builder': {
        id: 'automation-builder',
        name: 'Building Automations',
        trigger: 'page_visit',
        page: 'automation.html',
        steps: [
            {
                target: '.trigger-selector',
                title: 'Choose a Trigger',
                content: 'Every automation starts with a trigger - the event that kicks things off.',
                position: 'bottom'
            },
            {
                target: '.workflow-canvas',
                title: 'Build Your Workflow',
                content: 'Add actions and conditions to create your automation logic.',
                position: 'left'
            },
            {
                target: '.test-automation-btn',
                title: 'Test Before Launch',
                content: 'Always test your automation with sample data before activating.',
                position: 'bottom'
            },
            {
                target: '.publish-btn',
                title: 'Go Live',
                content: 'When ready, publish your automation to start processing real events.',
                position: 'left'
            }
        ]
    },

    // Customer Apps introduction
    'apps-intro': {
        id: 'apps-intro',
        name: 'Customer Apps',
        trigger: 'first_visit',
        page: 'apps.html',
        steps: [
            {
                target: '.template-cards',
                title: 'Start with a Template',
                content: 'Choose from pre-built app templates like Loyalty Programs, Rewards Clubs, or VIP Memberships.',
                position: 'bottom'
            },
            {
                target: '#new-app-btn',
                title: 'Or Start Fresh',
                content: 'Create a custom app from scratch with exactly the features you need.',
                position: 'bottom'
            },
            {
                target: '.apps-grid',
                title: 'Your Apps',
                content: 'All your customer-facing apps appear here. Click any app to edit it.',
                position: 'top'
            }
        ]
    },

    // App Builder tour
    'app-builder': {
        id: 'app-builder',
        name: 'App Builder',
        trigger: 'page_visit',
        page: 'app-builder.html',
        steps: [
            {
                target: '.wizard-steps',
                title: 'Step-by-Step Builder',
                content: 'Follow these steps to configure your customer app.',
                position: 'bottom'
            },
            {
                target: '.feature-toggles',
                title: 'Choose Features',
                content: 'Enable or disable features like points, leaderboards, and rewards.',
                position: 'right'
            },
            {
                target: '.brand-settings',
                title: 'Match Your Brand',
                content: 'Customize colors and upload your logo to match your brand.',
                position: 'left'
            },
            {
                target: '.phone-mockup',
                title: 'Live Preview',
                content: 'See how your app looks on a phone in real-time as you make changes.',
                position: 'left'
            },
            {
                target: '.qr-section',
                title: 'Share with QR Code',
                content: 'Generate a QR code for customers to scan and join your app.',
                position: 'bottom'
            }
        ]
    }
};

// Export for use
if (typeof module !== 'undefined') {
    module.exports = COACHING_TOURS;
}
```

### 4. Integration Example

Add to any page that needs coaching:

```javascript
// In the page's init function
async function initPage() {
    // ... other initialization ...

    // Initialize coaching
    await Coaching.init(currentUser.id);

    // Check for first visit and show relevant tour
    const isFirstVisit = await Coaching.trackFirstVisit('apps-page');
    if (isFirstVisit) {
        Coaching.startTour(COACHING_TOURS['apps-intro']);
    }

    // Show feature announcement banner
    Coaching.showBanner('New: Customer Apps are here!', {
        id: 'customer-apps-launch',
        icon: '🎉',
        action: {
            text: 'Learn more',
            href: '/app/apps.html'
        }
    });
}
```

## Usage Patterns

### Show Tour on First Page Visit

```javascript
const isFirstVisit = await Coaching.trackFirstVisit('page-id');
if (isFirstVisit) {
    Coaching.startTour(COACHING_TOURS['tour-id']);
}
```

### Show Contextual Tooltip

```javascript
Coaching.showTooltip('#new-feature-btn',
    'Try our new feature! Click here to get started.',
    { id: 'tip-new-feature' }
);
```

### Announce New Feature

```javascript
Coaching.showBanner('We just launched dark mode!', {
    id: 'dark-mode-announcement',
    icon: '🌙',
    action: {
        text: 'Try it',
        href: '/settings'
    }
});
```

### Track Onboarding Progress

```javascript
// When user completes an onboarding task
async function markOnboardingStep(step) {
    Coaching.settings.onboarding_progress[step] = true;
    await Coaching.saveSettings();

    // Check if onboarding complete
    const progress = Coaching.settings.onboarding_progress;
    if (progress.created_automation &&
        progress.invited_team &&
        progress.connected_channel) {
        showCelebration('Onboarding complete! 🎉');
    }
}
```

## Database Schema

The coaching state is stored in the existing `profiles.settings` JSONB column:

```sql
-- No new tables needed, uses existing profiles.settings
-- Example settings structure:
{
    "coaching": {
        "completed_tours": ["dashboard-intro", "automation-basics"],
        "dismissed_tips": ["tip-keyboard-shortcuts", "banner-v2-launch"],
        "onboarding_progress": {
            "created_automation": true,
            "invited_team": false,
            "connected_channel": false
        },
        "first_seen": {
            "dashboard": "2026-01-28T12:00:00Z",
            "apps_page": "2026-01-30T10:00:00Z",
            "app_builder": null
        }
    }
}
```

## Files Reference

- `/app/coaching.js` - Core coaching system
- `/app/coaching.css` - Coaching styles
- `/app/coaching-tours.js` - Pre-built tour configurations
- `/skills/coaching.md` - This skill documentation

## Best Practices

1. **Don't overwhelm** - Show one tour at a time, don't stack multiple
2. **Respect dismissals** - Once dismissed, don't show again
3. **Be helpful, not annoying** - Use sparingly and only for genuinely useful guidance
4. **Keep it short** - Tours should be 3-5 steps max
5. **Position carefully** - Make sure tooltips don't cover important UI
6. **Test on mobile** - Ensure coaching works well on smaller screens
7. **Track completion** - Know which users have seen which tutorials
