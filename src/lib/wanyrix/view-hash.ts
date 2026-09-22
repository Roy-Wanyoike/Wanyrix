/**
 * Hash-based view routing (QA-1 F-1).
 *
 * The SPA used to keep the active view in a bare useState: the URL never left
 * `/`, so refresh dropped the user back to Overview and Back/Forward/bookmark/
 * copy-link could not carry a view. Views are now encoded in the location hash
 * (`#/graph`, `#/findings`, …) — hash (not searchParams) because the app is a
 * single Next route and hashes survive a static deploy without server config.
 *
 * Split into pure functions so the routing DECISIONS are unit-pinnable
 * (jsdom-free bun test); the window/history wiring lives in src/app/page.tsx
 * and is deliberately thin:
 *   - mount: restore `resolveInitialView(location.hash)` (post-hydration, so
 *     the server render and the first client render agree on Overview — no
 *     mismatch); a bare hash is canonicalized via history.replaceState.
 *   - navigate: setView + `location.hash = hashForView(v)` — a hash write
 *     pushes a history entry WITHOUT any reload, so Back/Forward traverse
 *     views; the hashchange listener turns those traversals into setView.
 *
 * `VIEW_IDS` is compiler-forced complete (Record<ViewId, true>): a new ViewId
 * cannot be added to the union without becoming routable here.
 */
import type { ViewId } from './types'

/** Hash prefix for every view URL — `#/overview`, `#/graph`, … */
const HASH_PREFIX = '#/'

/** Compile-time-complete map of every routable ViewId. */
const VIEW_ID_PRESENT: Record<ViewId, true> = {
  overview: true,
  repositories: true,
  doctor: true,
  dependencies: true,
  graph: true,
  findings: true,
  architecture: true,
  diagnostics: true,
  prs: true,
  simulator: true,
  experiments: true,
  runtime: true,
  history: true,
  ai: true,
  scorecard: true,
  issues: true,
  organization: true,
  plans: true,
  settings: true,
}

/** Runtime list of routable views (derived from the completeness map). */
export const VIEW_IDS: readonly ViewId[] = Object.keys(VIEW_ID_PRESENT) as ViewId[]

/**
 * Parse a location hash into a ViewId. Strict: only `#/view` with a known id
 * restores a view — anything else (empty, `#`, unknown id, wrong prefix) is
 * null and callers fall back to Overview. Idempotent and case-sensitive so a
 * hand-typed hash cannot half-match.
 */
export function viewFromHash(hash: string | null | undefined): ViewId | null {
  if (!hash || !hash.startsWith(HASH_PREFIX)) return null
  const id = hash.slice(HASH_PREFIX.length)
  return VIEW_ID_PRESENT[id as ViewId] === true ? (id as ViewId) : null
}

/** The canonical shareable URL fragment for a view. */
export function hashForView(view: ViewId): string {
  return HASH_PREFIX + view
}

/**
 * The view a cold load should show: the hash's view when it names one,
 * Overview otherwise (the documented default surface).
 */
export function resolveInitialView(hash: string | null | undefined): ViewId {
  return viewFromHash(hash) ?? 'overview'
}
