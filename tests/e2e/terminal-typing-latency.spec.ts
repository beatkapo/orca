/* eslint-disable max-lines -- Why: these latency scenarios share one Electron
fixture plus timing probes; splitting them would make the threshold setup harder
to audit than the file length. */
import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  sendToTerminal
} from './helpers/terminal'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'

const KEY_LATENCY_SAMPLES = 'abcdefghijklmnop'
const MAX_MEDIAN_KEY_LATENCY_MS = 250
const MAX_WORST_KEY_LATENCY_MS = 1_000
const CODEX_LIKE_KEY_SAMPLES = 'abcdefghijklmnopqrstuvwxyz'
const CODEX_LIKE_KEY_INTERVAL_MS = 25
const MAX_CODEX_LIKE_MEDIAN_KEY_LATENCY_MS = 120
const MAX_CODEX_LIKE_WORST_KEY_LATENCY_MS = 450
const BACKGROUND_FLOOD_TAB_COUNT = 4
const SORTABLE_TAB = '[data-testid="sortable-tab"]'
const REAL_CODEX_TUI_BINARY_ENV = 'ORCA_E2E_REAL_CODEX_TUI_BINARY'
const REAL_CODEX_INPUT_MARKER = '\u203a '

type TerminalSample = {
  t: number
  text: string
}

function defaultRealCodexTuiBinary(): string {
  return path.join(
    homedir(),
    'projects',
    'codex',
    'codex-rs',
    'target',
    'debug',
    process.platform === 'win32' ? 'codex-tui.exe' : 'codex-tui'
  )
}

function getRealCodexTuiBinary(): string | null {
  const configured = process.env[REAL_CODEX_TUI_BINARY_ENV]
  if (configured) {
    return existsSync(configured) ? configured : null
  }

  // Why: this regression needs the user's local Codex checkout; CI still runs
  // the deterministic Codex-shaped repro when that sibling checkout is absent.
  const defaultBinary = defaultRealCodexTuiBinary()
  return existsSync(defaultBinary) ? defaultBinary : null
}

function tomlBasicString(value: string): string {
  return JSON.stringify(value)
}

function removePathBestEffort(targetPath: string, recursive = false): void {
  try {
    rmSync(targetPath, { force: true, recursive, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    console.warn(`Failed to remove ${targetPath}:`, error)
  }
}

function terminateProcessFromPidFile(pidFile: string): void {
  let pid: number | null = null
  try {
    pid = Number(readFileSync(pidFile, 'utf8'))
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined
    if (code !== 'ENOENT') {
      console.warn(`Failed to read process pid from ${pidFile}:`, error)
    }
    return
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined
    if (code !== 'ESRCH') {
      console.warn(`Failed to terminate process ${pid}:`, error)
    }
  }
}

async function focusActiveTerminalInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!pane) {
      throw new Error('No active terminal pane to focus')
    }
    pane.terminal.focus()
    const textarea = pane.container.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement | null
    if (!textarea) {
      throw new Error('Active terminal has no xterm helper textarea')
    }
    textarea.focus()
  })
}

function interactivePromptScript(runId: string): string {
  return `
process.stdin.setEncoding('utf8')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
let seq = 0
const interrupt = String.fromCharCode(3)
process.stdout.write('\\x1b]0;Terminal typing benchmark\\x07')
process.stdout.write('TYPING_READY_${runId}\\n')
process.stdin.on('data', (chunk) => {
  if (chunk.includes(interrupt)) {
    process.exit(0)
  }
  for (const char of chunk) {
    if (char === '\\r' || char === '\\n') continue
    seq += 1
    process.stdout.write('\\r\\x1b[2KInteractive prompt ' + seq + ': ' + char + ' TYPING_KEY_${runId}_' + seq + '\\n')
  }
})
`
}

function codexLikePromptScript(runId: string): string {
  return `
const { performance } = require('node:perf_hooks')
process.stdin.setEncoding('utf8')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()

const runId = ${JSON.stringify(runId)}
const pasteBurstCharIntervalMs = 8
const pasteBurstFlushMs = 9
let typed = ''
let seq = 0
let pendingFirst = null
let activeBuffer = ''
let lastPlainCharAt = 0
let flushTimer = null
let closed = false

function colorRow(row) {
  const color = 30 + (row % 6)
  return '\\x1b[' + color + 'm' + 'Codex mock redraw row ' + String(row).padStart(2, '0') + ' ' + '.'.repeat(180) + '\\x1b[0m'
}

function frame() {
  seq += 1
  const rows = []
  rows.push('MOCK_CODEX_READY_' + runId + ' frame=' + seq)
  for (let row = 0; row < 30; row++) rows.push(colorRow(row))
  rows.push('MOCK_CODEX_INPUT_' + runId + ': ' + typed)
  rows.push('MOCK_CODEX_END_' + runId + '_' + seq)
  // Why: Codex uses synchronized ratatui redraws; keep this reproduction on
  // the same ANSI shape so Orca exercises xterm's real TUI parse path.
  process.stdout.write('\\x1b[?2026h\\x1b[?1049h\\x1b[H\\x1b[2J' + rows.join('\\r\\n') + '\\x1b[?2026l')
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushPasteBurst, pasteBurstFlushMs)
}

function commitPendingFirst(now) {
  if (!pendingFirst) return false
  if (now - pendingFirst.t <= pasteBurstCharIntervalMs) return false
  typed += pendingFirst.ch
  pendingFirst = null
  frame()
  return true
}

function flushPasteBurst() {
  flushTimer = null
  const now = performance.now()
  if (activeBuffer) {
    if (now - lastPlainCharAt <= pasteBurstCharIntervalMs) {
      scheduleFlush()
      return
    }
    typed += activeBuffer
    activeBuffer = ''
    pendingFirst = null
    frame()
    return
  }
  commitPendingFirst(now)
}

function handleChar(ch) {
  const now = performance.now()
  if (ch === '\\u0003') {
    closed = true
    process.stdout.write('\\x1b[?2026l\\x1b[?1049l')
    process.exit(0)
  }
  if (ch === '\\r' || ch === '\\n') return
  commitPendingFirst(now)
  if (activeBuffer) {
    activeBuffer += ch
    lastPlainCharAt = now
    scheduleFlush()
    return
  }
  if (pendingFirst && now - pendingFirst.t <= pasteBurstCharIntervalMs) {
    activeBuffer = pendingFirst.ch + ch
    pendingFirst = null
    lastPlainCharAt = now
    scheduleFlush()
    return
  }
  pendingFirst = { ch, t: now }
  scheduleFlush()
}

process.stdin.on('data', (chunk) => {
  for (const ch of chunk) handleChar(ch)
})

process.on('exit', () => {
  if (!closed) {
    process.stdout.write('\\x1b[?2026l\\x1b[?1049l')
  }
})

frame()
`
}

function backgroundFloodScript(runId: string): string {
  return `
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes('\\u0003')) process.exit(0)
})

let seq = 0
const chunk = 'BACKGROUND_FLOOD_${runId}_' + 'x'.repeat(64 * 1024) + '\\n'
function pump() {
  for (let index = 0; index < 16; index++) {
    seq += 1
    if (!process.stdout.write(String(seq) + ':' + chunk)) {
      process.stdout.once('drain', () => setImmediate(pump))
      return
    }
  }
  setImmediate(pump)
}
pump()
`
}

function realCodexLauncherScript({
  binary,
  cwd,
  codexHome,
  logDir,
  pidFile
}: {
  binary: string
  cwd: string
  codexHome: string
  logDir: string
  pidFile: string
}): string {
  return `
const fs = require('node:fs')
const { spawn } = require('node:child_process')

process.chdir(${JSON.stringify(cwd)})

const args = [
  '-C',
  ${JSON.stringify(cwd)},
  '-c',
  ${JSON.stringify(`log_dir=${tomlBasicString(logDir)}`)},
  '-c',
  'mcp_oauth_credentials_store="file"'
]
const child = spawn(${JSON.stringify(binary)}, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CODEX_HOME: ${JSON.stringify(codexHome)},
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'dummy',
    RUST_LOG: process.env.RUST_LOG || 'error'
  }
})
if (child.pid) {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
}

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
`
}

function realCodexConfig({ workspacePath, logDir }: { workspacePath: string; logDir: string }) {
  return `model = "gpt-5.4"
model_provider = "openai"
forced_login_method = "api"
mcp_oauth_credentials_store = "file"
log_dir = ${tomlBasicString(logDir)}
suppress_unstable_features_warning = true

[analytics]
enabled = false

[projects.${tomlBasicString(workspacePath)}]
trust_level = "trusted"
`
}

function writeRealCodexHome(codexHome: string, workspacePath: string, logDir: string): void {
  mkdirSync(codexHome, { recursive: true })
  mkdirSync(logDir, { recursive: true })
  writeFileSync(path.join(codexHome, 'config.toml'), realCodexConfig({ workspacePath, logDir }))
  writeFileSync(
    path.join(codexHome, 'auth.json'),
    '{"OPENAI_API_KEY":"dummy","tokens":null,"last_refresh":null}'
  )
}

async function waitForMarkerLatency(
  page: Page,
  marker: string,
  timeoutMs: number
): Promise<number> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if ((await getTerminalContent(page, 12_000)).includes(marker)) {
      return performance.now() - start
    }
    await page.waitForTimeout(5)
  }
  throw new Error(`Timed out waiting for terminal marker ${marker}`)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function tabLocator(page: Page, tabId: string) {
  return page.locator(`${SORTABLE_TAB}[data-tab-id="${tabId}"]`).first()
}

async function countRenderedTabs(page: Page): Promise<number> {
  return page.locator(SORTABLE_TAB).count()
}

async function getDomActiveTabId(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const match = document.querySelector(`${selector}[data-active="true"]`)
    return match?.getAttribute('data-tab-id') ?? null
  }, SORTABLE_TAB)
}

async function createTerminalTab(page: Page): Promise<string> {
  const tabsBefore = await countRenderedTabs(page)
  const activeBefore = await getActiveTabId(page)

  await page.getByRole('button', { name: 'New tab' }).click()
  await page
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click()

  await expect
    .poll(() => countRenderedTabs(page), {
      timeout: 5_000,
      message: 'New Terminal did not render a new tab in the tab bar'
    })
    .toBe(tabsBefore + 1)

  let tabId: string | null = null
  await expect
    .poll(
      async () => {
        tabId = await getActiveTabId(page)
        return Boolean(tabId && tabId !== activeBefore)
      },
      {
        timeout: 5_000,
        message: 'New Terminal did not become the active tab'
      }
    )
    .toBe(true)

  if (!tabId) {
    throw new Error('createTerminalTab: active tab id was unavailable after creating terminal')
  }
  return tabId
}

async function waitForTabPtyId(page: Page, tabId: string): Promise<string> {
  let ptyId: string | null = null
  await expect
    .poll(
      async () => {
        ptyId = await page.evaluate((targetTabId) => {
          const manager = window.__paneManagers?.get(targetTabId)
          const pane = manager?.getPanes?.()[0] ?? null
          return pane?.container?.dataset?.ptyId ?? null
        }, tabId)
        return ptyId
      },
      {
        timeout: 15_000,
        message: `Terminal tab ${tabId} did not receive a PTY binding`
      }
    )
    .not.toBeNull()

  if (!ptyId) {
    throw new Error(`waitForTabPtyId: tab ${tabId} has no PTY id`)
  }
  return ptyId
}

async function createHiddenFloodTerminals(page: Page, count: number): Promise<string[]> {
  const firstTabId = await getActiveTabId(page)
  if (!firstTabId) {
    throw new Error('Expected an active terminal tab before creating background flood terminals')
  }

  const ptyIds: string[] = []
  for (let index = 0; index < count; index++) {
    const tabId = await createTerminalTab(page)
    await waitForActiveTerminalManager(page, 30_000)
    ptyIds.push(await waitForTabPtyId(page, tabId))
  }

  await tabLocator(page, firstTabId).click()
  await expect
    .poll(() => getDomActiveTabId(page), {
      timeout: 5_000,
      message: 'Foreground terminal tab did not become active before typing latency repro'
    })
    .toBe(firstTabId)

  return ptyIds
}

async function getVisibleTerminalScreenText(page: Page, charLimit = 16_000): Promise<string> {
  return page.evaluate((limit) => {
    const store = window.__store
    const paneManagers = window.__paneManagers
    if (!store || !paneManagers) {
      return ''
    }

    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    const tabId =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? paneManagers.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const terminal = pane?.terminal
    const buffer = terminal?.buffer?.active
    if (!terminal || !buffer) {
      const text = pane?.serializeAddon?.serialize?.() ?? ''
      return text.slice(-limit)
    }

    const start = Math.max(0, buffer.viewportY ?? buffer.baseY ?? 0)
    const rowCount = Math.min(terminal.rows, Math.max(0, buffer.length - start))
    const lines: string[] = []
    for (let row = 0; row < rowCount; row++) {
      const line = buffer.getLine(start + row)
      if (line) {
        lines.push(line.translateToString(true))
      }
    }
    return lines.join('\n').slice(-limit)
  }, charLimit)
}

async function waitForVisibleTerminalText(
  page: Page,
  expected: string,
  timeoutMs = 10_000
): Promise<void> {
  await expect
    .poll(async () => (await getVisibleTerminalScreenText(page)).includes(expected), {
      timeout: timeoutMs,
      message: `Visible terminal did not contain "${expected}"`
    })
    .toBe(true)
}

async function waitForAnyVisibleTerminalText(
  page: Page,
  expectedValues: string[],
  timeoutMs = 10_000
): Promise<string> {
  let match: string | null = null
  await expect
    .poll(
      async () => {
        const screenText = await getVisibleTerminalScreenText(page)
        match = expectedValues.find((expected) => screenText.includes(expected)) ?? null
        return match
      },
      {
        timeout: timeoutMs,
        message: `Visible terminal did not contain any of: ${expectedValues.join(', ')}`
      }
    )
    .not.toBeNull()

  if (!match) {
    throw new Error(`Visible terminal did not contain any of: ${expectedValues.join(', ')}`)
  }
  return match
}

async function startTerminalSampler(page: Page, charLimit = 16_000): Promise<void> {
  await page.evaluate((limit) => {
    const target = window as unknown as {
      __terminalTypingSamples?: TerminalSample[]
      __terminalTypingSamplerTimer?: ReturnType<typeof setInterval>
    }
    if (target.__terminalTypingSamplerTimer) {
      clearInterval(target.__terminalTypingSamplerTimer)
    }
    target.__terminalTypingSamples = []

    const readActiveTerminal = (): string => {
      const store = window.__store
      const paneManagers = window.__paneManagers
      if (!store || !paneManagers) {
        return ''
      }
      const state = store.getState()
      const worktreeId = state.activeWorktreeId
      const tabId =
        state.activeTabType === 'terminal'
          ? state.activeTabId
          : worktreeId
            ? (state.activeTabIdByWorktree?.[worktreeId] ?? null)
            : null
      const manager = tabId ? paneManagers.get(tabId) : null
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
      const terminal = pane?.terminal
      const buffer = terminal?.buffer?.active
      if (!terminal || !buffer) {
        const text = pane?.serializeAddon?.serialize?.() ?? ''
        return text.slice(-limit)
      }

      const start = Math.max(0, buffer.viewportY ?? buffer.baseY ?? 0)
      const rowCount = Math.min(terminal.rows, Math.max(0, buffer.length - start))
      const lines: string[] = []
      for (let row = 0; row < rowCount; row++) {
        const line = buffer.getLine(start + row)
        if (line) {
          lines.push(line.translateToString(true))
        }
      }
      return lines.join('\n').slice(-limit)
    }

    const sample = (): void => {
      target.__terminalTypingSamples?.push({
        t: performance.now(),
        text: readActiveTerminal()
      })
    }
    sample()
    target.__terminalTypingSamplerTimer = setInterval(sample, 5)
  }, charLimit)
}

async function stopTerminalSampler(page: Page): Promise<TerminalSample[]> {
  return page.evaluate(() => {
    const target = window as unknown as {
      __terminalTypingSamples?: TerminalSample[]
      __terminalTypingSamplerTimer?: ReturnType<typeof setInterval>
    }
    if (target.__terminalTypingSamplerTimer) {
      clearInterval(target.__terminalTypingSamplerTimer)
      target.__terminalTypingSamplerTimer = undefined
    }
    return target.__terminalTypingSamples ?? []
  })
}

function firstVisiblePrefixLatency(
  samples: TerminalSample[],
  keyTime: number,
  marker: string,
  prefix: string
): number | null {
  const expected = `${marker}: ${prefix}`
  const sample = samples.find((entry) => entry.t >= keyTime && entry.text.includes(expected))
  return sample ? sample.t - keyTime : null
}

function firstVisibleTextLatency(
  samples: TerminalSample[],
  keyTime: number,
  expected: string
): number | null {
  const sample = samples.find((entry) => entry.t >= keyTime && entry.text.includes(expected))
  return sample ? sample.t - keyTime : null
}

test.describe('Terminal typing latency', () => {
  test('interactive prompt echoes typed keys without visible lag', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const ptyId = await waitForActivePanePtyId(orcaPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.orca-typing-benchmark-${runId}.mjs`)
    writeFileSync(scriptPath, interactivePromptScript(runId))
    let commandSent = false
    try {
      await sendToTerminal(orcaPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      commandSent = true
      await waitForTerminalOutput(orcaPage, `TYPING_READY_${runId}`, 10_000)
      await focusActiveTerminalInput(orcaPage)

      const latencies: number[] = []
      for (const [index, char] of [...KEY_LATENCY_SAMPLES].entries()) {
        const seq = index + 1
        const marker = `TYPING_KEY_${runId}_${seq}`
        const start = performance.now()
        await orcaPage.keyboard.type(char)
        await waitForMarkerLatency(orcaPage, marker, MAX_WORST_KEY_LATENCY_MS)
        latencies.push(performance.now() - start)
      }

      const medianLatency = median(latencies)
      const worstLatency = Math.max(...latencies)
      testInfo.annotations.push({
        type: 'terminal-typing-latency',
        description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')}`
      })

      expect(medianLatency).toBeLessThan(MAX_MEDIAN_KEY_LATENCY_MS)
      expect(worstLatency).toBeLessThan(MAX_WORST_KEY_LATENCY_MS)
    } finally {
      if (commandSent) {
        await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })

  test('Codex-like TUI redraws keep burst-typed input visible', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const ptyId = await waitForActivePanePtyId(orcaPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.orca-codex-like-typing-${runId}.cjs`)
    writeFileSync(scriptPath, codexLikePromptScript(runId))
    let commandSent = false
    try {
      await sendToTerminal(orcaPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      commandSent = true
      await waitForVisibleTerminalText(orcaPage, `MOCK_CODEX_READY_${runId}`, 10_000)
      await focusActiveTerminalInput(orcaPage)
      await startTerminalSampler(orcaPage)

      const keyTimes: number[] = []
      for (const char of CODEX_LIKE_KEY_SAMPLES) {
        keyTimes.push(await orcaPage.evaluate(() => performance.now()))
        await orcaPage.keyboard.type(char)
        await orcaPage.waitForTimeout(CODEX_LIKE_KEY_INTERVAL_MS)
      }

      await orcaPage.waitForTimeout(1_000)
      const samples = await stopTerminalSampler(orcaPage)
      const marker = `MOCK_CODEX_INPUT_${runId}`
      const latencies: number[] = []
      const missingPrefixes: string[] = []
      for (const [index] of [...CODEX_LIKE_KEY_SAMPLES].entries()) {
        const prefix = CODEX_LIKE_KEY_SAMPLES.slice(0, index + 1)
        const latency = firstVisiblePrefixLatency(samples, keyTimes[index] ?? 0, marker, prefix)
        if (latency === null) {
          missingPrefixes.push(prefix)
        } else {
          latencies.push(latency)
        }
      }

      const medianLatency = median(latencies)
      const worstLatency = Math.max(...latencies)
      testInfo.annotations.push({
        type: 'codex-like-terminal-typing-latency',
        description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')} missing=${missingPrefixes.join(',')}`
      })
      console.log(
        `[terminal-typing-latency] codex-like median=${medianLatency.toFixed(
          1
        )}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')}`
      )

      expect(missingPrefixes).toEqual([])
      expect(medianLatency).toBeLessThan(MAX_CODEX_LIKE_MEDIAN_KEY_LATENCY_MS)
      expect(worstLatency).toBeLessThan(MAX_CODEX_LIKE_WORST_KEY_LATENCY_MS)
    } finally {
      await stopTerminalSampler(orcaPage).catch(() => [])
      if (commandSent) {
        await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })

  test('Codex-like TUI typing stays visible during hidden output floods', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const foregroundPtyId = await waitForActivePanePtyId(orcaPage)
    const runId = randomUUID()
    const promptScriptPath = path.join(testRepoPath, `.orca-codex-like-typing-${runId}.cjs`)
    const floodScriptPath = path.join(testRepoPath, `.orca-hidden-flood-${runId}.cjs`)
    writeFileSync(promptScriptPath, codexLikePromptScript(runId))
    writeFileSync(floodScriptPath, backgroundFloodScript(runId))
    const backgroundPtyIds: string[] = []
    let foregroundCommandSent = false
    try {
      await sendToTerminal(orcaPage, foregroundPtyId, `node ${JSON.stringify(promptScriptPath)}\r`)
      foregroundCommandSent = true
      await waitForVisibleTerminalText(orcaPage, `MOCK_CODEX_READY_${runId}`, 10_000)

      backgroundPtyIds.push(
        ...(await createHiddenFloodTerminals(orcaPage, BACKGROUND_FLOOD_TAB_COUNT))
      )
      await orcaPage.waitForTimeout(250)
      for (const backgroundPtyId of backgroundPtyIds) {
        await sendToTerminal(orcaPage, backgroundPtyId, `node ${JSON.stringify(floodScriptPath)}\r`)
      }
      await orcaPage.waitForTimeout(500)

      await focusActiveTerminalInput(orcaPage)
      await startTerminalSampler(orcaPage)

      const keyTimes: number[] = []
      for (const char of CODEX_LIKE_KEY_SAMPLES) {
        keyTimes.push(await orcaPage.evaluate(() => performance.now()))
        await orcaPage.keyboard.type(char)
        await orcaPage.waitForTimeout(CODEX_LIKE_KEY_INTERVAL_MS)
      }

      await orcaPage.waitForTimeout(1_000)
      const samples = await stopTerminalSampler(orcaPage)
      const marker = `MOCK_CODEX_INPUT_${runId}`
      const latencies: number[] = []
      const missingPrefixes: string[] = []
      for (const [index] of [...CODEX_LIKE_KEY_SAMPLES].entries()) {
        const prefix = CODEX_LIKE_KEY_SAMPLES.slice(0, index + 1)
        const latency = firstVisiblePrefixLatency(samples, keyTimes[index] ?? 0, marker, prefix)
        if (latency === null) {
          missingPrefixes.push(prefix)
        } else {
          latencies.push(latency)
        }
      }

      const medianLatency = median(latencies)
      const worstLatency = Math.max(...latencies)
      testInfo.annotations.push({
        type: 'codex-like-hidden-flood-typing-latency',
        description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(
          1
        )}ms samples=${latencies.map((value) => value.toFixed(1)).join(',')} missing=${missingPrefixes.join(',')}`
      })
      console.log(
        `[terminal-typing-latency] hidden-flood median=${medianLatency.toFixed(
          1
        )}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')}`
      )

      expect(missingPrefixes).toEqual([])
      expect(medianLatency).toBeLessThan(MAX_CODEX_LIKE_MEDIAN_KEY_LATENCY_MS)
      expect(worstLatency).toBeLessThan(MAX_CODEX_LIKE_WORST_KEY_LATENCY_MS)
    } finally {
      await stopTerminalSampler(orcaPage).catch(() => [])
      for (const backgroundPtyId of backgroundPtyIds) {
        await sendToTerminal(orcaPage, backgroundPtyId, '\x03').catch(() => undefined)
      }
      if (foregroundCommandSent) {
        await sendToTerminal(orcaPage, foregroundPtyId, '\x03').catch(() => undefined)
      }
      rmSync(promptScriptPath, { force: true })
      rmSync(floodScriptPath, { force: true })
    }
  })

  test.describe('real Codex TUI source repro', () => {
    const realCodexTuiBinary = getRealCodexTuiBinary()

    test.skip(
      !realCodexTuiBinary,
      `Set ${REAL_CODEX_TUI_BINARY_ENV} or build ${defaultRealCodexTuiBinary()} to run the real Codex TUI latency repro`
    )

    test('real Codex TUI typing stays visible during hidden output floods', async ({
      orcaPage,
      testRepoPath
    }, testInfo) => {
      if (!realCodexTuiBinary) {
        throw new Error('Real Codex TUI binary is unavailable')
      }

      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 30_000)

      const foregroundPtyId = await waitForActivePanePtyId(orcaPage)
      const runId = randomUUID()
      const codexHome = path.join(testRepoPath, `.orca-real-codex-home-${runId}`)
      const codexLogDir = path.join(codexHome, 'log')
      const codexPidFile = path.join(codexHome, 'codex-tui.pid')
      const launcherScriptPath = path.join(testRepoPath, `.orca-real-codex-launcher-${runId}.cjs`)
      const floodScriptPath = path.join(testRepoPath, `.orca-hidden-flood-${runId}.cjs`)
      writeRealCodexHome(codexHome, testRepoPath, codexLogDir)
      writeFileSync(
        launcherScriptPath,
        realCodexLauncherScript({
          binary: realCodexTuiBinary,
          cwd: testRepoPath,
          codexHome,
          logDir: codexLogDir,
          pidFile: codexPidFile
        })
      )
      writeFileSync(floodScriptPath, backgroundFloodScript(runId))

      const backgroundPtyIds: string[] = []
      let foregroundCommandSent = false
      try {
        await sendToTerminal(
          orcaPage,
          foregroundPtyId,
          `node ${JSON.stringify(launcherScriptPath)}\r`
        )
        foregroundCommandSent = true
        await waitForAnyVisibleTerminalText(
          orcaPage,
          ['OpenAI Codex', 'context left', REAL_CODEX_INPUT_MARKER],
          25_000
        )

        backgroundPtyIds.push(
          ...(await createHiddenFloodTerminals(orcaPage, BACKGROUND_FLOOD_TAB_COUNT))
        )
        await orcaPage.waitForTimeout(250)
        for (const backgroundPtyId of backgroundPtyIds) {
          await sendToTerminal(
            orcaPage,
            backgroundPtyId,
            `node ${JSON.stringify(floodScriptPath)}\r`
          )
        }
        await orcaPage.waitForTimeout(500)

        await focusActiveTerminalInput(orcaPage)
        await startTerminalSampler(orcaPage)

        const keyTimes: number[] = []
        for (const char of CODEX_LIKE_KEY_SAMPLES) {
          keyTimes.push(await orcaPage.evaluate(() => performance.now()))
          await orcaPage.keyboard.type(char)
          await orcaPage.waitForTimeout(CODEX_LIKE_KEY_INTERVAL_MS)
        }

        await orcaPage.waitForTimeout(1_500)
        const samples = await stopTerminalSampler(orcaPage)
        const latencies: number[] = []
        const missingPrefixes: string[] = []
        for (const [index] of [...CODEX_LIKE_KEY_SAMPLES].entries()) {
          const prefix = CODEX_LIKE_KEY_SAMPLES.slice(0, index + 1)
          const latency = firstVisibleTextLatency(
            samples,
            keyTimes[index] ?? 0,
            `${REAL_CODEX_INPUT_MARKER}${prefix}`
          )
          if (latency === null) {
            missingPrefixes.push(prefix)
          } else {
            latencies.push(latency)
          }
        }

        const medianLatency = median(latencies)
        const worstLatency = Math.max(...latencies)
        testInfo.annotations.push({
          type: 'real-codex-hidden-flood-typing-latency',
          description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(
            1
          )}ms samples=${latencies.map((value) => value.toFixed(1)).join(',')} missing=${missingPrefixes.join(',')}`
        })
        console.log(
          `[terminal-typing-latency] real-codex hidden-flood median=${medianLatency.toFixed(
            1
          )}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
            .map((value) => value.toFixed(1))
            .join(',')}`
        )

        expect(missingPrefixes).toEqual([])
        expect(medianLatency).toBeLessThan(MAX_CODEX_LIKE_MEDIAN_KEY_LATENCY_MS)
        expect(worstLatency).toBeLessThan(MAX_CODEX_LIKE_WORST_KEY_LATENCY_MS)
      } finally {
        await stopTerminalSampler(orcaPage).catch(() => [])
        for (const backgroundPtyId of backgroundPtyIds) {
          await sendToTerminal(orcaPage, backgroundPtyId, '\x03').catch(() => undefined)
        }
        if (foregroundCommandSent) {
          await sendToTerminal(orcaPage, foregroundPtyId, '\x03\x03').catch(() => undefined)
        }
        terminateProcessFromPidFile(codexPidFile)
        await orcaPage.waitForTimeout(250).catch(() => undefined)
        removePathBestEffort(launcherScriptPath)
        removePathBestEffort(floodScriptPath)
        removePathBestEffort(codexHome, true)
      }
    })
  })
})
