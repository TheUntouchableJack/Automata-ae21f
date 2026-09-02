// ===== App Config Fallback =====
// Builds a complete, plausible loyalty-app configuration from nothing but the
// visitor's description and the industry the signup analysis extracted.
//
// WHY THIS EXISTS
// The homepage now shows people their actual app BEFORE the signup wall. That
// makes a visible failure fatal: an error message where the payoff should be is
// worse than the marketing report it replaced. So this module must always
// return something usable. It has two tiers and neither shows an error:
//
//   1. template   — a real template from the app templates library, keyed off
//                   the description and industry, with an industry palette,
//                   industry-flavoured tier names, and starter rewards drawn
//                   from what that kind of business can actually hand over.
//   2. hardcoded  — a literal, returned from the catch, so even a bug in tier 1
//                   cannot produce a blank preview.
//
// Everything lives inside the IIFE. No bare globals are declared, so this can be
// loaded alongside dashboard.js (which has its own INDUSTRY_REWARD_PROPOSALS)
// without tripping the shared-global-scope rule in CLAUDE.md.
//
// Depends on (optional, degrades cleanly if absent):
//   getSuggestedAppTemplates / getAppTemplateById — app-templates-library.js
//
// Exposes: AppConfigFallback.build({ prompt, industry, businessName }) -> config

const AppConfigFallback = (function () {

    // ── Palette ──────────────────────────────────────────────────────────────
    // Every primary here is checked against WHITE text at >= 4.5:1 (WCAG AA) by
    // tests/app-config-fallback.test.js. The whole point of the preview is a
    // readable phone mockup; a pale primary makes the header text vanish and the
    // payoff moment fails silently, which is the hardest kind of bug to notice.
    // If you add an industry, add a case to that test too.
    const INDUSTRY_PALETTE = {
        food:       { primary: '#B3261E', secondary: '#3F2021' },  // warm red
        retail:     { primary: '#1F4E79', secondary: '#16324F' },  // deep blue
        health:     { primary: '#0F5C56', secondary: '#123B38' },  // deep teal
        service:    { primary: '#3B3663', secondary: '#241F3F' },  // indigo
        technology: { primary: '#1E3A5F', secondary: '#132741' },  // navy
        education:  { primary: '#7A3E12', secondary: '#4A250B' },  // warm brown
        other:      { primary: '#5B21B6', secondary: '#2E1065' }   // brand purple
    };

    // ── Tier vocabulary ──────────────────────────────────────────────────────
    // Bronze/Silver/Gold/Platinum is the thing we are replacing. These read like
    // the business named them. The tier KEYS stay canonical (bronze/silver/gold/
    // platinum) because award_points and the whole tier system depend on them --
    // only the display name changes.
    const INDUSTRY_TIER_NAMES = {
        food:       ['Regular', 'Local', 'Insider', 'Legend'],
        retail:     ['Member', 'Insider', 'VIP', 'Icon'],
        health:     ['Starter', 'Committed', 'Dedicated', 'Elite'],
        service:    ['Client', 'Preferred', 'Priority', 'Signature'],
        technology: ['User', 'Pro', 'Power', 'Founder'],
        education:  ['Learner', 'Scholar', 'Mentor', 'Master'],
        other:      ['Member', 'Regular', 'Insider', 'Legend']
    };

    // ── Starter rewards ──────────────────────────────────────────────────────
    // Things the business can physically hand over, named the way they would name
    // them. Deliberately NOT "Free Item" / "10% Off" / "VIP Treatment" /
    // "Birthday Bonus" -- the four filler rewards every business currently gets.
    //
    // Distinct from dashboard.js's INDUSTRY_REWARD_PROPOSALS, which seeds the
    // admin Suggestions tab with things the owner does NOT yet offer. These are
    // the rewards that actually exist from day one. Reusing one list for both
    // would have Royal AI suggest rewards the owner already has.
    const INDUSTRY_REWARDS = {
        food: [
            { name: 'Free Coffee or Soft Drink', description: 'Any regular drink, on the house', pointsCost: 50, tierRequired: null },
            { name: 'Free Starter',              description: 'Pick any starter with your main',  pointsCost: 100, tierRequired: null },
            { name: 'Free Dessert',              description: 'Any dessert from the menu',        pointsCost: 150, tierRequired: null },
            { name: 'Bring a Friend Free',       description: 'Your guest’s main is on us',   pointsCost: 400, tierRequired: 'silver' }
        ],
        retail: [
            { name: 'Free Gift Wrapping',    description: 'Complimentary wrapping on any purchase', pointsCost: 50, tierRequired: null },
            { name: 'Free Item Under 10',    description: 'Any single item under ten, on us',      pointsCost: 100, tierRequired: null },
            { name: 'Early Access to Sales', description: 'Shop every sale 24 hours early',          pointsCost: 200, tierRequired: null },
            { name: 'Personal Shopping Hour', description: 'One-to-one appointment with our team',   pointsCost: 450, tierRequired: 'silver' }
        ],
        health: [
            { name: 'Guest Pass',            description: 'Bring a friend along for a session', pointsCost: 75, tierRequired: null },
            { name: 'Free Add-On Treatment', description: 'A complimentary extra on your visit', pointsCost: 150, tierRequired: null },
            { name: 'Priority Booking',      description: 'First pick of appointment slots',     pointsCost: 200, tierRequired: null },
            { name: 'Free Session',          description: 'One full session on the house',       pointsCost: 450, tierRequired: 'silver' }
        ],
        service: [
            { name: 'Priority Scheduling', description: 'Jump the queue for your next booking', pointsCost: 75, tierRequired: null },
            { name: 'Free Add-On',         description: 'A complimentary extra with your service', pointsCost: 150, tierRequired: null },
            { name: 'Service Upgrade',     description: 'Upgrade your next booking, no charge',  pointsCost: 250, tierRequired: null },
            { name: 'One Free Service',    description: 'Your usual booking, on us',             pointsCost: 450, tierRequired: 'silver' }
        ],
        technology: [
            { name: 'One Month Free',      description: 'A month on us, applied to your next bill', pointsCost: 200, tierRequired: null },
            { name: 'Priority Support',    description: 'Front of the queue for 30 days',           pointsCost: 100, tierRequired: null },
            { name: 'Early Access',        description: 'Try new features before general release',   pointsCost: 150, tierRequired: null },
            { name: 'Onboarding Session',  description: 'A one-to-one setup call with our team',    pointsCost: 400, tierRequired: 'silver' }
        ],
        education: [
            { name: 'Free Study Materials', description: 'A course pack or workbook of your choice', pointsCost: 75, tierRequired: null },
            { name: 'Bring a Friend',       description: 'Guest place at any single class',          pointsCost: 150, tierRequired: null },
            { name: 'One-to-One Session',   description: 'A private session with an instructor',     pointsCost: 300, tierRequired: null },
            { name: 'Free Course Module',   description: 'A full module, no charge',                 pointsCost: 500, tierRequired: 'silver' }
        ],
        other: [
            { name: 'Thank-You Reward',   description: 'A small thank you for coming back',      pointsCost: 50, tierRequired: null },
            { name: 'Free Add-On',        description: 'A complimentary extra on your next visit', pointsCost: 150, tierRequired: null },
            { name: 'Insider Perk',       description: 'Something we only offer to regulars',     pointsCost: 250, tierRequired: null },
            { name: 'One On Us',          description: 'Your usual, completely free',             pointsCost: 450, tierRequired: 'silver' }
        ]
    };

    const VALID_INDUSTRIES = Object.keys(INDUSTRY_PALETTE);

    // Templates that are not loyalty programmes. getSuggestedAppTemplates will
    // happily return venue-social for the word "bar" and a newsletter template
    // for the word "content", neither of which is an app anyone asked for here.
    const EXCLUDED_APP_TYPES = ['newsletter', 'social'];

    function normalizeIndustry(industry) {
        const i = String(industry || '').toLowerCase().trim();
        return VALID_INDUSTRIES.includes(i) ? i : 'other';
    }

    // ── Tier 1: template ─────────────────────────────────────────────────────
    function pickTemplate(prompt, industry) {
        if (typeof getSuggestedAppTemplates !== 'function') return null;
        try {
            const suggestions = getSuggestedAppTemplates(prompt || '', industry || '') || [];
            const usable = suggestions.filter(t => t && !EXCLUDED_APP_TYPES.includes(t.app_type));
            if (usable.length) return usable[0];
        } catch (e) {
            console.warn('[AppConfigFallback] template suggestion failed:', e);
        }
        try {
            if (typeof getAppTemplateById === 'function') {
                return getAppTemplateById('loyalty-points') || null;
            }
        } catch (e) { /* fall through to hardcoded */ }
        return null;
    }

    function buildTiers(industry, silverPoints, goldPoints, platinumPoints) {
        const names = INDUSTRY_TIER_NAMES[industry] || INDUSTRY_TIER_NAMES.other;
        return [
            { key: 'bronze',   name: names[0], points: 0 },
            { key: 'silver',   name: names[1], points: silverPoints },
            { key: 'gold',     name: names[2], points: goldPoints },
            { key: 'platinum', name: names[3], points: platinumPoints }
        ];
    }

    function appNameFor(businessName, industry) {
        const clean = String(businessName || '').trim();
        if (clean) return `${clean} Rewards`;
        const label = {
            food: 'Table', retail: 'Shop', health: 'Studio', service: 'Client',
            technology: 'Member', education: 'Class', other: 'Loyalty'
        }[industry] || 'Loyalty';
        return `${label} Rewards`;
    }

    // ── Tier 2: hardcoded ────────────────────────────────────────────────────
    // Deliberately literal. This is what a visitor sees if tier 1 throws, so it
    // must not depend on anything above it.
    function hardcodedConfig(businessName) {
        return {
            source: 'hardcoded',
            templateId: null,
            appName: (String(businessName || '').trim() || 'My') + ' Rewards',
            appDescription: 'Earn points every visit and turn them into rewards.',
            appType: 'loyalty',
            primaryColor: '#5B21B6',
            secondaryColor: '#2E1065',
            pointsPerScan: 10,
            pointsPerDollar: 1,
            welcomePoints: 50,
            dailyScanLimit: 1,
            tiers: [
                { key: 'bronze',   name: 'Member',  points: 0 },
                { key: 'silver',   name: 'Regular', points: 500 },
                { key: 'gold',     name: 'Insider', points: 1500 },
                { key: 'platinum', name: 'Legend',  points: 5000 }
            ],
            rewards: [
                { name: 'Thank-You Reward', description: 'A small thank you for coming back', pointsCost: 50, tierRequired: null },
                { name: 'Free Add-On', description: 'A complimentary extra on your next visit', pointsCost: 150, tierRequired: null },
                { name: 'Insider Perk', description: 'Something we only offer to regulars', pointsCost: 250, tierRequired: null }
            ],
            features: {
                points_enabled: true,
                rewards_enabled: true,
                leaderboard_enabled: true,
                menu_enabled: false,
                announcements_enabled: true,
                referrals_enabled: false
            }
        };
    }

    /**
     * Build a complete app config. Never throws, never returns null.
     *
     * @param {object} input
     * @param {string} input.prompt        the visitor's business description
     * @param {string} input.industry      industry enum from extractedDetails
     * @param {string} input.businessName  business name from extractedDetails
     * @returns {object} config with a `source` of 'template' or 'hardcoded'
     */
    function build(input) {
        const opts = input || {};
        try {
            const industry = normalizeIndustry(opts.industry);
            const palette = INDUSTRY_PALETTE[industry];
            const template = pickTemplate(opts.prompt, industry);
            const tSettings = (template && template.settings) || {};

            const silver   = Number(tSettings.tier_thresholds?.silver)   || 500;
            const gold     = Number(tSettings.tier_thresholds?.gold)     || 1500;
            const platinum = Number(tSettings.tier_thresholds?.platinum) || 5000;

            const rewards = (INDUSTRY_REWARDS[industry] || INDUSTRY_REWARDS.other)
                // Keep the cheapest reward reachable well before silver, so there
                // is something to aim at in the first couple of weeks.
                .filter(r => r.pointsCost <= silver)
                .map(r => ({ ...r }));

            const cheapest = rewards.length
                ? Math.min(...rewards.map(r => r.pointsCost))
                : 50;

            const config = {
                source: template ? 'template' : 'hardcoded',
                templateId: template ? template.id : null,
                appName: appNameFor(opts.businessName, industry),
                appDescription: template && template.description
                    ? template.description
                    : 'Earn points every visit and turn them into rewards.',
                appType: (template && template.app_type) || 'loyalty',
                primaryColor: palette.primary,
                secondaryColor: palette.secondary,
                pointsPerScan: Number(tSettings.points_per_scan) || 10,
                pointsPerDollar: Number(tSettings.points_per_dollar) || 1,
                // Never hand out enough at signup to claim a paid reward for free.
                welcomePoints: Math.min(Number(tSettings.welcome_points) || 50, cheapest),
                dailyScanLimit: Number(tSettings.daily_scan_limit) || 1,
                tiers: buildTiers(industry, silver, gold, platinum),
                rewards: rewards.length ? rewards : hardcodedConfig(opts.businessName).rewards,
                features: (template && template.features) || hardcodedConfig().features
            };

            // If the template lookup produced nothing usable we are effectively on
            // the hardcoded tier; say so honestly rather than labelling it template.
            if (!template) config.source = 'hardcoded';
            return config;
        } catch (e) {
            // A bug above must not cost a signup.
            console.error('[AppConfigFallback] falling back to hardcoded config:', e);
            return hardcodedConfig(opts.businessName);
        }
    }

    return {
        build,
        // exposed for tests
        _INDUSTRY_PALETTE: INDUSTRY_PALETTE,
        _INDUSTRY_REWARDS: INDUSTRY_REWARDS,
        _normalizeIndustry: normalizeIndustry
    };
})();

if (typeof window !== 'undefined') window.AppConfigFallback = AppConfigFallback;
if (typeof module !== 'undefined' && module.exports) module.exports = { AppConfigFallback };
