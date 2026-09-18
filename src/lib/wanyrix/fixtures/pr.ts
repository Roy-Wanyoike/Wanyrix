/**
 * fixtures/pr — PR build-regression analysis fixtures (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (PR_184, PR_97_ATLAS) is
 * unchanged.
 * Types: PRAnalysis comes from ../types — no type is defined here.
 */
import type { PRAnalysis } from '../types'

// ---------------------------------------------------------------------------
// PR regression analysis
// ---------------------------------------------------------------------------

export const PR_184: PRAnalysis = {
  number: 184,
  title: 'feat(db): add persistence retry layer',
  author: 'mgarret',
  branch: 'feat/db-retry',
  base: 'main',
  before: 31.2,
  after: 44.8,
  regressionPct: 43.6,
  affectedCrates: 18,
  confidence: 91,
  confidenceClass: 'high',
  causeChain: [
    { label: 'database/Cargo.toml', note: '+ sqlx 0.8 with default features', kind: 'dep' },
    { label: 'sqlx', note: '+14 crates, +3 proc-macros', kind: 'proc-macro' },
    { label: 'database crate', note: '+6.1s compile time', kind: 'crate' },
    { label: '18 downstream crates', note: 'full rebuild on every database change', kind: 'fanout' },
  ],
  comment:
    '⚠ **Build Performance Regression**\n\nThis PR increases estimated incremental build time by **43.6%** (31.2s → 44.8s).\n\n**Primary cause:** `database → sqlx` dependency expansion with default features enabled.\n\n**Evidence:**\n- `Cargo.lock`: +14 crates, +3 proc-macro crates\n- `cargo build --timings`: database 6.1s → 12.2s\n- Blast radius: 18 downstream crates re-invalidate on `database` changes\n\n**Suggested alternatives:**\n1. Isolate sqlx behind a `database-impl` crate\n2. Split database types from implementation\n3. Reduce enabled sqlx features (`runtime-tokio-rustls` only)\n\n_Estimated values — not verified until an experiment is run._',
  suggestions: [
    {
      title: 'Isolate sqlx behind database-impl',
      detail: 'Keep sqlx and its proc-macros out of the public API of database.',
      estimatedSaving: '≈ −8.4s incremental for 16 downstream crates',
    },
    {
      title: 'Split database types from implementation',
      detail: 'Move DTOs and error types into database-types (no sqlx dependency).',
      estimatedSaving: '≈ −5.2s for 12 downstream crates',
    },
    {
      title: 'Reduce sqlx features',
      detail: 'default-features = false, features = ["runtime-tokio-rustls", "postgres"].',
      estimatedSaving: '≈ −3.1s clean build',
    },
  ],
  checks: [
    { name: 'wanyrix/build-impact', status: 'fail', duration: '12s' },
    { name: 'wanyrix/graph-diff', status: 'pass', duration: '8s' },
    { name: 'wanyrix/evidence-lint', status: 'pass', duration: '2s' },
    { name: 'ci/build', status: 'pass', duration: '4m12s' },
    { name: 'ci/test', status: 'pass', duration: '6m48s' },
  ],
  files: [
    { name: 'database/Cargo.toml', additions: 4, deletions: 1 },
    { name: 'database/src/retry.rs', additions: 214, deletions: 0 },
    { name: 'database/src/pool.rs', additions: 38, deletions: 12 },
    { name: 'Cargo.lock', additions: 96, deletions: 2 },
  ],
}

// ------------------------------------------------------- atlas: PR analysis
// Workspace-scoped PR regression (round 8): atlas-consortium's own guard
// case. PR #97 is the merged refactor referenced by the atlas health feed —
// it introduced bytes 1.9.0 next to 1.8.0 (the DUPLICATES_ATLAS bytes group)
// and amplified atlas-common touches to an 18-crate rebuild.

export const PR_97_ATLAS: PRAnalysis = {
  number: 97,
  title: 'refactor(common): unify buffer pooling behind atlas-common',
  author: 'dchen',
  branch: 'refactor/buffer-pool',
  base: 'main',
  state: 'merged',
  before: 6.8,
  after: 11.8,
  regressionPct: 73.5,
  affectedCrates: 18,
  confidence: 88,
  confidenceClass: 'high',
  causeChain: [
    { label: 'atlas-common/Cargo.toml', note: '+ bytes 1.9.0 via pool-helper vendoring', kind: 'dep' },
    { label: 'bytes', note: '1.8.0 + 1.9.0 now compile side by side', kind: 'crate' },
    { label: 'atlas-common', note: '+2.1s compile from duplicate artifacts', kind: 'crate' },
    { label: '18 downstream crates', note: '78% of the workspace re-invalidates on every atlas-common touch', kind: 'fanout' },
  ],
  comment:
    '⚠ **Build Performance Regression**\n\nThis PR increases estimated incremental build time for atlas-common touches by **73.5%** (6.8s → 11.8s).\n\n**Primary cause:** the pooled buffer helper vendored `bytes 1.9.0` next to the workspace\u2019s `bytes 1.8.0`.\n\n**Evidence:**\n- `cargo tree -d`: bytes resolved to two versions (1.8.0 · 1.9.0)\n- `cargo build --timings`: atlas-common 4.6s → 6.7s\n- Blast radius: 18 downstream crates re-invalidate on `atlas-common` changes (78% of workspace)\n\n**Suggested alternatives:**\n1. Re-point the pool helper onto bytes 1.8 (`cargo update -p bytes@1.9.0 --precise 1.8.0`)\n2. Extract a stable `atlas-bytes` crate (see ATL-WRK-005)\n3. Gate the pooling helper behind an optional feature\n\n_Estimated values — not verified until an experiment is run._',
  suggestions: [
    {
      title: 'Re-point pool helper onto bytes 1.8',
      detail: 'One lockfile line — removes the duplicate build entirely.',
      estimatedSaving: '≈ −2.1s incremental for 18 downstream crates',
    },
    {
      title: 'Extract stable atlas-bytes crate',
      detail: 'Buffer abstractions rarely change; glue code stays in atlas-common.',
      estimatedSaving: '≈ −6.2s median incremental on common touches',
    },
    {
      title: 'Gate pooling behind a feature flag',
      detail: 'default-features = false for ingest-only consumers that need the pool.',
      estimatedSaving: '≈ −1.4s clean build for bins',
    },
  ],
  checks: [
    { name: 'wanyrix/build-impact', status: 'fail', duration: '9s' },
    { name: 'wanyrix/graph-diff', status: 'pass', duration: '6s' },
    { name: 'wanyrix/evidence-lint', status: 'pass', duration: '2s' },
    { name: 'ci/build', status: 'pass', duration: '3m51s' },
    { name: 'ci/test', status: 'pass', duration: '5m02s' },
  ],
  files: [
    { name: 'atlas-common/Cargo.toml', additions: 3, deletions: 1 },
    { name: 'atlas-common/src/pool.rs', additions: 186, deletions: 12 },
    { name: 'atlas-common/src/lib.rs', additions: 14, deletions: 2 },
    { name: 'Cargo.lock', additions: 9, deletions: 1 },
  ],
}

