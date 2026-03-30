// Supabase Edge Function: smb-lifecycle-email
// Sends branded lifecycle emails to SMB owners (welcome, onboarding, milestones, win-back).
// Called from:
//   - handle_new_user() trigger via pg_net (welcome email on signup)
//   - royalty-self-growth nightly loop (onboarding drip, milestones, win-back)
//
// Service-role only — no browser calls.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FROM_EMAIL = 'Royal <royal@royaltyapp.ai>'

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

interface TemplateData {
  firstName?: string
  orgName?: string
  [key: string]: unknown
}

function getEmailTemplate(type: string, data: TemplateData): { subject: string; html: string; preheader: string } {
  const name = data.firstName || 'there'

  switch (type) {
    case 'welcome':
      return {
        subject: `Welcome to Royalty, ${name}!`,
        preheader: 'Your AI-powered loyalty program is ready to launch',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Welcome to Royalty, ${name}!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            You just joined the only loyalty platform where AI runs the program for you.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Here's what happens next: describe your business, and Royal (your AI assistant) will build your loyalty program in 60 seconds. Your customers earn points, unlock rewards, and keep coming back.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/dashboard.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);
                      letter-spacing:0.2px;">
              Go to Your Dashboard
            </a>
          </div>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            Questions? Just chat with Royal in your dashboard — it knows your business.
          </p>
        `
      }

    default:
      return {
        subject: 'A message from Royalty',
        preheader: '',
        html: `<p>Hello ${name},</p><p>You have a new message from Royalty.</p>`
      }
  }
}

// ============================================================================
// SEND EMAIL
// ============================================================================

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    console.log('[stub] Would send lifecycle email to', to, '—', subject)
    return { success: true, messageId: 'stub-' + Date.now() }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })

    const data = await response.json()
    if (!response.ok) {
      return { success: false, error: `Resend ${response.status}: ${data.message || JSON.stringify(data)}` }
    }
    return { success: true, messageId: data.id }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const { type, email, first_name, org_name, user_id } = body as {
      type: string
      email: string
      first_name?: string
      org_name?: string
      user_id?: string
    }

    if (!type || !email) {
      return new Response(JSON.stringify({ error: 'type and email are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check unsubscribe preferences
    if (user_id) {
      const { data: prefs } = await supabase
        .from('smb_email_preferences')
        .select('unsubscribed_all, unsubscribed_categories')
        .eq('user_id', user_id)
        .single()

      if (prefs?.unsubscribed_all) {
        console.log(`Skipping ${type} email for ${email} — unsubscribed`)
        return new Response(JSON.stringify({ success: true, skipped: true, reason: 'unsubscribed' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Check category-level unsubscribe
      const category = type === 'welcome' ? 'onboarding' : type
      if (prefs?.unsubscribed_categories?.includes(category)) {
        console.log(`Skipping ${type} email for ${email} — unsubscribed from ${category}`)
        return new Response(JSON.stringify({ success: true, skipped: true, reason: `unsubscribed:${category}` }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Generate template
    const template = getEmailTemplate(type, { firstName: first_name, orgName: org_name })

    // Build unsubscribe URL
    const unsubscribeUrl = user_id
      ? `https://royaltyapp.ai/app/settings.html?unsubscribe=${user_id}`
      : undefined

    // Wrap in branded template
    const html = wrapEmail(template.html, {
      preheader: template.preheader,
      unsubscribeUrl,
    })

    // Send
    const result = await sendEmail(email, template.subject, html)

    // Log to self_growth_log
    await supabase.from('self_growth_log').insert({
      action_type: 'lifecycle_email_sent',
      description: `Sent ${type} email to ${email}`,
      status: result.success ? 'completed' : 'failed',
      metadata: {
        type,
        email,
        user_id,
        resend_id: result.messageId,
        error: result.error,
      }
    })

    if (!result.success) {
      console.error(`Failed to send ${type} email to ${email}:`, result.error)
    }

    return new Response(JSON.stringify({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('smb-lifecycle-email error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
