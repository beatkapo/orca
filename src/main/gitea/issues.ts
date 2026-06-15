import type {
  GiteaComment,
  GiteaCreateIssueResult,
  GiteaIssue,
  GiteaIssueUpdate,
  GiteaMutationResult,
  GiteaWorkItem,
  GiteaWorkItemFilter
} from '../../shared/gitea-types'
import { getGiteaRepoRef, type GiteaRepoRef } from './repository-ref'
import { encodedRepoPath, giteaRepoGet, giteaRepoWrite, type GiteaSearchParams } from './request'
import { getServerForHost } from './server-store'
import {
  isGiteaPullRequest,
  mapGiteaComment,
  mapGiteaIssue,
  mapGiteaWorkItem,
  type GiteaIssueContext,
  type RawGiteaComment,
  type RawGiteaIssue
} from './mappers'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT)
}

function issueContext(repo: GiteaRepoRef): GiteaIssueContext {
  const stored = getServerForHost(repo.host)
  return {
    owner: repo.owner,
    repo: repo.repo,
    serverId: stored?.server.id,
    serverName: stored?.server.displayName
  }
}

// Maps a task-source filter to Gitea /issues query params. No `type` filter is
// set so the endpoint returns both issues and pull requests as work items.
function filterParams(filter: GiteaWorkItemFilter | undefined): GiteaSearchParams {
  switch (filter) {
    case 'assigned':
      return { state: 'open', assigned: 'true' }
    case 'created':
      return { state: 'open', created: 'true' }
    case 'closed':
      return { state: 'closed' }
    case 'all':
    case undefined:
      return { state: 'all' }
  }
}

// Lists issues and pull requests together as unified work items, matching the
// GitHub/GitLab Tasks model.
export async function listGiteaWorkItems(
  repoPath: string,
  filter?: GiteaWorkItemFilter,
  limit?: number,
  connectionId?: string | null
): Promise<GiteaWorkItem[]> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return []
  }
  const raw = await giteaRepoGet<RawGiteaIssue[]>(repo, `/repos/${encodedRepoPath(repo)}/issues`, {
    searchParams: { ...filterParams(filter), limit: clampLimit(limit), page: 1 }
  })
  if (!Array.isArray(raw)) {
    return []
  }
  const context = issueContext(repo)
  return raw
    .map((entry) => mapGiteaWorkItem(entry, context))
    .filter((item): item is GiteaWorkItem => item !== null)
}

export async function getGiteaIssue(
  repoPath: string,
  issueNumber: number,
  connectionId?: string | null
): Promise<GiteaIssue | null> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return null
  }
  const raw = await giteaRepoGet<RawGiteaIssue>(
    repo,
    `/repos/${encodedRepoPath(repo)}/issues/${encodeURIComponent(String(issueNumber))}`
  )
  if (!raw || isGiteaPullRequest(raw)) {
    return null
  }
  return mapGiteaIssue(raw, issueContext(repo))
}

export async function listGiteaIssueComments(
  repoPath: string,
  issueNumber: number,
  connectionId?: string | null
): Promise<GiteaComment[]> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return []
  }
  const raw = await giteaRepoGet<RawGiteaComment[]>(
    repo,
    `/repos/${encodedRepoPath(repo)}/issues/${encodeURIComponent(String(issueNumber))}/comments`
  )
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((entry) => mapGiteaComment(entry))
    .filter((comment): comment is GiteaComment => comment !== null)
}

export async function createGiteaIssue(
  repoPath: string,
  input: { title: string; body?: string; assignees?: string[]; labelIds?: number[] },
  connectionId?: string | null
): Promise<GiteaCreateIssueResult> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return { ok: false, error: 'This repository is not a recognized Gitea remote.' }
  }
  const result = await giteaRepoWrite<RawGiteaIssue>(
    repo,
    `/repos/${encodedRepoPath(repo)}/issues`,
    {
      method: 'POST',
      body: {
        title: input.title,
        body: input.body ?? '',
        ...(input.assignees ? { assignees: input.assignees } : {}),
        ...(input.labelIds ? { labels: input.labelIds } : {})
      }
    }
  )
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  const raw = result.data
  if (typeof raw.id !== 'number' || typeof raw.number !== 'number') {
    return { ok: false, error: 'Gitea did not return the created issue.' }
  }
  return { ok: true, id: raw.id, number: raw.number, url: raw.html_url ?? '' }
}

export async function updateGiteaIssue(
  repoPath: string,
  issueNumber: number,
  updates: GiteaIssueUpdate,
  connectionId?: string | null
): Promise<GiteaMutationResult> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return { ok: false, error: 'This repository is not a recognized Gitea remote.' }
  }
  const body: Record<string, unknown> = {}
  if (updates.title !== undefined) {
    body.title = updates.title
  }
  if (updates.body !== undefined) {
    body.body = updates.body
  }
  if (updates.state !== undefined) {
    body.state = updates.state
  }
  if (updates.assignees !== undefined) {
    body.assignees = updates.assignees
  }
  const path = `/repos/${encodedRepoPath(repo)}/issues/${encodeURIComponent(String(issueNumber))}`
  const result = await giteaRepoWrite<RawGiteaIssue>(repo, path, { method: 'PATCH', body })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  // Label edits use a dedicated endpoint in the Gitea API.
  if (updates.labelIds !== undefined) {
    const labelResult = await giteaRepoWrite<unknown>(repo, `${path}/labels`, {
      method: 'PUT',
      body: { labels: updates.labelIds }
    })
    if (!labelResult.ok) {
      return { ok: false, error: labelResult.error }
    }
  }
  return { ok: true }
}

export async function addGiteaIssueComment(
  repoPath: string,
  issueNumber: number,
  body: string,
  connectionId?: string | null
): Promise<GiteaMutationResult> {
  const repo = await getGiteaRepoRef(repoPath, connectionId)
  if (!repo) {
    return { ok: false, error: 'This repository is not a recognized Gitea remote.' }
  }
  const result = await giteaRepoWrite<RawGiteaComment>(
    repo,
    `/repos/${encodedRepoPath(repo)}/issues/${encodeURIComponent(String(issueNumber))}/comments`,
    { method: 'POST', body: { body } }
  )
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
