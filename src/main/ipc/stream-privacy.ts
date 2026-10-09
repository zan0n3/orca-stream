import { BrowserWindow, ipcMain } from 'electron'
import type { StreamPrivacyState } from '../../shared/stream-privacy'
import { readObsWebsocketConfig } from '../obs/obs-websocket-config'
import { openObsSession } from '../obs/obs-websocket-session'
import { StreamPrivacyBlur } from '../obs/stream-privacy-blur'

function broadcast(state: StreamPrivacyState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('streamPrivacy:changed', state)
    }
  }
}

let blur: StreamPrivacyBlur | null = null

/** Used by the overlay server's hotkey endpoint. */
export function setStreamPrivacy(action: 'on' | 'off' | 'toggle'): Promise<StreamPrivacyState> {
  if (!blur) {
    return Promise.reject(new Error('Stream privacy is not ready.'))
  }
  return blur.setEnabled(action === 'toggle' ? 'toggle' : action === 'on')
}

export function registerStreamPrivacyHandlers(): void {
  const privacy = new StreamPrivacyBlur({
    openSession: async () => {
      const config = await readObsWebsocketConfig()
      return openObsSession(config.url, config.password)
    },
    onChange: broadcast
  })
  blur = privacy

  ipcMain.removeHandler('streamPrivacy:getState')
  ipcMain.removeHandler('streamPrivacy:set')
  ipcMain.handle('streamPrivacy:getState', (): StreamPrivacyState => privacy.getState())
  ipcMain.handle('streamPrivacy:set', (_event, enabled: unknown): Promise<StreamPrivacyState> =>
    privacy.setEnabled(enabled === true)
  )
}
