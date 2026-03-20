// Shared email template — branded wrapper for all Royalty emails
//
// Usage:
//   import { wrapEmail } from '../_shared/email-template.ts'
//   const html = wrapEmail('<p>Hello!</p>')
//   const html = wrapEmail(bodyHtml, { footerText: 'Custom footer' })

export interface EmailTemplateOptions {
  /** Show the purple header with logo (default: true) */
  showLogo?: boolean
  /** Custom footer text (default: standard "You received this..." text) */
  footerText?: string
  /** Hide footer entirely (default: false) */
  hideFooter?: boolean
}

/**
 * Wraps email body HTML in the branded Royalty email template.
 * Uses table layout for maximum email client compatibility.
 */
export function wrapEmail(bodyHtml: string, options: EmailTemplateOptions = {}): string {
  const { showLogo = true, footerText, hideFooter = false } = options

  const logoHeader = showLogo ? `
          <!-- Header -->
          <tr>
            <td style="background-color:#7c3aed;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:10px;">
                          <div style="width:32px;height:32px;background-color:rgba(255,255,255,0.2);border-radius:8px;text-align:center;line-height:32px;">
                            <span style="color:#ffffff;font-size:16px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">R</span>
                          </div>
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Royalty</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ''

  const footer = hideFooter ? '' : `
          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa;padding:20px 32px;">
              <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
                ${footerText || 'You received this message because you signed up for Royalty.'}<br>
                <a href="https://royaltyapp.ai" style="color:#7c3aed;text-decoration:none;">royaltyapp.ai</a>
                &nbsp;&middot;&nbsp; Royalty &middot; United States
              </p>
            </td>
          </tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          ${logoHeader}
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#18181b;font-size:15px;line-height:1.7;">
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
