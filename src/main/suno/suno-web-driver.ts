import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { webContents as allWebContents, type WebContents } from 'electron'
import {
  sunoTrackFileStem,
  type SunoCreateJob,
  type SunoSongDraft,
  type SunoTrack
} from '../../shared/suno-music'
import {
  LIST_CLIPS_SCRIPT,
  downloadMp3Script,
  fillAndCreateScript,
  togglePlayScript
} from './suno-page-scripts'

const SUNO_CREATE_URL = 'https://suno.com/create'
const POLL_MS = 3000
// Why 8 min: Suno usually finishes in 1-3 min, but queues stretch under load.
const GENERATION_TIMEOUT_MS = 8 * 60_000
const DOWNLOAD_TIMEOUT_MS = 90_000
// Suno makes two takes per Create.
const TAKES_PER_CREATE = 2

type PageClip = { id: string; title: string; duration: string }

type SunoWebDriverOptions = {
  directory: string
  onChange: (job: SunoCreateJob) => void
  sleep?: (ms: number) => Promise<void>
}

function isSunoPage(contents: WebContents): boolean {
  if (contents.isDestroyed() || contents.getType() !== 'webview') {
    return false
  }
  try {
    const host = new URL(contents.getURL()).hostname
    return host === 'suno.com' || host.endsWith('.suno.com')
  } catch {
    return false
  }
}

/** Drives suno.com in the user's signed-in Orca browser tab: create a song, then download a take. */
export class SunoWebDriver {
  private job: SunoCreateJob = { phase: 'idle', title: '', clips: [], error: null }
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: SunoWebDriverOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  getJob(): SunoCreateJob {
    return this.job
  }

  hasSunoTab(): boolean {
    return allWebContents.getAllWebContents().some(isSunoPage)
  }

  async create(draft: SunoSongDraft): Promise<SunoCreateJob> {
    if (this.job.phase === 'creating' || this.job.phase === 'generating') {
      throw new Error('A song is already being made on Suno.')
    }
    const title = draft.title.trim() || 'Orca song'
    this.setJob({ phase: 'creating', title, clips: [], error: null })
    try {
      const page = await this.createPage()
      const before = new Set<string>(
        await page.executeJavaScript(fillAndCreateScript({ ...draft, title }), true)
      )
      this.setJob({ ...this.job, phase: 'generating' })
      void this.watch(page, before, title)
    } catch (error) {
      this.setJob({ ...this.job, phase: 'error', error: errorMessage(error) })
    }
    return this.job
  }

  async togglePlay(clipId: string): Promise<void> {
    await this.requirePage().executeJavaScript(togglePlayScript(clipId), true)
  }

  async download(clipId: string): Promise<SunoTrack> {
    const clip = this.job.clips.find((entry) => entry.id === clipId)
    if (!clip) {
      throw new Error('That take is not part of the current Suno song.')
    }
    const page = this.requirePage()
    this.setJob({ ...this.job, phase: 'downloading', error: null })
    try {
      const saved = this.nextDownload(page)
      const point: { x: number; y: number } | null = await page.executeJavaScript(
        downloadMp3Script(clipId),
        true
      )
      if (!point) {
        saved.cancel()
        throw new Error('Suno did not offer the MP3 download. Check the Suno tab.')
      }
      this.trustedClick(page, point)
      const savedPath = await saved.done
      await mkdir(this.options.directory, { recursive: true })
      const fileName = `${sunoTrackFileStem(clip.title, clipId)}${path.extname(savedPath) || '.mp3'}`
      const target = path.join(this.options.directory, fileName)
      await copyFile(savedPath, target)
      const info = await stat(target)
      this.setJob({
        ...this.job,
        phase: 'ready',
        clips: this.job.clips.map((entry) =>
          entry.id === clipId ? { ...entry, downloaded: true } : entry
        )
      })
      return { fileName, title: clip.title, sizeBytes: info.size, addedAt: info.mtimeMs }
    } catch (error) {
      this.setJob({ ...this.job, phase: 'ready', error: errorMessage(error) })
      throw error
    }
  }

  private requirePage(): WebContents {
    const page = allWebContents.getAllWebContents().find(isSunoPage)
    if (!page) {
      throw new Error('Open suno.com in an Orca browser tab and sign in first.')
    }
    return page
  }

  private async createPage(): Promise<WebContents> {
    const page = this.requirePage()
    if (!new URL(page.getURL()).pathname.startsWith('/create')) {
      await page.loadURL(SUNO_CREATE_URL)
    }
    return page
  }

  private async watch(page: WebContents, before: Set<string>, title: string): Promise<void> {
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
        await this.sleep(POLL_MS)
        if (page.isDestroyed()) {
          throw new Error('The Suno tab was closed while the song was generating.')
        }
        const clips: PageClip[] = await page.executeJavaScript(LIST_CLIPS_SCRIPT, true)
        const fresh = clips.filter((clip) => !before.has(clip.id)).slice(0, TAKES_PER_CREATE)
        this.setJob({
          ...this.job,
          clips: fresh.map((clip) => ({
            id: clip.id,
            title: clip.title || title,
            duration: clip.duration,
            ready: clip.duration !== '',
            downloaded: false
          }))
        })
        if (fresh.length >= TAKES_PER_CREATE && fresh.every((clip) => clip.duration !== '')) {
          this.setJob({ ...this.job, phase: 'ready' })
          return
        }
      }
      throw new Error('Suno is taking unusually long. Check the Suno tab.')
    } catch (error) {
      this.setJob({ ...this.job, phase: 'error', error: errorMessage(error) })
    }
  }

  private trustedClick(page: WebContents, point: { x: number; y: number }): void {
    const zoom = page.getZoomFactor()
    const x = Math.round(point.x * zoom)
    const y = Math.round(point.y * zoom)
    page.sendInputEvent({ type: 'mouseMove', x, y })
    page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  // Why observe instead of redirect: Orca's own download manager owns the save path and the UI.
  private nextDownload(page: WebContents): { done: Promise<string>; cancel: () => void } {
    const session = page.session
    let listener:
      | ((event: Electron.Event, item: Electron.DownloadItem, from: WebContents) => void)
      | null = null
    let timer: NodeJS.Timeout | null = null
    const cancel = (): void => {
      if (listener) {
        session.removeListener('will-download', listener)
      }
      if (timer) {
        clearTimeout(timer)
      }
    }
    const done = new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        cancel()
        reject(new Error('The MP3 download never started.'))
      }, DOWNLOAD_TIMEOUT_MS)
      listener = (_event, item, from) => {
        if (from.id !== page.id) {
          return
        }
        cancel()
        item.once('done', (_doneEvent, state) => {
          if (state === 'completed') {
            resolve(item.getSavePath())
          } else {
            reject(new Error(`The MP3 download ${state}.`))
          }
        })
      }
      session.on('will-download', listener)
    })
    return { done, cancel }
  }

  private setJob(job: SunoCreateJob): void {
    this.job = job
    this.options.onChange(job)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
