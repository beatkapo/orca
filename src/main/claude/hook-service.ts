import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { buildWindowsAgentHookPostCommand } from '../agent-hooks/installer-utils'

export function getClaudeManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: the endpoint file holds the *live* port/token for this Orca
      // install. A PTY that survived an Orca restart has stale PORT/TOKEN
      // baked into its env from the old instance — loading `endpoint.cmd`
      // (`set KEY=VALUE` lines) via `call` refreshes them so the hook
      // reaches the current server. Falls through to PTY env if the file
      // is missing (first run / pre-endpoint-file / running outside Orca).
      'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul',
      'if "%ORCA_AGENT_HOOK_PORT%"=="" exit /b 0',
      'if "%ORCA_AGENT_HOOK_TOKEN%"=="" exit /b 0',
      'if "%ORCA_PANE_KEY%"=="" exit /b 0',
      buildWindowsAgentHookPostCommand('claude'),
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Why: the endpoint file holds the *live* port/token for this Orca
    // install. PTYs that survive an Orca restart have stale PORT/TOKEN
    // baked into their env from the old instance — sourcing the file here
    // lets us reach the new server. Falls back to PTY env if the file is
    // missing (first-run / pre-endpoint-file scripts / running outside Orca).
    // Why: suppress stderr on the `.` builtin. A TOCTOU race (endpoint unlinked
    // between the `[ -r ]` test and the source) or a malformed line (e.g. CRLF
    // bled in from a cross-platform userData copy) would otherwise print a
    // parse error that agent transcripts could surface. Stale coords → dead
    // port → silent-fail is the documented fail-open path anyway — the env-var
    // guards below handle the empty PORT/TOKEN case — so swallowing the noise
    // here is strictly better than leaking shell errors into the hook output.
    // `|| :` defends against an eventual `set -e` in an outer script context
    // (not present today) aborting the hook on a parse error.
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    'payload=$(cat)',
    'if [ -z "$payload" ]; then',
    '  exit 0',
    'fi',
    // Why: worktreeId embeds a filesystem path, so hand-building JSON in POSIX
    // shell is not safe once a path contains quotes or newlines. Post the raw
    // hook payload plus metadata as form fields and let the receiver parse it.
    'curl -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/claude" \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${ORCA_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${ORCA_TAB_ID}" \\',
    '  --data-urlencode "worktreeId=${ORCA_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload=${payload}" >/dev/null 2>&1 || true',
    'exit 0',
    ''
  ].join('\n')
}

export class ClaudeHookService {
  getStatus(): AgentHookInstallStatus {
    return this.runtimeHomeOnlyStatus('')
  }

  install(): AgentHookInstallStatus {
    return this.getStatus()
  }

  buildPtyEnv(): Record<string, string> {
    return {}
  }

  async installRemote(_sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    return this.runtimeHomeOnlyStatus(remoteHome)
  }

  remove(): AgentHookInstallStatus {
    return this.getStatus()
  }

  private runtimeHomeOnlyStatus(configPath: string): AgentHookInstallStatus {
    return {
      agent: 'claude',
      state: 'not_installed',
      configPath,
      managedHooksPresent: false,
      detail: 'Claude hooks are prepared per launch through Orca runtime home'
    }
  }
}

export const claudeHookService = new ClaudeHookService()
