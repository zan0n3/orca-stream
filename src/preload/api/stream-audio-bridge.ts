import { ipcRenderer } from 'electron'
import type { StreamAudioLevel, StreamAudioState } from '../../shared/stream-audio'
import type { PreloadApi } from '../api-types'

export const streamAudioApi = {
  watch: () => ipcRenderer.invoke('streamAudio:watch'),
  unwatch: () => ipcRenderer.invoke('streamAudio:unwatch'),
  setVolume: (inputName, volumeDb) =>
    ipcRenderer.invoke('streamAudio:setVolume', inputName, volumeDb),
  setMuted: (inputName, muted) => ipcRenderer.invoke('streamAudio:setMuted', inputName, muted),
  runCheck: (id) => ipcRenderer.invoke('streamAudio:runCheck', id),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: StreamAudioState): void =>
      callback(state)
    ipcRenderer.on('streamAudio:changed', listener)
    return () => ipcRenderer.removeListener('streamAudio:changed', listener)
  },
  onLevels: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      levels: Record<string, StreamAudioLevel>
    ): void => callback(levels)
    ipcRenderer.on('streamAudio:levels', listener)
    return () => ipcRenderer.removeListener('streamAudio:levels', listener)
  }
} satisfies PreloadApi['streamAudio']
