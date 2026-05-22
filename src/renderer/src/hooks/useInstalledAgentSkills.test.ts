import { describe, expect, it } from 'vitest'
import type { DiscoveredSkill } from '../../../shared/skills'
import { GLOBAL_AGENT_SKILL_SOURCE_KINDS, hasInstalledAgentSkill } from './useInstalledAgentSkills'

function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'skill-1',
    name: 'Example Skill',
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    rootPath: '/Users/test/.agents/skills',
    directoryPath: '/Users/test/.agents/skills/example-skill',
    skillFilePath: '/Users/test/.agents/skills/example-skill/SKILL.md',
    installed: true,
    fileCount: 1,
    updatedAt: null,
    ...overrides
  }
}

describe('hasInstalledAgentSkill', () => {
  it('matches installed skills by summarized name', () => {
    expect(hasInstalledAgentSkill([skill({ name: 'orca-cli' })], 'orca-cli')).toBe(true)
  })

  it('matches installed skills by directory name when frontmatter has a display name', () => {
    expect(
      hasInstalledAgentSkill(
        [
          skill({
            name: 'Orca CLI',
            directoryPath: 'C:\\Users\\test\\.agents\\skills\\orca-cli'
          })
        ],
        'orca-cli'
      )
    ).toBe(true)
  })

  it('ignores non-installed discovery entries', () => {
    expect(
      hasInstalledAgentSkill([skill({ name: 'orca-cli', installed: false })], 'orca-cli')
    ).toBe(false)
  })

  it('does not count repo or plugin skills when matching global installs', () => {
    expect(
      hasInstalledAgentSkill(
        [
          skill({
            name: 'orca-cli',
            sourceKind: 'repo',
            sourceLabel: 'Repo test .agents',
            rootPath: '/repo/.agents/skills',
            directoryPath: '/repo/.agents/skills/orca-cli',
            skillFilePath: '/repo/.agents/skills/orca-cli/SKILL.md'
          }),
          skill({
            id: 'skill-2',
            name: 'orca-cli',
            sourceKind: 'plugin',
            sourceLabel: 'Codex plugin cache',
            rootPath: '/Users/test/.codex/plugins/cache',
            directoryPath: '/Users/test/.codex/plugins/cache/vendor/orca-cli',
            skillFilePath: '/Users/test/.codex/plugins/cache/vendor/orca-cli/SKILL.md'
          })
        ],
        'orca-cli',
        { sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS }
      )
    ).toBe(false)
  })

  it('counts home skills when matching global installs', () => {
    expect(
      hasInstalledAgentSkill([skill({ name: 'orca-cli' })], 'orca-cli', {
        sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
      })
    ).toBe(true)
  })
})
