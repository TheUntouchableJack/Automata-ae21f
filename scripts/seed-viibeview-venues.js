/**
 * Seed starter venues for the ViibeView app.
 *
 * Companion to seed-viibeview.js, which creates the customer_apps row. This
 * fills the venues table so the customer app stops falling back to the sample
 * venues hardcoded in social.js (which now announces itself with a blue
 * "Showing sample venues" notice rather than passing as real data).
 *
 * Usage: log in as jay@24hour.design on localhost:5173, then paste this whole
 * file into the browser console (e.g. on /app/venues.html?app_id=...).
 *
 * RLS authorizes the write because you own the org. Idempotent: keyed on
 * (app_id, slug), so re-running updates instead of duplicating.
 *
 * IMPORTANT — every venue MUST have latitude and longitude. get_venues_for_map()
 * filters them out otherwise, and the customer app's search reads the same
 * array, so an un-geocoded venue is invisible in BOTH map and search with no
 * error anywhere. The admin venue list now flags these with a "No coordinates"
 * badge; use its "Find Coordinates" button to fill them in.
 *
 * Categories MUST come from /js/venue-categories.js:
 *   nightlife | bar | club | restaurant | lounge | rooftop | event_space
 * Migration 20260821000001 adds a CHECK constraint enforcing exactly this.
 *
 * Preflight (read-only) — paste this first:
 *
 *   (async () => {
 *     const s = window.supabase || window.db;
 *     const { data: app } = await s.from('customer_apps')
 *       .select('id, name, organization_id').eq('slug', 'viibeview').maybeSingle();
 *     console.log('App:', app);
 *     const { count } = await s.from('venues')
 *       .select('id', { count: 'exact', head: true }).eq('app_id', app.id);
 *     console.log('Existing venues:', count);
 *   })();
 */
(async function seedViibeViewVenues() {
    const supabase = window.supabase || window.db;
    if (!supabase) { console.error('Supabase client not found'); return; }

    // 1. Resolve the ViibeView app
    const { data: app, error: appErr } = await supabase
        .from('customer_apps')
        .select('id, organization_id, name')
        .eq('slug', 'viibeview')
        .maybeSingle();

    if (appErr || !app) {
        console.error('ViibeView app not found — run seed-viibeview.js first', appErr);
        return;
    }
    console.log('App:', app.name, app.id);

    // 2. Starter venues. Replace these with the client's real venues — they are
    //    placeholders with genuine LA coordinates so the map is meaningful.
    const VENUES = [
        {
            name: 'Skyline Rooftop', slug: 'skyline-rooftop', handle: 'skylinela',
            category: 'rooftop', latitude: 34.0195, longitude: -118.4912,
            address_line1: '1550 Ocean Ave', city: 'Santa Monica', state: 'CA', postal_code: '90401',
            description: 'Elevated cocktails with panoramic ocean views. Live DJ sets Friday and Saturday.',
            tags: ['rooftop', 'cocktails', 'ocean view', 'live dj'],
            is_featured: true,
            hours: {
                monday: { open: '16:00', close: '00:00' }, tuesday: { open: '16:00', close: '00:00' },
                wednesday: { open: '16:00', close: '00:00' }, thursday: { open: '16:00', close: '01:00' },
                friday: { open: '15:00', close: '02:00' }, saturday: { open: '12:00', close: '02:00' },
                sunday: { open: '12:00', close: '22:00' }
            }
        },
        {
            name: 'Velvet Underground', slug: 'velvet-underground', handle: 'velvetdtla',
            category: 'club', latitude: 34.0407, longitude: -118.2468,
            address_line1: '420 S Main St', city: 'Los Angeles', state: 'CA', postal_code: '90013',
            description: 'Downtown LA underground club. House and techno nights.',
            tags: ['club', 'techno', 'house music', 'downtown'],
            hours: {
                monday: null, tuesday: null,
                wednesday: { open: '21:00', close: '02:00' }, thursday: { open: '21:00', close: '02:00' },
                friday: { open: '22:00', close: '04:00' }, saturday: { open: '22:00', close: '04:00' },
                sunday: null
            }
        },
        {
            name: 'The Golden Bear', slug: 'the-golden-bear', handle: 'goldenbear',
            category: 'bar', latitude: 34.0259, longitude: -118.4961,
            address_line1: '306 Santa Monica Blvd', city: 'Santa Monica', state: 'CA', postal_code: '90401',
            description: 'Craft cocktails and local brews in a cosy neighbourhood setting.',
            tags: ['craft cocktails', 'beer', 'casual'],
            hours: {
                monday: { open: '17:00', close: '00:00' }, tuesday: { open: '17:00', close: '00:00' },
                wednesday: { open: '17:00', close: '00:00' }, thursday: { open: '17:00', close: '01:00' },
                friday: { open: '16:00', close: '02:00' }, saturday: { open: '14:00', close: '02:00' },
                sunday: { open: '14:00', close: '22:00' }
            }
        },
        {
            name: 'Dusk Lounge', slug: 'dusk-lounge', handle: 'dusklounge',
            category: 'lounge', latitude: 34.0093, longitude: -118.4974,
            address_line1: '2000 Main St', city: 'Santa Monica', state: 'CA', postal_code: '90405',
            description: 'Ambient lounge with craft cocktails, hookah, and weekend live music.',
            tags: ['lounge', 'hookah', 'live music', 'cocktails'],
            hours: {
                monday: null, tuesday: { open: '18:00', close: '00:00' },
                wednesday: { open: '18:00', close: '00:00' }, thursday: { open: '18:00', close: '01:00' },
                friday: { open: '17:00', close: '02:00' }, saturday: { open: '17:00', close: '02:00' },
                sunday: { open: '16:00', close: '23:00' }
            }
        },
        {
            name: 'Sunset Social', slug: 'sunset-social', handle: 'sunsetsocial',
            category: 'nightlife', latitude: 34.0983, longitude: -118.3267,
            address_line1: '6801 Hollywood Blvd', city: 'Los Angeles', state: 'CA', postal_code: '90028',
            description: 'Late-night bar and dance floor on the Sunset corridor.',
            tags: ['nightlife', 'dancing', 'hollywood'],
            is_featured: true,
            hours: {
                monday: null, tuesday: null,
                wednesday: { open: '20:00', close: '02:00' }, thursday: { open: '20:00', close: '02:00' },
                friday: { open: '20:00', close: '03:00' }, saturday: { open: '20:00', close: '03:00' },
                sunday: { open: '18:00', close: '00:00' }
            }
        }
    ];

    const VALID_CATEGORIES = ['nightlife', 'bar', 'club', 'restaurant', 'lounge', 'rooftop', 'event_space'];

    let inserted = 0, updated = 0, skipped = 0;

    for (const v of VENUES) {
        // Guard the two failure modes that are silent at runtime
        if (!VALID_CATEGORIES.includes(v.category)) {
            console.error(`SKIP ${v.name}: invalid category "${v.category}"`);
            skipped++;
            continue;
        }
        if (v.latitude == null || v.longitude == null) {
            console.error(`SKIP ${v.name}: missing coordinates — would be invisible in map and search`);
            skipped++;
            continue;
        }

        const row = {
            ...v,
            organization_id: app.organization_id,
            app_id: app.id,
            country: 'US',
            is_active: true
        };

        const { data: existing } = await supabase
            .from('venues')
            .select('id')
            .eq('app_id', app.id)
            .eq('slug', v.slug)
            .maybeSingle();

        if (existing) {
            const { error } = await supabase.from('venues').update(row).eq('id', existing.id);
            if (error) { console.error(`FAIL ${v.name}:`, error.message); skipped++; }
            else { console.log(`updated  ${v.name}`); updated++; }
        } else {
            const { error } = await supabase.from('venues').insert(row);
            if (error) { console.error(`FAIL ${v.name}:`, error.message); skipped++; }
            else { console.log(`inserted ${v.name}`); inserted++; }
        }
    }

    console.log(`\nDone — ${inserted} inserted, ${updated} updated, ${skipped} skipped.`);
    console.log('Reload /a/viibeview/social — the blue "Showing sample venues" notice should be gone.');
})();
