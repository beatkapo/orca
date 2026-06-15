import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./repository-ref', () => ({
  getGiteaRepoRef: vi.fn(async () => ({
    host: 'git.example.com',
    owner: 'team',
    repo: 'app',
    apiBaseUrl: 'https://git.example.com/api/v1',
    webBaseUrl: 'https://git.example.com'
  }))
}))

vi.mock('./server-store', () => ({
  getServerForHost: () => ({
    server: {
      id: 'srv1',
      displayName: 'git.example.com',
      apiBaseUrl: 'https://git.example.com/api/v1',
      baseUrl: 'https://git.example.com',
      account: 'octo'
    },
    token: 'secret'
  })
}))

vi.mock('./request', () => ({
  encodedRepoPath: (repo: { owner: string; repo: string }) => `${repo.owner}/${repo.repo}`,
  giteaRepoGet: vi.fn(),
  giteaRepoWrite: vi.fn()
}))

import { getGiteaRepoRef } from './repository-ref'
import { giteaRepoGet, giteaRepoWrite } from './request'
import {
  addGiteaIssueComment,
  createGiteaIssue,
  getGiteaIssue,
  listGiteaIssues,
  updateGiteaIssue
} from './issues'

const getMock = vi.mocked(giteaRepoGet)
const writeMock = vi.mocked(giteaRepoWrite)
const repoRefMock = vi.mocked(getGiteaRepoRef)

beforeEach(() => {
  getMock.mockReset()
  writeMock.mockReset()
  repoRefMock.mockResolvedValue({
    host: 'git.example.com',
    owner: 'team',
    repo: 'app',
    apiBaseUrl: 'https://git.example.com/api/v1',
    webBaseUrl: 'https://git.example.com'
  })
})

describe('gitea issues', () => {
  it('lists issues, dropping pull requests and stamping the server', async () => {
    getMock.mockResolvedValue([
      { id: 1, number: 1, title: 'Bug', state: 'open' },
      { id: 2, number: 2, title: 'A PR', state: 'open', pull_request: { merged: false } }
    ])

    const issues = await listGiteaIssues('/repo', 'all', 30, null)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ number: 1, title: 'Bug', serverId: 'srv1' })
    const [, path, options] = getMock.mock.calls[0]
    expect(path).toBe('/repos/team/app/issues')
    expect(options?.searchParams).toMatchObject({ type: 'issues', state: 'all', limit: 30 })
  })

  it('maps assigned filter to the Gitea query params', async () => {
    getMock.mockResolvedValue([])
    await listGiteaIssues('/repo', 'assigned', 10, null)
    expect(getMock.mock.calls[0][2]?.searchParams).toMatchObject({
      type: 'issues',
      state: 'open',
      assigned: 'true'
    })
  })

  it('returns null for a single issue that is actually a PR', async () => {
    getMock.mockResolvedValue({ id: 9, number: 9, pull_request: {} })
    await expect(getGiteaIssue('/repo', 9, null)).resolves.toBeNull()
  })

  it('returns null when the repo is not a Gitea remote', async () => {
    repoRefMock.mockResolvedValue(null)
    await expect(getGiteaIssue('/repo', 9, null)).resolves.toBeNull()
  })

  it('creates an issue and returns its identifiers', async () => {
    writeMock.mockResolvedValue({
      ok: true,
      data: { id: 11, number: 5, html_url: 'https://git.example.com/team/app/issues/5' }
    })
    const result = await createGiteaIssue('/repo', { title: 'New', body: 'Body' }, null)
    expect(result).toEqual({
      ok: true,
      id: 11,
      number: 5,
      url: 'https://git.example.com/team/app/issues/5'
    })
    expect(writeMock.mock.calls[0][2]).toMatchObject({ method: 'POST' })
  })

  it('surfaces a create failure message', async () => {
    writeMock.mockResolvedValue({ ok: false, error: 'forbidden', status: 403 })
    await expect(createGiteaIssue('/repo', { title: 'New' }, null)).resolves.toEqual({
      ok: false,
      error: 'forbidden'
    })
  })

  it('patches issue fields and updates labels via the labels endpoint', async () => {
    writeMock.mockResolvedValue({ ok: true, data: {} })
    const result = await updateGiteaIssue('/repo', 5, { title: 'Renamed', labelIds: [1, 2] }, null)
    expect(result).toEqual({ ok: true })
    expect(writeMock).toHaveBeenCalledTimes(2)
    expect(writeMock.mock.calls[0][1]).toBe('/repos/team/app/issues/5')
    expect(writeMock.mock.calls[0][2]).toMatchObject({ method: 'PATCH' })
    expect(writeMock.mock.calls[1][1]).toBe('/repos/team/app/issues/5/labels')
    expect(writeMock.mock.calls[1][2]).toMatchObject({ method: 'PUT', body: { labels: [1, 2] } })
  })

  it('adds an issue comment', async () => {
    writeMock.mockResolvedValue({ ok: true, data: { id: 1 } })
    await expect(addGiteaIssueComment('/repo', 5, 'looks good', null)).resolves.toEqual({
      ok: true
    })
    expect(writeMock.mock.calls[0][1]).toBe('/repos/team/app/issues/5/comments')
  })
})
