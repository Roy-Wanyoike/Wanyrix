# ENG-TCA-7 — `/explain` accepts unbounded payloads: 2 MB context stalls the caller for the full 30 s provider timeout before falling back

**Type:** PERF / ROBUSTNESS (SDK-consumer facing) · **Severity:** P3 · **Status:** Open
**Labels:** `ai`, `api`, `performance`, `offline`, `task-2-c-a`

## 1. Problem
The explain route performs no payload-size validation. A 2 MB `context` passes the
`context && question` check, is forwarded verbatim to the AI provider, and the caller
waits the **entire 30 s race timeout** before receiving the deterministic fallback.
For CI consumers a single oversized/accidental payload turns into a 30 s pipeline stall;
in offline mode the same stall precedes every fallback (the provider attempt must time
out first). The unvalidated context is also egressed wholesale to the external provider,
contrary to the privacy posture of a local-first product.

## 2. Current State
- `POST /explain` with `{"context": "A"×2_000_000, "question": "q"}` →
  **HTTP 200 after 30.02 s**, body = deterministic fallback
  (`ok:false, grounded:false, error:"reasoning timeout"`).
- Normal small requests answer in 1.6–2.8 s (provider reachable in sandbox).
- No `content-length` check, no context-size check, no truncation note in the response.

## 3. Expected State
- Reject oversized payloads fast: 413 (or 400) above a documented limit (e.g. 64 KB).
- Cap/truncate what is forwarded to the provider and say so (`contextTruncated: true`).
- Offline mode: fail the provider attempt fast (shorter offline timeout / pre-flight)
  so the deterministic fallback returns in <1 s, preserving Gate 18's promise without
  the 30 s tax.

## 4. Evidence
```bash
$ python3 -c "print('{\"context\":\"' + 'A'*2000000 + '\",\"question\":\"q\"}')" > /tmp/wanyrix-qa/big.json
$ curl -s -o /tmp/wanyrix-qa/big-resp.json -w '%{http_code} time=%{time_total}s\n' \
    -X POST -H 'content-type: application/json' --data-binary @/tmp/wanyrix-qa/big.json \
    http://localhost:3000/api/wanyrix/explain
200 time=30.015456s
$ jq -r '.ok, .grounded, .error' /tmp/wanyrix-qa/big-resp.json
false
false
reasoning timeout
```
(Fallback content itself is honest and correctly labeled — the issue is the latency and
the missing size guard, not the fallback text.)

## 5. Impact
- CI/pipeline callers: 30 s stalls per bad payload; retry storms amplify it.
- Offline-honesty: the "AI unavailable → deterministic fallback" path costs 30 s in an
  offline environment unless the SDK itself fails fast; the product's offline promise
  (pending-task §5) is degraded in practice.
- Unvalidated bulk content is sent to the external provider without bound.

## 6. Acceptance Criteria
- [ ] Documented payload limit; 413/400 response above it (fast, before provider call).
- [ ] Truncation flag when context exceeds the provider-forwarded cap.
- [ ] Fallback latency budget test: offline path < 2 s.

## 7. Dependencies
Coordinates with ENG-TCA-4 (post-validation) — same route; and Task 2-d (documenting
the limit). Framework note: Next.js route handlers impose no default body limit.

## 8. Testing Requirements
Contract test: oversized payload → fast 4xx; offline-mock test: fallback < 2 s.

## 9. Security Considerations
Unbounded request bodies are a DoS vector on any deployment of this route; the fix also
limits what user content can be egressed to the provider.

## 10. Performance Considerations
The fix converts a 30 s worst case into a millisecond-class rejection.

## 11. Documentation Requirements
Document the payload limit and offline fallback latency budget in the API reference
(Task 2-d).

## 12. Definition of Done
Size guard + truncation flag shipped, latency budget test green, docs updated.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "perf(explain): unbounded payload — 2MB context stalls caller 30s before fallback; no size guard" \
  -b "See docs/audits/issues/ENG-TCA-7.md" -l "ai,api,performance"
```
