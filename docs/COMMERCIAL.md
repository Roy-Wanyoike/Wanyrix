# The Wanyrix commercial model — local-first, cloud-enhanced

Status: **maintainer-ratified strategy (2026-09)** — the resolution direction of
issue #62. Product rule first, tiers second:

> **Install locally. Understand your systems privately. Use it offline.
> Connect when you want. Pay when you need collaboration, scale, governance,
> and organizational intelligence.**

## Product rule #1 — local is never a crippled trial

The local deterministic product is **genuinely excellent and permanently
free** — never a gated demo for the paid tier. A developer who never pays
loses exactly one thing: cloud sync and team features. Nobody's local
engineering data is ever withheld, expired, or held hostage. Trust is the
adoption engine; adoption is the business.

```text
FREE LOCAL TOOL → developer adoption → repositories analyzed →
engineering history accumulated → developer sees value →
cloud synchronization → team adoption → shared intelligence →
organization policies → fleet intelligence → enterprise
```

## What is free locally (and always will be)

| Capability | Status |
| --- | --- |
| Unlimited local repositories (point the CLI at any Rust workspace) | **shipped** — `wanyrix init/doctor/graph/health/analyze/dependencies` |
| Cargo & dependency intelligence (edge list, fan-in/out, duplicates, SCC cycles) | **shipped** — `wanyrix.graph/v1`, `wanyrix.dependencies/v1` |
| W-EIR evidence snapshot + versioned contracts | **shipped** — every `wanyrix.*/v1` envelope |
| Build analysis — instrumented real `cargo build` (wall clock, cache-hit rate) | **shipped** — `wanyrix build` |
| Critical-path analysis & blast radius | **shipped** — engine graph + dashboard |
| Incremental analysis (fingerprint-invalidated daemon cache) | **shipped** — `wanyrix daemon` |
| Findings with evidence, calibrated confidence | **shipped** — `wanyrix doctor/v1` |
| Local experiments → measurement → verification (the honesty gate) | **shipped** — `wanyrix experiment` |
| Durable event receipts + local history | **shipped** — `wanyrix events`, SQLite store (WAL + fsck) |
| Full offline operation, CLI, local storage | **shipped** — zero network by design |
| Grounded AI (provider-side, with deterministic fallback) | **shipped** — web `/explain` |
| **Local** AI models (e.g. Ollama-class — "your repo stays local, your model runs locally") | **shipped** — `wanyrix ai` (v0.7.0): local-model grounding over the measured evidence digest; deterministic fallback is a named refusal, never a fabrication |
| Git intelligence (evidence sourcing from history) | **shipped** — `wanyrix git` (v0.8.0, issue #67): measured branch/HEAD/dirty/changed-file facts mapped onto crates; redacted by design (paths + subjects only, never diffs or author identities) |

## The tiers

| Product | Price direction | Main value |
| --- | --- | --- |
| **Wanyrix Local** | **Free forever** | Individual/offline engineering intelligence |
| **Wanyrix Cloud** | Low monthly (to be validated) | Sync, cross-machine history, hosted dashboards, hosted AI, backup |
| **Wanyrix Team** | Per engineer/month (to be validated) | Shared repositories/findings/dashboards, dependency governance, architecture policies, org management, audit logs |
| **Wanyrix Enterprise** | Custom annual (to be validated) | SSO/SAML/OIDC/SCIM, private deployment, private AI models, fleet intelligence, compliance, SLA |
| **Wanyrix API / CI** | Usage/contract | Engineering-intelligence infrastructure: `POST /repositories/analyze`, findings/builds/dependencies/architecture/experiments endpoints, PR analysis in CI |

**Price points are deliberately not published in this document.** They will be
set only after customer discovery validates willingness to pay — the tier
*structure* and *value splits* are the commitment; numbers come later.

## The 90-day trial — applied where it belongs

```text
Developer installs Wanyrix → local forever ($0)
    └─▶ creates a Cloud account → 90-day full Team trial
            ├─▶ trial ends → return to Local (everything still works)
            ├─▶ Individual Cloud
            └─▶ Team / Enterprise
```

The trial applies **only to the cloud/team experience**. Expiry never touches
local functionality or local data. The local product continues working if the
user cancels — cancellation is a downgrade, not a punishment.

## What we will never charge for

Basic CLI installation · repository discovery · core Cargo analysis ·
dependency graph · `wanyrix doctor` · local findings · offline operation.
These are the adoption engine — charging for them would amputate it.

## Future paid surfaces (designed, not built)

- **Team dashboards & governance** — shared findings, dependency governance,
  architecture policies as data, audit logs. Foundation: the versioned
  envelope contracts and the scan-run sync semantics already shipped.
- **Engineering Intelligence API** — the same `wanyrix.*/v1` envelopes served
  as a hosted API for GitHub/GitLab/CI/portals/Slack integrations. The
  contract-first architecture is the head start.
- **CI/CD PR intelligence** — per-PR build/dependency/architecture/performance
  impact with policy checks. The web's PR regression-guard surface is the
  local prototype.
- **Fleet intelligence** — org-wide view across hundreds of repositories:
  which repos are getting slower, where dependency risk is spreading, which
  experiments actually worked. Requires the cloud milestone.
- **Local AI** — the local-model surface shipped in v0.7.0 (`wanyrix ai`,
  `wanyrix.ai/v1`): offline/private AI grounding with zero external
  providers, honest named refusals when no local model is running. The
  remaining evolution is broader model/backend coverage behind the same
  grounded abstraction.

Technical foundations for all of the above: [`docs/CLOUD_DESIGN.md`](CLOUD_DESIGN.md)
(sync semantics, device auth, tenant isolation, decision points) and
[`docs/PLUGIN_AND_EVENTS.md`](PLUGIN_AND_EVENTS.md) (the event surface plugins
and integrations will consume).

## Access model

- **Local**: no accounts, no auth, no telemetry — access *is* having the
  binary; identity is the measured workspace state in `.wanyrix/`.
- **Cloud (when built)**: accounts exist only for sync/sharing — device
  auth (OAuth device flow, no passwords at rest), organization tenancy,
  opt-in off-by-default sync. Accounts gate sharing, never the product.

## Local subscription licensing (issue #94)

Shipped (engine E2 + web E1): a team can pay for Wanyrix and use it locally,
with **only entitlements** ever touching the cloud — never data. The engine
verifies licenses 100% OFFLINE (`wanyrix activate --key <token>` → ed25519
signature check against the embedded public key → cached verbatim at
`.wanyrix/entitlement.json`; `wanyrix entitlement --json` reports the state as
`wanyrix.entitlement/v1`). Activation and verification open **zero sockets** —
pinned by a source-level scan test — and any future `--fetch` revalidation
mode is contractually pinned to an outbound payload of EXACTLY
`{license_key_hash, engine_version, timestamp}` (nothing else ever leaves the
machine).

### Tiers → gated surfaces (the single mapping, `engine/src/entitlement.rs`)

| Tier | Gets | Gated surfaces |
| --- | --- | --- |
| **Free** | Every core local surface, free forever: doctor, graph, health, analyze, dependencies, build, experiments, events, exports, local AI, full offline operation | **None — never gated, never a crippled trial (rule #1 above)** |
| **Team** | Export sharing (sha256-bound artifacts), registry sync + CI referee (issue #92), team dashboards | `sync.push`, `sync.pull` → require `team` |
| **Enterprise** | SSO/SAML/OIDC/SCIM, audit logs, on-prem entitlement server (own signing key; machines still verify offline) | Everything Team has, plus Enterprise-only surfaces as they land (roadmap #66) |

A missing, deleted or expired license refuses **premium surfaces by name**
(`EngineError::SubscriptionRequired { surface, plan_required }`) — measured
core data on disk is never hidden, corrupted or rewritten (gates never touch
history). An expired token keeps working through a visible **30-day
revalidation grace** window (`status: grace` in the envelope); beyond it, the
refusal names the expiry date.

### Enforcement at the binary (AUD-1 — the matrix is behavior, not prose)

The mapping above is ENFORCED at CLI dispatch: `main.rs` consults the single
surface registry (`engine/src/entitlement.rs` `SURFACE_REGISTRY`) through
`gate_cli` before a gated surface runs — the same cache file `wanyrix
activate` writes is the one enforcement re-verifies (signature re-checked
every time).

- **Gated (require `team` or above): `sync push`, `sync pull`.** Both
  directions: a shared registry a licenseless machine could *read* would
  leak exactly the team data the gate exists to protect. The gate fires
  before any measurement or git transport work.
- **Never gated (free tier, rule #1): every core local surface — including
  local `export`.** Artifacts-as-code written to the LOCAL disk stays free
  forever; the paid capability is export *sharing* (the registry-branch
  sync), not local writing. `doctor`, `graph`, `health`, `analyze`,
  `dependencies`, `build`, `init`, `status`, `store`, `synth`, `daemon`,
  `telemetry`, `experiment`, `events`, `ai`, `git`, `impact`,
  `what-changed`, `export`, `activate`, `entitlement`, `license` all run
  with zero license state — pinned by binary-level tests.
- **Refusal shape:** the named `subscription required` error, exit code 2,
  stdout left empty (machine envelopes carry results, never refusals), and
  a stderr message naming the surface, the required plan and the
  remediation: run `wanyrix activate --key <token-file-or-json>`, or obtain
  a license — see this document. Refusal payloads carry **no wall-clock
  value** (the only dates they may name are the token's own expiry, as
  data).
- **Grace honored offline:** an expired token inside the 30-day revalidation
  window keeps pushing/pulling with a visible grace note on stderr (stdout
  stays the clean envelope). No network is consulted, ever.
- **CI/dev escape hatch (documented, default strict):**
  `WANYRIX_ALLOW_UNLICENSED=1` — exactly that value — grants every surface
  without a license, for CI referees and dev machines that must exercise
  premium surfaces in honest dry-run contexts. Any other value (including
  `true`/`yes`/`0`) enforces strictly. The hatch only admits the caller at
  the gate; it never mints, caches or fakes a license.

### Sandbox issuance honesty label

Until a payment backend exists, the web Plans view (`Plans`) issues REAL,
offline-verifiable tokens locally and labels every action **`estimated`**:
sandbox-local issuance, **no payment method collected, no charge made, never a
simulated purchase**. The 14-day trial requires no payment method; issued
tokens carry UTC day-count expiry (`trial` = 14 days, `team` = 365) and are
activatable with `wanyrix activate --key`. Without the operator-configured dev
signing key (`WANYRIX_SIGNING_KEY`) the issuer answers an honest 503 — it
never simulates a license. Prices remain deliberately unpublished (validated
only after customer discovery).

### ed25519 at release signing

Tokens verify against an embedded ed25519 public key
(`RELEASE_PUBLIC_KEY_HEX`). The repository intentionally ships the
`PENDING_RELEASE_KEY` placeholder: the real keypair is generated **at release
signing**, the private half lives only in the release signing environment
(never committed, never in the repo), and the public half is embedded into the
binary. Until then (and for Enterprise on-prem entitlement servers and tests)
the documented `WANYRIX_ACTIVATION_PUBKEY` override names the trusted key.
`ed25519-dalek` (default features off) is the one deliberate dependency
deviation from the hand-rolled-crypto policy — hand-rolling signatures would
be a security liability, not an auditability win (documented in
`engine/Cargo.toml`).
