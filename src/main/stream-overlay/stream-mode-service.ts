import { access, constants } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow, Display, Rectangle } from 'electron'
import { runProcess } from '../../shared/child-process/run-process'
import type { StreamModeState, StreamOverlayPage } from '../../shared/stream-overlay'

const HOOK_TIMEOUT_MS = 30_000
const OVERLAY_READY_TIMEOUT_MS = 8_000
const CHAT_WINDOW_SIZE = { width: 440, height: 900 }

export type StreamHookName = 'stream-start' | 'stream-stop'

type StreamModeServiceOptions = {
  hooksDirectory: string
  /** Turns on Twitch chat and the overlay server; idempotent. */
  enableStreamFeatures: () => void
  getOverlayUrl: (page: StreamOverlayPage, query?: string) => string | null
  openChatWindow: (url: string) => BrowserWindow
  onChange: (state: StreamModeState) => void
  platform?: NodeJS.Platform
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  runHook?: (file: string, env: NodeJS.ProcessEnv) => Promise<string | null>
}

/** Picks a vertical secondary display first (a typical chat/OBS screen), then any secondary one. */
export function pickStreamChatDisplay(
  displays: readonly Display[],
  primaryId: number
): Display | null {
  const secondary = displays.filter((display) => display.id !== primaryId)
  return (
    secondary.find((display) => display.bounds.height > display.bounds.width) ??
    secondary[0] ??
    null
  )
}

export function streamChatWindowBounds(display: Display): Rectangle {
  const area = display.workArea
  const width = Math.min(CHAT_WINDOW_SIZE.width, area.width)
  const height = Math.min(CHAT_WINDOW_SIZE.height, area.height)
  return { x: area.x + area.width - width, y: area.y + area.height - height, width, height }
}

async function defaultRunHook(file: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await runProcess({
    program: file,
    env: { ...process.env, ...env },
    cwd: path.dirname(file),
    timeoutMs: HOOK_TIMEOUT_MS
  })
  if (result.timedOut) {
    return `${path.basename(file)} timed out after ${HOOK_TIMEOUT_MS / 1000}s.`
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split('\n').at(-1)
    return `${path.basename(file)} exited with code ${result.code}${detail ? `: ${detail}` : '.'}`
  }
  return null
}

export class StreamModeService {
  private state: StreamModeState = { active: false, startedAt: null, hookError: null }
  private chatWindow: BrowserWindow | null = null
  private transition: Promise<void> = Promise.resolve()
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly runHookFile: (file: string, env: NodeJS.ProcessEnv) => Promise<string | null>

  constructor(private readonly options: StreamModeServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.runHookFile = options.runHook ?? defaultRunHook
  }

  getState(): StreamModeState {
    return this.state
  }

  // Why serialized: a double-clicked Go Live must not open two chat windows or run hooks out of order.
  start(): Promise<StreamModeState> {
    return this.enqueue(async () => {
      if (this.state.active) {
        return
      }
      this.options.enableStreamFeatures()
      this.setState({ active: true, startedAt: this.now(), hookError: null })
      const chatUrl = await this.waitForOverlayUrl('chat', '&reader=1')
      if (chatUrl && this.state.active) {
        this.openChat(chatUrl)
      }
      const hookError = await this.runHook('stream-start', chatUrl)
      if (this.state.active) {
        this.setState({ ...this.state, hookError })
      }
    })
  }

  stop(): Promise<StreamModeState> {
    return this.enqueue(async () => {
      if (!this.state.active) {
        return
      }
      this.closeChat()
      this.setState({ active: false, startedAt: null, hookError: null })
      const hookError = await this.runHook('stream-stop', null)
      if (!this.state.active) {
        this.setState({ ...this.state, hookError })
      }
    })
  }

  dispose(): void {
    this.closeChat()
  }

  private enqueue(work: () => Promise<void>): Promise<StreamModeState> {
    const next = this.transition.then(work, work)
    this.transition = next.catch(() => {})
    return next.then(() => this.state)
  }

  private async waitForOverlayUrl(page: StreamOverlayPage, query: string): Promise<string | null> {
    const deadline = this.now() + OVERLAY_READY_TIMEOUT_MS
    for (;;) {
      const url = this.options.getOverlayUrl(page, query)
      if (url || this.now() >= deadline) {
        return url
      }
      await this.sleep(100)
    }
  }

  private openChat(url: string): void {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      return
    }
    const window = this.options.openChatWindow(url)
    this.chatWindow = window
    window.on('closed', () => {
      if (this.chatWindow === window) {
        this.chatWindow = null
      }
    })
  }

  private closeChat(): void {
    const window = this.chatWindow
    this.chatWindow = null
    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  private async runHook(name: StreamHookName, chatUrl: string | null): Promise<string | null> {
    const file = await this.findHook(name)
    if (!file) {
      return null
    }
    try {
      return await this.runHookFile(file, {
        ORCA_STREAM_CHAT_URL: chatUrl ?? '',
        ORCA_STREAM_OVERLAY_CHAT_URL: this.options.getOverlayUrl('chat') ?? '',
        ORCA_STREAM_OVERLAY_AGENTS_URL: this.options.getOverlayUrl('agents') ?? ''
      })
    } catch (error) {
      return `${path.basename(file)} failed to start: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async findHook(name: StreamHookName): Promise<string | null> {
    const candidates =
      this.platform === 'win32' ? [`${name}.cmd`, `${name}.bat`, `${name}.exe`] : [name]
    for (const candidate of candidates) {
      const file = path.join(this.options.hooksDirectory, candidate)
      try {
        await access(file, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return file
      } catch {
        // Missing or not executable: try the next candidate.
      }
    }
    return null
  }

  private setState(state: StreamModeState): void {
    this.state = state
    this.options.onChange(state)
  }
}
