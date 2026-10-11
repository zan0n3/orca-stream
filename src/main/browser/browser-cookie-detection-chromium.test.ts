import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectInstalledBrowsers } from './browser-cookie-detection'

describe('detectInstalledBrowsers on Linux', () => {
  let configHome: string
  const previousConfigHome = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'orca-cookie-detect-'))
    process.env.XDG_CONFIG_HOME = configHome
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (previousConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousConfigHome
    }
    rmSync(configHome, { recursive: true, force: true })
  })

  function addCookies(root: string): string {
    const directory = join(configHome, root, 'Default')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'Cookies'), '')
    return join(directory, 'Cookies')
  }

  it('finds plain Chromium and Brave as separate browsers', () => {
    const chromiumCookies = addCookies('chromium')
    const braveCookies = addCookies('BraveSoftware/Brave-Browser')

    const browsers = detectInstalledBrowsers().filter((browser) => browser.family !== 'firefox')

    expect(
      browsers.map(({ family, label, cookiesPath, keychainAccount }) => ({
        family,
        label,
        cookiesPath,
        keychainAccount
      }))
    ).toEqual([
      {
        family: 'chromium',
        label: 'Chromium',
        cookiesPath: chromiumCookies,
        keychainAccount: 'Chromium'
      },
      { family: 'brave', label: 'Brave', cookiesPath: braveCookies, keychainAccount: 'Brave' }
    ])
  })
})
