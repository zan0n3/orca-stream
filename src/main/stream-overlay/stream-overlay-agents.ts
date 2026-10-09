import { createHash } from 'node:crypto'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { AgentStatusState } from '../../shared/agent-status-types'
import type { StreamOverlayAgent } from '../../shared/stream-overlay'

// Why: finished agents linger briefly so viewers see the "done" moment, then drop off the overlay.
export const STREAM_OVERLAY_DONE_LINGER_MS = 10 * 60_000

const STATE_ORDER: Record<AgentStatusState, number> = {
  blocked: 0,
  waiting: 1,
  working: 2,
  done: 3
}

/** Stream-safe projection: no prompts, tool inputs, paths, or worktree names reach the overlay. */
export function projectStreamOverlayAgents(
  rows: readonly AgentStatusIpcPayload[],
  now: number
): StreamOverlayAgent[] {
  return rows
    .filter(
      (row) => row.state !== 'done' || now - row.stateStartedAt < STREAM_OVERLAY_DONE_LINGER_MS
    )
    .map((row) => ({
      id: createHash('sha256').update(row.paneKey).digest('hex').slice(0, 12),
      agent: row.agentType && row.agentType !== 'unknown' ? row.agentType : 'agent',
      state: row.state,
      tool: row.state === 'working' && row.toolName ? row.toolName : null,
      since: row.stateStartedAt
    }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.since - b.since)
}
