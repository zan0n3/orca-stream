import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  StreamAudioCheckId,
  StreamAudioCheckResult,
  StreamAudioLevel,
  StreamAudioState
} from '../../../../shared/stream-audio'
import { sunoErrorMessage } from './use-suno-music'

const DISCONNECTED: StreamAudioState = { connected: false, channels: [], error: null }
const NEEDS_RESTART: StreamAudioState = {
  connected: false,
  channels: [],
  error: 'Restart Orca to finish installing the Audio tab.'
}

/** OBS mixer state and live levels while the Audio tab is open, plus the sound checks. */
export function useStreamAudio(): {
  state: StreamAudioState
  levels: Record<string, StreamAudioLevel>
  running: StreamAudioCheckId | null
  results: Partial<Record<StreamAudioCheckId, StreamAudioCheckResult>>
  setVolume: (inputName: string, volumeDb: number) => void
  setMuted: (inputName: string, muted: boolean) => void
  runCheck: (id: StreamAudioCheckId) => Promise<void>
} {
  // Why optional: a hot-reloaded renderer can run ahead of the preload that adds this API.
  const api: typeof window.api.streamAudio | undefined = window.api.streamAudio
  const [state, setState] = useState<StreamAudioState>(api ? DISCONNECTED : NEEDS_RESTART)
  const [levels, setLevels] = useState<Record<string, StreamAudioLevel>>({})
  const [running, setRunning] = useState<StreamAudioCheckId | null>(null)
  const [results, setResults] = useState<
    Partial<Record<StreamAudioCheckId, StreamAudioCheckResult>>
  >({})

  useEffect(() => {
    if (!api) {
      return
    }
    let cancelled = false
    const offState = api.onChanged(setState)
    const offLevels = api.onLevels(setLevels)
    void api.watch().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })
    return () => {
      cancelled = true
      offState()
      offLevels()
      void api.unwatch()
    }
  }, [api])

  const setVolume = useCallback((inputName: string, volumeDb: number) => {
    void window.api.streamAudio
      .setVolume(inputName, volumeDb)
      .catch((error: unknown) => toast.error(sunoErrorMessage(error)))
  }, [])

  const setMuted = useCallback((inputName: string, muted: boolean) => {
    void window.api.streamAudio
      .setMuted(inputName, muted)
      .catch((error: unknown) => toast.error(sunoErrorMessage(error)))
  }, [])

  const runCheck = useCallback(async (id: StreamAudioCheckId): Promise<void> => {
    setRunning(id)
    try {
      const result = await window.api.streamAudio.runCheck(id)
      setResults((previous) => ({ ...previous, [id]: result }))
    } catch (error) {
      toast.error(sunoErrorMessage(error))
    } finally {
      setRunning(null)
    }
  }, [])

  return { state, levels, running, results, setVolume, setMuted, runCheck }
}
