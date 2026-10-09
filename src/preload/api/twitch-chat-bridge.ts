import { ipcRenderer } from 'electron'
import type {
  TwitchChatAuthState,
  TwitchChatSendResult,
  TwitchChatSnapshot
} from '../../shared/twitch-chat-types'
import type { PreloadApi } from '../api-types'

export const twitchChatApi = {
  getSnapshot: (): Promise<TwitchChatSnapshot> => ipcRenderer.invoke('twitchChat:getSnapshot'),
  onChanged: (callback: (snapshot: TwitchChatSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TwitchChatSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('twitchChat:changed', listener)
    return () => ipcRenderer.removeListener('twitchChat:changed', listener)
  },
  getAuthState: (): Promise<TwitchChatAuthState> => ipcRenderer.invoke('twitchChat:getAuthState'),
  startSignIn: (): Promise<TwitchChatAuthState> => ipcRenderer.invoke('twitchChat:startSignIn'),
  cancelSignIn: (): Promise<TwitchChatAuthState> => ipcRenderer.invoke('twitchChat:cancelSignIn'),
  signOut: (): Promise<TwitchChatAuthState> => ipcRenderer.invoke('twitchChat:signOut'),
  onAuthChanged: (callback: (state: TwitchChatAuthState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: TwitchChatAuthState): void =>
      callback(state)
    ipcRenderer.on('twitchChat:authChanged', listener)
    return () => ipcRenderer.removeListener('twitchChat:authChanged', listener)
  },
  send: (text: string): Promise<TwitchChatSendResult> => ipcRenderer.invoke('twitchChat:send', text)
} satisfies PreloadApi['twitchChat']
