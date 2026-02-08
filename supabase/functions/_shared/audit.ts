/**
 * Enhanced Audit Logging Utilities
 * Phase 7: Security Hardening
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { detectPII } from './validation.ts';

export interface AuditLogEntry {
  organization_id: string;
  user_id?: string;
  action_category: 'tool_use' | 'knowledge' | 'research' | 'autonomous' | 'queue' | 'auth' | 'error';
  action_type: string;
  action_input?: Record<string, unknown>;
  action_result?: Record<string, unknown>;
  status: 'success' | 'failure' | 'rate_limited' | 'rejected' | 'timeout';
  error_message?: string;
  duration_ms?: number;
  thread_id?: string;
  prompt_id?: string;
  action_queue_id?: string;
  confidence_score?: number;
  auto_executed?: boolean;
  pii_detected?: boolean;
  data_accessed?: string[];
}

// Sanitize audit input to remove sensitive data
function sanitizeAuditInput(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;

  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000) + '...[truncated]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditInput(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Create an audit log entry
export async function createAuditLog(
  supabase: SupabaseClient,
  entry: AuditLogEntry
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check for PII in action input
    let piiDetected = entry.pii_detected ?? false;
    if (entry.action_input) {
      const inputStr = JSON.stringify(entry.action_input);
      const piiCheck = detectPII(inputStr);
      if (piiCheck.hasPII) {
        piiDetected = true;
      }
    }

    const { error } = await supabase.from('ai_audit_log').insert({
      organization_id: entry.organization_id,
      user_id: entry.user_id,
      action_category: entry.action_category,
      action_type: entry.action_type,
      action_input: sanitizeAuditInput(entry.action_input),
      action_result: sanitizeAuditInput(entry.action_result),
      status: entry.status,
      error_message: entry.error_message,
      duration_ms: entry.duration_ms,
      thread_id: entry.thread_id,
      prompt_id: entry.prompt_id,
      action_queue_id: entry.action_queue_id,
      confidence_score: entry.confidence_score,
      auto_executed: entry.auto_executed,
      pii_detected: piiDetected,
      data_accessed: entry.data_accessed
    });

    if (error) {
      console.error('Audit log error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Audit log exception:', err);
    return { success: false, error: String(err) };
  }
}

// Batch audit logger for multiple entries
export async function createAuditLogBatch(
  supabase: SupabaseClient,
  entries: AuditLogEntry[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const processedEntries = entries.map(entry => ({
      ...entry,
      action_input: sanitizeAuditInput(entry.action_input),
      action_result: sanitizeAuditInput(entry.action_result),
      pii_detected: entry.pii_detected ??
        (entry.action_input ? detectPII(JSON.stringify(entry.action_input)).hasPII : false)
    }));

    const { error } = await supabase.from('ai_audit_log').insert(processedEntries);

    if (error) {
      console.error('Batch audit log error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Batch audit log exception:', err);
    return { success: false, error: String(err) };
  }
}

// Timed operation wrapper with automatic audit logging
export async function withAuditLog<T>(
  supabase: SupabaseClient,
  baseEntry: Omit<AuditLogEntry, 'status' | 'duration_ms' | 'error_message'>,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await operation();
    const duration = Date.now() - startTime;

    await createAuditLog(supabase, {
      ...baseEntry,
      status: 'success',
      duration_ms: duration,
      action_result: typeof result === 'object' ? result as Record<string, unknown> : { result }
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    await createAuditLog(supabase, {
      ...baseEntry,
      status: 'failure',
      duration_ms: duration,
      error_message: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
}

// Get audit summary for compliance reporting
export async function getAuditSummary(
  supabase: SupabaseClient,
  orgId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  total_actions: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  pii_incidents: number;
  auto_executed: number;
}> {
  const { data, error } = await supabase
    .from('ai_audit_log')
    .select('action_category, status, pii_detected, auto_executed')
    .eq('organization_id', orgId)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  if (error || !data) {
    return {
      total_actions: 0,
      by_category: {},
      by_status: {},
      pii_incidents: 0,
      auto_executed: 0
    };
  }

  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let piiIncidents = 0;
  let autoExecuted = 0;

  for (const row of data) {
    byCategory[row.action_category] = (byCategory[row.action_category] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.pii_detected) piiIncidents++;
    if (row.auto_executed) autoExecuted++;
  }

  return {
    total_actions: data.length,
    by_category: byCategory,
    by_status: byStatus,
    pii_incidents: piiIncidents,
    auto_executed: autoExecuted
  };
}
