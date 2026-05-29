import type { DetectedWorktreeListResult, TerminalTab, Worktree } from '../../../shared/types'

export function getUnreadBadgeCount({
  worktreesByRepo,
  detectedWorktreesByRepo = {},
  tabsByWorktree,
  unreadTerminalTabs
}: {
  worktreesByRepo: Record<string, Worktree[]>
  detectedWorktreesByRepo?: Record<string, DetectedWorktreeListResult>
  tabsByWorktree: Record<string, TerminalTab[]>
  unreadTerminalTabs: Record<string, true>
}): number {
  const unreadWorktreeIds = new Set<string>()

  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (worktree.isUnread) {
        unreadWorktreeIds.add(worktree.id)
      }
    }
  }

  // Why: automatic agent attention can land while a worktree is only present
  // in detectedWorktreesByRepo; the Dock badge must mirror that unread marker.
  for (const result of Object.values(detectedWorktreesByRepo)) {
    for (const worktree of result.worktrees) {
      if (worktree.isUnread) {
        unreadWorktreeIds.add(worktree.id)
      }
    }
  }

  const unreadTabIds = new Set(Object.keys(unreadTerminalTabs))
  if (unreadTabIds.size === 0) {
    return unreadWorktreeIds.size
  }

  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      if (!unreadTabIds.delete(tab.id)) {
        continue
      }
      unreadWorktreeIds.add(worktreeId)
    }
  }

  // Why: tab unread state should normally map to a live worktree, but counting
  // unmatched entries keeps the Dock badge honest during hydration races.
  return unreadWorktreeIds.size + unreadTabIds.size
}
