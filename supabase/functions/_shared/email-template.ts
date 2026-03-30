// Shared email template — branded wrapper for all Royalty emails
//
// Usage:
//   import { wrapEmail } from '../_shared/email-template.ts'
//   const html = wrapEmail('<p>Hello!</p>')
//   const html = wrapEmail(bodyHtml, { preheader: 'Preview text', unsubscribeUrl: '...' })

export interface EmailTemplateOptions {
  /** Show the branded header with crown logo (default: true) */
  showLogo?: boolean
  /** Preheader text — shown in inbox preview, hidden in email body */
  preheader?: string
  /** Custom footer text (default: standard compliance text) */
  footerText?: string
  /** Hide footer entirely (default: false) */
  hideFooter?: boolean
  /** Unsubscribe URL — shown in footer if provided */
  unsubscribeUrl?: string
}

// Crown SVG with gold accents — matches confirm-signup.html branding
const CROWN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="56" height="56" style="display:inline-block;">
  <rect width="512" height="512" rx="96" fill="rgba(255,255,255,0.15)"/>
  <g transform="translate(256, 135)">
    <path d="M-65,18 L-55,-25 L-28,2 L0,-35 L28,2 L55,-25 L65,18 Z" fill="#fbbf24" opacity="0.95"/>
    <circle cx="0" cy="-28" r="6" fill="white" opacity="0.85"/>
    <circle cx="-52" cy="-18" r="4.5" fill="white" opacity="0.65"/>
    <circle cx="52" cy="-18" r="4.5" fill="white" opacity="0.65"/>
    <rect x="-65" y="14" width="130" height="10" rx="3" fill="#fbbf24" opacity="0.8"/>
  </g>
  <text x="256" y="390" text-anchor="middle" font-family="'Outfit',Arial,sans-serif" font-weight="700" font-size="260" fill="white" letter-spacing="-8">R</text>
</svg>`

/**
 * Wraps email body HTML in the branded Royalty email template.
 * Uses table layout for maximum email client compatibility.
 * Gradient header with crown SVG, Outfit font, compliance footer.
 */
export function wrapEmail(bodyHtml: string, options: EmailTemplateOptions = {}): string {
  const { showLogo = true, preheader, footerText, hideFooter = false, unsubscribeUrl } = options

  const preheaderBlock = preheader ? `
    <!-- Preheader (inbox preview text, hidden in body) -->
    <div style="display:none;font-size:1px;color:#f4f4f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${preheader}
    </div>` : ''

  const logoHeader = showLogo ? `
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);padding:28px 32px;text-align:center;">
              ${CROWN_SVG}
              <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:8px;letter-spacing:-0.5px;font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Royalty</div>
            </td>
          </tr>` : ''

  const unsubscribeLink = unsubscribeUrl
    ? `<br><a href="${unsubscribeUrl}" style="color:#a1a1aa;text-decoration:underline;font-size:12px;">Unsubscribe</a>`
    : ''

  const footer = hideFooter ? '' : `
          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
                ${footerText || 'Royalty &mdash; AI-Powered Loyalty for Local Business'}
              </p>
              <p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;line-height:1.6;">
                <a href="https://royaltyapp.ai" style="color:#7c3aed;text-decoration:none;">royaltyapp.ai</a>
                &nbsp;&middot;&nbsp; United States
                ${unsubscribeLink}
              </p>
            </td>
          </tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          ${logoHeader}
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px;color:#18181b;font-size:15px;line-height:1.7;font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
          ${footer}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
