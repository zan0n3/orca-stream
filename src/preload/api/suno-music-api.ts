import type {
  SunoCreateJob,
  SunoLyricsRequest,
  SunoSongDraft,
  SunoStreamState,
  SunoTrack
} from '../../shared/suno-music'

export type SunoMusicApi = {
  listTracks: () => Promise<SunoTrack[]>
  readTrack: (fileName: string) => Promise<Uint8Array>
  importLink: (link: string) => Promise<SunoTrack>
  /** Opens a file picker (Downloads) and copies the chosen songs into the folder. */
  importFiles: () => Promise<SunoTrack[]>
  openFolder: () => Promise<void>
  writeLyrics: (request: SunoLyricsRequest) => Promise<SunoSongDraft>
  getStreamState: () => Promise<SunoStreamState>
  playOnStream: (fileName: string) => Promise<SunoStreamState>
  stopOnStream: () => Promise<SunoStreamState>
  onStreamChanged: (callback: (state: SunoStreamState) => void) => () => void
  /** True when a suno.com page is open in an Orca browser tab. */
  hasSunoTab: () => Promise<boolean>
  getJob: () => Promise<SunoCreateJob>
  /** Fills Suno's Advanced form in the browser tab and presses Create. */
  createOnSuno: (draft: SunoSongDraft) => Promise<SunoCreateJob>
  togglePlayOnSuno: (clipId: string) => Promise<void>
  /** Uses one of the account's monthly downloads. */
  downloadFromSuno: (clipId: string) => Promise<SunoTrack>
  onJobChanged: (callback: (job: SunoCreateJob) => void) => () => void
}
