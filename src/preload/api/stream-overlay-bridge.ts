import { ipcRenderer } from 'electron'
import type { StreamOverlayStatus } from '../../shared/stream-overlay'
import type { PreloadApi } from '../api-types'

export const streamOverlayApi = {
  getStatus: (): Promise<StreamOverlayStatus> => ipcRenderer.invoke('streamOverlay:getStatus'),
  onStatusChanged: (callback: (status: StreamOverlayStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: StreamOverlayStatus): void =>
      callback(status)
    ipcRenderer.on('streamOverlay:statusChanged', listener)
    return () => ipcRenderer.removeListener('streamOverlay:statusChanged', listener)
  }
} satisfies PreloadApi['streamOverlay']
