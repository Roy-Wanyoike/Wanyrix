/**
 * fixtures/diagnostics — borrow-checker + async-flow fixtures (both workspaces).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (DIAGNOSTICS,
 * DIAGNOSTICS_ATLAS) is unchanged.
 * Types: DiagnosticsPayload comes from ../types — no type is defined here.
 */
import type { DiagnosticsPayload } from '../types'

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const DIAGNOSTICS: DiagnosticsPayload = {
  borrow: {
    error: 'error[E0502]: cannot borrow `user` as mutable because it is also borrowed as immutable',
    code: [
      'fn main() {',
      '    let mut user = User { name: "alice".into(), score: 10 };',
      '',
      '    let name_ref = &user.name;      // shared borrow created',
      '    user.promote();                  // ✗ mutable borrow attempted',
      '    println!("{name_ref}");          // name_ref used again here',
      '}',
      '',
      'impl User {',
      '    fn promote(&mut self) { self.score += 1; }',
      '}',
    ],
    narrative:
      'Rust prevents B because A may still be used afterwards. The shared borrow name_ref is created at line 4 and its last use is line 6 — so it must live across the mutable borrow at line 5. Two live borrows of the same data cannot overlap when one is mutable.',
    steps: [
      {
        id: 1,
        line: 4,
        title: 'Shared borrow created',
        detail:
          'name_ref = &user.name creates an immutable reference. From this point, the compiler tracks name_ref\u2019s live range.',
        lifetime: { label: 'name_ref (shared)', start: 4, end: 6, kind: 'shared' },
      },
      {
        id: 2,
        line: 5,
        title: 'Mutable borrow attempted',
        detail:
          'user.promote() needs &mut user. A mutable borrow requires exclusive access — no other live borrows may exist.',
        lifetime: { label: 'promote → &mut user', start: 5, end: 5, kind: 'conflict' },
      },
      {
        id: 3,
        line: 6,
        title: 'Last use of the shared borrow',
        detail:
          'println! uses name_ref. Under NLL, the borrow must stay alive until its last use — which is here, after the conflicting mutable borrow.',
        lifetime: { label: 'name_ref (shared)', start: 4, end: 6, kind: 'shared' },
      },
      {
        id: 4,
        line: 5,
        title: 'Overlap rejected',
        detail:
          'The shared borrow\u2019s lifetime [4..6] overlaps the mutable borrow at line 5. Rust rejects the program to prevent aliasing mutation — this is a soundness guarantee, not a style rule.',
        lifetime: { label: 'conflict region', start: 5, end: 5, kind: 'mutable' },
      },
    ],
    timelineTicks: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'],
    solutions: [
      {
        title: "1. Shorten the borrow's lifetime",
        code: 'let name = user.name.clone();\nuser.promote();\nprintln!("{name}");',
        tradeOff: 'One extra allocation; zero aliasing. Usually the cheapest correct fix.',
      },
      {
        title: '2. Move the last use earlier',
        code: 'let name_ref = &user.name;\nprintln!("{name_ref}");\nuser.promote();',
        tradeOff: 'No allocation. Works when usage order is flexible.',
      },
      {
        title: '3. Restructure the scope',
        code: '{\n    let name_ref = &user.name;\n    println!("{name_ref}");\n}\nuser.promote();',
        tradeOff: 'Explicit scoping documents intent; no runtime cost.',
      },
      {
        title: '4. Use owned data / indices',
        code: 'user.promote();\nprintln!("{}", user.name);',
        tradeOff: 'Borrow disappears entirely; best when the reference is unnecessary.',
      },
    ],
  },
  request: {
    id: '8F31',
    method: 'POST',
    path: '/payments',
    totalMs: 42.8,
    segments: [
      { id: 'auth', label: 'authentication', startMs: 0, durationMs: 1.4, kind: 'compute', span: 'auth::verify' },
      { id: 'valid', label: 'validation', startMs: 1.4, durationMs: 0.8, kind: 'compute', span: 'api::validate' },
      { id: 'db', label: 'database', startMs: 2.2, durationMs: 7.3, kind: 'db', span: 'sqlx::query — accounts', concurrent: true },
      { id: 'prov', label: 'payment provider', startMs: 2.2, durationMs: 31.7, kind: 'network', span: 'http-client — POST /charge', note: 'ran concurrently with DB query', concurrent: true },
      { id: 'bg', label: 'background task', startMs: 41.2, durationMs: 1.6, kind: 'background', span: 'worker::flush — queue', note: 'spawned after response decision' },
    ],
    tasks: [
      { id: 'T1', label: 'handler task', state: 'running', detail: 'POST /payments — owns request scope' },
      { id: 'T2', label: 'db query task', parent: 'T1', state: 'awaited', detail: 'select account — awaited via join!' },
      { id: 'T3', label: 'provider call task', parent: 'T1', state: 'resumed', detail: '31.7ms external HTTP — resumed twice' },
      { id: 'T4', label: 'queue flush task', parent: 'T1', state: 'done', detail: 'spawned near response; detached' },
      { id: 'T5', label: 'scan task (worker)', state: 'blocked', detail: 'std::fs read_dir inside async fn — blocks worker thread (WAN-ASY-012)', findingId: 'WAN-ASY-012' },
    ],
    warnings: [
      'provider call dominates: 74% of request latency is external I/O',
      'worker thread stall 340ms p95 detected during scan task (WAN-ASY-012)',
    ],
  },
}

// ------------------------------------------------------- atlas: diagnostics
// Workspace-scoped diagnostics (round 7): atlas-consortium gets its own
// borrow-checker scenario (E0499, the memtable writer pair) and its own async
// flow (the ingest path — ties into ATL-ASY-007, blocking writer IO).

export const DIAGNOSTICS_ATLAS: DiagnosticsPayload = {
  borrow: {
    error: 'error[E0499]: cannot borrow `*mem` as mutable more than once at a time',
    code: [
      'fn stage_batch(mem: &mut Memtable, batch: &[Record]) {',
      '    let mut writer = mem.writer();   // exclusive borrow #1',
      '    let compact = mem.compactor();   // ✗ exclusive borrow #2',
      '    writer.push(batch);              // writer used again here',
      '    compact.flush();',
      '}',
    ],
    narrative:
      'Rust rejects the second exclusive borrow because the first one is still live. writer is created at line 2 and its last use is line 4 — so it must stay live across the compactor() call at line 3. Two live exclusive (&mut) borrows of the same data can never overlap: that exclusivity is what makes mutation sound.',
    steps: [
      {
        id: 1,
        line: 2,
        title: 'Exclusive borrow #1 created',
        detail:
          'mem.writer() takes &mut self. From this point the compiler treats writer as the only live way to touch the memtable — its live range starts here and ends at its last use.',
        lifetime: { label: 'writer (exclusive)', start: 2, end: 4, kind: 'mutable' },
      },
      {
        id: 2,
        line: 3,
        title: 'Exclusive borrow #2 attempted',
        detail:
          'mem.compactor() needs another &mut mem. No second exclusive borrow may exist while writer is still live — two writers could corrupt the segment index.',
        lifetime: { label: 'compactor → &mut mem', start: 3, end: 3, kind: 'conflict' },
      },
      {
        id: 3,
        line: 4,
        title: 'Last use of borrow #1',
        detail:
          'writer.push(batch) is the final use of writer — under NLL this is where its live range ends, one line too late for the compactor() call.',
        lifetime: { label: 'writer (exclusive)', start: 2, end: 4, kind: 'mutable' },
      },
      {
        id: 4,
        line: 3,
        title: 'Overlap rejected',
        detail:
          'writer\u2019s range [2..4] overlaps the second exclusive borrow at line 3. Rust rejects the program (E0499) — this is a soundness guarantee, not a style rule.',
        lifetime: { label: 'conflict region', start: 3, end: 3, kind: 'mutable' },
      },
    ],
    timelineTicks: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'],
    solutions: [
      {
        title: '1. Finish with the writer first',
        code: 'let mut writer = mem.writer();\nwriter.push(batch);\nlet compact = mem.compactor();\ncompact.flush();',
        tradeOff: 'No allocation; call order documents that staging completes before compaction.',
      },
      {
        title: '2. Scope the exclusive borrow',
        code: '{\n    let mut writer = mem.writer();\n    writer.push(batch);\n}\nlet compact = mem.compactor();\ncompact.flush();',
        tradeOff: 'Explicit braces make the exclusive region visible; zero runtime cost.',
      },
      {
        title: '3. Split disjoint capabilities in the type',
        code: 'let (mut writer, compact) = mem.split();\nwriter.push(batch);\ncompact.flush();',
        tradeOff:
          'split() takes one &mut and returns two handles over disjoint fields — the idiomatic fix when both handles are genuinely needed.',
      },
      {
        title: '4. Drop before re-borrowing',
        code: 'let mut writer = mem.writer();\nwriter.push(batch);\ndrop(writer);\nmem.compactor().flush();',
        tradeOff: 'drop() ends the borrow exactly where the intent is; reads clearly in review.',
      },
    ],
  },
  request: {
    id: 'B772',
    method: 'POST',
    path: '/ingest/batch',
    totalMs: 96.4,
    segments: [
      { id: 'decode', label: 'batch decode', startMs: 0, durationMs: 2.1, kind: 'compute', span: 'atlas-ingest::decode — arrow IPC' },
      { id: 'validate', label: 'schema validation', startMs: 2.1, durationMs: 1.2, kind: 'compute', span: 'atlas-schema::validate — wire format' },
      { id: 'encode', label: 'row-group encode', startMs: 3.3, durationMs: 18.4, kind: 'compute', span: 'atlas-parquet::encode', note: 'ran concurrently with SST flush', concurrent: true },
      { id: 'flush', label: 'SST flush', startMs: 3.3, durationMs: 88.9, kind: 'blocked', span: 'writer.rs:112 — std::fs::write', note: 'blocks the worker thread — ATL-ASY-007', concurrent: true },
      { id: 'ack', label: 'offset commit', startMs: 92.2, durationMs: 4.2, kind: 'compute', span: 'atlas-ingest::ack' },
    ],
    tasks: [
      { id: 'T1', label: 'handler task', state: 'running', detail: 'POST /ingest/batch — owns request scope' },
      { id: 'T2', label: 'decode task', parent: 'T1', state: 'awaited', detail: 'arrow IPC → RecordBatch — awaited via join!' },
      { id: 'T3', label: 'encode task', parent: 'T1', state: 'done', detail: 'row-group encode — finished while flush stalls' },
      { id: 'T4', label: 'flush task', parent: 'T1', state: 'blocked', detail: 'std::fs::write inside async fn — stalls the tokio worker (ATL-ASY-007)', findingId: 'ATL-ASY-007' },
      { id: 'T5', label: 'compaction hint (worker)', state: 'done', detail: 'spawned after flush decision; detached' },
    ],
    warnings: [
      'SST flush dominates: 92% of request latency is blocking file IO on the worker thread (ATL-ASY-007)',
      'worker stall 210ms p95 during ingest bursts — matches tokio-console telemetry',
      'encode and flush share one worker thread — spawn_blocking would let them overlap',
    ],
  },
}

