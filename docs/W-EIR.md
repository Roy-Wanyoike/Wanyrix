# W-EIR — Wanyrix Engineering Intermediate Representation

W-EIR is the normalized evidence model every Wanyrix surface derives from. This
document describes W-EIR **as actually encoded in this repository**: types live in
`src/lib/wanyrix/types.ts`, fixture data in the per-domain modules under
`src/lib/wanyrix/fixtures/` (re-exported through the `data.ts` barrel), serialization
in `report.ts` + `flavors.ts`, and the Rust-side engine that measures the same shapes
lives in-tree under `engine/` (see `engine/README.md`).

```text
Engine → Collectors → W-EIR → Engineering Graph → Analyzers
      → Findings → Recommendations → Experiments → Measurements → Verification
```

## Core entity types (as encoded)

| Entity | Type | Where it surfaces |
| --- | --- | --- |
| Finding | `Finding` (`id, section, severity, title, description, evidence[], affected[], impact, impactSeconds?, recommendation, remediationKind, verificationPath, confidenceClass, confidence, detection, measurementStatus, experimentEligible?`) | `/doctor`, Findings view, `/report` |
| Evidence item | `Evidence {label, value, source}` — source names the origin (`cargo build --timings`, `git log`, `cargo metadata graph`, …) | inside every finding; ≥2 items asserted by tests |
| Doctor snapshot | `DoctorReport` (`workspace, profile, toolchain, buildTime, estimatedRange, confidence, criticalPath[], findings[], scannedAt, phases[], summary`) | `/doctor` |
| Graph node/edge | `GraphNode` (`band, kind, buildTime, fanIn, fanOut, downstream, changeFreq, versions?, duplicate?, critical?`) · `GraphEdge {from, to}` | `/graph` |
| Graph payload | `GraphPayload` (`nodes, edges, duplicates[], blast[], meta{scope:'backbone-subset', aggregateSource:'served-edges', …}, catalog?, resolutions?`) | `/graph` |
| Blast entry | `BlastEntry {file, crate, affectedWorkspace, chain[], incrementalDelta, suggestion}` | `/graph` |
| Impact results | `AddDepImpact` · `EditFileImpact` · `SplitImpact` · `UpgradeImpact` — union `ImpactPayload`, each carrying `measurementStatus` | `/impact` |
| Experiment | `Experiment` (`status: verified\|running\|draft`, `claim: MeasurementStatus`, `baseline/candidate {seconds, runs, measuredAt}`, `tests`, `environment`, `commands[]`, `stages[]`) | `/experiments` |
| Release gate | `Gate {id, name, objective, target, measured, status: pass\|conditional\|fail\|pending, evidence, blocking}` · `BlockingCondition` | `/gates`, scorecard flavor |
| Traceability item | `IssueItem` (`id, ghIssue, title, gate, labels[], state, pr{…}\|null, verification?, repoUrl`) | `/issues` |
| Health / activity | `HealthPayload` (`kpis, buildTrend[], slowestCrates[], activity[], findingCounts[]`) | `/health`, Overview |
| Storage state | `StoragePayload` (`rows[], totalMB, lastGc, retention, bound, reclaimedTotalMB?`) — row 1 is labeled *"Database (SQLite · W-EIR snapshots)"* in the platform report | `/storage` |
| Workspace registry | `WorkspaceSummary` (`id, name, description, crates, edges, toolchain, accent, status: live\|archived, findings, lastScan`) · `WorkspacesPayload` | `/workspaces` |
| Explain envelope | `ExplainRequest` (`context, question, kind?`) · `ExplainResponse` (+`grounding`, `provenance`, `ai`, `disclaimer`, `groundingViolations`) | `/explain` |

## Identity & stability rules

- **Findings** are stable-ID diagnoses with the historic `FER-<SECTION>-<nnn>` scheme
  (e.g. `FER-BLD-001`); the prefix predates the 2026-09 identity rename and is retained
  by design — IDs are stable contracts, not brand surface. Newer registries use `WAN-*`
  (issues) and `EXP-*` (experiments). IDs are stable across every surface, so the
  doctor, the graph, the traceability board, and report flavors cross-reference
  without joins.
- **Workspaces** are stable ids (`helios-platform`, `atlas-consortium`) resolved through
  one guard (`workspaceGuard`) against one registry; unknown ids are a hard 404 — a
  W-EIR-derived artifact can never carry a `workspace` field that does not match its
  contents.
- **Severity/confidence vocabularies are closed enums**: `Severity = critical | warning |
  info` (there is no "high" named severity in the API — consumers must not invent one),
  `ConfidenceClass = deterministic | high | medium | estimated`,
  `MeasurementStatus = measured | estimated | verified`.

## The six provenance states mapped to real fields

W-EIR distinguishes *where a claim came from* from *how sure we are*. Both are data:

| Provenance state | Encoded as | Rules enforced in this repo |
| --- | --- | --- |
| **AUTHORITATIVE OBSERVATION** | `Evidence[]` items (`label/value/source`) on findings; `measured` numbers in `DoctorReport.buildTime`, `Gate.measured`; `Experiment.baseline/candidate` with `runs` + `measuredAt` | every evidence item names its source; observed values are never placed inside an estimated range |
| **MEASURED** | `measurementStatus: 'measured'` | paired with `confidenceClass` — deterministic-confidence claims are exactly the `measured` ones (asserted by the report tests) |
| **VERIFIED** | `measurementStatus: 'verified'` | reachable **only** through a recorded experiment (`Experiment.claim`, Gate 21); the simulator and AI can never emit it |
| **ESTIMATE** | `measurementStatus: 'estimated'` + `estimatedRange: [low, high]` (`DoctorReport`), structured `estimatedAfterFix {estimatedRange: {low, high}, status, meaning}` (`wanyrix.report/v1`), all `ImpactPayload` fields | estimates are projections with explicit semantics ("after top fix"), never confidence intervals around a measured value (ENG-TCA-5) |
| **INFERENCE** | derived aggregates: `GraphNode.fanIn/fanOut/downstream`, `BlastEntry.affectedWorkspace`, `recompileCrates` — all computed from the served edge list (`meta.aggregateSource: 'served-edges'`, ENG-TCA-3); architecture-view heuristics badged INFERRED; explain's `INFERENCE` section is confined to `ai.inference` | derivations must be recomputable from the artifact they accompany; no hand-typed counts |
| **RECOMMENDATION** | `Finding.recommendation` + `remediationKind` (`command\|config\|architecture\|experiment\|patch`) + `verificationPath`; explain's `ai.recommendation`; graph `DuplicateResolution.note` | recommendations never auto-apply; patches are new-proposal reviewable diffs behind approval (Gate 19) |

Calibration rides alongside: `confidence: 0–100` (numeric) and `confidenceClass`
(`deterministic/high/medium/estimated`, Gate 13) on findings and PR analyses.

## Snapshots, history, and the workspace registry

- The platform's storage view models W-EIR persistence as bounded rows (SQLite · W-EIR
  snapshots, WAL, `integrity_check OK`) — labeled **simulated** in this repo; the real
  engine owns the database (AUDIT-I8).
- Scan history is a **per-browser** log (`wanyrix.scan-store`, `wanyrix.scan-history/v1`
  shape) — the server-side flavor serves `runs: []` and says so rather than fabricating
  durations (Gate 21).
- The registry (`/workspaces`) is the single source the workspace guard validates
  against, so every snapshot is attributable to a known workspace id.

## Serialization contract — versioned flavors

W-EIR leaves this repo through four versioned envelopes (all served by `/report`,
mirrored by the CLI contract — `docs/CLI.md`):

| Flavor | Param | Shape notes |
| --- | --- | --- |
| `wanyrix.report/v1` | `format=json` | full workspace snapshot; structured `buildTime {value, unit}` + `estimatedAfterFix`; `honestyNotes[]` |
| `wanyrix.markdown/v1` | `format=markdown` (default) | `{schema, filename, markdown, bytes}` envelope |
| `wanyrix.release-scorecard/v1` | `flavor=scorecard` | `verdict, rationale, gates[], blockingConditions[]` |
| `wanyrix.scan-history/v1` | `flavor=scan-history` | `workspace, exportedAt, note, runs[]` (empty server-side) |

Flavors are additive and versioned so consumers can pin a schema; the explain route's
`grounding.facts[].derivedFrom` provenance (`registry:findings.title`,
`context.buildTime`, …) is the field-level traceability layer on top.
