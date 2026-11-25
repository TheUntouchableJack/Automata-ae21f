/**
 * The confirm-email step (plan abstract-gliding-hellman, Phase 5, 2026-11-25).
 *
 * Before: nowhere could an owner resend the confirmation email; an expired link landed on a bare
 * login form; signing up again with an existing email said "Check your inbox" and no email came;
 * "Check your inbox" put the typed email into innerHTML; and the hero path landed on Intelligence
 * instead of the builder because the redirect was computed before the onboarding commit ran.
 *
 * Runs the REAL app/confirm-resend.js, and the REAL inline scripts of login.html and signup.html.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LOGIN = read('app/login.html')
const SIGNUP = read('app/signup.html')
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']
const flush = () => new Promise((r) => setTimeout(r, 0))

let tracked
beforeAll(() => {
  window.eval(read('app/confirm-resend.js'))
})
beforeEach(() => {
  tracked = []
  window.royaltyWhenAnalytics = (fn) => fn({ track: (n, p) => tracked.push([n, p]), identify: () => {} })
  window.location.origin = 'https://royaltyapp.ai'
  window.location.search = ''
  window.location.hash = ''
  window.location.pathname = '/app/login.html'
})
afterEach(() => { vi.useRealTimers(); delete window.I18n })

function resendDb(result = { error: null }) {
  const resend = vi.fn(async () => (typeof result === 'function' ? result() : result))
  window.supabase = { auth: { resend } }
  return resend
}

describe('ConfirmResend', () => {
  let btn, status
  beforeEach(() => {
    document.body.innerHTML = '<button id="b"></button><p id="s" hidden></p>'
    btn = document.getElementById('b'); status = document.getElementById('s')
  })

  it('sends a signup confirmation back to /app/login.html and tracks it', async () => {
    const resend = resendDb()
    const r = ConfirmResend.attach({ button: btn, status, getEmail: () => ' owner@example.com ', source: 'signup' })
    expect(btn.textContent).toBe('Resend email')
    expect(btn.type).toBe('button')
    expect(await r.send()).toBe('sent')
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'owner@example.com', options: { emailRedirectTo: 'https://royaltyapp.ai/app/login.html' } })
    expect(status.hidden).toBe(false)
    expect(status.textContent).toMatch(/Sent!/)
    expect(status.className).toContain('is-ok')
    expect(tracked).toContainEqual(['confirm_email_resent', { source: 'signup' }])
  })

  it('cools down for 60 s after a send, counting down', async () => {
    vi.useFakeTimers()
    resendDb()
    const r = ConfirmResend.attach({ button: btn, status, getEmail: () => 'a@b.co', source: 'login' })
    await r.send()
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('Resend in 60s')
    await vi.advanceTimersByTimeAsync(30000)
    expect(btn.textContent).toBe('Resend in 30s')
    expect(await r.send()).toBe('busy')
    await vi.advanceTimersByTimeAsync(30000)
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toBe('Resend email')
    expect(ConfirmResend.COOLDOWN_S).toBe(60)
  })

  it('right after sign-up the first resend waits (startCooled)', () => {
    vi.useFakeTimers()
    resendDb()
    ConfirmResend.attach({ button: btn, status, getEmail: () => 'a@b.co', startCooled: true })
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/Resend in \d+s/)
  })

  it('a 429 gets a friendly message and a cooldown, not an error dump', async () => {
    vi.useFakeTimers()
    resendDb({ error: { status: 429, message: 'For security purposes, you can only request this after 37 seconds.' } })
    const r = ConfirmResend.attach({ button: btn, status, getEmail: () => 'a@b.co' })
    expect(await r.send()).toBe('rate_limited')
    expect(status.textContent).toBe('We just sent one. Please wait a minute, then try again.')
    expect(status.textContent).not.toMatch(/security purposes/)
    expect(btn.disabled).toBe(true)
    expect(tracked.find((t) => t[0] === 'confirm_email_resent')).toBeUndefined()
  })

  it('recognises every rate-limit shape Supabase uses', () => {
    expect(ConfirmResend.isRateLimited({ status: 429 })).toBe(true)
    expect(ConfirmResend.isRateLimited({ code: 'over_email_send_rate_limit' })).toBe(true)
    expect(ConfirmResend.isRateLimited({ message: 'Email rate limit exceeded' })).toBe(true)
    expect(ConfirmResend.isRateLimited({ message: 'For security purposes, you can only request this after 60 seconds' })).toBe(true)
    expect(ConfirmResend.isRateLimited({ status: 400, message: 'Invalid email' })).toBe(false)
    expect(ConfirmResend.isRateLimited(null)).toBe(false)
  })

  it('other failures re-enable the button', async () => {
    resendDb({ error: { status: 500, message: 'boom' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = ConfirmResend.attach({ button: btn, status, getEmail: () => 'a@b.co' })
    expect(await r.send()).toBe('failed')
    expect(btn.disabled).toBe(false)
    expect(status.textContent).toMatch(/couldn.t send/)
  })

  it('no email typed → asks for one, sends nothing', async () => {
    const resend = resendDb()
    const r = ConfirmResend.attach({ button: btn, status, getEmail: () => '  ' })
    expect(await r.send()).toBe('no_email')
    expect(resend).not.toHaveBeenCalled()
    expect(status.textContent).toBe('Enter your email above first.')
  })

  it('translated when the language file has the key', () => {
    window.I18n = { t: (k, v) => (k === 'auth.resendEmail' ? 'Reenviar correo' : k) }
    resendDb()
    ConfirmResend.attach({ button: btn, status, getEmail: () => 'a@b.co' })
    expect(btn.textContent).toBe('Reenviar correo')
  })
})

// ----- login.html, run -----
const LOGIN_BODY = LOGIN.slice(LOGIN.indexOf('<body>') + 6, LOGIN.indexOf('<script src="https://cdn.jsdelivr.net/npm/canvas-confetti'))
const LOGIN_INLINE = LOGIN.slice(LOGIN.lastIndexOf('<script>') + 8, LOGIN.lastIndexOf('</script>'))

function runLogin({ user = null, signInError = null } = {}) {
  document.body.innerHTML = LOGIN_BODY
  delete window.loginConfirmResend // a var of the eval'd page script: one page load per run
  resendDb()
  window.supabase.auth.exchangeCodeForSession = vi.fn(async () => ({ data: null, error: { message: 'bad code' } }))
  window.db = window.supabase
  window.getCurrentUser = vi.fn(async () => user)
  window.signIn = vi.fn(async () => (signInError ? { user: null, error: signInError } : { user, error: null }))
  window.celebrate = () => {}
  window.AppWorkspace = { DEFAULT_MODE: 'owner', resolve: async () => 'owner', landingFor: () => '/app/intelligence.html' }
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.eval(LOGIN_INLINE.replace(/\bdb\./g, 'window.db.'))
}

describe('login.html: an expired or failed confirmation link', () => {
  it('otp_expired in the hash: "That link expired." plus Resend, URL cleaned', async () => {
    window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    runLogin()
    await flush()
    const err = document.getElementById('error-message')
    expect(err.classList.contains('visible')).toBe(true)
    expect(err.textContent).toBe('That link expired.')
    expect(document.getElementById('auth-resend').hidden).toBe(false)
    expect(document.getElementById('auth-resend-desc').textContent).toMatch(/expire/)
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/app/login.html')
    expect(window.getCurrentUser).not.toHaveBeenCalled()
    expect(tracked).toContainEqual(['confirm_link_failed', { expired: true }])
  })
  it('the same in the query string (PKCE)', async () => {
    window.location.search = '?error=access_denied&error_code=otp_expired'
    runLogin()
    await flush()
    expect(document.getElementById('error-message').textContent).toBe('That link expired.')
    expect(document.getElementById('auth-resend').hidden).toBe(false)
  })
  it('another link error: the failure message, still with Resend', async () => {
    window.location.hash = '#error=server_error&error_description=Something'
    runLogin()
    await flush()
    expect(document.getElementById('error-message').textContent).toMatch(/Email confirmation failed/)
    expect(document.getElementById('auth-resend').hidden).toBe(false)
  })
  it('a code that fails to exchange also offers Resend', async () => {
    window.location.search = '?code=abc'
    runLogin()
    await flush(); await flush()
    expect(document.getElementById('error-message').textContent).toMatch(/Email confirmation failed/)
    expect(document.getElementById('auth-resend').hidden).toBe(false)
  })
  it('a plain visit shows no recovery box', async () => {
    runLogin()
    await flush()
    expect(document.getElementById('auth-resend').hidden).toBe(true)
  })
  it('Resend uses the email typed in the form', async () => {
    window.location.hash = '#error_code=otp_expired'
    runLogin()
    await flush()
    document.getElementById('email').value = 'late@example.com'
    document.getElementById('auth-resend-btn').click()
    await flush()
    expect(window.supabase.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'late@example.com' }))
    expect(tracked).toContainEqual(['confirm_email_resent', { source: 'login_link' }])
  })
})

describe('login.html: "Email not confirmed"', () => {
  it('shows the message and a Resend button; a new attempt hides it again', async () => {
    runLogin({ signInError: { message: 'Email not confirmed' } })
    await flush()
    document.getElementById('email').value = 'new@example.com'
    document.getElementById('password').value = 'pw'
    const form = document.getElementById('login-form')
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush(); await flush()
    expect(document.getElementById('error-message').textContent).toBe('Please confirm your email before signing in.')
    expect(document.getElementById('auth-resend').hidden).toBe(false)
    expect(document.getElementById('auth-resend-desc').textContent).toBe("We'll send a new confirmation link to the email above.")
    document.getElementById('auth-resend-btn').click()
    await flush()
    expect(window.supabase.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com' }))
    expect(tracked).toContainEqual(['confirm_email_resent', { source: 'login' }])

    window.signIn = vi.fn(async () => ({ user: null, error: { message: 'Invalid login credentials' } }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(document.getElementById('auth-resend').hidden).toBe(true)
  })
  it('the recovery box sits under the email field its copy calls "the email above"', () => {
    document.body.innerHTML = LOGIN_BODY
    const box = document.getElementById('auth-resend')
    const email = document.getElementById('email').closest('.form-field')
    expect(email.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box.previousElementSibling).toBe(email)
  })
  it('the CAPTCHA gate is still the only one (pinned elsewhere too)', () => {
    expect(LOGIN.match(/!turnstileToken/g)).toHaveLength(1)
  })
})

describe('login.html: the hero path lands on the builder', () => {
  const fn = LOGIN.match(/function heroDestination\(mode\) \{[\s\S]*?\n {8}\}/)[0]
  // eslint-disable-next-line no-new-func
  const run = (mode, appId) => new Function('AppWorkspace', 'OnboardingSave', `${fn}; return heroDestination(${JSON.stringify(mode)});`)(
    { DEFAULT_MODE: 'owner', landingFor: (m) => (m === 'owner' ? '/app/intelligence.html' : '/app/my-app.html') },
    { lastAppId: appId },
  )
  it('the builder for the app the commit just created', () => {
    expect(run('owner', 'app-9')).toBe('/app/app-builder.html?id=app-9&onboarding=1')
  })
  it('no app → the workspace landing; a scoped workspace never goes to the builder', () => {
    expect(run('owner', null)).toBe('/app/intelligence.html')
    expect(run('app_member', 'app-9')).toBe('/app/my-app.html')
  })
  it('the mode is resolved before the transition and the redirect is a function read after onBuild', () => {
    const block = LOGIN.slice(LOGIN.indexOf('const heroMode = await AppWorkspace.resolve(user);'))
    expect(block.indexOf('const heroMode')).toBe(0)
    expect(block.indexOf('await OnboardingTransition.show({')).toBeGreaterThan(0)
    expect(block.slice(0, block.indexOf('});'))).toContain('redirectUrl: () => heroDestination(heroMode)')
    expect(LOGIN).not.toContain('redirectUrl: AppWorkspace.landingFor(await AppWorkspace.resolve(user))')
  })
  it('the pinned lines are kept exactly', () => {
    expect(LOGIN).toMatch(/OnboardingStorage\.isComplete\(\)\s+&& user\.user_metadata\?\.user_type !== 'staff';/)
    expect(LOGIN).toContain("user?.user_metadata?.user_type === 'staff'\n                    ? null : await saveOnboardingDataAfterLogin(user.id);")
    expect(LOGIN).toContain('await saveOnboardingDataAfterLogin(user.id);\n                            },\n                            redirectUrl: () => heroDestination(heroMode)')
  })
})

// ----- signup.html -----
describe('signup.html: after the form', () => {
  const pick = (name) => SIGNUP.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n {8}\\}`))[0]
  const SRC = ['signupT', 'signupEl', 'renderCheckInbox', 'renderAccountExists'].map(pick).join('\n')
  // eslint-disable-next-line no-new-func
  const build = new Function('ConfirmResend', `${SRC}; return { renderCheckInbox, renderAccountExists };`)
  beforeEach(() => { document.body.innerHTML = '' }) // one #confirm-resend-btn per document

  it('"Check your inbox" puts the email in as text, never markup', () => {
    resendDb()
    const { renderCheckInbox } = build(window.ConfirmResend)
    const evil = '<img src=x onerror="window.__pwned=1">@example.com'
    const box = renderCheckInbox(evil)
    document.body.appendChild(box)
    expect(box.querySelector('.confirm-inbox-email').textContent).toBe(evil)
    expect(box.querySelector('img')).toBe(null)
    expect(window.__pwned).toBeUndefined()
    expect(box.querySelector('h3').textContent).toBe('Check your inbox!')
    expect(box.querySelector('h3').getAttribute('data-i18n')).toBe('auth.confirmTitle')
  })
  it('it has a Resend button for that address, cooling down at first', async () => {
    vi.useFakeTimers()
    const resend = resendDb()
    const { renderCheckInbox } = build(window.ConfirmResend)
    const box = renderCheckInbox('me@example.com')
    document.body.appendChild(box)
    const btn = box.querySelector('#confirm-resend-btn')
    expect(btn.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    btn.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ email: 'me@example.com' }))
    expect(tracked).toContainEqual(['confirm_email_resent', { source: 'signup' }])
  })
  it('"already has an account" offers Sign in and Reset password', () => {
    const { renderAccountExists } = build(window.ConfirmResend)
    const box = renderAccountExists('old@example.com')
    expect(box.querySelector('h3').textContent).toBe('This email already has an account')
    const links = [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/app/login.html', '/app/forgot-password.html'])
    expect(box.textContent).not.toMatch(/Check your inbox/)
  })
  it('an existing email (no identities) takes that path, before account_created', () => {
    const submit = SIGNUP.slice(SIGNUP.indexOf("signupForm.addEventListener('submit'"))
    const check = submit.indexOf('signUpData.user.identities.length === 0')
    expect(check).toBeGreaterThan(submit.indexOf('if (signUpError) throw signUpError;'))
    expect(check).toBeLessThan(submit.indexOf("A.track('account_created'"))
    expect(submit.slice(check, submit.indexOf("A.track('account_created'"))).toMatch(/showSignupOutcome\(renderAccountExists\(email\)\);\s*return;/)
  })
  it('the old innerHTML block is gone', () => {
    expect(SIGNUP).not.toMatch(/innerHTML = `[\s\S]{0,400}\$\{email\}/)
    expect(SIGNUP).toContain('showSignupOutcome(renderCheckInbox(email));')
  })
  it('both auth pages load confirm-resend.js after auth.js', () => {
    for (const html of [SIGNUP, LOGIN]) {
      expect(html.indexOf('confirm-resend.js?v=1"')).toBeGreaterThan(html.indexOf('auth.js?v='))
    }
  })
})

describe('translations', () => {
  const KEYS = ['confirmTitle', 'confirmSentTo', 'confirmAutoSignIn', 'confirmSpam', 'resendEmail', 'resending', 'resent',
    'resendWait', 'resendTooMany', 'resendFailed', 'enterEmailFirst', 'resendDesc', 'accountExistsTitle', 'accountExistsDesc',
    'emailNotConfirmed', 'linkExpiredTitle', 'linkExpiredDesc', 'confirmFailed']
  it('every new auth key exists in all 8 languages', () => {
    for (const lang of LANGS) {
      const auth = JSON.parse(read(`i18n/${lang}.json`)).auth
      for (const k of KEYS) expect(typeof auth[k], `${lang}.auth.${k}`).toBe('string')
      expect(auth.resendWait, lang).toContain('{seconds}')
    }
  })
  it('every data-i18n / loginT / signupT key used on the two pages exists in English', () => {
    const en = JSON.parse(read('i18n/en.json'))
    const keys = new Set()
    for (const html of [SIGNUP, LOGIN, read('app/confirm-resend.js')]) {
      for (const m of html.matchAll(/(?:data-i18n="|(?:loginT|signupT|signupEl\([^,]+, [^,]+,|\bt)\(?\s*')(auth\.[A-Za-z]+)/g)) keys.add(m[1])
    }
    expect(keys.size).toBeGreaterThan(20)
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), en)
      expect(typeof v, k).toBe('string')
    }
  })
})
