import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import {
  agentDisplayLabel,
  agentDotState,
  agentIdentityLabel,
  formatTimeAgo
} from './agent-row-display'

function row(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'p',
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('agentDotState', () => {
  it('maps known states through and unknown to idle', () => {
    expect(agentDotState(row({ state: 'working' }))).toBe('working')
    expect(agentDotState(row({ state: 'blocked' }))).toBe('blocked')
    expect(agentDotState(row({ state: 'waiting' }))).toBe('waiting')
    expect(agentDotState(row({ state: 'done' }))).toBe('done')
    expect(agentDotState(row({ state: 'unknown-state' as never }))).toBe('idle')
  })

  it('reports interrupted regardless of state', () => {
    expect(agentDotState(row({ state: 'done', interrupted: true }))).toBe('interrupted')
  })
})

describe('agentDisplayLabel', () => {
  it('prefers last message, then prompt, then state label', () => {
    expect(agentDisplayLabel(row({ lastAssistantMessage: 'hello there' }))).toBe('hello there')
    expect(agentDisplayLabel(row({ lastAssistantMessage: '   ', prompt: 'do the thing' }))).toBe(
      'do the thing'
    )
    expect(agentDisplayLabel(row({ state: 'working', prompt: '' }))).toBe('Working')
  })
})

describe('agentIdentityLabel', () => {
  it('maps known agent types and falls back to initials', () => {
    expect(agentIdentityLabel('claude')).toBe('CL')
    expect(agentIdentityLabel('codex')).toBe('CX')
    expect(agentIdentityLabel('mystery')).toBe('MY')
    expect(agentIdentityLabel(null)).toBe('')
  })
})

describe('formatTimeAgo', () => {
  const now = 10_000_000
  it('formats across thresholds', () => {
    expect(formatTimeAgo(now - 30_000, now)).toBe('just now')
    expect(formatTimeAgo(now - 5 * 60_000, now)).toBe('5m')
    expect(formatTimeAgo(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatTimeAgo(now - 2 * 86_400_000, now)).toBe('2d')
  })
})
