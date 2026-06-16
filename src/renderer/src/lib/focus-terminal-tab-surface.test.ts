import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusTerminalTabSurface } from './focus-terminal-tab-surface'

describe('focusTerminalTabSurface', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function flushAnimationFrames(): void {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  }

  it('focuses the scoped xterm helper textarea', () => {
    flushAnimationFrames()
    const textarea = { focus: vi.fn() }
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) =>
        selector === '[data-terminal-tab-id="tab-1"] .xterm-helper-textarea' ? textarea : null
      )
    })

    focusTerminalTabSurface('tab-1')

    expect(textarea.focus).toHaveBeenCalled()
  })

  it('does not steal focus while inline tab rename is open', () => {
    flushAnimationFrames()
    const textarea = { focus: vi.fn() }
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => {
        if (selector === '[data-tab-rename-input="true"]') {
          return {}
        }
        return selector === '[data-terminal-tab-id="tab-1"] .xterm-helper-textarea'
          ? textarea
          : null
      })
    })

    focusTerminalTabSurface('tab-1')

    expect(textarea.focus).not.toHaveBeenCalled()
  })

  it('does not steal focus via the global fallback while a terminal is already focused', () => {
    flushAnimationFrames()
    const fallback = { focus: vi.fn() }
    vi.stubGlobal('document', {
      // The requested tab is not mounted, so the scoped lookup misses and only
      // the global fallback would match.
      querySelector: vi.fn((selector: string) =>
        selector === '.xterm-helper-textarea' ? fallback : null
      ),
      // The user is actively typing in some other terminal.
      activeElement: { classList: { contains: (cls: string) => cls === 'xterm-helper-textarea' } }
    })

    focusTerminalTabSurface('not-mounted-tab')

    expect(fallback.focus).not.toHaveBeenCalled()
  })

  it('uses the global fallback when focus is outside any terminal', () => {
    flushAnimationFrames()
    const fallback = { focus: vi.fn() }
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) =>
        selector === '.xterm-helper-textarea' ? fallback : null
      ),
      activeElement: { classList: { contains: () => false } }
    })

    focusTerminalTabSurface('not-mounted-tab')

    expect(fallback.focus).toHaveBeenCalled()
  })

  it('cancels a pending focus frame when a newer focus request starts', () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 9)
    )
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null)
    })

    focusTerminalTabSurface('tab-1')
    focusTerminalTabSurface('tab-2')

    expect(cancelAnimationFrame).toHaveBeenCalledWith(9)
  })
})
