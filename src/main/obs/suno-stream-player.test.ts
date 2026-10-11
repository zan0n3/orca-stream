import { describe, expect, it } from 'vitest'
import type { ObsSession } from './obs-websocket-session'
import { SUNO_OBS_INPUT, SunoStreamPlayer } from './suno-stream-player'

function fakeObs(options: { mediaStates: string[]; hasSunoInput?: boolean }) {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const mediaStates = [...options.mediaStates]
  let closed = 0
  const session: ObsSession = {
    request: async (type, data) => {
      calls.push([type, data])
      switch (type) {
        case 'GetInputList':
          return {
            inputs: [
              { inputName: 'Fifine microphone' },
              { inputName: 'Spotify music' },
              ...(options.hasSunoInput ? [{ inputName: SUNO_OBS_INPUT }] : [])
            ]
          }
        case 'GetCurrentProgramScene':
          return { sceneName: 'Main' }
        case 'GetSceneList':
          return { scenes: [{ sceneName: 'Main' }, { sceneName: 'BRB' }] }
        case 'GetSceneItemList':
          return {
            sceneItems:
              data?.sceneName === 'Main' && options.hasSunoInput
                ? [{ sourceName: SUNO_OBS_INPUT }]
                : []
          }
        case 'GetInputMute':
          return { inputMuted: false }
        case 'GetInputVolume':
          return { inputVolumeMul: 0.5 }
        case 'GetMediaInputStatus':
          return { mediaState: mediaStates.shift() ?? 'OBS_MEDIA_STATE_ENDED' }
        default:
          return {}
      }
    },
    close: () => {
      closed++
    }
  }
  const player = new SunoStreamPlayer({
    openSession: async () => session,
    onChange: () => {},
    sleep: async () => {}
  })
  const musicVolumes = () =>
    calls
      .filter(([type, data]) => type === 'SetInputVolume' && data?.inputName === 'Spotify music')
      .map(([, data]) => Number(data?.inputVolumeMul))
  return { player, calls, musicVolumes, closed: () => closed }
}

async function settle(player: SunoStreamPlayer): Promise<void> {
  for (let i = 0; i < 50 && player.getState().playing !== null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('SunoStreamPlayer', () => {
  it('creates the media source in every scene, ducks the music, then restores it when the song ends', async () => {
    const { player, calls, musicVolumes, closed } = fakeObs({
      mediaStates: ['OBS_MEDIA_STATE_OPENING', 'OBS_MEDIA_STATE_PLAYING', 'OBS_MEDIA_STATE_ENDED']
    })
    const started = await player.play('/music/Suno/song.mp3', 'song.mp3')
    expect(started).toMatchObject({ playing: 'song.mp3', error: null })
    expect(calls.find(([type]) => type === 'CreateInput')?.[1]).toMatchObject({
      sceneName: 'Main',
      inputKind: 'ffmpeg_source',
      inputSettings: { local_file: '/music/Suno/song.mp3', looping: false }
    })
    expect(
      calls.filter(([type]) => type === 'CreateSceneItem').map(([, data]) => data?.sceneName)
    ).toEqual(['Main', 'BRB'])

    await settle(player)
    expect(player.getState()).toEqual({ playing: null, busy: false, error: null })
    const volumes = musicVolumes()
    expect(volumes.at(11)).toBeCloseTo(0.06)
    expect(volumes.at(-1)).toBeCloseTo(0.5)
    expect(closed()).toBe(1)
  })

  it('stops the song and restores the music when stopped early', async () => {
    const { player, calls, musicVolumes } = fakeObs({
      hasSunoInput: true,
      mediaStates: Array(100).fill('OBS_MEDIA_STATE_PLAYING')
    })
    await player.play('/music/Suno/song.mp3', 'song.mp3')
    expect(calls.some(([type]) => type === 'CreateInput')).toBe(false)
    const stopped = await player.stop()
    expect(stopped.playing).toBeNull()
    expect(
      calls.some(
        ([type, data]) =>
          type === 'TriggerMediaInputAction' &&
          data?.mediaAction === 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
      )
    ).toBe(true)
    expect(musicVolumes().at(-1)).toBeCloseTo(0.5)
  })

  it('reports an error and restores the music when OBS cannot play the file', async () => {
    const { player, musicVolumes } = fakeObs({ mediaStates: ['OBS_MEDIA_STATE_ERROR'] })
    await player.play('/music/Suno/bad.mp3', 'bad.mp3')
    await settle(player)
    expect(player.getState().error).toBe('OBS could not play this file.')
    expect(musicVolumes().at(-1)).toBeCloseTo(0.5)
  })
})
