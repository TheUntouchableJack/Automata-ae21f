#!/usr/bin/env node
/**
 * One-time script to create Stripe products and prices for Royalty
 *
 * USAGE:
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe-products.cjs
 *
 * Get your secret key from: https://dashboard.stripe.com/apikeys
 *
 * SECURITY: The key is passed as an environment variable and never stored.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

if (!process.env.STRIPE_SECRET_KEY) {
    console.error('\n❌ Error: STRIPE_SECRET_KEY environment variable is required\n');
    console.log('Usage:');
    console.log('  STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe-products.cjs\n');
    console.log('Get your secret key from: https://dashboard.stripe.com/apikeys');
    process.exit(1);
}

// Check if we're in live mode
const isLive = process.env.STRIPE_SECRET_KEY.startsWith('sk_live_');
console.log(`\n🔑 Running in ${isLive ? 'LIVE' : 'TEST'} mode\n`);

// Royalty subscription products - Feb 2026 pricing
const products = [
    {
        name: 'Royalty Starter',
        description: 'Royal Helps You. 500 members, 2,000 emails/mo, 100 SMS/mo, 5 automations (review mode).',
        metadata: {
            tier: 'starter',
            members: '500',
            emails_monthly: '2000',
            sms_monthly: '100',
            max_automations: '5',
            royal_chat: 'true',
            review_mode: 'true',
            autonomous_mode: 'false',
            white_label: 'false'
        },
        prices: [
            { amount: 7900, interval: 'month', nickname: 'Starter Monthly', lookup_key: 'starter_monthly' },
            { amount: 75600, interval: 'year', nickname: 'Starter Annual (Save 20%)', lookup_key: 'starter_annual' } // $63/mo
        ]
    },
    {
        name: 'Royalty Growth',
        description: 'Royal Runs Your Marketing. 2,000 members, 10,000 emails/mo, 500 SMS/mo, unlimited automations, Autonomous Mode.',
        metadata: {
            tier: 'growth',
            members: '2000',
            emails_monthly: '10000',
            sms_monthly: '500',
            max_automations: 'unlimited',
            royal_chat: 'true',
            review_mode: 'true',
            autonomous_mode: 'true',
            business_learning: 'true',
            fatigue_protection: 'true',
            priority_support: 'true',
            white_label: 'false'
        },
        prices: [
            { amount: 19900, interval: 'month', nickname: 'Growth Monthly', lookup_key: 'growth_monthly' },
            { amount: 190800, interval: 'year', nickname: 'Growth Annual (Save 20%)', lookup_key: 'growth_annual' } // $159/mo
        ]
    },
    {
        name: 'Royalty Scale',
        description: 'Royal Proves Your ROI. Unlimited members, 50,000 emails/mo, 2,000 SMS/mo, Visit Attribution, white-label.',
        metadata: {
            tier: 'scale',
            members: 'unlimited',
            emails_monthly: '50000',
            sms_monthly: '2000',
            max_automations: 'unlimited',
            royal_chat: 'true',
            review_mode: 'true',
            autonomous_mode: 'true',
            business_learning: 'true',
            fatigue_protection: 'true',
            visit_attribution: 'true',
            white_label: 'true',
            priority_support: 'true',
            dedicated_support: 'true'
        },
        prices: [
            { amount: 49900, interval: 'month', nickname: 'Scale Monthly', lookup_key: 'scale_monthly' },
            { amount: 478800, interval: 'year', nickname: 'Scale Annual (Save 20%)', lookup_key: 'scale_annual' } // $399/mo
        ]
    },
    {
        name: 'Royalty Pro Add-on',
        description: 'Let Royal Run Your Marketing. For AppSumo LTD users: unlocks Royal AI, +10,000 emails, 500 SMS, white-label.',
        metadata: {
            tier: 'royalty_pro',
            is_addon: 'true',
            emails_monthly_bonus: '10000',
            sms_monthly: '500',
            royal_chat: 'true',
            autonomous_mode: 'true',
            business_learning: 'true',
            visit_attribution: 'true',
            white_label: 'true'
        },
        prices: [
            { amount: 4900, interval: 'month', nickname: 'Royalty Pro Monthly', lookup_key: 'royalty_pro_monthly' }
        ]
    }
];

async function createProducts() {
    const results = {
        products: [],
        prices: []
    };

    for (const productData of products) {
        try {
            // Create product
            console.log(`Creating product: ${productData.name}...`);
            const product = await stripe.products.create({
                name: productData.name,
                description: productData.description,
                metadata: productData.metadata
            });
            console.log(`  ✅ Product created: ${product.id}`);
            results.products.push({ name: product.name, id: product.id, tier: productData.metadata.tier });

            // Create prices for this product
            for (const priceData of productData.prices) {
                const price = await stripe.prices.create({
                    product: product.id,
                    unit_amount: priceData.amount,
                    currency: 'usd',
                    recurring: { interval: priceData.interval },
                    nickname: priceData.nickname,
                    lookup_key: priceData.lookup_key,
                    metadata: {
                        plan: productData.metadata.tier,
                        billing: priceData.interval === 'month' ? 'monthly' : 'annual'
                    }
                });
                console.log(`  ✅ Price created: ${price.id} ($${priceData.amount / 100}/${priceData.interval})`);
                results.prices.push({
                    tier: productData.metadata.tier,
                    interval: priceData.interval,
                    amount: priceData.amount / 100,
                    id: price.id,
                    lookup_key: priceData.lookup_key
                });
            }
            console.log('');
        } catch (error) {
            console.error(`  ❌ Error creating ${productData.name}: ${error.message}`);
        }
    }

    return results;
}

async function main() {
    console.log('🚀 Creating Stripe products and prices for Royalty...\n');

    if (isLive) {
        console.log('⚠️  WARNING: You are about to create products in LIVE mode!');
        console.log('   Press Ctrl+C within 5 seconds to cancel...\n');
        await new Promise(r => setTimeout(r, 5000));
    }

    const results = await createProducts();

    console.log('\n========================================');
    console.log('📦 PRODUCTS CREATED:');
    console.log('========================================');
    results.products.forEach(p => {
        console.log(`${p.name}: ${p.id}`);
    });

    console.log('\n========================================');
    console.log('💰 PRICE IDS - Update your Edge Functions:');
    console.log('========================================\n');

    console.log('// supabase/functions/create-checkout-session/index.ts');
    console.log('const PRICES: Record<string, string> = {');
    results.prices.forEach(p => {
        const key = `${p.tier}_${p.interval === 'month' ? 'monthly' : 'annual'}`;
        console.log(`  ${key}: '${p.id}',`);
    });
    console.log('}\n');

    console.log('// supabase/functions/stripe-webhook/index.ts');
    console.log('const PRICE_TO_TIER: Record<string, { tier: string; billing: string; isAddOn?: boolean }> = {');
    results.prices.forEach(p => {
        const billing = p.interval === 'month' ? 'monthly' : 'annual';
        const isAddOn = p.tier === 'royalty_pro' ? ', isAddOn: true' : '';
        console.log(`  '${p.id}': { tier: '${p.tier}', billing: '${billing}'${isAddOn} },`);
    });
    console.log('}\n');

    console.log('✅ Done! Copy the price IDs above into your Edge Functions.');
    console.log('\n📝 Summary (Feb 2026 pricing):');
    console.log('   - Starter: $79/mo or $63/mo annual');
    console.log('   - Growth: $199/mo or $159/mo annual');
    console.log('   - Scale: $499/mo or $399/mo annual');
    console.log('   - Royalty Pro: $49/mo (add-on for LTD users)\n');
}

main().catch(console.error);
