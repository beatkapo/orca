export const DEFAULT_TERMINAL_SCROLLBACK_BYTES = 10_000_000
export const TERMINAL_SCROLLBACK_BYTES_PER_LINE_ESTIMATE = 200
export const TERMINAL_SCROLLBACK_MIN_LINES = 1000
export const TERMINAL_SCROLLBACK_MAX_LINES = 100_000

export function resolveEffectiveTerminalScrollbackLines(
  scrollbackBytes: number = DEFAULT_TERMINAL_SCROLLBACK_BYTES
): number {
  return Math.min(
    TERMINAL_SCROLLBACK_MAX_LINES,
    Math.max(
      TERMINAL_SCROLLBACK_MIN_LINES,
      Math.round(scrollbackBytes / TERMINAL_SCROLLBACK_BYTES_PER_LINE_ESTIMATE)
    )
  )
}
