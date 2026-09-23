# Wanyrix — Threat Model (draft, STRIDE-lite)

Status: **draft shipped with the governance bundle (#119, 2026-09-22)**. Method:
**STRIDE-lite** — a categorical Spoofing / Tampering / Repudiation / Information
disclosure / Denial of service / Elevation-of-privilege walk over each named trust
boundary, every row linked to the control that enforces it (or an explicit
accepted-risk statement). This is a structured review of the controls documented in
[`SECURITY.md`](SECURITY.md), not a formal verification; claims here are only as strong
as their evidence links.

Scope: the shipped **local-first** product — the Rust engine (`wanyrix-engine`), the
Next.js web console, and their local stores. Out of scope (design-only, nothing
implemented): the hosted cloud layer ([`CLOUD_DESIGN.md`](CLOUD_DESIGN.md)) and the
out-of-process plugin runtime ([`PLUGIN_AND_EVENTS.md`](PLUGIN_AND_EVENTS.md)); both
are boundary-marked below so their future threat models extend this one instead of
replacing it. Production serving of the web console (`next start`) is likewise out of
scope for the local-first demonstrator ([`SECURITY.md`](SECURITY.md) §1/§8).

## 1. Assets (what we protect, in priority order)

| # | Asset | Why it matters |
| --- | --- | --- |
| A1 | **The honesty guarantees themselves** (Estimated ≠ Measured ≠ Verified; no fabricated evidence) | The product's core claim; a tampered status is the worst-case outcome |
| A2 | Measured evidence & ledgers (scan envelopes, experiment ledger, event log, export artifacts) | Decisions are made on these; they are receipts |
| A3 | Source code under analysis (read-only during scans) | The engine reads user workspaces; it must never modify them |
| A4 | Local stores (browser localStorage, `db/custom.db` SQLite, `.wanyrix/*` dotfiles, `exports/`) | User data; zero-telemetry posture means local-only copies exist |
| A5 | Key material (embedded release verification key, issuer signing keys, `WANYRIX_SIGNING_KEY`) | Offline entitlement trust root |
| A6 | User privacy — nothing transmits unless explicitly configured | [`PRIVACY.md`](PRIVACY.md) is the product contract |

## 2. Trust boundaries

```text
 ┌──────────────────────────────────────────  one user's machine  ──────────────────────┐
 │                                                                                     │
 │  browser ◀── TB1 ──▶ Next.js server (unauthenticated, loopback) ── TB2 ──▶ engine    │
 │    │                        │                        │                    binary    │
 │  localStorage          TB5 (writes)             TB3: scanned repo = UNTRUSTED INPUT │
 │                          ▼                            (mounted at a user-chosen     │
 │                  SQLite db/custom.db,                  path; read-only analysis)    │
 │                  .wanyrix/* ledgers, exports/                                             │
 │                                                                                     │
 │  operator ── TB4 ── entitlement / license issuance (offline ed25519) ◀─ releases ──┘ │
 └──────────────────────────────────────────────────────────────────────────────────────┘
   TB6 (future, out of scope): plugins ◀─ capability-checked by manifest, design-only
   TB7 (future, out of scope): cloud sync ◀─ explicit configured target, design-only
```

## 3. STRIDE-lite analysis

### TB1 — browser ↔ local web server

The API surface (`/api/wanyrix/*`, 23 route files) is **unauthenticated by design** —
local-first means the operator's own machine is the trust domain; there are no
accounts, sessions, or cookies (`SECURITY.md` §1). The boundary control is the
network bind: the guarded `dev` script starts the server on `127.0.0.1` only, so the
surface is reachable from the machine itself (`SECURITY.md` §1, with the start-time
honesty notes).

| Threat | Status | Control / evidence |
| --- | --- | --- |
| S — caller spoofing another user/workspace | **Accepted-by-design** (single local user) + workspace guard: unknown `ws` → `404 {error, knownWorkspaces}`, never wrong-workspace data (ENG-TCA-1) | `SECURITY.md` §3 |
| T — fabricated data entering the record | **Mitigated** for provenance: the server never invents data (Gate 21); scan-run rows store exactly what the client POSTed, labeled as client-supplied — see TB4 for the accepted forgery risk | `SECURITY.md` §1 |
| R — repudiation of actions | **Accepted-local-only** (single-user machine; no audit surface claimed) | — |
| I — disclosure beyond the machine | **Mitigated by loopback bind**; response-bodies naming absolute server paths are documented (registration/scan-target echo) and kept server-side detail | `SECURITY.md` §3; API review |
| D — denial of service | **Partially mitigated**: payload caps (`/explain` 256 KB → 413, scan-runs 5 MB → 413), bounded work per route | live-probe measured (`PERFORMANCE.md` method) |
| E — privilege escalation | **None to escalate**: no auth, no accounts, no session state; the app authorizes nothing (`SECURITY.md` §1) | — |

### TB2 — web server ↔ engine binary

The server spawns the engine via `execFile(binary, args[])` — argv array, no shell
anywhere in `src/`; engine args come from server-side constants plus registry-resolved
workspace paths, never raw caller strings (`SECURITY.md` §3).

| Threat | Status | Control / evidence |
| --- | --- | --- |
| S/T — command or argument injection | **Mitigated**: no shell interpolation; argument-style payloads (`--version`, `--path` as crate ids) are refused by the engine's own CLI parser | live probes, 2026-09-22 security review |
| T — caller-supplied path smuggled to the engine | **Constrained**: the one validated user string that becomes a filesystem path is the registration `--path`, passed only after workspace-root confinement (`WANYRIX_WORKSPACE_ROOTS` realpath containment); read-only scan afterwards | `SECURITY.md` §3 (QA-3-B-2) |
| I — filesystem oracle via registration errors | **Mitigated**: one generic refusal naming only the env remedy; contained-but-unscannable candidates share one 404 message, reason server-log only | `SECURITY.md` §3 |
| D — engine hangs/loop via hostile target | **Mitigated at TB3** (bounded walks, regular-file guard); route-level honest 503 when the binary is absent | `SECURITY.md` §1 |

### TB3 — engine ↔ scanned repository (UNTRUSTED INPUT)

The engine treats a repository as hostile input: a named finding (`FER-ENG-ERR-n`) or
named error (`EngineError`) — never a panic, never a hang, never a silent drop. The
24-test adversarial suite pins the contract case by case (`SECURITY.md` §9).

| Threat | Status | Control / evidence |
| --- | --- | --- |
| T — hostile manifest/paths crash or corrupt the scan | **Mitigated**: invalid TOML → critical finding; binary bytes → named unreadable finding; homoglyph/UTF-8 edge cases round-trip | `SECURITY.md` §9 rows 1–2, 11, 17 |
| D — hangs via symlinks/FIFOs/devices/huge files | **Mitigated** on scan-path reads: symlink/FIFO/device refusal + 16 MiB cap via `pathutil::read_regular_file`; symlink loops → named error; depth cap 48 | `SECURITY.md` §9 rows 4, 7–10 |
| E — code execution during *analysis* | **Mitigated**: analysis never executes workspace code | `SECURITY.md` §9 |
| E — code execution during `wanyrix build` | **NOT mitigated — documented limitation**: a real `cargo build` runs a hostile `build.rs` as arbitrary code; build sandboxing is not claimed by any surface | `SECURITY.md` §9 limitations |
| T — pre-planted engine dotfiles (`.wanyrix/*`) block or spoof surfaces | **Partially mitigated**: scan-path reads hardened; engine-owned dotfiles are still trusted-as-engine-written — regular-file guard for them tracked in #114 | `SECURITY.md` §9 limitations |

### TB4 — operator/browser ↔ entitlement & license issuance

Offline ed25519 entitlement (`activate`/`entitlement`/`license`): tokens are verified
against the embedded release public key (or the documented operator override), the
signature is re-checked on **every** cache read, and a tampered cache is a named
refusal — a refused token is never cached (measured end-to-end, 2026-09-22 engine QA).

| Threat | Status | Control / evidence |
| --- | --- | --- |
| S — forged entitlement tokens | **Mitigated**: ed25519 signatures (`ed25519-dalek`, the one deliberate dependency deviation); key resolution is lazy so the free tier stays honest even before a release key exists | `COMMERCIAL.md` §Signing |
| T — tampered activation cache | **Mitigated**: re-verified on every read; tamper → named refusal | engine entitlement suite |
| T/I — forged scan telemetry into the durable log | **Accepted-by-design**: sync surfaces are unauthenticated local writes; the honesty model handles provenance by labeling (client-supplied, Gate 21), not by authentication — a local attacker is already inside TB1's trust domain | `SECURITY.md` §1 |
| I — license key leakage | **Mitigated by hygiene**: `*-priv.hex` outputs are gitignored; `.env` (holding `WANYRIX_SIGNING_KEY`) is gitignored; tree + history spot-checks clean of secrets (2026-09-22 security review) | `SECURITY.md` §2 |
| R — issuer non-repudiation | **Roadmap** (audit logs are an Enterprise tier design item, `COMMERCIAL.md`) | — |

The **release keypair is still the `PENDING_RELEASE_KEY` placeholder** — release-gated
by design; the activation checklist (generate, embed public half, private half never
leaves the signing environment, verify the `activate` journey) lives in
[`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) §6.

### TB5 — processes ↔ local disk artifacts

| Threat | Status | Control / evidence |
| --- | --- | --- |
| I — secrets in the repository | **Mitigated (verified)**: no secrets in tracked files; `.env` gitignored and holds a local DB path, not a credential; pattern-scan of all tracked files + history spot-checks clean | `SECURITY.md` §2 |
| I — data leaves the machine | **Mitigated by absence**: no telemetry/analytics endpoints ship; AI explain forwards only the explicitly submitted payload (capped); cloud paths are design-only | `PRIVACY.md`; `SECURITY.md` §6 |
| T — exports/ledgers silently altered | **Mitigated where claimed**: export artifacts carry sha256 index bindings and are byte-identical on unchanged input (determinism tested) | export contract tests |
| D — disk fill via logs/exports | **Accepted-local-only** (single machine; reclaim semantics exist in the storage surface) | — |

### TB6/TB7 — plugins and cloud (future boundaries, out of scope today)

Nothing implements them, so nothing is claimed. The design-level trust positions are
already fixed and must carry into their future threat models: plugins are
out-of-process, manifest-capability-checked, deny-by-default, with **explicit-path
discovery only** (a cloned repository must never be able to inject code by planting a
conventional plugins directory — decision record in
[`PLUGIN_AND_EVENTS.md`](PLUGIN_AND_EVENTS.md)); the cloud layer is an explicit,
off-by-default sync target that can never upgrade a claim's status
([`CLOUD_DESIGN.md`](CLOUD_DESIGN.md) non-negotiables).

## 4. Assumptions and accepted risks (explicit)

1. **Single-user, single-machine trust domain.** Anything running as the local user
   can call every API surface (unauthenticated, by design) and read every local
   store. Local malware is out of scope — it would already own the user.
2. **The loopback bind is the network boundary.** It is start-time configuration
   enforced by the guarded dev script; any other launch harness must pass an
   equivalent loopback hostname or the reachable set widens beyond these claims
   (`SECURITY.md` §1). Production serving is Roadmap.
3. **No multi-tenant guarantees exist** — none are claimed until auth exists (Roadmap).
4. **`wanyrix build` runs workspace code** (cargo build.rs) — the analysis surfaces are
   hardened; the build surface is not sandboxed (documented limitation).
5. **CI evidence gap:** the hosted Actions runners are billing-locked — all four
   workflows (and any added secret-scanning workflow, #149) have never executed on
   hosted runners and are validated locally only (honesty labels in
   `.github/workflows/`). Compensating control: every gate is runnable locally and the
   documented commands are the verification path; this row retires after the first
   hosted run.

## 5. Security-review provenance

This model incorporates the adversarial review waves of 2026-09-22: black-box API
probing (~230 requests; injection/traversal/arg-injection batteries), the engine
adversarial fixture suite (24 tests), engine end-to-end validation including the
entitlement failure paths, and a whole-repo secrets/history review. Findings and
verified-secure items are recorded in the issue tracker; the control table above links
the durable in-repo evidence.

## 6. Planned tooling map (roadmap — no duplicate config here)

| Layer | Planned tooling | Status / owner |
| --- | --- | --- |
| Secret scanning (CI) | gitleaks-class scanner with an offline-friendly config, carrying the same billing-locked honesty label as the existing workflows | **#149** |
| Dependency updates | `.github/dependabot.yml` — cargo (`engine/`), npm (root), github-actions ecosystems | **#149** |
| Advisory audit | `cargo audit` — already staged in `release.yml`; maintainer invocation documented with #149 | shipped-in-workflow / #149 (docs) |
| SBOM | CycloneDX (`cargo cyclonedx`) — staged in `release.yml` | shipped-in-workflow |
| SAST | CodeQL/Semgrep-class static analysis, offline-friendly config | Roadmap — lands with the hosted-runner unlock; tracked with #149's scope and this file's review triggers |
| DAST | Route-contract fuzzing on a loopback instance (the 2026-09-22 probe batteries are the manual seed) | Roadmap — same gating |
| Artifact signing / provenance | cosign/minisign-class signing of release archives — checklist staged at the bottom of `release.yml` | release-gated; see [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) §5 |

This table maps intent and ownership; the tooling configuration itself lands through
the owning issues (config in `.github/` is deliberately not duplicated here).

## 7. Review triggers (when this model must be re-walked)

- A new trust boundary (plugin runtime, any non-loopback bind, any cloud sync path).
- A new surface class: API route family #24, engine command #24, a new durable ledger.
- Any change to the honesty gates or the entitlement key material (including the
  `PENDING_RELEASE_KEY` swap — [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) §6).
- First hosted CI run (retires the §4.5 billing-lock row).
- At minimum: every minor engine release, as part of the release checklist
  ([`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md)).

Change log: 2026-09-22 — initial STRIDE-lite draft (issue #119).
