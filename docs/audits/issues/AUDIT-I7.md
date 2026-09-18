# AUDIT-I7 — `explain` AI route: shallow grounding with id-only context; GET contract undocumented

**Type:** PARTIAL_IMPLEMENTATION · **Severity:** P3 · **Status:** Open
**Labels:** `ai`, `api`, `honesty-rules`, `audit-2026-09-18`

## 1. Problem
The AI explain route honors the product's honesty architecture (deterministic fallback,
fact/inference/recommendation/uncertainty separation, AI failure never breaks the app),
but grounding is shallow when callers pass only a `findingId`: the response reports the
evidence context as empty and produces a generic explanation. Also, GET returns 405
while the documented contract says 400 — worth an explicit decision and documentation.

## 2. Evidence
- `curl -X POST /api/wanyrix/explain -d '{"context":{"findingId":"WAN-110"},"question":"…"}'`
  → 200 with "The evidence context is empty…" fallback (expected a grounded answer built from fixture evidence for WAN-110).
- `curl -X POST /api/wanyrix/explain -d '{}'` → 400 `context and question are required` ✓.
- `curl /api/wanyrix/explain` (GET) → 405 (route is POST-only).

## 3. Current behavior / 4. Expected
Current: id-only contexts fall back to the empty-evidence script. Expected: server-side
resolution of stable finding IDs to their evidence records before prompting, so a valid
ID yields a grounded, evidence-cited explanation; invalid IDs yield an explicit
"unknown finding" response (400-class) rather than an empty-evidence narrative.

## 5. Root cause
Route accepts arbitrary context shapes; only fully-populated contexts ground well.

## 6. Implementation requirements
- Resolve `context.findingId` against `data.ts` findings; attach the full evidence bundle before prompting.
- Unknown ID → 404/400 with `{"ok":false,"error":"unknown finding 'WAN-xxx'"}`.
- Keep deterministic fallback for provider failures (unchanged).
- Document GET 405 vs POST 400 in API doc (AUDIT-I6).

## 7. Acceptance criteria
- [ ] Valid finding ID → explanation cites ≥1 evidence item from that finding.
- [ ] Unknown ID → explicit error, not empty-evidence prose.
- [ ] Provider-down path still 200 + fallback (regression-protect this).

## 8. Tests required
Unit: ID resolution; contract tests for the three outcomes above.

## 9. Security considerations
Never feed provider more than the finding's evidence (fixture data today, real data later).

## 10. Performance considerations
Evidence bundle is small; no measurable impact.

## 11. Dependencies
AUDIT-I4 for tests; none otherwise.

## 12. Definition of Done
Grounded path + explicit unknown-ID error shipped, tests green, documented.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "ai(explain): ground id-only contexts via server-side finding resolution; document contracts" \
  -b "See docs/audits/issues/AUDIT-I7.md" -l "ai,api"
```
