import type { ElectronApplication } from '@stablyai/playwright-test'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'

type HookEndpoint = {
  port: string
  token: string
  env: string
  version: string
}

function findEndpointEnvFile(root: string): string | null {
  if (!existsSync(root)) {
    return null
  }
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile() && entry.name === 'endpoint.env') {
      return fullPath
    }
    if (entry.isDirectory()) {
      const nested = findEndpointEnvFile(fullPath)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function parseEndpointEnv(contents: string): HookEndpoint {
  const values = Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.replace(/^set\s+/, '').split('=')
        return [key, rest.join('=')]
      })
  )
  if (
    !values.ORCA_AGENT_HOOK_PORT ||
    !values.ORCA_AGENT_HOOK_TOKEN ||
    !values.ORCA_AGENT_HOOK_ENV ||
    !values.ORCA_AGENT_HOOK_VERSION
  ) {
    throw new Error('Agent hook endpoint file is missing required fields')
  }
  return {
    port: values.ORCA_AGENT_HOOK_PORT,
    token: values.ORCA_AGENT_HOOK_TOKEN,
    env: values.ORCA_AGENT_HOOK_ENV,
    version: values.ORCA_AGENT_HOOK_VERSION
  }
}

export async function readHookEndpoint(app: ElectronApplication): Promise<HookEndpoint> {
  const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const hookRoot = path.join(userDataPath, 'agent-hooks')
  const endpointPath = findEndpointEnvFile(hookRoot)
  if (!endpointPath) {
    throw new Error(`Agent hook endpoint.env not found under ${hookRoot}`)
  }
  return parseEndpointEnv(readFileSync(endpointPath, 'utf8'))
}

export async function emitCodexHookStatus(
  endpoint: HookEndpoint,
  status: {
    paneKey: string
    worktreeId: string
    state: 'working' | 'done'
    prompt?: string
    lastAssistantMessage?: string
  }
): Promise<void> {
  const [tabId] = status.paneKey.split(':')
  const payload =
    status.state === 'working'
      ? {
          hook_event_name: 'UserPromptSubmit',
          prompt: status.prompt
        }
      : {
          hook_event_name: 'Stop',
          last_assistant_message: status.lastAssistantMessage
        }
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/codex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': endpoint.token
    },
    body: JSON.stringify({
      paneKey: status.paneKey,
      tabId,
      worktreeId: status.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload
    })
  })
  if (response.status !== 204) {
    throw new Error(`Codex hook POST returned ${response.status}`)
  }
}
