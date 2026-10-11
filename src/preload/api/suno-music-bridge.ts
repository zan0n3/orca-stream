import { ipcRenderer } from 'electron'
import type { SunoCreateJob, SunoStreamState } from '../../shared/suno-music'
import type { PreloadApi } from '../api-types'

export const sunoMusicApi = {
  listTracks: () => ipcRenderer.invoke('suno:listTracks'),
  readTrack: (fileName) => ipcRenderer.invoke('suno:readTrack', fileName),
  importLink: (link) => ipcRenderer.invoke('suno:importLink', link),
  importFiles: () => ipcRenderer.invoke('suno:importFiles'),
  openFolder: () => ipcRenderer.invoke('suno:openFolder'),
  writeLyrics: (request) => ipcRenderer.invoke('suno:writeLyrics', request),
  getStreamState: () => ipcRenderer.invoke('suno:getStreamState'),
  playOnStream: (fileName) => ipcRenderer.invoke('suno:playOnStream', fileName),
  stopOnStream: () => ipcRenderer.invoke('suno:stopOnStream'),
  onStreamChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SunoStreamState): void =>
      callback(state)
    ipcRenderer.on('suno:streamChanged', listener)
    return () => ipcRenderer.removeListener('suno:streamChanged', listener)
  },
  hasSunoTab: () => ipcRenderer.invoke('suno:hasSunoTab'),
  getJob: () => ipcRenderer.invoke('suno:getJob'),
  createOnSuno: (draft) => ipcRenderer.invoke('suno:createOnSuno', draft),
  togglePlayOnSuno: (clipId) => ipcRenderer.invoke('suno:togglePlayOnSuno', clipId),
  downloadFromSuno: (clipId) => ipcRenderer.invoke('suno:downloadFromSuno', clipId),
  onJobChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, job: SunoCreateJob): void => callback(job)
    ipcRenderer.on('suno:jobChanged', listener)
    return () => ipcRenderer.removeListener('suno:jobChanged', listener)
  }
} satisfies PreloadApi['sunoMusic']
