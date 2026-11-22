// Shared Claude request helpers for the Sonnet-tier functions
// (royal-ai-prompt, ai-support-agent, ai-owner-assistant, generate-article).
//
// Why this file exists: claude-sonnet-4-20250514 was retired on 2026-06-15 and all four
// functions pinned it separately, so every one of them returned 404 from that day on.
// The model ID now lives here once.

export const MODEL_SONNET = 'claude-sonnet-5-5'
export const MODEL_SONNET_DISPLAY_NAME = 'Sonnet 5.5'

// Server-side fallback: on a safety-classifier decline the API retries the same request on
// another model inside the same call, instead of failing it.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export type Effort = 'low' | 'medium' | 'high'

/** Request-body fields Claude Sonnet 5.5 needs. Sonnet 5.5 recalibrated its effort levels, so
 *  the level is set explicitly; `fallbacks` opts into the server-side fallback. Any other model
 *  (Haiku 4.5) gets nothing, because it rejects both fields. */
export function sonnetExtras(modelId: string, effort: Effort): Record<string, unknown> {
  if (modelId !== MODEL_SONNET) return {}
  return { output_config: { effort }, fallbacks: 'default' }
}

/** Headers for POST /v1/messages. Adds the fallback beta for Sonnet 5.5 requests. */
export function anthropicHeaders(apiKey: string, modelId: string, betas: string[] = []): Record<string, string> {
  const all = modelId === MODEL_SONNET ? [...betas, FALLBACK_BETA] : betas
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
  if (all.length) headers['anthropic-beta'] = all.join(',')
  return headers
}

// Thinking counts toward max_tokens, so Sonnet 5.5 calls get extra room on top of the reply
// budget they had on Sonnet 4. Output is billed by what is produced, not by the cap.
export const THINKING_HEADROOM = 2000

// deno-lint-ignore no-explicit-any
type MessagesResponse = { stop_reason?: string; content?: any[] }

/** The reply text of a Messages API response, read by block type. Sonnet 5.5 can put a
 *  thinking block first, so `content[0].text` is undefined there. Throws on a refusal, which
 *  arrives as HTTP 200 with an empty or partial `content`. */
export function responseText(data: MessagesResponse): string {
  if (data?.stop_reason === 'refusal') throw new Error('CLAUDE_REFUSAL')
  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim()
}
