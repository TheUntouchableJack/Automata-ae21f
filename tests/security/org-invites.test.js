/**
 * Staff invitations (plan cool-anything-here-wiggly-valiant, item 4, 2026-11-22).
 *
 * Before: Settings → Team inserted organization_invitations and said "Invitation sent"; no email,
 * nothing could accept, and handle_new_user() made any invitee who signed up the owner of a new org.
 *
 * Now: migration 20261122000006 (handle_new_user staff branch behind an md5 guard,
 * get_org_invitation, accept_org_invitation, org_invite_claim_send), the org-invite-send edge
 * function, /app/accept-invite.html, Settings resend/copy-link, and login routing for staff.
 *
 * Behaviour of the SQL is tested on PGlite against the REAL handle_new_user and the hand-applied
 * table: ~/Documents/Design Benches/royalty-owner-journey-2026-11-22/pglite/invites.mjs (48 checks,
 * 6 mutants caught). These pin the email, the function's order of checks, the client↔SQL contract,
 * and the accept page's states.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { INVITE_TEXT, acceptUrl, inviteEmail, plainEmail } from '../../supabase/functions/_shared/org-invite.ts'
import { LANGS } from '../../supabase/functions/_shared/member-code.ts'

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const MIG = read('supabase/migrations/20261122000006_org_invitations_accept.sql')
const FN = read('supabase/functions/org-invite-send/index.ts')
const SETTINGS = read('app/settings.js')
const PAGE_JS = read('app/accept-invite.js')
const PAGE_HTML = read('app/accept-invite.html')
const LOGIN = read('app/login.html')

const TOKEN = '0d6c2b7e-1f3a-4c5d-9e8f-123456789abc'

describe('the invite email', () => {
  const base = { orgName: "Joe's Cafe", inviterName: 'Olivia Owner', role: 'member', url: acceptUrl('https://royaltyapp.ai', TOKEN), lang: 'en' }

  it('says who, where, as what, and links to the accept page', () => {
    const m = inviteEmail(base)
    expect(m.subject).toBe("Olivia Owner invited you to Joe's Cafe on Royalty")
    expect(m.html).toContain('Olivia Owner invited you to join Joe&#39;s Cafe on Royalty as a team member.')
    expect(m.html).toContain(`href="https://royaltyapp.ai/app/accept-invite.html?token=${TOKEN}"`)
    expect(m.text).toContain(`https://royaltyapp.ai/app/accept-invite.html?token=${TOKEN}`)
    expect(inviteEmail({ ...base, role: 'admin' }).text).toContain('as an admin')
  })

  it('owner-typed names are escaped in HTML and flattened in the subject', () => {
    const m = inviteEmail({ ...base, orgName: '<img src=x onerror=alert(1)>', inviterName: 'Eve\r\nBcc: x@evil.com' })
    expect(m.html).not.toContain('<img src=x')
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(m.subject).not.toMatch(/[\r\n]/)
    expect(m.subject.startsWith('Eve Bcc: x@evil.com invited you')).toBe(true)
  })

  it("a '$' in a name is text, not a replacement pattern", () => {
    expect(inviteEmail({ ...base, orgName: "$& $' Shop" }).subject).toContain("$& $' Shop")
  })

  it('no inviter name: "Someone"', () => {
    expect(inviteEmail({ ...base, inviterName: null }).subject).toBe("Someone invited you to Joe's Cafe on Royalty")
  })

  it('all 8 languages, each with every slot', () => {
    expect(Object.keys(INVITE_TEXT).sort()).toEqual([...LANGS].sort())
    for (const lang of LANGS) {
      const t = INVITE_TEXT[lang]
      expect(t.subject).toContain('{inviter}'); expect(t.subject).toContain('{org}')
      expect(t.intro).toContain('{role}'); expect(t.footer).toContain('{org}')
      const m = inviteEmail({ ...base, lang })
      expect(m.html).not.toMatch(/\{(inviter|org|role)\}/)
    }
    expect(inviteEmail({ ...base, lang: 'ar' }).html).toContain('dir="rtl"')
  })

  it('the link only goes to an origin we serve, and only with a token-shaped token', () => {
    expect(acceptUrl('https://evil.example', TOKEN)).toBe(`https://royaltyapp.ai/app/accept-invite.html?token=${TOKEN}`)
    expect(acceptUrl('http://localhost:5173', TOKEN).startsWith('http://localhost:5173/')).toBe(true)
    expect(() => acceptUrl('https://royaltyapp.ai', 'x"><script>')).toThrow()
  })

  it('reply-to is only a plain address', () => {
    expect(plainEmail('Owner@Biz.com')).toBe('owner@biz.com')
    expect(plainEmail('a@b.com, c@d.com')).toBeNull()
    expect(plainEmail('x\r\nBcc: y@z.com')).toBeNull()
    expect(plainEmail(null)).toBeNull()
  })
})

describe('org-invite-send', () => {
  it('checks the caller before anything else, and hands SQL the caller id', () => {
    const auth = FN.indexOf('admin.auth.getUser(jwt)')
    expect(auth).toBeGreaterThan(-1)
    expect(auth).toBeLessThan(FN.indexOf('await req.json()'))
    expect(auth).toBeLessThan(FN.indexOf("admin.rpc('org_invite_claim_send'"))
    expect(FN).toMatch(/p_invitation_id: invitationId, p_caller: caller\.id/)
  })

  it('never returns the token or the invitee address to the browser', () => {
    const responses = FN.match(/return json\([^\n]*\)/g)
    expect(responses.length).toBeGreaterThan(5)
    for (const r of responses) expect(r).not.toMatch(/token|claim\.email/)
  })

  it('is registered with verify_jwt = false (it verifies the caller itself)', () => {
    expect(read('supabase/config.toml')).toMatch(/\[functions\.org-invite-send\]\nverify_jwt = false\n/)
  })
})

describe('the migration, shape', () => {
  it('replaces handle_new_user only over a known body, adding just the staff condition', () => {
    expect(MIG).toMatch(/IF md5\(v_live\) NOT IN \('f301aaf6d2f31fb0b7de6cdaefafa855', '[0-9a-f]{32}'\) THEN/)
    expect(MIG).toContain("IN ('app_member', 'staff') THEN")
    // Exactly one staff condition, inside the function.
    expect(MIG.match(/'app_member', 'staff'/g)).toHaveLength(1)
  })

  it('grants: lookup anon+authenticated, accept authenticated, claim service_role', () => {
    expect(MIG).toContain('GRANT EXECUTE ON FUNCTION public.get_org_invitation(TEXT) TO anon, authenticated, service_role;')
    expect(MIG).toContain('REVOKE ALL ON FUNCTION public.accept_org_invitation(TEXT) FROM PUBLIC, anon;')
    expect(MIG).toContain('GRANT EXECUTE ON FUNCTION public.accept_org_invitation(TEXT) TO authenticated, service_role;')
    expect(MIG).toContain('REVOKE ALL ON FUNCTION public.org_invite_claim_send(UUID, UUID) FROM PUBLIC, anon, authenticated;')
  })

  it("an invite never grants 'owner'", () => {
    const acc = MIG.match(/CREATE OR REPLACE FUNCTION public\.accept_org_invitation[\s\S]*?\n\$\$;\n/)[0]
    expect(acc).toContain("v_role := CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END;")
    expect(acc).toMatch(/INSERT INTO organization_members \(organization_id, user_id, role\)\s+VALUES \(v_inv\.organization_id, v_uid, v_role\);/)
  })
})

describe('client ↔ SQL contract (PostgREST resolves arguments by NAME)', () => {
  it('the accept page calls both functions with p_token', () => {
    expect(PAGE_JS).toContain("db.rpc('get_org_invitation', { p_token: token })")
    expect(PAGE_JS).toContain("db.rpc('accept_org_invitation', { p_token: token })")
    expect(MIG).toContain('FUNCTION public.get_org_invitation(p_token TEXT)')
    expect(MIG).toContain('FUNCTION public.accept_org_invitation(p_token TEXT)')
  })

  it('sign-up from an invite is a staff account carrying its token', () => {
    expect(PAGE_JS).toMatch(/data: \{ first_name: first, last_name: last, user_type: 'staff', invite_token: token \}/)
    expect(PAGE_JS).toContain("emailRedirectTo: window.location.origin + '/app/login.html'")
  })

  it('Settings inserts, then sends through org-invite-send; resend and copy link exist', () => {
    expect(SETTINGS).toMatch(/\.from\('organization_invitations'\)\s+\.insert\(\{[\s\S]*?\}\)\s+\.select\('id'\)\s+\.single\(\);/)
    expect(SETTINGS).toContain('const sent = await sendInviteEmail(created.id);')
    expect(SETTINGS).toContain('${SUPABASE_URL}/functions/v1/org-invite-send')
    expect(SETTINGS).toContain('body: JSON.stringify({ invitation_id: invitationId, lang })')
    expect(SETTINGS).toMatch(/class="btn btn-sm btn-ghost resend-invite-btn"/)
    expect(SETTINGS).toMatch(/class="btn btn-sm btn-ghost copy-invite-btn"/)
    expect(SETTINGS).toContain('/app/accept-invite.html?token=${encodeURIComponent(token)}')
    // No more "sent" on an insert alone.
    expect(SETTINGS).not.toContain("showToast(`Invitation sent to ${email}`, 'success');")
  })

  it('login sends staff to the invite until they joined, then to the Counter (admins: dashboard), never onboarding', () => {
    const fn = LOGIN.match(/async function firstRunDestination\(user\) \{[\s\S]*?\n {8}\}\n/)[0]
    const staff = fn.indexOf("meta.user_type === 'staff'")
    expect(staff).toBeGreaterThan(-1)
    expect(staff).toBeLessThan(fn.indexOf('justCreatedAppId'))
    expect(fn).toContain('`/app/accept-invite.html${t ? `?token=${encodeURIComponent(t)}` : \'\'}`')
    expect(fn).toContain("staffOrgs[0].role === 'admin' ? '/app/dashboard.html' : '/app/counter.html'")
    expect(LOGIN).toContain("user?.user_metadata?.user_type === 'staff'\n                    ? null : await saveOnboardingDataAfterLogin(user.id);")
    expect(LOGIN).toMatch(/OnboardingStorage\.isComplete\(\)\s+&& user\.user_metadata\?\.user_type !== 'staff';/)
  })

  it('the page is noindex and sends no referrer (the token is in its URL)', () => {
    expect(PAGE_HTML).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(PAGE_HTML).toContain('<meta name="referrer" content="no-referrer">')
  })
})

describe('the accept page, run', () => {
  const body = PAGE_HTML.match(/<body>([\s\S]*?)<script/)[1]
  const flush = () => new Promise((r) => setTimeout(r, 0))

  function makeDb({ invite, session = null, accept = { success: true, code: 'joined', org_name: 'Bean There', role: 'member' }, signUp } = {}) {
    const calls = []
    return {
      calls,
      rpc: vi.fn(async (fn, args) => {
        calls.push([fn, args])
        if (fn === 'get_org_invitation') return { data: invite, error: null }
        if (fn === 'accept_org_invitation') return { data: accept, error: null }
        return { data: null, error: { message: 'unknown' } }
      }),
      auth: {
        getSession: vi.fn(async () => ({ data: { session } })),
        signUp: vi.fn(signUp || (async () => ({ data: { user: { identities: [{}] }, session: null }, error: null }))),
        signInWithPassword: vi.fn(async () => ({ data: { user: { email: invite?.email, user_metadata: {} } }, error: null })),
        signOut: vi.fn(async () => ({})),
      },
    }
  }

  async function load(db, token = TOKEN) {
    document.body.innerHTML = body
    window.location.search = `?token=${token}`
    window.location.href = ''
    window.I18n = { t: (k) => (k === 'acceptInvite.checking' ? 'Checking…' : k) }
    // eslint-disable-next-line no-new-func
    new Function('db', PAGE_JS)(db)
    await flush(); await flush(); await flush()
  }

  const pending = { status: 'pending', org_name: 'Bean There', role: 'member', email: 'sam@example.com', inviter_name: 'Olivia Owner' }
  const visible = (id) => !document.getElementById(id).hidden

  beforeEach(() => { vi.useRealTimers() })

  it('a malformed token never reaches the database', async () => {
    const db = makeDb({ invite: pending })
    await load(db, 'abc')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(document.getElementById('invite-error').textContent).toMatch(/isn't valid/)
  })

  it('pending, signed out: who invited you, and a sign-up for the invited email only', async () => {
    const db = makeDb({ invite: pending })
    await load(db)
    expect(document.getElementById('invite-title').textContent).toBe('Join Bean There')
    expect(document.getElementById('invite-subtitle').textContent).toBe('Olivia Owner invited you to join Bean There on Royalty as a team member.')
    expect(visible('create-form')).toBe(true)
    expect(document.getElementById('create-email').value).toBe('sam@example.com')
    expect(document.getElementById('create-email').readOnly).toBe(true)
  })

  it('creating the account asks Supabase for a staff user, then says check your email', async () => {
    const db = makeDb({ invite: pending })
    await load(db)
    document.getElementById('first-name').value = 'Sam'
    document.getElementById('create-password').value = 'longenough1'
    document.getElementById('create-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush(); await flush()
    expect(db.auth.signUp).toHaveBeenCalledWith({
      email: 'sam@example.com', password: 'longenough1',
      options: { data: { first_name: 'Sam', last_name: '', user_type: 'staff', invite_token: TOKEN }, emailRedirectTo: `${window.location.origin}/app/login.html` },
    })
    expect(visible('check-email-section')).toBe(true)
    expect(document.getElementById('check-email-text').textContent).toContain('sam@example.com')
  })

  it('a short password is refused before Supabase', async () => {
    const db = makeDb({ invite: pending })
    await load(db)
    document.getElementById('first-name').value = 'Sam'
    document.getElementById('create-password').value = 'short'
    document.getElementById('create-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(db.auth.signUp).not.toHaveBeenCalled()
    expect(document.getElementById('invite-error').textContent).toMatch(/8 characters/)
  })

  it('an address that already has an account is sent to sign in', async () => {
    const db = makeDb({ invite: pending, signUp: async () => ({ data: { user: { identities: [] }, session: null }, error: null }) })
    await load(db)
    document.getElementById('first-name').value = 'Sam'
    document.getElementById('create-password').value = 'longenough1'
    document.getElementById('create-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await flush(); await flush()
    expect(visible('signin-form')).toBe(true)
    expect(document.getElementById('invite-error').textContent).toMatch(/already has an account/)
  })

  it('signed in as someone else: says whose invite it is, offers sign out, accepts nothing', async () => {
    const db = makeDb({ invite: pending, session: { user: { email: 'other@example.com', user_metadata: {} } } })
    await load(db)
    expect(visible('wrong-section')).toBe(true)
    expect(document.getElementById('wrong-text').textContent).toContain('sam@example.com')
    expect(db.calls.some(([fn]) => fn === 'accept_org_invitation')).toBe(false)
  })

  it('back from the confirmation email (its own token in metadata): joins without a click, then the Counter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const db = makeDb({ invite: pending, session: { user: { email: 'Sam@Example.com', user_metadata: { invite_token: TOKEN } } } })
    const p = load(db)
    await vi.advanceTimersByTimeAsync(10)
    await p
    await vi.advanceTimersByTimeAsync(10)
    expect(db.calls).toContainEqual(['accept_org_invitation', { p_token: TOKEN }])
    expect(visible('joined-section')).toBe(true)
    await vi.advanceTimersByTimeAsync(1300)
    expect(window.location.href).toBe('/app/counter.html')
  })

  it('signed in, not from this invite: a Join button, no auto-accept', async () => {
    const db = makeDb({ invite: pending, session: { user: { email: 'sam@example.com', user_metadata: {} } } })
    await load(db)
    expect(visible('join-section')).toBe(true)
    expect(document.getElementById('join-btn').textContent).toBe('Join Bean There')
    expect(db.calls.some(([fn]) => fn === 'accept_org_invitation')).toBe(false)
  })

  it('an admin invite lands on the dashboard', async () => {
    expect(window.__acceptInvite.landingFor('admin')).toBe('/app/dashboard.html')
    expect(window.__acceptInvite.landingFor('member')).toBe('/app/counter.html')
  })

  it('expired / cancelled / used: why, and no form', async () => {
    for (const [status, re] of [['expired', /expired\. Ask Bean There/], ['cancelled', /cancelled/], ['accepted', /already been used/]]) {
      const db = makeDb({ invite: { ...pending, status } })
      await load(db)
      expect(document.getElementById('invite-error').textContent).toMatch(re)
      expect(['create-form', 'signin-form', 'join-section'].every((id) => !visible(id))).toBe(true)
    }
  })

  it('has_org from the server is explained, not swallowed', async () => {
    const db = makeDb({ invite: pending, session: { user: { email: 'sam@example.com', user_metadata: {} } },
      accept: { success: false, code: 'has_org', invited_email: 'sam@example.com' } })
    await load(db)
    document.getElementById('join-btn').click()
    await flush(); await flush()
    expect(document.getElementById('invite-error').textContent).toMatch(/already runs its own business/)
  })
})
