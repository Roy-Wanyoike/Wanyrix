/**
 * Tight palette matching (issue #99 P4) — replaces cmdk's loose subsequence
 * scorer for the command palette. The default `command-score` matcher let
 * "dep" match "Runtime captured profiles" (subsequence d→e→p across words),
 * surfacing unrelated entries above real ones.
 *
 * Contract: EVERY whitespace-separated query token must match a WORD of the
 * value — either exactly, or as that word's PREFIX (word-boundary anchored).
 * Loose mid-word substrings and non-contiguous subsequences never match, so
 * "dep" ranks "Dependencies"-type entries first and no longer surfaces items
 * like "Runtime". Multi-token queries AND their scores (all tokens must hit);
 * earlier word positions and exact hits outrank later/prefix hits so the
 * best-matching entries sort first.
 *
 * Score scale (cmdk expects ≥1 for matches, -1 for misses):
 *   100 · a word equals the token            ("run" → "Run full scan")
 *    80 · a word starts with the token       ("dep" → "Dependencies")
 *    60 · token spans adjacent words, anchored at a word boundary
 *                                            ("scan run" → "scan run log")
 *    -1 · no word-boundary match             ("dep" ✗ "Runtime …")
 */

/** Score one token against one value's word list; -1 when unmatched. */
function scoreToken(token: string, value: string): number {
  const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let best = -1
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === token) {
      best = Math.max(best, 100 - i) // exact word hit, earlier wins
      continue
    }
    if (word.startsWith(token)) {
      best = Math.max(best, 80 - i) // word-prefix hit (word-boundary anchored)
      continue
    }
  }
  if (best >= 0) return best

  // word-boundary SPAN: the token may cross adjacent words ("scanrun" →
  // "scan run log") as long as it starts at a word start and consumes whole
  // words — never a mid-word fragment.
  const joined = value.toLowerCase()
  let idx = joined.indexOf(token)
  while (idx !== -1) {
    const end = idx + token.length
    const startsAtBoundary = idx === 0 || /[^a-z0-9]/.test(joined[idx - 1])
    const endsAtBoundary = end >= joined.length || /[^a-z0-9]/.test(joined[end])
    if (startsAtBoundary && endsAtBoundary) return 60
    idx = joined.indexOf(token, idx + 1)
  }
  return -1
}

/** cmdk `filter` signature: (value, search, keywords?) → score | -1. */
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1 // empty query: keep everything, neutral score
  const candidates = [value, ...(keywords ?? [])].map((c) => c.toLowerCase())
  let total = 0
  for (const token of tokens) {
    let best = -1
    for (const candidate of candidates) {
      best = Math.max(best, scoreToken(token, candidate))
    }
    if (best === -1) return -1 // one unmatched token rejects the entry
    total += best
  }
  return total
}
