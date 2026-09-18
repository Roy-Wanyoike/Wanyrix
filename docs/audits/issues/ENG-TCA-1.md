# ENG-TCA-1 — Unknown `ws` silently resolves to default workspace data (HTTP 200); `/report` and `/experiments` stamp the bogus id into the artifact

**Type:** BUG (API contract / data integrity for machine consumers) · **Severity:** P2 · **Status:** FIXED — pending verification (Task 2-e)
**Labels:** `api`, `contract`, `honesty-rules`, `sdk-persona`, `task-2-c-a`

## 1. Problem
Every workspace-scoped route resolves an unknown/misspelled `ws` parameter by silently
returning the **default workspace (helios-platform) fixture data with HTTP 200** instead
of a 404. Worse, `/report?format=json` and `/experiments` echo the **bogus id itself**
into the machine-readable payload's `workspace` field, so the archived artifact claims
to describe a workspace whose data it does not contain. A CI bot with one typo'd
workspace id ingests the wrong workspace's findings/build numbers as if they were valid.

## 2. Current State
- `GET /api/wanyrix/doctor?ws=does-not-exist` → **200**, payload byte-identical to
  `doctor?ws=helios-platform`, `workspace` field = `"helios-platform"`.
- `GET /api/wanyrix/health?ws=nope` → 200, `workspace` = `"helios-platform"`.
- `GET /api/wanyrix/report?ws=does-not-exist&format=json` → **200**,
  `schema: "wanyrix.report/v1"`, **`workspace: "does-not-exist"`**, while
  `summary.crates: 47` and `doctor.findings[0].id: "FER-BLD-001"` (helios data);
  filename `wanyrix-report-does-not-exist-2026-09-18.json`.
- Same substitution pattern in source for graph/pr/diagnostics/impact
  (`src/lib/wanyrix/data.ts`: `ws === 'atlas-consortium' ? ATLAS : DEFAULT`).
- `GET /api/wanyrix/experiments?ws=bogus-ws` → **200**, `workspace: "bogus-ws"`,
  `experiments: [EXP-014, …]` (3 helios experiments) — echoes the bogus id **and**
  attaches the helios experiment list
  (`src/lib/wanyrix/data.ts:2731-2734`; re-verified over HTTP after the dev-server
  outage of ~11:52Z).
- Contrast: `/impact` returns **404** for an unknown `target` (documented by-design
  contract) — the error-philosophy is inconsistent *within the same API*.

## 3. Expected State
- Unknown `ws` on any workspace-scoped route → **404** (or 400) with
  `{"ok":false,"error":"unknown workspace '<id>'"}` and no workspace payload.
- Alternatively, if default-resolution is intentional, the response MUST say so
  explicitly (e.g. `resolvedFrom: "default"`, `requestedWs: "<bogus>"`) — never present
  substituted data as a normal 200.
- `/report` must never emit `schema: wanyrix.report/v1` with a `workspace` field that
  does not match the data inside it.

## 4. Evidence
```bash
$ curl -s 'http://localhost:3000/api/wanyrix/doctor?ws=does-not-exist' -o /tmp/wanyrix-qa/doctor-unknown.json -w '%{http_code}'
200
$ jq -r .workspace /tmp/wanyrix-qa/doctor-unknown.json
helios-platform
$ cmp /tmp/wanyrix-qa/doctor-unknown.json /tmp/wanyrix-qa/doctor-helios.json && echo BYTE-IDENTICAL
BYTE-IDENTICAL

$ curl -s 'http://localhost:3000/api/wanyrix/report?ws=does-not-exist&format=json' | jq '.json | {schema, workspace, crates: .summary.crates, first: .doctor.findings[0].id}'
{ "schema": "wanyrix.report/v1", "workspace": "does-not-exist", "crates": 47, "first": "FER-BLD-001" }
```
Affected routes (verified 200-with-default or by source): doctor, health, graph,
diagnostics, pr, experiments, impact, report.

## 5. Impact
- CI/SDK consumers (the product's stated machine-readable contract) ingest wrong
  workspaces' data on a typo, with a success status — silent data integrity failure.
- Archived `wanyrix.report/v1` artifacts become untrustworthy: `workspace` field lies
  about the contents.
- Inconsistent with the impact route's own 404-on-unknown-target by-design contract.

## 6. Acceptance Criteria
- [ ] All workspace-scoped routes return 404 JSON error for ids not in `/workspaces`.
- [ ] `/report` (both flavors) refuses to generate for unknown ws.
- [ ] Contract tests: `?ws=nonsense` on every route → 4xx + JSON error envelope.
- [ ] No payload ever contains a `workspace` field whose value ≠ the data source.

## 7. Dependencies
None blocking; coordinate with Task 2-a contract-test suite.

## 8. Testing Requirements
Parametrized contract test: for each of the 9 ws-scoped routes, unknown id → 404;
known ids → 200 with `workspace` echo matching request.

## 9. Security Considerations
Low: no injection vector observed (reflected ids are JSON-encoded,
`content-type: application/json`). The fix removes a data-confusion vector, not an
injection one.

## 10. Performance Considerations
None — a Map lookup replaces the ternary.

## 11. Documentation Requirements
Document the 404 contract per route in the CLI/API reference (AUDIT-I6, Task 2-d);
align with the impact route's documented 404-on-unknown-target.

## 12. Definition of Done
All ws-scoped routes return explicit 404s for unknown ids; report refuses mislabeled
artifacts; tests green; API doc updated.

## 13. Resolution evidence (Task 2-e)
FIXED — shared workspace-id validator shipped (`workspaceGuard`/`resolveWorkspace` in src/lib/wanyrix/api.ts) validating `ws` against the SAME `WORKSPACES` registry the /workspaces route serves; unknown id → 404 `{ error: "unknown workspace '<id>'", knownWorkspaces }` on ALL 9 ws-scoped routes (doctor, graph, health, diagnostics, pr, experiments, impact, report×2 formats, report×2 flavors) — /report and /experiments now 404 before any payload is built, so no artifact can stamp a bogus id. Live evidence: 9/9 routes → 404 for `ws=does-not-exist`; known ids → 200 with `workspace` echo matching the request (both workspaces). Parametrized contract tests in tests/api/wanyrix-api.test.ts (unknown-ws suite incl. the new flavor routes + known-ws 200 suite).

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "fix(api): unknown ws silently returns default workspace data (200) — report flavor stamps bogus id" \
  -b "See docs/audits/issues/ENG-TCA-1.md" -l "api,contract,honesty-rules"
```
