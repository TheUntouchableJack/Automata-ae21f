// Pure helpers for the member-code edge function (no remote imports, so vitest can load them).
// See supabase/functions/member-code/index.ts for the flow.

export const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'] as const
type Lang = typeof LANGS[number]

// The email's own words, in the 8 languages the customer app offers.
export const EMAIL_TEXT: Record<Lang, { subject: string; intro: string; expires: string; ignore: string; footer: string }> = {
  en: { subject: '{code} is your code for {app}', intro: 'Your sign-in code for {app}:', expires: 'It works for 10 minutes.', ignore: "If you didn't ask for this code, you can ignore this email.", footer: 'Sent by Royalty for {app}.' },
  es: { subject: '{code} es tu código para {app}', intro: 'Tu código de acceso para {app}:', expires: 'Es válido durante 10 minutos.', ignore: 'Si no pediste este código, puedes ignorar este correo.', footer: 'Enviado por Royalty para {app}.' },
  fr: { subject: '{code} est votre code pour {app}', intro: 'Votre code de connexion pour {app} :', expires: 'Il est valable 10 minutes.', ignore: "Si vous n'avez pas demandé ce code, ignorez cet e-mail.", footer: 'Envoyé par Royalty pour {app}.' },
  de: { subject: '{code} ist dein Code für {app}', intro: 'Dein Anmeldecode für {app}:', expires: 'Er gilt 10 Minuten lang.', ignore: 'Wenn du diesen Code nicht angefordert hast, ignoriere diese E-Mail.', footer: 'Gesendet von Royalty für {app}.' },
  it: { subject: '{code} è il tuo codice per {app}', intro: 'Il tuo codice di accesso per {app}:', expires: 'È valido per 10 minuti.', ignore: 'Se non hai richiesto questo codice, ignora questa email.', footer: 'Inviato da Royalty per {app}.' },
  pt: { subject: '{code} é o seu código para {app}', intro: 'Seu código de acesso para {app}:', expires: 'Ele vale por 10 minutos.', ignore: 'Se você não pediu este código, pode ignorar este e-mail.', footer: 'Enviado pela Royalty para {app}.' },
  zh: { subject: '{code} 是你在 {app} 的验证码', intro: '你在 {app} 的登录验证码：', expires: '10 分钟内有效。', ignore: '如果不是你本人请求的验证码，请忽略此邮件。', footer: '由 Royalty 代 {app} 发送。' },
  ar: { subject: '{code} هو رمزك لـ {app}', intro: 'رمز تسجيل الدخول إلى {app}:', expires: 'صالح لمدة 10 دقائق.', ignore: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.', footer: 'أرسلته Royalty نيابةً عن {app}.' },
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// A display name that is safe inside a From header: no quotes, angle brackets or line breaks.
export function fromName(appName: string): string {
  const clean = String(appName || '').replace(/[\r\n"<>\\@]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return clean || 'Rewards'
}

export function safeColor(c: unknown): string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#6366f1'
}

export function pickLang(l: unknown): Lang {
  const code = String(l || '').toLowerCase().slice(0, 2)
  return (LANGS as readonly string[]).includes(code) ? code as Lang : 'en'
}

export function codeEmail(appName: string, color: string, code: string, lang: Lang) {
  const t = EMAIL_TEXT[lang]
  const app = escapeHtml(appName)
  // Function replacers: a '$' in a business name must not act as a pattern.
  const fill = (s: string) => s.replace('{app}', () => app).replace('{code}', () => code)
  const plain = (s: string) => s.replace('{app}', () => fromName(appName)).replace('{code}', () => code)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:${color};padding:22px 28px;color:#ffffff;font-size:20px;font-weight:700;">${app}</td></tr>
<tr><td style="padding:28px;color:#18181b;font-size:15px;line-height:1.6;">
<p style="margin:0 0 16px;">${fill(t.intro)}</p>
<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:#18181b;">${code}</p>
<p style="margin:0 0 8px;color:#52525b;">${fill(t.expires)}</p>
<p style="margin:0;color:#71717a;font-size:13px;">${fill(t.ignore)}</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;color:#a1a1aa;font-size:12px;">${fill(t.footer)}</td></tr>
</table></td></tr></table></body></html>`
  const subject = plain(t.subject)
  const text = `${plain(t.intro)} ${code}\n\n${t.expires}\n${t.ignore}\n\n${plain(t.footer)}`
  return { subject, html, text }
}

export async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function sixDigits(): string {
  // Rejection sampling: 4294967296 is not a multiple of 1e6.
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  do { crypto.getRandomValues(buf) } while (buf[0] >= limit)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}
