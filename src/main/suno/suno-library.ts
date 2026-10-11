import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  isSunoShareUrl,
  isSunoTrackFileName,
  sunoSongIdFromUrl,
  sunoTrackFileStem,
  type SunoTrack
} from '../../shared/suno-music'

const MAX_TRACK_BYTES = 40 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

function trackTitle(fileName: string): string {
  return path
    .parse(fileName)
    .name.replace(/ \([0-9a-f]{8}\)$/i, '')
    .trim()
}

export async function listSunoTracks(directory: string): Promise<SunoTrack[]> {
  await mkdir(directory, { recursive: true })
  const names = (await readdir(directory)).filter(isSunoTrackFileName)
  const tracks = await Promise.all(
    names.map(async (fileName) => {
      const info = await stat(path.join(directory, fileName))
      return info.isFile()
        ? [{ fileName, title: trackTitle(fileName), sizeBytes: info.size, addedAt: info.mtimeMs }]
        : []
    })
  )
  return tracks.flat().sort((a, b) => b.addedAt - a.addedAt)
}

/** Absolute path of a track; rejects anything that isn't a plain song file name in the folder. */
export function sunoTrackPath(directory: string, fileName: string): string {
  if (path.basename(fileName) !== fileName || !isSunoTrackFileName(fileName)) {
    throw new Error('Not a song file in the Suno folder.')
  }
  return path.join(directory, fileName)
}

export async function readSunoTrack(directory: string, fileName: string): Promise<Uint8Array> {
  const filePath = sunoTrackPath(directory, fileName)
  if ((await stat(filePath)).size > MAX_TRACK_BYTES) {
    throw new Error('Song file is too large to preview.')
  }
  return readFile(filePath)
}

function pageTitle(html: string): string {
  const match =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html) ??
    /<title>([^<]*)<\/title>/i.exec(html)
  const raw = match?.[1] ?? ''
  // Why: pages Suno doesn't render server-side carry the generic site title.
  if (/^Suno\s*\|/i.test(raw.trim())) {
    return ''
  }
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s*[|·-]\s*Suno\s*$/i, '')
    .trim()
}

function isPlayableAudio(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...bytes.subarray(start, end))
  return (
    ascii(0, 3) === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
    ascii(4, 8) === 'ftyp' ||
    ascii(0, 4) === 'RIFF' ||
    ascii(0, 4) === 'OggS' ||
    ascii(0, 4) === 'fLaC'
  )
}

/** Copies chosen audio files into the folder; existing names are kept, not overwritten. */
export async function importSunoTrackFiles(
  directory: string,
  sourcePaths: string[]
): Promise<SunoTrack[]> {
  await mkdir(directory, { recursive: true })
  const imported: SunoTrack[] = []
  for (const sourcePath of sourcePaths) {
    const fileName = path.basename(sourcePath)
    if (!isSunoTrackFileName(fileName)) {
      continue
    }
    const target = path.join(directory, fileName)
    if (path.resolve(sourcePath) !== path.resolve(target)) {
      await copyFile(sourcePath, target)
    }
    const info = await stat(target)
    imported.push({
      fileName,
      title: trackTitle(fileName),
      sizeBytes: info.size,
      addedAt: info.mtimeMs
    })
  }
  return imported
}

// Why the page: Suno's audio lives at an unguessable CDN path that only the song page (or the logged-in API) reveals.
function pageAudioUrl(html: string, songId: string): string | null {
  const pattern = new RegExp(
    `https://[a-z0-9.-]+\\.(?:cloudfront\\.net|suno\\.ai)/[\\w/.-]*${songId}\\.(?:m4a|mp3)`,
    'i'
  )
  return pattern.exec(html)?.[0] ?? null
}

/** Downloads a Suno song from its share or song link into the folder. */
export async function importSunoSongLink(directory: string, link: string): Promise<SunoTrack> {
  if (!sunoSongIdFromUrl(link) && !isSunoShareUrl(link)) {
    throw new Error('Paste a suno.com song link (suno.com/song/… or suno.com/s/…).')
  }
  let songId = sunoSongIdFromUrl(link)
  let html = ''
  try {
    const page = await fetch(link.trim(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    songId ??= sunoSongIdFromUrl(page.url)
    html = await page.text()
  } catch (error) {
    if (!songId) {
      throw new Error(`Could not open the Suno link: ${errorMessage(error)}`)
    }
  }
  if (!songId) {
    throw new Error('That link did not lead to a Suno song.')
  }
  const audioUrl = pageAudioUrl(html, songId) ?? `https://cdn1.suno.ai/${songId}.mp3`
  await mkdir(directory, { recursive: true })
  const fileName = `${sunoTrackFileStem(pageTitle(html), songId)}${path.extname(new URL(audioUrl).pathname)}`
  const filePath = path.join(directory, fileName)
  const existing = await stat(filePath).catch(() => null)
  if (!existing) {
    const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 4) })
    if (!audio.ok) {
      throw new Error(
        audio.status === 404 || audio.status === 403
          ? 'Suno has no audio for that song yet. Wait until it finishes generating.'
          : `Suno download failed (HTTP ${audio.status}).`
      )
    }
    const bytes = new Uint8Array(await audio.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TRACK_BYTES) {
      throw new Error('Suno sent an empty or oversized file.')
    }
    // Why: Suno's player streams scrambled audio; saving it would give a file nothing can play.
    if (!isPlayableAudio(bytes)) {
      throw new Error(
        'Suno doesn’t offer a direct download for this song. Use Download → MP3 in Suno, then Import file.'
      )
    }
    await writeFile(filePath, bytes)
  }
  const info = await stat(filePath)
  return { fileName, title: trackTitle(fileName), sizeBytes: info.size, addedAt: info.mtimeMs }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
