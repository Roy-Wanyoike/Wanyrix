/**
 * fixtures/selectors — per-workspace payload selectors + impact resolution.
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (getWorkspaces, getHealth,
 * getDoctor, getDiagnostics, getPRAnalysis, getGraphPayload, getImpact,
 * getExperiments) is unchanged. These functions cross every fixture domain, so
 * they live in their own module and compose the domain modules above.
 * Types: all payload/impact types come from ../types; UpgradeCatalogEntry is
 * imported from ./catalog (moved there per issue #53).
 * buildResolutions stays module-private, exactly as inside data.ts.
 */
import type {
  AddDepImpact,
  DiagnosticsPayload,
  DoctorReport,
  DuplicateResolution,
  EditFileImpact,
  ExperimentsPayload,
  GraphPayload,
  HealthPayload,
  PRAnalysis,
  SplitImpact,
  UpgradeImpact,
  WorkspacesPayload,
} from '../types'
import { ADD_DEP_CATALOG, ATLAS_ADD_DEP_CATALOG, ATLAS_UPGRADE_CATALOG, UPGRADE_CATALOG, type UpgradeCatalogEntry } from './catalog'
import { BLAST, BLAST_ATLAS } from './blast'
import { DIAGNOSTICS, DIAGNOSTICS_ATLAS } from './diagnostics'
import { DUPLICATES, DUPLICATES_ATLAS } from './duplicates'
import { DOCTOR, DOCTOR_ATLAS } from './doctor'
import { EXPERIMENTS } from './experiments'
import { ATLAS_MATH, GRAPH_EDGES, GRAPH_EDGES_ATLAS, GRAPH_NODES, GRAPH_NODES_ATLAS, HELIOS_MATH } from './graph'
import { HEALTH, HEALTH_ATLAS } from './health'
import { PR_184, PR_97_ATLAS } from './pr'
import { SPLIT_SIM, SPLIT_SIM_ATLAS } from './simulator'
import { WORKSPACE, WORKSPACE_ATLAS, WORKSPACES, WORKSPACES_DEFAULT } from './workspaces'

// ----------------------------------------------------------------- selectors

export function getWorkspaces(): WorkspacesPayload {
  return { workspaces: WORKSPACES, default: WORKSPACES_DEFAULT }
}

export function getHealth(ws: string): HealthPayload {
  return ws === 'atlas-consortium' ? HEALTH_ATLAS : HEALTH
}

export function getDoctor(ws: string): DoctorReport {
  return ws === 'atlas-consortium' ? DOCTOR_ATLAS : DOCTOR
}

export function getDiagnostics(ws: string): DiagnosticsPayload {
  return ws === 'atlas-consortium' ? DIAGNOSTICS_ATLAS : DIAGNOSTICS
}

export function getPRAnalysis(ws: string): PRAnalysis {
  return ws === 'atlas-consortium' ? PR_97_ATLAS : PR_184
}

/**
 * Round-10 cross-view intelligence: for every duplicate-version group with a
 * matching upgrade scenario that closes (fully or partially) the duplicate,
 * build the crate → resolution map the graph payload serves to the UI.
 */
function buildResolutions(
  catalog: Record<string, UpgradeCatalogEntry>,
): Record<string, DuplicateResolution> {
  const out: Record<string, DuplicateResolution> = {}
  for (const [id, entry] of Object.entries(catalog)) {
    if (!entry.resolves) continue
    out[id] = {
      scenarioId: id,
      from: entry.from,
      to: entry.to,
      ciDelta: entry.ciDelta,
      kind: entry.resolves.kind,
      note: entry.resolves.note,
    }
  }
  return out
}

export function getGraphPayload(ws: string): GraphPayload {
  if (ws === 'atlas-consortium') {
    return {
      nodes: GRAPH_NODES_ATLAS,
      edges: GRAPH_EDGES_ATLAS,
      duplicates: DUPLICATES_ATLAS,
      blast: BLAST_ATLAS,
      meta: {
        workspaceCrates: WORKSPACE_ATLAS.crates,
        totalEdges: WORKSPACE_ATLAS.edges,
        lastScan: WORKSPACE_ATLAS.lastScan,
        scope: 'backbone-subset',
        servedNodes: GRAPH_NODES_ATLAS.length,
        servedEdges: GRAPH_EDGES_ATLAS.length,
        aggregateSource: 'served-edges',
        note: 'The served node/edge set is the analysis backbone subset of the full workspace graph. fanIn/fanOut are served edge degrees; downstream and blast.affectedWorkspace count served workspace-kind crates that transitively depend on a node. Full-workspace narrative numbers (doctor findings, health activity) refer to workspaceCrates/totalEdges above.',
      },
      catalog: {
        addDeps: Object.entries(ATLAS_ADD_DEP_CATALOG).map(([id, v]) => ({ id, version: v.version })),
        splitCandidates: [SPLIT_SIM_ATLAS.source],
        upgrades: Object.entries(ATLAS_UPGRADE_CATALOG).map(([id, v]) => ({ id, from: v.from, to: v.to })),
      },
      resolutions: buildResolutions(ATLAS_UPGRADE_CATALOG),
    }
  }
  return {
    nodes: GRAPH_NODES,
    edges: GRAPH_EDGES,
    duplicates: DUPLICATES,
    blast: BLAST,
    meta: {
      workspaceCrates: WORKSPACE.crates,
      totalEdges: WORKSPACE.edges,
      lastScan: WORKSPACE.lastScan,
      scope: 'backbone-subset',
      servedNodes: GRAPH_NODES.length,
      servedEdges: GRAPH_EDGES.length,
      aggregateSource: 'served-edges',
      note: 'The served node/edge set is the analysis backbone subset of the full workspace graph. fanIn/fanOut are served edge degrees; downstream and blast.affectedWorkspace count served workspace-kind crates that transitively depend on a node. Full-workspace narrative numbers (doctor findings, health activity) refer to workspaceCrates/totalEdges above.',
    },
    catalog: {
      addDeps: Object.entries(ADD_DEP_CATALOG).map(([id, v]) => ({ id, version: v.version })),
      splitCandidates: [SPLIT_SIM.source],
      upgrades: Object.entries(UPGRADE_CATALOG).map(([id, v]) => ({ id, from: v.from, to: v.to })),
    },
    resolutions: buildResolutions(UPGRADE_CATALOG),
  }
}

export function getImpact(
  type: 'add-dep' | 'edit-file' | 'split-crate' | 'upgrade-dep',
  target: string,
  ws: string,
): AddDepImpact | EditFileImpact | SplitImpact | UpgradeImpact | null {
  const atlas = ws === 'atlas-consortium'
  if (type === 'add-dep') {
    const catalog = atlas ? ATLAS_ADD_DEP_CATALOG : ADD_DEP_CATALOG
    const entry = catalog[target]
    if (!entry) return null
    return { kind: 'add-dep', crate: target, ...entry, measurementStatus: 'estimated' }
  }
  if (type === 'edit-file') {
    const blast = atlas ? BLAST_ATLAS : BLAST
    const entry = blast.find((b) => b.file === target)
    if (!entry) return null
    return {
      kind: 'edit-file',
      file: entry.file,
      crate: entry.crate,
      affectedWorkspace: entry.affectedWorkspace,
      chain: entry.chain,
      incrementalDelta: entry.incrementalDelta,
      ciDelta: Math.round(entry.incrementalDelta * 1.6 * 10) / 10,
      notes: [
        `Blast radius: ${entry.affectedWorkspace} workspace crates re-invalidate`,
        `Chain: ${entry.chain.join(' → ')}`,
        'Estimates derived from build telemetry × graph traversal',
      ],
      suggestion: entry.suggestion,
      measurementStatus: 'estimated',
    }
  }
  if (type === 'split-crate') {
    const sim = atlas ? SPLIT_SIM_ATLAS : SPLIT_SIM
    return {
      kind: 'split-crate',
      source: sim.source,
      before: sim.before,
      proposal: sim.proposal,
      improvementPct: sim.improvementPct,
      migration: sim.migration,
      measurementStatus: 'estimated',
    }
  }
  if (type === 'upgrade-dep') {
    const catalog = atlas ? ATLAS_UPGRADE_CATALOG : UPGRADE_CATALOG
    const entry = catalog[target]
    if (!entry) return null
    const duplicates = atlas ? DUPLICATES_ATLAS : DUPLICATES
    const math = atlas ? ATLAS_MATH : HELIOS_MATH
    return {
      kind: 'upgrade-dep',
      crate: target,
      // ENG-TCA-3: derived from the workspace's duplicates list + served graph
      // closure — a hand-typed value could contradict the /graph payload.
      duplicateBefore: duplicates.some((d) => d.name === target),
      ...entry,
      recompileCrates: math.workspaceBlastRadius(target),
      measurementStatus: 'estimated',
    }
  }
  return null
}

export function getExperiments(ws: string): ExperimentsPayload {
  // experiments are workspace-scoped: only helios-platform has recorded runs
  return { workspace: ws, experiments: ws === 'atlas-consortium' ? [] : EXPERIMENTS }
}

