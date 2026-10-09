import type { ContextBridge, IpcRenderer } from 'electron'

// Why: raw require keeps the sandboxed preload standalone in the main-process CJS build.
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: require('electron') in a preload returns these renderer modules.
const { contextBridge, ipcRenderer } = require('electron') as {
  contextBridge: ContextBridge
  ipcRenderer: IpcRenderer
}

// Why: only Orca's own loopback chat page gets the composer bridge; the window cannot navigate, but stay explicit.
if (location.hostname === '127.0.0.1' && location.pathname === '/overlay/chat') {
  contextBridge.exposeInMainWorld('orcaStreamChat', {
    send: (text: unknown): Promise<unknown> => ipcRenderer.invoke('twitchChat:send', String(text)),
    getAuthState: (): Promise<unknown> => ipcRenderer.invoke('twitchChat:getAuthState'),
    onAuthChanged: (callback: (state: unknown) => void): void => {
      ipcRenderer.on('twitchChat:authChanged', (_event, state: unknown) => callback(state))
    }
  })
}
