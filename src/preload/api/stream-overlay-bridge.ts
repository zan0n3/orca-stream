import { ipcRenderer } from 'electron'
import type { StreamModeState, StreamOverlayStatus } from '../../shared/stream-overlay'
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

export const streamModeApi = {
  getState: (): Promise<StreamModeState> => ipcRenderer.invoke('streamMode:getState'),
  start: (): Promise<StreamModeState> => ipcRenderer.invoke('streamMode:start'),
  stop: (): Promise<StreamModeState> => ipcRenderer.invoke('streamMode:stop'),
  openHooksFolder: (): Promise<void> => ipcRenderer.invoke('streamMode:openHooksFolder'),
  onChanged: (callback: (state: StreamModeState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: StreamModeState): void =>
      callback(state)
    ipcRenderer.on('streamMode:changed', listener)
    return () => ipcRenderer.removeListener('streamMode:changed', listener)
  }
} satisfies PreloadApi['streamMode']
