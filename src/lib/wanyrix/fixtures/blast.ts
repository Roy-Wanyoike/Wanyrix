/**
 * fixtures/blast — file blast-radius fixtures (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (BLAST, BLAST_ATLAS) is
 * unchanged.
 * Types: BlastEntry comes from ../types — no type is defined in this module.
 * RAW_BLAST / RAW_BLAST_ATLAS stay module-private, exactly as inside data.ts.
 */
import type { BlastEntry } from '../types'
import { ATLAS_MATH, HELIOS_MATH } from './graph'

/** Blast entries without the derived numbers — those come from the edge closure. */
const RAW_BLAST: Omit<BlastEntry, 'affectedWorkspace' | 'chain'>[] = [
  {
    file: 'common/src/error.rs',
    crate: 'common',
    incrementalDelta: 12.8,
    suggestion: 'Move error abstractions into common-types (WAN-WRK-007).',
  },
  {
    file: 'common-runtime/src/scheduler.rs',
    crate: 'common-runtime',
    incrementalDelta: 18.3,
    suggestion: 'Split scheduler into runtime-telemetry (WAN-BLD-001).',
  },
  {
    file: 'database/src/pool.rs',
    crate: 'database',
    incrementalDelta: 9.6,
    suggestion: 'Isolate sqlx behind database-impl (see PR #184 suggestions).',
  },
  {
    file: 'api/src/routes.rs',
    crate: 'api',
    incrementalDelta: 13.1,
    suggestion: 'Cheap downstream — good place for iteration.',
  },
  {
    file: 'telemetry/src/otlp.rs',
    crate: 'telemetry',
    incrementalDelta: 4.4,
    suggestion: 'Consider feature-gating the OTLP exporter.',
  },
]

/** served blast entries — affectedWorkspace == nodes[crate].downstream == edge closure. */
export const BLAST: BlastEntry[] = RAW_BLAST.map((b) => ({
  ...b,
  affectedWorkspace: HELIOS_MATH.workspaceBlastRadius(b.crate),
  chain: HELIOS_MATH.chainToRoot(b.crate),
}))

const RAW_BLAST_ATLAS: Omit<BlastEntry, 'affectedWorkspace' | 'chain'>[] = [
  {
    file: 'atlas-common/src/bytes.rs',
    crate: 'atlas-common',
    incrementalDelta: 11.8,
    suggestion: 'Extract atlas-bytes (stable) — expect fan-out to drop to ≤5 (ATL-WRK-005).',
  },
  {
    file: 'atlas-store/src/lsm/memtable.rs',
    crate: 'atlas-store',
    incrementalDelta: 14.2,
    suggestion: 'The memtable trait is volatile — isolate behind atlas-store-core.',
  },
  {
    file: 'atlas-schema/src/record.rs',
    crate: 'atlas-schema',
    incrementalDelta: 5.4,
    suggestion: 'Schema derives churn — move procedural macros to atlas-proto and version the record wire format.',
  },
  {
    file: 'atlas-ingest/src/writer.rs',
    crate: 'atlas-ingest',
    incrementalDelta: 2.8,
    suggestion: 'Writer internals are self-contained — safe to iterate quickly (also see ATL-ASY-007).',
  },
]

/** served blast entries — affectedWorkspace == nodes[crate].downstream == edge closure. */
export const BLAST_ATLAS: BlastEntry[] = RAW_BLAST_ATLAS.map((b) => ({
  ...b,
  affectedWorkspace: ATLAS_MATH.workspaceBlastRadius(b.crate),
  chain: ATLAS_MATH.chainToRoot(b.crate),
}))

