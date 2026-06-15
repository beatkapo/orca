// Gitea task-source integration types. Mirrors the Jira multi-site credential
// model (jira-types.ts), but Gitea issues are repo-scoped on a self-hosted
// server, so a stored server is keyed by host and resolved from a repo remote.

export type GiteaServer = {
  id: string
  // Web base URL shown in the UI, e.g. https://gitea.example.com
  baseUrl: string
  // API base URL used for requests, e.g. https://gitea.example.com/api/v1
  apiBaseUrl: string
  displayName: string
  account: string | null
}

export type GiteaViewer = {
  login: string
  fullName: string | null
  avatarUrl?: string
}

// A specific stored server id, or 'all' to fan a read across every server.
export type GiteaServerSelection = string | 'all'

export type GiteaConnectionStatus = {
  connected: boolean
  servers?: GiteaServer[]
  activeServerId?: string | null
  selectedServerId?: GiteaServerSelection | null
  // Set when a stored token file exists but could not be decrypted, so the UI
  // can explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type GiteaConnectArgs = {
  baseUrl: string
  token: string
}

export type GiteaUser = {
  id: number
  login: string
  fullName?: string
  avatarUrl?: string
}

export type GiteaLabel = {
  id: number
  name: string
  color?: string
}

export type GiteaIssue = {
  id: number
  number: number
  serverId?: string
  serverName?: string
  repoOwner: string
  repoName: string
  title: string
  // Raw Markdown body as returned by Gitea.
  body?: string
  state: 'open' | 'closed'
  url: string
  labels: string[]
  assignees: GiteaUser[]
  author?: GiteaUser
  milestone?: string
  comments: number
  updatedAt: string
  createdAt: string
}

export type GiteaComment = {
  id: number
  body: string
  createdAt: string
  updatedAt?: string
  user?: GiteaUser
}

export type GiteaIssueUpdate = {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  labelIds?: number[]
  assignees?: string[]
}

export type GiteaIssueFilter = 'assigned' | 'created' | 'all' | 'closed'

export type GiteaCreateIssueArgs = {
  serverId?: string
  repoOwner: string
  repoName: string
  title: string
  body?: string
  assignees?: string[]
  labelIds?: number[]
}

export type GiteaCreateIssueResult =
  | { ok: true; id: number; number: number; url: string }
  | { ok: false; error: string }

export type GiteaMutationResult = { ok: true } | { ok: false; error: string }
