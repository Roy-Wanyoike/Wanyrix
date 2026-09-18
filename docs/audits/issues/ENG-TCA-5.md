# ENG-TCA-5 — `estimatedRange` semantics lost in machine surfaces: report presents "Build time 87.4s (estimated range 49.0–61.0s · confidence 82%)" — point estimate outside its own range

**Type:** BUG (schema self-description / presentation) · **Severity:** P3 · **Status:** FIXED — pending verification (Task 2-e)
**Labels:** `report`, `contract`, `honesty-rules`, `task-2-c-a`

## 1. Problem
`DoctorReport.estimatedRange` means "**estimated build time after applying the top
fix**" — the UI labels it correctly ("Estimated after fixes",
`doctor-view.tsx:579`). The machine-readable surfaces drop that semantics:
`/report?format=markdown` renders it as an attribute of the *current* build time, and
`/report?format=json` names it `estimatedRangeSeconds` directly adjacent to
`buildTimeSeconds`/`confidencePct`. Every pipeline consumer that validates
`value ∈ range` (or reads "estimated range … confidence N%" as a confidence interval)
concludes the report contradicts itself: **87.4 ∉ [49.0, 61.0]** (helios),
**52.8 ∉ [31, 40]** (atlas).

## 2. Current State
- Markdown: `- Build time: **87.4s** (estimated range 49.0–61.0s · confidence 82%)`
  (`src/lib/wanyrix/report.ts:291` — `estimated range ${doctor.estimatedRange[0]}–…`).
- JSON: `doctor.buildTimeSeconds: 87.4`, `doctor.estimatedRangeSeconds: [49, 61]`,
  `doctor.confidencePct: 82` — no field explains the relationship.
- UI (correct): "Estimated after fixes · 49–61s" with `estimated` MeasurementBadge.
- Both workspaces exhibit the pattern; numbers reproduce deterministically.

## 3. Expected State
Machine flavors carry the semantics, e.g.:
`estimatedRangeSeconds: {min: 49, max: 61, meaning: "projected-after-top-fix", confidencePct: 82}`
(or `projectedAfterFixSeconds`), and the markdown line becomes
`- Build time: 87.4s (estimated after top fix: 49.0–61.0s · confidence 82%)`.

## 4. Evidence
```bash
$ curl -s 'http://localhost:3000/api/wanyrix/doctor?ws=helios-platform' | jq '{buildTime, estimatedRange, confidence}'
{"buildTime":87.4,"estimatedRange":[49,61],"confidence":82}
$ curl -s 'http://localhost:3000/api/wanyrix/report?ws=helios-platform&format=markdown' | jq -r .markdown | rg 'Build time'
- Build time: **87.4s** (estimated range 49.0–61.0s · confidence 82%)
$ curl -s 'http://localhost:3000/api/wanyrix/doctor?ws=atlas-consortium' | jq '{buildTime, estimatedRange}'
{"buildTime":52.8,"estimatedRange":[31,40]}
```

## 5. Impact
- Automated report diffing (the pipeline persona's regression summary) misreads the
  range as an interval around build time and flags false regressions/contradictions.
- Borderline honesty: the numbers are individually true, but their juxtaposition in the
  machine flavor asserts a false relationship.

## 6. Acceptance Criteria
- [ ] JSON flavor field renamed or nested with explicit `meaning`.
- [ ] Markdown line says "after fixes/top fix".
- [ ] Schema contract test asserting the field's documented meaning; report README
      (Task 2-d) documents it.

## 7. Dependencies
Task 2-d (docs); Task 2-a (contract tests). Overlaps `wanyrix.report/v1` schema —
coordinate before changing field names (version bump consideration for v1).

## 8. Testing Requirements
Golden report test: assert markdown wording + JSON shape; property: `buildTime` may
legitimately fall outside `estimatedRange` — test documents that intentionally.

## 9. Security Considerations
None.

## 10. Performance Considerations
None.

## 11. Documentation Requirements
CLI/API reference (Task 2-d) must define every `wanyrix.report/v1` field's semantics.

## 12. Definition of Done
No surface presents `estimatedRange` as a confidence interval around `buildTime`;
tests + docs green.

## 13. Resolution evidence (Task 2-e)
FIXED — machine flavors now carry the semantics structurally: JSON flavor has `doctor.buildTime: {value, unit:'seconds'}` + `doctor.estimatedAfterFix: {unit:'seconds', estimatedRange:{low,high}, status:'estimated', meaning:'projected-after-top-fix', confidencePct, note}` (the ambiguous flat `estimatedRangeSeconds` tuple is gone; the note states the projection is NOT a confidence interval and buildTimeSeconds may legitimately fall outside it); markdown line reads `Build time: 87.4s (estimated after top fix: 49.0–61.0s · confidence 82%)`. Flavor version strings unchanged (`wanyrix.report/v1`, `wanyrix.markdown/v1`). Verified for BOTH workspaces; pinned by tests/unit/fixtures-and-report.test.ts (unit, both ws, incl. the outside-the-range documentation property) + live contract tests in tests/api/wanyrix-api.test.ts.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "fix(report): estimatedRange reads as a CI around buildTime in machine flavors (87.4s vs range 49–61s)" \
  -b "See docs/audits/issues/ENG-TCA-5.md" -l "report,contract,honesty-rules"
```
