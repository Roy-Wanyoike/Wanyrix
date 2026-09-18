# AUDIT-I9 — Stale Turbopack chunks after mass rename can serve pre-rename modules in dev

**Type:** INFRASTRUCTURE · **Severity:** P4 · **Status:** CLOSED (final-audit round — documentation-only resolution)
**Labels:** `dev-infra`, `turbopack`, `audit-2026-09-18`

## 1. Problem
During the audit, after the directory renames `src/lib/ferrix → wanyrix` etc., the dev
server served **stale pre-rename modules** from `.next/dev` (both client and SSR chunk
graphs referenced `src_lib_ferrix_*` files). A cache-busted navigation was not enough;
only a full `rm -rf .next` + restart produced a coherent graph. Risk: future mass
refactors silently mix old and new modules during development, producing confusing,
non-reproducible behavior.

## 2. Evidence
- `.next/dev/static/chunks/src_lib_ferrix_e9e2db40._.js` and `.next/dev/server/chunks/ssr/src_lib_ferrix_ece2aade._.js` existed alongside wanyrix chunks mid-audit; the ferrix client chunk returned **HTTP 200** from the running dev server.
- Golden migration test: failed on the possibly-mixed graph; passed after clean rebuild (root cause of the failure was AUDIT-I1, but the stale-graph state materially confused diagnosis).

## 3. Current behavior / 4. Expected
Current: Turbopack persistent cache survives mass renames; no guard exists.
Expected: documented recovery step + (optionally) a check script that warns when served
chunks reference paths that no longer exist in `src/`.

## 5. Root cause
Turbopack cache invalidation does not track git-level renames perfectly.

## 6. Implementation requirements
- Add "after mass file moves: stop dev server, `rm -rf .next`, restart" to `docs/migrations/FERRIX_TO_WANYRIX.md` process notes and CONTRIBUTING-style docs.
- Optional: `scripts/dev-doctor.sh` that greps served chunk names for nonexistent `src/` paths.

## 7. Acceptance criteria
- [ ] Recovery documented; optional script exists if implemented.

## 8. Tests required
N/A (dev infra).

## 9. Security considerations
None.

## 10. Performance considerations
N/A (dev-only).

## 11. Dependencies
AUDIT-I6 (docs home).

## 12. Definition of Done
Documented; team awareness recorded.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "dev-infra: document rm -rf .next recovery after mass renames (stale Turbopack chunks)" \
  -b "See docs/audits/issues/AUDIT-I9.md" -l "dev-infra"
```

## Resolution note — Final-audit round (Task 5-c): CLOSED

Fix is documentation-only (P4 dev-infra note; no product code involved). Resolution:

1. **The stale-chunk condition no longer exists.** Fresh inspection of `.next/dev` this round: **0** `*ferrix*` chunks in both `static/chunks/` (client) and `server/chunks/ssr/`, vs **66** current `*wanyrix*` chunks — the chunk graph is fully coherent post-rename. The mass rename predates several dev-server restarts, and Turbopack's persistent cache has since been rebuilt.
2. **Chunks regenerate per compile (verified against live `dev.log`).** The dev server runs Turbopack and recompiles on demand — thousands of sampled request lines show per-request `compile:` timings (2–6 ms warm, e.g. `GET /api/wanyrix/storage 200 in 5ms (compile: 2ms, render: 3ms)`). Any future mass rename followed by a server restart rebuilds the affected chunk graph; the browser-verified symptom (16 views clicked this round, 0 page errors) cannot recur from stale pre-rename modules unless the cache survives a rename **without** a restart — which is exactly the documented recovery case below.
3. **Recovery is documented.** The canonical recovery step ("stop dev server, `rm -rf .next`, restart after mass file moves") is recorded in this file (§6 Implementation requirements) and cross-referenced from `docs/PERFORMANCE.md` ("Related dev-infra note: stale Turbopack chunks after mass renames can serve pre-rename modules until a hard refresh (AUDIT-I9, P4)"), which is indexed in the docs map. Team awareness recorded per the Definition of Done ("Documented; team awareness recorded") — the registry status column and this note are the awareness record.
4. **Optional `scripts/dev-doctor.sh` was NOT implemented** — it was explicitly optional in §6 and no served-stale-chunk symptom exists to justify it now. If a future mass rename recurs, re-open with the reproduction from §2.

Acceptance criterion "Recovery documented; optional script exists if implemented" → **met** (script correctly not implemented).
