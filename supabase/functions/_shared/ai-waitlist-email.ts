// The "Royal AI is on for {Business}" email, sent by ai-waitlist-notify. No imports, so vitest
// can load it.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Subject and body of the "Royal AI is on" email (tests/edge-functions/ai-status.test.js). */
export function waitlistEmail(businessName: string, firstName: string): { subject: string; html: string; preheader: string } {
  const biz = businessName.trim() || 'your business'
  const name = firstName.trim()
  return {
    subject: `Royal AI is on for ${biz}`,
    preheader: 'You signed up during early access. Royal AI is ready in your dashboard.',
    html: `
      <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Royal AI is on for ${escapeHtml(biz)}</h1>
      <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 12px;">
        ${name ? `Hi ${escapeHtml(name)}, you` : 'You'} signed up while Royal AI was in early access, so you were on the list. It's ready now.
      </p>
      <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
        Open Intelligence and press <strong>Analyze</strong>. Royal reads your loyalty program and suggests the first campaigns to run.
        You can also ask it anything about your customers.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="https://royaltyapp.ai/app/intelligence.html"
           style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                  border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;">
          Open Royal AI
        </a>
      </div>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
        Your loyalty app kept working the whole time. Nothing you set up has changed.
      </p>
    `,
  }
}
