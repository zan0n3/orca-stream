import { afterEach, describe, expect, it } from 'vitest'
import { getDevInstanceIdentity } from './dev-instance-identity'
import { detectPackagedOrcaStream, isPackagedOrcaStream } from './orca-stream-product'

describe('packaged Orca Stream identity', () => {
  afterEach(() => detectPackagedOrcaStream({ isPackaged: false, getName: () => 'Orca' }))

  it('applies only to a packaged build named Orca Stream', () => {
    detectPackagedOrcaStream({ isPackaged: false, getName: () => 'Orca Stream' })
    expect(isPackagedOrcaStream()).toBe(false)
    detectPackagedOrcaStream({ isPackaged: true, getName: () => 'orca' })
    expect(isPackagedOrcaStream()).toBe(false)
    detectPackagedOrcaStream({ isPackaged: true, getName: () => 'Orca Stream' })
    expect(isPackagedOrcaStream()).toBe(true)
  })

  it('names the app and its AUMID after Orca Stream, and leaves stock and dev alone', () => {
    expect(getDevInstanceIdentity(false, {})).toMatchObject({
      appName: 'Orca',
      appUserModelId: 'com.stablyai.orca'
    })
    detectPackagedOrcaStream({ isPackaged: true, getName: () => 'Orca Stream' })
    expect(getDevInstanceIdentity(false, {})).toMatchObject({
      name: 'Orca Stream',
      appName: 'Orca Stream',
      appUserModelId: 'com.orca-stream.app'
    })
    expect(getDevInstanceIdentity(true, {}).appName).toBe('Orca Dev')
  })
})
