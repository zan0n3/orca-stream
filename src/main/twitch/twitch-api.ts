import { z } from 'zod'

const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device'
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix'
// Why the read scopes: the stream chat dashboard shows who is in chat and the follower count.
export const TWITCH_CHAT_SCOPES = 'user:write:chat moderator:read:chatters moderator:read:followers'
const REQUEST_TIMEOUT_MS = 15_000

export type TwitchFetch = (url: string, init: RequestInit) => Promise<Response>

/** A Twitch API failure; `status` is the HTTP status, 0 for a network error. */
export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

const errorBodySchema = z.object({ message: z.string() }).partial()

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.number(),
  interval: z.number()
})
export type TwitchDeviceCode = z.infer<typeof deviceCodeSchema>

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number()
})
export type TwitchTokens = { accessToken: string; refreshToken: string; expiresAt: number }

const validateSchema = z.object({ login: z.string(), user_id: z.string() })
const usersSchema = z.object({ data: z.array(z.object({ id: z.string(), login: z.string() })) })
const sendSchema = z.object({
  data: z.array(
    z.object({
      is_sent: z.boolean(),
      drop_reason: z.object({ message: z.string() }).nullish()
    })
  )
})

async function request<T>(
  fetch: TwitchFetch,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new TwitchApiError(
      `Could not reach Twitch: ${error instanceof Error ? error.message : String(error)}`,
      0
    )
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = errorBodySchema.safeParse(body).data?.message
    throw new TwitchApiError(message || `Twitch returned HTTP ${response.status}`, response.status)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new TwitchApiError('Twitch sent an unexpected response.', response.status)
  }
  return parsed.data
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  }
}

function toTokens(raw: z.infer<typeof tokenSchema>, now: number): TwitchTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: now + raw.expires_in * 1000
  }
}

export function requestTwitchDeviceCode(
  fetch: TwitchFetch,
  clientId: string
): Promise<TwitchDeviceCode> {
  return request(
    fetch,
    TWITCH_DEVICE_URL,
    form({ client_id: clientId, scopes: TWITCH_CHAT_SCOPES }),
    deviceCodeSchema
  )
}

/** Null while the user has not approved the code yet. */
export async function pollTwitchDeviceToken(
  fetch: TwitchFetch,
  clientId: string,
  deviceCode: string,
  now: number
): Promise<TwitchTokens | null> {
  try {
    const raw = await request(
      fetch,
      TWITCH_TOKEN_URL,
      form({
        client_id: clientId,
        scopes: TWITCH_CHAT_SCOPES,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }),
      tokenSchema
    )
    return toTokens(raw, now)
  } catch (error) {
    if (error instanceof TwitchApiError && error.message === 'authorization_pending') {
      return null
    }
    throw error
  }
}

// Why no client secret: device-code apps are registered as public clients, which refresh without one.
export async function refreshTwitchToken(
  fetch: TwitchFetch,
  clientId: string,
  refreshToken: string,
  now: number
): Promise<TwitchTokens> {
  const raw = await request(
    fetch,
    TWITCH_TOKEN_URL,
    form({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    tokenSchema
  )
  return toTokens(raw, now)
}

export async function validateTwitchToken(
  fetch: TwitchFetch,
  accessToken: string
): Promise<{ login: string; userId: string }> {
  const raw = await request(
    fetch,
    TWITCH_VALIDATE_URL,
    { method: 'GET', headers: { Authorization: `OAuth ${accessToken}` } },
    validateSchema
  )
  return { login: raw.login, userId: raw.user_id }
}

function helixHeaders(clientId: string, accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId }
}

export async function getTwitchUserId(
  fetch: TwitchFetch,
  clientId: string,
  accessToken: string,
  login: string
): Promise<string | null> {
  const raw = await request(
    fetch,
    `${TWITCH_HELIX_URL}/users?login=${encodeURIComponent(login)}`,
    { method: 'GET', headers: helixHeaders(clientId, accessToken) },
    usersSchema
  )
  return raw.data.find((user) => user.login === login)?.id ?? null
}

/** Throws TwitchApiError when Twitch refuses or drops the message (e.g. AutoMod, slow mode). */
export async function sendTwitchChatMessage(
  fetch: TwitchFetch,
  args: { clientId: string; accessToken: string; broadcasterId: string; senderId: string },
  message: string
): Promise<void> {
  const raw = await request(
    fetch,
    `${TWITCH_HELIX_URL}/chat/messages`,
    {
      method: 'POST',
      headers: {
        ...helixHeaders(args.clientId, args.accessToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        broadcaster_id: args.broadcasterId,
        sender_id: args.senderId,
        message
      })
    },
    sendSchema
  )
  const result = raw.data[0]
  if (!result?.is_sent) {
    throw new TwitchApiError(
      result?.drop_reason?.message || 'Twitch did not send the message.',
      200
    )
  }
}

const streamsSchema = z.object({
  data: z.array(
    z.object({
      viewer_count: z.number(),
      started_at: z.string(),
      title: z.string(),
      game_name: z.string()
    })
  )
})
const totalSchema = z.object({ total: z.number() })
const chattersSchema = z.object({
  data: z.array(z.object({ user_login: z.string() })),
  total: z.number()
})

type HelixAuth = { clientId: string; accessToken: string }

function helixGet<T>(
  fetch: TwitchFetch,
  auth: HelixAuth,
  path: string,
  schema: z.ZodType<T>
): Promise<T> {
  return request(
    fetch,
    `${TWITCH_HELIX_URL}${path}`,
    { method: 'GET', headers: helixHeaders(auth.clientId, auth.accessToken) },
    schema
  )
}

/** Null when the channel is offline. */
export async function getTwitchLiveStream(
  fetch: TwitchFetch,
  auth: HelixAuth,
  broadcasterId: string
): Promise<{ viewerCount: number; startedAt: number; title: string; category: string } | null> {
  const raw = await helixGet(
    fetch,
    auth,
    `/streams?user_id=${encodeURIComponent(broadcasterId)}`,
    streamsSchema
  )
  const stream = raw.data[0]
  if (!stream) {
    return null
  }
  const startedAt = Date.parse(stream.started_at)
  return {
    viewerCount: stream.viewer_count,
    startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    title: stream.title,
    category: stream.game_name
  }
}

/** Needs moderator:read:followers as the broadcaster or a moderator. */
export async function getTwitchFollowerCount(
  fetch: TwitchFetch,
  auth: HelixAuth,
  broadcasterId: string
): Promise<number> {
  const raw = await helixGet(
    fetch,
    auth,
    `/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`,
    totalSchema
  )
  return raw.total
}

/** First page (up to 1000) of who is connected to chat; needs moderator:read:chatters. */
export async function getTwitchChatters(
  fetch: TwitchFetch,
  auth: HelixAuth,
  broadcasterId: string,
  moderatorId: string
): Promise<{ total: number; logins: string[] }> {
  const raw = await helixGet(
    fetch,
    auth,
    `/chat/chatters?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}&first=1000`,
    chattersSchema
  )
  return { total: raw.total, logins: raw.data.map((chatter) => chatter.user_login) }
}
