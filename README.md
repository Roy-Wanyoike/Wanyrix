# Wanyrix — Engineering Intelligence Platform

> Rust made software safer. Wanyrix makes Rust development easier to understand and operate.

Wanyrix continuously understands a Rust workspace and explains **why development is slow,
fragile, complicated or difficult** — with evidence, calibrated confidence, and a
verification path for every claim. Estimates are never presented as measurements; only a
run experiment can upgrade a claim to **verified**.

## What this repository contains

This repo hosts the **Wanyrix web platform** (Next.js 16 · TypeScript · Tailwind 4 ·
shadcn/ui · TanStack Query · Prisma-ready), a working demonstrator of the Wanyrix product
loop over a fixture workspace (`helios-platform`, 47 crates):

| Surface | What it demonstrates |
| --- | --- |
| **Engineering Health** (overview) | KPI grid, build-time trend, slowest crates, live activity |
| **Build Doctor** (`wanyrix doctor`) | animated scan, 12 evidence-backed findings, critical path, Human ⇄ `--json` modes |
| **Engineering Graph** | interactive dependency backbone, blast-radius explorer, duplicate versions |
| **Impact Simulator** | add-dependency / edit-file / split-crate cost calculator (all labeled *estimated*) |
| **Diagnostics** | borrow-checker explainer (E0502 walkthrough) + async flow inspector |
| **PR Analysis** | build-regression triage with cause chain and bot comment |
| **Experiments** | baseline → candidate → verified loop (Gate 10/20/21 semantics) |
| **Release Scorecard** | 20-gate GO / CONDITIONAL GO / NO-GO decision with evidence |
| **Issues & PRs** | traceability board — every issue fixed by a PR |

## Ground rules enforced in the product

1. **Evidence first** — every finding carries stable ID + evidence with source.
2. **Calibrated confidence** — `deterministic / high / medium / estimated` labels.
3. **Honest measurement status** — `measured / estimated / verified`, never conflated.
4. **AI is optional and grounded** — the reasoning layer consumes structured evidence,
   separates fact / inference / recommendation / uncertainty, and the product stays fully
   usable when the provider is down.
5. **No silent modification** — all patches are reviewable diffs behind explicit approval.

## Run locally

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint
```

API surface: `/api/wanyrix/{health,doctor,graph,impact,diagnostics,experiments,gates,issues,explain}`

## Governance

Work lands only through reviewed PRs referencing their issue (see the **Issues & PRs**
board). Release status is tracked on the scorecard: **CONDITIONAL GO** as of 2026-09-17.

## Brand history

This product was previously released under the name *Ferrix*. The complete identity
migration (Ferrix → Wanyrix, F-EIR → W-EIR, `ferrix` CLI → `wanyrix`) is documented in
[`docs/migrations/FERRIX_TO_WANYRIX.md`](docs/migrations/FERRIX_TO_WANYRIX.md), including
the controlled migration of persisted client state. This is the only place historical
branding intentionally appears in documentation.
