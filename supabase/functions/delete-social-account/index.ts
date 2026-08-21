// Supabase Edge Function: Delete Social Account
//
// Completes account deletion for a social app-type member (ViibeView).
//
// The client already called delete_social_member_data(), which soft-deletes the
// app_members and customers rows. That is only half the job: removing a user's
// data while leaving a working login is not deletion. Only the service role can
// delete an auth.users row, so it happens here.
//
// Authorization: the caller's own JWT identifies who is being deleted. The
// request body cannot name a different user — a caller may only ever delete
// themselves, and org owners are refused outright so a business account can
// never be destroyed through the customer app.
//
// Deploy: supabase functions deploy delete-social-account

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return json({ success: false, error: 'Not authenticated' }, 401)
    }

    // Identify the caller from their own token — never from the request body.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Not authenticated' }, 401)
    }

    const userId = userData.user.id
    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // Refuse to delete a Royalty business owner through this path. Owning an
    // organization means this is a business account with team members, apps and
    // billing attached; deleting it needs the owner-side flow, not a tap in a
    // customer app.
    const { data: orgMemberships, error: orgErr } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)

    if (orgErr) {
      console.error('Org membership check failed:', orgErr.message)
      return json({ success: false, error: 'Could not verify account' }, 500)
    }

    if (orgMemberships && orgMemberships.length > 0) {
      return json({
        success: false,
        error: 'This login is attached to a business account. Delete it from your Royalty account settings.',
      }, 403)
    }

    // Belt and braces: the RPC should already have cleared these, but never
    // orphan member rows pointing at a user that is about to disappear.
    const { error: memberErr } = await admin
      .from('app_members')
      .update({
        user_id: null,
        deleted_at: new Date().toISOString(),
        email: null,
        phone: null,
        first_name: null,
        last_name: null,
        display_name: null,
        avatar_url: null,
        pin_hash: null,
        auth_token: null,
      })
      .eq('user_id', userId)
      .is('deleted_at', null)

    if (memberErr) {
      console.error('Failed to clear app_members:', memberErr.message)
      return json({ success: false, error: 'Could not remove your member data' }, 500)
    }

    // Finally remove the login itself.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
    if (deleteErr) {
      console.error('Failed to delete auth user:', deleteErr.message)
      return json({ success: false, error: 'Could not delete your login' }, 500)
    }

    return json({ success: true })
  } catch (e) {
    console.error('delete-social-account error:', e)
    return json({ success: false, error: 'Unexpected error' }, 500)
  }
})
