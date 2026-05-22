import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import { StepBadge } from './BrowserUseStepBadge'

type Props = {
  command: string
  skillInstalled: boolean
  skillDetected: boolean
  skillMarkedInstalled: boolean
  skillLoading: boolean
  skillError: string | null
  disabled?: boolean
  onRecheck: () => void | Promise<void>
  onToggleInstalled: () => void
}

export function BrowserUseSkillStep({
  command,
  skillInstalled,
  skillDetected,
  skillMarkedInstalled,
  skillLoading,
  skillError,
  disabled = false,
  onRecheck,
  onToggleInstalled
}: Props): React.JSX.Element {
  return (
    <AgentSkillSetupPanel
      variant="inline"
      title="Browser Use skill"
      detectedDescription="Detected on this machine. Agents can drive Orca's browser."
      markedDescription="Marked as installed on this machine."
      missingDescription="Agents need this skill before they can drive Orca's browser. If you already installed it, use Re-check instead of running the installer again."
      command={command}
      terminalTitle="Browser Use setup"
      terminalAriaLabel="Browser Use skill install terminal"
      terminalWorktreeId="settings-browser-use-skill-terminal"
      installed={skillInstalled}
      detected={skillDetected}
      markedInstalled={skillMarkedInstalled}
      loading={skillLoading}
      error={skillError}
      installDisabled={disabled}
      leading={<StepBadge index={2} state={skillInstalled ? 'done' : 'pending'} />}
      onRecheck={onRecheck}
      onToggleMarkedInstalled={onToggleInstalled}
    />
  )
}
