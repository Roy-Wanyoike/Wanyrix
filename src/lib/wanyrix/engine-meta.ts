/**
 * Engine metadata surfaced in web UI (R9 drift fix).
 *
 * The sidebar footer and the CLI-contract dialog state the engine version —
 * previously hardcoded per-spot and left at v0.3.0 after the engine reached
 * v0.5.0. One constant, one place; `tests/unit/engine-meta.test.ts` pins it
 * to `engine/Cargo.toml` so the two can never drift again.
 */
export const ENGINE_VERSION = '0.8.0'
