import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BrowserWindow, Display } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  StreamModeService,
  pickStreamChatDisplay,
  streamChatWindowBounds
} from './stream-mode-service'

function display(id: number, width: number, height: number, x = 0): Display {
  const bounds = { x, y: 0, width, height }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the code under test reads only id, bounds, and workArea.
  return { id, bounds, workArea: bounds } as Display
}

function fakeWindow() {
  const handlers: Record<string, () => void> = {}
  const window = {
    closed: false,
    isDestroyed: () => window.closed,
    close: () => {
      window.closed = true
      handlers.closed?.()
    },
    on: (event: string, handler: () => void) => {
      handlers[event] = handler
    }
  }
  return window
}

function setup(overrides: { hooksDirectory?: string; url?: string | null } = {}) {
  const windows: ReturnType<typeof fakeWindow>[] = []
  const runHook = vi.fn(
    async (_file: string, _env: NodeJS.ProcessEnv): Promise<string | null> => null
  )
  const onChange = vi.fn()
  const enableStreamFeatures = vi.fn()
  const service = new StreamModeService({
    hooksDirectory: overrides.hooksDirectory ?? mkdtempSync(path.join(tmpdir(), 'stream-hooks-')),
    enableStreamFeatures,
    getOverlayUrl: (page, query = '') =>
      overrides.url === null ? null : `http://127.0.0.1:1/overlay/${page}?token=t${query}`,
    openChatWindow: () => {
      const window = fakeWindow()
      windows.push(window)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service only calls on/close/isDestroyed, which the fake implements.
      return window as unknown as BrowserWindow
    },
    onChange,
    platform: 'linux',
    sleep: async () => {},
    runHook
  })
  return { service, windows, runHook, onChange, enableStreamFeatures }
}

function writeHook(directory: string, name: string): string {
  const file = path.join(directory, name)
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
  return file
}

describe('pickStreamChatDisplay', () => {
  it('prefers a vertical secondary display, then any secondary, then none', () => {
    const main = display(1, 3840, 2160, 2160)
    const vertical = display(2, 2160, 3840)
    const wide = display(3, 1920, 1080, 6000)
    expect(pickStreamChatDisplay([main, wide, vertical], 1)?.id).toBe(2)
    expect(pickStreamChatDisplay([main, wide], 1)?.id).toBe(3)
    expect(pickStreamChatDisplay([main], 1)).toBeNull()
  })

  it('docks the chat window to the bottom-right of the work area', () => {
    expect(streamChatWindowBounds(display(2, 2160, 3840))).toEqual({
      x: 1720,
      y: 2940,
      width: 440,
      height: 900
    })
  })
})

describe('StreamModeService', () => {
  it('goes live: enables features, opens one chat window, runs stream-start with URLs', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-hooks-'))
    const startHook = writeHook(directory, 'stream-start')
    const { service, windows, runHook, enableStreamFeatures } = setup({ hooksDirectory: directory })

    await Promise.all([service.start(), service.start()])

    expect(enableStreamFeatures).toHaveBeenCalledTimes(1)
    expect(windows).toHaveLength(1)
    expect(runHook).toHaveBeenCalledTimes(1)
    expect(runHook).toHaveBeenCalledWith(
      startHook,
      expect.objectContaining({
        ORCA_STREAM_CHAT_URL: 'http://127.0.0.1:1/overlay/chat?token=t&reader=1',
        ORCA_STREAM_OVERLAY_AGENTS_URL: 'http://127.0.0.1:1/overlay/agents?token=t'
      })
    )
    expect(service.getState()).toMatchObject({ active: true, hookError: null })
  })

  it('ends the stream: closes the chat window and runs stream-stop', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-hooks-'))
    const stopHook = writeHook(directory, 'stream-stop')
    const { service, windows, runHook } = setup({ hooksDirectory: directory })
    await service.start()
    expect(runHook).not.toHaveBeenCalled()

    await service.stop()
    expect(windows[0].closed).toBe(true)
    expect(runHook).toHaveBeenCalledWith(stopHook, expect.any(Object))
    expect(service.getState()).toEqual({ active: false, startedAt: null, hookError: null })
  })

  it('reports a failing script without leaving stream mode', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-hooks-'))
    writeHook(directory, 'stream-start')
    const { service, runHook } = setup({ hooksDirectory: directory })
    runHook.mockResolvedValueOnce('stream-start exited with code 1: obs not found')
    await service.start()
    expect(service.getState()).toMatchObject({
      active: true,
      hookError: 'stream-start exited with code 1: obs not found'
    })
  })

  it('ignores scripts that are not executable and goes live without a chat window when the overlay never starts', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'stream-hooks-'))
    writeFileSync(path.join(directory, 'stream-start'), '#!/bin/sh\n')
    const { service, windows, runHook } = setup({ hooksDirectory: directory, url: null })
    await service.start()
    expect(runHook).not.toHaveBeenCalled()
    expect(windows).toHaveLength(0)
    expect(service.getState().active).toBe(true)
  })
})
