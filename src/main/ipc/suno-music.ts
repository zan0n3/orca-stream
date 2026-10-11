import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  SunoCreateJob,
  SunoLyricsRequest,
  SunoSongDraft,
  SunoStreamState,
  SunoTrack
} from '../../shared/suno-music'
import { SUNO_TRACK_EXTENSIONS } from '../../shared/suno-music'
import { readObsWebsocketConfig } from '../obs/obs-websocket-config'
import { openObsSession } from '../obs/obs-websocket-session'
import { SunoStreamPlayer } from '../obs/suno-stream-player'
import {
  importSunoSongLink,
  importSunoTrackFiles,
  listSunoTracks,
  readSunoTrack,
  sunoTrackPath
} from '../suno/suno-library'
import { writeSunoLyrics } from '../suno/suno-lyrics-writer'
import { SunoWebDriver } from '../suno/suno-web-driver'

export function getSunoMusicDirectory(): string {
  return path.join(app.getPath('music'), 'Suno')
}

function broadcast(channel: string, payload: SunoStreamState | SunoCreateJob): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function lyricsRequest(value: unknown): SunoLyricsRequest {
  const field = (source: unknown, key: string): string => {
    const raw: unknown =
      typeof source === 'object' && source !== null ? Reflect.get(source, key) : ''
    return typeof raw === 'string' ? raw : ''
  }
  const previousRaw: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'previous') : undefined
  const previous: SunoSongDraft | undefined =
    typeof previousRaw === 'object' && previousRaw !== null
      ? {
          title: field(previousRaw, 'title'),
          style: field(previousRaw, 'style'),
          lyrics: field(previousRaw, 'lyrics')
        }
      : undefined
  return { idea: field(value, 'idea'), previous, feedback: field(value, 'feedback') }
}

export function registerSunoMusicHandlers(): void {
  const player = new SunoStreamPlayer({
    openSession: async () => {
      const config = await readObsWebsocketConfig()
      return openObsSession(config.url, config.password)
    },
    onChange: (state) => broadcast('suno:streamChanged', state)
  })
  const directory = getSunoMusicDirectory()
  const driver = new SunoWebDriver({
    directory,
    onChange: (job) => broadcast('suno:jobChanged', job)
  })

  for (const channel of [
    'suno:listTracks',
    'suno:readTrack',
    'suno:importLink',
    'suno:importFiles',
    'suno:openFolder',
    'suno:writeLyrics',
    'suno:getStreamState',
    'suno:playOnStream',
    'suno:stopOnStream',
    'suno:hasSunoTab',
    'suno:getJob',
    'suno:createOnSuno',
    'suno:togglePlayOnSuno',
    'suno:downloadFromSuno'
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('suno:listTracks', (): Promise<SunoTrack[]> => listSunoTracks(directory))
  ipcMain.handle('suno:readTrack', (_event, fileName: unknown): Promise<Uint8Array> =>
    readSunoTrack(directory, String(fileName))
  )
  ipcMain.handle('suno:importLink', (_event, link: unknown): Promise<SunoTrack> =>
    importSunoSongLink(directory, String(link))
  )
  ipcMain.handle('suno:importFiles', async (event): Promise<SunoTrack[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      defaultPath: app.getPath('downloads'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: SUNO_TRACK_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : importSunoTrackFiles(directory, result.filePaths)
  })
  ipcMain.handle('suno:openFolder', async (): Promise<void> => {
    await listSunoTracks(directory)
    await shell.openPath(directory)
  })
  ipcMain.handle('suno:writeLyrics', (_event, request: unknown): Promise<SunoSongDraft> =>
    writeSunoLyrics(lyricsRequest(request), path.join(app.getPath('temp'), 'orca-suno-lyrics'))
  )
  ipcMain.handle('suno:getStreamState', (): SunoStreamState => player.getState())
  ipcMain.handle('suno:playOnStream', (_event, fileName: unknown): Promise<SunoStreamState> => {
    const name = String(fileName)
    return player.play(sunoTrackPath(directory, name), name)
  })
  ipcMain.handle('suno:stopOnStream', (): Promise<SunoStreamState> => player.stop())
  ipcMain.handle('suno:hasSunoTab', (): boolean => driver.hasSunoTab())
  ipcMain.handle('suno:getJob', (): SunoCreateJob => driver.getJob())
  ipcMain.handle('suno:createOnSuno', (_event, draft: unknown): Promise<SunoCreateJob> => {
    const request = lyricsRequest({ previous: draft })
    if (!request.previous?.lyrics.trim()) {
      return Promise.reject(new Error('Write or paste lyrics first.'))
    }
    return driver.create(request.previous)
  })
  ipcMain.handle('suno:togglePlayOnSuno', (_event, clipId: unknown): Promise<void> =>
    driver.togglePlay(String(clipId))
  )
  ipcMain.handle('suno:downloadFromSuno', (_event, clipId: unknown): Promise<SunoTrack> =>
    driver.download(String(clipId))
  )
}
