import { BrowserWindow, ipcMain, net } from 'electron'
import WebSocket from 'ws'
import type { Store } from '../persistence'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type {
  TwitchChatAuthState,
  TwitchChatSendResult,
  TwitchChatSnapshot,
  TwitchStreamStats
} from '../../shared/twitch-chat-types'
import { normalizeTwitchChannel } from '../../shared/twitch-chat-channel'
import { TwitchChatClient, type TwitchChatSocketFactory } from '../twitch/twitch-chat-client'
import { TwitchChatSender } from '../twitch/twitch-chat-sender'
import { twitchAuthFileStore } from '../twitch/twitch-auth-store'

// Why: busy channels post many lines per second; coalesce into one full snapshot per window.
const BROADCAST_THROTTLE_MS = 100
// Why: Twitch's viewer count itself only updates every minute or so.
const STATS_POLL_MS = 30_000

let client: TwitchChatClient | null = null
let sender: TwitchChatSender | null = null
let unsubscribeSettings: (() => void) | null = null
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
const snapshotListeners = new Set<(snapshot: TwitchChatSnapshot) => void>()
let stats: TwitchStreamStats | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null
let statsGeneration = 0
const statsListeners = new Set<(stats: TwitchStreamStats | null) => void>()

export function getTwitchStreamStats(): TwitchStreamStats | null {
  return stats
}

/** Viewer/follower/chatter numbers for the stream chat dashboard; null while signed out. */
export function subscribeTwitchStreamStats(
  listener: (stats: TwitchStreamStats | null) => void
): () => void {
  statsListeners.add(listener)
  return () => {
    statsListeners.delete(listener)
  }
}

function setStats(next: TwitchStreamStats | null): void {
  stats = next
  for (const listener of statsListeners) {
    listener(next)
  }
}

async function refreshStats(): Promise<void> {
  const generation = ++statsGeneration
  try {
    const next = (await sender?.fetchStats()) ?? null
    if (generation === statsGeneration) {
      setStats(next)
    }
  } catch (error) {
    // Why keep the last numbers: one failed poll should not blank the dashboard mid-stream.
    console.warn(
      '[twitch-chat] could not refresh stream stats:',
      error instanceof Error ? error.message : error
    )
  }
}

export function getTwitchChatSnapshot(): TwitchChatSnapshot | null {
  return client?.getSnapshot() ?? null
}

/** Throttled like the renderer broadcast; used by the stream overlay server. */
export function subscribeTwitchChatSnapshots(
  listener: (snapshot: TwitchChatSnapshot) => void
): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}

export function getTwitchChatChannelFromSettings(
  settings: Pick<GlobalSettings, 'experimentalTwitchChat' | 'twitchChatChannel'>
): string | null {
  return settings.experimentalTwitchChat === true
    ? normalizeTwitchChannel(settings.twitchChatChannel)
    : null
}

const createWsSocket: TwitchChatSocketFactory = (url, handlers) => {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    handshakeTimeout: 15_000,
    maxPayload: 1024 * 1024
  })
  socket.on('open', handlers.onOpen)
  socket.on('message', (raw, isBinary) => {
    if (!isBinary) {
      handlers.onMessage(raw.toString())
    }
  })
  // Why: ws always follows 'error' with 'close', which owns reconnects; an unhandled 'error' would crash main.
  socket.on('error', () => {})
  socket.once('close', handlers.onClose)
  return {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data)
      }
    },
    close: () => socket.terminate()
  }
}

// Why all windows: the stream chat window shows its own composer and needs auth changes too.
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function broadcastSnapshot(snapshot: TwitchChatSnapshot): void {
  broadcast('twitchChat:changed', snapshot)
}

function scheduleBroadcast(): void {
  if (broadcastTimer) {
    return
  }
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    if (client) {
      const snapshot = client.getSnapshot()
      broadcastSnapshot(snapshot)
      for (const listener of snapshotListeners) {
        listener(snapshot)
      }
    }
  }, BROADCAST_THROTTLE_MS)
  broadcastTimer.unref?.()
}

export function registerTwitchChatHandlers(store: Store): void {
  disposeTwitchChat()
  const chat = new TwitchChatClient({ createSocket: createWsSocket, onChange: scheduleBroadcast })
  client = chat
  chat.setChannel(getTwitchChatChannelFromSettings(store.getSettings()))
  unsubscribeSettings = store.onSettingsChanged((updates, settings) => {
    if ('experimentalTwitchChat' in updates || 'twitchChatChannel' in updates) {
      chat.setChannel(getTwitchChatChannelFromSettings(settings))
      setStats(null)
      void refreshStats()
    }
  })

  const chatSender = new TwitchChatSender({
    fetch: (url, init) => net.fetch(url, init),
    store: twitchAuthFileStore,
    getClientId: () => store.getSettings().twitchChatClientId?.trim() || null,
    getChannel: () => getTwitchChatChannelFromSettings(store.getSettings()),
    onChange: (state) => {
      broadcast('twitchChat:authChanged', state)
      if (state.state !== 'pending') {
        void refreshStats()
      }
    }
  })
  sender = chatSender
  void refreshStats()
  statsTimer = setInterval(() => void refreshStats(), STATS_POLL_MS)
  statsTimer.unref?.()

  ipcMain.removeHandler('twitchChat:getSnapshot')
  ipcMain.removeHandler('twitchChat:getAuthState')
  ipcMain.removeHandler('twitchChat:startSignIn')
  ipcMain.removeHandler('twitchChat:cancelSignIn')
  ipcMain.removeHandler('twitchChat:signOut')
  ipcMain.removeHandler('twitchChat:send')
  ipcMain.handle('twitchChat:getSnapshot', (): TwitchChatSnapshot => chat.getSnapshot())
  ipcMain.handle('twitchChat:getAuthState', (): TwitchChatAuthState => chatSender.getAuthState())
  ipcMain.handle('twitchChat:startSignIn', (): Promise<TwitchChatAuthState> =>
    chatSender.startSignIn()
  )
  ipcMain.handle('twitchChat:cancelSignIn', (): TwitchChatAuthState => chatSender.cancelSignIn())
  ipcMain.handle('twitchChat:signOut', (): TwitchChatAuthState => chatSender.signOut())
  ipcMain.handle('twitchChat:send', (_event, text: unknown): Promise<TwitchChatSendResult> =>
    typeof text === 'string'
      ? chatSender.send(text)
      : Promise.resolve({ ok: false, error: 'Type a message first.' })
  )
}

export function disposeTwitchChat(): void {
  unsubscribeSettings?.()
  unsubscribeSettings = null
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
  client?.dispose()
  client = null
  sender?.cancelSignIn()
  sender = null
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
  statsGeneration += 1
  stats = null
}
