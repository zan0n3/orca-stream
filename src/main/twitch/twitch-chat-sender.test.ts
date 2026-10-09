import { describe, expect, it, vi } from 'vitest'
import type { TwitchChatAuthState } from '../../shared/twitch-chat-types'
import { TwitchChatSender, type StoredTwitchAuth } from './twitch-chat-sender'

type Route = (url: string, init: RequestInit) => { status: number; body: unknown }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

function setup(route: Route, initial: StoredTwitchAuth | null = null) {
  let stored = initial
  let clock = 1_000_000
  const states: TwitchChatAuthState[] = []
  const calls: { url: string; init: RequestInit }[] = []
  const store = {
    read: () => stored,
    save: vi.fn((auth: StoredTwitchAuth) => {
      stored = auth
    }),
    clear: vi.fn(() => {
      stored = null
    })
  }
  const sender = new TwitchChatSender({
    fetch: async (url, init) => {
      calls.push({ url, init })
      const { status, body } = route(url, init)
      return json(status, body)
    },
    store,
    getClientId: () => 'client123',
    getChannel: () => 'somechannel',
    onChange: (state) => states.push(state),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    }
  })
  return {
    sender,
    states,
    calls,
    store,
    stored: () => stored,
    advance: (ms: number) => {
      clock += ms
    }
  }
}

const signedIn: StoredTwitchAuth = {
  clientId: 'client123',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_000_000 + 3_600_000,
  login: 'streamer',
  userId: '42'
}

const sentOk = { status: 200, body: { data: [{ message_id: 'm1', is_sent: true }] } }

describe('TwitchChatSender', () => {
  it('signs in with the device code once the user approves it', async () => {
    let polls = 0
    const { sender, states, stored } = setup((url) => {
      if (url.endsWith('/oauth2/device')) {
        return {
          status: 200,
          body: {
            device_code: 'dev',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD-EFGH',
            expires_in: 1800,
            interval: 5
          }
        }
      }
      if (url.endsWith('/oauth2/token')) {
        polls += 1
        return polls < 2
          ? { status: 400, body: { status: 400, message: 'authorization_pending' } }
          : { status: 200, body: { access_token: 'a', refresh_token: 'r', expires_in: 14_000 } }
      }
      return { status: 200, body: { login: 'streamer', user_id: '42', client_id: 'client123' } }
    })

    const pending = await sender.startSignIn()
    expect(pending).toMatchObject({ state: 'pending', userCode: 'ABCD-EFGH' })
    await vi.waitFor(() =>
      expect(sender.getAuthState()).toEqual({ state: 'signed-in', login: 'streamer' })
    )
    expect(stored()).toMatchObject({ accessToken: 'a', refreshToken: 'r', userId: '42' })
    expect(states.map((state) => state.state)).toEqual(['pending', 'signed-in'])
  })

  it('reports a missing client ID without calling Twitch', async () => {
    const { sender, calls } = setup(() => ({ status: 500, body: {} }))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test reaches into private options to blank the client ID.
    ;(sender as unknown as { options: { getClientId: () => null } }).options.getClientId = () =>
      null
    expect(await sender.startSignIn()).toMatchObject({ state: 'signed-out' })
    expect(calls).toHaveLength(0)
  })

  it('sends to the signed-in channel owner without a user lookup', async () => {
    const { sender, calls } = setup(() => sentOk, { ...signedIn, login: 'somechannel' })
    expect(await sender.send('  hello chat  ')).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      broadcaster_id: '42',
      sender_id: '42',
      message: 'hello chat'
    })
  })

  it('looks up another channel once and caches it', async () => {
    const { sender, calls } = setup(
      (url) =>
        url.includes('/helix/users')
          ? { status: 200, body: { data: [{ id: '7', login: 'somechannel' }] } }
          : sentOk,
      signedIn
    )
    await sender.send('one')
    await sender.send('two')
    expect(calls.filter((call) => call.url.includes('/helix/users'))).toHaveLength(1)
  })

  it('refreshes an expired token before sending', async () => {
    const { sender, stored, advance } = setup(
      (url) =>
        url.endsWith('/oauth2/token')
          ? {
              status: 200,
              body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 14_000 }
            }
          : url.includes('/helix/users')
            ? { status: 200, body: { data: [{ id: '7', login: 'somechannel' }] } }
            : sentOk,
      signedIn
    )
    advance(3_600_000)
    expect(await sender.send('hi')).toEqual({ ok: true })
    expect(stored()?.accessToken).toBe('access-2')
  })

  it('retries once with a refreshed token after a 401', async () => {
    let sends = 0
    const { sender } = setup(
      (url) => {
        if (url.endsWith('/oauth2/token')) {
          return {
            status: 200,
            body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 14_000 }
          }
        }
        sends += 1
        return sends === 1 ? { status: 401, body: { message: 'Invalid OAuth token' } } : sentOk
      },
      { ...signedIn, login: 'somechannel' }
    )
    expect(await sender.send('hi')).toEqual({ ok: true })
    expect(sends).toBe(2)
  })

  it('signs out when the refresh token is dead', async () => {
    const { sender, store, advance } = setup(
      () => ({ status: 400, body: { message: 'Invalid refresh token' } }),
      signedIn
    )
    advance(3_600_000)
    const result = await sender.send('hi')
    expect(result.ok).toBe(false)
    expect(sender.getAuthState().state).toBe('signed-out')
    expect(store.clear).toHaveBeenCalled()
  })

  it('surfaces a dropped message reason', async () => {
    const { sender } = setup(
      () => ({
        status: 200,
        body: {
          data: [
            {
              message_id: '',
              is_sent: false,
              drop_reason: { code: 'x', message: 'Slow mode is on.' }
            }
          ]
        }
      }),
      { ...signedIn, login: 'somechannel' }
    )
    expect(await sender.send('hi')).toEqual({ ok: false, error: 'Slow mode is on.' })
  })

  it('refuses empty, too long, and signed-out sends locally', async () => {
    const { sender, calls } = setup(() => sentOk)
    expect((await sender.send('   ')).ok).toBe(false)
    expect((await sender.send('x'.repeat(501))).ok).toBe(false)
    expect((await sender.send('hi')).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
