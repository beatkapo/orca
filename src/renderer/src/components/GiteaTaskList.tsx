import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleDot, GitPullRequest, LoaderCircle, RefreshCw } from 'lucide-react'
import type { GiteaWorkItem, GiteaWorkItemFilter, Repo } from '../../../shared/types'
import type { GiteaIssueScope } from '@/store/slices/gitea'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

type GiteaTypeFilter = 'all' | 'issue' | 'pull'

type GiteaTaskListProps = {
  repos: Repo[]
  makeScope: (repo: Repo) => GiteaIssueScope
  onOpen: (repo: Repo, item: GiteaWorkItem) => void
  projectPicker?: React.ReactNode
}

type Row = { repo: Repo; item: GiteaWorkItem }

function getFilterPresets(): { id: GiteaWorkItemFilter; label: string }[] {
  return [
    { id: 'all', label: translate('auto.components.GiteaTaskList.filterAll', 'All open') },
    {
      id: 'assigned',
      label: translate('auto.components.GiteaTaskList.filterAssigned', 'Assigned to me')
    },
    { id: 'created', label: translate('auto.components.GiteaTaskList.filterCreated', 'Created') },
    { id: 'closed', label: translate('auto.components.GiteaTaskList.filterClosed', 'Closed') }
  ]
}

function getTypeFilters(): { id: GiteaTypeFilter; label: string }[] {
  return [
    { id: 'all', label: translate('auto.components.GiteaTaskList.typeAll', 'All') },
    { id: 'issue', label: translate('auto.components.GiteaTaskList.typeIssues', 'Issues') },
    { id: 'pull', label: translate('auto.components.GiteaTaskList.typePulls', 'PRs') }
  ]
}

function stateLabel(item: GiteaWorkItem): string {
  if (item.type === 'pull') {
    if (item.state === 'merged') {
      return translate('auto.components.GiteaTaskList.stateMerged', 'Merged')
    }
    if (item.draft) {
      return translate('auto.components.GiteaTaskList.stateDraft', 'Draft')
    }
  }
  return item.state === 'closed'
    ? translate('auto.components.GiteaTaskList.stateClosed', 'Closed')
    : translate('auto.components.GiteaTaskList.stateOpen', 'Open')
}

// Self-contained Tasks-page panel for the Gitea source: fetches unified work
// items (issues + pull requests) for the selected repos with GitHub-style
// filters (incl. assigned-to-me) and an issue/PR toggle, and lets the user
// start a workspace from any of them. Kept out of TaskPage.tsx to avoid growth.
export function GiteaTaskList({
  repos,
  makeScope,
  onOpen,
  projectPicker
}: GiteaTaskListProps): React.JSX.Element {
  const fetchGiteaWorkItems = useAppStore((s) => s.fetchGiteaWorkItems)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<GiteaWorkItemFilter>('all')
  const [typeFilter, setTypeFilter] = useState<GiteaTypeFilter>('all')
  const [nonce, setNonce] = useState(0)

  const load = useCallback(async () => {
    if (repos.length === 0) {
      setRows([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(
        repos.map(async (repo) => {
          const items = await fetchGiteaWorkItems(makeScope(repo), filter)
          return items.map((item) => ({ repo, item }))
        })
      )
      setRows(results.flat())
    } catch {
      setError(translate('auto.components.GiteaTaskList.loadError', 'Failed to load Gitea tasks.'))
    } finally {
      setLoading(false)
    }
  }, [repos, makeScope, fetchGiteaWorkItems, filter])

  useEffect(() => {
    void load()
  }, [load, nonce])

  const visibleRows = useMemo(
    () => (typeFilter === 'all' ? rows : rows.filter(({ item }) => item.type === typeFilter)),
    [rows, typeFilter]
  )

  return (
    <div className="flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-muted/50 shadow-sm">
      <div className="flex min-w-0 flex-col gap-2 border-b border-border/50 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs">
            {getTypeFilters().map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTypeFilter(id)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition',
                  typeFilter === id
                    ? 'border-foreground/40 bg-foreground/90 text-background'
                    : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {projectPicker ? (
            <div className="min-w-0 w-full sm:w-[200px]">{projectPicker}</div>
          ) : null}
          <div className="ml-auto flex items-center">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setNonce((n) => n + 1)}
              disabled={loading}
              aria-label={translate('auto.components.GiteaTaskList.refresh', 'Refresh Gitea tasks')}
              className="size-8 border-border/50 bg-transparent hover:bg-muted/50"
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {getFilterPresets().map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition',
                filter === id
                  ? 'border-border/50 bg-foreground/90 text-background'
                  : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
        {error ? (
          <div className="px-4 py-4 text-sm text-destructive">{error}</div>
        ) : repos.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {translate(
              'auto.components.GiteaTaskList.noRepos',
              'Select a Gitea-hosted project to see its issues and pull requests.'
            )}
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {translate('auto.components.GiteaTaskList.loading', 'Loading Gitea tasks…')}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {translate(
              'auto.components.GiteaTaskList.empty',
              'No matching issues or pull requests.'
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {visibleRows.map(({ repo, item }) => (
              <button
                key={`${repo.id}:${item.type}:${item.number}`}
                type="button"
                onClick={() => onOpen(repo, item)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {item.type === 'pull' ? (
                    <GitPullRequest className="size-4" />
                  ) : (
                    <CircleDot className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">#{item.number}</span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        item.state === 'open'
                          ? 'bg-status-success/15 text-status-success'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {stateLabel(item)}
                    </span>
                    {repos.length > 1 ? <span className="truncate">{repo.displayName}</span> : null}
                    {item.labels.slice(0, 3).map((label) => (
                      <span key={label} className="truncate rounded bg-muted px-1.5 py-0.5">
                        {label}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
