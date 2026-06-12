import WorktreeCard from '@/components/sidebar/WorktreeCard'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/types'

function getWorktreeActivityTime(worktree: Worktree): number {
  return Math.max(worktree.lastActivityAt ?? 0, worktree.createdAt ?? 0, worktree.sortOrder ?? 0)
}

export default function FolderWorkspaceWorktreesPanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const workspaceLineageByChildKey = useAppStore((s) => s.workspaceLineageByChildKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const repos = useAppStore((s) => s.repos)

  const activeScope = parseWorkspaceKey(activeWorktreeId ?? '')
  const folderWorkspace =
    activeScope?.type === 'folder'
      ? folderWorkspaces.find((workspace) => workspace.id === activeScope.folderWorkspaceId)
      : undefined

  const folderKey = folderWorkspace ? folderWorkspaceKey(folderWorkspace.id) : null
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const worktreeById = new Map(
    Object.values(worktreesByRepo)
      .flat()
      .map((worktree) => [worktree.id, worktree])
  )

  const childWorktrees = folderKey
    ? Object.values(workspaceLineageByChildKey)
        .filter((lineage) => lineage.parentWorkspaceKey === folderKey)
        .map((lineage) => {
          const childScope = parseWorkspaceKey(lineage.childWorkspaceKey)
          if (childScope?.type !== 'worktree') {
            return null
          }
          const worktree = worktreeById.get(childScope.worktreeId)
          if (!worktree) {
            return null
          }
          if (lineage.childInstanceId && lineage.childInstanceId !== worktree.instanceId) {
            return null
          }
          return worktree
        })
        .filter((worktree): worktree is Worktree => worktree !== null)
        .sort(
          (left, right) =>
            getWorktreeActivityTime(right) - getWorktreeActivityTime(left) ||
            left.displayName.localeCompare(right.displayName)
        )
    : []

  if (!folderWorkspace) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.rightSidebar.FolderWorkspaceWorktreesPanel.unavailable',
          'Workspaces are only shown for folder workspaces.'
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="truncate text-sm font-medium text-foreground">{folderWorkspace.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {childWorktrees.length === 1
            ? translate(
                'auto.components.rightSidebar.FolderWorkspaceWorktreesPanel.countOne',
                '1 attached worktree'
              )
            : translate(
                'auto.components.rightSidebar.FolderWorkspaceWorktreesPanel.countMany',
                '{{value0}} attached worktrees',
                { value0: childWorktrees.length }
              )}
        </div>
      </div>

      {childWorktrees.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-sm font-medium text-foreground">
            {translate(
              'auto.components.rightSidebar.FolderWorkspaceWorktreesPanel.emptyTitle',
              'No attached worktrees yet'
            )}
          </div>
          <div className="mt-2 max-w-[16rem] text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.rightSidebar.FolderWorkspaceWorktreesPanel.emptyCopy',
              'Worktrees created from this workspace will show up here.'
            )}
          </div>
        </div>
      ) : (
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-1">
            {childWorktrees.map((worktree) => (
              <WorktreeCard
                key={worktree.id}
                worktree={worktree}
                repo={repoById.get(worktree.repoId)}
                isActive={activeWorktreeId === worktree.id}
                isActiveSurface={false}
                hideRepoBadge={false}
                nativeDragEnabled={false}
                affiliateListMode
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
