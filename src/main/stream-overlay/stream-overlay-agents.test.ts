import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { STREAM_OVERLAY_DONE_LINGER_MS, projectStreamOverlayAgents } from './stream-overlay-agents'

function row(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    state: 'working',
    prompt: 'secret prompt with /home/me/project',
    paneKey: 'pane-1',
    connectionId: null,
    receivedAt: 0,
    stateStartedAt: 1_000,
    ...overrides
  }
}

describe('projectStreamOverlayAgents', () => {
  const now = 100_000

  it('keeps only stream-safe fields', () => {
    const [agent] = projectStreamOverlayAgents(
      [row({ agentType: 'claude', toolName: 'Edit', toolInput: '/home/me/.env' })],
      now
    )
    expect(agent).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{12}$/),
      agent: 'claude',
      state: 'working',
      tool: 'Edit',
      since: 1_000
    })
    expect(JSON.stringify(agent)).not.toMatch(/secret|home|pane-1/)
  })

  it('orders attention first, labels unknown agents, and hides tools outside work', () => {
    const agents = projectStreamOverlayAgents(
      [
        row({ paneKey: 'a', state: 'working', stateStartedAt: 5 }),
        row({ paneKey: 'b', state: 'done', stateStartedAt: now - 1, toolName: 'Bash' }),
        row({ paneKey: 'c', state: 'blocked', agentType: 'unknown', toolName: 'Bash' })
      ],
      now
    )
    expect(agents.map((a) => [a.state, a.agent, a.tool])).toEqual([
      ['blocked', 'agent', null],
      ['working', 'agent', null],
      ['done', 'agent', null]
    ])
  })

  it('drops finished agents after the linger window', () => {
    const agents = projectStreamOverlayAgents(
      [row({ state: 'done', stateStartedAt: now - STREAM_OVERLAY_DONE_LINGER_MS })],
      now
    )
    expect(agents).toEqual([])
  })
})
