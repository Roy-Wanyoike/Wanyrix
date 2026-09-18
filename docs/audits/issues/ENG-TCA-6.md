# ENG-TCA-6 — API contract hygiene: 405 without `Allow`, missing-param vs unknown-target status conflation, silent `kind` coercion, unversioned markdown envelope

**Type:** CONTRACT_HYGIENE (4 minor findings, one trackable unit) · **Severity:** P4 · **Status:** FIXED — pending verification (Task 2-e)
**Labels:** `api`, `contract`, `sdk-persona`, `task-2-c-a`

## 1. Problem
Four small REST-contract gaps observed during the full method-matrix and error-contract
sweep. Each is minor alone; together they force SDK consumers to special-case the API.

## 2. Current State (all verified)
a) **405 without `Allow`**: every route returns 405 for wrong methods (correct), but no
   response carries an `Allow` header — RFC 9110 §10.2.2: the server SHOULD generate an
   `Allow` header field in a 405 response. Consumers cannot discover allowed methods.
b) **Missing vs unknown param conflated**: `GET /impact?type=edit-file` (no `target`) →
   **404** `{"error":"unknown target ''"}`. A missing parameter is a client-input error
   (400 class); 404 with `''` reads as if an empty target existed as a concept.
c) **Silent enum coercion**: `POST /explain {"kind": "weird-kind", …}` → 200, silently
   mapped to the `general` prompt/fallback (`KIND_PROMPTS[kind] ?? KIND_PROMPTS.general`).
   No `error`/`warning` field signals the coercion; a consumer cannot detect its typo.
d) **Unversioned markdown envelope**: `/report?format=json` returns
   `{filename, json(schema wanyrix.report/v1), bytes}`, but `format=markdown` returns
   `{filename, markdown, bytes}` with no schema/version marker anywhere in the envelope.

## 3. Expected State
- 405 responses include `Allow: GET` (or `POST` for explain).
- Missing required param → 400 with a named-param error message.
- Unknown `kind` → either 400 or `usedFallbackKind: "general"` in the response.
- Markdown envelope carries `schema: "wanyrix.report/v1/markdown"` (or equivalent) so
  consumers can pin the format.

## 4. Evidence
```bash
$ for m in POST PUT DELETE; do curl -s -D - -o /dev/null -X $m http://localhost:3000/api/wanyrix/health; done | rg -i '^(HTTP|allow)'
HTTP/1.1 405 Method Not Allowed      # (and no Allow header lines)
$ curl -s 'http://localhost:3000/api/wanyrix/impact?type=edit-file' -w ' %{http_code}\n'
{"error":"unknown target ''"} 404
$ curl -s -X POST -H 'content-type: application/json' -d '{"context":"c","question":"q","kind":"weird-kind"}' http://localhost:3000/api/wanyrix/explain | jq '{ok, grounded}'
{"ok":true,"grounded":true}          # coercion invisible
$ curl -s 'http://localhost:3000/api/wanyrix/report?format=markdown' | jq 'keys'
["bytes","filename","markdown"]
```

## 5. Impact
P4: forces defensive client code; no data-integrity risk. Improves cost of the SDK
contract tests (pending-task §27 "Contract" tier) once landed.

## 6. Acceptance Criteria
- [ ] `Allow` header on all 405s (13 routes).
- [ ] `impact` distinguishes 400 missing-param from 404 unknown-target.
- [ ] `explain` rejects unknown `kind` or echoes `usedFallbackKind`.
- [ ] Markdown envelope carries a schema marker.

## 7. Dependencies
None. (b) touches the impact route's documented by-design 404 — keep unknown-target 404
unchanged; only classify *missing* params.

## 8. Testing Requirements
Extend the method-matrix + error-contract tests to assert the four behaviors.

## 9. Security Considerations
None.

## 10. Performance Considerations
None.

## 11. Documentation Requirements
Fold into the API reference (Task 2-d); note AUDIT-I7 already tracks the explain
GET-405-vs-400-doc question — this record only adds the `Allow` header evidence.

## 12. Definition of Done
All four behaviors implemented + tested + documented.

## 13. Resolution evidence (Task 2-e)
FIXED (a–d) — (a) `methodNotAllowed()` in src/lib/wanyrix/api.ts returns 405 WITH an RFC 9110 `Allow` header; exported by every owned route (12 GET-only + storage/reclaim + storage/rebuild POST-only); live: `POST /graph` → 405 + `allow: GET`. (b) impact missing `target` → 400 `missing required param 'target'`; unknown target stays the documented 404. (c) explain rejects an explicit unknown `kind` → 400 `unknown kind 'weird-kind' (expected: …)` (landed within Task 2-d's explain hardening — verified live; omitted kind still defaults to general). (d) markdown envelope carries `schema: 'wanyrix.markdown/v1'`. Known residual (outside my file boundary): the explain route's framework-generated GET→405 carries no `Allow` header (adding one requires touching src/app/api/wanyrix/explain/**, owned by Task 2-d) — filed as ENG-TE-1.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "chore(api): REST hygiene — Allow header on 405, 400 for missing params, explain kind coercion, versioned markdown envelope" \
  -b "See docs/audits/issues/ENG-TCA-6.md" -l "api,contract"
```
