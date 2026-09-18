/**
 * fixtures/health — overview/health payloads (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (HEALTH, HEALTH_ATLAS) is
 * unchanged.
 * Types: HealthPayload comes from ../types — no type is defined here.
 */
import type { HealthPayload } from '../types'
import { ATLAS_MATH, HELIOS_MATH } from './graph'
import { WORKSPACE, WORKSPACE_ATLAS } from './workspaces'

// ---------------------------------------------------------------------------
// Overview / health
// ---------------------------------------------------------------------------

export const HEALTH: HealthPayload = {
  workspace: WORKSPACE.name,
  crates: WORKSPACE.crates,
  edges: WORKSPACE.edges,
  toolchain: WORKSPACE.toolchain,
  cacheHitRate: 32,
  kpis: {
    buildPerformance: { delta: -23, label: 'Build performance' },
    ciCost: { delta: -18, label: 'CI cost' },
    dependencyRisk: { delta: -14, label: 'Dependency risk' },
    prRegressions: { count: 2, label: 'PR build regressions' },
    architectureDebt: { count: 17, label: 'Architecture debt' },
    runtimeBottlenecks: { count: 6, label: 'Runtime bottlenecks' },
  },
  buildTrend: [
    { month: 'Apr', clean: 64.2, incremental: 8.2 },
    { month: 'May', clean: 71.0, incremental: 9.1 },
    { month: 'Jun', clean: 78.3, incremental: 11.8 },
    { month: 'Jul', clean: 82.6, incremental: 13.5 },
    { month: 'Aug', clean: 85.9, incremental: 15.2 },
    { month: 'Sep', clean: 87.4, incremental: 16.9 },
  ],
  slowestCrates: [
    // downstream is the served-graph workspace closure (ENG-TCA-3 — derived,
    // never hand-typed, so /health cannot contradict /graph)
    { name: 'common-runtime', seconds: 18.3, downstream: HELIOS_MATH.workspaceBlastRadius('common-runtime') },
    { name: 'api', seconds: 12.7, downstream: HELIOS_MATH.workspaceBlastRadius('api') },
    { name: 'worker', seconds: 11.2, downstream: HELIOS_MATH.workspaceBlastRadius('worker') },
    { name: 'payments-core', seconds: 10.4, downstream: HELIOS_MATH.workspaceBlastRadius('payments-core') },
    { name: 'gateway', seconds: 9.8, downstream: HELIOS_MATH.workspaceBlastRadius('gateway') },
    { name: 'database', seconds: 8.9, downstream: HELIOS_MATH.workspaceBlastRadius('database') },
  ],
  activity: [
    {
      id: 'a1',
      time: '2m ago',
      kind: 'regression',
      title: 'PR #184 build regression detected',
      detail: '+43.6% incremental build (31.2s → 44.8s) — sqlx dependency expansion',
      severity: 'critical',
    },
    {
      id: 'a2',
      time: '1h ago',
      kind: 'duplicate',
      title: 'Duplicate tokio versions after lockfile update',
      detail: '1.34.2 + 1.40.0 both compiled — WAN-BLD-002',
      severity: 'warning',
    },
    {
      id: 'a3',
      time: '3h ago',
      kind: 'amplification',
      title: 'common-runtime change amplified ×38 rebuilds',
      detail: 'scheduler.rs touched; 38 crates re-invalidated — WAN-BLD-001',
      severity: 'warning',
    },
    {
      id: 'a4',
      time: 'yesterday',
      kind: 'experiment',
      title: 'EXP-014 verified: 24.5% build improvement',
      detail: 'common-runtime split measured 42.1s → 31.8s (5-run median)',
      severity: 'info',
    },
    {
      id: 'a5',
      time: '2d ago',
      kind: 'improvement',
      title: 'CI cache miss rate 68% → 54%',
      detail: 'cargo-chef migration on 2 of 5 pipelines — WAN-DEP-006',
      severity: 'info',
    },
    {
      id: 'a6',
      time: '3d ago',
      kind: 'config',
      title: 'rust-analyzer flycheck config applied',
      detail: 'check.workspace=false rolled out to 12 developers — WAN-IDE-010',
      severity: 'info',
    },
  ],
  findingCounts: [
    { section: 'Build', count: 4 },
    { section: 'Workspace', count: 3 },
    { section: 'CI', count: 2 },
    { section: 'IDE', count: 2 },
    { section: 'Async', count: 1 },
  ],
  lastScan: WORKSPACE.lastScan,
  insight: {
    text: 'Average PR now causes 4.7× more compilation work than six months ago.',
    question: 'Why has compilation work per PR grown?',
  },
}

// ------------------------------------------------------------- atlas: health

export const HEALTH_ATLAS: HealthPayload = {
  workspace: WORKSPACE_ATLAS.name,
  crates: WORKSPACE_ATLAS.crates,
  edges: WORKSPACE_ATLAS.edges,
  toolchain: WORKSPACE_ATLAS.toolchain,
  cacheHitRate: 59,
  kpis: {
    buildPerformance: { delta: -16, label: 'Build performance' },
    ciCost: { delta: -9, label: 'CI cost' },
    dependencyRisk: { delta: -22, label: 'Dependency risk' },
    prRegressions: { count: 1, label: 'PR build regressions' },
    architectureDebt: { count: 9, label: 'Architecture debt' },
    runtimeBottlenecks: { count: 3, label: 'Runtime bottlenecks' },
  },
  buildTrend: [
    { month: 'Apr', clean: 58.9, incremental: 6.1 },
    { month: 'May', clean: 57.2, incremental: 6.4 },
    { month: 'Jun', clean: 56.0, incremental: 7.8 },
    { month: 'Jul', clean: 54.7, incremental: 9.2 },
    { month: 'Aug', clean: 53.5, incremental: 10.6 },
    { month: 'Sep', clean: 52.8, incremental: 12.1 },
  ],
  slowestCrates: [
    // downstream is the served-graph workspace closure (ENG-TCA-3 — derived,
    // never hand-typed, so /health cannot contradict /graph)
    { name: 'atlas-store', seconds: 14.2, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-store') },
    { name: 'atlas-query', seconds: 9.6, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-query') },
    { name: 'atlas-lsm', seconds: 6.1, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-lsm') },
    { name: 'atlas-planner', seconds: 4.8, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-planner') },
    { name: 'atlas-common', seconds: 4.6, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-common') },
    { name: 'atlas-ingest', seconds: 5.8, downstream: ATLAS_MATH.workspaceBlastRadius('atlas-ingest') },
  ],
  activity: [
    {
      id: 'b1',
      time: '1h ago',
      kind: 'duplicate',
      title: 'arrow version fork widened',
      detail: '53.3.0 and 54.2.0 both compile — ATL-DEP-003',
      severity: 'warning',
    },
    {
      id: 'b2',
      time: '5h ago',
      kind: 'amplification',
      title: 'atlas-common touch → 18-crate rebuild',
      detail: 'PR #97 — 78% of workspace re-invalidated',
      severity: 'warning',
    },
    {
      id: 'b3',
      time: '1d ago',
      kind: 'experiment',
      title: 'EXP-031 draft created',
      detail: 'link-profile slimming (ATL-BLD-002) — awaiting baseline',
      severity: 'info',
    },
    {
      id: 'b4',
      time: '2d ago',
      kind: 'regression',
      title: 'CI pipeline wall-clock +7%',
      detail: 'datafusion feature pull-in (ATL-DEP-004)',
      severity: 'critical',
    },
    {
      id: 'b5',
      time: '3d ago',
      kind: 'improvement',
      title: 'atlas-lsm build time −9%',
      detail: 'memtable trait split landed — measured 6.7 → 6.1s',
      severity: 'info',
    },
    {
      id: 'b6',
      time: '4d ago',
      kind: 'config',
      title: 'resolver v2 migration proposed',
      detail: 'blocks ATL-DEP-004 — scheduled next sprint',
      severity: 'info',
    },
  ],
  findingCounts: [
    { section: 'Build', count: 2 },
    { section: 'Dependencies', count: 2 },
    { section: 'Workspace', count: 1 },
    { section: 'IDE', count: 1 },
    { section: 'Async', count: 1 },
  ],
  lastScan: WORKSPACE_ATLAS.lastScan,
  insight: {
    text: 'Incremental builds doubled since the async-runtime migration — 6.1s → 12.1s in six months.',
    question: 'Why did incremental builds regress while clean builds improved?',
  },
}

