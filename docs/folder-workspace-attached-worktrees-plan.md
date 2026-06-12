# Folder Workspace Attached Worktrees Plan

## Current Context

This planning workspace was created as a child of:

- Parent workspace: `/Users/thebr/orca/workspaces/orca/butterfish`
- Parent branch: `brennanb2025/multi-repo-agent-plan`
- Parent purpose: v1 multi-repo folder workspaces
- Planning workspace: `/Users/thebr/orca/workspaces/orca/folder-workspace-attached-worktrees-plan`
- Planning branch: `brennanb2025/folder-workspace-attached-worktrees-plan`

Important implementation context from the parent branch:

- Folder workspaces already exist as durable records:
  - `FolderWorkspace.id`
  - `FolderWorkspace.projectGroupId`
  - `FolderWorkspace.folderPath`
  - `FolderWorkspace.connectionId`
  - task/status/comment/pin/read/manual-order metadata
- Folder workspaces are projected into the legacy `Worktree` UI shape by `folderWorkspaceToWorktree`, using workspace keys like `folder:<folderWorkspaceId>`.
- Terminal/session ownership is already becoming workspace-scope-aware:
  - `WorkspaceScope = { type: 'worktree'; worktreeId } | { type: 'folder'; folderWorkspaceId }`
  - `activeWorkspaceKey?: WorkspaceKey | null`
  - terminal state can live under `folder:<id>`
  - folder terminals set `ORCA_WORKTREE_ID`, `ORCA_WORKSPACE_ID`, `ORCA_PROJECT_GROUP_ID`, and `ORCA_WORKSPACE_ROOT`
- The stale-path v1 design is implemented or substantially implemented:
  - scope-based folder path status APIs
  - local IPC and runtime RPC checks
  - create-time folder path revalidation
  - local PTY/runtime launch guards
  - sidebar stale/unavailable indicators
- The child workspace `nested-import-group-name-copy` is mostly nested-import and folder-workspace creation copy/polish:
  - “monorepo” copy changes toward “group”
  - folder workspace create button copy simplified to “Create workspace”
  - submit flow closes the modal even if post-create activation has a transient issue
  - tests adjusted for folder path status mocks and lineage card indentation

The key missing product capability:

> A folder workspace is a command center, but the worktrees spawned from that command center are not yet visible as attached children of it.

Today the sidebar can render a folder workspace row and ordinary repo worktree rows, but it cannot say: “this folder workspace launched these specific repo worktrees.” Existing lineage is `Worktree -> Worktree` only. A folder workspace is not a real git worktree, so normal parent lineage cannot target it.

## Product Thesis

For monorepo and multi-repo users, the folder workspace is not just another workspace. It is the mission control room.

A monorepo user does not think only in terms of one checked-out branch. They often think in terms of a task that cuts across several packages, services, apps, generated clients, docs, and test harnesses. In Orca, the most natural version of that is:

1. Open the repo or parent folder as a folder workspace.
2. Use it as the coordinator surface.
3. Spin up one or more concrete repo worktrees to make isolated changes.
4. Keep those worker worktrees visually and semantically attached to the coordinator.
5. Watch agents, terminals, and progress from the parent folder.
6. Collapse the task back into a review/PR when the work stabilizes.

For a multi-repo folder, the same shape appears with slightly different nouns:

- parent folder: `~/code/company/product`
- child repos: `api`, `web`, `mobile`, `infra`, `docs`
- folder workspace: “Stripe webhook migration”
- attached worktrees:
  - `api`: add webhook validation
  - `web`: update billing UI
  - `mobile`: handle new subscription status
  - `docs`: update integration guide

Without attached child visibility, the folder workspace becomes a launch pad that forgets what it launched. With attached visibility, it becomes an orchestration object.

## Core User Journeys

### Journey 1: Coordinator creates worker worktrees

The user creates a folder workspace called “Auth redesign” from a folder-backed project group. They start a coordinator agent in the folder workspace terminal and ask it to split work across packages. The agent or user creates repo worktrees for `frontend`, `backend`, and `docs`.

Expected result:

- The folder workspace card shows “3 children” or a comparable attached-workspace affordance.
- Expanding it reveals the concrete repo worktrees.
- Each child keeps its own repo badge, branch, PR status, agents, ports, unread state, and delete actions.
- The child cards can still be activated normally.
- The folder workspace remains the place to see the whole task.

### Journey 2: User creates a task from a folder workspace

The user is active in a folder workspace and uses the new workspace composer to create a worktree for one repo under that folder.

Expected result:

- Orca defaults the new worktree’s parent to the active folder workspace.
- The UI can still offer “independent workspace” if the user is doing unrelated work.
- If the worktree is created from a linked GitHub/GitLab/Linear/Jira task, the task link stays on the child worktree while the folder workspace remains the orchestration parent.

### Journey 3: CLI agent creates workers

An agent running inside a folder workspace terminal executes:

```bash
orca worktree create --repo id:<repo> --name update-api-contract
```

Expected result:

- The CLI/runtime sees `ORCA_WORKSPACE_ID=folder:<id>` or `ORCA_WORKTREE_ID=folder:<id>`.
- It records the created repo worktree as a child of that folder workspace.
- The sidebar reveals the new child under the folder workspace.
- If the user passes `--no-parent`, Orca creates the worktree independently.

### Journey 4: Existing worktrees need to be attached after the fact

The user already has several worktrees and later realizes they belong to a folder workspace task.

Expected result:

- Context menu or drag action can attach selected worktrees to a folder workspace.
- Detach is available without deleting anything.
- The attach action is provider-agnostic and works for GitHub, GitLab, Linear, Jira, and local-only work.

This is probably V2.1, not the first implementation slice, but the data model should not block it.

### Journey 5: Folder workspace as operational dashboard

The user collapses repo headers and looks only at the folder workspace.

Expected result:

- The folder workspace card should be able to summarize child activity over time:
  - child count
  - active/running agent count
  - unread child count
  - possibly failing/conflicted child signals
- The summary should be compact. The children themselves remain the source of truth.

This can be layered after the parent/child relationship exists.

## Design Principles

1. **Folder workspace lineage is workspace lineage, not git lineage.**  
   Do not pretend a folder workspace is a repo worktree. It is a workspace scope that can parent real worktrees.

2. **Attached means “belongs to this orchestration context,” not “is physically inside this path.”**  
   Physical path ancestry can be a hint, but it should not be the source of truth. A child may be in another folder, remote SSH path, or a repo worktree directory that is not literally under the folder path.

3. **Automatic attachment should follow creation intent.**  
   If a worktree is created from a folder workspace terminal or active folder workspace, attach it by default. If the user explicitly says `--no-parent`, do not attach it.

4. **Visibility should be native, not duplicated noise.**  
   In repo/project-group sidebar mode, attached worktrees should render under the folder workspace as their canonical visible location. Other grouping modes like status/PR can continue to show them by their status semantics.

5. **Provider compatibility stays generic.**  
   The relationship is not GitHub-specific. PR/issue/MR metadata remains on child worktrees; folder workspace parentage is separate.

6. **SSH is first-class.**  
   A folder workspace can be local or remote. A child worktree can also be local or remote. Attachment should depend on workspace identity and runtime context, not local path assumptions.

7. **No destructive inference.**  
   If a folder path is stale/unavailable, keep the parent and child relationship visible. Stale path state blocks launch/create as v1 defines, but it should not erase orchestration history.

## Proposed Data Model

### Preferred direction: introduce workspace-scope lineage

Keep existing `WorktreeLineage` for compatibility, but add a generalized relation that can target either a real worktree or a folder workspace.

Possible shared type:

```ts
export type WorkspaceLineage = {
  childWorkspaceKey: WorkspaceKey
  childInstanceId?: string | null
  parentWorkspaceKey: WorkspaceKey
  parentInstanceId?: string | null
  origin: 'cli' | 'ui' | 'orchestration' | 'manual'
  capture: {
    source:
      | 'explicit-cli-flag'
      | 'active-workspace'
      | 'terminal-context'
      | 'cwd-context'
      | 'orchestration-context'
      | 'manual-attach'
    confidence: 'explicit' | 'inferred'
  }
  taskId?: string
  orchestrationRunId?: string
  coordinatorHandle?: string
  createdByTerminalHandle?: string
  createdAt: number
}
```

For real worktree children:

- `childWorkspaceKey = worktree:<worktreeId>`
- `childInstanceId = WorktreeMeta.instanceId`

For folder workspace parents:

- `parentWorkspaceKey = folder:<folderWorkspaceId>`
- `parentInstanceId` can be omitted in the first version because folder workspace IDs are durable and not path-derived.
- Longer-term, add `FolderWorkspace.instanceId` if we want replacement protection symmetric with git worktrees.

### Compatibility bridge

The current system expects `worktreeLineageById: Record<string, WorktreeLineage>`.

Do not break it immediately. Instead:

1. Continue reading/writing `WorktreeLineage` for worktree-to-worktree lineage.
2. Add `workspaceLineageByChildKey: Record<WorkspaceKey, WorkspaceLineage>`.
3. When a new lineage relation is worktree-to-worktree, optionally mirror it into the legacy map during transition.
4. When a relation is worktree-to-folder, store it only in the new map.
5. Teach runtime/sidebar to prefer workspace lineage where available, then fall back to legacy lineage.

This avoids a big-bang migration while giving folder workspaces a real parent target.

### Store APIs

Add persistence methods conceptually like:

```ts
getWorkspaceLineage(childWorkspaceKey: WorkspaceKey): WorkspaceLineage | undefined
getAllWorkspaceLineage(): Record<WorkspaceKey, WorkspaceLineage>
setWorkspaceLineage(lineage: WorkspaceLineage): void
removeWorkspaceLineage(childWorkspaceKey: WorkspaceKey): void
```

Add pruning only when a child worktree is proven gone. Do not prune just because a folder path is unavailable.

## Runtime and CLI Capture

### Current gap

Folder terminals already set:

- `ORCA_WORKTREE_ID=folder:<id>`
- `ORCA_WORKSPACE_ID=folder:<id>`
- `ORCA_PROJECT_GROUP_ID=<groupId>`
- `ORCA_WORKSPACE_ROOT=<folderPath>`

But current lineage resolution calls `resolveWorktreeSelector`, which only returns real resolved worktrees. A folder workspace parent cannot be resolved, so folder-originated worktree creation loses its parent.

### Proposed runtime change

Introduce a resolver for parent workspace scopes:

```ts
resolveWorkspaceParentSelector(selector: string): Promise<ResolvedWorkspaceParent>
```

Where:

```ts
type ResolvedWorkspaceParent =
  | { key: WorkspaceKey; type: 'worktree'; worktree: ResolvedWorktree; instanceId: string | null }
  | { key: WorkspaceKey; type: 'folder'; folderWorkspace: FolderWorkspace; instanceId?: string | null }
```

Use it in lineage resolution instead of `resolveWorktreeSelector` when resolving a parent context.

### CLI behavior

Add or broaden selectors carefully:

- Keep `--parent-worktree` for compatibility and real worktree parents.
- Add `--parent-workspace <selector>` for folder or worktree parents.
- `--no-parent` remains the explicit escape hatch.
- Inferred parent should come from terminal/workspace env before cwd:
  1. `ORCA_WORKSPACE_ID`
  2. `ORCA_WORKTREE_ID`
  3. caller terminal handle
  4. cwd selector
  5. orchestration/task context if present

This matters because a folder terminal’s cwd may be the folder root or a repo path, but the terminal environment is the stronger expression of intent.

### Runtime create result

When `createManagedWorktree` creates a child from a folder workspace parent:

- Store `WorkspaceLineage`.
- Return lineage info in the RPC/CLI result.
- Notify repos/worktrees changed so the sidebar can reveal the child.
- If the parent folder workspace is collapsed, set pending reveal to open it.

## Sidebar Behavior

### Where attached children render

Initial implementation should target `groupBy === 'repo'`, because that is where project groups and folder workspaces already exist as hierarchy.

When repo grouping is active:

1. Project group header
2. Folder workspace rows for that project group
3. Attached child worktrees under each folder workspace
4. Remaining repo sections and un-attached worktrees

Attached children should be removed from their ordinary repo section within that project group to avoid duplication. They still retain repo badges and can be selected, dragged, opened, deleted, pinned, etc.

When grouping by status or PR status:

- Keep current behavior initially: children render by status/PR.
- Future enhancement: optionally nest under folder workspace within each status lane, but do not overload the first slice.

When grouping by none:

- Keep current flat behavior initially unless the folder workspace itself is in the list.
- Future enhancement: an “orchestration” sort mode could keep folder children together.

### Row model

The current row model has:

- `WorktreeRow`
- `FolderWorkspaceRow`
- `lineage-group` render rows for worktree parent cards

Extend the row builder so `FolderWorkspaceRow` can carry attached children, or generalize the lineage group renderer to support a folder parent.

Minimal approach:

```ts
export type FolderWorkspaceRow = {
  type: 'folder-workspace'
  key: string
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  depth: number
  groupDepth: number
  attachedRows?: WorktreeRow[]
  attachedChildCount?: number
  attachedCollapsed?: boolean
  attachedGroupKey?: string
}
```

Then render it with `WorktreeCard` using the existing `lineageChildren` affordance:

- parent card: `folderWorkspaceToWorktree(folderWorkspace)`
- child cards: existing `renderWorktreeRow`
- toggle: reuse child chip copy, or switch icon/copy to “attached workspaces”

This is attractive because `WorktreeCard` already knows how to visually host child rows.

### Collapse keys

Use a distinct collapse key to avoid colliding with existing worktree lineage:

```ts
folder-lineage:<folderWorkspaceId>
```

or more generally:

```ts
workspace-lineage:<WorkspaceKey>
```

The second form is better if we expect worktree and folder parents to converge later.

### Counts and sticky headers

Project group counts should include:

- folder workspace rows
- attached child worktrees
- remaining repo sections

But be careful: if attached children are moved under the folder workspace and removed from repo sections, count them once.

The folder workspace’s own chip/count should count attached child worktrees, not child repos.

### Selection and activation

Attached children are still ordinary worktrees:

- keyboard navigation includes them in visual order
- multi-select works
- context menu works
- delete works
- status drag works if it already works for normal rows
- pinning a child should probably remove it from folder nesting visually while pinned, matching existing pinned behavior

Folder workspace parent activation keeps current stale-path guard behavior.

### Reveal behavior

When a child worktree is revealed:

1. Expand ancestor project groups.
2. Expand the folder workspace attached group if the child is attached.
3. Scroll to the child row.
4. Flash the child row, not only the folder parent.

This mirrors the current logic that expands real worktree lineage parents.

## Agent and Orchestration Opportunities

Once attached children exist, Orca can do more than show them.

### Useful environment/context

Folder workspace terminals already know their root. We can add context gradually:

- `ORCA_WORKSPACE_ID=folder:<id>`
- `ORCA_PROJECT_GROUP_ID=<id>`
- `ORCA_ATTACHED_WORKTREE_IDS=<json-or-delimited-list>` only if safe and not too large
- Prefer CLI discovery over giant env values:
  - `orca worktree list --parent-workspace active --json`
  - `orca worktree ps --parent-workspace active --json`

The CLI route is better because it stays fresh and avoids env-size/platform issues.

### Folder workspace commands

Potential CLI surfaces:

```bash
orca worktree list --parent-workspace active --json
orca worktree attach --worktree id:<child> --parent-workspace active --json
orca worktree detach --worktree id:<child> --json
orca worktree create --repo id:<repo> --parent-workspace active --json
```

Maybe later:

```bash
orca workspace children --workspace active --json
orca workspace send --workspace active --to children --text "run tests" --json
```

Do not overbuild the second group yet. Listing and attachment are enough to unlock agents.

### Coordinator-agent workflow

A coordinator in a folder workspace should be able to:

1. Inspect repos in the folder/project group.
2. Create child worktrees for specific repos.
3. Dispatch work to child terminals/agents.
4. Read child statuses.
5. Summarize progress from attached children.

This does not require a new “multi-agent system” in the first slice. It only requires the relationship to be represented and discoverable.


## Implementation Plan

### Phase 0: Bring implementation branch onto v1 base

This planning workspace was created from `origin/main` while the v1 implementation lives in parent branch `brennanb2025/multi-repo-agent-plan`.

Before code implementation, either:

- merge/rebase the parent branch into this workspace, or
- move this doc into the parent branch and create the implementation branch from there.

Do not implement against plain `origin/main` unless v1 has already landed.

### Phase 1: Shared model and persistence

1. Add `WorkspaceLineage` type in shared types.
2. Add store/persistence support:
   - normalize missing maps to `{}`
   - persist `workspaceLineageByChildKey`
   - add get/set/remove methods
3. Add helpers:
   - `workspaceLineageChildKey(worktreeId)`
   - `workspaceLineageParentKey(scope)`
   - validation that child and parent are not identical
4. Preserve legacy `worktreeLineageById`.

Tests:

- persistence normalizes absent workspace lineage
- set/get/remove works
- existing legacy lineage remains readable

### Phase 2: Runtime parent resolution

1. Add `resolveWorkspaceParentSelector`.
2. Teach it to resolve:
   - `id:<real-worktree-id>`
   - `worktree:<real-worktree-id>`
   - `folder:<folderWorkspaceId>`
   - maybe `active` only when caller context supplies active workspace
3. Change create-lineage resolution to produce workspace parents.
4. Continue mirroring real worktree parents into legacy `WorktreeLineage`.
5. Store folder parent links only in `WorkspaceLineage`.

Tests:

- creating from `ORCA_WORKSPACE_ID=folder:<id>` records folder parent
- `--no-parent` suppresses folder inference
- explicit real worktree parent still writes legacy lineage
- explicit folder parent writes workspace lineage
- missing folder parent returns useful error
- conflicting inferred parents warn and avoid bad lineage

### Phase 3: CLI surface

1. Add `--parent-workspace` to `orca worktree create`.
2. Keep `--parent-worktree` behavior unchanged.
3. Add env-based inferred parent:
   - prefer `ORCA_WORKSPACE_ID`
   - fall back to `ORCA_WORKTREE_ID`
   - then cwd.
4. Add `worktree list/ps --parent-workspace <selector>` if cheap.
5. Optionally add `worktree attach/detach` if Phase 4 needs manual testing.

Tests:

- CLI creates attached child from folder terminal env
- `--parent-workspace folder:<id>` works
- `--parent-worktree` still rejects folder ids or maps cleanly with a migration message
- `--no-parent` wins over env

### Phase 4: Sidebar row construction

1. Build `workspaceLineageByChildKey` into renderer state.
2. In repo grouping, compute attached children per folder workspace.
3. Exclude attached children from ordinary repo sections in repo grouping.
4. Add folder row attached-child metadata.
5. Keep pinned children in Pinned instead of nested under folder.
6. Keep non-repo groupings unchanged initially.

Tests:

- folder workspace with two attached children renders parent then children
- attached children do not duplicate under repo sections
- pinned attached child renders in pinned section
- project group count counts parent and children once
- collapsed folder parent hides children
- stale folder parent still shows attached children

### Phase 5: Folder row rendering

1. Render folder row with `WorktreeCard` `lineageChildren`.
2. Use copy like:
   - “1 attached workspace”
   - “3 attached workspaces”
   - tooltip “Show attached workspaces” / “Hide attached workspaces”
3. Preserve folder path status indicator.
4. Preserve activation guard for stale/missing folder path.
5. Ensure nested child indentation matches current lineage child cards.
6. Ensure children retain repo badges because they may belong to different repos.

Tests:

- attached child card has repo identity visible
- folder path status indicator remains visible with children
- active child marks parent surface as containing active child if desired
- keyboard navigation order matches visual order

### Phase 6: Reveal and activation polish

1. Update reveal logic to expand folder attached groups.
2. Update `renderRowContainsWorktree` so folder-attached groups can reveal children.
3. Update pending reveal scroll behavior for folder parent render rows.
4. Make “create from folder workspace” reveal the new child under the parent, not just the parent folder workspace.

Tests:

- reveal attached child opens folder group
- creation from folder workspace scrolls to child
- collapsed project group and collapsed folder both open on reveal

### Phase 7: Manual attach/detach

This can ship after automatic capture, but the model should support it.

UI options:

- worktree context menu: “Attach to folder workspace…”
- folder workspace context menu: “Attach existing workspace…”
- drag a worktree onto a folder workspace card
- context menu on attached child: “Detach from folder workspace”

CLI options:

```bash
orca worktree attach --worktree id:<child> --parent-workspace folder:<id> --json
orca worktree detach --worktree id:<child> --json
```

Tests:

- attach existing child
- detach keeps worktree alive
- attach rejects cycles
- attach supports SSH worktrees

### Phase 8: Operational dashboard enhancements

After the tree is real:

- folder parent can show active child count
- running-agent aggregate badge
- unread aggregate badge
- quick action: “Start coordinator”
- quick action: “Create child workspace”
- CLI: list attached children from active folder workspace
- maybe a right-sidebar “Task map” view for the folder workspace

These should not block the first attached-children slice.

## Edge Cases

### Child repo outside the folder path

Allow it if explicit or inferred from folder workspace context. Attachment is intent, not path.

### Folder path stale/unavailable

Keep showing children. Do not delete or hide lineage. The parent may be unlaunchable, but the children may still exist and be useful.

### Mixed SSH/local children

Allow relationships across connection boundaries if created intentionally. Do not infer solely from path. For automatic inference, trust the active terminal/workspace context.

### Deleted folder workspace

If a folder workspace is deleted, decide whether to:

- detach children automatically, or
- keep lineage as orphaned but invisible.

Prefer detaching children on delete for V1 simplicity, with a short comment in code explaining that folder workspace deletion is an explicit user action and should not leave hidden parent references.

### Deleted child worktree

When a child worktree is proven gone, prune its workspace lineage just like legacy lineage.

### Recreated child path

Preserve child instance validation. A new worktree at the same path must not inherit old child lineage unless explicitly attached.

### Folder workspace rename

No issue. The id stays stable.

### Folder workspace path repair in future V2

Attachment should survive reconnect/path repair. That is a reason to key parentage by folder workspace id, not path.

### Provider-specific tasks

Do not attach by GitHub PR/issue identity. A GitLab MR or Linear task should behave the same.

## Validation Plan

Targeted unit tests:

- `src/main/persistence.test.ts`
- `src/main/runtime/orca-runtime.test.ts`
- `src/main/runtime/rpc/methods/worktree.test.ts`
- `src/cli/index.test.ts`
- `src/renderer/src/components/sidebar/worktree-list-groups.test.ts`
- `src/renderer/src/components/sidebar/WorktreeList.lineage-child-card.test.ts`
- `src/renderer/src/lib/sidebar-worktree-activation.test.ts`

Manual validation:

1. Create a folder workspace from a folder-backed project group.
2. Open terminal in folder workspace.
3. Run `orca worktree create --repo id:<child-repo> --name attached-test --json`.
4. Confirm new child appears under folder workspace.
5. Collapse/expand folder workspace.
6. Activate child and parent.
7. Pin child and confirm it moves to Pinned.
8. Delete child and confirm lineage disappears.
9. Repeat with SSH-backed folder group if possible.
10. Repeat with `--no-parent` and confirm child is independent.

Product validation:

- A monorepo user should be able to answer “what worktrees belong to this task?” by looking at the folder workspace card.
- An agent running in the folder workspace should be able to create workers without extra flags and have Orca preserve the relationship.
- The sidebar should feel less like a list of branches and more like a task tree.

## Suggested First Shippable Slice

Ship this first:

1. Workspace lineage model.
2. Folder parent capture from `ORCA_WORKSPACE_ID=folder:<id>`.
3. Repo-group sidebar nesting under folder workspace.
4. Reveal/activation polish.
5. Tests for automatic creation and rendering.

Defer:

- manual attach/detach
- aggregate dashboard badges
- `worktree list --parent-workspace`
- cross-status nesting
- path repair/reconnect

This slice directly delivers the user-facing magic: attached worktrees become visible from the folder workspace.

