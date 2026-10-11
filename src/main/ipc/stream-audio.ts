import { BrowserWindow, ipcMain } from 'electron'
import {
  STREAM_AUDIO_CHECK_IDS,
  type StreamAudioCheckId,
  type StreamAudioCheckResult,
  type StreamAudioLevel,
  type StreamAudioState
} from '../../shared/stream-audio'
import { readObsWebsocketConfig } from '../obs/obs-websocket-config'
import { openObsSession } from '../obs/obs-websocket-session'
import { StreamAudioMixer } from '../obs/stream-audio-mixer'

function checkId(value: unknown): StreamAudioCheckId | undefined {
  return STREAM_AUDIO_CHECK_IDS.find((id) => id === value)
}

function send(channel: string, payload: StreamAudioState | Record<string, StreamAudioLevel>): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function registerStreamAudioHandlers(): void {
  const mixer = new StreamAudioMixer({
    openSession: async (options) => {
      const config = await readObsWebsocketConfig()
      return openObsSession(config.url, config.password, options)
    },
    onState: (state) => send('streamAudio:changed', state),
    onLevels: (levels) => send('streamAudio:levels', levels)
  })
  // Why per renderer: a reloaded or closed window never sends unwatch, so release it on destroy.
  const watching = new Set<number>()

  for (const channel of [
    'streamAudio:watch',
    'streamAudio:unwatch',
    'streamAudio:setVolume',
    'streamAudio:setMuted',
    'streamAudio:runCheck'
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('streamAudio:watch', (event): Promise<StreamAudioState> => {
    const id = event.sender.id
    if (!watching.has(id)) {
      watching.add(id)
      event.sender.once('destroyed', () => {
        if (watching.delete(id)) {
          mixer.unwatch()
        }
      })
      return mixer.watch()
    }
    return Promise.resolve(mixer.getState())
  })
  ipcMain.handle('streamAudio:unwatch', (event): void => {
    if (watching.delete(event.sender.id)) {
      mixer.unwatch()
    }
  })
  ipcMain.handle(
    'streamAudio:setVolume',
    (_event, inputName: unknown, volumeDb: unknown): Promise<StreamAudioState> =>
      mixer.setVolume(String(inputName), Math.min(26, Math.max(-100, Number(volumeDb) || 0)))
  )
  ipcMain.handle(
    'streamAudio:setMuted',
    (_event, inputName: unknown, muted: unknown): Promise<StreamAudioState> =>
      mixer.setMuted(String(inputName), muted === true)
  )
  ipcMain.handle('streamAudio:runCheck', (_event, id: unknown): Promise<StreamAudioCheckResult> => {
    const check = checkId(id)
    return check ? mixer.runCheck(check) : Promise.reject(new Error('Unknown sound check.'))
  })
}
