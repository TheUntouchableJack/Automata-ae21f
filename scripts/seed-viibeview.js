/**
 * Seed the ViibeView app (social app-type) into Jay's organization.
 *
 * Usage: Log in as jay@24hour.design on localhost:5173, then paste this
 * entire script into the browser console (e.g. on /app/apps.html).
 *
 * It auto-detects your organization_id from organization_members, RLS
 * authorizes the write (you own your org), and it is idempotent: re-running
 * updates the existing 'viibeview' app instead of creating a duplicate.
 *
 * Preflight (read-only) — paste this first to confirm before writing:
 *
 *   (async () => {
 *     const s = window.supabase || window.db;
 *     const { data: m } = await s.from('organization_members')
 *       .select('organization_id').limit(1).single();
 *     console.log('Org ID:', m?.organization_id);
 *     const { data: existing } = await s.from('customer_apps')
 *       .select('id, name, slug').eq('organization_id', m.organization_id)
 *       .eq('slug', 'viibeview').maybeSingle();
 *     console.log('Existing viibeview app:', existing || '(none — will insert)');
 *   })();
 */
(async function seedViibeView() {
    const supabase = window.supabase || window.db;
    if (!supabase) { console.error('Supabase client not found'); return; }

    // 1. Resolve Jay's org
    const { data: membership, error: memErr } = await supabase
        .from('organization_members')
        .select('organization_id')
        .limit(1)
        .single();

    if (memErr || !membership) {
        console.error('No organization found (are you logged in as jay@24hour.design?)', memErr);
        return;
    }
    const orgId = membership.organization_id;
    console.log('Organization ID:', orgId);

    // 2. The ViibeView app row (social app-type)
    const row = {
        organization_id: orgId,
        name: 'ViibeView',
        slug: 'viibeview',
        description: 'ViibeView — venue discovery & short-form video (social app-type)',
        app_type: 'social',
        features: {                     // matches APP_TYPE_FEATURES.social; ugc on (ViibeView is UGC-first)
            map_enabled: true, feed_enabled: true, search_enabled: true,
            categories_enabled: true, ugc_enabled: true
        },
        settings: {                     // only keys the social type reads today; video_max_duration→15 for ViibeView
            default_view: 'feed', map_zoom_default: 13, video_max_duration: 15,
            moderation_required: true, require_email: true, require_phone: false
        },
        branding: {                     // ViibeView brand color from the proposal (#3b82f6)
            primary_color: '#3b82f6', secondary_color: '#1e293b',
            logo_url: null, logo_fit: 'contain', business_info: {}
        },
        is_active: true,
        is_published: true
    };

    // 3. Idempotency: update if it already exists, else insert
    const { data: existing } = await supabase
        .from('customer_apps')
        .select('id')
        .eq('organization_id', orgId)
        .eq('slug', 'viibeview')
        .maybeSingle();

    let result, error;
    if (existing) {
        console.log('Existing ViibeView app found, updating:', existing.id);
        ({ data: result, error } = await supabase
            .from('customer_apps')
            .update(row)
            .eq('id', existing.id)
            .select('id, name, slug, app_type, is_published')
            .single());
    } else {
        console.log('No existing ViibeView app, inserting…');
        ({ data: result, error } = await supabase
            .from('customer_apps')
            .insert(row)
            .select('id, name, slug, app_type, is_published')
            .single());
    }

    if (error) {
        console.error('Write failed:', error);
        return;
    }

    console.log('%cViibeView app ready:', 'font-weight:bold', result);
    console.log('  id:       ', result.id);
    console.log('  slug:     ', result.slug);
    console.log('  app URL:   /a/viibeview/social');
    console.log('\nReload /app/apps.html to see it in your apps list.');
})();
