import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type {
  SunoCreateJob,
  SunoSongDraft,
  SunoStreamState,
  SunoTrack
} from '../../../../shared/suno-music'

function errorMessage(error: unknown): string {
  // Why strip: Electron prefixes IPC rejections with "Error invoking remote method '…': Error: ".
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function useSunoTracks(): {
  tracks: SunoTrack[]
  loading: boolean
  importing: boolean
  refresh: () => void
  importLink: (link: string) => Promise<boolean>
} {
  const [tracks, setTracks] = useState<SunoTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    window.api.sunoMusic
      .listTracks()
      .then(setTracks)
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    // Why focus: songs saved from the browser or file manager should appear without a manual refresh.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const importLink = useCallback(
    async (link: string): Promise<boolean> => {
      setImporting(true)
      try {
        const track = await window.api.sunoMusic.importLink(link)
        toast.success(
          translate('auto.components.right.sidebar.SunoPanel.imported', 'Added “{{title}}”', {
            title: track.title
          })
        )
        refresh()
        return true
      } catch (error) {
        toast.error(errorMessage(error))
        return false
      } finally {
        setImporting(false)
      }
    },
    [refresh]
  )

  return { tracks, loading, importing, refresh, importLink }
}

export function useSunoStream(): {
  state: SunoStreamState
  play: (fileName: string) => void
  stop: () => void
} {
  const [state, setState] = useState<SunoStreamState>({ playing: null, busy: false, error: null })

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.sunoMusic.onStreamChanged(setState)
    void window.api.sunoMusic.getStreamState().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const play = useCallback((fileName: string) => {
    void window.api.sunoMusic.playOnStream(fileName).catch((error: unknown) => {
      toast.error(errorMessage(error))
    })
  }, [])
  const stop = useCallback(() => {
    void window.api.sunoMusic.stopOnStream().catch((error: unknown) => {
      toast.error(errorMessage(error))
    })
  }, [])

  return { state, play, stop }
}

/** Local-only preview: plays in Orca, never touches OBS. */
export function useSunoPreview(): {
  file: string | null
  url: string | null
  open: (fileName: string) => void
  close: () => void
} {
  const [preview, setPreview] = useState<{ file: string; url: string } | null>(null)
  const urlRef = useRef<string | null>(null)

  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const open = useCallback(
    (fileName: string) => {
      void window.api.sunoMusic
        .readTrack(fileName)
        .then((bytes) => {
          release()
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
          urlRef.current = url
          setPreview({ file: fileName, url })
        })
        .catch((error: unknown) => toast.error(errorMessage(error)))
    },
    [release]
  )

  const close = useCallback(() => {
    release()
    setPreview(null)
  }, [release])

  useEffect(() => release, [release])

  return { file: preview?.file ?? null, url: preview?.url ?? null, open, close }
}

export { errorMessage as sunoErrorMessage }

const IDLE_JOB: SunoCreateJob = { phase: 'idle', title: '', clips: [], error: null }
const SUNO_CREATE_URL = 'https://suno.com/create'

/** The song being made on suno.com in the Orca browser tab, plus actions on its takes. */
export function useSunoJob(onDownloaded: () => void): {
  job: SunoCreateJob
  create: (draft: SunoSongDraft) => Promise<void>
  togglePlay: (clipId: string) => void
  download: (clipId: string) => void
} {
  const [job, setJob] = useState<SunoCreateJob>(IDLE_JOB)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.sunoMusic.onJobChanged(setJob)
    void window.api.sunoMusic.getJob().then((next) => {
      if (!cancelled) {
        setJob(next)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const create = useCallback(async (draft: SunoSongDraft): Promise<void> => {
    try {
      if (!(await window.api.sunoMusic.hasSunoTab())) {
        // Why a real tab: Suno needs the user's signed-in browser session and a place to solve captchas.
        await useAppStore.getState().openBrowserProfileTabInActiveWorkspace(SUNO_CREATE_URL, null)
        for (let i = 0; i < 40 && !(await window.api.sunoMusic.hasSunoTab()); i++) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      await window.api.sunoMusic.createOnSuno(draft)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [])

  const togglePlay = useCallback((clipId: string) => {
    void window.api.sunoMusic.togglePlayOnSuno(clipId).catch((error: unknown) => {
      toast.error(errorMessage(error))
    })
  }, [])

  const download = useCallback(
    (clipId: string) => {
      void window.api.sunoMusic
        .downloadFromSuno(clipId)
        .then((track) => {
          toast.success(
            translate('auto.components.right.sidebar.SunoPanel.imported', 'Added “{{title}}”', {
              title: track.title
            })
          )
          onDownloaded()
        })
        .catch((error: unknown) => toast.error(errorMessage(error)))
    },
    [onDownloaded]
  )

  return { job, create, togglePlay, download }
}
