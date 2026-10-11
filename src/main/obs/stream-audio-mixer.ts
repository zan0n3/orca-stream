import {
  analyzeBalance,
  analyzeMusic,
  analyzeSetup,
  analyzeVoice,
  checkResult,
  mulToDb,
  STREAM_AUDIO_CHECK_SECONDS,
  summarizeWindow,
  type StreamAudioChannel,
  type StreamAudioCheckId,
  type StreamAudioCheckResult,
  type StreamAudioLevel,
  type StreamAudioState
} from '../../shared/stream-audio'
import type { ObsSession, ObsSessionOptions } from './obs-websocket-session'
import { SUNO_OBS_INPUT } from './suno-stream-player'

// obs-websocket EventSubscription bits.
const EVENTS_INPUTS = 1 << 3
const EVENTS_INPUT_VOLUME_METERS = 1 << 16
const LEVEL_PUSH_MS = 100
const RECONNECT_MS = 5000

type StreamAudioMixerOptions = {
  openSession: (options: ObsSessionOptions) => Promise<ObsSession>
  onState: (state: StreamAudioState) => void
  onLevels: (levels: Record<string, StreamAudioLevel>) => void
  sleep?: (ms: number) => Promise<void>
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : null
}

/** Turns one InputVolumeMeters entry into a post-fader peak/RMS across its channels. */
export function meterLevel(levelsMul: unknown): StreamAudioLevel {
  const channels = Array.isArray(levelsMul) ? levelsMul : []
  let rms = 0
  let peak = 0
  for (const channel of channels) {
    if (Array.isArray(channel)) {
      rms = Math.max(rms, Number(channel[0]) || 0)
      peak = Math.max(peak, Number(channel[1]) || 0)
    }
  }
  return { rmsDb: mulToDb(rms), peakDb: mulToDb(peak) }
}

export function pickAudioRoles(channels: StreamAudioChannel[]): {
  mic: string | null
  music: string | null
  suno: string | null
} {
  const names = channels.map((channel) => channel.name).filter((name) => name !== SUNO_OBS_INPUT)
  const mic =
    names.find((name) => /\bmic|microphone/i.test(name)) ??
    channels.find((channel) => /input_capture|audio-input/.test(channel.kind))?.name ??
    null
  const music =
    names.find((name) => /spotify/i.test(name)) ?? names.find((name) => /music/i.test(name)) ?? null
  const suno = channels.some((channel) => channel.name === SUNO_OBS_INPUT) ? SUNO_OBS_INPUT : null
  return { mic, music, suno }
}

/** The Audio tab's link to OBS: mixer state, live meters, fader/mute control and sound checks. */
export class StreamAudioMixer {
  private state: StreamAudioState = { connected: false, channels: [], error: null }
  private session: ObsSession | null = null
  private connecting: Promise<ObsSession> | null = null
  private watchers = 0
  private latest: Record<string, StreamAudioLevel> = {}
  private recorders = new Set<(levels: Record<string, StreamAudioLevel>) => void>()
  private levelTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: StreamAudioMixerOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  getState(): StreamAudioState {
    return this.state
  }

  async watch(): Promise<StreamAudioState> {
    this.watchers++
    await this.connect().catch(() => {})
    return this.state
  }

  unwatch(): void {
    this.watchers = Math.max(0, this.watchers - 1)
    if (this.watchers === 0 && this.recorders.size === 0) {
      this.disconnect()
    }
  }

  async setVolume(inputName: string, volumeDb: number): Promise<StreamAudioState> {
    const session = await this.connect()
    await session.request('SetInputVolume', { inputName, inputVolumeDb: volumeDb })
    await this.refresh()
    return this.state
  }

  async setMuted(inputName: string, muted: boolean): Promise<StreamAudioState> {
    const session = await this.connect()
    await session.request('SetInputMute', { inputName, inputMuted: muted })
    await this.refresh()
    return this.state
  }

  async runCheck(id: StreamAudioCheckId): Promise<StreamAudioCheckResult> {
    await this.connect()
    await this.refresh()
    const roles = pickAudioRoles(this.state.channels)
    const channel = (name: string | null): StreamAudioChannel | undefined =>
      this.state.channels.find((entry) => entry.name === name)
    if (id === 'setup') {
      return checkResult(id, analyzeSetup(this.state.channels, roles))
    }
    const mic = channel(roles.mic)
    const music = channel(roles.music)
    if ((id === 'mic' || id === 'balance') && !mic) {
      return checkResult(id, [{ status: 'fail', message: 'No microphone input found in OBS.' }])
    }
    if ((id === 'music' || id === 'balance') && !music) {
      return checkResult(id, [
        { status: 'fail', message: 'No music input (Spotify) found in OBS.' }
      ])
    }
    const samples = await this.record(STREAM_AUDIO_CHECK_SECONDS[id] * 1000)
    const window = (name: string) => summarizeWindow(samples[name] ?? [])
    if (id === 'mic' && mic) {
      return checkResult(id, analyzeVoice(mic, window(mic.name)))
    }
    if (id === 'music' && music) {
      return checkResult(id, analyzeMusic(music, window(music.name)))
    }
    if (mic && music) {
      return checkResult(id, analyzeBalance(mic, window(mic.name), music, window(music.name)))
    }
    return checkResult(id, [])
  }

  private async record(durationMs: number): Promise<Record<string, StreamAudioLevel[]>> {
    const samples: Record<string, StreamAudioLevel[]> = {}
    const recorder = (levels: Record<string, StreamAudioLevel>): void => {
      for (const [name, level] of Object.entries(levels)) {
        ;(samples[name] ??= []).push(level)
      }
    }
    this.recorders.add(recorder)
    try {
      await this.sleep(durationMs)
    } finally {
      this.recorders.delete(recorder)
      if (this.watchers === 0) {
        this.disconnect()
      }
    }
    return samples
  }

  private connect(): Promise<ObsSession> {
    if (this.session) {
      return Promise.resolve(this.session)
    }
    this.connecting ??= this.options
      .openSession({
        eventSubscriptions: EVENTS_INPUTS | EVENTS_INPUT_VOLUME_METERS,
        onEvent: (type, data) => this.handleEvent(type, data),
        onClose: () => this.handleClose()
      })
      .then(async (session) => {
        this.session = session
        this.startLevelPush()
        await this.refresh()
        return session
      })
      .catch((error: unknown) => {
        this.setState({
          connected: false,
          channels: [],
          error: error instanceof Error ? error.message : String(error)
        })
        this.scheduleReconnect()
        throw error
      })
      .finally(() => {
        this.connecting = null
      })
    return this.connecting
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopLevelPush()
    const session = this.session
    this.session = null
    session?.close()
  }

  private handleClose(): void {
    this.session = null
    this.stopLevelPush()
    this.latest = {}
    this.setState({ connected: false, channels: [], error: 'The connection to OBS closed.' })
    this.scheduleReconnect()
  }

  // Why: OBS is often started after the Audio tab is opened (Go live launches it).
  private scheduleReconnect(): void {
    if (this.watchers === 0 || this.reconnectTimer) {
      return
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.watchers > 0 && !this.session) {
        void this.connect().catch(() => {})
      }
    }, RECONNECT_MS)
  }

  private async refresh(): Promise<void> {
    const session = this.session
    if (!session) {
      return
    }
    const list = await session.request('GetInputList')
    const inputs = Array.isArray(list.inputs) ? list.inputs : []
    const channels: StreamAudioChannel[] = []
    for (const input of inputs) {
      const name = stringField(input, 'inputName')
      if (!name) {
        continue
      }
      try {
        const volume = await session.request('GetInputVolume', { inputName: name })
        const mute = await session.request('GetInputMute', { inputName: name })
        channels.push({
          name,
          kind: stringField(input, 'unversionedInputKind') ?? stringField(input, 'inputKind') ?? '',
          volumeDb: Number(volume.inputVolumeDb),
          muted: mute.inputMuted === true
        })
      } catch {
        // Inputs without audio (captures, images) reject volume requests.
      }
    }
    this.setState({ connected: true, channels, error: null })
  }

  private handleEvent(type: string, data: Record<string, unknown>): void {
    if (type === 'InputVolumeMeters') {
      const inputs = Array.isArray(data.inputs) ? data.inputs : []
      const levels: Record<string, StreamAudioLevel> = {}
      for (const input of inputs) {
        const name = stringField(input, 'inputName')
        const levelsMul: unknown =
          typeof input === 'object' && input !== null ? Reflect.get(input, 'inputLevelsMul') : null
        if (name) {
          levels[name] = meterLevel(levelsMul)
        }
      }
      this.latest = levels
      for (const recorder of this.recorders) {
        recorder(levels)
      }
      return
    }
    if (type === 'InputVolumeChanged' || type === 'InputMuteStateChanged') {
      const name = stringField(data, 'inputName')
      this.setState({
        ...this.state,
        channels: this.state.channels.map((channel) =>
          channel.name !== name
            ? channel
            : type === 'InputVolumeChanged'
              ? { ...channel, volumeDb: Number(data.inputVolumeDb) }
              : { ...channel, muted: data.inputMuted === true }
        )
      })
      return
    }
    if (/^Input(Created|Removed|NameChanged)$/.test(type)) {
      void this.refresh().catch(() => {})
    }
  }

  private startLevelPush(): void {
    this.stopLevelPush()
    this.levelTimer = setInterval(() => this.options.onLevels(this.latest), LEVEL_PUSH_MS)
  }

  private stopLevelPush(): void {
    if (this.levelTimer) {
      clearInterval(this.levelTimer)
      this.levelTimer = null
    }
  }

  private setState(state: StreamAudioState): void {
    this.state = state
    this.options.onState(state)
  }
}
