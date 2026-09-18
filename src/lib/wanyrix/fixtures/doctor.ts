/**
 * fixtures/doctor — doctor report fixtures (helios-platform + atlas-consortium).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (DOCTOR, DOCTOR_ATLAS) is
 * unchanged.
 * Types: DoctorReport comes from ../types — no type is defined in this module.
 */
import type { DoctorReport } from '../types'
import { ATLAS_FINDINGS, FINDINGS } from './findings'
import { WORKSPACE, WORKSPACE_ATLAS } from './workspaces'

export const DOCTOR: DoctorReport = {
  workspace: WORKSPACE.name,
  profile: WORKSPACE.profile,
  toolchain: WORKSPACE.toolchain,
  buildTime: 87.4,
  estimatedRange: [49, 61],
  confidence: 82,
  criticalPath: [
    { name: 'common-runtime', seconds: 18.3, kind: 'workspace' },
    { name: 'api', seconds: 12.7, kind: 'workspace' },
    { name: 'proc-macro chain', seconds: 15.4, kind: 'proc-macro' },
    { name: 'tokio', seconds: 8.2, kind: 'external' },
    { name: 'syn', seconds: 7.8, kind: 'external' },
    { name: 'serde', seconds: 6.1, kind: 'external' },
    { name: 'linking + codegen', seconds: 18.9, kind: 'linker' },
  ],
  findings: FINDINGS,
  scannedAt: WORKSPACE.lastScan,
  phases: [
    { label: 'Parsing cargo metadata', detail: '47 workspace crates · 212 edges' },
    { label: 'Reading Cargo.lock', detail: '3 duplicate version groups found' },
    { label: 'Ingesting build timings', detail: 'cargo build --timings · dev profile · 87.4s' },
    { label: 'Analyzing git history', detail: '1,204 commits · 90 days' },
    { label: 'Profiling proc macros', detail: '3 version sets · 14 derive crates' },
    { label: 'Checking feature unification', detail: 'resolver v1 · 2 duplicate artifacts' },
    { label: 'Correlating CI telemetry', detail: '50 jobs · 68% cache miss' },
    { label: 'Consulting engineering graph', detail: 'W-EIR snapshot 9f31c2a · verified' },
  ],
  summary: { developerBuild: '−34%', ciBuild: '−41%', diskUsage: '−27%' },
  criticalPathExplanation: 'common-runtime blocks 41 crates; split proposal verified in EXP-014',
  criticalPathCaption:
    'proc-macro chain = syn + quote + proc-macro2 compiled in 3 version sets (WAN-BLD-004) · linking includes codegen',
}

export const DOCTOR_ATLAS: DoctorReport = {
  workspace: WORKSPACE_ATLAS.name,
  profile: WORKSPACE_ATLAS.profile,
  toolchain: WORKSPACE_ATLAS.toolchain,
  buildTime: 52.8,
  estimatedRange: [31, 40],
  confidence: 78,
  criticalPath: [
    { name: 'atlas-store', seconds: 14.2, kind: 'workspace' },
    { name: 'atlas-query', seconds: 9.6, kind: 'workspace' },
    { name: 'proc-macro chain', seconds: 6.8, kind: 'proc-macro' },
    { name: 'tokio', seconds: 4.4, kind: 'external' },
    { name: 'arrow (×2)', seconds: 5.2, kind: 'external' },
    { name: 'linking + codegen', seconds: 12.6, kind: 'linker' },
  ],
  findings: ATLAS_FINDINGS,
  scannedAt: WORKSPACE_ATLAS.lastScan,
  phases: [
    { label: 'Parsing cargo metadata', detail: '23 workspace crates · 96 edges' },
    { label: 'Reading Cargo.lock', detail: '2 duplicate version groups found' },
    { label: 'Ingesting build timings', detail: 'cargo build --timings · dev profile · 52.8s' },
    { label: 'Analyzing git history', detail: '861 commits · 90 days' },
    { label: 'Profiling proc macros', detail: '1 version set · 6 derive crates' },
    { label: 'Checking feature unification', detail: 'resolver v1 · datafusion pulled into atlas-cli' },
    { label: 'Correlating CI telemetry', detail: '18 jobs · 41% cache miss' },
    { label: 'Consulting engineering graph', detail: 'W-EIR snapshot c7d21ef · verified' },
  ],
  summary: { developerBuild: '−27%', ciBuild: '−33%', diskUsage: '−19%' },
  criticalPathExplanation: 'atlas-store blocks 18 crates; the core/lsm split proposal is experiment-ready',
  criticalPathCaption:
    'arrow compiled twice (ATL-DEP-003) · linking includes codegen · dev profile debug level 2',
}

