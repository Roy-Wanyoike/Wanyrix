# ENG-TCB-1 — Impact Simulator "Add a dependency" catalog offers crates that are already in the dependency tree (no already-present guard)

**Type:** BUG / UX-HONESTY · **Severity:** P3 · **Status:** FIXED — pending verification
**Fix:** Task 2-f — add-catalog entries cross-checked against the graph node set client-side; already-present crates render as non-selectable cards with an "already in tree" badge, a duplicate-version/FER-BLD-002 caveat and a one-click hop to the Upgrade tab; the what-if math is untouched.
**Labels:** `bug`, `simulator`, `honesty`, `persona-qa`, `audit-2026-09-18`

## 1. Problem
The Impact Simulator's "Add a dependency" tab offers catalog scenarios for crates that
are **already present** in the active workspace's dependency graph, with no
"already in tree" guard or re-routing to the Upgrade scenario. The scenario premise
("what enters your tree if you add this crate") is false for these entries, and the
resulting cost card silently models an add instead of what would actually happen
(a version bump or, per this product's own FER-BLD-002 finding, a duplicate-version build).

## 2. Evidence
Persona 2 (dependency owner) UI session vs served graph API, both workspaces:
- `helios-platform`: catalog radios include **sqlx v0.8.6** and **reqwest v0.12.9** under
  "Add a dependency"; `GET /api/wanyrix/graph?ws=helios-platform` shows both as existing
  `kind:"external"` nodes (sqlx: buildTime 9.6s, downstream 6 — and the same app's
  Duplicates table + FER-BLD-002 state sqlx 0.7 is pinned; reqwest: buildTime 5.8s).
- `atlas-consortium`: catalog includes **datafusion v43.0.0** ("+44s CI"); graph API shows
  datafusion already present as an external node (2/2 workspaces affected — systematic).
- The card header for these entries reads "what enters your tree if you add this crate"
  (Simulator → "Add a dependency" tab, verified in browser).
- aws-sdk-s3 (absent from the graph) is also offered — the catalog mixes genuinely-new
  and already-present crates with no distinction.
Captures: `/tmp/wanyrix-qa/px-simulator-dark3.png`, `/tmp/wanyrix-qa/tcb-10-sim-atlas-dark.png`.

## 3. Current behavior
Catalog presents add-scenarios for in-tree crates as if the tree did not contain them;
selecting them renders an ESTIMATED add-cost card (crates added, target size, +CI) with
no warning that the crate already exists, no duplicate-version caveat, and no link to
the Upgrade tab where the realistic scenario lives.

## 4. Expected behavior
An add-scenario for a crate already resolved in the workspace either (a) is filtered out
of the catalog, or (b) is shown with an explicit already-present guard, e.g.
"sqlx 0.7 already in tree — adding 0.8.6 creates a duplicate-version build (see
FER-BLD-002)" with a one-click hop to the Upgrade scenario.

## 5. Root cause
The simulator catalog is a static per-workspace fixture list that is not cross-checked
against the graph payload's node set (the data needed for the guard is already in the
same `graph` API response the app consumes).

## 6. Implementation requirements
- Compute `catalog ∩ graph.nodes` client-side and gate the affected radio entries.
- Add the duplicate-version caveat linking FER-BLD-002 (it is the exact failure mode
  the doctor warns about) when a versioned add targets a pinned crate.
- Keep the scenario selectable but clearly re-labeled (honest premise) or remove it.

## 7. Acceptance criteria
- [ ] No "Add" catalog entry for a crate present in the active workspace graph, or such
      entries carry a visible already-present guard + upgrade-tab hand-off.
- [ ] Switching workspaces re-computes the guard (catalog is per-workspace).
- [ ] Both workspaces pass the guard check.

## 8. Tests required
Unit test: fixture catalog ⊥ graph node-set intersection per workspace; UI smoke:
catalog renders with guard labels; contract test asserting catalog ids absent from nodes
are the only unguarded entries.

## 9. Security considerations
None (read-only fixture data; no user input beyond radio selection).

## 10. Performance considerations
Guard is a single Set intersection over ≤70 nodes — negligible.

## 11. Dependencies
None; complements ENG-TCA-3 (numbers) — this record is about the scenario premise, not
the math.

## 12. Definition of Done
Guard implemented on both workspaces, tested, and the add-vs-upgrade semantics documented
in `docs/USER_GUIDE.md` (Task 2-d).

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "fix(simulator): add-dependency catalog offers already-present crates without a guard (sqlx/reqwest on helios, datafusion on atlas)" \
  -b "See docs/audits/issues/ENG-TCB-1.md" -l "bug"
```

## Evidence addendum (fix — Task 2-f, frontend fix engineer)
- Guard implemented in `src/components/wanyrix/views/simulator-view.tsx` only (no API/lib changes): `presentInTree` = Set of `graph.data.nodes[].id` (same payload the view already renders; no extra request); catalog entries are tagged `inTree` per render, so a workspace switch re-computes the guard.
- Already-present entries render `GuardedCatalogCard`: non-radio, non-selectable, "already in tree" badge (amber, AA-safe 11px/500), caveat "v{version} would build a second copy of a crate this workspace already resolves — a duplicate-version build (see finding FER-BLD-002), not a new addition.", and a "Go to upgrade scenarios" button that switches to the Upgrade tab (preselects the crate when an upgrade scenario for it exists in the active workspace's catalog). No add-cost figures are rendered for guarded entries; the default `activeTarget` falls back to the first ADDABLE entry, so the what-if math is never computed on a false premise.
- Browser-verified (agent-browser, dev :3000): helios-platform → guarded {sqlx, reqwest, tonic}, selectable {aws-sdk-s3, opentelemetry-otlp, deadpool-redis}; atlas-consortium → guarded {datafusion}, selectable {axum, redb, tracing-appender}; guard re-computed correctly in both switch directions. What-if E2E intact: helios aws-sdk-s3 → "Dependency impact — aws-sdk-s3 1.62.0" ESTIMATED (31 crates, 52.1 MB, +38s CI); atlas axum 0.8.1 → ESTIMATED card renders; guarded-card hand-off opens the Upgrade tab on both workspaces. Screenshots: `tool-results/task-2f-screens/sim-helios-guarded-{dark,light}.png`, `sim-atlas-guarded-dark.png`, `sim-helios-guarded-mobile390.png`. Zero console/page errors; mobile 390px overflow-free (scrollWidth 390 == innerWidth).
- Checks: `bun run lint` clean · `bunx tsc --noEmit` clean · `bun run test` 138 pass / 0 fail.
