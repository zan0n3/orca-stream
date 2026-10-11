/** A song file in the Suno music folder; `fileName` is its id. */
export type SunoTrack = {
  fileName: string
  title: string
  sizeBytes: number
  addedAt: number
}

/** Title, Suno style prompt and lyrics, ready to paste into Suno's Custom mode. */
export type SunoSongDraft = {
  title: string
  style: string
  lyrics: string
}

export type SunoLyricsRequest = {
  idea: string
  /** Set when revising: the current draft plus what to change. */
  previous?: SunoSongDraft
  feedback?: string
}

export type SunoStreamState = {
  /** File playing through OBS, or null. */
  playing: string | null
  busy: boolean
  /** Last OBS failure, shown in the Suno tab. */
  error: string | null
}

export const SUNO_TRACK_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.flac'] as const

export function isSunoTrackFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SUNO_TRACK_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

const SONG_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SUNO_HOSTS = new Set(['suno.com', 'www.suno.com', 'app.suno.ai', 'suno.ai', 'www.suno.ai'])

/** Returns the song id from a suno.com song URL, or null for anything else. */
export function sunoSongIdFromUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !SUNO_HOSTS.has(url.hostname)) {
    return null
  }
  const match = /^\/song\/([^/]+)/.exec(url.pathname)
  return match && SONG_ID.test(match[1]) && match[1].length === 36 ? match[1].toLowerCase() : null
}

/** True for suno.com links that redirect to a song (share links such as /s/<code>). */
export function isSunoShareUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return (
      url.protocol === 'https:' && SUNO_HOSTS.has(url.hostname) && /^\/s\/\w+/.test(url.pathname)
    )
  } catch {
    return false
  }
}

/** Safe file name stem from a song title. */
export function sunoTrackFileStem(title: string, songId: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return `${stem || 'Suno song'} (${songId.slice(0, 8)})`
}

/** Parses the lyrics writer's reply; tolerates a ```json fence around the object. */
export function parseSunoSongDraft(output: string): SunoSongDraft | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(output.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const field = (key: string): string => {
    const raw: unknown = Reflect.get(value, key)
    return typeof raw === 'string' ? raw.trim() : ''
  }
  const draft = { title: field('title'), style: field('style'), lyrics: field('lyrics') }
  return draft.lyrics ? draft : null
}

export type SunoCreateClip = {
  id: string
  title: string
  /** "m:ss" once Suno has finished generating, "" before. */
  duration: string
  ready: boolean
  downloaded: boolean
}

/** A song being made on suno.com in the user's Orca browser tab. */
export type SunoCreateJob = {
  phase: 'idle' | 'creating' | 'generating' | 'ready' | 'downloading' | 'error'
  title: string
  clips: SunoCreateClip[]
  error: string | null
}
