// Shared churn scorer — extracted from royalty-self-growth
// Computes churn risk score (0-100) for all organizations nightly

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function computeChurnScores(
  supabase: SupabaseClient,
  log: (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void
): Promise<{ scored: number; highRisk: number }> {
  const stats = { scored: 0, highRisk: 0 }

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, plan_type, last_active_at, subscription_cancel_at, payment_failure_count')
    .limit(500)

  if (!orgs || orgs.length === 0) return stats

  const orgIds = orgs.map(o => o.id)

  // Batch-fetch: customer apps per org
  const { data: appCounts } = await supabase
    .from('customer_apps')
    .select('organization_id')
    .in('organization_id', orgIds)

  const orgHasApp = new Set((appCounts || []).map(a => a.organization_id))

  // Batch-fetch: active automations per org
  const { data: automationCounts } = await supabase
    .from('automation_definitions')
    .select('organization_id')
    .in('organization_id', orgIds)
    .eq('is_enabled', true)

  const orgHasAutomation = new Set((automationCounts || []).map(a => a.organization_id))

  // Batch-fetch: app members per org
  const { data: memberCounts } = await supabase
    .from('customer_apps')
    .select('organization_id, app_members(id)')
    .in('organization_id', orgIds)

  const orgHasCustomers = new Set<string>()
  for (const app of (memberCounts || [])) {
    if (app.app_members && app.app_members.length > 0) {
      orgHasCustomers.add(app.organization_id)
    }
  }

  const updates: Array<{ id: string; score: number }> = []

  for (const org of orgs) {
    let score = 0

    // Days since last active (30% weight, max 30 points)
    if (org.last_active_at) {
      const daysSince = Math.floor((Date.now() - new Date(org.last_active_at).getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince >= 14) score += 30
      else if (daysSince >= 7) score += 20
      else if (daysSince >= 3) score += 10
    } else {
      score += 15
    }

    if (!orgHasApp.has(org.id)) score += 20
    if (!orgHasCustomers.has(org.id)) score += 15
    if (!orgHasAutomation.has(org.id)) score += 15
    if ((org.payment_failure_count || 0) > 0) score += 10
    if (org.subscription_cancel_at) score += 10

    updates.push({ id: org.id, score })
    stats.scored++
    if (score >= 70) stats.highRisk++
  }

  for (const u of updates) {
    await supabase
      .from('organizations')
      .update({
        churn_risk_score: u.score,
        churn_risk_updated_at: new Date().toISOString()
      })
      .eq('id', u.id)
  }

  log('info', 'Churn scoring complete', { scored: stats.scored, highRisk: stats.highRisk })
  return stats
}
