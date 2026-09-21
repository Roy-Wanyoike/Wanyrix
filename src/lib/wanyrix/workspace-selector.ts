/**
 * Workspace-selector state machine (issue #78).
 *
 * The topbar workspace selector must never present a FAILURE as a transient
 * loading state (Gate 21 spirit: absent data is labeled, never hidden behind
 * a spinner). This pure mapping turns the TanStack Query status of
 * `useWorkspaces()` into exactly three honest selector states:
 *
 * - `loading` — the first fetch has not produced data yet (`loading…`)
 * - `error`   — the registry request failed (`registry unavailable`); the
 *               selector stays disabled and the UI offers a retry. While the
 *               retry is in flight, `retrying` is true so the control can
 *               show in-progress feedback instead of a dead button.
 * - `ready`   — data is available; the selector behaves as before (disabled
 *               only when the registry itself is genuinely empty).
 *
 * Kept as a pure function so the mapping is unit-testable without a DOM —
 * this repo's test stack has no React renderer (see tests/unit/).
 */

export interface WorkspaceSelectorInput {
  /** Query errored (any attempt, no data to fall back on). */
  isError: boolean
  /** Query has produced a payload at least once. */
  hasData: boolean
  /** A fetch is currently in flight (first load or refetch). */
  isFetching: boolean
}

export type WorkspaceSelectorState =
  | { kind: 'loading'; label: 'loading…'; disabled: true }
  | {
      kind: 'error'
      label: 'registry unavailable'
      disabled: true
      retrying: boolean
    }
  | { kind: 'ready'; label: null; disabled: false }

export function workspaceSelectorState(
  input: WorkspaceSelectorInput,
): WorkspaceSelectorState {
  if (input.isError) {
    return {
      kind: 'error',
      label: 'registry unavailable',
      disabled: true,
      retrying: input.isFetching,
    }
  }
  if (!input.hasData) {
    return { kind: 'loading', label: 'loading…', disabled: true }
  }
  return { kind: 'ready', label: null, disabled: false }
}
