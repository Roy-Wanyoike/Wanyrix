/**
 * Palette data search (issue #127) — the command palette promises
 * "Search crates, findings, PRs…" but (before this module) only view names
 * matched; data queries like `tokio` or `WAN-DEP-006` fell through to
 * "No results found." This module builds the DATA half of the palette index
 * from the same fixture selectors the /api/wanyrix/* routes serve to the
 * views (getGraphPayload · getDoctor · getExperiments · getPRAnalysis ·
 * ISSUES) — no new APIs, no server round-trip, fully client-side.
 *
 * Contract:
 * - Workspace-scoped: entries are built for the ACTIVE workspace id, so the
 *   palette searches exactly what the views show (helios ⇄ atlas switch
 *   re-scopes the index; unknown ids fall back to the helios payload, the
 *   same default the API selectors use).
 * - Deterministic: pure fixture input → pure entry list; no dates, no
 *   randomness, stable order (crates → findings → issues → PR → experiments)
 *   so equal scores keep insertion order (stable sort) and the best match of
 *   the earliest group ranks first.
 * - Matching reuses paletteFilter (issue #99): word-boundary tokens against
 *   the entry `value` + `keywords` (ids, titles, affected crates, PR/branch
 *   aliases). Hyphenated ids match via the word-boundary span rule
 *   ("WAN-DEP-006", "PR-184").
 * - Navigation: every entry carries the ViewId of the view that OWNS the
 *   record (crate → graph, finding → findings, issue → issues, regression PR
 *   → prs, experiment → experiments). Views themselves stay in the component
 *   layer (nav-registry) — this module is data-only.
 *
 * Honest no-results: an empty query searches nothing (the palette shows
 * views, as before); `searchPaletteEntries` returns [] only when no record
 * matches, which is the only state in which the palette may show
 * "No results found."
 */
import { getDoctor, getExperiments, getGraphPayload, getPRAnalysis, ISSUES } from './data'
import { paletteFilter } from './palette-filter'
import type { Experiment, Finding, IssueItem, PRAnalysis, ViewId } from './types'

/** The data record kinds the palette can surface (views are separate). */
export type PaletteDataKind = 'crate' | 'finding' | 'issue' | 'pr' | 'experiment'

export interface PaletteDataEntry {
  kind: PaletteDataKind
  /** stable unique key (fixture id; regression PRs are `PR-<number>`) */
  id: string
  /** primary label rendered in the palette */
  label: string
  /** right-aligned context line (severity, state, build time, …) */
  detail: string
  /** cmdk match value — kind-prefixed so every entry is unique */
  value: string
  /** alternate match sources for paletteFilter (ids, titles, aliases) */
  keywords: string[]
  /** the view that owns the record — navigation target */
  view: ViewId
}

/** crate node → palette entry (graph payload serves both workspaces' crates). */
function crateEntry(node: {
  id: string
  kind: string
  band: string
  buildTime: number
  duplicate?: boolean
}): PaletteDataEntry {
  return {
    kind: 'crate',
    id: node.id,
    label: node.id,
    detail: `${node.kind} · ${node.band} · ${node.buildTime}s build`,
    value: `crate ${node.id}`,
    keywords: node.duplicate ? [node.id, 'duplicate versions'] : [node.id],
    view: 'graph',
  }
}

/** finding → palette entry; affected crates become keywords so `tokio`
    surfaces the findings that reference it (issue #127 examples). */
function findingEntry(f: Finding): PaletteDataEntry {
  return {
    kind: 'finding',
    id: f.id,
    label: `${f.id} · ${f.title}`,
    detail: `${f.severity} · ${f.section}`,
    value: `finding ${f.id} ${f.title}`,
    keywords: [f.id, f.title, ...f.affected.filter((a) => !a.startsWith('+'))],
    view: 'findings',
  }
}

/** traceability row → palette entry; PR number/branch and the GitHub issue
    number are aliases so a PR id finds its owning row. */
function issueEntry(i: IssueItem): PaletteDataEntry {
  return {
    kind: 'issue',
    id: i.id,
    label: `${i.id} · ${i.title}`,
    detail: i.pr ? `${i.state} · PR #${i.pr.number}` : i.state,
    value: `issue ${i.id} ${i.title}`,
    keywords: [
      i.id,
      i.title,
      `issue #${i.ghIssue}`,
      ...(i.pr ? [`PR #${i.pr.number}`, i.pr.title, i.pr.branch] : []),
    ],
    view: 'issues',
  }
}

/** PR-regression analysis → palette entry (lives in PR Analysis, not the
    traceability board). */
function prEntry(p: PRAnalysis): PaletteDataEntry {
  return {
    kind: 'pr',
    id: `PR-${p.number}`,
    label: `PR #${p.number} · ${p.title}`,
    detail: `${p.state ?? 'open'} · +${p.regressionPct}% regression`,
    value: `pull request #${p.number} ${p.title}`,
    keywords: [`PR #${p.number}`, p.title, p.branch, p.author, 'regression guard'],
    view: 'prs',
  }
}

/** experiment → palette entry; the source finding id is an alias so
    `WAN-BLD-001` also finds its experiment. */
function experimentEntry(e: Experiment): PaletteDataEntry {
  return {
    kind: 'experiment',
    id: e.id,
    label: `${e.id} · ${e.title}`,
    detail: e.improvementPct != null ? `${e.status} · ${e.improvementPct}%` : e.status,
    value: `experiment ${e.id} ${e.title}`,
    keywords: [e.id, e.title, e.findingId],
    view: 'experiments',
  }
}

/**
 * Build the full data index for one workspace. Pure and deterministic —
 * same input, same list (pinned by tests/unit/palette-search.test.ts).
 */
export function buildPaletteEntries(ws: string): PaletteDataEntry[] {
  const entries: PaletteDataEntry[] = []
  for (const node of getGraphPayload(ws).nodes) entries.push(crateEntry(node))
  for (const f of getDoctor(ws).findings) entries.push(findingEntry(f))
  for (const i of ISSUES) entries.push(issueEntry(i))
  entries.push(prEntry(getPRAnalysis(ws)))
  for (const e of getExperiments(ws).experiments) entries.push(experimentEntry(e))
  return entries
}

/**
 * Search the data index with the palette's own matcher (paletteFilter).
 * Returns matches ranked by score (highest first; equal scores keep the
 * build order). An empty/whitespace query returns [] — the palette treats
 * that as "not searching yet" and shows views only.
 */
export function searchPaletteEntries(ws: string, query: string): PaletteDataEntry[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const entries = buildPaletteEntries(ws)
  const scored: { entry: PaletteDataEntry; score: number; index: number }[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as PaletteDataEntry
    const score = paletteFilter(entry.value, trimmed, entry.keywords)
    if (score >= 1) scored.push({ entry, score, index: i })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.entry)
}
