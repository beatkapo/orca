# Memory Leak Audit Final Comb

Started: 2026-05-29 PDT

Current tracker branch: `nwparker/mem-leak-final-comb-current`, based on `origin/main` at `a99c376f3b` after rebasing over later mainline changes.

Objective: run one more complete pass across the current Orca tree for missed listener, timer, observer, worker, socket, watcher, subscription, abort, and disposable leaks; open scoped PRs for confirmed stranglers; include risk level and merge low-risk PRs.

## Codebase Inventory

Tracked code files, from `git ls-files`:

| Bucket            | Files | Status  |
| ----------------- | ----: | ------- |
| `src/renderer`    |  1592 | Checked |
| `src/main`        |   867 | Checked |
| `src/shared`      |   246 | Checked |
| `mobile/src`      |   100 | Checked |
| `tests/e2e`       |    72 | Checked |
| `src/relay`       |    65 | Checked |
| `src/cli`         |    65 | Checked |
| `config/scripts`  |    33 | Checked |
| `mobile/app`      |    16 | Checked |
| `other-code`      |     5 | Checked |
| `src/preload`     |     6 | Checked |
| `mobile/packages` |     5 | Checked |
| Total             |  3072 | Checked |

## Scan Log

- 2026-05-29: Created fresh final-comb branch from current `origin/main`.
- 2026-05-29: Fast-forwarded the final-comb branch as `origin/main` moved; final tracker is based on `869661cbba`.
- 2026-05-29: Counted 3341 broad risk-pattern hits across `src`, `mobile`, `tests`, `config`, and `native` on the final post-fix tree.
- 2026-05-29: Re-ran heuristic buckets after fixes:
  - `addEventListener` without same-file `removeEventListener`: 37 remaining. Reviewed as React Native subscriptions with `.remove()`, injected WebView document-lifetime scripts, `{ once: true }` image load handlers, IPC abort-signal test listeners, singleton image-cache invalidation, owned pane-divider DOM, and test fixture listeners.
  - `setInterval` without `clearInterval`: 1 remaining, a test comment string.
  - `setTimeout` without same-file `clearTimeout`: 233 remaining. Reviewed remaining main-process hits as sleep helpers, intentional app relaunch/exit delays, socket idle timeout ownership, usage-scanner yield points, and startup force-exit behavior. Confirmed final-comb timer findings are fixed in PRs listed below.
  - Observers without `disconnect`: 0.
  - Workers without `terminate`: 0.
  - Abort controllers without `abort`: 1 test-only controller passed through the abortable API under test.
  - Watchers without close/unwatch: no production misses; remaining heuristic hits are provider type/comment references.
- 2026-05-29: Re-ran React effect scan and spot-checked candidates. Remaining hits had cleanup returns (`clearTimeout`, `clearInterval`, `removeEventListener`, IPC unsubscribe) or were short one-shot UI focus/open delays.
- 2026-05-29: Rebased the final comb over current `origin/main` at `a99c376f3b` after additional mainline merges.
- 2026-05-29: Counted 3345 broad risk-pattern hits across `src`, `mobile`, `tests`, `config`, and `native` on the current tree.
- 2026-05-29: Re-ran heuristic buckets on the current tree:
  - `addEventListener` without same-file `removeEventListener`: 37 remaining, same reviewed categories as the previous final-comb pass.
  - `setInterval` without `clearInterval`: 1 remaining, a test comment string.
  - `setTimeout` without same-file `clearTimeout`: 235 remaining. New changed-file production hits were intentional app relaunch/restart delays before process exit and a zero-delay floating-terminal focus handoff. Other changed timer candidates had explicit cleanup.
  - Observers without `disconnect`: 0.
  - Workers without `terminate`: 0.
  - Abort controllers without `abort`: 1 test-only controller passed through the abortable API under test.
  - Watchers without close/unwatch: no production misses; remaining heuristic hits are provider type/comment references.
- 2026-05-29: Focus-reviewed code changed since the previous tracker merge (`ca15aeb466..a99c376f3b`), including WSL runtime/account selection, daemon PTY checkpointing, main-window/rate-limit listeners, preload IPC subscriptions, feature-tip/settings/status-bar UI, feature-wall animation effects, FileExplorer reset effects, and renderer IPC subscriptions. No new confirmed leak needed a code PR.

## Findings

| PR | Risk | Status | Finding | Resolution |
| -- | ---- | ------ | ------- | ---------- |
| [#3305](https://github.com/stablyai/orca/pull/3305) | LOW | Merged | Browser reload fallback timer retained the reload promise closure, webContents reference, and listeners until the 10s fallback fired even after `did-finish-load`/`did-fail-load`. | Clear the fallback timer on early settle, guard duplicate cleanup, and test with fake timers. |
| [#3306](https://github.com/stablyai/orca/pull/3306) | LOW | Merged | Native notification retention timers stayed scheduled after close/click cleanup, retaining notification closures until fallback expiry. | Clear notification fallback timers on release, detach native listeners, and cover dispatch/startup/accessibility notification paths. |
| [#3307](https://github.com/stablyai/orca/pull/3307) | LOW | Merged | Local-network permission UDP prompt kept its 1s fallback timer and socket error listener after the send callback settled first. | Clear the fallback timer, remove the error listener, and test the `developerPermissions:request` local-network path. |

No higher-risk findings remained after the final pass, so no second higher-risk mitigation pass was needed.

Current rebase verification found no additional confirmed findings beyond the already merged low-risk PRs above.

## Validation

- `pnpm vitest run --config config/vitest.config.ts src/main/browser/agent-browser-bridge.test.ts`
- `pnpm vitest run --config config/vitest.config.ts src/main/browser/agent-browser-bridge.test.ts src/main/ipc/notifications.test.ts src/main/computer/permissions.test.ts src/main/ipc/developer-permissions.test.ts`
- `pnpm vitest run --config config/vitest.config.ts src/main/ipc/notifications.test.ts src/main/computer/permissions.test.ts`
- `pnpm vitest run --config config/vitest.config.ts src/main/ipc/developer-permissions.test.ts`
- `pnpm exec oxlint src/main/browser/agent-browser-bridge.ts src/main/browser/agent-browser-bridge.test.ts src/main/ipc/notifications.ts src/main/ipc/notifications.test.ts src/main/computer/permissions.ts src/main/computer/permissions.test.ts src/main/ipc/developer-permissions.ts src/main/ipc/developer-permissions.test.ts`
- `pnpm run typecheck:node`
- Current rebase pass:
  - `git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'mobile/**/*.ts' 'mobile/**/*.tsx' 'tests/**/*.ts' 'tests/**/*.tsx' 'config/**/*.js' 'config/**/*.mjs' 'native/**/*.ts'`
  - broad `rg` risk-pattern count across `src`, `mobile`, `tests`, `config`, and `native`
  - heuristic scans for unmatched listeners, intervals, timers, observers, workers, abort controllers, watchers, React effects, changed-file subscriptions, and changed-file timers
  - manual changed-file review from `ca15aeb466` to `a99c376f3b`
