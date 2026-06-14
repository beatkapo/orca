import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'

// Mirrors the host GenerateCommitMessageResult (src/main/text-generation/
// commit-message-text-generation.ts) — a single resolved result, not a stream.
export type MobileGenerateCommitMessageResult =
  | { success: true; message: string }
  | { success: false; error: string; canceled?: boolean }

// Normalizes the git.generateCommitMessage RPC into a discriminated result the
// UI can switch on. RPC transport failures and malformed payloads collapse to
// { success:false } so the caller never has to special-case them.
export async function requestMobileCommitMessage(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): Promise<MobileGenerateCommitMessageResult> {
  const response = await client.sendRequest('git.generateCommitMessage', {
    worktree: `id:${worktreeId}`
  })
  if (!response.ok) {
    return { success: false, error: response.error?.message || 'Failed to generate commit message' }
  }
  const result = (response as RpcSuccess).result as MobileGenerateCommitMessageResult | undefined
  if (!result || typeof result !== 'object') {
    return { success: false, error: 'Failed to generate commit message' }
  }
  if (result.success === true && typeof result.message === 'string' && result.message.length > 0) {
    return { success: true, message: result.message }
  }
  return {
    success: false,
    error: result.success === false ? result.error : 'No commit message generated',
    ...(result.success === false && result.canceled ? { canceled: true } : {})
  }
}

export async function cancelMobileCommitMessage(
  client: Pick<RpcClient, 'sendRequest'>,
  worktreeId: string
): Promise<void> {
  await client.sendRequest('git.cancelGenerateCommitMessage', { worktree: `id:${worktreeId}` })
}
