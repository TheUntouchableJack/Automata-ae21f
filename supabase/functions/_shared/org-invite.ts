// Pure helpers for the org-invite-send edge function (no remote imports, so vitest can load them).
// The email a business owner's teammate gets: who invited them, to which business, as what, and the
// accept link (/app/accept-invite.html?token=...). Same look as the member-code email.

import { escapeHtml, LANGS, pickLang } from './member-code.ts'

export { pickLang }
type Lang = typeof LANGS[number]

export const INVITE_TEXT: Record<Lang, {
  subject: string; intro: string; roleMember: string; roleAdmin: string; button: string;
  expires: string; ignore: string; footer: string; someone: string
}> = {
  en: { subject: '{inviter} invited you to {org} on Royalty', intro: '{inviter} invited you to join {org} on Royalty as {role}.', roleMember: 'a team member', roleAdmin: 'an admin', button: 'Accept the invitation', expires: 'The invitation works for 7 days.', ignore: "If you weren't expecting this, you can ignore this email.", footer: 'Sent by Royalty for {org}.', someone: 'Someone' },
  es: { subject: '{inviter} te invitó a {org} en Royalty', intro: '{inviter} te invitó a unirte a {org} en Royalty como {role}.', roleMember: 'miembro del equipo', roleAdmin: 'administrador', button: 'Aceptar la invitación', expires: 'La invitación es válida durante 7 días.', ignore: 'Si no esperabas este correo, puedes ignorarlo.', footer: 'Enviado por Royalty para {org}.', someone: 'Alguien' },
  fr: { subject: '{inviter} vous invite à rejoindre {org} sur Royalty', intro: '{inviter} vous invite à rejoindre {org} sur Royalty en tant que {role}.', roleMember: "membre de l'équipe", roleAdmin: 'administrateur', button: "Accepter l'invitation", expires: "L'invitation est valable 7 jours.", ignore: "Si vous n'attendiez pas cet e-mail, ignorez-le.", footer: 'Envoyé par Royalty pour {org}.', someone: "Quelqu'un" },
  de: { subject: '{inviter} hat dich zu {org} auf Royalty eingeladen', intro: '{inviter} hat dich eingeladen, {org} auf Royalty als {role} beizutreten.', roleMember: 'Teammitglied', roleAdmin: 'Admin', button: 'Einladung annehmen', expires: 'Die Einladung gilt 7 Tage.', ignore: 'Wenn du diese E-Mail nicht erwartet hast, ignoriere sie einfach.', footer: 'Gesendet von Royalty für {org}.', someone: 'Jemand' },
  it: { subject: '{inviter} ti ha invitato in {org} su Royalty', intro: '{inviter} ti ha invitato a unirti a {org} su Royalty come {role}.', roleMember: 'membro del team', roleAdmin: 'amministratore', button: "Accetta l'invito", expires: "L'invito è valido per 7 giorni.", ignore: 'Se non ti aspettavi questa email, puoi ignorarla.', footer: 'Inviato da Royalty per {org}.', someone: 'Qualcuno' },
  pt: { subject: '{inviter} convidou você para {org} na Royalty', intro: '{inviter} convidou você para entrar em {org} na Royalty como {role}.', roleMember: 'membro da equipe', roleAdmin: 'administrador', button: 'Aceitar o convite', expires: 'O convite vale por 7 dias.', ignore: 'Se você não esperava este e-mail, pode ignorá-lo.', footer: 'Enviado pela Royalty para {org}.', someone: 'Alguém' },
  zh: { subject: '{inviter} 邀请你加入 Royalty 上的 {org}', intro: '{inviter} 邀请你以{role}身份加入 Royalty 上的 {org}。', roleMember: '团队成员', roleAdmin: '管理员', button: '接受邀请', expires: '邀请 7 天内有效。', ignore: '如果你没有预料到这封邮件，可以忽略它。', footer: '由 Royalty 代 {org} 发送。', someone: '有人' },
  ar: { subject: '{inviter} دعاك إلى {org} على Royalty', intro: 'دعاك {inviter} للانضمام إلى {org} على Royalty بصفة {role}.', roleMember: 'عضو في الفريق', roleAdmin: 'مسؤول', button: 'قبول الدعوة', expires: 'الدعوة صالحة لمدة 7 أيام.', ignore: 'إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها.', footer: 'أرسلته Royalty نيابةً عن {org}.', someone: 'شخص ما' },
}

// The accept link: only for a token that looks like one, only on an origin we serve.
export const SITE_ORIGINS = ['https://royaltyapp.ai', 'https://www.royaltyapp.ai', 'http://localhost:5173', 'http://localhost:5174']
export function acceptUrl(origin: string | null | undefined, token: string): string {
  const base = SITE_ORIGINS.includes(String(origin || '')) ? String(origin) : 'https://royaltyapp.ai'
  if (!/^[A-Za-z0-9-]{20,100}$/.test(token)) throw new Error('bad token')
  return `${base}/app/accept-invite.html?token=${encodeURIComponent(token)}`
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/
export function plainEmail(email: unknown): string | null {
  const e = String(email || '').trim().toLowerCase()
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null
}

export function inviteEmail(opts: { orgName: string; inviterName: string | null; role: string; url: string; lang: Lang }) {
  const t = INVITE_TEXT[opts.lang] || INVITE_TEXT.en
  const roleText = opts.role === 'admin' ? t.roleAdmin : t.roleMember
  const inviterPlain = String(opts.inviterName || '').trim() || t.someone
  // HTML: every owner-typed value escaped. Function replacers: a '$' in a name is not a pattern.
  const h = (s: string) => s
    .replace('{inviter}', () => escapeHtml(inviterPlain))
    .replace('{org}', () => escapeHtml(opts.orgName || 'Royalty'))
    .replace('{role}', () => escapeHtml(roleText))
  // Plain text and subject: no markup, no line breaks.
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
  const p = (s: string) => s
    .replace('{inviter}', () => oneLine(inviterPlain).slice(0, 80))
    .replace('{org}', () => oneLine(opts.orgName || 'Royalty').slice(0, 80))
    .replace('{role}', () => roleText)
  const url = escapeHtml(opts.url)
  const dir = opts.lang === 'ar' ? 'rtl' : 'ltr'
  const html = `<!DOCTYPE html><html lang="${opts.lang}" dir="${dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#7c3aed;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:700;">${escapeHtml(opts.orgName || 'Royalty')}</td></tr>
<tr><td style="padding:28px;color:#18181b;font-size:15px;line-height:1.6;">
<p style="margin:0 0 24px;">${h(t.intro)}</p>
<p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">${escapeHtml(t.button)}</a></p>
<p style="margin:0 0 8px;color:#52525b;">${escapeHtml(t.expires)}</p>
<p style="margin:0;color:#71717a;font-size:13px;">${escapeHtml(t.ignore)}</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;color:#a1a1aa;font-size:12px;">${h(t.footer)}</td></tr>
</table></td></tr></table></body></html>`
  const subject = p(t.subject)
  const text = `${p(t.intro)}\n\n${t.button}: ${opts.url}\n\n${t.expires}\n${t.ignore}\n\n${p(t.footer)}`
  return { subject, html, text }
}
