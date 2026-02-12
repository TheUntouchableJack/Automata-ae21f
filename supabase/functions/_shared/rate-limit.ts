/**
 * Rate Limiting Utilities
 * Phase 7: Security Hardening
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export interface RateLimitConfig {
  windowMinutes: number;
  maxAllowed: number;
}

export interface RateLimitResult {
  allowed: boolean;
  current_count: number;
  max_allowed: number;
  window_start: string;
  resets_at: string;
  retry_after_seconds?: number;
}

// Default rate limits by action type
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  // Read tools - more permissive
  read_customers: { windowMinutes: 60, maxAllowed: 100 },
  read_activity: { windowMinutes: 60, maxAllowed: 100 },
  read_automations: { windowMinutes: 60, maxAllowed: 50 },
  read_business_profile: { windowMinutes: 60, maxAllowed: 50 },
  read_knowledge: { windowMinutes: 60, maxAllowed: 100 },

  // Research tools - moderate
  search_competitors: { windowMinutes: 60, maxAllowed: 20 },
  search_regulations: { windowMinutes: 60, maxAllowed: 20 },
  search_market_trends: { windowMinutes: 60, maxAllowed: 20 },
  search_benchmarks: { windowMinutes: 60, maxAllowed: 20 },

  // Write tools - more restrictive
  create_announcement: { windowMinutes: 60, maxAllowed: 10 },
  send_targeted_message: { windowMinutes: 60, maxAllowed: 10 },
  create_flash_promotion: { windowMinutes: 60, maxAllowed: 5 },
  award_bonus_points: { windowMinutes: 60, maxAllowed: 20 },
  enable_automation: { windowMinutes: 60, maxAllowed: 10 },
  save_knowledge: { windowMinutes: 60, maxAllowed: 50 },

  // Global limits
  ai_prompt: { windowMinutes: 60, maxAllowed: 60 },
  autonomous_action: { windowMinutes: 1440, maxAllowed: 100 } // per day
};

// Check rate limit using database function
export async function checkRateLimit(
  supabase: SupabaseClient,
  orgId: string,
  actionType: string,
  customConfig?: RateLimitConfig
): Promise<RateLimitResult> {
  const config = customConfig ?? DEFAULT_LIMITS[actionType] ?? { windowMinutes: 60, maxAllowed: 10 };

  try {
    const { data, error } = await supabase.rpc('check_ai_rate_limit', {
      p_org_id: orgId,
      p_action_type: actionType,
      p_window_minutes: config.windowMinutes,
      p_max_allowed: config.maxAllowed
    });

    if (error) {
      console.error('Rate limit check error:', error);
      // Fail closed on error - block the request to prevent abuse during outages
      return {
        allowed: false,
        current_count: 0,
        max_allowed: config.maxAllowed,
        window_start: new Date().toISOString(),
        resets_at: new Date(Date.now() + config.windowMinutes * 60000).toISOString(),
        retry_after_seconds: 60
      };
    }

    const result = data as RateLimitResult;

    // Calculate retry-after if rate limited
    if (!result.allowed) {
      const resetsAt = new Date(result.resets_at);
      const retryAfter = Math.ceil((resetsAt.getTime() - Date.now()) / 1000);
      result.retry_after_seconds = Math.max(0, retryAfter);
    }

    return result;
  } catch (err) {
    console.error('Rate limit exception:', err);
    // Fail closed on exception - block the request to prevent abuse
    return {
      allowed: false,
      current_count: 0,
      max_allowed: config.maxAllowed,
      window_start: new Date().toISOString(),
      resets_at: new Date(Date.now() + config.windowMinutes * 60000).toISOString(),
      retry_after_seconds: 60
    };
  }
}

// Check multiple rate limits at once (for composite operations)
export async function checkMultipleRateLimits(
  supabase: SupabaseClient,
  orgId: string,
  actionTypes: string[]
): Promise<{ allowed: boolean; blockedBy?: string; results: Record<string, RateLimitResult> }> {
  const results: Record<string, RateLimitResult> = {};

  for (const actionType of actionTypes) {
    const result = await checkRateLimit(supabase, orgId, actionType);
    results[actionType] = result;

    if (!result.allowed) {
      return { allowed: false, blockedBy: actionType, results };
    }
  }

  return { allowed: true, results };
}

// Get current rate limit status for all action types
export async function getRateLimitStatus(
  supabase: SupabaseClient,
  orgId: string
): Promise<Record<string, { current: number; max: number; resets_at: string }>> {
  const { data, error } = await supabase
    .from('ai_rate_limits')
    .select('action_type, count, max_allowed, window_start')
    .eq('organization_id', orgId)
    .gte('window_start', new Date(Date.now() - 86400000).toISOString()); // Last 24h

  if (error || !data) {
    return {};
  }

  const status: Record<string, { current: number; max: number; resets_at: string }> = {};

  for (const row of data) {
    const config = DEFAULT_LIMITS[row.action_type] ?? { windowMinutes: 60, maxAllowed: 10 };
    const windowStart = new Date(row.window_start);
    const resetsAt = new Date(windowStart.getTime() + config.windowMinutes * 60000);

    // Only include if not expired
    if (resetsAt > new Date()) {
      status[row.action_type] = {
        current: row.count,
        max: row.max_allowed,
        resets_at: resetsAt.toISOString()
      };
    }
  }

  return status;
}

// Clean up old rate limit entries (call periodically)
export async function cleanupRateLimits(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - 86400000 * 7); // 7 days

  const { data, error } = await supabase
    .from('ai_rate_limits')
    .delete()
    .lt('window_start', cutoff.toISOString())
    .select('action_type');

  if (error) {
    console.error('Rate limit cleanup error:', error);
    return 0;
  }

  return data?.length ?? 0;
}

// Generate rate limit headers for HTTP response
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.max_allowed),
    'X-RateLimit-Remaining': String(Math.max(0, result.max_allowed - result.current_count)),
    'X-RateLimit-Reset': result.resets_at
  };

  if (!result.allowed && result.retry_after_seconds !== undefined) {
    headers['Retry-After'] = String(result.retry_after_seconds);
  }

  return headers;
}
