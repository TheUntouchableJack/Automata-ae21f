// Shared knowledge-importance sorting
// -----------------------------------
// `business_knowledge.importance` is a TEXT column ('critical' | 'high' | 'medium' | 'low').
// A Postgres `ORDER BY importance DESC` sorts it ALPHABETICALLY, which ranks
// 'medium' > 'low' > 'high' > 'critical' — the exact opposite of intent for
// 'critical'/'high'. Every consumer must therefore over-fetch and re-sort in TS
// (or use an explicit CASE in SQL) instead of relying on a text ORDER BY.

export const IMPORTANCE_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function importanceRank(importance: string | null | undefined): number {
  return IMPORTANCE_RANK[(importance || '').toLowerCase()] ?? 0
}

// Sort a knowledge-fact array by importance (rank desc), then confidence (desc),
// then created_at (desc, newest first). Fields beyond `importance` are optional —
// callers that don't select confidence/created_at still get a stable importance order.
export interface SortableFact {
  importance?: string | null
  confidence?: number | null
  created_at?: string | null
}

export function sortByImportance<T extends SortableFact>(facts: T[]): T[] {
  return [...facts].sort((a, b) => {
    const rankDiff = importanceRank(b.importance) - importanceRank(a.importance)
    if (rankDiff !== 0) return rankDiff

    const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0)
    if (confDiff !== 0) return confDiff

    // created_at desc (newest first); missing dates sort last
    const aTime = a.created_at ? Date.parse(a.created_at) : 0
    const bTime = b.created_at ? Date.parse(b.created_at) : 0
    return bTime - aTime
  })
}
