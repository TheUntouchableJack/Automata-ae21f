// Supabase Edge Function: Purge Venue ("Delete forever")
//
// Removes a venue for good: its row (and with it every post, follow and owner
// row, by ON DELETE CASCADE), then its files in storage. Jay's board,
// 2026-10-27: "Venue Administration: Delete Venue".
//
// Only for a venue that is ALREADY in "Recently deleted" (deleted_at set):
// the dashboard's ordinary Delete stays the soft, restorable one, and this is
// the second, explicit step.
//
// Order of operations — each step depends on the one before:
//
//   1. Identify the caller from their own JWT.
//   2. Read the venue (service role). It must exist and be soft-deleted.
//   3. The caller must be an org member of the venue's app (the same rule as
//      the Reports queue and suspend_app_member).
//   4. Collect the files: every post's clip and poster, and the venue's own
//      cover and logo, BEFORE the rows are gone.
//   5. Write the audit_logs row, then delete the venue row. Nothing it cascades
//      to blocks it: venue_media, social_follows and venue_owners CASCADE from
//      venues; social_hidden_posts CASCADE from venue_media; content_reports
//      keep their row with media_id SET NULL.
//   6. Remove the files, in chunks, keeping any another row still uses, and only
//      under this org's {orgId}/ prefix or a poster's own members/{uid}/.
//      The ROW goes first: a failed cleanup leaves files nobody can see; the
//      other order would leave live posts with missing media. A cleanup
//      failure is logged, and the call still succeeds (the venue IS gone).
//      Paths are never returned to the client.
//
// Deploy: supabase functions deploy purge-venue   (default verify_jwt)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const BUCKET = 'venue-media'
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Storage's remove() takes a list; a venue with hundreds of posts is split.
const REMOVE_CHUNK = 100

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** The object path inside the bucket, from a public URL — or null. */
function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null
  const i = url.indexOf(PUBLIC_MARKER)
  if (i < 0) return null
  const path = url.slice(i + PUBLIC_MARKER.length).split('?')[0]
  return path || null
}

/** A path we will even consider removing: relative, no traversal. */
function isCleanPath(path: string | null): path is string {
  return !!path && !path.startsWith('/') && !path.includes('..')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    // ── 1. The caller ──
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return json({ success: false, error: 'Not authenticated' }, 401)
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user) {
      return json({ success: false, error: 'Not authenticated' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const venueId = typeof body?.venue_id === 'string' ? body.venue_id : ''
    if (!UUID_RE.test(venueId)) {
      return json({ success: false, error: 'Missing venue id' }, 400)
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // ── 2. The venue ──
    const { data: venue, error: venueErr } = await admin
      .from('venues')
      .select('id, app_id, name, handle, city, state, deleted_at, cover_image_url, profile_image_url')
      .eq('id', venueId)
      .maybeSingle()
    if (venueErr) {
      console.error('purge-venue: venue read failed:', venueErr.message)
      return json({ success: false, error: 'Could not delete this venue' }, 500)
    }
    if (!venue) {
      // Already gone: a double tap.
      return json({ success: true, already: true })
    }

    // ── 3. Only this app's team ──
    const { data: app } = await admin
      .from('customer_apps')
      .select('organization_id')
      .eq('id', venue.app_id)
      .maybeSingle()
    const orgId: string | null = app?.organization_id ?? null
    const { data: membership } = orgId
      ? await admin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle()
      : { data: null }
    if (!orgId || !membership) {
      return json({ success: false, error: 'Only the app team can delete a venue' }, 403)
    }

    if (!venue.deleted_at) {
      return json({ success: false, error: 'Delete the venue first; it can be deleted forever from Recently deleted' }, 409)
    }

    // ── 4. The files, read before the rows go ──
    const { data: media, error: mediaErr } = await admin
      .from('venue_media')
      .select('id, storage_path, thumbnail_url, uploaded_by_user_id')
      .eq('venue_id', venueId)
    if (mediaErr) {
      console.error('purge-venue: media read failed:', mediaErr.message)
      return json({ success: false, error: 'Could not delete this venue' }, 500)
    }
    const rows = media || []

    const owned = (path: string, uploader: string | null) =>
      path.startsWith(`${orgId}/`) || (!!uploader && path.startsWith(`members/${uploader}/`))

    const candidates: string[] = []
    for (const row of rows) {
      for (const p of [row.storage_path as string | null, pathFromPublicUrl(row.thumbnail_url as string | null)]) {
        if (isCleanPath(p) && owned(p, row.uploaded_by_user_id as string | null)) candidates.push(p)
      }
    }
    for (const url of [venue.cover_image_url, venue.profile_image_url]) {
      const p = pathFromPublicUrl(url as string | null)
      if (isCleanPath(p) && owned(p, null)) candidates.push(p)
    }
    const unique = [...new Set(candidates)]

    // ── 5. The audit row, then the venue ──
    const { data: profile } = await admin
      .from('profiles')
      .select('first_name, last_name, email')
      .eq('id', user.id)
      .maybeSingle()
    const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null
    const { error: auditErr } = await admin.from('audit_logs').insert({
      organization_id: orgId,
      user_id: user.id,
      user_email: profile?.email || user.email || '',
      user_name: userName,
      entity_type: 'venue',
      entity_id: venueId,
      entity_name: venue.name,
      action: 'delete_forever',
      previous_data: { name: venue.name, handle: venue.handle, city: venue.city, state: venue.state, deleted_at: venue.deleted_at },
      new_data: { app_id: venue.app_id, posts_removed: rows.length, files_to_remove: unique.length },
    })
    if (auditErr) {
      // Not deleting what nobody can later account for.
      console.error('purge-venue: audit write failed:', auditErr.message)
      return json({ success: false, error: 'Could not delete this venue' }, 500)
    }

    const { error: deleteErr } = await admin.from('venues').delete().eq('id', venueId)
    if (deleteErr) {
      console.error('purge-venue: venue delete failed:', deleteErr.message)
      return json({ success: false, error: 'Could not delete this venue' }, 500)
    }

    // ── 6. The files ──
    let removed = 0
    try {
      if (unique.length > 0) {
        // Kept if another row (another venue's post or picture) still uses it.
        const publicUrls = unique.map(p => `${supabaseUrl}${PUBLIC_MARKER}${p}`)
        const [byPath, byThumb, byCover, byLogo] = await Promise.all([
          admin.from('venue_media').select('storage_path').in('storage_path', unique),
          admin.from('venue_media').select('thumbnail_url').in('thumbnail_url', publicUrls),
          admin.from('venues').select('cover_image_url').in('cover_image_url', publicUrls),
          admin.from('venues').select('profile_image_url').in('profile_image_url', publicUrls),
        ])
        const failed = [byPath, byThumb, byCover, byLogo].find(r => r.error)
        if (failed) throw new Error(failed.error!.message)
        const stillUsed = new Set<string>([
          ...(byPath.data || []).map(r => r.storage_path as string),
          ...(byThumb.data || []).map(r => pathFromPublicUrl(r.thumbnail_url as string) || ''),
          ...(byCover.data || []).map(r => pathFromPublicUrl(r.cover_image_url as string) || ''),
          ...(byLogo.data || []).map(r => pathFromPublicUrl(r.profile_image_url as string) || ''),
        ])
        const paths = unique.filter(p => !stillUsed.has(p))
        for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
          const chunk = paths.slice(i, i + REMOVE_CHUNK)
          const { error: removeErr } = await admin.storage.from(BUCKET).remove(chunk)
          if (removeErr) throw new Error(removeErr.message)
          removed += chunk.length
        }
      }
    } catch (cleanupErr) {
      console.error('purge-venue: storage cleanup failed for', venueId, cleanupErr)
    }

    return json({ success: true, posts_removed: rows.length, files_removed: removed })
  } catch (e) {
    console.error('purge-venue error:', e)
    return json({ success: false, error: 'Unexpected error' }, 500)
  }
})
