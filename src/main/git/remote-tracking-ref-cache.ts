import { gitExecFileAsync } from './runner'

const MISSING_REMOTE_TRACKING_REF_TTL_MS = 30_000

type MissingRemoteTrackingRefCacheEntry = {
  expiresAt: number
}

const missingRemoteTrackingRefCache = new Map<string, MissingRemoteTrackingRefCacheEntry>()
const remoteTrackingRefInFlight = new Map<string, Promise<boolean>>()

export function clearRemoteTrackingRefCacheForTests(): void {
  missingRemoteTrackingRefCache.clear()
  remoteTrackingRefInFlight.clear()
}

function getCacheKey(worktreePath: string, ref: string): string {
  return `${worktreePath}\0${ref}`
}

function isMissingRemoteTrackingRefError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const candidate = error as Error & { code?: unknown; stderr?: unknown }
  const stderr = typeof candidate.stderr === 'string' ? candidate.stderr.trim() : ''
  if (stderr.length > 0) {
    return false
  }
  return (
    candidate.code === 1 ||
    /(?:exited with|exit code) 1\b/i.test(candidate.message) ||
    candidate.message.includes('rev-parse --verify --quiet refs/remotes/')
  )
}

function readMissingRefCache(cacheKey: string, now: number): boolean {
  const entry = missingRemoteTrackingRefCache.get(cacheKey)
  if (!entry) {
    return false
  }
  if (entry.expiresAt <= now) {
    missingRemoteTrackingRefCache.delete(cacheKey)
    return false
  }
  return true
}

export async function remoteTrackingRefExistsWithCache(
  worktreePath: string,
  ref: string
): Promise<boolean> {
  const cacheKey = getCacheKey(worktreePath, ref)
  if (readMissingRefCache(cacheKey, Date.now())) {
    return false
  }

  const inFlight = remoteTrackingRefInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  // Why: several startup refreshes can ask about the same missing remote ref.
  // Coalesce the subprocess and remember stable misses briefly.
  const probe = (async () => {
    try {
      await gitExecFileAsync(['rev-parse', '--verify', '--quiet', ref], { cwd: worktreePath })
      missingRemoteTrackingRefCache.delete(cacheKey)
      return true
    } catch (error) {
      if (!isMissingRemoteTrackingRefError(error)) {
        throw error
      }
      missingRemoteTrackingRefCache.set(cacheKey, {
        expiresAt: Date.now() + MISSING_REMOTE_TRACKING_REF_TTL_MS
      })
      return false
    }
  })()
  remoteTrackingRefInFlight.set(cacheKey, probe)
  try {
    return await probe
  } finally {
    if (remoteTrackingRefInFlight.get(cacheKey) === probe) {
      remoteTrackingRefInFlight.delete(cacheKey)
    }
  }
}
