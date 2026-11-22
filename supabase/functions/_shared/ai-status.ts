// Royal AI availability: classify Anthropic failures, record outages, and gate Claude calls
// while Royal AI is off ("early access").
//
// State lives in one row, platform_status.key = 'ai' (migration 20261122000001):
//   { mode: 'auto' | 'on' | 'waitlist', available: bool, reason, since, last_probe_at, notify_daily_cap }
//   mode 'auto'     → Royal AI is on while `available` is true. A credit or key failure sets it false;
//                      the ai-health function (pg_cron, every 15 min) probes and sets it back.
//   mode 'on'       → always on, whatever `available` says.
//   mode 'waitlist' → always off (Jay's spend switch). Nothing calls Claude.
//
// This file imports nothing, so vitest can load it directly (tests/edge-functions/ai-status.test.js).

export type AiFailureKind = 'credits' | 'auth' | 'rate_limit' | 'overloaded' | 'other' | 'disabled'

/** Kinds that last until a person acts (a top-up, a new key). They switch Royal AI to early access. */
export function isOutage(kind: AiFailureKind): boolean {
  return kind === 'credits' || kind === 'auth' || kind === 'disabled'
}

/** Sort a failed Anthropic response by cause. `body` is the raw response text. */
export function classifyClaudeError(status: number, body: string): AiFailureKind {
  let type = ''
  let message = ''
  try {
    const parsed = JSON.parse(body)
    type = String(parsed?.error?.type || '')
    message = String(parsed?.error?.message || '')
  } catch {
    message = String(body || '')
  }
  const m = message.toLowerCase()

  // "Your credit balance is too low to access the Anthropic API…" arrives as 400 invalid_request_error;
  // a workspace spend cap ("You have reached your specified API usage limits…") the same way.
  if (status === 402 || type === 'billing_error' || m.includes('credit balance') || m.includes('usage limits')) {
    return 'credits'
  }
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') {
    return 'auth'
  }
  if (status === 429 || type === 'rate_limit_error') return 'rate_limit'
  if (status === 529 || status === 503 || type === 'overloaded_error') return 'overloaded'
  return 'other'
}

export class AiUnavailableError extends Error {
  kind: AiFailureKind
  constructor(kind: AiFailureKind) {
    super('AI_UNAVAILABLE')
    this.name = 'AiUnavailableError'
    this.kind = kind
  }
}

export function isAiUnavailableError(e: unknown): e is AiUnavailableError {
  return e instanceof Error && e.name === 'AiUnavailableError'
}

export type AiStateValue = {
  mode?: string
  available?: boolean
  reason?: string | null
  since?: string | null
  notify_daily_cap?: number
}

/** The on/off rule. get_ai_status() in SQL applies the same rule; keep them identical. */
export function aiEnabledFrom(value: AiStateValue | null | undefined): boolean {
  if (!value) return true
  if (value.mode === 'on') return true
  if (value.mode === 'waitlist') return false
  return value.available !== false
}

// Minimal shape of the supabase-js client this file uses, so it needs no import.
// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any }

const STATE_TTL_MS = 30_000
let cached: { at: number; value: AiStateValue | null } | null = null

/** The 'ai' row, cached for 30 s per isolate. Fails open: a read error means "on", today's behaviour. */
export async function readAiState(db: Db, opts: { fresh?: boolean } = {}): Promise<AiStateValue | null> {
  if (!opts.fresh && cached && Date.now() - cached.at < STATE_TTL_MS) return cached.value
  try {
    const { data, error } = await db.from('platform_status').select('value').eq('key', 'ai').maybeSingle()
    if (error) throw error
    cached = { at: Date.now(), value: (data?.value as AiStateValue) ?? null }
  } catch (e) {
    console.warn('ai-status: could not read platform_status, treating Royal AI as on', e)
    cached = { at: Date.now(), value: null }
  }
  return cached.value
}

/** Tests only: forget the cached row. */
export function _resetAiStateCache(): void {
  cached = null
}

/** Throws AiUnavailableError('disabled') while Royal AI is off, so no Claude call is made. */
export async function assertAiEnabled(db: Db): Promise<void> {
  const value = await readAiState(db)
  if (!aiEnabledFrom(value)) throw new AiUnavailableError('disabled')
}

/** Record a health change. The SQL function only writes when the state actually changes.
 *  Returns false when the call itself failed (the state may be unchanged). */
export async function reportAiHealth(db: Db, ok: boolean, reason: AiFailureKind | null): Promise<boolean> {
  try {
    const { error } = await db.rpc('report_ai_health', { p_ok: ok, p_reason: reason })
    if (error) throw error
    const prev = cached?.value ?? {}
    cached = {
      at: Date.now(),
      value: ok ? { ...prev, available: true, reason: null } : { ...prev, available: false, reason },
    }
    return true
  } catch (e) {
    console.error('ai-status: report_ai_health failed', e)
    return false
  }
}

/** Call after a successful Claude response. Writes only when the cached state says unavailable
 *  (mode 'on' while auto-detection had it off), so the normal path costs nothing. */
export async function noteAiSuccess(db: Db): Promise<void> {
  if (cached?.value && cached.value.available === false) await reportAiHealth(db, true, null)
}

/** Read a failed Anthropic response, record an outage, and return the error to throw.
 *  The raw Anthropic text goes to the function log only, never to the caller. */
export async function claudeFailure(response: Response, db: Db | null, where: string): Promise<AiUnavailableError> {
  const body = await response.text().catch(() => '')
  return claudeFailureText(response.status, body, db, where)
}

/** claudeFailure for a caller that has already read the body. */
export async function claudeFailureText(status: number, body: string, db: Db | null, where: string): Promise<AiUnavailableError> {
  const kind = classifyClaudeError(status, body)
  console.error(`${where}: Claude API error`, status, kind, String(body || '').slice(0, 500))
  if (db && isOutage(kind)) await reportAiHealth(db, false, kind)
  return new AiUnavailableError(kind)
}

/** The response every AI function returns when Claude can't answer. No Anthropic text in it.
 *  code 'ai_unavailable' → the client shows the early-access card;
 *  code 'ai_busy'        → a passing overload or rate limit: "try again in a minute";
 *  code 'ai_error'       → anything else. */
export function aiErrorBody(kind: AiFailureKind): { status: number; body: Record<string, unknown> } {
  if (isOutage(kind)) {
    return {
      status: 503,
      body: { success: false, code: 'ai_unavailable', error: 'Royal AI is in early access. Your loyalty app works as normal.' },
    }
  }
  if (kind === 'rate_limit' || kind === 'overloaded') {
    return { status: 503, body: { success: false, code: 'ai_busy', retryable: true, error: 'Royal AI is busy. Try again in a minute.' } }
  }
  return { status: 502, body: { success: false, code: 'ai_error', error: 'Royal AI could not answer that. Try again.' } }
}

export function aiErrorResponse(kind: AiFailureKind, headers: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  const { status, body } = aiErrorBody(kind)
  return new Response(JSON.stringify({ ...body, ...extra }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
