/**
 * fixtures/simulator — split-crate simulation fixtures (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (SPLIT_SIM) is unchanged.
 * Types: SplitImpact (in ../types) is applied by the consumer — no type is
 * defined in this module.
 * SPLIT_SIM_ATLAS was module-private in data.ts; it is exported here solely
 * for the sibling fixtures/selectors.ts module (the barrel does NOT re-export).
 */
import { ATLAS_MATH, HELIOS_MATH } from './graph'

export const SPLIT_SIM = {
  source: 'common',
  before: {
    buildSeconds: 42.1,
    // derived from the served graph (ENG-TCA-3): direct dependents + workspace closure
    fanOut: HELIOS_MATH.dependents['common']?.length ?? 0,
    downstream: HELIOS_MATH.workspaceBlastRadius('common'),
    modules: ['types', 'database', 'http', 'auth', 'utilities'],
  },
  proposal: {
    crates: [
      { name: 'common-types', downstream: 4, buildSeconds: 8.4, modules: ['types', 'error', 'ids'] },
      { name: 'common-db', downstream: 2, buildSeconds: 11.2, modules: ['database', 'pool'] },
      { name: 'common-http', downstream: 1, buildSeconds: 9.6, modules: ['http', 'middleware'] },
    ],
    buildSeconds: 29.2,
  },
  improvementPct: 30.6,
  migration: [
    'Create common-types with pure data + error abstractions (no IO)',
    'Re-point fan-out-heavy crates to common-types first (api, gateway)',
    'Move database + pool modules into common-db behind a trait',
    'Extract http middleware into common-http',
    `Verify: served-backbone blast radius of common/src/error.rs drops ${HELIOS_MATH.workspaceBlastRadius('common')} → ≤4 crates`,
  ],
}

export const SPLIT_SIM_ATLAS = {
  source: 'atlas-common',
  before: {
    buildSeconds: 24.6,
    // derived from the served graph (ENG-TCA-3): direct dependents + workspace closure
    fanOut: ATLAS_MATH.dependents['atlas-common']?.length ?? 0,
    downstream: ATLAS_MATH.workspaceBlastRadius('atlas-common'),
    modules: ['bytes', 'schema', 'proto', 'glue'],
  },
  proposal: {
    crates: [
      { name: 'atlas-bytes', downstream: 3, buildSeconds: 3.1, modules: ['bytes'] },
      { name: 'atlas-schema', downstream: 2, buildSeconds: 6.4, modules: ['schema', 'proto'] },
      { name: 'atlas-common', downstream: 1, buildSeconds: 8.9, modules: ['glue'] },
    ],
    buildSeconds: 18.4,
  },
  improvementPct: 25.2,
  migration: [
    'Create atlas-bytes with pure buffer abstractions (no IO)',
    'Re-point atlas-lsm + atlas-sst to atlas-bytes first',
    'Move schema + proto into atlas-schema behind a versioned wire format',
    'Keep glue code in atlas-common (volatile, low fan-out)',
    `Verify: served-backbone blast radius of atlas-common drops ${ATLAS_MATH.workspaceBlastRadius('atlas-common')} → ≤4 crates`,
  ],
}

