// Shared business-knowledge loaders + prompt section builder
// -----------------------------------------------------------
// Single source of truth for reading `business_knowledge` / `business_profiles`
// and rendering the "## What I Know About This Business" context block.
//
// Extracted from royal-ai-prompt/knowledge.ts so customer-facing generators
// (generate-article) and the suggestion analyzer (analyze-suggestion) reuse the
// exact same shapes and formatting instead of maintaining narrower local copies.
//
// ⚠️ Keep the literal marker `## What I Know About This Business` unchanged —
// royal-ai-prompt/knowledge.ts:truncateSystemPrompt() matches on it to trim
// oversized prompts.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sortByImportance } from './knowledge-sort.ts'

// Superset shapes — every importer's fields are a subset of these.
export interface BusinessKnowledge {
  id: string
  layer: string
  category: string
  fact: string
  confidence: number
  importance: 'critical' | 'high' | 'medium' | 'low' | string
  source_type: 'conversation' | 'research' | 'integration' | 'inferred' | string
  created_at?: string
}

export interface BusinessProfile {
  organization_id?: string
  business_type?: string
  business_subtype?: string
  revenue_model?: string
  primary_revenue_streams?: unknown
  avg_ticket?: number
  gross_margin_pct?: number
  food_cost_pct?: number
  labor_cost_pct?: number
  rent_pct?: number
  break_even_daily?: number
  price_positioning?: string
  primary_competitors?: unknown
  competitive_advantage?: string
  unique_selling_points?: unknown
  current_stage?: string
  growth_goals?: unknown
  expansion_interest?: string
  biggest_challenge?: string
  success_vision?: string
  location_type?: string
  foot_traffic_level?: string
  parking_situation?: string
  nearby_anchors?: unknown
  peak_hours?: unknown
  slow_periods?: unknown
  staff_count?: number
  owner_hours_weekly?: number
  ideal_customer_description?: string
  primary_age_range?: string
  customer_frequency?: string
  profile_completeness?: number
}

// Load accumulated business knowledge for an organization.
// NOTE: importance is a TEXT column — a SQL `ORDER BY importance` sorts
// alphabetically (medium > low > high > critical). Over-fetch, then sort
// by true rank in TS. See knowledge-sort.ts.
export async function loadBusinessKnowledge(
  supabase: SupabaseClient,
  organizationId: string,
  limit = 30
): Promise<BusinessKnowledge[]> {
  try {
    const { data, error } = await supabase
      .from('business_knowledge')
      .select('id, layer, category, fact, confidence, importance, source_type, created_at')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Failed to load business knowledge:', error)
      return []
    }
    return sortByImportance(data || []).slice(0, limit)
  } catch (e) {
    console.error('Error loading knowledge:', e)
    return []
  }
}

// Load business profile for an organization.
export async function loadBusinessProfile(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BusinessProfile | null> {
  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('organization_id, business_type, business_subtype, revenue_model, primary_revenue_streams, avg_ticket, gross_margin_pct, food_cost_pct, labor_cost_pct, rent_pct, break_even_daily, price_positioning, primary_competitors, competitive_advantage, unique_selling_points, current_stage, growth_goals, expansion_interest, biggest_challenge, success_vision, location_type, foot_traffic_level, parking_situation, nearby_anchors, peak_hours, slow_periods, staff_count, owner_hours_weekly, ideal_customer_description, primary_age_range, customer_frequency, profile_completeness')
      .eq('organization_id', organizationId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('Failed to load business profile:', error)
    }
    return data || null
  } catch (e) {
    console.error('Error loading profile:', e)
    return null
  }
}

// Build knowledge context section for a prompt.
// ⚠️ The literal marker `## What I Know About This Business` is depended upon by
// royal-ai-prompt/knowledge.ts:truncateSystemPrompt() — do not change it.
export function buildKnowledgeContextSection(
  knowledge: BusinessKnowledge[],
  profile: BusinessProfile | null
): string {
  if (knowledge.length === 0 && !profile) return ''

  const lines: string[] = ['', '## What I Know About This Business']

  // Add profile info
  if (profile) {
    if (profile.business_type) lines.push(`- Business Type: ${profile.business_type}`)
    if (profile.avg_ticket) lines.push(`- Average Transaction: $${profile.avg_ticket}`)
    if (profile.gross_margin_pct) lines.push(`- Gross Margin: ${profile.gross_margin_pct}%`)
    if (profile.food_cost_pct) lines.push(`- Food Cost: ${profile.food_cost_pct}%`)
    if (profile.labor_cost_pct) lines.push(`- Labor Cost: ${profile.labor_cost_pct}%`)
    if (profile.price_positioning) lines.push(`- Price Position: ${profile.price_positioning}`)
    if (profile.current_stage) lines.push(`- Business Stage: ${profile.current_stage}`)
    if (profile.biggest_challenge) lines.push(`- Current Challenge: ${profile.biggest_challenge}`)
    if (profile.competitive_advantage) lines.push(`- Competitive Edge: ${profile.competitive_advantage}`)
    if (profile.ideal_customer_description) lines.push(`- Ideal Customer: ${profile.ideal_customer_description}`)
    if (profile.primary_age_range) lines.push(`- Customer Age Range: ${profile.primary_age_range}`)
  }

  // Group knowledge by layer
  const byLayer: Record<string, BusinessKnowledge[]> = {}
  for (const k of knowledge) {
    if (!byLayer[k.layer]) byLayer[k.layer] = []
    byLayer[k.layer].push(k)
  }

  // Add learned facts (avoiding duplicates with profile)
  const addedFacts = new Set<string>()
  for (const [layer, facts] of Object.entries(byLayer)) {
    const layerLabel = layer.charAt(0).toUpperCase() + layer.slice(1)
    for (const fact of facts.slice(0, 3)) {
      const factKey = `${fact.category}:${fact.fact.slice(0, 50)}`
      if (!addedFacts.has(factKey)) {
        lines.push(`- [${layerLabel}] ${fact.fact}`)
        addedFacts.add(factKey)
      }
    }
  }

  if (lines.length <= 1) return ''
  return lines.join('\n')
}
