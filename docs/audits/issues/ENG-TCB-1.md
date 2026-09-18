# ENG-TCB-1 — Impact Simulator "Add a dependency" catalog offers crates that are already in the dependency tree (no already-present guard)

**Type:** BUG / UX-HONESTY · **Severity:** P3 · **Status:** Open
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
