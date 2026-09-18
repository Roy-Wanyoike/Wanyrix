/**
 * fixtures/experiments — experiment-engine fixtures (Gate 20).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (EXPERIMENTS) is unchanged.
 * Types: Experiment comes from ../types — no type is defined here.
 * EXP_STAGES_* stay module-private, exactly as inside data.ts.
 */
import type { Experiment } from '../types'

// ---------------------------------------------------------------------------
// Experiments (Gate 20)
// ---------------------------------------------------------------------------

const EXP_STAGES_VERIFIED = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'done' as const },
  { name: 'candidate', state: 'done' as const },
  { name: 'cargo check', state: 'done' as const },
  { name: 'cargo test', state: 'done' as const },
  { name: 'benchmark', state: 'done' as const },
  { name: 'compare', state: 'done' as const },
  { name: 'report', state: 'done' as const },
]

const EXP_STAGES_RUNNING = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'done' as const },
  { name: 'candidate', state: 'active' as const },
  { name: 'cargo check', state: 'pending' as const },
  { name: 'cargo test', state: 'pending' as const },
  { name: 'benchmark', state: 'pending' as const },
  { name: 'compare', state: 'pending' as const },
  { name: 'report', state: 'pending' as const },
]

const EXP_STAGES_DRAFT = [
  { name: 'plan', state: 'done' as const },
  { name: 'baseline', state: 'pending' as const },
  { name: 'candidate', state: 'pending' as const },
  { name: 'cargo check', state: 'pending' as const },
  { name: 'cargo test', state: 'pending' as const },
  { name: 'benchmark', state: 'pending' as const },
  { name: 'compare', state: 'pending' as const },
  { name: 'report', state: 'pending' as const },
]

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'EXP-014',
    title: 'Split common-runtime into core + telemetry',
    findingId: 'WAN-BLD-001',
    commit: 'a3f19c2',
    status: 'verified',
    claim: 'verified',
    baseline: { seconds: 42.1, runs: 5, measuredAt: '2026-09-10T14:02:00Z' },
    candidate: { seconds: 31.8, runs: 5, measuredAt: '2026-09-12T09:41:00Z' },
    improvementPct: 24.5,
    tests: { passed: 1842, failed: 0 },
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold (sccache disabled)',
    },
    commands: [
      'wanyrix experiment create --from FER-BLD-001',
      'wanyrix experiment baseline EXP-014 --runs 5',
      'git apply candidate.patch && cargo check',
      'cargo test --workspace',
      'wanyrix experiment compare EXP-014',
    ],
    stages: EXP_STAGES_VERIFIED,
    conclusion:
      'Verified improvement: 24.5% (measured, 5-run median, reproduced ×2 on clean environments). Baseline 42.1s → candidate 31.8s, 1,842 tests passed.',
  },
  {
    id: 'EXP-015',
    title: 'Unify duplicate tokio versions',
    findingId: 'WAN-BLD-002',
    commit: '77bd0e4',
    status: 'running',
    claim: 'measured',
    baseline: { seconds: 87.4, runs: 3, measuredAt: '2026-09-15T11:20:00Z' },
    candidate: null,
    improvementPct: null,
    tests: null,
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold',
    },
    commands: [
      'wanyrix experiment create --from FER-BLD-002',
      'wanyrix experiment baseline EXP-015 --runs 3',
      'cargo update -p tokio@1.34.2 --precise 1.40.0  # candidate, pending',
    ],
    stages: EXP_STAGES_RUNNING,
  },
  {
    id: 'EXP-016',
    title: 'Isolate sqlx behind database-impl',
    findingId: 'WAN-WRK-007',
    commit: 'e91f7aa',
    status: 'draft',
    claim: 'estimated',
    baseline: null,
    candidate: null,
    improvementPct: null,
    tests: null,
    environment: {
      toolchain: 'rustc 1.84.1',
      os: 'linux-x86_64',
      profile: 'dev',
      cache: 'cold',
    },
    commands: ['wanyrix experiment create --from FER-WRK-007  # plan drafted, awaiting approval'],
    stages: EXP_STAGES_DRAFT,
  },
]

