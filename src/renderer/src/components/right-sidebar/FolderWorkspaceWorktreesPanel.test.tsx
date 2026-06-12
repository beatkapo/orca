// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree, WorkspaceLineage } from '../../../../shared/types'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../../shared/workspace-scope'

type MockStoreState = {
  activeWorktreeId: string | null
  folderWorkspaces: {
    id: string
    name: string
    folderPath: string
  }[]
  workspaceLineageByChildKey: Record<string, WorkspaceLineage>
  worktreesByRepo: Record<string, Worktree[]>
  repos: Repo[]
}

const testState = vi.hoisted(() => ({
  store: {
    activeWorktreeId: null,
    folderWorkspaces: [],
    workspaceLineageByChildKey: {},
    worktreesByRepo: {},
    repos: []
  } as MockStoreState,
  cardProps: [] as {
    worktree: Worktree
    affiliateListMode?: boolean
    nativeDragEnabled?: boolean
    isActive?: boolean
  }[]
}))

vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: MockStoreState) => T): T => selector(testState.store)
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values ? fallback.replace('{{value0}}', String(values.value0)) : fallback
}))

vi.mock('@/components/sidebar/WorktreeCard', () => ({
  default: (props: {
    worktree: Worktree
    affiliateListMode?: boolean
    nativeDragEnabled?: boolean
    isActive?: boolean
  }) => {
    testState.cardProps.push(props)
    return (
      <div
        data-testid="worktree-card"
        data-worktree-id={props.worktree.id}
        data-affiliate-list-mode={props.affiliateListMode ? 'true' : 'false'}
        data-native-drag-enabled={props.nativeDragEnabled ? 'true' : 'false'}
        data-active={props.isActive ? 'true' : 'false'}
      >
        {props.worktree.displayName}
      </div>
    )
  }
}))

import FolderWorkspaceWorktreesPanel from './FolderWorkspaceWorktreesPanel'

let container: HTMLDivElement
let root: Root

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#fff',
    addedAt: 1,
    ...overrides
  }
}

function makeWorktree(overrides: Partial<Worktree> & { id: string }): Worktree {
  return {
    path: `/worktrees/${overrides.id}`,
    head: 'abc',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    repoId: 'repo-1',
    displayName: overrides.id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function makeWorkspaceLineage(
  child: Worktree,
  parentFolderId: string,
  overrides: Partial<WorkspaceLineage> = {}
): WorkspaceLineage {
  return {
    childWorkspaceKey: worktreeWorkspaceKey(child.id),
    childInstanceId: child.instanceId ?? null,
    parentWorkspaceKey: folderWorkspaceKey(parentFolderId),
    parentInstanceId: null,
    origin: 'cli',
    capture: { source: 'env-workspace', confidence: 'inferred' },
    createdAt: 1,
    ...overrides
  }
}

function renderPanel(): void {
  act(() => {
    root.render(<FolderWorkspaceWorktreesPanel />)
  })
}

describe('FolderWorkspaceWorktreesPanel', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    testState.cardProps = []
    testState.store = {
      activeWorktreeId: folderWorkspaceKey('folder-1'),
      folderWorkspaces: [{ id: 'folder-1', name: 'Platform folder', folderPath: '/platform' }],
      workspaceLineageByChildKey: {},
      worktreesByRepo: {},
      repos: [makeRepo()]
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('shows unavailable copy outside folder workspaces', () => {
    testState.store.activeWorktreeId = 'repo-1::/worktrees/current'

    renderPanel()

    expect(container.textContent).toContain('Workspaces are only shown for folder workspaces.')
    expect(testState.cardProps).toEqual([])
  })

  it('renders attached child worktrees as affiliate WorktreeCards in recent order', () => {
    const oldChild = makeWorktree({
      id: 'repo-1::/old',
      displayName: 'Old child',
      instanceId: 'old-instance',
      lastActivityAt: 10
    })
    const recentChild = makeWorktree({
      id: 'repo-1::/recent',
      displayName: 'Recent child',
      instanceId: 'recent-instance',
      lastActivityAt: 50
    })
    const otherFolderChild = makeWorktree({
      id: 'repo-1::/other-folder',
      displayName: 'Other folder child',
      instanceId: 'other-instance',
      lastActivityAt: 100
    })
    const staleChild = makeWorktree({
      id: 'repo-1::/stale',
      displayName: 'Stale child',
      instanceId: 'fresh-instance',
      lastActivityAt: 200
    })
    testState.store.worktreesByRepo = {
      'repo-1': [oldChild, recentChild, otherFolderChild, staleChild]
    }
    testState.store.workspaceLineageByChildKey = {
      [oldChild.id]: makeWorkspaceLineage(oldChild, 'folder-1'),
      [recentChild.id]: makeWorkspaceLineage(recentChild, 'folder-1'),
      [otherFolderChild.id]: makeWorkspaceLineage(otherFolderChild, 'folder-2'),
      [staleChild.id]: makeWorkspaceLineage(staleChild, 'folder-1', {
        childInstanceId: 'stale-instance'
      })
    }

    renderPanel()

    expect(container.textContent).toContain('2 attached worktrees')
    expect(container.textContent).not.toContain(
      'Shows worktrees attached to this folder workspace.'
    )
    expect(
      [...container.querySelectorAll('[data-testid="worktree-card"]')].map(
        (node) => node.textContent
      )
    ).toEqual(['Recent child', 'Old child'])
    expect(testState.cardProps).toHaveLength(2)
    expect(testState.cardProps.every((props) => props.affiliateListMode === true)).toBe(true)
    expect(testState.cardProps.every((props) => props.nativeDragEnabled === false)).toBe(true)
  })
})
