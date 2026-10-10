import type { TwitchChatMessage, TwitchChatSnapshot } from './twitch-chat-types'

export const TWITCH_CHAT_ASSISTANT_PREFIX = '[Orca AI] '
export const TWITCH_CHAT_HANDOFF_QUIET_MS = 90_000
const REPLY_GRACE_MS = 8_000
const REPLY_COOLDOWN_MS = 20_000
const MESSAGE_MAX_AGE_MS = 90_000

export function isTwitchAssistantMessage(
  name: string,
  text: string,
  channel: string | null
): boolean {
  return (
    name.toLowerCase() === channel?.toLowerCase() && text.startsWith(TWITCH_CHAT_ASSISTANT_PREFIX)
  )
}

export class TwitchChatEngagement {
  private readonly seen = new Set<string>()
  private pending: TwitchChatMessage[] = []
  private handoff = false
  private conversationAt = 0
  private inputAt = 0
  private repliedAt = 0
  private readyAt = 0
  private initialized = false

  observe(
    snapshot: TwitchChatSnapshot,
    typing: { active: boolean; at: number },
    now: number
  ): void {
    if (!this.initialized) {
      snapshot.messages.forEach((message) => this.seen.add(message.id))
      this.initialized = true
    }
    const fresh = snapshot.messages.filter((message) => !this.seen.has(message.id))
    fresh.forEach((message) => this.seen.add(message.id))
    // Keep only the current reader's bounded history.
    const retained = new Set(snapshot.messages.map((message) => message.id))
    for (const id of this.seen) {
      if (!retained.has(id)) {
        this.seen.delete(id)
      }
    }

    const humanMessage = fresh.some(
      (message) =>
        message.login.toLowerCase() === snapshot.channel &&
        !isTwitchAssistantMessage(message.login, message.text, snapshot.channel)
    )
    if (typing.active || typing.at > this.inputAt || humanMessage) {
      this.handoff = true
      this.conversationAt = now
      this.inputAt = Math.max(this.inputAt, typing.at)
    }
    if (this.handoff) {
      if (fresh.length > 0) {
        this.conversationAt = now
      }
      this.pending = []
      if (!typing.active && now - this.conversationAt >= TWITCH_CHAT_HANDOFF_QUIET_MS) {
        this.handoff = false
      }
      return
    }
    if (snapshot.status !== 'connected') {
      this.pending = []
      return
    }
    for (const message of fresh) {
      if (
        message.login.toLowerCase() === snapshot.channel ||
        message.text.startsWith('!') ||
        now - message.sentAt > MESSAGE_MAX_AGE_MS
      ) {
        continue
      }
      this.pending.push(message)
      this.pending = this.pending.slice(-8)
      this.readyAt = now + REPLY_GRACE_MS
    }
    this.pending = this.pending.filter((message) => now - message.sentAt <= MESSAGE_MAX_AGE_MS)
  }

  take(now: number): TwitchChatMessage[] {
    if (this.handoff || now < this.readyAt || now - this.repliedAt < REPLY_COOLDOWN_MS) {
      return []
    }
    const messages = this.pending
    this.pending = []
    return messages
  }

  canSend(): boolean {
    return !this.handoff
  }

  sent(now: number): void {
    this.repliedAt = now
  }
}
