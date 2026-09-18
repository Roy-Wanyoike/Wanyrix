# ENG-TCA-2 — `wanyrix.release-scorecard/v1` and `wanyrix.scan-history/v1` flavors are client-side only — not reachable over the HTTP SDK surface

**Type:** MISSING_FEATURE (SDK surface gap) · **Severity:** P3 · **Status:** Open
**Labels:** `api`, `sdk-persona`, `machine-readable`, `task-2-c-a`

## 1. Problem
The product advertises three machine-readable JSON flavors: `wanyrix.report/v1`,
`wanyrix.release-scorecard/v1`, `wanyrix.scan-history/v1`. Only `wanyrix.report/v1` is
served by an API route (`/api/wanyrix/report?format=json`). The other two are assembled
**inside browser components** (download-blob exports) and cannot be fetched by a
CI/pipeline consumer without running a full browser — defeating the "machine-readable
JSON flavors" product contract for the REST persona.

## 2. Current State
- `GET /api/wanyrix/gates` → 200 with the raw fixture: keys
  `blockingConditions, gates, rationale, verdict`. **No** `schema`, **no**
  `generatedAt`, **no** `release` field. Query params are silently ignored
  (`?format=json` returns byte-identical body).
- No `/api/wanyrix/scorecard`, no scan-history route, no `format` switch.
- `src/components/wanyrix/views/scorecard-view.tsx:113-131` builds
  `{schema: 'wanyrix.release-scorecard/v1', generatedAt, release, verdict, rationale,
  gates, blockingConditions}` **in the browser** only.
- `src/components/wanyrix/scan-history.tsx:50` builds `wanyrix.scan-history/v1`
  **in the browser** only.
- The UI toast even advertises "wanyrix.release-scorecard/v1 — versioned schema
  (Gate 28)" while the API cannot serve it.

## 3. Expected State
The versioned flavor envelopes live on the HTTP surface, e.g.:
- `GET /api/wanyrix/gates?format=json` → `wanyrix.release-scorecard/v1` envelope
  (schema/generatedAt/release/verdict/gates/blockingConditions).
- A scan-history endpoint (or `?format=json` on the relevant route) serving
  `wanyrix.scan-history/v1`.
Server and client must share one builder so the flavors cannot drift.

## 4. Evidence
```bash
$ curl -s http://localhost:3000/api/wanyrix/gates | jq 'keys'
["blockingConditions","gates","rationale","verdict"]
$ curl -s http://localhost:3000/api/wanyrix/gates | jq 'has("schema"), has("generatedAt"), has("release")'
false
false
false
$ curl -s 'http://localhost:3000/api/wanyrix/gates?format=json' -o a.json; \
  curl -s 'http://localhost:3000/api/wanyrix/gates' -o b.json; cmp a.json b.json && echo 'format param ignored'
format param ignored
```
Source: `scorecard-view.tsx:113-131`, `scan-history.tsx:50`; no route serves either schema.

## 5. Impact
- CI bot / data-pipeline personas cannot archive versioned scorecards or scan history
  without headless-browser automation (heavy, brittle).
- Two of the three advertised flavors are effectively UI-private; contract tests
  (pending-task §27 "Contract: CLI/API/W-EIR/event contracts") cannot cover them.

## 6. Acceptance Criteria
- [ ] `wanyrix.release-scorecard/v1` fetchable via HTTP with schema+generatedAt+release.
- [ ] `wanyrix.scan-history/v1` fetchable via HTTP.
- [ ] Flavor builders extracted to shared lib; UI export and API use the same code.
- [ ] Contract tests pin the two new envelopes.

## 7. Dependencies
AUDIT-I4 (test harness); Task 2-b owns scorecard-view/scan-history components
(overlaps: coordinate to avoid duplicate builders).

## 8. Testing Requirements
Golden tests: `GET /gates?format=json` matches the client-assembled byte structure
modulo `generatedAt`.

## 9. Security Considerations
None — data already public on the same surface.

## 10. Performance Considerations
None — same payload, one envelope object.

## 11. Documentation Requirements
API reference (Task 2-d) must list the flavors and their `format` switches.

## 12. Definition of Done
Both flavors served over HTTP, shared builder, tests green, docs updated.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "feat(api): serve wanyrix.release-scorecard/v1 + wanyrix.scan-history/v1 flavors over HTTP (currently client-only)" \
  -b "See docs/audits/issues/ENG-TCA-2.md" -l "api,machine-readable"
```
