import { ipcMain } from 'electron'
import { resolve } from 'path'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { TaskSourceContext } from '../../shared/task-source-context'
import type {
  GiteaConnectArgs,
  GiteaIssueFilter,
  GiteaIssueUpdate,
  GiteaServerSelection,
  Repo
} from '../../shared/types'
import { connect, disconnect, getStatus, selectServer, testConnection } from '../gitea/connect'
import {
  addGiteaIssueComment,
  createGiteaIssue,
  getGiteaIssue,
  listGiteaIssueComments,
  listGiteaIssues,
  updateGiteaIssue
} from '../gitea/issues'
import type { Store } from '../persistence'
import { _resetPreflightCache } from './preflight'

const VALID_FILTERS = new Set<GiteaIssueFilter>(['assigned', 'created', 'all', 'closed'])

type GiteaRepoSelectorArgs = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
}

function findRegisteredGiteaRepo(args: GiteaRepoSelectorArgs, store: Store): Repo | undefined {
  const sourceRepoId =
    args.sourceContext?.provider === 'gitea' ? args.sourceContext.repoId?.trim() : null
  const repoId = args.repoId?.trim() || sourceRepoId || null
  if (repoId) {
    const repo = store.getRepo(repoId)
    if (repo) {
      return repo
    }
  }
  const resolvedRepoPath = resolve(args.repoPath)
  return store.getRepos().find((r) => resolve(r.path) === resolvedRepoPath)
}

// Why: mirror gitlab.ts assertRegisteredRepo — handlers must never operate on a
// path the user hasn't registered as a repo (filesystem-auth boundary). The
// source-context host check stops a task fetched on one machine from mutating a
// same-path repo on another.
function assertRegisteredRepo(args: GiteaRepoSelectorArgs, store: Store): Repo {
  const repo = findRegisteredGiteaRepo(args, store)
  if (!repo) {
    throw new Error('Access denied: unknown repository path')
  }
  if (
    args.sourceContext?.provider === 'gitea' &&
    args.sourceContext.hostId !== getRepoExecutionHostId(repo)
  ) {
    throw new Error('Access denied: Gitea source host does not match repository host')
  }
  return repo
}

function repoConnectionId(repo: Repo): string | null {
  return repo.connectionId ?? null
}

function normalizeServerId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeServerSelection(value: unknown): GiteaServerSelection | undefined {
  return normalizeServerId(value) as GiteaServerSelection | undefined
}

function clampLimit(value: unknown, fallback = 30): number {
  const limit = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(1, limit), 100)
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

function normalizeNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) {
    return undefined
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : undefined
}

function normalizeIssueUpdate(value: unknown): GiteaIssueUpdate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const input = value as GiteaIssueUpdate
  if (input.title !== undefined && typeof input.title !== 'string') {
    return null
  }
  if (input.body !== undefined && typeof input.body !== 'string') {
    return null
  }
  if (input.state !== undefined && input.state !== 'open' && input.state !== 'closed') {
    return null
  }
  if (input.assignees !== undefined && normalizeStringArray(input.assignees) === undefined) {
    return null
  }
  if (input.labelIds !== undefined && normalizeNumberArray(input.labelIds) === undefined) {
    return null
  }
  return input
}

export function registerGiteaHandlers(store: Store): void {
  ipcMain.handle('gitea:connect', async (_event, args: GiteaConnectArgs) => {
    if (typeof args?.baseUrl !== 'string' || typeof args?.token !== 'string') {
      return { ok: false, error: 'Server URL and access token are required.' }
    }
    const result = await connect({ baseUrl: args.baseUrl, token: args.token })
    if (result.ok) {
      _resetPreflightCache()
    }
    return result
  })

  ipcMain.handle('gitea:disconnect', async (_event, args?: { serverId?: string }) => {
    disconnect(normalizeServerId(args?.serverId))
    _resetPreflightCache()
  })

  ipcMain.handle('gitea:selectServer', async (_event, args: { serverId: GiteaServerSelection }) => {
    const serverId = normalizeServerSelection(args?.serverId)
    if (!serverId) {
      return getStatus()
    }
    return selectServer(serverId)
  })

  ipcMain.handle('gitea:status', async () => getStatus())

  ipcMain.handle('gitea:testConnection', async (_event, args?: { serverId?: string }) => {
    return testConnection(normalizeServerId(args?.serverId))
  })

  ipcMain.handle(
    'gitea:listIssues',
    async (_event, args: GiteaRepoSelectorArgs & { filter?: GiteaIssueFilter; limit?: number }) => {
      const repo = assertRegisteredRepo(args, store)
      const filter = VALID_FILTERS.has(args?.filter as GiteaIssueFilter)
        ? (args.filter as GiteaIssueFilter)
        : undefined
      return listGiteaIssues(repo.path, filter, clampLimit(args.limit), repoConnectionId(repo))
    }
  )

  ipcMain.handle(
    'gitea:issue',
    async (_event, args: GiteaRepoSelectorArgs & { number: number }) => {
      const repo = assertRegisteredRepo(args, store)
      if (typeof args.number !== 'number') {
        return null
      }
      return getGiteaIssue(repo.path, args.number, repoConnectionId(repo))
    }
  )

  ipcMain.handle(
    'gitea:issueComments',
    async (_event, args: GiteaRepoSelectorArgs & { number: number }) => {
      const repo = assertRegisteredRepo(args, store)
      if (typeof args.number !== 'number') {
        return []
      }
      return listGiteaIssueComments(repo.path, args.number, repoConnectionId(repo))
    }
  )

  ipcMain.handle(
    'gitea:createIssue',
    async (
      _event,
      args: GiteaRepoSelectorArgs & {
        title: string
        body?: string
        assignees?: string[]
        labelIds?: number[]
      }
    ) => {
      const repo = assertRegisteredRepo(args, store)
      if (typeof args.title !== 'string' || !args.title.trim()) {
        return { ok: false, error: 'Title is required.' }
      }
      return createGiteaIssue(
        repo.path,
        {
          title: args.title.trim(),
          body: typeof args.body === 'string' ? args.body : undefined,
          assignees: normalizeStringArray(args.assignees),
          labelIds: normalizeNumberArray(args.labelIds)
        },
        repoConnectionId(repo)
      )
    }
  )

  ipcMain.handle(
    'gitea:updateIssue',
    async (_event, args: GiteaRepoSelectorArgs & { number: number; updates: GiteaIssueUpdate }) => {
      const repo = assertRegisteredRepo(args, store)
      if (typeof args.number !== 'number') {
        return { ok: false, error: 'Issue number is required.' }
      }
      const updates = normalizeIssueUpdate(args.updates)
      if (!updates) {
        return { ok: false, error: 'Updates object is required.' }
      }
      return updateGiteaIssue(repo.path, args.number, updates, repoConnectionId(repo))
    }
  )

  ipcMain.handle(
    'gitea:addIssueComment',
    async (_event, args: GiteaRepoSelectorArgs & { number: number; body: string }) => {
      const repo = assertRegisteredRepo(args, store)
      if (typeof args.number !== 'number') {
        return { ok: false, error: 'Issue number is required.' }
      }
      if (typeof args.body !== 'string' || !args.body.trim()) {
        return { ok: false, error: 'Comment body is required.' }
      }
      return addGiteaIssueComment(repo.path, args.number, args.body.trim(), repoConnectionId(repo))
    }
  )
}
