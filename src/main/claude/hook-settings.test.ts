import { describe, expect, it } from 'vitest'
import { getManagedCommand } from './hook-settings'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

describe('getManagedCommand (win32)', () => {
  it('double-quotes the command when the user profile contains a space', () => {
    // Why: regression for C:\Users\Jose manuel — a bare path makes Git Bash run
    // only "C:/Users/Jose" and fail with "not recognized as a command".
    const scriptPath = 'C:\\Users\\Jose manuel\\.orca\\agent-hooks\\claude-hook.cmd'
    const command = withPlatform('win32', () => getManagedCommand(scriptPath))
    expect(command).toBe('"C:/Users/Jose manuel/.orca/agent-hooks/claude-hook.cmd"')
    // Why: the managed-command matcher keys off the agent-hooks/<file> substring.
    expect(command).toContain('agent-hooks/claude-hook.cmd')
  })

  it('leaves a space-free path unquoted so existing installs are untouched', () => {
    const scriptPath = 'C:\\Users\\jose\\.orca\\agent-hooks\\claude-hook.cmd'
    const command = withPlatform('win32', () => getManagedCommand(scriptPath))
    expect(command).toBe('C:/Users/jose/.orca/agent-hooks/claude-hook.cmd')
  })
})
