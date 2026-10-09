import { randomBytes } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TwitchChatSnapshot } from '../../shared/twitch-chat-types'
import {
  buildStreamOverlayUrl,
  normalizeStreamOverlayPort,
  type StreamOverlayPage,
  type StreamOverlayStatus
} from '../../shared/stream-overlay'
import { agentHookServer } from '../agent-hooks/server'
import { projectStreamOverlayAgents } from '../stream-overlay/stream-overlay-agents'
import {
  StreamOverlayServer,
  type StreamOverlayChatPayload
} from '../stream-overlay/stream-overlay-server'
import {
  getTwitchChatSnapshot,
  getTwitchStreamStats,
  subscribeTwitchChatSnapshots,
  subscribeTwitchStreamStats
} from './twitch-chat'

const OVERLAY_CHAT_MESSAGE_LIMIT = 50
const AGENT_PUBLISH_THROTTLE_MS = 250
// Why: "done" rows age out by time, not by a hook event, so republish periodically.
const AGENT_REFRESH_MS = 30_000

let teardown: (() => void) | null = null
let readyUrls: ((page: StreamOverlayPage, query?: string) => string | null) | null = null

/** Overlay URL with the live token, or null until the server is listening. */
export function getStreamOverlayUrl(page: StreamOverlayPage, query = ''): string | null {
  return readyUrls?.(page, query) ?? null
}

export function generateStreamOverlayToken(): string {
  return randomBytes(18).toString('base64url')
}

function toChatPayload(snapshot: TwitchChatSnapshot | null): StreamOverlayChatPayload {
  return {
    channel: snapshot?.channel ?? null,
    status: snapshot?.status ?? 'disabled',
    messages: (snapshot?.messages ?? []).slice(-OVERLAY_CHAT_MESSAGE_LIMIT).map((message) => ({
      id: message.id,
      name: message.displayName,
      text: message.text,
      isAction: message.isAction,
      color: message.color
    }))
  }
}

function getAgentsPayload(): { agents: ReturnType<typeof projectStreamOverlayAgents> } {
  return { agents: projectStreamOverlayAgents(agentHookServer.getStatusSnapshot(), Date.now()) }
}

function broadcastStatus(status: StreamOverlayStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('streamOverlay:statusChanged', status)
    }
  }
}

function applySettings(store: Store, overlay: StreamOverlayServer, settings: GlobalSettings): void {
  if (settings.experimentalStreamOverlay !== true) {
    void overlay.stop()
    return
  }
  if (!settings.streamOverlayToken) {
    // Why: the settings listener re-enters with the stored token and starts the server then.
    store.updateSettings(
      { streamOverlayToken: generateStreamOverlayToken() },
      { notifyListeners: true }
    )
    return
  }
  overlay.setToken(settings.streamOverlayToken)
  void overlay.start(normalizeStreamOverlayPort(settings.streamOverlayPort))
}

export function registerStreamOverlayHandlers(store: Store): void {
  disposeStreamOverlay()
  const overlay = new StreamOverlayServer({
    getChat: () => toChatPayload(getTwitchChatSnapshot()),
    getAgents: getAgentsPayload,
    getStats: () => ({ stats: getTwitchStreamStats() }),
    onStatusChange: broadcastStatus
  })

  let agentTimer: ReturnType<typeof setTimeout> | null = null
  const publishAgentsSoon = (): void => {
    if (agentTimer) {
      return
    }
    agentTimer = setTimeout(() => {
      agentTimer = null
      overlay.publishAgents(getAgentsPayload())
    }, AGENT_PUBLISH_THROTTLE_MS)
    agentTimer.unref?.()
  }
  const refreshTimer = setInterval(
    () => overlay.publishAgents(getAgentsPayload()),
    AGENT_REFRESH_MS
  )
  refreshTimer.unref?.()

  const unsubscribeChat = subscribeTwitchChatSnapshots((snapshot) =>
    overlay.publishChat(toChatPayload(snapshot))
  )
  const unsubscribeStats = subscribeTwitchStreamStats((stats) => overlay.publishStats({ stats }))
  const unsubscribeAgents = agentHookServer.subscribeStatusChanges(publishAgentsSoon)
  const unsubscribeSettings = store.onSettingsChanged((updates, settings) => {
    if (
      'experimentalStreamOverlay' in updates ||
      'streamOverlayPort' in updates ||
      'streamOverlayToken' in updates
    ) {
      applySettings(store, overlay, settings)
    }
  })
  applySettings(store, overlay, store.getSettings())

  readyUrls = (page, query = '') => {
    const status = overlay.getStatus()
    const token = store.getSettings().streamOverlayToken
    return status.state === 'listening' && token
      ? `${buildStreamOverlayUrl(status.port, token, page)}${query}`
      : null
  }

  ipcMain.removeHandler('streamOverlay:getStatus')
  ipcMain.handle('streamOverlay:getStatus', (): StreamOverlayStatus => overlay.getStatus())

  teardown = () => {
    unsubscribeChat()
    unsubscribeStats()
    unsubscribeAgents()
    unsubscribeSettings()
    clearInterval(refreshTimer)
    if (agentTimer) {
      clearTimeout(agentTimer)
    }
    void overlay.stop()
  }
}

export function disposeStreamOverlay(): void {
  teardown?.()
  teardown = null
  readyUrls = null
}
