import type { StreamPrivacyState } from '../../shared/stream-privacy'
import type { ObsSession } from './obs-websocket-session'

// Why two scale filters: OBS has no built-in blur; shrinking then stretching back blurs without
// moving the source, which a single scale filter would do on items without a bounding box.
const BLUR_DOWN_FILTER = 'Orca privacy blur'
const BLUR_UP_FILTER = 'Orca privacy blur (restore size)'
const BLUR_RESOLUTION = '192x108'

// Why kinds, not names: blur whatever shows the screen (Linux, macOS, Windows captures) without setup.
const SCREEN_CAPTURE_KINDS = new Set([
  'pipewire-screen-capture-source',
  'pipewire-desktop-capture-source',
  'pipewire-window-capture-source',
  'xshm_input',
  'xcomposite_input',
  'display_capture',
  'screen_capture',
  'window_capture',
  'monitor_capture',
  'game_capture'
])

type StreamPrivacyBlurOptions = {
  openSession: () => Promise<ObsSession>
  onChange: (state: StreamPrivacyState) => void
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return null
  }
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : null
}

function screenCaptureInputs(response: Record<string, unknown>): string[] {
  const inputs = Array.isArray(response.inputs) ? response.inputs : []
  return inputs.flatMap((input: unknown) => {
    const name = stringField(input, 'inputName')
    const kind = stringField(input, 'unversionedInputKind') ?? stringField(input, 'inputKind')
    return name && kind && SCREEN_CAPTURE_KINDS.has(kind) ? [name] : []
  })
}

/** Blurs every screen/window capture in OBS while on; the streamer's own monitor stays sharp. */
export class StreamPrivacyBlur {
  private state: StreamPrivacyState = { enabled: false, busy: false, error: null }
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: StreamPrivacyBlurOptions) {}

  getState(): StreamPrivacyState {
    return this.state
  }

  // Why serialized: a double-pressed toggle must land in press order, never interleaved filter flips.
  setEnabled(enabled: boolean | 'toggle'): Promise<StreamPrivacyState> {
    // Why resolve 'toggle' in the queue: two quick presses must flip twice, not both read the same state.
    const run = this.queue.then(() =>
      this.apply(enabled === 'toggle' ? !this.state.enabled : enabled)
    )
    this.queue = run.catch(() => {})
    return run.then(() => this.state)
  }

  private async apply(enabled: boolean): Promise<void> {
    this.setState({ ...this.state, busy: true, error: null })
    let session: ObsSession | null = null
    try {
      session = await this.options.openSession()
      const sources = screenCaptureInputs(await session.request('GetInputList'))
      if (sources.length === 0) {
        throw new Error('OBS has no screen or window capture source to blur.')
      }
      const scene = stringField(await session.request('GetCurrentProgramScene'), 'sceneName')
      const canvas = await session.request('GetVideoSettings')
      for (const source of sources) {
        await this.ensureFilters(session, source)
        if (enabled) {
          await this.sizeRestoreFilter(session, scene, source, canvas)
        }
        // Why this order: the stretch filter alone is a no-op, so the source never flashes small.
        const order = enabled
          ? [BLUR_UP_FILTER, BLUR_DOWN_FILTER]
          : [BLUR_DOWN_FILTER, BLUR_UP_FILTER]
        for (const filterName of order) {
          await session.request('SetSourceFilterEnabled', {
            sourceName: source,
            filterName,
            filterEnabled: enabled
          })
        }
      }
      this.setState({ enabled, busy: false, error: null })
    } catch (error) {
      this.setState({
        ...this.state,
        busy: false,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      session?.close()
    }
  }

  private async ensureFilters(session: ObsSession, source: string): Promise<void> {
    const response = await session.request('GetSourceFilterList', { sourceName: source })
    const filters = Array.isArray(response.filters) ? response.filters : []
    const existing = new Set(filters.map((filter: unknown) => stringField(filter, 'filterName')))
    // Why area then bilinear: averaging on the way down is what makes it a blur, not sparkly pixels.
    const wanted: [string, string, string][] = [
      [BLUR_DOWN_FILTER, BLUR_RESOLUTION, 'area'],
      [BLUR_UP_FILTER, '', 'bilinear']
    ]
    for (const [filterName, resolution, sampling] of wanted) {
      if (existing.has(filterName)) {
        continue
      }
      await session.request('CreateSourceFilter', {
        sourceName: source,
        filterName,
        filterKind: 'scale_filter',
        filterSettings: { sampling, resolution }
      })
      await session.request('SetSourceFilterEnabled', {
        sourceName: source,
        filterName,
        filterEnabled: false
      })
    }
  }

  // Why at enable time: the true size is only readable while the blur is off, and monitors change.
  private async sizeRestoreFilter(
    session: ObsSession,
    scene: string | null,
    source: string,
    canvas: Record<string, unknown>
  ): Promise<void> {
    let width = Number(canvas.baseWidth)
    let height = Number(canvas.baseHeight)
    if (scene) {
      const items = await session.request('GetSceneItemList', { sceneName: scene })
      const list = Array.isArray(items.sceneItems) ? items.sceneItems : []
      const item = list.find((entry: unknown) => stringField(entry, 'sourceName') === source)
      const transform: unknown = item ? Reflect.get(item, 'sceneItemTransform') : null
      const sourceWidth = transform ? Number(Reflect.get(transform, 'sourceWidth')) : 0
      const sourceHeight = transform ? Number(Reflect.get(transform, 'sourceHeight')) : 0
      if (
        sourceWidth > 0 &&
        sourceHeight > 0 &&
        `${sourceWidth}x${sourceHeight}` !== BLUR_RESOLUTION
      ) {
        width = sourceWidth
        height = sourceHeight
      }
    }
    if (!(width > 0 && height > 0)) {
      return
    }
    await session.request('SetSourceFilterSettings', {
      sourceName: source,
      filterName: BLUR_UP_FILTER,
      filterSettings: {
        sampling: 'bilinear',
        resolution: `${Math.round(width)}x${Math.round(height)}`
      }
    })
  }

  private setState(state: StreamPrivacyState): void {
    this.state = state
    this.options.onChange(state)
  }
}
