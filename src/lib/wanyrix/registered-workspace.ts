/**
 * Registered-workspace registry merge (QA-5-B-1).
 *
 * The connect-a-project bridge stores REAL engine-measured rows server-side
 * (Prisma `RegisteredWorkspace`) and GET /api/wanyrix/workspaces serves them
 * as `registered: RegisteredWorkspaceSummary[]` — but the shell used to read
 * only `data.workspaces` (the two demo fixtures), so a freshly connected
 * project was invisible everywhere: the connect-a-project journey dead-ended
 * right after its own success dialog.
 *
 * This module is the ONE merge point the selector, ⌘K palette and the
 * Repositories view consume:
 *   - registered rows come FIRST (the user's own projects lead the list);
 *   - `fixtureOnly` is preserved verbatim (false on registered rows, true on
 *     fixtures) so the QA-5-B-4 provenance badge can never mislabel them;
 *   - the mapping to the shell's `WorkspaceSummary` invents NOTHING: counts,
 *     findings and toolchain pass through from the measured row, the
 *     description names the local path, and `lastScan` is the row's real
 *     `lastCheckedAt` (the last engine check), never a fabricated timestamp.
 *
 * Pure and client-safe (no db, no next/*) — unit-pinned in
 * tests/unit/registered-workspaces.test.ts.
 */

import type {
  RegisteredWorkspaceSummary,
  WorkspaceSummary,
} from './types'

/** Minimal input shape so callers can pass the raw query payload directly. */
export interface WorkspaceRegistryInput {
  workspaces?: WorkspaceSummary[]
  registered?: RegisteredWorkspaceSummary[] | null
}

/**
 * Maps one measured registered row into the shell's workspace summary shape.
 * Every displayed value is either from the row or an honest descriptor —
 * nothing is defaulted to look "live" (accent zinc, description = the path).
 */
export function registeredToSummary(r: RegisteredWorkspaceSummary): WorkspaceSummary {
  return {
    id: r.id,
    name: r.name,
    description: `local project · ${r.path}`,
    crates: r.crates,
    edges: r.edges,
    toolchain: r.toolchain,
    accent: 'zinc',
    status: 'live',
    findings: r.findings,
    lastScan: r.lastCheckedAt,
    fixtureOnly: false,
  }
}

/**
 * Merges the registry payload into ONE ordered workspace list:
 * registered (engine-measured) rows first, then the demo fixtures.
 * Accepts `undefined` so TanStack Query's loading state maps to `[]`.
 */
export function mergeWorkspaceRegistry(
  payload?: WorkspaceRegistryInput | null,
): WorkspaceSummary[] {
  const registered = (payload?.registered ?? []).map(registeredToSummary)
  const fixtures = payload?.workspaces ?? []
  return [...registered, ...fixtures]
}

/* --------------------------------------------- scan-run workspace resolution --- */

/**
 * AUD-14 — the scan-runs route resolves its workspace id against the FULL
 * registry, not just the fixtures: a registered local project (QA-5-B-1)
 * must be able to sync its durable runs. Pure decision over an
 * already-fetched registered-id list (the route fetches the ids from the
 * SAME store GET /api/wanyrix/workspaces serves — `db.registeredWorkspace`,
 * mergeWorkspaceRegistry's source of truth), so this stays unit-testable
 * without a db.
 */
export interface ScanWorkspaceDecision {
  /** True when `id` is a known fixture id OR a known registered id. */
  known: boolean
  /**
   * The #129 404 guidance list for a truly-unknown id: registered ids FIRST
   * (mergeWorkspaceRegistry order — the user's own projects lead), then the
   * demo fixtures.
   */
  knownWorkspaces: string[]
}

export function resolveScanRunWorkspace(
  id: string,
  fixtureIds: string[],
  registeredIds: string[],
): ScanWorkspaceDecision {
  return {
    known: fixtureIds.includes(id) || registeredIds.includes(id),
    knownWorkspaces: [...registeredIds, ...fixtureIds],
  }
}
