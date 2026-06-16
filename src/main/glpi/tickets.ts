import type {
  GlpiCreateTicketArgs,
  GlpiCreateTicketResult,
  GlpiFollowup,
  GlpiMutationResult,
  GlpiServer,
  GlpiTicket,
  GlpiTicketFilter,
  GlpiTicketUpdate,
  GlpiUser
} from '../../shared/types'
import { acquire, glpiServerRequest, release, type GlpiFullSession } from './session'
import {
  glpiStatusToCode,
  glpiTicketUrl,
  glpiTypeToCode,
  mapGlpiFollowup,
  mapGlpiSearchRow,
  mapGlpiTicketDetail,
  mapGlpiUser,
  type RawGlpiFollowup,
  type RawGlpiTicket,
  type RawGlpiUser
} from './mappers'

// Search-option field ids for Ticket (verified against the live GLPI schema).
const FIELD = {
  title: 1,
  id: 2,
  priority: 3,
  requester: 4,
  technician: 5,
  urgency: 10,
  status: 12,
  type: 14,
  openDate: 15,
  updateDate: 19,
  followupCount: 27
} as const

const FORCE_DISPLAY = [
  FIELD.id,
  FIELD.title,
  FIELD.priority,
  FIELD.urgency,
  FIELD.status,
  FIELD.type,
  FIELD.openDate,
  FIELD.updateDate,
  FIELD.followupCount
]

type SearchCriterion = { link?: 'AND' | 'OR'; field: number; searchtype: string; value: string }

function buildSearchQuery(criteria: SearchCriterion[], limit: number): string {
  const parts: string[] = []
  criteria.forEach((criterion, index) => {
    if (criterion.link) {
      parts.push(`criteria[${index}][link]=${criterion.link}`)
    }
    parts.push(`criteria[${index}][field]=${criterion.field}`)
    parts.push(`criteria[${index}][searchtype]=${criterion.searchtype}`)
    parts.push(`criteria[${index}][value]=${encodeURIComponent(criterion.value)}`)
  })
  FORCE_DISPLAY.forEach((field, index) => {
    parts.push(`forcedisplay[${index}]=${field}`)
  })
  // Why: raw values keep status/type numeric (expand would localize them and
  // break the int→key mapping). Sort by last update, newest first.
  parts.push('expand_dropdowns=0')
  parts.push(`sort=${FIELD.updateDate}`)
  parts.push('order=DESC')
  parts.push(`range=0-${Math.max(0, limit - 1)}`)
  return parts.join('&')
}

async function resolveViewerId(server: GlpiServer): Promise<number> {
  const data = await glpiServerRequest<{ session?: Partial<GlpiFullSession> }>(
    server,
    '/getFullSession'
  )
  const id = data.session?.glpiID
  return typeof id === 'number' ? id : 0
}

function filterCriteria(filter: GlpiTicketFilter, viewerId: number): SearchCriterion[] {
  // GLPI status pseudo-values: `notold` = open (new..pending), `old` = solved+closed.
  const statusValue = filter === 'closed' ? 'old' : 'notold'
  const criteria: SearchCriterion[] = [
    { field: FIELD.status, searchtype: 'equals', value: statusValue }
  ]
  if (filter === 'assigned') {
    criteria.push({
      link: 'AND',
      field: FIELD.technician,
      searchtype: 'equals',
      value: String(viewerId)
    })
  } else if (filter === 'created') {
    criteria.push({
      link: 'AND',
      field: FIELD.requester,
      searchtype: 'equals',
      value: String(viewerId)
    })
  }
  return criteria
}

export async function listGlpiTickets(
  server: GlpiServer,
  filter: GlpiTicketFilter,
  limit: number
): Promise<GlpiTicket[]> {
  await acquire()
  try {
    const viewerId =
      filter === 'assigned' || filter === 'created' ? await resolveViewerId(server) : 0
    const query = buildSearchQuery(filterCriteria(filter, viewerId), limit)
    const result = await glpiServerRequest<{ data?: Record<string, unknown>[] }>(
      server,
      `/search/Ticket?${query}`
    )
    const rows = Array.isArray(result.data) ? result.data : []
    return rows.map((row) => mapGlpiSearchRow(row, server))
  } finally {
    release()
  }
}

// Ticket_User links carry a type: 1 requester, 2 assigned technician, 3 watcher.
type RawTicketUser = { users_id?: number; type?: number }

async function resolveUsers(server: GlpiServer, ids: number[]): Promise<Map<number, GlpiUser>> {
  const unique = [...new Set(ids.filter((id) => id > 0))]
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        const raw = await glpiServerRequest<RawGlpiUser>(server, `/User/${id}`)
        const user = mapGlpiUser(raw)
        return user ? ([id, user] as const) : null
      } catch {
        return null
      }
    })
  )
  return new Map(entries.filter((entry): entry is readonly [number, GlpiUser] => entry !== null))
}

export async function getGlpiTicket(server: GlpiServer, id: number): Promise<GlpiTicket | null> {
  await acquire()
  try {
    const raw = await glpiServerRequest<RawGlpiTicket>(
      server,
      `/Ticket/${id}?expand_dropdowns=true`
    )
    if (typeof raw.id !== 'number') {
      return null
    }
    const ticket = mapGlpiTicketDetail(raw, server)
    const links = await glpiServerRequest<RawTicketUser[]>(server, `/Ticket/${id}/Ticket_User`)
    const userLinks = Array.isArray(links) ? links : []
    const users = await resolveUsers(
      server,
      userLinks.map((link) => link.users_id ?? 0)
    )
    ticket.requester = userLinks
      .filter((link) => link.type === 1)
      .map((link) => users.get(link.users_id ?? 0))
      .find((user): user is GlpiUser => user !== undefined)
    ticket.assignees = userLinks
      .filter((link) => link.type === 2)
      .map((link) => users.get(link.users_id ?? 0))
      .filter((user): user is GlpiUser => user !== undefined)
    return ticket
  } finally {
    release()
  }
}

export async function listGlpiFollowups(server: GlpiServer, id: number): Promise<GlpiFollowup[]> {
  await acquire()
  try {
    const raw = await glpiServerRequest<RawGlpiFollowup[]>(server, `/Ticket/${id}/ITILFollowup`)
    const followups = Array.isArray(raw) ? raw : []
    const users = await resolveUsers(
      server,
      followups.map((followup) => followup.users_id ?? 0)
    )
    return followups
      .map((followup) => mapGlpiFollowup(followup, users.get(followup.users_id ?? 0)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } finally {
    release()
  }
}

export async function addGlpiFollowup(
  server: GlpiServer,
  id: number,
  content: string
): Promise<GlpiMutationResult> {
  await acquire()
  try {
    await glpiServerRequest(server, '/ITILFollowup', {
      method: 'POST',
      body: JSON.stringify({ input: { itemtype: 'Ticket', items_id: id, content } })
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to add followup.' }
  } finally {
    release()
  }
}

export async function updateGlpiTicket(
  server: GlpiServer,
  id: number,
  updates: GlpiTicketUpdate
): Promise<GlpiMutationResult> {
  const input: Record<string, unknown> = {}
  if (updates.title !== undefined) {
    input.name = updates.title
  }
  if (updates.content !== undefined) {
    input.content = updates.content
  }
  if (updates.status !== undefined) {
    input.status = glpiStatusToCode(updates.status)
  }
  if (Object.keys(input).length === 0) {
    return { ok: true }
  }
  await acquire()
  try {
    await glpiServerRequest(server, `/Ticket/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ input })
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to update ticket.' }
  } finally {
    release()
  }
}

export async function createGlpiTicket(
  server: GlpiServer,
  args: GlpiCreateTicketArgs
): Promise<GlpiCreateTicketResult> {
  await acquire()
  try {
    const input: Record<string, unknown> = {
      name: args.title,
      content: args.content ?? '',
      type: glpiTypeToCode(args.type ?? 'incident')
    }
    if (typeof args.urgency === 'number') {
      input.urgency = args.urgency
    }
    const created = await glpiServerRequest<{ id?: number } | { id?: number }[]>(
      server,
      '/Ticket',
      {
        method: 'POST',
        body: JSON.stringify({ input })
      }
    )
    const record = Array.isArray(created) ? created[0] : created
    const newId = typeof record?.id === 'number' ? record.id : 0
    if (!newId) {
      return { ok: false, error: 'GLPI did not return the new ticket id.' }
    }
    return { ok: true, id: newId, url: glpiTicketUrl(server.baseUrl, newId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create ticket.' }
  } finally {
    release()
  }
}
