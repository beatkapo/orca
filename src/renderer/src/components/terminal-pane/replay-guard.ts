import type { ManagedPane } from '@/lib/pane-manager/pane-manager'

// Why: xterm.js auto-responds to terminal query sequences (DA1 `CSI c`,
// DECRQM `CSI ? Ps $ p`, OSC 10/11 color queries, focus events, CPR) by
// emitting the reply through its onData callback. In pty-connection.ts that
// callback is wired directly to `transport.sendInput`, which pipes the reply
// to the shell's stdin. When we restore terminal state at startup or on
// reattach we write recorded PTY bytes back into xterm — including any
// queries the previous agent CLI emitted — and the auto-replies end up as
// stray characters on the new shell's prompt (e.g. `?1;2c`, `2026;2$y`,
// OSC 10/11 color fragments).
//
// xterm does not expose a `wasUserInput` flag on its public onData, so we
// cannot distinguish replay-induced replies from real keystrokes after the
// fact. Instead, we track an in-flight replay counter per pane: callers
// replay into xterm via `replayIntoTerminal`, which increments the counter,
// writes, and decrements in xterm's write-completion callback. The onData
// handler in pty-connection.ts drops data while the counter is non-zero.
//
// The guard window is bounded by xterm's own parse completion, not a
// wall-clock timer, so only replies generated while parsing the replayed
// bytes are suppressed. User keystrokes typed after the replay completes
// are unaffected. In practice replay finishes within milliseconds — before
// the user could meaningfully type — so the few-ms window where real input
// would also be dropped is acceptable relative to correctness.

export type ReplayingPanesRef = React.RefObject<Map<number, number>>

const REPLAY_INPUT_GUARD_MAX_MS = 500
const replayStartedAtByMap = new WeakMap<Map<number, number>, Map<number, number>>()

function replayStartedAt(map: Map<number, number>): Map<number, number> {
  let startedAt = replayStartedAtByMap.get(map)
  if (!startedAt) {
    startedAt = new Map()
    replayStartedAtByMap.set(map, startedAt)
  }
  return startedAt
}

export function isPaneReplaying(ref: ReplayingPanesRef, paneId: number): boolean {
  const count = ref.current.get(paneId) ?? 0
  if (count <= 0) {
    return false
  }
  const startedAt = replayStartedAt(ref.current).get(paneId)
  if (startedAt !== undefined && Date.now() - startedAt > REPLAY_INPUT_GUARD_MAX_MS) {
    // Why: xterm write callbacks can be delayed or lost during hidden snapshot
    // replay. Bound the guard so real user input cannot be suppressed forever.
    ref.current.delete(paneId)
    replayStartedAt(ref.current).delete(paneId)
    return false
  }
  return true
}

/** Writes `data` into the pane's terminal with the replay guard engaged,
 *  so xterm's auto-replies to embedded query sequences do not leak to the
 *  shell as input. The counter increments/decrements so nested replays
 *  (e.g. clear-screen preamble + snapshot body) compose correctly. */
export function replayIntoTerminal(
  pane: ManagedPane,
  replayingPanesRef: ReplayingPanesRef,
  data: string
): void {
  if (!data) {
    return
  }
  const map = replayingPanesRef.current
  if ((map.get(pane.id) ?? 0) === 0) {
    replayStartedAt(map).set(pane.id, Date.now())
  }
  map.set(pane.id, (map.get(pane.id) ?? 0) + 1)
  pane.terminal.write(data, () => {
    const remaining = (map.get(pane.id) ?? 1) - 1
    if (remaining <= 0) {
      map.delete(pane.id)
      replayStartedAt(map).delete(pane.id)
    } else {
      map.set(pane.id, remaining)
    }
  })
}

export function replayIntoTerminalAsync(
  pane: ManagedPane,
  replayingPanesRef: ReplayingPanesRef,
  data: string
): Promise<void> {
  if (!data) {
    return Promise.resolve()
  }
  const map = replayingPanesRef.current
  if ((map.get(pane.id) ?? 0) === 0) {
    replayStartedAt(map).set(pane.id, Date.now())
  }
  map.set(pane.id, (map.get(pane.id) ?? 0) + 1)
  return new Promise((resolve) => {
    pane.terminal.write(data, () => {
      const remaining = (map.get(pane.id) ?? 1) - 1
      if (remaining <= 0) {
        map.delete(pane.id)
        replayStartedAt(map).delete(pane.id)
      } else {
        map.set(pane.id, remaining)
      }
      resolve()
    })
  })
}
