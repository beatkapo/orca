import { useCallback, useEffect, useState } from 'react'
import { CircleDot, GitPullRequest, LoaderCircle, RefreshCw } from 'lucide-react'
import type { GiteaWorkItem, Repo } from '../../../shared/types'
import type { GiteaIssueScope } from '@/store/slices/gitea'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

type GiteaTaskListProps = {
  repos: Repo[]
  makeScope: (repo: Repo) => GiteaIssueScope
  onUse: (repo: Repo, item: GiteaWorkItem) => void
}

type Row = { repo: Repo; item: GiteaWorkItem }

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
// items (issues + pull requests) for the selected repos and lets the user start
// a workspace from any of them. Kept out of TaskPage.tsx to avoid growing it.
export function GiteaTaskList({ repos, makeScope, onUse }: GiteaTaskListProps): React.JSX.Element {
  const fetchGiteaWorkItems = useAppStore((s) => s.fetchGiteaWorkItems)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
          const items = await fetchGiteaWorkItems(makeScope(repo))
          return items.map((item) => ({ repo, item }))
        })
      )
      setRows(results.flat())
    } catch {
      setError(translate('auto.components.GiteaTaskList.loadError', 'Failed to load Gitea tasks.'))
    } finally {
      setLoading(false)
    }
  }, [repos, makeScope, fetchGiteaWorkItems])

  useEffect(() => {
    void load()
  }, [load, nonce])

  return (
    <div className="flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-muted/50 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {translate('auto.components.GiteaTaskList.heading', 'Issues & pull requests')}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setNonce((n) => n + 1)}
          disabled={loading}
          aria-label={translate('auto.components.GiteaTaskList.refresh', 'Refresh Gitea tasks')}
          className="size-7 border-border/50 bg-transparent hover:bg-muted/50"
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
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
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {translate('auto.components.GiteaTaskList.empty', 'No open issues or pull requests.')}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {rows.map(({ repo, item }) => (
              <button
                key={`${repo.id}:${item.type}:${item.number}`}
                type="button"
                onClick={() => onUse(repo, item)}
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
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                  </span>
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
