/**
 * fixtures/catalog — impact-simulator catalogs (add-dep + version-upgrade).
 *
 * Part of the data.ts decomposition (GitHub issue #53): `src/lib/wanyrix/data.ts`
 * is now a pure re-export barrel; the public surface (ADD_DEP_CATALOG) is
 * unchanged.
 *
 * Types moved with their domain (documented per issue #53):
 *  - UpgradeCatalogEntry — was a private interface in data.ts; it is exported
 *    here so sibling fixture modules (selectors.ts) can type the catalogs.
 *    NOT re-exported by the barrel, so the old public surface stays identical.
 *
 * ATLAS_ADD_DEP_CATALOG / UPGRADE_CATALOG / ATLAS_UPGRADE_CATALOG were
 * module-private in data.ts; they are exported here solely for the sibling
 * fixtures/selectors.ts module (the barrel does NOT re-export them).
 */
import { ATLAS_MATH, HELIOS_MATH } from './graph'

// ---------------------------------------------------------------------------
// Impact simulation catalogs
// ---------------------------------------------------------------------------

export const ADD_DEP_CATALOG: Record<
  string,
  {
    version: string
    cratesAdded: number
    procMacrosAdded: number
    targetMB: number
    cleanDelta: number
    incrementalDelta: number
    ciDelta: number
    transitiveDeps: number
    chain: { label: string; note?: string }[]
    security: { label: string; level: 'info' | 'warn' }[]
    suggestions: string[]
  }
> = {
  sqlx: {
    version: '0.8.6',
    cratesAdded: 14,
    procMacrosAdded: 3,
    targetMB: 28.4,
    cleanDelta: 4.7,
    incrementalDelta: 1.3,
    ciDelta: 21,
    transitiveDeps: 7,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +sqlx 0.8.6' },
      { label: 'sqlx', note: '+14 crates, +3 proc-macros' },
      { label: 'database', note: 'shared crate — highest blast radius' },
      { label: '18 downstream crates', note: 'full rebuild triggered' },
    ],
    security: [
      { label: '7 new transitive dependencies', level: 'info' },
      { label: 'sqlx-macros executes at build time — review build-script permissions', level: 'warn' },
    ],
    suggestions: [
      'Isolate sqlx behind a database-impl crate (keeps types clean)',
      'Enable only runtime-tokio-rustls features to shrink the tree',
      'Gate behind an optional feature until the retry layer lands',
    ],
  },
  'aws-sdk-s3': {
    version: '1.62.0',
    cratesAdded: 31,
    procMacrosAdded: 2,
    targetMB: 52.1,
    cleanDelta: 6.9,
    incrementalDelta: 2.2,
    ciDelta: 38,
    transitiveDeps: 24,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +aws-sdk-s3 1.62.0' },
      { label: 'aws-smithy stack', note: '+24 transitive crates' },
      { label: 'hyper/rustls', note: 'shared — already compiled' },
      { label: 'CI', note: '+38s per clean pipeline' },
    ],
    security: [
      { label: '24 new transitive dependencies', level: 'info' },
      { label: 'Large artifact footprint: +52.1 MB target size', level: 'warn' },
    ],
    suggestions: [
      'Wrap in a storage abstraction crate to contain the blast radius',
      'Disable unneeded behaviors (default-features = false)',
      'Consider presigned URLs via a thin client instead of the full SDK',
    ],
  },
  reqwest: {
    version: '0.12.9',
    cratesAdded: 11,
    procMacrosAdded: 1,
    targetMB: 12.7,
    cleanDelta: 2.8,
    incrementalDelta: 0.9,
    ciDelta: 14,
    transitiveDeps: 9,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +reqwest 0.12.9' },
      { label: 'hyper 1.x', note: 'new major — coexists with 0.14' },
      { label: 'rustls', note: 'shared with existing http-client' },
    ],
    security: [
      { label: '9 new transitive dependencies', level: 'info' },
      { label: 'Prefer rustls feature to avoid OpenSSL linkage', level: 'info' },
    ],
    suggestions: [
      'Reuse http-client instead of adding a second HTTP stack',
      'If required, enable json + rustls features only',
    ],
  },
  tonic: {
    version: '0.12.3',
    cratesAdded: 9,
    procMacrosAdded: 1,
    targetMB: 15.2,
    cleanDelta: 3.4,
    incrementalDelta: 1.1,
    ciDelta: 17,
    transitiveDeps: 11,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +tonic 0.12.3' },
      { label: 'prost', note: '+codegen at build time' },
      { label: 'hyper/tower', note: 'shared' },
    ],
    security: [{ label: '11 new transitive dependencies', level: 'info' }],
    suggestions: [
      'Keep proto codegen in a dedicated crate with build.rs isolation',
      'Share one tonic version across services via workspace.dependencies',
    ],
  },
  'opentelemetry-otlp': {
    version: '0.27.0',
    cratesAdded: 22,
    procMacrosAdded: 2,
    targetMB: 34.8,
    cleanDelta: 5.1,
    incrementalDelta: 1.8,
    ciDelta: 29,
    transitiveDeps: 18,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +opentelemetry-otlp 0.27' },
      { label: 'tonic + tracing-opentelemetry', note: 'overlaps telemetry crate' },
      { label: 'CI', note: '+29s per clean pipeline' },
    ],
    security: [
      { label: '18 new transitive dependencies', level: 'info' },
      { label: 'Feature matrix can duplicate opentelemetry builds — unify versions', level: 'warn' },
    ],
    suggestions: [
      'Integrate through the existing telemetry crate, not application crates',
      'Feature-gate the OTLP exporter behind telemetry-otlp',
    ],
  },
  'deadpool-redis': {
    version: '0.18.0',
    cratesAdded: 6,
    procMacrosAdded: 0,
    targetMB: 4.2,
    cleanDelta: 1.1,
    incrementalDelta: 0.4,
    ciDelta: 6,
    transitiveDeps: 4,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +deadpool-redis 0.18' },
      { label: 'redis crate', note: '+4 transitive' },
      { label: 'cache', note: 'natural owner for this dependency' },
    ],
    security: [{ label: '4 new transitive dependencies', level: 'info' }],
    suggestions: ['Add it inside the cache crate to keep fan-out low'],
  },
}

export const ATLAS_ADD_DEP_CATALOG: Record<
  string,
  {
    version: string
    cratesAdded: number
    procMacrosAdded: number
    targetMB: number
    cleanDelta: number
    incrementalDelta: number
    ciDelta: number
    transitiveDeps: number
    chain: { label: string; note?: string }[]
    security: { label: string; level: 'info' | 'warn' }[]
    suggestions: string[]
  }
> = {
  axum: {
    version: '0.8.1',
    cratesAdded: 9,
    procMacrosAdded: 2,
    targetMB: 8.6,
    cleanDelta: 3.1,
    incrementalDelta: 0.8,
    ciDelta: 12,
    transitiveDeps: 11,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +axum 0.8.1' },
      { label: 'axum-core', note: '+9 crates, +2 proc-macros' },
      { label: 'atlas-server', note: 'shared crate — highest blast radius' },
      { label: '8 downstream crates', note: 'full rebuild triggered' },
    ],
    security: [
      { label: '11 new transitive dependencies', level: 'info' },
      { label: 'axum-macros executes at build time — review build-script permissions', level: 'warn' },
    ],
    suggestions: [
      'Isolate axum behind an atlas-http crate (keeps handlers decoupled)',
      'Enable only tokio-rustls features to shrink the tree',
      'Keep extractor macros behind an optional feature',
    ],
  },
  redb: {
    version: '2.2.0',
    cratesAdded: 4,
    procMacrosAdded: 0,
    targetMB: 3.2,
    cleanDelta: 1.9,
    incrementalDelta: 0.6,
    ciDelta: 7,
    transitiveDeps: 3,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +redb 2.2.0' },
      { label: 'redb', note: '+4 crates, pure rust' },
      { label: 'atlas-store', note: 'engine crate — contained blast radius' },
      { label: '5 downstream crates', note: 'rebuild triggered' },
    ],
    security: [
      { label: '3 new transitive dependencies', level: 'info' },
      { label: 'No build scripts detected', level: 'info' },
    ],
    suggestions: [
      'Contained footprint — safe to adopt for the metadata store',
      'Pin via workspace dependency so the version cannot fork',
    ],
  },
  'tracing-appender': {
    version: '0.2.3',
    cratesAdded: 2,
    procMacrosAdded: 0,
    targetMB: 0.9,
    cleanDelta: 0.4,
    incrementalDelta: 0.1,
    ciDelta: 2,
    transitiveDeps: 2,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +tracing-appender 0.2.3' },
      { label: 'tracing stack', note: 'already compiled — zero marginal crates' },
      { label: 'CI', note: '+2s per clean pipeline' },
    ],
    security: [{ label: '2 new transitive dependencies', level: 'info' }],
    suggestions: ['Cheapest option in this catalog — already inside the tracing ecosystem'],
  },
  datafusion: {
    version: '43.0.0',
    cratesAdded: 38,
    procMacrosAdded: 1,
    targetMB: 61.7,
    cleanDelta: 8.4,
    incrementalDelta: 2.9,
    ciDelta: 44,
    transitiveDeps: 29,
    chain: [
      { label: 'your crate', note: 'Cargo.toml +datafusion 43.0.0' },
      { label: 'arrow + parquet', note: '+29 transitive crates' },
      { label: 'atlas-query', note: 'engine crate — widest fan-out' },
      { label: 'CI', note: '+44s per clean pipeline' },
    ],
    security: [
      { label: '29 new transitive dependencies', level: 'info' },
      { label: 'Heavy artifact footprint: +61.7 MB target size', level: 'warn' },
    ],
    suggestions: [
      'Adopt behind a query-engine trait to keep planners swappable',
      'Disable unneeded languages/features (default-features = false)',
      'Consider a sidecar process instead of an in-process dependency',
    ],
  },
}

// ---------------------------------------------------------------------------
// Version-upgrade simulation catalogs (round 9)
// Negative deltas are real outcomes here: unifying a duplicated version makes
// the build FASTER, and the UI renders those tiles as improvements.
// ---------------------------------------------------------------------------

export const UPGRADE_CATALOG: Record<
  string,
  UpgradeCatalogEntry
> = {
  tokio: {
    from: '1.40.0',
    to: '1.41.1',
    semver: 'minor',
    resolves: {
      kind: 'partial',
      note: 'Unifies the 1.40 lineage on 1.41.1 — the 1.34.2 pin (sqlx 0.7 · legacy-cache) needs its own migration before the tree is clean.',
    },
    cleanDelta: 0.8,
    incrementalDelta: 0.2,
    ciDelta: 3,
    breaking: [],
    migrations: [],
    notes: [
      'Semver-minor — all 1.x APIs stable; no source changes expected',
      `tokio reaches ${HELIOS_MATH.workspaceBlastRadius('tokio')} workspace crates on the served backbone — one bump recompiles all of them`,
      'New: tokio::task::JoinSet::poll_next stabilizations used by the ingest pipeline',
    ],
    suggestions: [
      'cargo update -p tokio && cargo test -p common-runtime (runtime crate is the risk surface)',
      'Stage the bump separately from feature work to isolate telemetry noise',
      'Run wanyrix doctor after the bump — critical-path numbers shift when the tokio lineage recompiles',
    ],
  },
  serde: {
    from: '1.0.210',
    to: '1.0.215',
    semver: 'patch',
    resolves: {
      kind: 'partial',
      note: 'Moves the modern lineage to 1.0.215 — old-sdk 2.1 still pins 1.0.203; dropping that pin is what fully unifies the tree.',
    },
    cleanDelta: 0.3,
    incrementalDelta: 0.1,
    ciDelta: 2,
    breaking: [],
    migrations: [],
    notes: [
      'Patch release — bugfix + performance only; zero expected API impact',
      `serde_derive (proc-macro) changes version → ${HELIOS_MATH.workspaceBlastRadius('serde')} backbone crates recompile despite the patch`,
    ],
    suggestions: [
      'Bump freely in the same PR as dependency hygiene work — noise is low',
      'Pin with =1.0.215 only if downstream consumers snapshot your lockfile',
    ],
  },
  'wasm-bindgen': {
    from: '0.2.95',
    to: '0.2.100',
    semver: 'patch',
    cleanDelta: 0.4,
    incrementalDelta: 0.1,
    ciDelta: 2,
    breaking: [],
    migrations: [],
    notes: [
      'wasm-bindgen 0.2.x pairs strictly with wasm-bindgen-cli — update BOTH',
      'Mismatched cli versions produce runtime link errors, not compile errors — easy to miss locally',
      'CI uses --locked; the wasm toolchain Dockerfile needs the same bump',
    ],
    suggestions: [
      'Update wasm-bindgen-cli in .cargo/config + CI image in the same commit',
      'wasm-pack build --target web must be re-verified on the fixtures suite',
    ],
  },
  hyper: {
    from: '0.14.31',
    to: '1.5.2',
    semver: 'major',
    cleanDelta: 1.2,
    incrementalDelta: 0.5,
    ciDelta: 6,
    breaking: [
      {
        title: 'Body trait redesign',
        detail: 'hyper::Body is gone — http_body::Frame + BodyData replaces the stream API in server handlers.',
      },
      {
        title: 'Server builder moves to hyper-util',
        detail: 'hyper::server::Server is now hyper_util::server::conn::auto::Builder — connection plumbing changes.',
      },
      {
        title: 'Client connection pool removed',
        detail: 'hyper 1.x has no built-in pool — adopt hyper-util::client::legacy or migrate to reqwest.',
      },
    ],
    migrations: [
      {
        code: 'let svc = hyper_util::service::TokioExecutor::new();\nlet conn = hyper_util::server::conn::auto::Builder::new(svc);',
        note: 'replaces hyper::server::conn::Http — auto builder serves both HTTP/1 and h2',
      },
      {
        code: 'use http_body_util::BodyExt;\nlet body = req.into_body().collect().await?.to_bytes();',
        note: 'replaces hyper::body::to_bytes — collect() is the 1.x streaming join',
      },
    ],
    notes: [
      `${HELIOS_MATH.workspaceBlastRadius('hyper')} workspace crates compile against hyper on the served backbone (via reqwest and tonic)`,
      'Existing reqwest 0.12 already vendors hyper 1.x — tree gains ONE hyper instead of two if 0.14 is dropped',
      'tonic version must be co-bumped: tonic 0.12 requires hyper 1.x',
    ],
    suggestions: [
      'Land behind a transport feature gate; migrate the lowest-fan-in consumer first',
      'Check tonic/hyper compatibility matrix before writing code',
      'Use the Impact Simulator split-crate view after migration — gateway fan-out will have changed',
    ],
  },
}

/**
 * Shared shape of the per-workspace version-upgrade catalogs (round 9).
 * `resolves` (round 10) marks scenarios that close a duplicate-version group:
 * 'full' = the upgrade unifies the tree; 'partial' = one lineage moves but a
 * pin elsewhere keeps the duplicate alive — surfaced honestly in the UI.
 *
 * ENG-TCA-3: `duplicateBefore` and `recompileCrates` are NOT stored here —
 * they are derived at serve time from the workspace's duplicates list and the
 * served graph closure, so they can never contradict the graph payload.
 */
export interface UpgradeCatalogEntry {
  from: string
  to: string
  semver: 'major' | 'minor' | 'patch'
  resolves?: { kind: 'full' | 'partial'; note: string }
  cleanDelta: number
  incrementalDelta: number
  ciDelta: number
  breaking: { title: string; detail: string }[]
  migrations: { code: string; note: string }[]
  notes: string[]
  suggestions: string[]
}

export const ATLAS_UPGRADE_CATALOG: Record<
  string,
  UpgradeCatalogEntry
> = {
  bytes: {
    from: '1.8.0',
    to: '1.9.0',
    semver: 'minor',
    resolves: {
      kind: 'full',
      note: 'Unifying on 1.9.0 removes the duplicate artifact introduced by PR #97 buffer-pool vendoring — cargo tree -d goes clean.',
    },
    cleanDelta: -0.6,
    incrementalDelta: -2.1,
    ciDelta: -4.0,
    breaking: [],
    migrations: [],
    notes: [
      'De-duplication win: the tree currently compiles bytes 1.8.0 AND 1.9.0 (cargo tree -d)',
      'Unifying on 1.9.0 removes the duplicate artifact introduced by PR #97 buffer-pool vendoring',
      '−2.1s incremental matches the regression PR #97 added to atlas-common touches — this reverses it',
      'Alternative: pin the tree back to 1.8.0 (cargo update -p bytes@1.9.0 --precise 1.8.0) — same de-dup, opposite direction',
    ],
    suggestions: [
      'cargo update -p bytes@1.8.0 --precise 1.9.0 — unifies the tree on one bytes',
      'Re-run the PR #97 analysis after landing: atlas-common touches should return to ≈6.8s',
      'Pair with ATL-WRK-005 (extract atlas-bytes) to keep the fan-out from re-growing',
    ],
  },
  sqlx: {
    from: '0.8.2',
    to: '0.8.6',
    semver: 'patch',
    cleanDelta: 0.2,
    incrementalDelta: 0.1,
    ciDelta: 1,
    breaking: [],
    migrations: [],
    notes: [
      'Patch series: query macro caching fix — first compile after bump may be slower once',
      `atlas-store is the only crate touching sqlx directly; ${ATLAS_MATH.workspaceBlastRadius('sqlx')} crates recompile through the types module`,
    ],
    suggestions: [
      'cargo update -p sqlx && cargo sqlx prepare (offline query data must be regenerated)',
    ],
  },
  prost: {
    from: '0.13.3',
    to: '0.13.4',
    semver: 'patch',
    cleanDelta: 0.1,
    incrementalDelta: 0.1,
    ciDelta: 1,
    breaking: [],
    migrations: [],
    notes: [
      'Codegen byte-identical for the current .proto set — verified against the schema snapshot',
      'prost-build runs in build.rs — build-script reruns touch atlas-ingest and atlas-query',
    ],
    suggestions: ['Bump together with the arrow 53→54 upgrade to batch the recompile window'],
  },
}

