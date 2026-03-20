/**
 * Seed 10 dummy campaign items into app_message_batches.
 *
 * Usage: Paste this entire script into the browser console while
 * authenticated on localhost:5173/app/outgoing.html
 *
 * It will auto-detect your organization_id and app_id from existing data.
 */
(async function seedCampaigns() {
    const supabase = window.supabase || window.db;
    if (!supabase) { console.error('Supabase client not found'); return; }

    // 1. Get current user's org
    const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .limit(1)
        .single();

    if (!membership) { console.error('No organization found'); return; }
    const orgId = membership.organization_id;
    console.log('Organization ID:', orgId);

    // 2. Get a customer app for this org
    const { data: apps } = await supabase
        .from('customer_apps')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1);

    if (!apps?.length) { console.error('No customer app found'); return; }
    const appId = apps[0].id;
    console.log('App ID:', appId);

    // 3. Get automation definitions for linking
    const { data: automations } = await supabase
        .from('automation_definitions')
        .select('id, name, category')
        .eq('organization_id', orgId)
        .limit(5);

    const autoIds = automations?.map(a => a.id) || [];
    console.log('Found', autoIds.length, 'automations to link');

    // 4. Build 10 campaign rows
    const now = new Date();
    const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
    const hoursFromNow = (h) => new Date(now.getTime() + h * 3600000).toISOString();

    const campaigns = [
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Welcome to our loyalty program!',
            body: 'Thank you for joining! Start earning points today with every visit.',
            segment: 'new', status: 'sent', created_by: 'automation',
            automation_id: autoIds[0] || null,
            total_recipients: 48, delivered: 46, opened: 31, clicked: 12, bounced: 2, unsubscribed: 0,
            sent_at: daysAgo(2), created_at: daysAgo(3)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'You\'re close to your next reward!',
            body: 'You only need 50 more points to unlock your next reward. Visit us today!',
            segment: 'active', status: 'sent', created_by: 'ai',
            automation_id: autoIds[1] || autoIds[0] || null,
            total_recipients: 124, delivered: 121, opened: 67, clicked: 23, bounced: 3, unsubscribed: 1,
            sent_at: daysAgo(5), created_at: daysAgo(5)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'sms', subject: null,
            body: 'We miss you! Come back this week and earn 2x points on your next visit.',
            segment: 'at_risk', status: 'sent', created_by: 'automation',
            automation_id: autoIds[2] || autoIds[0] || null,
            total_recipients: 35, delivered: 34, opened: 0, clicked: 0, bounced: 1, unsubscribed: 0,
            sent_at: daysAgo(7), created_at: daysAgo(7)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Happy Birthday! Here\'s a gift from us',
            body: 'Happy birthday! Enjoy 100 bonus points on us. Redeem them on your next visit!',
            segment: 'custom', status: 'sent', created_by: 'automation',
            automation_id: autoIds[1] || null,
            total_recipients: 8, delivered: 8, opened: 6, clicked: 4, bounced: 0, unsubscribed: 0,
            sent_at: daysAgo(1), created_at: daysAgo(1)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Weekend Flash: Double points Saturday!',
            body: 'This Saturday only — earn double points on every visit. Don\'t miss out!',
            segment: 'all', status: 'scheduled', created_by: 'ai',
            automation_id: autoIds[0] || null,
            total_recipients: 200, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0,
            scheduled_for: hoursFromNow(48), created_at: daysAgo(0)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'push', subject: 'New reward available!',
            body: 'A new reward just dropped in your loyalty program. Check it out!',
            segment: 'vip', status: 'sent', created_by: 'ai',
            automation_id: null,
            total_recipients: 15, delivered: 14, opened: 10, clicked: 7, bounced: 0, unsubscribed: 0,
            sent_at: daysAgo(3), created_at: daysAgo(3)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Your monthly loyalty summary',
            body: 'Here\'s your monthly recap: points earned, rewards redeemed, and your current tier status.',
            segment: 'all', status: 'draft', created_by: 'ai',
            automation_id: autoIds[3] || autoIds[0] || null,
            total_recipients: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0,
            created_at: daysAgo(0)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'sms', subject: null,
            body: 'Congrats! You\'ve reached Gold tier! Enjoy exclusive perks and bonus points.',
            segment: 'custom', status: 'sent', created_by: 'automation',
            automation_id: autoIds[4] || autoIds[0] || null,
            total_recipients: 12, delivered: 12, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0,
            sent_at: daysAgo(10), created_at: daysAgo(10)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Refer a friend, earn 200 points',
            body: 'Share your referral link with friends. When they join and visit, you both earn 200 points!',
            segment: 'active', status: 'failed', created_by: 'ai',
            automation_id: null,
            total_recipients: 75, delivered: 0, opened: 0, clicked: 0, bounced: 75, unsubscribed: 0,
            created_at: daysAgo(4)
        },
        {
            app_id: appId, organization_id: orgId,
            channel: 'email', subject: 'Spring special: Triple points this week!',
            body: 'Spring is here! Earn triple points on all visits this week. Limited time only.',
            segment: 'all', status: 'sending', created_by: 'ai',
            automation_id: autoIds[0] || null,
            total_recipients: 180, delivered: 92, opened: 0, clicked: 0, bounced: 3, unsubscribed: 0,
            created_at: daysAgo(0)
        }
    ];

    // 5. Insert all
    const { data, error } = await supabase
        .from('app_message_batches')
        .insert(campaigns)
        .select('id, subject, status');

    if (error) {
        console.error('Insert failed:', error);
    } else {
        console.log('Successfully inserted', data.length, 'campaigns:');
        data.forEach(c => console.log(`  ${c.status.padEnd(10)} ${c.subject || '(SMS)'}`));
        console.log('\nRefresh the page to see them!');
    }
})();
