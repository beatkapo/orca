import { describe, expect, it } from 'vitest'
import {
  encodePowerShellCommand,
  getPowerShellOsc133Bootstrap
} from './powershell-osc133-bootstrap'

describe('PowerShell OSC 133 bootstrap', () => {
  it('wraps prompt/readline without bypassing profiles or execution policy', () => {
    const script = getPowerShellOsc133Bootstrap()

    expect(script).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()')
    expect(script).toContain('ORCA_OPENCODE_CONFIG_DIR')
    expect(script).toContain('ORCA_PI_CODING_AGENT_DIR')
    expect(script).toContain('function Global:prompt')
    expect(script).toContain('function Global:PSConsoleHostReadLine')
    expect(script).toContain('`e]133;D;$fakeExitCode`a')
    expect(script).toContain('`e]133;A`a')
    expect(script).toContain('`e]133;B`a')
    expect(script).toContain('`e]133;C`a')
    expect(script).not.toContain('$PROFILE')
    expect(script).not.toContain('ExecutionPolicy')
    expect(script).not.toContain('NoProfile')
  })

  it('encodes commands as UTF-16LE base64 for PowerShell -EncodedCommand', () => {
    expect(encodePowerShellCommand('Write-Output ok')).toBe(
      Buffer.from('Write-Output ok', 'utf16le').toString('base64')
    )
  })
})
