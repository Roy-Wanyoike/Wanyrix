# Plugin & event architecture — design direction (issue #63)

Status: **the event log is shipped (engine v0.6.0); the out-of-process plugin
contract is design-only.** Every real experiment-ledger transition appends an
append-only `wanyrix.event/v1` line to `.wanyrix/events.jsonl` (deterministic
monotonic ids, corrupt lines skipped and named, refusals mint no events), and
`wanyrix events` reads the trail (`wanyrix.events/v1`). This document records
the direction for the rest — durable bus transports, webhook delivery, and
the plugin manifest model — so the future plugin layer is built *on top of*
the honesty architecture instead of around it. The maintainer decision points
at the end gate any further implementation.

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

- **12 versioned JSON envelopes** (each pinned by engine tests):
  `wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`,
  `wanyrix.analyze/v1`, `wanyrix.dependencies/v1`, `wanyrix.init/v1`,
  `wanyrix.status/v1`, `wanyrix.experiment/v1`, `wanyrix.experiments/v1`,
  `wanyrix.build/v1`, `wanyrix.telemetry/v1`, `wanyrix.daemon/v1`.
- **Unix-socket daemon protocol** (`wanyrix.daemon/v1`): request/response over
  a local socket with liveness probing — the natural local event transport.
- **HTTP surface**: 18 web routes under `/api/wanyrix/*`, including
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

## Maintainer decision points (gate any implementation)

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

Tracking: issue #63 (this document), issue #61 (cloud design — the event bus
is what the online layer subscribes to), issue #60 (the envelope contracts).
