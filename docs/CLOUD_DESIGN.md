# Cloud mode — design direction (umbrella issue #66)

Status: **design only — nothing in this document is implemented.** The product
remains local-first; the deterministic engine and the web dashboard run fully
offline today, and the zero-telemetry posture (`docs/PRIVACY.md`) is unchanged.

This document records the design direction so the future online layer is built
*on top of* the honesty architecture instead of around it.

## Non-negotiables carried over from the local product

1. **Estimated ≠ Measured ≠ Verified.** The cloud aggregates measurements; it
   can never upgrade a claim's status. A "verified" badge in any cloud view
   must trace to a real measured experiment (engine `wanyrix.experiment/v1`
   semantics), not to an aggregate.
2. **No silent data transmission.** Every sync path is explicit (a configured
   target the user opted into), documented, configurable, auditable, and
   off-by-default. `docs/PRIVACY.md` remains the contract.
3. **Local operation never depends on the cloud.** Cloud outage degrades the
   online views only; the dashboard, engine, CLI and stores keep working.

## What exists today (the honest starting point)

- **Durable scan-run sync** — `POST/GET /api/wanyrix/scan-runs` (SQLite,
  Prisma): the client fire-and-forget POSTs each completed scan run; the
  server persists exactly what was measured and POSTed (idempotent upsert on
  the client's deterministic run id, findings fingerprint included). The
  server never invents runs, durations, or figures (Gate 21).
- **Secret redaction** — engine telemetry ingestion redacts source snippets
  and known secret shapes by default (`wanyrix.telemetry/v1`).
- **Serverless team sync — SHIPPED (issue #92, v0.9.0)** — `wanyrix sync
  push|pull` turns a git branch into the shared store: one measured pass
  committed to the remote's registry branch as exactly one deterministic
  commit (push), and a merge with named conflicts + evidence-tier downgrade
  on pull. No server exists — the transport is git itself — which is exactly
  why it fits this document: the hosted rung below would replace the
  git-branch transport with a bridge, never the local-first measurement
  model. Gated to the TEAM tier (offline ed25519 entitlement, issue #94).
- **Local stores** — per-browser localStorage + SQLite (WAL, crash-recovery
  tested, `fsck`/repair).

## Proposed architecture (design direction)

```text
Wanyrix Local (authoritative for measurements)
   │  explicit, configured sync target — off by default
   ▼
Wanyrix Cloud Sync
   │  1. device auth (OAuth device flow; no passwords at rest)
   │  2. envelope: wanyrix.sync/v1 — exactly the measured payloads
   │     (doctor/graph/health/scan-runs/experiment records), schema-versioned
   │  3. idempotent upserts keyed by the client's deterministic ids
   ▼
Wanyrix Cloud
   ├── Organizations / repositories (tenant isolation: row-level, enforced server-side)
   ├── Snapshots (immutable, content-addressed — same fingerprint ⇒ same snapshot)
   ├── Aggregated analytics (read models; never re-classify measurement status)
   ├── AI views (grounded in snapshots, validated against them, redactions kept)
   └── Policies (release gates as data; evaluated locally, published as evidence)
```

### Sync semantics

- **Client-authoritative measurements**: the local machine is the source of
  truth; the cloud is a durable, shareable mirror.
- **Offline queueing**: unsynced envelopes queue locally (the web already
  models this in its sync-status store); retries are idempotent by run id.
- **Conflicts**: same deterministic id ⇒ last-writer-wins per FIELD with a
  preserved audit trail; different ids never merge silently.
- **Failure recovery**: a cloud outage can never corrupt local state —
  the local ledger remains the only authority.

### Explicit decision points (maintainer, before implementation)

1. Hosting model and data residency (per-tenant encryption at rest?).
2. Auth provider vs self-hosted identity.
3. Commercial terms — **resolved**: issue #62 is closed and
   `docs/COMMERCIAL.md` is the ratified direction (local core free forever;
   paid tiers monetize sync/teams/scale/governance). What remains open here
   is only the implementation decision below.
4. Whether team features (policies, fleet views) launch with snapshots or
   after them.

## Explicitly out of scope until #61 moves to implementation

- Any code path in the web app that sends data to a non-localhost target
  without an explicit, user-configured sync setting.
- Any "anonymous telemetry" — none exists today; none is planned.
