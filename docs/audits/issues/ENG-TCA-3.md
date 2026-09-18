# ENG-TCA-3 — Blast-radius math does not reconcile inside one `/graph` payload (blast vs node vs edges) + impact-simulator flags contradict the duplicates list

**Type:** BUG (honest-math / internal consistency) · **Severity:** P2 · **Status:** Open
**Labels:** `graph`, `impact`, `honesty-rules`, `sdk-persona`, `task-2-c-a`

## 1. Problem
A single `GET /api/wanyrix/graph?ws=helios-platform` response gives **three mutually
inconsistent answers to the same question** ("how many crates are affected by touching
crate X"): `blast[].affectedWorkspace`, `nodes[].downstream`, and the transitive closure
of the served `edges`. The impact simulator adds contradictions against the same
payload's duplicates list and workspace size. The graph is required to "answer
engineering questions and not exist merely for visual appeal" (pending-task §30) — for
an impact analyst these are the product's core numbers.

## 2. Current State (all inside ONE helios `/graph` response)
a) **blast vs node downstream contradictions** (same crate, same payload):
   - `database`: blast `affectedWorkspace=22` vs node `downstream=6`
   - `telemetry`: blast `12` vs node `9`
   - `api`: blast `2` vs node `downstream=0` — yet `edges` contains `gateway->api`
     (gateway depends on api), so api's downstream cannot be 0 while its own blast
     entry claims 2 crates re-invalidate.
   - (agree for `common` 41/41 and `common-runtime` 38/38 — no consistent rule exists)
b) **node claims vs served edge closure** (50 field mismatches, computed):
   - `common`: claimed downstream 41, transitive dependents in served graph = 12
   - `tokio`: claimed 41, served closure = 14; `syn`: claimed 14, closure = 26
   - fanIn/fanOut: 11 nodes mismatch served edge degrees
     (`telemetry` fanIn 4 vs 5 in-edges; `proc-macro2` fanIn 4 vs 2; `tracing` fanIn 3 vs 2 …)
   - external nodes claim `fanOut=0` while out-edges exist (`tokio->tokio-macros`,
     `serde->serde_derive`, `syn->proc-macro2`, …)
c) **`meta` says 47 crates / 212 edges; payload serves 36 nodes / 68 edges** — a subset
   that no field declares; `report` markdown labels the full workspace
   "Backbone: 47 crates · 212 edges" while serving the subset.
d) **Ghost reference**: `duplicates[tokio].dependents` includes `legacy-cache` — no such
   node exists in `nodes` (only `cache`).
e) **Impact simulator vs duplicates list**: `upgrade-dep tokio` → `duplicateBefore: false`
   and `upgrade-dep serde` → `duplicateBefore: false`, while the same payload's
   `duplicates[]` lists BOTH as version-duplicated and the upgrade's own
   `resolves.kind: "partial"` note describes unifying an existing duplicate lineage.
   Atlas `bytes` upgrade shows `duplicateBefore: true` — the fixture contradicts itself.
f) **Impossible count**: `upgrade-dep serde` → `recompileCrates: 52` in a workspace
   declared as 47 crates (`meta.workspaceCrates=47`, `/workspaces` says crates: 47).

## 3. Expected State
- One documented blast-radius definition; `blast.affectedWorkspace`, `nodes.downstream`
  and the edge set must agree (or the served-subset relationship must be explicit and
  computable, e.g. `servedSubsetOf: "full-graph"` + closure over full graph only).
- `fanIn`/`fanOut` = served edge degrees (or document why externals differ).
- `duplicateBefore` consistent with `duplicates[]`; `recompileCrates` ≤ workspace crates
  or field renamed/documented to include external tree.
- No references to crates absent from `nodes`.

## 4. Evidence
```bash
$ curl -s 'http://localhost:3000/api/wanyrix/graph?ws=helios-platform' -o /tmp/wanyrix-qa/graph-helios.json
$ jq -r '.blast[] | [.crate, .affectedWorkspace] | @tsv' graph-helios.json   # vs nodes[].downstream
database  22      # node says 6
telemetry 12      # node says 9
api       2       # node says 0 — but edge gateway->api exists
$ bun /tmp/wanyrix-qa/graph-math.ts   # cross-check script (Task 2-c-a)
… total fan/down mismatches: 50 …
database: claimed downstream=6 actual transitive dependents=5
common: claimed downstream=41 actual transitive dependents=12
tokio: claimed fanOut=0 actual out-edges=1 …
$ curl -s 'http://localhost:3000/api/wanyrix/impact?type=upgrade-dep&target=serde' | jq '{duplicateBefore, recompileCrates}'
{"duplicateBefore":false,"recompileCrates":52}   # duplicates[] lists serde 1.0.203+1.0.210; ws has 47 crates
$ jq -r '.duplicates[0].dependents[]' graph-helios.json   # legacy-cache not in nodes
sqlx 0.7 (pinned)
legacy-cache
```

## 5. Impact
- Impact analysts and CI gates derived from these numbers get contradictory verdicts
  from the same payload (e.g. "is database cheap to touch?" → 6 or 22 depending on
  which field you read).
- Undermines the honesty architecture: numbers must be verifiable from the evidence the
  product itself serves; Gate 5's "blast radius 100% (61/61 fixture cases)" claim is not
  reproducible against this fixture.

## 6. Acceptance Criteria
- [ ] Property test: for every blast entry, `affectedWorkspace` == `nodes[crate].downstream` (or a documented, computable relationship).
- [ ] `nodes[].fanIn/fanOut` equal served edge degrees (or subset semantics documented per node).
- [ ] `duplicateBefore` derived from `duplicates[]`, not hand-typed.
- [ ] `recompileCrates` ≤ `meta.workspaceCrates` or semantics documented.
- [ ] All crate references resolve to nodes.

## 7. Dependencies
None blocking; coordinate with Task 2-a (they own fixture-builder unit tests incl. "impact math").

## 8. Testing Requirements
Golden graph test computing closures/degrees from `edges` and asserting every claimed
number; the cross-check script from §4 is the seed (`/tmp/wanyrix-qa/graph-math.ts`, to
be ported into `tests/`).

## 9. Security Considerations
None.

## 10. Performance Considerations
Closure computation is O(V·E) on ≤512-crate fixtures — negligible; can be precomputed
at module load.

## 11. Documentation Requirements
Document each number's definition (downstream vs affectedWorkspace vs chain) in the API
reference (Task 2-d) and in `types.ts` JSDoc.

## 12. Definition of Done
One payload, one consistent blast-radius story; reconciliation test green; semantics
documented.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "fix(graph): blast radius numbers contradict each other within one /graph payload (blast vs downstream vs edges)" \
  -b "See docs/audits/issues/ENG-TCA-3.md" -l "graph,impact,honesty-rules"
```
