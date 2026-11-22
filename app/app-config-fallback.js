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
//          AppConfigFallback.isSane(config) -> false for a stored config nobody could use

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

    // ── Niches ───────────────────────────────────────────────────────────────
    // The signup analysis normally supplies the industry. When it fails (AI down,
    // timeout) the industry arrives empty, and before 2026-11-22 a coffee shop got
    // the generic "other" app. The visitor's own words still say what the business
    // is, so these keywords recover it, along with rewards that trade actually
    // hands over. First match wins: keep the specific ones ("nail salon") above the
    // general ones ("salon").
    //
    // Reward costs here use the same scale as INDUSTRY_REWARDS: 10 points = one
    // visit. build() rescales them to the template's points per visit, so a reward
    // always takes the same number of VISITS whatever the template's economy.
    // Costs are multiples of 50 so the 1-point-a-visit punch card scales cleanly.
    //
    // `tiers` (optional) is a ladder in VISITS for trades whose visit rhythm the
    // template ladder doesn't fit: the generic template puts silver at 50 visits,
    // which is four years of monthly haircuts. A niche with `tiers` also keeps all
    // its curated rewards (no "cheaper than silver" filter). These three match the
    // /loyalty-program/ landing pages, which quote the same visits and names.
    const NICHES = [
        // Nails: a fill or new set every 2-3 weeks, about 20 visits a year.
        { key: 'nails', template: 'loyalty-points', industry: 'service', label: 'Nail',
          re: /\b(nail salon|nail bar|nail studio|nails|manicures?|pedicures?|mani-?pedi)\b/i,
          tiers: { names: ['First Set', 'Regular', 'Polished', 'Icon'], visits: [0, 8, 20, 40] },
          rewards: [
            { name: 'Free Nail Art',          description: 'Accent nails on your next set',      pointsCost: 40,  tierRequired: null },
            { name: 'Free Paraffin Treatment', description: 'Add it to any manicure or pedicure', pointsCost: 60,  tierRequired: null },
            { name: 'Free Gel Upgrade',        description: 'Gel finish at no extra cost',        pointsCost: 80,  tierRequired: null },
            { name: 'Free Manicure',           description: 'A classic manicure, on us',          pointsCost: 120, tierRequired: 'silver' }
          ] },
        // Barber: a cut every 3-5 weeks, about 12 visits a year. "10th cut free" is
        // the trade's own punch card, so the free haircut sits at 10 visits.
        { key: 'barber', template: 'loyalty-points', industry: 'service', label: 'Barber',
          re: /\b(barbers?|barbershops?|barber shop)\b/i,
          tiers: { names: ['Fresh Cut', 'Regular', 'Sharp', 'Legend'], visits: [0, 6, 12, 24] },
          rewards: [
            { name: 'Free Line-Up',        description: 'A quick edge-up between cuts',        pointsCost: 30,  tierRequired: null },
            { name: 'Free Beard Trim',     description: 'Shape and trim with your next cut',   pointsCost: 50,  tierRequired: null },
            { name: 'Free Hot Towel Shave', description: 'The full hot towel treatment',       pointsCost: 80,  tierRequired: null },
            { name: 'Free Haircut',        description: 'Your usual cut, on the house',        pointsCost: 100, tierRequired: null }
          ] },
        { key: 'salon', template: 'loyalty-points', industry: 'service', label: 'Salon',
          re: /\b(hair salons?|salons?|hairdressers?|hair stylists?|blow ?dry bar|blowouts?)\b/i,
          rewards: [
            { name: 'Free Deep Conditioning', description: 'Added to your next appointment', pointsCost: 50,  tierRequired: null },
            { name: 'Free Blowout',           description: 'A wash and blowout, on us',      pointsCost: 100, tierRequired: null },
            { name: 'Free Gloss Treatment',   description: 'Shine and tone with any service', pointsCost: 150, tierRequired: null },
            { name: 'Free Cut',               description: 'Your next cut, on the house',     pointsCost: 300, tierRequired: 'silver' }
          ] },
        { key: 'bakery', template: 'loyalty-points', industry: 'food', label: 'Bakery',
          re: /\b(bakery|bakeries|bake shop|bakeshop|patisserie|p\u00e2tisserie|boulangerie|donuts?|doughnuts?|cupcakes?)\b/i,
          rewards: [
            { name: 'Free Cookie',           description: 'Any cookie from the counter',     pointsCost: 50,  tierRequired: null },
            { name: 'Free Coffee and Pastry', description: 'Any pastry with a regular coffee', pointsCost: 100, tierRequired: null },
            { name: 'Free Loaf',             description: 'Any bread from today\u2019s bake', pointsCost: 150, tierRequired: null },
            { name: 'Half-Dozen on Us',      description: 'Six of your favourites, free',    pointsCost: 300, tierRequired: 'silver' }
          ] },
        // Coffee: several visits a week, 100-150 a year.
        { key: 'coffee', template: 'cafe-rewards', industry: 'food', label: 'Coffee',
          tiers: { names: ['Newcomer', 'Regular', 'The Usual', 'House Legend'], visits: [0, 25, 75, 200] },
          re: /\b(coffee|caf[e\u00e9]s?|espresso|coffee ?house|roastery|roasters?|tea ?house|tea shop|boba|bubble tea)\b/i,
          rewards: [
            { name: 'Free Pastry',           description: 'Anything from the pastry case',   pointsCost: 50,  tierRequired: null },
            { name: 'Free House Coffee',     description: 'Any size, your 10th one is on us', pointsCost: 100, tierRequired: null },
            { name: 'Free Specialty Drink',  description: 'Latte, mocha or any signature drink', pointsCost: 150, tierRequired: null },
            { name: 'Bag of House Beans',    description: 'Take our house roast home',       pointsCost: 300, tierRequired: 'silver' }
          ] },
        { key: 'restaurant', template: 'restaurant-rewards', industry: 'food', label: 'Table', rewards: null,
          re: /\b(restaurants?|bistros?|diners?|pizzerias?|pizza|taquerias?|tacos?|ramen|sushi|burgers?|grills?|eatery|eateries|brunch|food truck|kitchen)\b/i },
        { key: 'yoga', template: 'fitness-club', industry: 'health', label: 'Studio',
          re: /\b(yoga|pilates|barre|spin studio|cycling studio|dance studio|meditation)\b/i,
          rewards: [
            { name: 'Free Mat and Towel',  description: 'Rental included on your next class', pointsCost: 50,  tierRequired: null },
            { name: 'Bring a Friend',      description: 'A friend joins any class free',      pointsCost: 100, tierRequired: null },
            { name: 'Free Class',          description: 'Any class on the schedule, on us',   pointsCost: 150, tierRequired: null },
            { name: 'Free Workshop',       description: 'A place at our next workshop',       pointsCost: 400, tierRequired: 'silver' }
          ] },
        { key: 'gym', template: 'fitness-club', industry: 'health', label: 'Gym',
          re: /\b(gyms?|fitness|crossfit|boxing|kickboxing|martial arts|jiu-?jitsu|karate|bootcamp|personal train(?:er|ing))\b/i,
          rewards: [
            { name: 'Guest Pass',             description: 'Bring a friend for a workout', pointsCost: 50,  tierRequired: null },
            { name: 'Free Shake or Smoothie', description: 'Any drink from the bar',      pointsCost: 100, tierRequired: null },
            { name: 'Free Coaching Session',  description: 'One session with a trainer',  pointsCost: 200, tierRequired: null },
            { name: 'A Month On Us',          description: 'One month of membership free', pointsCost: 450, tierRequired: 'silver' }
          ] },
        { key: 'carwash', template: 'loyalty-points', industry: 'service', label: 'Wash',
          re: /\b(car ?wash(?:es)?|auto detail(?:ing|er)?|car detail(?:ing|er)?|detailing)\b/i,
          rewards: [
            { name: 'Free Tire Shine',      description: 'Added to any wash',            pointsCost: 50,  tierRequired: null },
            { name: 'Free Interior Vacuum', description: 'Full vacuum with your wash',   pointsCost: 100, tierRequired: null },
            { name: 'Free Basic Wash',      description: 'Your next exterior wash, free', pointsCost: 150, tierRequired: null },
            { name: 'Free Full Detail',     description: 'Inside and out, on us',         pointsCost: 400, tierRequired: 'silver' }
          ] }
    ];

    function detectNiche(prompt) {
        const text = String(prompt || '');
        if (!text) return null;
        return NICHES.find(n => n.re.test(text)) || null;
    }

    // ── Business name from the description ───────────────────────────────────
    // Used while the analysis runs (and when it fails). The old guess applied the
    // /i flag to the whole pattern, so its "[A-Z]" also matched lowercase: "I run a
    // small coffee shop called Bean There" came out as "small coffee". Here only
    // the keywords ignore case; a name must really start with a capital letter or
    // digit, and when nothing reads as a name the result is '' (the preview then
    // uses the industry label rather than a wrong name).
    const NAME_WORD = "[A-Z0-9][\\w\u2019'&-]*";
    const NAME_JOIN = "(?:of|the|and|by|on|at|de|la|le|du|el|y|&|n'|'n')";
    const NAME = '(' + NAME_WORD + '(?:\\s+(?:' + NAME_JOIN + '\\s+)?' + NAME_WORD + '){0,4})';
    const NAME_PATTERNS = [
        // "... called Bean There", "... named Fade Factory"
        new RegExp("\\b(?:[Cc]alled|[Nn]amed)\\s+[\"\u201c'\u2018]?" + NAME),
        // "Bean There is a coffee shop", "Fade Factory is my barbershop"
        new RegExp('^' + NAME + "\\s+(?:is|was|are)\\s+(?:a|an|the|my|our)\\b"),
        // "I own Bean There, a cafe", "we run The Daily Grind in Austin"
        new RegExp('\\b(?:[Oo]wn|[Rr]un|[Oo]perate|[Mm]anage|[Hh]ave)\\s+' + NAME + '(?=\\s*[,.;!]|\\s+(?:which|that|is|in|on|near|where|a|an)\\b|\\s*$)')
    ];
    const NAME_STOPWORDS = ['i', 'we', 'my', 'our', 'the', 'a', 'an', 'it', 'this', 'that', 'hi', 'hello', 'hey', 'im'];

    function guessName(prompt) {
        const text = String(prompt || '').trim();
        if (!text) return '';
        for (const re of NAME_PATTERNS) {
            const m = text.match(re);
            if (!m || !m[1]) continue;
            const name = m[1].replace(/[\s'\u2019&-]+$/, '').trim();
            if (!name || name.length > 40) continue;
            if (NAME_STOPWORDS.includes(name.toLowerCase().replace(/[^a-z]/g, ''))) continue;
            return name;
        }
        return '';
    }

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
    function pickTemplate(prompt, industry, preferredId) {
        // A niche names the template that fits its trade. Keyword matching alone
        // sends "barbershop" to the retail rewards-club template (it contains "shop").
        if (preferredId && typeof getAppTemplateById === 'function') {
            try {
                const preferred = getAppTemplateById(preferredId);
                if (preferred && !EXCLUDED_APP_TYPES.includes(preferred.app_type)) return preferred;
            } catch (e) { /* fall through to suggestions */ }
        }
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

    function appNameFor(businessName, industry, niche) {
        const clean = String(businessName || '').trim();
        if (clean) return `${clean} Rewards`;
        if (niche && niche.label) return `${niche.label} Rewards`;
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
            // 30, not 50: the first reward (50) still takes two visits.
            welcomePoints: 30,
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

    // ── Sanity check for a stored config ─────────────────────────────────────
    // A config saved by an older build (before the reward rescale) can pair 1
    // point a visit with a 50-point first reward: 49 visits to anything. The
    // signup page and OnboardingSave rebuild a stored config that fails this, so
    // one is neither shown nor turned into a real app. Every build() passes it.
    function isSane(config) {
        if (!config || typeof config !== 'object') return false;
        const pointsPerScan = Number(config.pointsPerScan);
        if (!Number.isFinite(pointsPerScan) || pointsPerScan < 1) return false;
        const rewards = Array.isArray(config.rewards) ? config.rewards : [];
        if (!rewards.length) return false;
        const costs = rewards.map(r => Number(r && r.pointsCost));
        if (costs.some(c => !Number.isFinite(c) || c < 1)) return false;
        const cheapest = Math.min(...costs);
        const welcome = Number(config.welcomePoints || 0);
        if (!Number.isFinite(welcome) || welcome < 0 || welcome >= cheapest) return false;
        const visits = Math.ceil((cheapest - welcome) / pointsPerScan);
        return visits >= 2 && visits <= 20;
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
            // The prompt's keywords fill in a missing industry, and pick niche
            // rewards when they agree with the industry the analysis returned.
            const niche = detectNiche(opts.prompt);
            let industry = normalizeIndustry(opts.industry);
            if (industry === 'other' && niche) industry = niche.industry;
            const nicheFits = !!(niche && niche.industry === industry);
            const palette = INDUSTRY_PALETTE[industry];
            const template = pickTemplate(opts.prompt, industry, nicheFits ? niche.template : null);
            const tSettings = (template && template.settings) || {};

            const silver   = Number(tSettings.tier_thresholds?.silver)   || 500;
            const gold     = Number(tSettings.tier_thresholds?.gold)     || 1500;
            const platinum = Number(tSettings.tier_thresholds?.platinum) || 5000;
            const pointsPerScan = Number(tSettings.points_per_scan) || 10;

            // Reward lists are written at 10 points a visit. Rescale to this
            // template's rate, or the 1-point-a-visit cafe card showed a 50-point
            // reward (50 visits) next to "1 pts per visit".
            const scale = pointsPerScan / 10;
            const rescale = (cost) => {
                const v = cost * scale;
                return v >= 10 ? Math.max(5, Math.round(v / 5) * 5) : Math.max(1, Math.round(v));
            };
            const sourceRewards = (nicheFits && niche.rewards) || INDUSTRY_REWARDS[industry] || INDUSTRY_REWARDS.other;
            const scaled = sourceRewards.map(r => ({ ...r, pointsCost: rescale(r.pointsCost) }));
            // Keep the cheapest reward reachable well before silver, so there is
            // something to aim at in the first couple of weeks. A template with a
            // low silver line must still show a few rewards.
            const nicheTiers = (nicheFits && niche.tiers) ? niche.tiers : null;
            let rewards = nicheTiers ? scaled : scaled.filter(r => r.pointsCost <= silver);
            if (rewards.length < 3) rewards = scaled.slice().sort((a, b) => a.pointsCost - b.pointsCost).slice(0, 3);

            const cheapest = rewards.length
                ? Math.min(...rewards.map(r => r.pointsCost))
                : 50;

            const config = {
                source: template ? 'template' : 'hardcoded',
                templateId: template ? template.id : null,
                appName: appNameFor(opts.businessName, industry, nicheFits ? niche : null),
                appDescription: template && template.description
                    ? template.description
                    : 'Earn points every visit and turn them into rewards.',
                appType: (template && template.app_type) || 'loyalty',
                primaryColor: palette.primary,
                secondaryColor: palette.secondary,
                pointsPerScan,
                pointsPerDollar: Number(tSettings.points_per_dollar) || 1,
                // Never hand out enough at signup to claim a reward for free: the
                // first one should take at least two visits.
                welcomePoints: Math.max(0, Math.min(Number(tSettings.welcome_points) || 50, cheapest - 2 * pointsPerScan)),
                dailyScanLimit: Number(tSettings.daily_scan_limit) || 1,
                tiers: nicheTiers
                    ? ['bronze', 'silver', 'gold', 'platinum'].map((key, i) => ({
                        key, name: nicheTiers.names[i], points: nicheTiers.visits[i] * pointsPerScan
                    }))
                    : buildTiers(industry, silver, gold, platinum),
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
        isSane,
        guessName,
        detectNiche: (prompt) => { const n = detectNiche(prompt); return n ? { key: n.key, industry: n.industry, label: n.label } : null; },
        // exposed for tests
        _INDUSTRY_PALETTE: INDUSTRY_PALETTE,
        _INDUSTRY_REWARDS: INDUSTRY_REWARDS,
        _normalizeIndustry: normalizeIndustry
    };
})();

if (typeof window !== 'undefined') window.AppConfigFallback = AppConfigFallback;
if (typeof module !== 'undefined' && module.exports) module.exports = { AppConfigFallback };
