import {
  TWITCH_CHAT_MAX_MESSAGE_LENGTH,
  type TwitchChatAuthState,
  type TwitchChatSendResult,
  type TwitchStreamStats
} from '../../shared/twitch-chat-types'
import {
  TwitchApiError,
  getTwitchChatters,
  getTwitchFollowerCount,
  getTwitchLiveStream,
  getTwitchUserId,
  pollTwitchDeviceToken,
  refreshTwitchToken,
  requestTwitchDeviceCode,
  sendTwitchChatMessage,
  validateTwitchToken,
  type TwitchDeviceCode,
  type TwitchFetch
} from './twitch-api'

// Why: refresh a little early so a token never expires between the check and Twitch reading it.
const TOKEN_EXPIRY_SKEW_MS = 60_000

export type StoredTwitchAuth = {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  login: string
  userId: string
}

export type TwitchAuthStore = {
  read: () => StoredTwitchAuth | null
  save: (auth: StoredTwitchAuth) => void
  clear: () => void
}

type TwitchChatSenderOptions = {
  fetch: TwitchFetch
  store: TwitchAuthStore
  getClientId: () => string | null
  getChannel: () => string | null
  onChange: (state: TwitchChatAuthState) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Signs the streamer in with Twitch's device-code flow and sends chat as them over Helix. */
export class TwitchChatSender {
  private auth: StoredTwitchAuth | null
  private state: TwitchChatAuthState
  // Why: a cancelled or superseded sign-in keeps polling until its sleep ends; only the current one may finish.
  private signInGeneration = 0
  private refreshing: Promise<StoredTwitchAuth> | null = null
  private readonly broadcasterIds = new Map<string, string>()
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: TwitchChatSenderOptions) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.auth = options.store.read()
    this.state = this.auth
      ? { state: 'signed-in', login: this.auth.login }
      : { state: 'signed-out', error: null }
  }

  getAuthState(): TwitchChatAuthState {
    return this.state
  }

  async startSignIn(): Promise<TwitchChatAuthState> {
    const clientId = this.options.getClientId()
    const generation = ++this.signInGeneration
    if (!clientId) {
      this.setState({ state: 'signed-out', error: 'Add your Twitch app Client ID first.' })
      return this.state
    }
    let device: TwitchDeviceCode
    try {
      device = await requestTwitchDeviceCode(this.options.fetch, clientId)
    } catch (error) {
      if (generation === this.signInGeneration) {
        this.setState({ state: 'signed-out', error: errorText(error) })
      }
      return this.state
    }
    if (generation !== this.signInGeneration) {
      return this.state
    }
    const expiresAt = this.now() + device.expires_in * 1000
    this.setState({
      state: 'pending',
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt
    })
    void this.pollSignIn(generation, clientId, device, expiresAt)
    return this.state
  }

  cancelSignIn(): TwitchChatAuthState {
    this.signInGeneration += 1
    if (this.state.state === 'pending') {
      this.setState(this.signedInOrOut(null))
    }
    return this.state
  }

  signOut(): TwitchChatAuthState {
    this.signInGeneration += 1
    this.auth = null
    this.broadcasterIds.clear()
    this.options.store.clear()
    this.setState({ state: 'signed-out', error: null })
    return this.state
  }

  async send(text: string): Promise<TwitchChatSendResult> {
    const message = text.trim()
    if (!message) {
      return { ok: false, error: 'Type a message first.' }
    }
    if (message.length > TWITCH_CHAT_MAX_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: `Messages can be at most ${TWITCH_CHAT_MAX_MESSAGE_LENGTH} characters.`
      }
    }
    if (!this.auth) {
      return { ok: false, error: 'Sign in to Twitch in Orca settings to chat.' }
    }
    const channel = this.options.getChannel()
    if (!channel) {
      return { ok: false, error: 'Set a Twitch channel first.' }
    }
    try {
      await this.withFreshToken(async (auth) => {
        const broadcasterId = await this.resolveBroadcasterId(auth, channel)
        await sendTwitchChatMessage(
          this.options.fetch,
          {
            clientId: auth.clientId,
            accessToken: auth.accessToken,
            broadcasterId,
            senderId: auth.userId
          },
          message
        )
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  }

  /** Null when signed out or no channel is set; throws when Twitch cannot be read. */
  async fetchStats(): Promise<TwitchStreamStats | null> {
    const channel = this.options.getChannel()
    if (!this.auth || !channel) {
      return null
    }
    return this.withFreshToken(async (auth) => {
      const broadcasterId = await this.resolveBroadcasterId(auth, channel)
      const helix = { clientId: auth.clientId, accessToken: auth.accessToken }
      // Why settled: followers/chatters need moderator rights on someone else's channel; still show the rest.
      const [stream, followers, chatters] = await Promise.allSettled([
        getTwitchLiveStream(this.options.fetch, helix, broadcasterId),
        getTwitchFollowerCount(this.options.fetch, helix, broadcasterId),
        getTwitchChatters(this.options.fetch, helix, broadcasterId, auth.userId)
      ])
      if (stream.status === 'rejected') {
        throw stream.reason
      }
      const live = stream.value
      const chatterList = chatters.status === 'fulfilled' ? chatters.value : null
      return {
        channel,
        live: live !== null,
        viewerCount: live?.viewerCount ?? null,
        startedAt: live?.startedAt ?? null,
        title: live?.title ?? null,
        category: live?.category ?? null,
        followerCount: followers.status === 'fulfilled' ? followers.value : null,
        chatterCount: chatterList?.total ?? null,
        chatters: chatterList?.logins ?? null,
        updatedAt: this.now()
      }
    })
  }

  private async pollSignIn(
    generation: number,
    clientId: string,
    device: TwitchDeviceCode,
    expiresAt: number
  ): Promise<void> {
    const isCurrent = (): boolean => generation === this.signInGeneration
    const intervalMs = Math.max(1, device.interval) * 1000
    while (isCurrent()) {
      await this.sleep(intervalMs)
      if (!isCurrent()) {
        return
      }
      if (this.now() >= expiresAt) {
        this.setState(this.signedInOrOut('The sign-in code expired. Try again.'))
        return
      }
      try {
        const tokens = await pollTwitchDeviceToken(
          this.options.fetch,
          clientId,
          device.device_code,
          this.now()
        )
        if (!tokens || !isCurrent()) {
          continue
        }
        const identity = await validateTwitchToken(this.options.fetch, tokens.accessToken)
        if (!isCurrent()) {
          return
        }
        const auth: StoredTwitchAuth = { clientId, ...tokens, ...identity }
        this.auth = auth
        this.broadcasterIds.clear()
        this.options.store.save(auth)
        this.setState({ state: 'signed-in', login: auth.login })
        return
      } catch (error) {
        if (isCurrent()) {
          this.setState(this.signedInOrOut(errorText(error)))
        }
        return
      }
    }
  }

  private async withFreshToken<T>(work: (auth: StoredTwitchAuth) => Promise<T>): Promise<T> {
    const auth = await this.currentAuth(false)
    try {
      return await work(auth)
    } catch (error) {
      // Why: Twitch can revoke a token before its stated expiry (password change, app disconnect).
      if (error instanceof TwitchApiError && error.status === 401) {
        return work(await this.currentAuth(true))
      }
      throw error
    }
  }

  private currentAuth(forceRefresh: boolean): Promise<StoredTwitchAuth> {
    const auth = this.auth
    if (!auth) {
      return Promise.reject(new Error('Sign in to Twitch in Orca settings to chat.'))
    }
    if (!forceRefresh && auth.expiresAt - TOKEN_EXPIRY_SKEW_MS > this.now()) {
      return Promise.resolve(auth)
    }
    this.refreshing ??= this.refresh(auth).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refresh(auth: StoredTwitchAuth): Promise<StoredTwitchAuth> {
    try {
      const tokens = await refreshTwitchToken(
        this.options.fetch,
        auth.clientId,
        auth.refreshToken,
        this.now()
      )
      const next = { ...auth, ...tokens }
      // Why: a sign-out during the refresh must not be undone by its late result.
      if (this.auth === auth) {
        this.auth = next
        this.options.store.save(next)
      }
      return next
    } catch (error) {
      if (error instanceof TwitchApiError && (error.status === 400 || error.status === 401)) {
        const expired = 'Your Twitch sign-in expired. Sign in again in Orca settings.'
        if (this.auth === auth) {
          this.auth = null
          this.options.store.clear()
          this.setState({ state: 'signed-out', error: expired })
        }
        throw new Error(expired)
      }
      throw error
    }
  }

  private async resolveBroadcasterId(auth: StoredTwitchAuth, channel: string): Promise<string> {
    const cached = this.broadcasterIds.get(channel)
    if (cached) {
      return cached
    }
    const id =
      channel === auth.login
        ? auth.userId
        : await getTwitchUserId(this.options.fetch, auth.clientId, auth.accessToken, channel)
    if (!id) {
      throw new Error(`Twitch has no channel named “${channel}”.`)
    }
    this.broadcasterIds.set(channel, id)
    return id
  }

  private signedInOrOut(error: string | null): TwitchChatAuthState {
    return this.auth
      ? { state: 'signed-in', login: this.auth.login }
      : { state: 'signed-out', error }
  }

  private setState(state: TwitchChatAuthState): void {
    this.state = state
    this.options.onChange(state)
  }
}
