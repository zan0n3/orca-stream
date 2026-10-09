import { ipcRenderer } from 'electron'
import type { TwitchChatSnapshot } from '../../shared/twitch-chat-types'
import type { PreloadApi } from '../api-types'

export const twitchChatApi = {
  getSnapshot: (): Promise<TwitchChatSnapshot> => ipcRenderer.invoke('twitchChat:getSnapshot'),
  onChanged: (callback: (snapshot: TwitchChatSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TwitchChatSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('twitchChat:changed', listener)
    return () => ipcRenderer.removeListener('twitchChat:changed', listener)
  }
} satisfies PreloadApi['twitchChat']
