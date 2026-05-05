# Plan: Click an agent → focus its pane (shared helper)

## Context

In a split-terminal tab, several "click an agent / click a session" entry points already activate the right tab via `setActiveTab` but leave whichever pane was last active highlighted, instead of focusing the pane that backs the row the user just clicked.

The titlebar agent hovercard (`App.tsx`) already gets this right: after `setActiveTab` it dispatches `FOCUS_TERMINAL_PANE_EVENT` on the next animation frame, and `useTerminalPaneGlobalEffects` listens for it and calls `manager.setActivePane(paneId, { focus: true })`. Every other entry point that lands the user on a tab is missing this dispatch.

Auditing the codebase turned up four sites total:

1. `App.tsx` — titlebar agent hovercard. Only existing implementation of the rAF+dispatch pattern.
2. `WorktreeCardAgents.tsx` — sidebar inline agent rows. Originally-reported bug.
3. `ManageSessionsSection.tsx` — Settings → Manage Sessions table. Latent same-class bug.
4. `SessionsStatusSegment.tsx` — bottom status-bar Sessions popover. Latent same-class bug.

Patching only the sidebar would leave two latent bugs and a footgun where every future "go to this terminal" entry point has to remember the rAF+dispatch dance. Extracting a one-call helper is a comparable-sized diff to the original single-site fix and removes the trap entirely.

## The helper

New file: `src/renderer/src/lib/activate-tab-and-focus-pane.ts`

```ts
import { useAppStore } from '@/store'
import { FOCUS_TERMINAL_PANE_EVENT, type FocusTerminalPaneDetail } from '@/constants/terminal'

export function activateTabAndFocusPane(tabId: string, paneId: number | null): void {
  useAppStore.getState().setActiveTab(tabId)
  if (paneId === null) {
    return
  }
  // Why: defer one frame so the new TerminalPane has mounted its
  // FOCUS_TERMINAL_PANE_EVENT listener before we dispatch.
  requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent<FocusTerminalPaneDetail>(FOCUS_TERMINAL_PANE_EVENT, {
        detail: { tabId, paneId },
      })
    )
  })
}
```

The `CustomEvent<FocusTerminalPaneDetail>` type parameter pins the dispatch shape to the exported listener type, so any future drift on either side fails compile.

Signature reasoning: `paneId: number | null` (Option A1). All four call sites already either (a) parse `paneId` from a `paneKey` themselves and would pass it as a number, or (b) genuinely don't have a `paneId` available and need the no-pane-focus fallback. Accepting `paneId: number | null` makes that contract explicit at the type level; pushing string parsing into the helper would add a second code path that only one caller (sidebar) would need.

`setActiveTab` is read via `useAppStore.getState()` so the helper is callable from anywhere (matches the access pattern App.tsx already uses on the hovercard click handler).

## Call-site migration

### 1. `src/renderer/src/App.tsx` (titlebar agent hovercard, ~lines 845-862)

Today: hand-rolled `useAppStore.getState().setActiveTab(agent.tabId)` + conditional `requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(FOCUS_TERMINAL_PANE_EVENT, …)))`. This is the only working reference implementation.

After: replace the inline dispatch with `activateTabAndFocusPane(agent.tabId, agent.paneId)`. `agent.paneId` is already `number | null` on the agent row, so it threads through unchanged. The local `// Why:` comment on the rAF block is removed (the helper owns it now).

### 2. `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx` (~line 87 `handleActivateAgentTab`)

Today: `setActiveTab(tabId)` only. In a split tab, the previously-active pane stays highlighted instead of the clicked agent's pane.

After: parse `paneId` from `paneKey` once at the top of `handleActivateAgentTab` and call the helper.

```ts
const colon = paneKey.indexOf(':')
const parsed = colon === -1 ? NaN : Number(paneKey.slice(colon + 1))
let paneId: number | null = null
if (Number.isFinite(parsed)) {
  paneId = parsed
} else {
  // Why: paneKey for sidebar agent rows is always ${tabId}:${paneId};
  // a non-numeric tail means upstream row construction drifted.
  console.warn('[WorktreeCardAgents] malformed paneKey, skipping pane focus', paneKey)
}
// …existing acknowledgeAgents + activateAndRevealWorktree + tab existence check…
if (tabs.some((t) => t.id === tabId)) {
  activateTabAndFocusPane(tabId, paneId)
}
```

paneKey format `${tabId}:${paneId}` matches the convention in `useDashboardData.ts:108-114` (split on first `:`). The `console.warn` surfaces the unreachable case if it ever fires, instead of silently regressing back to the very bug this plan fixes. The component-scoped `setActiveTab` selector goes away in favor of the helper call.

### 3. `src/renderer/src/components/settings/ManageSessionsSection.tsx` (`handleNavigate`, ~lines 181-198)

Today: rows carry only `session.sessionId` (ptyId). The component reverse-maps ptyId → tabId via `ptyIdsByTabId`, then calls `setActiveTab(tabId)`. No pane focus — same latent bug as the sidebar.

paneId resolution: **none available.** `ptyIdsByTabId` is `Record<tabId, ptyId[]>` and does not record which numeric `paneId` (the runtime id assigned by `TerminalPaneManager`) each ptyId belongs to outside of the live mounted manager. The persisted `terminalLayoutsByTabId[tabId].ptyIdsByLeafId` keys by `leafId` (a layout-tree string like `"pane:1"`), not by the runtime numeric `paneId` the focus listener compares against. There is no store selector that maps ptyId → numeric paneId for an unmounted tab.

After: pass `null` for paneId — the helper degrades to today's tab-only behavior, which is strictly no worse than the status quo, and the user still lands on the correct tab. If the tab happens to be a single-pane tab the visible result is identical to a pane-focus dispatch. Replace the inline `setActiveTab(tabId)` with `activateTabAndFocusPane(tabId, null)` and drop the local `setActiveTab` selector. `setActiveView('terminal')` and `closeSettingsPage()` stay as-is.

### 4. `src/renderer/src/components/status-bar/SessionsStatusSegment.tsx` (`handleNavigate`, ~lines 226-239)

Today: same shape as #3 — rows carry only ptyId, the component reverse-maps to tabId, and calls `setActiveTab(tabId)`. Same latent bug.

paneId resolution: same as #3 — not derivable; pass `null`.

After: replace `setActiveTab(tabId)` with `activateTabAndFocusPane(tabId, null)` and drop the local `setActiveTab` selector. `setActiveView('terminal')` stays.

## Existing pieces to reuse

- `FOCUS_TERMINAL_PANE_EVENT` and `FocusTerminalPaneDetail` from `src/renderer/src/constants/terminal.ts`
- Listener at `src/renderer/src/components/terminal-pane/use-terminal-pane-global-effects.ts:223-241` (already mounted per TerminalPane; resolves `pane.id === detail.paneId` and calls `manager.setActivePane(pane.id, { focus: true })`)
- paneKey format `${tabId}:${paneId}` — split on first `:`, matching `useDashboardData.ts:108-114`

## Files

- `src/renderer/src/lib/activate-tab-and-focus-pane.ts` (new)
- `src/renderer/src/App.tsx` (migrate hovercard)
- `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx` (fix bug, migrate)
- `src/renderer/src/components/settings/ManageSessionsSection.tsx` (latent fix, migrate; passes `null`)
- `src/renderer/src/components/status-bar/SessionsStatusSegment.tsx` (latent fix, migrate; passes `null`)

## Verification

For each of the four entry points, in a workspace with a split-terminal tab running two agents (one per pane):

1. **Sidebar inline agent row** — click each row in `WorktreeCardAgents`; the right tab activates and the right pane within that tab is focused (active outline + keystrokes go to the clicked agent's terminal).
2. **Titlebar hovercard** — regression check: open the titlebar agent hovercard, click each agent; confirm parity with the sidebar after migration (same end state for the same agent).
3. **Manage Sessions table** (Settings → Manage Sessions) — click a row whose ptyId belongs to a split-tab pane; the tab activates and Settings closes. Pane focus falls back to the previously-active pane (documented `null` fallback). Single-pane tabs behave identically to pre-change.
4. **Sessions status-bar popover** (bottom bar Terminal Sessions dropdown) — click a session row; the tab activates and view switches to terminal. Same `null` fallback.

Cross-cutting:

- Cross-workspace: from a different workspace, trigger each entry point; the worktree switches first (via `activateAndRevealWorktree`, which the relevant sites already call), then the tab activates, then the pane focuses.
- Single-pane tab (helper called with a real paneId): dispatch is harmless — the listener just no-ops if the pane id matches the only pane.
- Helper called with `null`: no `FOCUS_TERMINAL_PANE_EVENT` is dispatched (verify via devtools event listener / console log if needed).

## Out of scope

- Refactoring other terminal CustomEvent dispatchers (`SPLIT_TERMINAL_PANE_EVENT`, `CLOSE_TERMINAL_PANE_EVENT`, `TOGGLE_TERMINAL_PANE_EXPAND_EVENT`, `SYNC_FIT_PANES_EVENT`) — different lifecycles, not part of the "navigate then focus" pattern.
- Building a ptyId → numeric paneId selector to give the Sessions/ManageSessions sites real pane focus. Would require either persisting paneId alongside ptyIdsByLeafId or walking the live manager registry; both are larger changes than this fix warrants. The `null` fallback is acceptable and matches today's behavior at those entry points.
