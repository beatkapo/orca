import { gitExecFileAsync } from './runner'

/**
 * Switch the worktree to an existing local branch. Git itself refuses (and
 * surfaces a "would be overwritten by checkout" error) when uncommitted changes
 * would conflict, so we let that message propagate to the caller rather than
 * forcing — mobile shows it as a toast.
 */
export async function checkoutBranch(worktreePath: string, branch: string): Promise<void> {
  await gitExecFileAsync(['checkout', branch], { cwd: worktreePath })
}

/**
 * List local branch short-names for the branch picker, current branch first.
 * Uses `for-each-ref` (stable, scriptable output) instead of `branch` to avoid
 * locale-dependent decoration.
 */
export async function listLocalBranches(
  worktreePath: string
): Promise<{ current: string | null; branches: string[] }> {
  const { stdout } = await gitExecFileAsync(
    ['for-each-ref', '--format=%(HEAD)%09%(refname:short)', 'refs/heads/'],
    { cwd: worktreePath }
  )
  let current: string | null = null
  const branches: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) {
      continue
    }
    const [marker, name] = line.split('\t')
    if (!name) {
      continue
    }
    if (marker === '*') {
      current = name
    }
    branches.push(name)
  }
  // Why: surface the checked-out branch first so the picker reads "you are here"
  // at the top, then the rest in git's ref order.
  branches.sort((a, b) => {
    if (a === current) {
      return -1
    }
    if (b === current) {
      return 1
    }
    return 0
  })
  return { current, branches }
}
