// Shared milestone checker — extracted from royalty-self-growth
// Checks org milestones (first customer, 10/50 customers, first redemption, testimonial)
// Uses get_org_customer_metrics RPC to avoid duplicate queries

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface MilestoneResult {
  hit: boolean
  metadata?: Record<string, unknown>
}

interface MilestoneDefinition {
  key: string
  template: string
  check: (orgId: string, supabase: SupabaseClient) => Promise<MilestoneResult>
}

async function getMetrics(supabase: SupabaseClient, orgId: string): Promise<{ appId: string | null; memberCount: number; redemptionCount: number }> {
  const { data } = await supabase.rpc('get_org_customer_metrics', { p_org_id: orgId })
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { appId: null, memberCount: 0, redemptionCount: 0 }
  return {
    appId: row.app_id,
    memberCount: Number(row.member_count) || 0,
    redemptionCount: Number(row.redemption_count) || 0
  }
}

export const MILESTONES: MilestoneDefinition[] = [
  {
    key: 'testimonial_100',
    template: 'testimonial_request',
    check: async (orgId, supabase) => {
      const m = await getMetrics(supabase, orgId)
      if (m.memberCount < 100) return { hit: false }
      await supabase.from('smb_testimonials').insert({
        organization_id: orgId,
        metrics: { member_count: m.memberCount },
        status: 'requested'
      }).then(() => {}).catch(() => {})
      return { hit: true, metadata: { memberCount: m.memberCount } }
    }
  },
  {
    key: 'first_customer',
    template: 'milestone_first_customer',
    check: async (orgId, supabase) => {
      const m = await getMetrics(supabase, orgId)
      return { hit: m.memberCount >= 1, metadata: { count: m.memberCount } }
    }
  },
  {
    key: '10_customers',
    template: 'milestone_10_customers',
    check: async (orgId, supabase) => {
      const m = await getMetrics(supabase, orgId)
      return { hit: m.memberCount >= 10, metadata: { count: m.memberCount } }
    }
  },
  {
    key: '50_customers',
    template: 'milestone_50_customers',
    check: async (orgId, supabase) => {
      const m = await getMetrics(supabase, orgId)
      return { hit: m.memberCount >= 50, metadata: { count: m.memberCount } }
    }
  },
  {
    key: 'first_redemption',
    template: 'milestone_first_redemption',
    check: async (orgId, supabase) => {
      const m = await getMetrics(supabase, orgId)
      return { hit: m.redemptionCount >= 1, metadata: { count: m.redemptionCount } }
    }
  },
]

export async function checkMilestones(
  supabase: SupabaseClient,
  isPaused: boolean,
  log: (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void
): Promise<number> {
  let notified = 0

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id')
    .limit(500)

  if (!orgs || orgs.length === 0) return 0

  const orgIds = orgs.map(o => o.id)
  const { data: existing } = await supabase
    .from('smb_milestones')
    .select('organization_id, milestone_key')
    .in('organization_id', orgIds)

  const notifiedSet = new Set((existing || []).map(e => `${e.organization_id}::${e.milestone_key}`))

  for (const org of orgs) {
    for (const milestone of MILESTONES) {
      const cacheKey = `${org.id}::${milestone.key}`
      if (notifiedSet.has(cacheKey)) continue

      const result = await milestone.check(org.id, supabase)
      if (!result.hit) continue

      const { error: insertError } = await supabase.from('smb_milestones').insert({
        organization_id: org.id,
        milestone_key: milestone.key,
        metadata: result.metadata || {}
      })

      if (insertError) continue

      // Get owner contact via RPC
      const { data: ownerData } = await supabase.rpc('get_org_owner_contact', { p_org_id: org.id })
      const owner = Array.isArray(ownerData) ? ownerData[0] : ownerData
      if (!owner?.email) continue

      if (isPaused) {
        await supabase.from('self_growth_log').insert({
          action_type: 'milestone_planned',
          description: `Would notify ${owner.email}: milestone "${milestone.key}"`,
          status: 'pending_approval',
          metadata: { org_id: org.id, milestone: milestone.key }
        })
        continue
      }

      const fnUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

      try {
        await fetch(`${fnUrl}/functions/v1/smb-lifecycle-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            type: milestone.template,
            email: owner.email,
            first_name: owner.first_name || '',
            user_id: owner.user_id,
          }),
        })
        notified++
        log('info', `Milestone "${milestone.key}" notified for org ${org.id}`)
      } catch (err) {
        log('error', `Milestone notification failed`, { error: String(err), org: org.id, milestone: milestone.key })
      }
    }
  }

  return notified
}
