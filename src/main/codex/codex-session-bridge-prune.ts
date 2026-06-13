import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from './codex-home-paths'

export type PruneCodexSessionBridgeResult = {
  scannedManagedFiles: number
  prunedHardlinks: number
  prunedSymlinks: number
  prunedEmptyDirectories: number
}

export function pruneSystemCodexSessionBridgesFromManagedHome(): PruneCodexSessionBridgeResult {
  const managedHomePath = getOrcaManagedCodexHomePath()
  const markerPath = getSessionBridgePruneMarkerPath(managedHomePath)
  if (existsSync(markerPath)) {
    return emptyPruneCodexSessionBridgeResult()
  }

  const systemSessionsRoot = join(getSystemCodexHomePath(), 'sessions')
  const managedSessionsRoot = join(managedHomePath, 'sessions')
  if (!existsSync(managedSessionsRoot)) {
    writeSessionBridgePruneMarker(markerPath, emptyPruneCodexSessionBridgeResult())
    return emptyPruneCodexSessionBridgeResult()
  }

  const systemFileIdentities = collectSystemCodexSessionFileIdentities(systemSessionsRoot)
  const result = pruneManagedCodexSessionBridges(
    managedSessionsRoot,
    systemSessionsRoot,
    systemFileIdentities
  )
  result.prunedEmptyDirectories = pruneEmptyManagedSessionDirectories(managedSessionsRoot)
  writeSessionBridgePruneMarker(markerPath, result)
  return result
}

function collectSystemCodexSessionFileIdentities(rootPath: string): Set<string> {
  const identities = new Set<string>()
  if (!existsSync(rootPath)) {
    return identities
  }
  for (const systemSessionFilePath of listSessionJsonlFiles(rootPath)) {
    try {
      const stat = statSync(systemSessionFilePath)
      const identity = fileIdentity(stat)
      if (identity) {
        identities.add(identity)
      }
    } catch {}
  }
  return identities
}

function pruneManagedCodexSessionBridges(
  managedSessionsRoot: string,
  systemSessionsRoot: string,
  systemFileIdentities: ReadonlySet<string>
): PruneCodexSessionBridgeResult {
  const result = emptyPruneCodexSessionBridgeResult()
  for (const managedSessionFilePath of listSessionJsonlFiles(managedSessionsRoot, {
    includeSymlinks: true
  })) {
    result.scannedManagedFiles += 1
    if (unlinkManagedSymlinkBridge(managedSessionFilePath, systemSessionsRoot)) {
      result.prunedSymlinks += 1
      continue
    }
    if (unlinkManagedHardlinkBridge(managedSessionFilePath, systemFileIdentities)) {
      result.prunedHardlinks += 1
    }
  }
  return result
}

function listSessionJsonlFiles(
  rootPath: string,
  options: { includeSymlinks?: boolean } = {}
): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      const childPath = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        appendSessionFilePaths(files, listSessionJsonlFiles(childPath, options))
        continue
      }
      if (
        (entry.isFile() || (options.includeSymlinks === true && entry.isSymbolicLink())) &&
        entry.name.endsWith('.jsonl')
      ) {
        files.push(childPath)
      }
    }
  } catch (error) {
    console.warn('[codex-session-bridge] Failed to list Codex sessions for pruning:', error)
  }
  return files.sort()
}

function unlinkManagedSymlinkBridge(
  managedSessionFilePath: string,
  systemSessionsRoot: string
): boolean {
  try {
    const linkStat = lstatSync(managedSessionFilePath)
    if (!linkStat.isSymbolicLink()) {
      return false
    }
    const linkTarget = readlinkSync(managedSessionFilePath)
    const absoluteLinkTarget = isAbsolute(linkTarget)
      ? linkTarget
      : join(dirname(managedSessionFilePath), linkTarget)
    if (!isPathInsideRoot(absoluteLinkTarget, systemSessionsRoot)) {
      return false
    }
    unlinkSync(managedSessionFilePath)
    return true
  } catch {
    return false
  }
}

function unlinkManagedHardlinkBridge(
  managedSessionFilePath: string,
  systemFileIdentities: ReadonlySet<string>
): boolean {
  try {
    const linkStat = lstatSync(managedSessionFilePath)
    if (linkStat.isSymbolicLink()) {
      return false
    }
    const stat = statSync(managedSessionFilePath)
    const identity = fileIdentity(stat)
    if (!identity || !systemFileIdentities.has(identity)) {
      return false
    }
    unlinkSync(managedSessionFilePath)
    return true
  } catch {
    return false
  }
}

function pruneEmptyManagedSessionDirectories(rootPath: string): number {
  if (!existsSync(rootPath)) {
    return 0
  }
  let pruned = 0
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    pruned += pruneEmptyManagedSessionDirectories(join(rootPath, entry.name))
  }
  try {
    rmdirSync(rootPath)
    pruned += 1
  } catch {}
  return pruned
}

function fileIdentity(stat: { dev: number; ino: number }): string | null {
  if (stat.ino === 0) {
    return null
  }
  return `${stat.dev}:${stat.ino}`
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, filePath)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

function appendSessionFilePaths(target: string[], source: readonly string[]): void {
  // Why: existing Codex homes can accumulate enough nested sessions to exceed
  // V8's argument limit if child arrays are spread into push().
  for (const filePath of source) {
    target.push(filePath)
  }
}

function emptyPruneCodexSessionBridgeResult(): PruneCodexSessionBridgeResult {
  return {
    scannedManagedFiles: 0,
    prunedHardlinks: 0,
    prunedSymlinks: 0,
    prunedEmptyDirectories: 0
  }
}

function getSessionBridgePruneMarkerPath(managedHomePath: string): string {
  return join(managedHomePath, '.orca-session-bridges-pruned-v1.json')
}

function writeSessionBridgePruneMarker(
  markerPath: string,
  result: PruneCodexSessionBridgeResult
): void {
  try {
    writeFileSync(markerPath, `${JSON.stringify({ prunedAt: Date.now(), ...result })}\n`, {
      encoding: 'utf-8',
      mode: 0o600
    })
  } catch (error) {
    console.warn('[codex-session-bridge] Failed to mark Codex session bridge prune:', error)
  }
}
