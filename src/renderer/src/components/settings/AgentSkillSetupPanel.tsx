import { useEffect, useState, type ReactNode } from 'react'
import { Terminal } from 'lucide-react'
import { IntegrationStatusPill } from '../integration-status-pill'
import { OnboardingInlineCommandTerminal } from '../onboarding/OnboardingInlineCommandTerminal'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

type AgentSkillSetupPanelVariant = 'card' | 'inline'

type AgentSkillSetupPanelProps = {
  title: string
  detectedDescription: string
  markedDescription: string
  missingDescription: string
  command: string
  terminalTitle: string
  terminalAriaLabel: string
  terminalWorktreeId: string
  installed: boolean
  detected: boolean
  markedInstalled?: boolean
  loading: boolean
  error: string | null
  installDisabled?: boolean
  leading?: ReactNode
  icon?: ReactNode
  variant?: AgentSkillSetupPanelVariant
  className?: string
  onRecheck: () => void | Promise<void>
  onToggleMarkedInstalled?: () => void
}

export function AgentSkillSetupPanel({
  title,
  detectedDescription,
  markedDescription,
  missingDescription,
  command,
  terminalTitle,
  terminalAriaLabel,
  terminalWorktreeId,
  installed,
  detected,
  markedInstalled = false,
  loading,
  error,
  installDisabled = false,
  leading,
  icon,
  variant = 'card',
  className,
  onRecheck,
  onToggleMarkedInstalled
}: AgentSkillSetupPanelProps): React.JSX.Element {
  const [terminalOpen, setTerminalOpen] = useState(false)

  useEffect(() => {
    if (installed) {
      setTerminalOpen(false)
    }
  }, [installed])

  const body = detected
    ? detectedDescription
    : markedInstalled
      ? markedDescription
      : missingDescription

  return (
    <div
      className={cn(
        variant === 'card' ? 'rounded-xl border border-border bg-muted/20' : null,
        className
      )}
    >
      <div className={cn('flex items-start gap-4', variant === 'card' ? 'p-5' : null)}>
        {leading}
        {icon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>
            {loading && !installed ? (
              <IntegrationStatusPill tone="neutral">Checking...</IntegrationStatusPill>
            ) : installed ? (
              <IntegrationStatusPill tone="connected">Installed</IntegrationStatusPill>
            ) : (
              <IntegrationStatusPill tone="attention">Not installed</IntegrationStatusPill>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
          {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
          {!detected && !loading && onToggleMarkedInstalled ? (
            <button
              type="button"
              className="mt-1 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:hover:text-muted-foreground"
              onClick={onToggleMarkedInstalled}
            >
              {markedInstalled ? 'Undo manual installed marker' : 'Mark installed'}
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!installed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTerminalOpen(true)}
              disabled={terminalOpen || installDisabled}
            >
              <Terminal className="size-3.5" />
              Install
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onRecheck()}
            disabled={loading}
          >
            Re-check
          </Button>
        </div>
      </div>
      {!installed && terminalOpen ? (
        <div className={cn(variant === 'card' ? 'px-5 pb-5' : 'mt-3')}>
          <OnboardingInlineCommandTerminal
            worktreeId={terminalWorktreeId}
            command={command}
            title={terminalTitle}
            ariaLabel={terminalAriaLabel}
            description="Press Enter to run the installer. If you already installed this skill, skip this terminal and use Re-check instead."
          />
        </div>
      ) : null}
    </div>
  )
}
