import { BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'
import type { Store } from '../persistence'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TwitchChatSnapshot } from '../../shared/twitch-chat-types'
import { normalizeTwitchChannel } from '../../shared/twitch-chat-channel'
import { TwitchChatClient, type TwitchChatSocketFactory } from '../twitch/twitch-chat-client'

// Why: busy channels post many lines per second; coalesce into one full snapshot per window.
const BROADCAST_THROTTLE_MS = 100

let client: TwitchChatClient | null = null
let unsubscribeSettings: (() => void) | null = null
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
const snapshotListeners = new Set<(snapshot: TwitchChatSnapshot) => void>()

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

function broadcastSnapshot(snapshot: TwitchChatSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('twitchChat:changed', snapshot)
    }
  }
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
    }
  })

  ipcMain.removeHandler('twitchChat:getSnapshot')
  ipcMain.handle('twitchChat:getSnapshot', (): TwitchChatSnapshot => chat.getSnapshot())
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
}
