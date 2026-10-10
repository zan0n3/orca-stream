import { describe, expect, it } from 'vitest'
import { TwitchChatEngagement, isTwitchAssistantMessage } from './twitch-chat-engagement'
import type { TwitchChatMessage, TwitchChatSnapshot } from './twitch-chat-types'

const viewer = (id: string, at: number): TwitchChatMessage => ({
  id,
  login: 'viewer',
  displayName: 'Viewer',
  text: 'hey!',
  sentAt: at,
  color: null,
  isAction: false
})
const snapshot = (
  messages: TwitchChatMessage[],
  status: TwitchChatSnapshot['status'] = 'connected'
): TwitchChatSnapshot => ({
  revision: 1,
  channel: 'zan0n3',
  status,
  messages
})
const idle = { active: false, at: 0 }

describe('Twitch chat engagement', () => {
  it('skips history and gives the streamer time to answer new messages', () => {
    const policy = new TwitchChatEngagement()
    const old = viewer('old', 100_000)
    const fresh = viewer('new', 101_000)
    policy.observe(snapshot([old]), idle, 100_000)
    expect(policy.take(100_000)).toEqual([])
    policy.observe(snapshot([old, fresh]), idle, 101_000)
    expect(policy.take(108_999)).toEqual([])
    expect(policy.take(109_000)).toEqual([fresh])
    expect(policy.take(109_001)).toEqual([])
  })

  it('withholds a drafted reply on typing and drops messages throughout the conversation', () => {
    const policy = new TwitchChatEngagement()
    policy.observe(snapshot([]), idle, 100_000)
    policy.observe(snapshot([viewer('1', 101_000)]), idle, 101_000)
    expect(policy.take(109_000)).toHaveLength(1)
    policy.observe(snapshot([viewer('1', 101_000)]), { active: true, at: 109_500 }, 109_500)
    expect(policy.canSend()).toBe(false)
    policy.observe(
      snapshot([viewer('1', 101_000), viewer('2', 120_000)]),
      { active: false, at: 109_500 },
      120_000
    )
    policy.observe(snapshot([viewer('2', 120_000)]), { active: false, at: 109_500 }, 209_999)
    expect(policy.canSend()).toBe(false)
    policy.observe(snapshot([viewer('2', 120_000)]), { active: false, at: 109_500 }, 210_000)
    expect(policy.canSend()).toBe(true)
    expect(policy.take(210_000)).toEqual([])
    const next = viewer('3', 211_000)
    policy.observe(snapshot([next]), { active: false, at: 109_500 }, 211_000)
    expect(policy.take(219_000)).toEqual([next])
  })

  it('detects sent human messages from another client, but never replies to itself', () => {
    const policy = new TwitchChatEngagement()
    policy.observe(snapshot([]), idle, 100_000)
    policy.observe(
      snapshot([{ ...viewer('1', 101_000), login: 'zan0n3', text: '[Orca AI] @viewer hi!' }]),
      idle,
      101_000
    )
    expect(policy.canSend()).toBe(true)
    expect(policy.take(110_000)).toEqual([])
    policy.observe(
      snapshot([{ ...viewer('2', 111_000), login: 'zan0n3', text: 'hey man' }]),
      idle,
      111_000
    )
    expect(policy.canSend()).toBe(false)
  })

  it('does not let a cleared draft immediately resume replies', () => {
    const policy = new TwitchChatEngagement()
    policy.observe(snapshot([]), idle, 100_000)
    policy.observe(snapshot([]), { active: false, at: 100_500 }, 101_000)
    expect(policy.canSend()).toBe(false)
    policy.observe(snapshot([]), { active: false, at: 100_500 }, 190_999)
    expect(policy.canSend()).toBe(false)
  })

  it('drops disconnected and stale messages, and spaces out replies', () => {
    const policy = new TwitchChatEngagement()
    policy.observe(snapshot([]), idle, 100_000)
    policy.observe(snapshot([viewer('1', 101_000)]), idle, 101_000)
    policy.observe(snapshot([viewer('1', 101_000)], 'reconnecting'), idle, 102_000)
    expect(policy.take(110_000)).toEqual([])
    policy.observe(snapshot([viewer('old', 1)]), idle, 110_000)
    expect(policy.take(119_000)).toEqual([])
    policy.sent(120_000)
    const next = viewer('2', 121_000)
    policy.observe(snapshot([next]), idle, 121_000)
    expect(policy.take(139_999)).toEqual([])
    expect(policy.take(140_000)).toEqual([next])
  })

  it('recognizes the assistant marker only on the channel owner’s messages', () => {
    expect(isTwitchAssistantMessage('Zan0n3', '[Orca AI] hello', 'zan0n3')).toBe(true)
    expect(isTwitchAssistantMessage('viewer', '[Orca AI] hello', 'zan0n3')).toBe(false)
    expect(isTwitchAssistantMessage('zan0n3', 'hello', 'zan0n3')).toBe(false)
  })
})
