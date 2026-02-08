// Shared Web Search Utility
// Provides cached web search via Serper API (or stub when not configured)

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  title: string
  link: string
  snippet: string
  position: number
}

export interface SearchResponse {
  success: boolean
  query: string
  results: SearchResult[]
  cached: boolean
  source: 'serper' | 'stub'
  error?: string
}

export interface SearchOptions {
  num?: number  // Number of results (default 5, max 10)
  type?: 'search' | 'news'  // Search type
  country?: string  // Country code (e.g., 'us', 'uk')
  cacheDurationHours?: number  // Cache duration (default 24)
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

/**
 * Generate cache key from search parameters
 */
function getCacheKey(query: string, options: SearchOptions): string {
  return `search:${options.type || 'search'}:${query.toLowerCase().trim()}`
}

/**
 * Check if cached result exists and is still valid
 */
async function getCachedResult(
  supabase: SupabaseClient,
  organizationId: string,
  cacheKey: string,
  maxAgeHours: number
): Promise<SearchResponse | null> {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - maxAgeHours)

  const { data } = await supabase
    .from('business_knowledge')
    .select('fact, metadata, created_at')
    .eq('organization_id', organizationId)
    .eq('category', 'search_cache')
    .eq('source_url', cacheKey)
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (data?.metadata?.results) {
    return {
      success: true,
      query: data.metadata.query as string,
      results: data.metadata.results as SearchResult[],
      cached: true,
      source: data.metadata.source as 'serper' | 'stub'
    }
  }

  return null
}

/**
 * Save search result to cache
 */
async function cacheResult(
  supabase: SupabaseClient,
  organizationId: string,
  cacheKey: string,
  response: SearchResponse
): Promise<void> {
  await supabase
    .from('business_knowledge')
    .insert({
      organization_id: organizationId,
      layer: 'market',
      category: 'search_cache',
      fact: `Search: ${response.query} (${response.results.length} results)`,
      source_type: 'research',
      source_url: cacheKey,
      confidence: 0.7,
      importance: 'low',
      status: 'active',
      metadata: {
        query: response.query,
        results: response.results,
        source: response.source
      }
    })
}

// ============================================================================
// SERPER API
// ============================================================================

/**
 * Call Serper API for web search
 */
async function callSerperApi(
  query: string,
  apiKey: string,
  options: SearchOptions
): Promise<SearchResponse> {
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: options.num || 5,
        gl: options.country || 'us'
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, query, results: [], cached: false, source: 'serper', error }
    }

    const data = await response.json()

    const results: SearchResult[] = (data.organic || []).slice(0, options.num || 5).map((item: {
      title: string
      link: string
      snippet: string
      position: number
    }, index: number) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      position: index + 1
    }))

    return { success: true, query, results, cached: false, source: 'serper' }
  } catch (error) {
    return { success: false, query, results: [], cached: false, source: 'serper', error: (error as Error).message }
  }
}

// ============================================================================
// STUB RESPONSE
// ============================================================================

/**
 * Generate informative stub response when API not configured
 */
function getStubResponse(query: string, searchType: string): SearchResponse {
  const stubResults: SearchResult[] = [
    {
      title: `[Research Needed] ${query}`,
      link: '#',
      snippet: `To get real results for "${query}", configure SERPER_API_KEY in Supabase secrets.`,
      position: 1
    }
  ]

  // Add contextual hints based on search type
  if (searchType === 'competitors') {
    stubResults.push({
      title: 'Competitor Analysis Tips',
      link: '#tip',
      snippet: 'When researching competitors, look for: pricing, features, customer reviews, market position, and unique selling points.',
      position: 2
    })
  } else if (searchType === 'regulations') {
    stubResults.push({
      title: 'Regulatory Research Tips',
      link: '#tip',
      snippet: 'Check official government websites (.gov), industry associations, and recent news for regulatory updates.',
      position: 2
    })
  } else if (searchType === 'trends') {
    stubResults.push({
      title: 'Market Trends Research Tips',
      link: '#tip',
      snippet: 'Look for industry reports, analyst predictions, consumer behavior data, and technology adoption rates.',
      position: 2
    })
  } else if (searchType === 'benchmarks') {
    stubResults.push({
      title: 'Benchmark Research Tips',
      link: '#tip',
      snippet: 'Find industry benchmarks from trade associations, research firms, and business analytics platforms.',
      position: 2
    })
  }

  return { success: true, query, results: stubResults, cached: false, source: 'stub' }
}

// ============================================================================
// MAIN SEARCH FUNCTION
// ============================================================================

/**
 * Perform web search with caching
 * Uses Serper API if configured, otherwise returns informative stub
 */
export async function webSearch(
  supabase: SupabaseClient,
  organizationId: string,
  query: string,
  searchType: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const serperKey = Deno.env.get('SERPER_API_KEY')
  const cacheKey = getCacheKey(query, options)
  const cacheDuration = options.cacheDurationHours || 24

  // Check cache first
  const cached = await getCachedResult(supabase, organizationId, cacheKey, cacheDuration)
  if (cached) {
    return cached
  }

  let response: SearchResponse

  if (serperKey) {
    // Real API call
    response = await callSerperApi(query, serperKey, options)
  } else {
    // Stub response
    response = getStubResponse(query, searchType)
  }

  // Cache successful results
  if (response.success && response.results.length > 0) {
    await cacheResult(supabase, organizationId, cacheKey, response)
  }

  return response
}

/**
 * Save research findings to business knowledge
 */
export async function saveResearchFindings(
  supabase: SupabaseClient,
  organizationId: string,
  layer: string,
  category: string,
  findings: string[],
  sourceQuery: string,
  sourceUrl?: string
): Promise<void> {
  for (const finding of findings) {
    await supabase
      .from('business_knowledge')
      .insert({
        organization_id: organizationId,
        layer,
        category,
        fact: finding,
        source_type: 'research',
        source_url: sourceUrl || `search:${sourceQuery}`,
        confidence: 0.6,
        importance: 'medium',
        status: 'active'
      })
  }
}

/**
 * Extract key insights from search results
 */
export function extractInsights(results: SearchResult[]): string[] {
  return results
    .filter(r => r.snippet && !r.snippet.includes('[Research Needed]'))
    .map(r => r.snippet)
    .slice(0, 5)
}
