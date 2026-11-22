/**
 * Royal AI early access (plan 1-is-there-a-gentle-stallman, Part A, 2026-11-22).
 *
 * When Anthropic credits run out, every AI function used to fail its own way: a red line on
 * the hero, an alert() on Analyze, the raw Anthropic JSON in CEO chat. Now one status row
 * decides, the functions answer 503 {code:'ai_unavailable'} with no Anthropic text, and the
 * client shows an early-access card. These tests pin:
 *   - the classifier against the bodies Anthropic actually returns;
 *   - the on/off rule, and that the SQL copy of it says the same thing;
 *   - the server gate (fails open) and outage reporting (outages only);
 *   - that no adopted function can still hand Anthropic text to a caller;
 *   - js/ai-status.js: caching, fail-open, waitlist join;
 *   - the "Royal AI is on" email escapes the business name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {
  classifyClaudeError, isOutage, aiEnabledFrom, aiErrorBody, claudeFailure,
  assertAiEnabled, readAiState, isAiUnavailableError, noteAiSuccess, _resetAiStateCache,
} from '../../supabase/functions/_shared/ai-status.ts'
import { waitlistEmail } from '../../supabase/functions/_shared/ai-waitlist-email.ts'

const root = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

// Bodies as the Messages API returns them.
const BODIES = {
  credits: JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
    request_id: 'req_011CVx',
  }),
  spendCap: JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' },
  }),
  auth: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
  permission: JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' } }),
  rateLimit: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } }),
  overloaded: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
  badRequest: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: Field required' } }),
}

// A fake service-role client: platform_status reads and report_ai_health calls.
function fakeDb({ value = null, readError = null } = {}) {
  const calls = []
  return {
    calls,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (readError ? { data: null, error: readError } : { data: value ? { value } : null, error: null }) }) }),
    }),
    rpc: async (fn, args) => { calls.push([fn, args]); return { data: true, error: null } },
  }
}

describe('classifyClaudeError', () => {
  it('reads the real failure bodies', () => {
    expect(classifyClaudeError(400, BODIES.credits)).toBe('credits')
    expect(classifyClaudeError(400, BODIES.spendCap)).toBe('credits')
    expect(classifyClaudeError(401, BODIES.auth)).toBe('auth')
    expect(classifyClaudeError(403, BODIES.permission)).toBe('auth')
    expect(classifyClaudeError(429, BODIES.rateLimit)).toBe('rate_limit')
    expect(classifyClaudeError(529, BODIES.overloaded)).toBe('overloaded')
    expect(classifyClaudeError(400, BODIES.badRequest)).toBe('other')
  })

  it('copes with a body that is not JSON', () => {
    expect(classifyClaudeError(502, '<html>Bad gateway</html>')).toBe('other')
    expect(classifyClaudeError(529, '')).toBe('overloaded')
    expect(classifyClaudeError(402, '')).toBe('credits')
  })

  it('treats only credit/key/switch failures as outages', () => {
    expect(['credits', 'auth', 'disabled'].every(isOutage)).toBe(true)
    expect(['rate_limit', 'overloaded', 'other'].some(isOutage)).toBe(false)
  })
})

describe('the on/off rule', () => {
  it('auto follows detection; on and waitlist override it', () => {
    expect(aiEnabledFrom(null)).toBe(true)
    expect(aiEnabledFrom({})).toBe(true)
    expect(aiEnabledFrom({ mode: 'auto', available: true })).toBe(true)
    expect(aiEnabledFrom({ mode: 'auto', available: false })).toBe(false)
    expect(aiEnabledFrom({ mode: 'on', available: false })).toBe(true)
    expect(aiEnabledFrom({ mode: 'waitlist', available: true })).toBe(false)
  })

  it('the SQL copy in the migration says the same thing', () => {
    const sql = read('supabase/migrations/20261122000001_ai_early_access.sql')
    const fn = sql.slice(sql.indexOf('FUNCTION public.ai_enabled_from'), sql.indexOf('$$;', sql.indexOf('FUNCTION public.ai_enabled_from')))
    expect(fn).toContain("WHEN p_value IS NULL THEN true")
    expect(fn).toContain("WHEN p_value->>'mode' = 'on' THEN true")
    expect(fn).toContain("WHEN p_value->>'mode' = 'waitlist' THEN false")
    expect(fn).toContain("ELSE COALESCE((p_value->>'available')::boolean, true)")
  })
})

describe('aiErrorBody', () => {
  it('maps each kind to a code the client knows, with no Anthropic text', () => {
    expect(aiErrorBody('credits')).toMatchObject({ status: 503, body: { code: 'ai_unavailable' } })
    expect(aiErrorBody('disabled')).toMatchObject({ status: 503, body: { code: 'ai_unavailable' } })
    expect(aiErrorBody('overloaded')).toMatchObject({ status: 503, body: { code: 'ai_busy', retryable: true } })
    expect(aiErrorBody('other')).toMatchObject({ status: 502, body: { code: 'ai_error' } })
    for (const k of ['credits', 'auth', 'rate_limit', 'overloaded', 'other', 'disabled']) {
      expect(JSON.stringify(aiErrorBody(k).body)).not.toMatch(/credit balance|x-api-key|invalid_request_error/)
    }
  })
})

describe('server gate and health reporting', () => {
  beforeEach(() => _resetAiStateCache())

  it('assertAiEnabled throws while off and passes while on', async () => {
    await expect(assertAiEnabled(fakeDb({ value: { mode: 'waitlist' } }))).rejects.toSatisfy(
      (e) => isAiUnavailableError(e) && e.kind === 'disabled')
    _resetAiStateCache()
    await expect(assertAiEnabled(fakeDb({ value: { mode: 'auto', available: true } }))).resolves.toBeUndefined()
  })

  it('fails open when the row cannot be read', async () => {
    await expect(assertAiEnabled(fakeDb({ readError: new Error('boom') }))).resolves.toBeUndefined()
  })

  it('caches the row, so a burst of calls reads it once', async () => {
    const db = fakeDb({ value: { mode: 'auto', available: true } })
    const spy = vi.spyOn(db, 'from')
    await readAiState(db); await readAiState(db); await readAiState(db)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('claudeFailure records a credit outage and keeps the raw body out of the error', async () => {
    const db = fakeDb()
    const err = await claudeFailure(new Response(BODIES.credits, { status: 400 }), db, 'test')
    expect(isAiUnavailableError(err)).toBe(true)
    expect(err.kind).toBe('credits')
    expect(err.message).toBe('AI_UNAVAILABLE')
    expect(db.calls).toEqual([['report_ai_health', { p_ok: false, p_reason: 'credits' }]])
  })

  it('claudeFailure does not flip the switch for a passing overload', async () => {
    const db = fakeDb()
    const err = await claudeFailure(new Response(BODIES.overloaded, { status: 529 }), db, 'test')
    expect(err.kind).toBe('overloaded')
    expect(db.calls).toEqual([])
  })

  it('noteAiSuccess writes only when the cached state says unavailable', async () => {
    const up = fakeDb({ value: { mode: 'auto', available: true } })
    await readAiState(up)
    await noteAiSuccess(up)
    expect(up.calls).toEqual([])

    _resetAiStateCache()
    const forcedOn = fakeDb({ value: { mode: 'on', available: false } })
    await readAiState(forcedOn)
    await noteAiSuccess(forcedOn)
    expect(forcedOn.calls).toEqual([['report_ai_health', { p_ok: true, p_reason: null }]])
  })
})

describe('the adopted functions', () => {
  const FUNCTIONS = [
    'analyze-business-signup', 'royal-ai-prompt', 'royal-ai-recommend', 'ai-support-agent',
    'generate-article', 'analyze-suggestion', 'blog-humanize',
  ]

  it.each(FUNCTIONS)('%s checks the status and no longer forwards Anthropic text', (fn) => {
    const src = read(`supabase/functions/${fn}/index.ts`)
    expect(src).toContain("from '../_shared/ai-status.ts'")
    expect(/assertAiEnabled\(|aiEnabledFrom\(/.test(src)).toBe(true)
    // The old shapes that put the Anthropic body into a response or a thrown message.
    expect(src).not.toMatch(/detail:\s*errorText/)
    expect(src).not.toMatch(/Claude API error: \$\{response\.status\} - \$\{error\}/)
    expect(src).not.toMatch(/I ran into an issue: \$\{msg\}/)
  })

  it('every function that calls Anthropic in the list turns a failed response into a typed error', () => {
    for (const fn of FUNCTIONS) {
      const src = read(`supabase/functions/${fn}/index.ts`)
      const okChecks = (src.match(/!\w*[rR]es(?:ponse)?\.ok\)/g) || []).length
      const typed = (src.match(/claudeFailure(?:Text)?\(/g) || []).length
      expect(typed, `${fn}: ${okChecks} ok-checks, ${typed} claudeFailure calls`).toBeGreaterThan(0)
    }
  })

  it('config.toml pins verify_jwt = false for the two new functions', () => {
    const toml = read('supabase/config.toml')
    expect(toml).toMatch(/\[functions\.ai-health\]\nverify_jwt = false/)
    expect(toml).toMatch(/\[functions\.ai-waitlist-notify\]\nverify_jwt = false/)
  })

  it('re-joining after an earlier outage re-arms the email', () => {
    const sql = read('supabase/migrations/20261122000001_ai_early_access.sql')
    expect(sql).toMatch(/ON CONFLICT \(org_id\) DO UPDATE\s+SET notified_at = NULL[^;]*WHERE ai_waitlist\.notified_at IS NOT NULL;/)
  })

  it('the migration keeps platform_status and ai_waitlist away from client roles', () => {
    const sql = read('supabase/migrations/20261122000001_ai_early_access.sql')
    expect(sql).toContain('REVOKE ALL ON public.platform_status FROM anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON public.ai_waitlist FROM anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.report_ai_health(BOOLEAN, TEXT) TO service_role;')
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(report_ai_health|claim_ai_probe)[^;]*(anon|authenticated)/)
  })
})

describe('the "Royal AI is on" email', () => {
  it('names the business and escapes it', () => {
    const tpl = waitlistEmail('<b>Bean</b> & Co', 'Ana')
    expect(tpl.subject).toBe('Royal AI is on for <b>Bean</b> & Co')
    expect(tpl.html).toContain('&lt;b&gt;Bean&lt;/b&gt; &amp; Co')
    expect(tpl.html).not.toContain('<b>Bean</b>')
    expect(tpl.html).toContain('Hi Ana')
    expect(tpl.html).toContain('https://royaltyapp.ai/app/intelligence.html')
  })

  it('reads well without a name', () => {
    const tpl = waitlistEmail('', '')
    expect(tpl.subject).toBe('Royal AI is on for your business')
    expect(tpl.html).not.toContain('Hi ,')
  })
})

describe('js/ai-status.js', () => {
  function load({ fetchImpl, db } = {}) {
    const store = new Map()
    const ctx = {
      window: {},
      console,
      setTimeout, clearTimeout, Promise, JSON, Date,
      sessionStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ enabled: true }) })),
      document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
    }
    if (db) ctx.db = db
    vm.createContext(ctx)
    vm.runInContext(read('js/ai-status.js'), ctx, { filename: 'js/ai-status.js' })
    return { AiStatus: ctx.window.AiStatus, store }
  }

  it('reads the status once and caches it', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ enabled: false }) }))
    const { AiStatus } = load({ fetchImpl })
    expect(await AiStatus.get()).toEqual({ enabled: false, onWaitlist: false })
    expect(await AiStatus.get()).toEqual({ enabled: false, onWaitlist: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(AiStatus.peek()).toEqual({ enabled: false, onWaitlist: false })
  })

  it('fails open and does not cache a failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    const { AiStatus } = load({ fetchImpl })
    expect(await AiStatus.get()).toEqual({ enabled: true, onWaitlist: false })
    expect(AiStatus.peek()).toBeNull()
    await AiStatus.get()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails open on a non-200 answer', async () => {
    const { AiStatus } = load({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) })
    expect((await AiStatus.get()).enabled).toBe(true)
  })

  it('uses the signed-in client on /app pages and joins the list while off', async () => {
    const rpc = vi.fn(async (fn) => fn === 'get_ai_status'
      ? { data: { enabled: false, on_waitlist: false }, error: null }
      : { data: { joined: true }, error: null })
    const { AiStatus } = load({ db: { rpc }, fetchImpl: async () => { throw new Error('should use db') } })
    expect(await AiStatus.ensureWaitlisted('signup')).toBe(true)
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['get_ai_status', 'join_ai_waitlist'])
    // Second time: already on the list, no second join.
    expect(await AiStatus.ensureWaitlisted('app')).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('does not reuse another account\'s cached answer in the same tab', async () => {
    let user = 'user-a'
    const rpc = vi.fn(async (fn) => fn === 'get_ai_status'
      ? { data: { enabled: false, on_waitlist: user === 'user-a' }, error: null }
      : { data: { joined: true }, error: null })
    const auth = { getSession: async () => ({ data: { session: { user: { id: user } } } }) }
    const { AiStatus } = load({ db: { rpc, auth } })
    expect(await AiStatus.get()).toEqual({ enabled: false, onWaitlist: true })
    user = 'user-b'
    expect(await AiStatus.get()).toEqual({ enabled: false, onWaitlist: false })
    expect(await AiStatus.ensureWaitlisted('signup')).toBe(true)
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['get_ai_status', 'get_ai_status', 'join_ai_waitlist'])
  })

  it('does not join while Royal AI is on', async () => {
    const rpc = vi.fn(async () => ({ data: { enabled: true }, error: null }))
    const { AiStatus } = load({ db: { rpc } })
    expect(await AiStatus.ensureWaitlisted()).toBe(false)
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['get_ai_status'])
  })

  it('recognises the server answer and remembers it', async () => {
    const { AiStatus } = load()
    expect(AiStatus.isUnavailable({ code: 'ai_unavailable' })).toBe(true)
    expect(AiStatus.isUnavailable({ code: 'ai_busy' })).toBe(false)
    expect(AiStatus.isUnavailable(null)).toBe(false)
    AiStatus.markUnavailable()
    expect(AiStatus.peek().enabled).toBe(false)
  })

  it('reads the JSON body of a supabase-js FunctionsHttpError', async () => {
    const { AiStatus } = load()
    const err = { context: new Response(JSON.stringify({ code: 'ai_unavailable' }), { status: 503 }) }
    expect(AiStatus.isUnavailable(await AiStatus.errorBody(err))).toBe(true)
    expect(await AiStatus.errorBody(new Error('network'))).toBeNull()
  })

  it('the card and chat reply say early access, not error', () => {
    const { AiStatus } = load()
    expect(AiStatus.cardHtml()).toContain('Royal AI is in early access')
    expect(AiStatus.message()).toMatch(/early access/)
    expect(AiStatus.message()).not.toMatch(/error|went wrong/i)
  })
})
