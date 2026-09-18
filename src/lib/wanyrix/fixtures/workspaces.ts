/**
 * fixtures/workspaces — workspace registry fixtures (helios + atlas).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (WORKSPACE,
 * WORKSPACE_ATLAS, WORKSPACES, WORKSPACES_DEFAULT) is unchanged.
 * Types: WorkspaceSummary comes from ../types — no type is defined here.
 */
import type { WorkspaceSummary } from '../types'
import { FINDINGS } from './findings'

export const WORKSPACE = {
  name: 'helios-platform',
  description: 'Payments platform · 47 workspace crates · rustc 1.84.1 · dev profile',
  crates: 47,
  edges: 212,
  toolchain: 'rustc 1.84.1 (a07f3eb) · cargo 1.84.0',
  profile: 'dev',
  lastScan: '2026-09-17T09:12:04Z',
}

// ---------------------------------------------------------------------------
// Workspace registry + second workspace (atlas-consortium) — issue #34
// ---------------------------------------------------------------------------

export const WORKSPACE_ATLAS = {
  name: 'atlas-consortium',
  description: 'Data infrastructure consortium · 23 workspace crates · rustc 1.83.0 · dev profile',
  crates: 23,
  edges: 96,
  toolchain: 'rustc 1.83.0 (9b1d2c4) · cargo 1.83.0',
  profile: 'dev',
  lastScan: '2026-09-17T08:41:37Z',
}

export const WORKSPACES: WorkspaceSummary[] = [
  {
    id: 'helios-platform',
    name: 'helios-platform',
    description: 'Payments platform · continuously analyzed',
    crates: WORKSPACE.crates,
    edges: WORKSPACE.edges,
    toolchain: WORKSPACE.toolchain,
    accent: 'primary',
    status: 'live',
    findings: FINDINGS.length,
    lastScan: WORKSPACE.lastScan,
  },
  {
    id: 'atlas-consortium',
    name: 'atlas-consortium',
    description: 'Data infrastructure · continuously analyzed',
    crates: WORKSPACE_ATLAS.crates,
    edges: WORKSPACE_ATLAS.edges,
    toolchain: WORKSPACE_ATLAS.toolchain,
    accent: 'emerald',
    status: 'live',
    findings: 7,
    lastScan: WORKSPACE_ATLAS.lastScan,
  },
]

export const WORKSPACES_DEFAULT = WORKSPACES[0].id

