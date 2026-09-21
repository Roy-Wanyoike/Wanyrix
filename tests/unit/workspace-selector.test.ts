import { describe, expect, test } from 'bun:test'
import { workspaceSelectorState } from '../../src/lib/wanyrix/workspace-selector'

/**
 * Issue #78 — the topbar workspace selector must distinguish an honest
 * error state from a transient loading state. These tests pin the pure
 * state mapping (loading / error+retrying / ready) used by app-shell.
 */
describe('workspace selector state mapping (issue #78)', () => {
  test('first load, no data, not erroring → loading… and disabled', () => {
    const s = workspaceSelectorState({ isError: false, hasData: false, isFetching: true })
    expect(s.kind).toBe('loading')
    if (s.kind === 'loading') {
      expect(s.label).toBe('loading…')
      expect(s.disabled).toBe(true)
    }
  })

  test('query error → "registry unavailable", disabled, retry not yet in flight', () => {
    const s = workspaceSelectorState({ isError: true, hasData: false, isFetching: false })
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.label).toBe('registry unavailable')
      expect(s.disabled).toBe(true)
      expect(s.retrying).toBe(false)
    }
  })

  test('query error while retrying → same honest label with retrying=true', () => {
    const s = workspaceSelectorState({ isError: true, hasData: false, isFetching: true })
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.label).toBe('registry unavailable')
      expect(s.retrying).toBe(true)
    }
  })

  test('data present → ready, never disabled by the state machine itself', () => {
    const s = workspaceSelectorState({ isError: false, hasData: true, isFetching: false })
    expect(s.kind).toBe('ready')
    if (s.kind === 'ready') {
      expect(s.disabled).toBe(false)
      expect(s.label).toBeNull()
    }
  })

  test('error state wins over stale data — a failed refetch is an error, not silence', () => {
    // TanStack keeps previous data during a failed refetch; the selector
    // must still surface the failure (hasData=true + isError=true).
    const s = workspaceSelectorState({ isError: true, hasData: true, isFetching: false })
    expect(s.kind).toBe('error')
  })

  test('label is never a fabricated workspace name (Gate 21)', () => {
    const error = workspaceSelectorState({ isError: true, hasData: false, isFetching: false })
    const loading = workspaceSelectorState({ isError: false, hasData: false, isFetching: true })
    if (error.kind === 'error') expect(error.label).not.toBe('helios-platform')
    if (loading.kind === 'loading') expect(loading.label).not.toBe('helios-platform')
  })
})
