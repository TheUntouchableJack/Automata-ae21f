// Supabase Edge Function: SOW Signing Notification
// Sends email to jay@24hour.design when a client signs a SOW
// Includes the signed PDF as an attachment

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const NOTIFY_EMAIL = 'jay@24hour.design'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SowSignPayload {
  proposal_id: string
  proposal_name: string
  signer_name: string
  signer_email: string
  signer_title: string
  signed_at: string
  proposal_version: string
  is_bundle: boolean
  pdf_base64?: string
  pdf_filename?: string
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatProposalName(id: string): string {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: SowSignPayload = await req.json()

    // Validate required fields (pdf_base64 is optional — client retries without it if payload is too large)
    if (!payload.proposal_id || !payload.signer_name || !payload.signer_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
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

    const proposalName = escapeHtml(payload.proposal_name || formatProposalName(payload.proposal_id))
    const signerName = escapeHtml(payload.signer_name)
    const signerEmail = escapeHtml(payload.signer_email)
    const signerTitle = escapeHtml(payload.signer_title || '')
    const docType = payload.is_bundle ? 'Bundle' : 'SOW'
    const adminUrl = `https://24hourdesigns.netlify.app/?client=${encodeURIComponent(payload.proposal_id)}&admin=24hd-jay-admin-2026`

    const signedDate = payload.signed_at
      ? new Date(payload.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })
      : 'Unknown'

    const subject = `${docType} Signed: ${payload.proposal_name || formatProposalName(payload.proposal_id)} \u2014 ${payload.signer_name}`

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #1a1a2e; padding: 24px 32px;">
    <h1 style="color: #ffffff; font-size: 18px; margin: 0; font-weight: 600;">24 Hour Designs</h1>
  </div>
  <div style="padding: 32px;">
    <h2 style="color: #1a1a2e; margin: 0 0 8px 0; font-size: 20px;">Client Signed the ${docType}</h2>
    <p style="color: #666; margin-bottom: 24px;">The <strong>${proposalName}</strong> proposal has been signed.${payload.pdf_base64 ? ' The signed PDF is attached to this email.' : ''}</p>

    <div style="background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="color: #999; font-size: 12px; text-transform: uppercase; padding: 4px 0;">Signed By</td>
          <td style="color: #333; font-size: 14px; font-weight: 500; padding: 4px 0; text-align: right;">${signerName}</td>
        </tr>
        <tr>
          <td style="color: #999; font-size: 12px; text-transform: uppercase; padding: 4px 0;">Email</td>
          <td style="color: #333; font-size: 14px; padding: 4px 0; text-align: right;">${signerEmail}</td>
        </tr>
        ${signerTitle ? `<tr>
          <td style="color: #999; font-size: 12px; text-transform: uppercase; padding: 4px 0;">Title</td>
          <td style="color: #333; font-size: 14px; padding: 4px 0; text-align: right;">${signerTitle}</td>
        </tr>` : ''}
        <tr>
          <td style="color: #999; font-size: 12px; text-transform: uppercase; padding: 4px 0;">Date</td>
          <td style="color: #333; font-size: 14px; padding: 4px 0; text-align: right;">${signedDate} ET</td>
        </tr>
        <tr>
          <td style="color: #999; font-size: 12px; text-transform: uppercase; padding: 4px 0;">Version</td>
          <td style="color: #333; font-size: 14px; padding: 4px 0; text-align: right;">${escapeHtml(payload.proposal_version || '1.0.0')}</td>
        </tr>
      </table>
    </div>

    <a href="${adminUrl}" style="display: inline-block; background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Proposal</a>
    ${!payload.pdf_base64 ? `<p style="color: #e67e22; font-size: 13px; margin-top: 16px;"><strong>Note:</strong> The signed PDF was too large to attach. Use the link above to view the proposal and download the signed PDF from the admin panel.</p>` : ''}

    <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
      24 Hour Designs &middot; <a href="mailto:jay@24hour.design" style="color: #8b5cf6;">jay@24hour.design</a>
    </p>
  </div>
</div>`

    // Build email payload — attachment is optional
    const emailPayload: Record<string, unknown> = {
      from: '24 Hour Designs <noreply@24hour.design>',
      to: [NOTIFY_EMAIL],
      subject,
      html,
    }

    if (payload.pdf_base64) {
      emailPayload.attachments = [{
        filename: payload.pdf_filename || 'signed-sow.pdf',
        content: payload.pdf_base64,
      }]
    }

    // Send email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    })

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text()
      console.error('Resend API error:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to send notification' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await emailResponse.json()
    console.log('SOW signing notification sent:', result.id)

    return new Response(
      JSON.stringify({ success: true, email_id: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing SOW notification:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
