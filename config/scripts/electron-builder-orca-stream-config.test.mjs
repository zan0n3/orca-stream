import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const release = require('../electron-builder.config.cjs')
const orcaStream = require('../electron-builder-orca-stream.config.cjs')

describe('Orca Stream electron-builder config', () => {
  it('never shares install, data, or update identity with stock Orca', () => {
    expect(orcaStream.appId).toBe('com.orca-stream.app')
    expect(orcaStream.appId).not.toBe(release.appId)
    expect(orcaStream.productName).toBe('Orca Stream')
    expect(orcaStream.extraMetadata.productName).toBe('Orca Stream')
    expect(orcaStream.win.executableName).toBe('Orca Stream')
    expect(orcaStream.nsis.artifactName).toBe('orca-stream-windows-setup.${ext}')
    expect(orcaStream.publish).toBeNull()
    expect(orcaStream.win.signtoolOptions.publisherName).toBeUndefined()
  })

  it('keeps the release packaging inputs', () => {
    expect(orcaStream.win.extraResources).toBe(release.win.extraResources)
    expect(orcaStream.nsis.include).toBe(release.nsis.include)
    expect(orcaStream.afterPack).toBe(release.afterPack)
  })
})
