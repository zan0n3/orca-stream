import { describe, expect, it } from 'vitest'
import type { ObsSession, ObsSessionOptions } from './obs-websocket-session'
import { StreamAudioMixer, meterLevel, pickAudioRoles } from './stream-audio-mixer'

const MIC_LEVELS = [[0.125, 0.5, 0.5]] // rms -18 dB, peak -6 dB
const MUSIC_LEVELS = [[0.03, 0.1, 0.1]] // rms about -30 dB

function fakeObs() {
  let options: ObsSessionOptions = {}
  const calls: [string, Record<string, unknown> | undefined][] = []
  const session: ObsSession = {
    request: async (type, data) => {
      calls.push([type, data])
      switch (type) {
        case 'GetInputList':
          return {
            inputs: [
              { inputName: 'Fifine microphone', unversionedInputKind: 'pulse_input_capture' },
              { inputName: 'Spotify music', unversionedInputKind: 'pipewire-app-capture' },
              { inputName: 'Screen', unversionedInputKind: 'pipewire-screen-capture-source' }
            ]
          }
        case 'GetInputVolume':
          if (data?.inputName === 'Screen') {
            throw new Error('no audio')
          }
          return { inputVolumeDb: -10 }
        case 'GetInputMute':
          return { inputMuted: false }
        default:
          return {}
      }
    },
    close: () => {}
  }
  const meters = (): void =>
    options.onEvent?.('InputVolumeMeters', {
      inputs: [
        { inputName: 'Fifine microphone', inputLevelsMul: MIC_LEVELS },
        { inputName: 'Spotify music', inputLevelsMul: MUSIC_LEVELS }
      ]
    })
  const mixer = new StreamAudioMixer({
    openSession: async (opts) => {
      options = opts
      return session
    },
    onState: () => {},
    onLevels: () => {},
    // Each "wait" delivers a burst of meter events, standing in for OBS's 50 ms updates.
    sleep: async () => {
      for (let i = 0; i < 20; i++) {
        meters()
      }
    }
  })
  return { mixer, calls, options: () => options }
}

describe('meterLevel', () => {
  it('takes the loudest channel and converts to dB', () => {
    const level = meterLevel([
      [0.1, 0.25, 0.3],
      [0.125, 0.5, 0.6]
    ])
    expect(level.rmsDb).toBeCloseTo(-18.06, 1)
    expect(level.peakDb).toBeCloseTo(-6.02, 1)
    expect(meterLevel(undefined).peakDb).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('pickAudioRoles', () => {
  it('finds the mic and music inputs by name', () => {
    const channel = (name: string) => ({ name, kind: '', volumeDb: 0, muted: false })
    expect(pickAudioRoles([channel('Fifine microphone'), channel('Spotify music')])).toEqual({
      mic: 'Fifine microphone',
      music: 'Spotify music',
      suno: null
    })
  })
})

describe('StreamAudioMixer', () => {
  it('lists only inputs with audio and subscribes to meters', async () => {
    const { mixer, options } = fakeObs()
    const state = await mixer.watch()
    expect(state.channels.map((channel) => channel.name)).toEqual([
      'Fifine microphone',
      'Spotify music'
    ])
    expect(options().eventSubscriptions).toBe((1 << 3) | (1 << 16))
    mixer.unwatch()
  })

  it('grades the mic and the voice-over-music balance from recorded meters', async () => {
    const { mixer } = fakeObs()
    await mixer.watch()
    expect((await mixer.runCheck('mic')).status).toBe('pass')
    const balance = await mixer.runCheck('balance')
    // Music at about -30 dB sits ~12 dB under a -18 dB voice, inside the accepted range.
    expect(balance.status).toBe('pass')
    mixer.unwatch()
  })

  it('applies fader and mute changes through OBS', async () => {
    const { mixer, calls } = fakeObs()
    await mixer.watch()
    await mixer.setVolume('Spotify music', -28)
    await mixer.setMuted('Fifine microphone', true)
    expect(calls).toContainEqual([
      'SetInputVolume',
      { inputName: 'Spotify music', inputVolumeDb: -28 }
    ])
    expect(calls).toContainEqual([
      'SetInputMute',
      { inputName: 'Fifine microphone', inputMuted: true }
    ])
    mixer.unwatch()
  })
})
