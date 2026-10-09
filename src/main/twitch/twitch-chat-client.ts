import { withReconnectJitter } from '../../shared/reconnect-jitter'
import type {
  TwitchChatConnectionStatus,
  TwitchChatMessage,
  TwitchChatSnapshot
} from '../../shared/twitch-chat-types'
import { parseTwitchIrcLine, splitTwitchAction, type TwitchIrcLine } from './twitch-irc-parser'

export const TWITCH_CHAT_URL = 'wss://irc-ws.chat.twitch.tv:443'
export const TWITCH_CHAT_MAX_MESSAGES = 200
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
// Why: Twitch PINGs roughly every 5 minutes; silence well past that means a half-open socket.
const INBOUND_SILENCE_LIMIT_MS = 6 * 60_000

export type TwitchChatSocketHandlers = {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: () => void
}

export type TwitchChatSocket = {
  send: (data: string) => void
  close: () => void
}

export type TwitchChatSocketFactory = (
  url: string,
  handlers: TwitchChatSocketHandlers
) => TwitchChatSocket

type TwitchChatClientOptions = {
  createSocket: TwitchChatSocketFactory
  onChange: () => void
  random?: () => number
  now?: () => number
}

/** Read-only, anonymous Twitch chat connection for one channel at a time. */
export class TwitchChatClient {
  private channel: string | null = null
  private status: TwitchChatConnectionStatus = 'disabled'
  private messages: TwitchChatMessage[] = []
  private revision = 0
  private socket: TwitchChatSocket | null = null
  // Why: a replaced socket can still deliver close/message events; only the current generation counts.
  private generation = 0
  private failedAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private fallbackIdCounter = 0
  private readonly random: () => number
  private readonly now: () => number

  constructor(private readonly options: TwitchChatClientOptions) {
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
  }

  getSnapshot(): TwitchChatSnapshot {
    return {
      revision: this.revision,
      channel: this.channel,
      status: this.status,
      messages: this.messages
    }
  }

  setChannel(channel: string | null): void {
    if (channel === this.channel) {
      return
    }
    this.teardownSocket()
    this.channel = channel
    this.messages = []
    this.failedAttempts = 0
    // Why: reset silently so the connect below always emits, even when switching channels mid-connect.
    this.status = 'disabled'
    if (channel) {
      this.connect()
    } else {
      this.emit()
    }
  }

  dispose(): void {
    this.teardownSocket()
    this.channel = null
    this.status = 'disabled'
  }

  private connect(): void {
    const channel = this.channel
    if (!channel) {
      return
    }
    const generation = ++this.generation
    const isCurrent = (): boolean => generation === this.generation
    this.setStatus(this.failedAttempts === 0 ? 'connecting' : 'reconnecting')
    this.socket = this.options.createSocket(TWITCH_CHAT_URL, {
      onOpen: () => {
        if (!isCurrent()) {
          return
        }
        this.armSilenceTimer()
        // Why: justinfan nicks are Twitch's documented anonymous read-only login; no token needed.
        const nick = `justinfan${10_000 + Math.floor(this.random() * 89_999)}`
        this.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
        this.send('PASS SCHMOOPIIE')
        this.send(`NICK ${nick}`)
        this.send(`JOIN #${channel}`)
      },
      onMessage: (data) => {
        if (!isCurrent()) {
          return
        }
        this.armSilenceTimer()
        for (const raw of data.split('\r\n')) {
          const line = raw ? parseTwitchIrcLine(raw) : null
          if (line) {
            this.handleLine(line)
          }
        }
      },
      onClose: () => {
        if (isCurrent()) {
          this.socket = null
          this.scheduleReconnect()
        }
      }
    })
  }

  private handleLine(line: TwitchIrcLine): void {
    switch (line.command) {
      case 'PING':
        this.send(`PONG :${line.params[0] ?? 'tmi.twitch.tv'}`)
        return
      case 'RECONNECT':
        // Why: Twitch asks clients to reconnect before server maintenance; closing triggers the normal path.
        this.socket?.close()
        return
      case 'ROOMSTATE':
        this.failedAttempts = 0
        this.setStatus('connected')
        return
      case 'PRIVMSG':
        this.addMessage(line)
        return
      case 'CLEARMSG':
        this.removeMessages((message) => message.id === line.tags['target-msg-id'])
        return
      case 'CLEARCHAT': {
        const login = line.params[1]?.toLowerCase()
        this.removeMessages((message) => !login || message.login === login)
      }
    }
  }

  private addMessage(line: TwitchIrcLine): void {
    const login = line.nick?.toLowerCase()
    const rawText = line.params[1]
    if (!login || rawText === undefined) {
      return
    }
    const { text, isAction } = splitTwitchAction(rawText)
    const sentAt = Number(line.tags['tmi-sent-ts'])
    const message: TwitchChatMessage = {
      id: line.tags.id || `local-${++this.fallbackIdCounter}`,
      login,
      displayName: line.tags['display-name'] || login,
      text,
      isAction,
      sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : this.now(),
      color: /^#[0-9a-f]{6}$/i.test(line.tags.color ?? '') ? line.tags.color : null
    }
    const next = [...this.messages, message]
    this.messages =
      next.length > TWITCH_CHAT_MAX_MESSAGES ? next.slice(-TWITCH_CHAT_MAX_MESSAGES) : next
    this.emit()
  }

  private removeMessages(predicate: (message: TwitchChatMessage) => boolean): void {
    const next = this.messages.filter((message) => !predicate(message))
    if (next.length !== this.messages.length) {
      this.messages = next
      this.emit()
    }
  }

  private scheduleReconnect(): void {
    this.clearSilenceTimer()
    if (!this.channel) {
      return
    }
    const ladderIndex = Math.min(this.failedAttempts, RECONNECT_DELAYS_MS.length - 1)
    this.failedAttempts += 1
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null
        this.connect()
      },
      withReconnectJitter(RECONNECT_DELAYS_MS[ladderIndex], this.random)
    )
    this.reconnectTimer.unref?.()
  }

  private armSilenceTimer(): void {
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null
      this.socket?.close()
    }, INBOUND_SILENCE_LIMIT_MS)
    this.silenceTimer.unref?.()
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  private teardownSocket(): void {
    this.generation += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearSilenceTimer()
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private send(data: string): void {
    this.socket?.send(data)
  }

  private setStatus(status: TwitchChatConnectionStatus): void {
    if (status !== this.status) {
      this.status = status
      this.emit()
    }
  }

  private emit(): void {
    this.revision += 1
    this.options.onChange()
  }
}
