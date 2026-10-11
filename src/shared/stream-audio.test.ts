import { describe, expect, it } from 'vitest'
import {
  analyzeBalance,
  analyzeMusic,
  analyzeSetup,
  analyzeVoice,
  summarizeWindow,
  type StreamAudioChannel,
  type StreamAudioWindow
} from './stream-audio'

const mic: StreamAudioChannel = {
  name: 'Fifine microphone',
  kind: 'pulse_input_capture',
  volumeDb: -10,
  muted: false
}
const music: StreamAudioChannel = {
  name: 'Spotify music',
  kind: 'pipewire-application-audio-capture',
  volumeDb: -10,
  muted: false
}
const heard = (activeRmsDb: number, peakDb = activeRmsDb + 12): StreamAudioWindow => ({
  peakDb,
  activeRmsDb,
  activity: 0.8
})

describe('summarizeWindow', () => {
  it('uses the loud parts so pauses between words do not drag the average down', () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ rmsDb: -70, peakDb: -60 })),
      { rmsDb: -20, peakDb: -8 },
      { rmsDb: -18, peakDb: -6 }
    ]
    expect(summarizeWindow(samples)).toEqual({ peakDb: -6, activeRmsDb: -18, activity: 0.2 })
  })
})

describe('analyzeVoice', () => {
  it('passes a voice near the target', () => {
    expect(analyzeVoice(mic, heard(-18))[0].status).toBe('pass')
  })

  it('suggests raising a quiet voice by the missing dB', () => {
    expect(analyzeVoice(mic, heard(-30))[0]).toMatchObject({
      status: 'warn',
      suggestion: { input: mic.name, volumeDb: 0 }
    })
    expect(analyzeVoice({ ...mic, volumeDb: -20 }, heard(-30))[0].suggestion?.volumeDb).toBe(-8)
  })

  it('points at input gain when the fader is already at 0 dB', () => {
    const finding = analyzeVoice({ ...mic, volumeDb: 0 }, heard(-34))[0]
    expect(finding.suggestion).toBeUndefined()
    expect(finding.message).toContain('Gain filter')
  })

  it('fails on clipping and on silence or mute', () => {
    expect(analyzeVoice(mic, heard(-10, -0.2))[0].status).toBe('fail')
    expect(analyzeVoice(mic, { ...heard(-80), activity: 0 })[0].status).toBe('fail')
    expect(analyzeVoice({ ...mic, muted: true }, heard(-18))[0].status).toBe('fail')
  })
})

describe('analyzeMusic and analyzeBalance', () => {
  it('pulls a loud music bed down to about 15 dB under the voice target', () => {
    expect(analyzeMusic(music, heard(-12))[0]).toMatchObject({
      status: 'warn',
      suggestion: { volumeDb: -31 }
    })
    expect(analyzeMusic(music, heard(-33))[0].status).toBe('pass')
  })

  it('wants the voice clearly above the music', () => {
    expect(analyzeBalance(mic, heard(-18), music, heard(-20))[0]).toMatchObject({
      status: 'fail',
      suggestion: { input: music.name, volumeDb: -23 }
    })
    expect(analyzeBalance(mic, heard(-18), music, heard(-33))[0].status).toBe('pass')
  })
})

describe('analyzeSetup', () => {
  it('flags a muted mic and a desktop capture that doubles the music', () => {
    const desktop: StreamAudioChannel = {
      name: 'Desktop Audio',
      kind: 'pulse_output_capture',
      volumeDb: 0,
      muted: false
    }
    const findings = analyzeSetup([{ ...mic, muted: true }, music, desktop], {
      mic: mic.name,
      music: music.name,
      suno: null
    })
    expect(findings.map((finding) => finding.status)).toEqual(['fail', 'warn', 'pass'])
  })
})
