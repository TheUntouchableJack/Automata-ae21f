// Supabase Edge Function: Delete Social Post
//
// Deletes a ViibeView post: the venue_media row, then its files.
//
// Why this exists: delete_social_post used to remove the clip and the poster
// frame with a direct DELETE on the storage tables. Supabase now refuses that
// (42501) and the refusal rolled the whole call back, so no post could be
// deleted at all. 20261006000002 made the RPC delete the row only; the files
// are removed here, through the Storage API, with the service role.
//
// Order of operations — each step depends on the one before:
//
//   1. Identify the caller from their own JWT.
//   2. Read what the files are (service role), BEFORE the row is gone.
//   3. Call delete_social_post AS THE CALLER. Authorization lives in SQL — the
//      author, an org member, or an owner of the post's venue. This function
//      never decides who may delete; if the RPC refuses, nothing is removed.
//   4. Remove only files that belong to the post: under the uploader's own
//      members/{uid}/ prefix, the org's {orgId}/ prefix, or (flyers, which have
//      no author) members/. A file another row still references is kept.
//   5. A cleanup failure is logged and the call still succeeds — the post IS
//      deleted. Paths are never returned to the client.
//
// Deploy: supabase functions deploy delete-social-post

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const BUCKET = 'venue-media'
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Not authenticated' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const mediaId = typeof body?.media_id === 'string' ? body.media_id : ''
    if (!UUID_RE.test(mediaId)) {
      return json({ success: false, error: 'Missing post id' }, 400)
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // ── 2. What the files are, read before the row is deleted ──
    const { data: row, error: rowErr } = await admin
      .from('venue_media')
      .select('storage_path, thumbnail_url, uploaded_by_user_id, is_flyer, app_id')
      .eq('id', mediaId)
      .maybeSingle()

    if (rowErr) {
      console.error('delete-social-post: row read failed:', rowErr.message)
      return json({ success: false, error: 'Could not delete this post' }, 500)
    }
    if (!row) {
      // Already gone — a double tap. Same answer the RPC gives.
      return json({ success: true })
    }

    // ── 3. Authorize and delete the row, AS THE CALLER ──
    const { data: result, error: rpcErr } = await userClient.rpc('delete_social_post', {
      p_media_id: mediaId,
    })
    const outcome = Array.isArray(result) ? result[0] : result
    if (rpcErr || !outcome?.success) {
      return json({
        success: false,
        error: outcome?.error_message || rpcErr?.message || 'You can only delete your own posts',
      }, 403)
    }

    // ── 4. Remove the files that belong to this post ──
    try {
      const { data: app } = await admin
        .from('customer_apps')
        .select('organization_id')
        .eq('id', row.app_id)
        .maybeSingle()
      const orgId: string | null = app?.organization_id ?? null

      const belongsToPost = (path: string) =>
        (row.uploaded_by_user_id && path.startsWith(`members/${row.uploaded_by_user_id}/`))
        || (orgId && path.startsWith(`${orgId}/`))
        || (row.is_flyer && path.startsWith('members/'))

      const candidates = [row.storage_path, pathFromPublicUrl(row.thumbnail_url)]
        .filter(isCleanPath)
        .filter(belongsToPost)

      const unique = [...new Set(candidates)]
      if (unique.length > 0) {
        // Kept if any other row still points at it, as its clip or its poster.
        const publicUrls = unique.map(p => `${supabaseUrl}${PUBLIC_MARKER}${p}`)
        const [byPath, byThumb] = await Promise.all([
          admin.from('venue_media').select('storage_path').in('storage_path', unique),
          admin.from('venue_media').select('thumbnail_url').in('thumbnail_url', publicUrls),
        ])
        if (byPath.error || byThumb.error) {
          throw new Error((byPath.error || byThumb.error)!.message)
        }
        const stillUsed = new Set<string>([
          ...(byPath.data || []).map(r => r.storage_path as string),
          ...(byThumb.data || []).map(r => pathFromPublicUrl(r.thumbnail_url as string) || ''),
        ])
        const paths = unique.filter(p => !stillUsed.has(p))

        if (paths.length > 0) {
          const { error: removeErr } = await admin.storage.from(BUCKET).remove(paths)
          if (removeErr) throw new Error(removeErr.message)
        }
      }
    } catch (cleanupErr) {
      // ── 5. The post is deleted; a leftover file is not the caller's problem.
      console.error('delete-social-post: storage cleanup failed for', mediaId, cleanupErr)
    }

    return json({ success: true })
  } catch (e) {
    console.error('delete-social-post error:', e)
    return json({ success: false, error: 'Unexpected error' }, 500)
  }
})
