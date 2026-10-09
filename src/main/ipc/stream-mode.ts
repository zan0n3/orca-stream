import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import type { Store } from '../persistence'
import { STREAM_CHAT_WINDOW_TITLE, type StreamModeState } from '../../shared/stream-overlay'
import { isWindowlessLaunch } from '../window/foreground-activation-policy'
import {
  StreamModeService,
  pickStreamChatDisplay,
  streamChatWindowBounds
} from '../stream-overlay/stream-mode-service'
import { getStreamOverlayUrl } from './stream-overlay'

let service: StreamModeService | null = null

export function getStreamHooksDirectory(): string {
  return path.join(app.getPath('userData'), 'stream-hooks')
}

function openChatWindow(url: string): BrowserWindow {
  const display = pickStreamChatDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
  const window = new BrowserWindow({
    ...(display ? streamChatWindowBounds(display) : { width: 440, height: 900 }),
    title: STREAM_CHAT_WINDOW_TITLE,
    backgroundColor: '#111113',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'stream-chat',
      // Why: exposes only the chat composer (send + sign-in state) to Orca's own chat page.
      preload: path.join(__dirname, 'stream-chat-window-preload.js')
    }
  })
  // Why: compositor window rules (e.g. Hyprland) match this fixed title to place the window.
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => {
    // Why showInactive: going live from the main screen must not yank focus to the chat screen.
    if (!isWindowlessLaunch() && !window.isDestroyed()) {
      window.showInactive()
    }
  })
  void window.loadURL(url)
  return window
}

function broadcast(state: StreamModeState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('streamMode:changed', state)
    }
  }
}

export function registerStreamModeHandlers(store: Store): void {
  disposeStreamMode()
  const hooksDirectory = getStreamHooksDirectory()
  void mkdir(hooksDirectory, { recursive: true }).catch(() => {})
  const streamMode = new StreamModeService({
    hooksDirectory,
    enableStreamFeatures: () => {
      const settings = store.getSettings()
      if (settings.experimentalTwitchChat !== true || settings.experimentalStreamOverlay !== true) {
        store.updateSettings(
          { experimentalTwitchChat: true, experimentalStreamOverlay: true },
          { notifyListeners: true }
        )
      }
    },
    getOverlayUrl: getStreamOverlayUrl,
    openChatWindow,
    onChange: broadcast
  })
  service = streamMode

  ipcMain.removeHandler('streamMode:getState')
  ipcMain.removeHandler('streamMode:start')
  ipcMain.removeHandler('streamMode:stop')
  ipcMain.removeHandler('streamMode:openHooksFolder')
  ipcMain.handle('streamMode:getState', (): StreamModeState => streamMode.getState())
  ipcMain.handle('streamMode:start', (): Promise<StreamModeState> => streamMode.start())
  ipcMain.handle('streamMode:stop', (): Promise<StreamModeState> => streamMode.stop())
  ipcMain.handle('streamMode:openHooksFolder', async (): Promise<void> => {
    await mkdir(hooksDirectory, { recursive: true })
    await shell.openPath(hooksDirectory)
  })

  // Why: the chat window alone must not keep a closed Orca alive on Linux/Windows.
  app.on('browser-window-created', (_event, created) => {
    created.on('closed', () => {
      const remaining = BrowserWindow.getAllWindows().filter(
        (window) => !window.isDestroyed() && window.getTitle() !== STREAM_CHAT_WINDOW_TITLE
      )
      if (remaining.length === 0 && service === streamMode) {
        void streamMode.stop()
      }
    })
  })
}

export function disposeStreamMode(): void {
  service?.dispose()
  service = null
}
