/** One OBS input that carries audio, as the Audio tab's mixboard shows it. */
export type StreamAudioChannel = {
  name: string
  kind: string
  /** Fader position in dB (0 = unity; OBS reports about -100 for silence). */
  volumeDb: number
  muted: boolean
}

/** Live level of one input: post-fader peak and RMS in dBFS (−Infinity when silent). */
export type StreamAudioLevel = { peakDb: number; rmsDb: number }

export type StreamAudioState = {
  connected: boolean
  channels: StreamAudioChannel[]
  error: string | null
}

export type StreamAudioCheckId = 'setup' | 'mic' | 'music' | 'balance'

export const STREAM_AUDIO_CHECK_IDS = ['setup', 'mic', 'music', 'balance'] as const

/** How long each check listens (setup only reads OBS settings). */
export const STREAM_AUDIO_CHECK_SECONDS: Record<StreamAudioCheckId, number> = {
  setup: 0,
  mic: 6,
  music: 6,
  balance: 8
}

export type StreamAudioCheckStatus = 'pass' | 'warn' | 'fail'

export type StreamAudioFinding = {
  status: StreamAudioCheckStatus
  message: string
  /** A fader move that would fix it, offered as a one-click "Apply". */
  suggestion?: { input: string; volumeDb: number }
}

export type StreamAudioCheckResult = {
  id: StreamAudioCheckId
  status: StreamAudioCheckStatus
  findings: StreamAudioFinding[]
}

// Spoken-word streaming targets (dBFS, post-fader): peaks near -6, average voice near -18.
export const VOICE_TARGET_RMS_DB = -18
export const VOICE_MIN_PEAK_DB = -20
export const CLIP_PEAK_DB = -1
// Music bed sits well under the voice so chat can hear you over it.
export const MUSIC_UNDER_VOICE_DB = 15
export const MUSIC_ALONE_TARGET_RMS_DB = VOICE_TARGET_RMS_DB - MUSIC_UNDER_VOICE_DB
export const FADER_MIN_DB = -60
export const FADER_MAX_DB = 0

export function mulToDb(mul: number): number {
  return mul > 0 ? 20 * Math.log10(mul) : Number.NEGATIVE_INFINITY
}

export function clampFaderDb(db: number): number {
  return Math.round(Math.min(FADER_MAX_DB, Math.max(FADER_MIN_DB, db)) * 10) / 10
}

/** Summary of one input's samples over a check window. */
export type StreamAudioWindow = {
  /** Highest post-fader peak seen. */
  peakDb: number
  /** Loud-part average: the 90th percentile of RMS, so pauses between words don't drag it down. */
  activeRmsDb: number
  /** Share of samples above -50 dBFS (0-1): whether someone was talking. */
  activity: number
  /** Share of samples above -80 dBFS (0-1): whether anything played at all, however quiet. */
  presence: number
}

// Why so low: a music bed sits ~35 dB under 0, and a quiet fader pushes it past -50; only digital silence is below this.
const PRESENCE_FLOOR_DB = -80

export function summarizeWindow(samples: StreamAudioLevel[]): StreamAudioWindow {
  if (samples.length === 0) {
    return {
      peakDb: Number.NEGATIVE_INFINITY,
      activeRmsDb: Number.NEGATIVE_INFINITY,
      activity: 0,
      presence: 0
    }
  }
  const rms = samples.map((sample) => sample.rmsDb).sort((a, b) => a - b)
  return {
    peakDb: Math.max(...samples.map((sample) => sample.peakDb)),
    activeRmsDb: rms[Math.min(rms.length - 1, Math.floor(rms.length * 0.9))],
    activity: samples.filter((sample) => sample.rmsDb > -50).length / samples.length,
    presence: samples.filter((sample) => sample.rmsDb > PRESENCE_FLOOR_DB).length / samples.length
  }
}

function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(0)} dB` : 'silence'
}

function worst(findings: StreamAudioFinding[]): StreamAudioCheckStatus {
  if (findings.some((finding) => finding.status === 'fail')) {
    return 'fail'
  }
  return findings.some((finding) => finding.status === 'warn') ? 'warn' : 'pass'
}

export function checkResult(
  id: StreamAudioCheckId,
  findings: StreamAudioFinding[]
): StreamAudioCheckResult {
  return { id, status: worst(findings), findings }
}

/** Mic while the streamer talks: heard, not clipping, average near the voice target. */
export function analyzeVoice(
  input: StreamAudioChannel,
  window: StreamAudioWindow
): StreamAudioFinding[] {
  if (input.muted) {
    return [
      { status: 'fail', message: `${input.name} is muted in OBS, so viewers can't hear you.` }
    ]
  }
  if (window.activity < 0.1) {
    return [
      {
        status: 'fail',
        message: `Heard almost nothing from ${input.name}. Check the mic is plugged in and is the right device.`,
        suggestion: input.volumeDb < -20 ? { input: input.name, volumeDb: FADER_MAX_DB } : undefined
      }
    ]
  }
  const target = clampFaderDb(input.volumeDb + (VOICE_TARGET_RMS_DB - window.activeRmsDb))
  if (window.peakDb > CLIP_PEAK_DB) {
    return [
      {
        status: 'fail',
        message: `Your voice is clipping (peaks at ${formatDb(window.peakDb)}); it will sound distorted.`,
        suggestion: { input: input.name, volumeDb: Math.min(target, input.volumeDb - 6) }
      }
    ]
  }
  const off = window.activeRmsDb - VOICE_TARGET_RMS_DB
  if (window.peakDb < VOICE_MIN_PEAK_DB || off < -6) {
    const needsGain = target >= FADER_MAX_DB && input.volumeDb >= FADER_MAX_DB - 0.5
    return [
      {
        status: 'warn',
        message: needsGain
          ? `Your voice is quiet (${formatDb(window.activeRmsDb)} average) even with the fader at 0 dB. Raise the mic's input gain in the system mixer, or add a Gain filter in OBS.`
          : `Your voice is quiet (${formatDb(window.activeRmsDb)} average, aim for about ${VOICE_TARGET_RMS_DB} dB).`,
        suggestion: needsGain ? undefined : { input: input.name, volumeDb: target }
      }
    ]
  }
  if (off > 6) {
    return [
      {
        status: 'warn',
        message: `Your voice is loud (${formatDb(window.activeRmsDb)} average, aim for about ${VOICE_TARGET_RMS_DB} dB).`,
        suggestion: { input: input.name, volumeDb: target }
      }
    ]
  }
  return [
    {
      status: 'pass',
      message: `Voice level is good: ${formatDb(window.activeRmsDb)} average, peaks at ${formatDb(window.peakDb)}.`
    }
  ]
}

/** Music on its own: playing, not clipping, sitting at the music-bed target. */
export function analyzeMusic(
  input: StreamAudioChannel,
  window: StreamAudioWindow
): StreamAudioFinding[] {
  if (input.muted) {
    return [{ status: 'warn', message: `${input.name} is muted in OBS, so viewers hear no music.` }]
  }
  if (window.presence < 0.3) {
    return [
      {
        status: 'warn',
        message: `No music heard on ${input.name}. Start a StreamBeats playlist, then run this again.`
      }
    ]
  }
  const target = clampFaderDb(input.volumeDb + (MUSIC_ALONE_TARGET_RMS_DB - window.activeRmsDb))
  const off = window.activeRmsDb - MUSIC_ALONE_TARGET_RMS_DB
  if (window.peakDb > CLIP_PEAK_DB || off > 4) {
    return [
      {
        status: 'warn',
        message: `Music is too loud for a background bed (${formatDb(window.activeRmsDb)}, aim for about ${MUSIC_ALONE_TARGET_RMS_DB} dB).`,
        suggestion: { input: input.name, volumeDb: target }
      }
    ]
  }
  if (off < -8) {
    const maxed = input.volumeDb + -off > FADER_MAX_DB
    return [
      {
        status: 'warn',
        message: `Music is very quiet, so viewers will barely hear it (${formatDb(window.activeRmsDb)}, aim for about ${MUSIC_ALONE_TARGET_RMS_DB} dB).${maxed ? " The fader can't go past 0 dB, so also turn up the music app's own volume." : ''}`,
        suggestion: { input: input.name, volumeDb: target }
      }
    ]
  }
  return [{ status: 'pass', message: `Music level is good: ${formatDb(window.activeRmsDb)}.` }]
}

/** Voice and music together: the voice should stay clearly on top. */
export function analyzeBalance(
  mic: StreamAudioChannel,
  voice: StreamAudioWindow,
  music: StreamAudioChannel,
  bed: StreamAudioWindow
): StreamAudioFinding[] {
  if (voice.activity < 0.1 || bed.presence < 0.3) {
    return [
      {
        status: 'warn',
        message:
          'Need both talking and music playing to compare them. Play music and talk for the whole check.'
      }
    ]
  }
  const gap = voice.activeRmsDb - bed.activeRmsDb
  if (gap < MUSIC_UNDER_VOICE_DB - 5) {
    return [
      {
        status: gap < 3 ? 'fail' : 'warn',
        message: `Music is only ${gap.toFixed(0)} dB under your voice; aim for about ${MUSIC_UNDER_VOICE_DB} dB so chat can follow you.`,
        suggestion: {
          input: music.name,
          volumeDb: clampFaderDb(music.volumeDb - (MUSIC_UNDER_VOICE_DB - gap))
        }
      }
    ]
  }
  if (gap > MUSIC_UNDER_VOICE_DB + 10) {
    return [
      {
        status: 'warn',
        message: `Music is ${gap.toFixed(0)} dB under your voice, so viewers will barely hear it.`,
        suggestion: {
          input: music.name,
          volumeDb: clampFaderDb(music.volumeDb + (gap - MUSIC_UNDER_VOICE_DB))
        }
      }
    ]
  }
  return [
    {
      status: 'pass',
      message: `Good balance: music sits ${gap.toFixed(0)} dB under ${mic.name}.`
    }
  ]
}

// Kinds that capture everything the computer plays.
const DESKTOP_CAPTURE_KINDS = new Set([
  'pulse_output_capture',
  'pipewire-desktop-audio-capture',
  'wasapi_output_capture',
  'coreaudio_output_capture'
])

/** Static setup problems: missing or muted inputs and double-captured audio. */
export function analyzeSetup(
  channels: StreamAudioChannel[],
  names: { mic: string | null; music: string | null; suno: string | null }
): StreamAudioFinding[] {
  const findings: StreamAudioFinding[] = []
  const byName = new Map(channels.map((channel) => [channel.name, channel]))
  const mic = names.mic ? byName.get(names.mic) : undefined
  if (!mic) {
    findings.push({ status: 'fail', message: 'No microphone input found in OBS.' })
  } else if (mic.muted) {
    findings.push({ status: 'fail', message: `${mic.name} is muted in OBS.` })
  } else if (mic.volumeDb < -20) {
    findings.push({
      status: 'warn',
      message: `${mic.name} fader is very low (${formatDb(mic.volumeDb)}). Run the mic check to set it.`
    })
  }
  const music = names.music ? byName.get(names.music) : undefined
  if (!music) {
    findings.push({ status: 'warn', message: 'No music input (Spotify) found in OBS.' })
  } else if (music.muted) {
    findings.push({ status: 'warn', message: `${music.name} is muted in OBS.` })
  }
  // Why skip the music input: it is an output capture too, but of its own sink (e.g. a Spotify-only loopback).
  const desktop = channels.filter(
    (channel) =>
      DESKTOP_CAPTURE_KINDS.has(channel.kind) && !channel.muted && channel.name !== music?.name
  )
  if (desktop.length > 0 && music) {
    findings.push({
      status: 'warn',
      message: `${desktop.map((channel) => channel.name).join(', ')} captures all desktop sound, so music and Orca previews can be heard twice or leak onto the stream. Mute it if ${music.name} already carries the music.`
    })
  }
  if (!names.suno) {
    findings.push({
      status: 'pass',
      message: 'The Suno track source is created the first time you send a song to stream.'
    })
  }
  if (findings.every((finding) => finding.status === 'pass')) {
    findings.unshift({ status: 'pass', message: 'Mic and music inputs are present and unmuted.' })
  }
  return findings
}
