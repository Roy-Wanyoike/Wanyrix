# Wanyrix — Repository Audit & Gap Matrix (EPIC 00)

> Evidence-first audit performed against the actual repository, not README
> claims. Baseline commit at audit time: `524468c` (engine v0.7.0).
> Every claim below was verified by reading source or running gates —
> anything not yet verified is labeled as such.

## Baseline (measured)

| Dimension | State |
| --- | --- |
| Branch / commit | `main` @ `524468c` |
| Engine | `wanyrix-engine` v0.7.0 — 20 source files, 10,437 LOC, 15 CLI surfaces, 139 tests |
| Web | Next.js 16 + TS + Tailwind 4 + shadcn/ui — 18 API routes, 290 tests (429 total) |
| Docs | ARCHITECTURE, CLI, CLOUD_DESIGN, COMMERCIAL, CONTRIBUTING, DEVELOPMENT, PERFORMANCE, PLUGIN_AND_EVENTS, PRIVACY, SECURITY, USER_GUIDE, W-EIR |
| License | Dual MIT OR Apache-2.0, open-core (cloud may be proprietary, trademark carved out) |
| Tracker | #66 open (commercial roadmap; items 1–7 cloud-blocked), everything else closed with evidence |
| Known external blocker | GitHub Actions billing lock (CI/release cannot run user-side); cron webDevReview compensates locally |

## Critical chain status

`Rust repo → Cargo/rustc/Git → W-EIR → Engineering Graph → Finding → Doctor → Experiment → Measurement → Verification`

| Link | State |
| --- | --- |
| Rust repo → Cargo | **Shipped** — scan.rs walks manifests; model.rs is the single source of truth |
| rustc | **Shipped** — telemetry (redacted ingest) + build.rs (real instrumented `cargo build --message-format=json`) |
| **Git** | **MISSING** — `.git` is explicitly skipped by the walk (`scan.rs`); no git2, no `git` invocation anywhere in engine/src. Designed-only. |
| W-EIR | **Shipped (local model)** — WorkspaceScan/Edge/Finding/Experiment + versioned envelopes; canonical snapshot spec in docs/W-EIR.md |
| Engineering graph | **Shipped** — build_graph + SCCs; derived only from the measured edge list |
| Finding → Doctor | **Shipped** — deterministic findings, doctor is the flagship surface |
| Experiment → Measurement → Verification | **Shipped** — ledger + honesty gates (estimated ≠ measured ≠ verified) + durable event log |
| Persistence/memory | **Partial** — SQLite store persists scans+findings; events.jsonl mirrors transitions; **no query surface reconstructs the chain** |
| Change intelligence (`impact`, `what-changed`, `compare`) | **MISSING** — no reverse-dependency blast-radius command, no snapshot diff, no time machine |

## Gap matrix (capabilities from the master backlog)

| Capability | Exists | Works | Tested | Integrated | Documented | Production-ready |
| --- | --- | --- | --- | --- | --- | --- |
| CLI (15 surfaces, stable exit codes) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Daemon (UDS, cached scan) | ✅ | ✅ | ✅ | partial (web liveness probe) | ✅ | ✅ (local) |
| Storage (SQLite WAL, fsck) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Doctor / findings / evidence | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Graph / dependencies | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Build intelligence (instrumented) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Experiments / verification / events | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Local AI (digest-only, loopback) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ (local) |
| Workspace bridge (connect project) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| **Git intelligence** | ❌ | ❌ | ❌ | ❌ | design-only | ❌ |
| **Change impact (`impact`)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **What changed (`what-changed`)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Time machine (`compare`)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Engineering memory (chain queries) | partial | ❌ | ❌ | ❌ | partial | ❌ |
| Dependency/Rust upgrade intelligence | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Architecture constitution (rules/CI) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI integrity adversarial suite | partial (web) | ✅ | partial | — | partial | ❌ |
| CI/PR intelligence | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cloud sync / team / fleet | ❌ | ❌ | ❌ | ❌ | design (#61, #66) | ❌ (deliberate) |
| Adversarial-repo hardening suite | partial (scan tolerances) | ✅ | partial | — | ❌ | ❌ |
| Performance ladder (10→1000 crates) | partial (synth + PERF notes) | ✅ | ❌ (not tracked) | — | partial | ❌ |
| Dogfooding (Wanyrix on Wanyrix) | incidental | — | — | — | ❌ | ❌ |

## Risk register (top)

1. **R1 — Chain hole: Git intelligence missing.** The master chain advertises
   `Cargo/rustc/Git → W-EIR`; the Git link does not exist. Highest-value
   locally-buildable fix. → issue: Git intelligence surface.
2. **R2 — No deterministic change intelligence.** `impact`/`what-changed` are
   the product's core promise ("what does this change touch?") and are absent
   even though the measured edge list and scan store make them trivial to
   derive. → issue: impact + what-changed surfaces.
3. **R3 — Web/engine contract drift.** New engine surfaces must be wired into
   the dashboard with versioned envelopes, or the product story ("every screen
   connects to real engine data") regresses. → issue: web wiring.
4. **R4 — Unverified UI quality claims.** "Production-ready" requires browser
   evidence for visibility/contrast, responsiveness, dead controls, a11y.
   → issue: UI quality audit round.
5. **R5 — Hostile input tolerance is ad-hoc.** Scanner handles broken
   manifests/parse failures, but no systematic adversarial fixture suite
   (unicode paths, symlinks, huge files, deep nesting, malformed lockfiles).
   → issue: adversarial hardening fixtures.
6. **R6 — Dogfooding is not institutionalized.** Wanyrix has never published
   an analysis of itself. → issue: dogfooding run.

## Prioritized execution order for this round

```text
P1  Git intelligence surface        → engine PR (v0.8.0)
P1  impact + what-changed surfaces  → same engine PR (deterministic change intelligence)
P1  Web wiring for the new surfaces → web PR
P1  UI quality & responsiveness     → web PR (agent-browser driven)
P2  Adversarial hardening fixtures  → engine PR (tests only)
P2  Dogfooding run                  → docs PR + follow-up issues
```

Cloud items (sync, tiers, team, fleet, API/CI) remain tracked under #66 —
they need the backend-infrastructure decision and are deliberately not
duplicated here.
