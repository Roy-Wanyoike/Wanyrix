# Plugin & event architecture — design direction (issue #63)

Status: **the event log is shipped (engine v0.6.0); the out-of-process plugin
contract is design-only — but its four maintainer decision points are now RESOLVED**
(decision record at the end of this document, issue #117, 2026-09-22). Every real
experiment-ledger transition appends an append-only `wanyrix.event/v1` line to
`.wanyrix/events.jsonl` (deterministic monotonic ids, corrupt lines skipped and
named, refusals mint no events), and `wanyrix events` reads the trail
(`wanyrix.events/v1`). This document records the direction for the rest — durable
bus transports, webhook delivery, and the plugin manifest model — so the future
plugin layer is built *on top of* the honesty architecture instead of around it.
The resolved decision record below gates and specifies any further implementation.

## Non-negotiables carried over from the local product

1. **Estimated ≠ Measured ≠ Verified.** A plugin can annotate, aggregate,
   visualize, and notify. It can never upgrade a claim's status, never invent
   a measurement, and never write into a store row it did not produce. Any
   "verified" output must trace to a real engine-measured experiment
   (`wanyrix.experiment/v1` semantics).
2. **Versioned envelopes only.** Plugins speak the same
   `wanyrix.*/v1` envelopes the CLI, daemon, and HTTP surfaces speak. There is
   no second, looser wire format. Unknown envelope versions are rejected, not
   best-effort parsed.
3. **No silent transmission, no ambient access.** Capabilities are declared in
   a manifest, deny-by-default, and every network path stays off unless the
   user explicitly configures it (`docs/PRIVACY.md` remains the contract).

## What exists today (the honest starting point)

The extension surface is already real — it is just not yet *named* one:

- **22 versioned JSON envelopes** (each pinned by engine tests; enumerated in
  `docs/CLI.md`): `wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`,
  `wanyrix.analyze/v1`, `wanyrix.dependencies/v1`, `wanyrix.init/v1`,
  `wanyrix.status/v1`, `wanyrix.experiment/v1`, `wanyrix.build/v1`,
  `wanyrix.telemetry/v1`, `wanyrix.daemon/v1`, `wanyrix.events/v1`,
  `wanyrix.ai/v1`, `wanyrix.git/v1`, `wanyrix.impact/v1`,
  `wanyrix.what-changed/v1`, `wanyrix.export/v1`, `wanyrix.sync/v1`,
  `wanyrix.entitlement/v1`, `wanyrix.entitlement.token/v1`,
  `wanyrix.entitlement.cache/v1`, `wanyrix.license-keygen/v1` — plus the
  plural `wanyrix.experiments/v1` collection envelope that `experiment list
  --json` emits (`docs/CLI.md` row 12).
- **Unix-socket daemon protocol** (`wanyrix.daemon/v1`): request/response over
  a local socket with liveness probing — the natural local event transport.
- **HTTP surface**: 23 web routes under `/api/wanyrix/*`, including
  durable scan-run sync (`POST/GET /api/wanyrix/scan-runs`, idempotent upsert
  on the client's deterministic run id) and versioned reports
  (`wanyrix.report/v1`, `wanyrix.markdown/v1`).
- **Durable local ledgers**: the experiment ledger
  (`.wanyrix/experiments.jsonl`) and scan-run store are append-only,
  crash-recovery tested (WAL + fsck/repair) — a durable event log already
  exists in miniature.

## Event architecture (design direction)

```text
 producers                         durable event log            consumers
 ─────────                         ────────────────             ─────────
 engine commands  ──┐              .wanyrix/events.jsonl        daemon socket
 daemon lifecycle ──┼── append ──▶ (append-only, corrupt    ──▶ subscribers
 web scan-runs    ──┘              line = skipped +       │      (local plugins,
                                   error names the line)  │      web dashboard)
                                                          └── optional explicit
                                                              webhook (off by
                                                              default)
```

- **Envelope**: `wanyrix.event/v1` — `{ id (deterministic, monotonic per
  source), kind, subject, payload (an existing wanyrix.*/v1 envelope),
  emittedAt, schemaVersion }`. The payload is never re-shaped: consumers get
  exactly what the producer measured.
- **Ordering & idempotency**: same rules as scan-run sync — deterministic ids
  make redelivery safe; consumers upsert, never double-apply.
- **Failure semantics**: a corrupted line is skipped and *named* (same honesty
  rule as the experiment ledger); readers never crash the log.
- **Retention**: size-capped with explicit GC, mirroring the storage
  route's reclaim semantics.

## Plugin architecture (design direction)

- **Out-of-process, not dynamic libraries.** Plugins are separate executables
  talking envelopes over stdin/stdout or the daemon socket. This preserves the
  Rust memory-safety boundary, makes crashes survivable (a plugin can never
  take the engine down), and keeps the sandbox story tractable.
- **Manifest** (`wanyrix.plugin.toml`): name, contract version, declared
  capabilities. Deny-by-default capability set:
  - `read:store` — read experiment/scan-run ledgers
  - `emit:event` — append to the event log (annotated as plugin-origin)
  - `http:<host>` — unset unless the user explicitly grants it; the default
    manifest has no network capability at all
- **Handshake**: plugin declares `{ plugin: "name", contract: "v1" }`; an
  unknown or unsupported contract version is a named refusal, never a
  best-effort parse.
- **Trust model**: plugins are local, user-installed, explicitly registered.
  No remote plugin marketplace, no auto-update, no silent loading — a plugin
  runs because the user put it there and pointed Wanyrix at it.
- **OS hardening (later)**: Linux namespaces / macOS seatbelt profiles are a
  hardening follow-up, not the trust boundary. The manifest capability check
  is the boundary.

### What a plugin can and can never do

| Can | Can never |
| --- | --- |
| Read measured envelopes and ledgers | Upgrade estimated → measured → verified |
| Emit plugin-origin events (clearly labeled) | Write engine-produced store rows |
| Notify (local UI, terminal, explicit webhook) | Transmit anything without explicit configuration |
| Add read-only views/annotations | Alter engine findings or fingerprints |

## Maintainer decision points — RESOLVED (record below)

The four questions as originally posed (kept for the record; each is answered in the
decision record below):

1. **Contract stability**: freeze `wanyrix.*/v1` semantics as the plugin
   contract (recommended — they are already test-pinned), or introduce a
   separate `wanyrix.plugin/v1` handshake first?
2. **Event log location**: `.wanyrix/events.jsonl` (mirrors the experiment
   ledger) vs. inside the SQLite store (transactional with scan runs)?
3. **Plugin discovery**: explicit path in config only (recommended for v1) vs.
   a conventional plugins directory?
4. **First consumer**: which plugin ships as the reference implementation to
   prove the contract (candidates: a `notify` plugin on experiment-verified
   events; a `sarif` export plugin reading doctor/health envelopes)?

## Decision record — Plugin API v1 (issue #117, 2026-09-22)

All four decision points are **decided**; the minimal implementation (handshake
envelope, manifest reader, reference plugin) is **deferred to a dedicated plugin
runtime issue** with an explicit trigger per decision — no decision point is left
implicit, and none of the four requires engine code until that runtime issue lands
(discovery being explicit-path-only means there is no config reader to build first;
the discovery surface *is* part of the runtime).

### D1 — Contract stability: frozen measurement envelopes + one dedicated handshake envelope

- **Decision:** the `wanyrix.*/v1` measurement envelopes are the frozen data contract
  — the plugin layer extends them additively only and never re-shapes a payload — and
  plugin *lifecycle* (hello, manifest/capability declaration, contract-version
  refusal) speaks one new dedicated envelope, `wanyrix.plugin/v1`, scoped strictly to
  that lifecycle. The sketched `{ plugin: "name", contract: "v1" }` declaration ships
  inside `wanyrix.plugin/v1`.
- **Alternatives:** (a) extend `wanyrix.*/v1` semantics in place for plugins too —
  rejected: every lifecycle tweak would ripple re-versioning through the test-pinned
  CLI/daemon/HTTP conformance surfaces; (b) a fully separate plugin wire format —
  rejected outright by non-negotiable #2 (there is no second, looser wire format).
- **Rationale:** measurement envelopes are conformance-pinned assets (the engine test
  suite and `docs/CLI.md` enumerate them); isolating plugin-layer churn in one
  lifecycle envelope means the plugin contract can evolve (capabilities, manifests,
  future negotiation) without ever forcing a measurement-contract version bump — and
  the handshake adds structure, never looseness, so #2 still holds verbatim.
- **Consequences:** one new envelope to spec and pin by test when the runtime lands;
  `docs/CLI.md` gains its row then; unknown contract versions remain named refusals
  (already the designed behavior).
- **Status & trigger:** deferred — implement `wanyrix.plugin/v1` at the start of the
  plugin runtime issue, whose precondition is exactly this decision record (the
  runtime issue cites #117).

### D2 — Event log location: `.wanyrix/events.jsonl` stays canonical

- **Decision:** the durable event log remains the append-only
  `.wanyrix/events.jsonl` ledger, exactly as shipped (v0.6.0); the SQLite store is a
  query/projection layer over stored scans, not the event log's home.
- **Alternatives:** moving events into the SQLite store (transactional with scan
  runs) — rejected for v1 (below); a hybrid dual-write as the v1 shape — rejected as
  speculative complexity before any consumer needs it.
- **Rationale:** the ledger is already shipped and test-pinned (deterministic
  monotonic ids, corrupt-line skip-and-name, refusals mint no events) — relocating it
  would break a shipped contract for zero measured benefit; plain-text,
  human-inspectable, workspace-local files match the `experiments.jsonl` pattern and
  work without any DB file; transactionality with scan-run rows is not required
  because deterministic ids already make redelivery idempotent — a crash between a
  store write and an event append resolves on re-append, never double-applies.
- **Consequences:** no cross-file transaction between the store and the log (accepted,
  per the idempotency argument); retention stays size-capped with explicit GC.
- **Status & trigger:** deferred-as-decided (nothing to build now). Revisit only if a
  consumer needs indexed queries over very large logs or incremental sync — the
  answer is a store-backed *projection* of the log, never a migration of the log
  itself.

### D3 — Plugin discovery: explicit path only for v1 (no conventional directory)

- **Decision:** v1 discovers plugins **explicitly** — the user points Wanyrix at a
  plugin path (flag/config surface owned by the runtime issue); there is no
  auto-scanned conventional plugins directory, no `PATH` lookup, no ambient loading.
- **Alternatives:** a conventional directory (e.g. a well-known `plugins/` folder
  scanned at startup) — rejected for v1; a directory *plus* an explicit enable list —
  noted as a possible additive follow-up, not v1.
- **Rationale:** this is the security decision of the four. The engine scans
  **untrusted repositories**; a conventionally-scanned directory inside a workspace
  would turn "cloned a hostile repo" into "executed its plugins" — the exact
  silent-loading the trust model forbids ("a plugin runs because the user put it
  there and pointed Wanyrix at it"). The explicit path doubles as the auditable
  inventory: the configured path list IS the attack-surface list.
- **Consequences:** mild friction for many-plugin users (acceptable while the count
  is small); directory discovery can be added later as an opt-in, additive mechanism
  that still requires explicit per-plugin enablement without breaking v1 users.
- **Status & trigger:** deferred-as-decided; the discovery surface is built with the
  runtime. Revisit directory discovery only when real multi-plugin demand is
  recorded on the tracker from shipped plugins (demand, not speculation, is the
  trigger).

### D4 — First reference plugin: `sarif` export (then `notify`)

- **Decision:** the first reference plugin is a **`sarif` export** plugin — reading
  the measured doctor/health/analyze envelopes and emitting SARIF 2.1.0. A `notify`
  plugin (on experiment-verified events) is the second reference implementation.
- **Alternatives:** `notify` first — rejected for v1 (rationale below).
- **Rationale:** the sarif plugin proves the contract end-to-end with an **objective
  correctness oracle** (output validates against the SARIF 2.1.0 schema; finding ids,
  severities, and evidence references must map 1:1 from measured envelopes), needs
  **no network capability** (honest-by-construction — the deny-by-default manifest is
  demonstrated without demoing its most dangerous capability), and produces immediate
  user value (a GitHub code-scanning upload path). `notify` first would either be a
  trivial terminal echo or would debut the webhook/network capability — the wrong
  first impression for a deny-by-default trust story.
- **Consequences:** the reference plugin exercises the read path but not `emit:event`
  (the event-emit path stays covered by engine tests until plugin #2); SARIF output
  must carry measured statuses verbatim as properties — a plugin mapping severities
  into stronger claims would violate non-negotiable #1.
- **Status & trigger:** the sarif plugin is the deliverable of the plugin runtime
  issue (decisions D1–D3 are its spec); `notify` follows once the explicit-webhook
  capability design exists (it is currently design-only in the event architecture
  above, off by default).

Tracking: **issue #117 — Plugin API v1: the four decision points above, resolved
2026-09-22; the live tracker for the plugin contract.** Historical origin (closed):
issue #63 (this document), issue #61 (cloud design — now under umbrella #66), issue
#60 (the envelope contracts).
