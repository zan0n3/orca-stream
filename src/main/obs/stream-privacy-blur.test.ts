import { describe, expect, it } from 'vitest'
import { StreamPrivacyBlur } from './stream-privacy-blur'
import type { ObsSession } from './obs-websocket-session'

function fakeObs(existingFilters: string[] = []) {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const session: ObsSession = {
    request: async (type, data) => {
      calls.push([type, data])
      switch (type) {
        case 'GetInputList':
          return {
            inputs: [
              { inputName: 'Mic', unversionedInputKind: 'pulse_input_capture' },
              { inputName: 'Desktop', unversionedInputKind: 'pipewire-screen-capture-source' }
            ]
          }
        case 'GetCurrentProgramScene':
          return { sceneName: 'Main' }
        case 'GetVideoSettings':
          return { baseWidth: 1920, baseHeight: 1080 }
        case 'GetSceneItemList':
          return {
            sceneItems: [
              {
                sourceName: 'Desktop',
                sceneItemTransform: { sourceWidth: 3840, sourceHeight: 2160 }
              }
            ]
          }
        case 'GetSourceFilterList':
          return { filters: existingFilters.map((filterName) => ({ filterName })) }
        default:
          return {}
      }
    },
    close: () => {}
  }
  const states: boolean[] = []
  const blur = new StreamPrivacyBlur({
    openSession: async () => session,
    onChange: (state) => states.push(state.enabled)
  })
  const enabledCalls = () =>
    calls
      .filter(([type]) => type === 'SetSourceFilterEnabled')
      .map(([, data]) => `${String(data?.filterName)}=${String(data?.filterEnabled)}`)
  return { blur, calls, enabledCalls }
}

describe('StreamPrivacyBlur', () => {
  it('creates both filters once, sizes the restore filter, and enables stretch before shrink', async () => {
    const { blur, calls, enabledCalls } = fakeObs()
    const state = await blur.setEnabled(true)
    expect(state).toEqual({ enabled: true, busy: false, error: null })
    expect(
      calls.filter(([type]) => type === 'CreateSourceFilter').map(([, d]) => d?.sourceName)
    ).toEqual(['Desktop', 'Desktop'])
    expect(calls.find(([type]) => type === 'SetSourceFilterSettings')?.[1]).toMatchObject({
      filterSettings: { resolution: '3840x2160' }
    })
    expect(enabledCalls().slice(-2)).toEqual([
      'Orca privacy blur (restore size)=true',
      'Orca privacy blur=true'
    ])
  })

  it('disables shrink before stretch and toggles in press order', async () => {
    const { blur, enabledCalls } = fakeObs([
      'Orca privacy blur',
      'Orca privacy blur (restore size)'
    ])
    await Promise.all([blur.setEnabled('toggle'), blur.setEnabled('toggle')])
    expect(blur.getState().enabled).toBe(false)
    expect(enabledCalls().slice(-2)).toEqual([
      'Orca privacy blur=false',
      'Orca privacy blur (restore size)=false'
    ])
  })

  it('reports OBS being unreachable without changing state', async () => {
    const blur = new StreamPrivacyBlur({
      openSession: () => Promise.reject(new Error('Could not reach OBS')),
      onChange: () => {}
    })
    expect(await blur.setEnabled(true)).toEqual({
      enabled: false,
      busy: false,
      error: 'Could not reach OBS'
    })
  })
})
