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

// Royalty subscription products
const products = [
    {
        name: 'Royalty Starter',
        description: 'For small businesses. Up to 500 members, 30 AI insights/month, AI-built loyalty program.',
        metadata: {
            tier: 'starter',
            members: '500',
            intelligence_monthly: '30',
            automations: 'true',
            ai_setup: 'true',
            white_label: 'false'
        },
        prices: [
            { amount: 4900, interval: 'month', nickname: 'Starter Monthly', lookup_key: 'starter_monthly' },
            { amount: 46800, interval: 'year', nickname: 'Starter Annual (Save 20%)', lookup_key: 'starter_annual' } // $39/mo
        ]
    },
    {
        name: 'Royalty Growth',
        description: 'For growing businesses. Up to 2,000 members, 100 AI insights/month, priority support.',
        metadata: {
            tier: 'growth',
            members: '2000',
            intelligence_monthly: '100',
            automations: 'true',
            ai_setup: 'true',
            white_label: 'false',
            priority_support: 'true'
        },
        prices: [
            { amount: 14900, interval: 'month', nickname: 'Growth Monthly', lookup_key: 'growth_monthly' },
            { amount: 142800, interval: 'year', nickname: 'Growth Annual (Save 20%)', lookup_key: 'growth_annual' } // $119/mo
        ]
    },
    {
        name: 'Royalty Scale',
        description: 'For multi-location businesses. Unlimited members, unlimited AI insights, white-label branding.',
        metadata: {
            tier: 'scale',
            members: 'unlimited',
            intelligence_monthly: 'unlimited',
            automations: 'true',
            ai_setup: 'true',
            white_label: 'true',
            priority_support: 'true'
        },
        prices: [
            { amount: 39900, interval: 'month', nickname: 'Scale Monthly', lookup_key: 'scale_monthly' },
            { amount: 382800, interval: 'year', nickname: 'Scale Annual (Save 20%)', lookup_key: 'scale_annual' } // $319/mo
        ]
    },
    {
        name: 'Royalty Pro Add-on',
        description: 'Unlock unlimited AI Intelligence and white-label branding for lifetime deal holders.',
        metadata: {
            tier: 'royalty_pro',
            is_addon: 'true',
            intelligence_monthly: 'unlimited',
            white_label: 'true'
        },
        prices: [
            { amount: 3900, interval: 'month', nickname: 'Royalty Pro Monthly', lookup_key: 'royalty_pro_monthly' }
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
    console.log('\n📝 Summary:');
    console.log('   - Starter: $49/mo or $39/mo annual');
    console.log('   - Growth: $149/mo or $119/mo annual');
    console.log('   - Scale: $399/mo or $319/mo annual');
    console.log('   - Royalty Pro: $39/mo (add-on for LTD users)\n');
}

main().catch(console.error);
