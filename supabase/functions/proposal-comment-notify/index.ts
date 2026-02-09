// Supabase Edge Function: Proposal Comment Notification
// Sends email to jay@24hour.design when a new comment is submitted

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const NOTIFY_EMAIL = 'jay@24hour.design'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CommentPayload {
  proposal_id: string
  question: string
  created_at: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: CommentPayload = await req.json()

    // Validate required fields
    if (!payload.proposal_id || !payload.question) {
      return new Response(
        JSON.stringify({ error: 'Missing proposal_id or question' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format the proposal name for display
    const proposalName = payload.proposal_id
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    // Build the admin URL
    const adminUrl = `https://24hourdesigns.netlify.app/?client=${payload.proposal_id}&admin=24hd-jay-admin-2026`

    // Send email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: '24 Hour Designs <noreply@royaltyapp.ai>',
        to: [NOTIFY_EMAIL],
        subject: `New Question on ${proposalName} Proposal`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">New Client Question</h2>
            <p style="color: #666; margin-bottom: 24px;">A client has submitted a question on the <strong>${proposalName}</strong> proposal.</p>

            <div style="background: #f8f9fa; border-left: 4px solid #8b5cf6; padding: 16px; margin-bottom: 24px;">
              <p style="color: #333; margin: 0; font-style: italic;">"${payload.question}"</p>
            </div>

            <p style="color: #666;">An AI-drafted response has been generated. Please review and edit as needed.</p>

            <a href="${adminUrl}" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px;">
              Review & Respond
            </a>

            <p style="color: #999; font-size: 12px; margin-top: 32px;">
              Submitted at ${new Date(payload.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
            </p>
          </div>
        `,
      }),
    })

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text()
      console.error('Resend API error:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await emailResponse.json()
    console.log('Email sent successfully:', result.id)

    return new Response(
      JSON.stringify({ success: true, email_id: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing notification:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
