import type { SunoStreamState } from '../../shared/suno-music'
import type { ObsSession } from './obs-websocket-session'
import type { MusicPlayerControl } from './spotify-player-control'

export const SUNO_OBS_INPUT = 'Orca Suno track'
// Why ~-18 dB, not mute: a bed of music under the song sounds like a DJ handover, not a cut.
const DUCKED_FACTOR = 0.12
const FADE_STEPS = 12
const FADE_MS = 1500
const RESUME_FADE_MS = 3000
const POLL_MS = 1000
// Why: OBS reports OPENING/NONE until ffmpeg has the file; give up if it never starts.
const START_TIMEOUT_MS = 10_000

type SunoStreamPlayerOptions = {
  openSession: () => Promise<ObsSession>
  onChange: (state: SunoStreamState) => void
  /** When the music app is playing it is paused instead of ducked, so the streamer hears the song alone. */
  musicPlayer?: MusicPlayerControl | null
  sleep?: (ms: number) => Promise<void>
}

type MusicInput = { name: string; volumeMul: number }

type Playback = { stopRequested: boolean; done: Promise<void> }

type MusicHandling = { ducked: MusicInput | null; pausedPlayer: boolean }

function list(response: Record<string, unknown>, key: string): unknown[] {
  const value = response[key]
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return null
  }
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : null
}

/** Plays a song through an OBS media source, ducking the streamer's music input meanwhile. */
export class SunoStreamPlayer {
  private state: SunoStreamState = { playing: null, busy: false, error: null }
  private playback: Playback | null = null
  private queue: Promise<void> = Promise.resolve()
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: SunoStreamPlayerOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  getState(): SunoStreamState {
    return this.state
  }

  play(filePath: string, fileName: string): Promise<SunoStreamState> {
    return this.enqueue(async () => {
      await this.finishPlayback()
      await this.start(filePath, fileName)
    })
  }

  stop(): Promise<SunoStreamState> {
    return this.enqueue(() => this.finishPlayback())
  }

  // Why serialized: Play then Stop pressed quickly must not leave Spotify ducked.
  private enqueue(task: () => Promise<void>): Promise<SunoStreamState> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => {})
    return run.then(() => this.state)
  }

  private async finishPlayback(): Promise<void> {
    const playback = this.playback
    if (!playback) {
      return
    }
    playback.stopRequested = true
    await playback.done
  }

  private async start(filePath: string, fileName: string): Promise<void> {
    this.setState({ playing: null, busy: true, error: null })
    let session: ObsSession | null = null
    const handling: MusicHandling = { ducked: null, pausedPlayer: false }
    try {
      session = await this.options.openSession()
      await this.ensureInput(session, filePath)
      const music = await this.findMusicInput(session)
      await session.request('SetInputVolume', {
        inputName: SUNO_OBS_INPUT,
        inputVolumeMul: music?.volumeMul ?? 1
      })
      // Why fall back: a song must still play if the music app ignores the pause.
      handling.pausedPlayer = await this.pauseMusicPlayer().catch(() => false)
      if (music && !handling.pausedPlayer) {
        handling.ducked = music
        await this.fade(session, music.name, music.volumeMul, music.volumeMul * DUCKED_FACTOR)
      }
      await session.request('TriggerMediaInputAction', {
        inputName: SUNO_OBS_INPUT,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
      })
      const playback: Playback = { stopRequested: false, done: Promise.resolve() }
      playback.done = this.watch(session, handling, playback)
      this.playback = playback
      session = null
      this.setState({ playing: fileName, busy: false, error: null })
    } catch (error) {
      const { ducked } = handling
      if (session && ducked) {
        await session
          .request('SetInputVolume', { inputName: ducked.name, inputVolumeMul: ducked.volumeMul })
          .catch(() => {})
      }
      if (handling.pausedPlayer) {
        await this.resumeMusicPlayer().catch(() => {})
      }
      this.setState({ playing: null, busy: false, error: errorMessage(error) })
    } finally {
      session?.close()
    }
  }

  private async watch(
    session: ObsSession,
    handling: MusicHandling,
    playback: Playback
  ): Promise<void> {
    let error: string | null = null
    try {
      let started = false
      for (let waited = 0; !playback.stopRequested; waited += POLL_MS) {
        await this.sleep(POLL_MS)
        const status = await session.request('GetMediaInputStatus', { inputName: SUNO_OBS_INPUT })
        const mediaState = String(status.mediaState ?? '')
        if (mediaState === 'OBS_MEDIA_STATE_PLAYING') {
          started = true
        } else if (mediaState === 'OBS_MEDIA_STATE_ERROR') {
          throw new Error('OBS could not play this file.')
        } else if (started || /ENDED|STOPPED/.test(mediaState)) {
          break
        } else if (waited >= START_TIMEOUT_MS) {
          throw new Error('OBS never started playing the song.')
        }
      }
      if (playback.stopRequested) {
        await session.request('TriggerMediaInputAction', {
          inputName: SUNO_OBS_INPUT,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
        })
      }
    } catch (caught) {
      error = errorMessage(caught)
    }
    try {
      const music = handling.ducked
      if (music) {
        await this.fade(session, music.name, music.volumeMul * DUCKED_FACTOR, music.volumeMul)
      }
      if (handling.pausedPlayer) {
        await this.resumeMusicPlayer()
      }
    } catch (caught) {
      error ??= `Could not restore the music volume: ${errorMessage(caught)}`
    } finally {
      session.close()
    }
    if (this.playback === playback) {
      this.playback = null
    }
    this.setState({ playing: null, busy: false, error })
  }

  /** Fades the music app out and pauses it; its volume is put back while paused. */
  private async pauseMusicPlayer(): Promise<boolean> {
    const player = this.options.musicPlayer
    if (!player || !(await player.isPlaying())) {
      return false
    }
    const volume = await player.getVolume()
    try {
      await this.rampPlayer(player, volume, 0, FADE_MS)
      await player.pause()
    } finally {
      await player.setVolume(volume)
    }
    return true
  }

  private async resumeMusicPlayer(): Promise<void> {
    const player = this.options.musicPlayer
    // Why check: the streamer may have pressed play themselves during the song.
    if (!player || (await player.isPlaying())) {
      return
    }
    const volume = await player.getVolume()
    try {
      await player.setVolume(0)
      await player.play()
      await this.rampPlayer(player, 0, volume, RESUME_FADE_MS)
    } finally {
      // Why: never leave the app silent if a step failed mid-fade.
      await player.setVolume(volume)
    }
  }

  private async rampPlayer(
    player: MusicPlayerControl,
    from: number,
    to: number,
    durationMs: number
  ): Promise<void> {
    for (let step = 1; step <= FADE_STEPS; step++) {
      await player.setVolume(from + ((to - from) * step) / FADE_STEPS)
      if (step < FADE_STEPS) {
        await this.sleep(durationMs / FADE_STEPS)
      }
    }
  }

  private async ensureInput(session: ObsSession, filePath: string): Promise<void> {
    const inputSettings = {
      local_file: filePath,
      is_local_file: true,
      looping: false,
      restart_on_activate: false,
      close_when_inactive: false
    }
    const inputs = list(await session.request('GetInputList'), 'inputs')
    if (!inputs.some((input) => stringField(input, 'inputName') === SUNO_OBS_INPUT)) {
      const sceneName = stringField(await session.request('GetCurrentProgramScene'), 'sceneName')
      await session.request('CreateInput', {
        sceneName,
        inputName: SUNO_OBS_INPUT,
        inputKind: 'ffmpeg_source',
        inputSettings
      })
      // Why monitor too: the streamer hears what viewers hear without OBS capturing it twice.
      await session.request('SetInputAudioMonitorType', {
        inputName: SUNO_OBS_INPUT,
        monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
      })
    } else {
      await session.request('SetInputSettings', { inputName: SUNO_OBS_INPUT, inputSettings })
    }
    // Why every scene: a media source only plays in the program scene, and a scene switch mid-song must not cut it.
    for (const scene of list(await session.request('GetSceneList'), 'scenes')) {
      const sceneName = stringField(scene, 'sceneName')
      if (!sceneName) {
        continue
      }
      const items = list(await session.request('GetSceneItemList', { sceneName }), 'sceneItems')
      if (!items.some((item) => stringField(item, 'sourceName') === SUNO_OBS_INPUT)) {
        await session.request('CreateSceneItem', { sceneName, sourceName: SUNO_OBS_INPUT })
      }
    }
  }

  private async findMusicInput(session: ObsSession): Promise<MusicInput | null> {
    const names = list(await session.request('GetInputList'), 'inputs')
      .map((input) => stringField(input, 'inputName'))
      .filter((name): name is string => name !== null && name !== SUNO_OBS_INPUT)
    const name = names.find((n) => /spotify/i.test(n)) ?? names.find((n) => /music/i.test(n))
    if (!name) {
      return null
    }
    const { inputMuted } = await session.request('GetInputMute', { inputName: name })
    if (inputMuted === true) {
      return null
    }
    const { inputVolumeMul } = await session.request('GetInputVolume', { inputName: name })
    const volumeMul = Number(inputVolumeMul)
    return Number.isFinite(volumeMul) && volumeMul > 0 ? { name, volumeMul } : null
  }

  private async fade(
    session: ObsSession,
    inputName: string,
    from: number,
    to: number
  ): Promise<void> {
    for (let step = 1; step <= FADE_STEPS; step++) {
      await session.request('SetInputVolume', {
        inputName,
        inputVolumeMul: from + ((to - from) * step) / FADE_STEPS
      })
      if (step < FADE_STEPS) {
        await this.sleep(FADE_MS / FADE_STEPS)
      }
    }
  }

  private setState(state: SunoStreamState): void {
    this.state = state
    this.options.onChange(state)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
