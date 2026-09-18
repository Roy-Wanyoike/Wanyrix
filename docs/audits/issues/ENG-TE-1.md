# ENG-TE-1 — `explain` route's framework-generated 405 carries no `Allow` header (RFC 9110 §10.2.2)

**Type:** CONTRACT_HYGIENE (single residual from the ENG-TCA-6a sweep) · **Severity:** P4 · **Status:** FIXED — verified (orchestrator)
**Verification addendum (2026-09-18):** explicit `GET` handler added in `src/app/api/wanyrix/explain/route.ts` returning 405 JSON `{ ok:false, error }` with `Allow: POST`. Live: `curl -i GET /api/wanyrix/explain` → `HTTP/1.1 405` + `allow: POST` + `content-type: application/json`. Contract tests still green (138 pass).
**Labels:** `api`, `contract`, `sdk-persona`, `task-2-e`

## 1. Problem
ENG-TCA-6a added RFC 9110 §10.2.2-compliant `Allow` headers to every 405 response — except
`GET /api/wanyrix/explain`. That route exports only `POST`, so Next.js itself generates the
405 (the module has no GET handler to customize), and the framework's response carries no
`Allow` header and no JSON error body. Every other route now advertises its allowed method.

## 2. Evidence
```bash
$ curl -s -D - -o /dev/null http://localhost:3000/api/wanyrix/explain | rg -i '^(HTTP|allow|content-type)'
HTTP/1.1 405 Method Not Allowed
vary: rsc, next-router-state-tree, …          # no allow: header
# (all other routes: `allow: GET` or `allow: POST` present — verified 2026-09-18)
$ rg -n 'export async function' src/app/api/wanyrix/explain/route.ts   # POST only
```

## 3. Current behavior
`GET /api/wanyrix/explain` → 405 with framework HTML/empty body, no `Allow`, no JSON
`{ error }` envelope — the only 405 on the surface a consumer cannot learn from.

## 4. Expected behavior
`GET /api/wanyrix/explain` → 405 JSON `{ error: "method not allowed — allowed: POST" }` with
`Allow: POST`, identical shape to the other routes (`methodNotAllowed('POST')` in
src/lib/wanyrix/api.ts).

## 5. Root cause
The route module never declares a GET handler, so the 405 is produced by the Next.js router
before any route code runs and cannot be customized from outside the file.

## 6. Implementation requirements
One additive export in `src/app/api/wanyrix/explain/route.ts` (owned by Task 2-d — file
boundary, not fix complexity):
```ts
import { notAllowedOnPostOnly } from '@/lib/wanyrix/api'
const { GET } = notAllowedOnPostOnly
export { GET }
```
Declaring GET redirects the 405 into owned code, which sends the header + JSON envelope.

## 7. Acceptance criteria
- [ ] `curl -D - http://localhost:3000/api/wanyrix/explain` shows `allow: POST` + JSON error body.
- [ ] Explain contract (POST-only surface) otherwise unchanged; no new GET semantics.

## 8. Tests required
Extend the ENG-TCA-6a Allow-header loop in tests/api/wanyrix-api.test.ts with `explain`
(POST-only expectation) once the export lands.

## 9. Security Considerations
None — discoverability of an already-documented method set.

## 10. Performance Considerations
None.

## 11. Dependencies
File is owned by Task 2-d (explain hardening); coordinate there. Found during Task 2-e's
TCA-6a verification sweep; the other 14 routes are already compliant.

## 12. Definition of Done
Explain 405 indistinguishable in contract shape from the rest of the API (header + JSON).

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "chore(api): explain route GET→405 lacks Allow header + JSON envelope (framework-generated)" \
  -b "See docs/audits/issues/ENG-TE-1.md" -l "api,contract"
```
