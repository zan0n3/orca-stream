import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TWITCH_CHAT_MAX_MESSAGES,
  TwitchChatClient,
  type TwitchChatSocketHandlers
} from './twitch-chat-client'

type FakeSocket = {
  handlers: TwitchChatSocketHandlers
  sent: string[]
  closed: boolean
}

function setup() {
  const sockets: FakeSocket[] = []
  const onChange = vi.fn()
  const client = new TwitchChatClient({
    createSocket: (_url, handlers) => {
      const socket: FakeSocket = { handlers, sent: [], closed: false }
      sockets.push(socket)
      return {
        send: (data) => socket.sent.push(data),
        close: () => {
          socket.closed = true
        }
      }
    },
    onChange,
    random: () => 0,
    now: () => 1_000
  })
  const latest = (): FakeSocket => {
    const socket = sockets.at(-1)
    if (!socket) {
      throw new Error('no socket created')
    }
    return socket
  }
  const receive = (...lines: string[]): void => latest().handlers.onMessage(lines.join('\r\n'))
  return { client, sockets, latest, receive, onChange }
}

const privmsg = (id: string, login: string, text: string): string =>
  `@id=${id};display-name=${login.toUpperCase()};tmi-sent-ts=5000 :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #chan :${text}`

describe('TwitchChatClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('joins anonymously and reports connected once the room state arrives', () => {
    const { client, latest, receive } = setup()
    client.setChannel('chan')
    expect(client.getSnapshot()).toMatchObject({ channel: 'chan', status: 'connecting' })

    latest().handlers.onOpen()
    expect(latest().sent).toEqual([
      'CAP REQ :twitch.tv/tags twitch.tv/commands',
      'PASS SCHMOOPIIE',
      'NICK justinfan10000',
      'JOIN #chan'
    ])
    receive('@room-id=1 :tmi.twitch.tv ROOMSTATE #chan')
    expect(client.getSnapshot().status).toBe('connected')
  })

  it('collects messages, answers PING, and applies moderation removals', () => {
    const { client, latest, receive } = setup()
    client.setChannel('chan')
    latest().handlers.onOpen()
    receive(
      privmsg('a', 'alice', 'hello'),
      privmsg('b', 'bob', '\u0001ACTION waves\u0001'),
      privmsg('c', 'alice', 'again'),
      'PING :tmi.twitch.tv'
    )
    expect(latest().sent.at(-1)).toBe('PONG :tmi.twitch.tv')
    expect(client.getSnapshot().messages).toEqual([
      {
        id: 'a',
        login: 'alice',
        displayName: 'ALICE',
        text: 'hello',
        isAction: false,
        sentAt: 5000
      },
      { id: 'b', login: 'bob', displayName: 'BOB', text: 'waves', isAction: true, sentAt: 5000 },
      {
        id: 'c',
        login: 'alice',
        displayName: 'ALICE',
        text: 'again',
        isAction: false,
        sentAt: 5000
      }
    ])

    receive('@target-msg-id=b :tmi.twitch.tv CLEARMSG #chan :waves')
    expect(client.getSnapshot().messages.map((m) => m.id)).toEqual(['a', 'c'])

    receive('@ban-duration=60 :tmi.twitch.tv CLEARCHAT #chan :alice')
    expect(client.getSnapshot().messages).toEqual([])

    receive(privmsg('d', 'carol', 'hi'), ':tmi.twitch.tv CLEARCHAT #chan')
    expect(client.getSnapshot().messages).toEqual([])
  })

  it('keeps only the most recent messages', () => {
    const { client, latest, receive } = setup()
    client.setChannel('chan')
    latest().handlers.onOpen()
    receive(
      ...Array.from({ length: TWITCH_CHAT_MAX_MESSAGES + 5 }, (_, i) =>
        privmsg(`m${i}`, 'x', `${i}`)
      )
    )
    const messages = client.getSnapshot().messages
    expect(messages).toHaveLength(TWITCH_CHAT_MAX_MESSAGES)
    expect(messages[0].id).toBe('m5')
  })

  it('reconnects with backoff after a drop and resets backoff once connected', () => {
    const { client, sockets, latest, receive } = setup()
    client.setChannel('chan')
    latest().handlers.onClose()
    expect(client.getSnapshot().status).toBe('reconnecting')
    expect(sockets).toHaveLength(1)

    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2)
    latest().handlers.onClose()
    vi.advanceTimersByTime(1_999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    latest().handlers.onOpen()
    receive(':tmi.twitch.tv ROOMSTATE #chan')
    latest().handlers.onClose()
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(4)
  })

  it('treats a RECONNECT request and prolonged silence as a dropped socket', () => {
    const { client, latest, receive } = setup()
    client.setChannel('chan')
    latest().handlers.onOpen()
    receive(':tmi.twitch.tv RECONNECT')
    expect(latest().closed).toBe(true)

    const { client: quiet, latest: quietLatest } = setup()
    quiet.setChannel('chan')
    quietLatest().handlers.onOpen()
    vi.advanceTimersByTime(6 * 60_000)
    expect(quietLatest().closed).toBe(true)
    client.dispose()
    quiet.dispose()
  })

  it('ignores events from a replaced socket after switching channels', () => {
    const { client, sockets } = setup()
    client.setChannel('one')
    const old = sockets[0]
    client.setChannel('two')
    expect(old.closed).toBe(true)

    old.handlers.onOpen()
    old.handlers.onMessage(privmsg('x', 'ghost', 'stale'))
    old.handlers.onClose()
    vi.advanceTimersByTime(60_000)

    expect(old.sent).toEqual([])
    expect(sockets).toHaveLength(2)
    expect(client.getSnapshot()).toMatchObject({ channel: 'two', messages: [] })
  })

  it('stops reconnecting and reports disabled when the channel is cleared', () => {
    const { client, sockets, latest, onChange } = setup()
    client.setChannel('chan')
    latest().handlers.onClose()
    const revision = client.getSnapshot().revision
    client.setChannel(null)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
    expect(client.getSnapshot()).toMatchObject({ channel: null, status: 'disabled' })
    expect(client.getSnapshot().revision).toBeGreaterThan(revision)
    expect(onChange).toHaveBeenCalled()
  })
})
