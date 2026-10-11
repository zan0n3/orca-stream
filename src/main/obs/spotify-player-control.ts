import { runProcess } from '../../shared/child-process/run-process'

/** The streamer's music app, paused while a song plays on stream and faded back in after. */
export type MusicPlayerControl = {
  isPlaying: () => Promise<boolean>
  pause: () => Promise<void>
  play: () => Promise<void>
  /** 0..1, the app's own volume (what both the stream and the streamer hear). */
  getVolume: () => Promise<number>
  setVolume: (volume: number) => Promise<void>
}

const MPRIS = ['org.mpris.MediaPlayer2.spotify', '/org/mpris/MediaPlayer2']
const PLAYER = 'org.mpris.MediaPlayer2.Player'

async function busctl(args: string[]): Promise<string> {
  const result = await runProcess({ program: 'busctl', args: ['--user', ...args], timeoutMs: 3000 })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Spotify is not reachable over MPRIS.')
  }
  return result.stdout.trim()
}

/** Spotify over MPRIS (D-Bus); null where MPRIS does not exist. */
export function createSpotifyPlayerControl(): MusicPlayerControl | null {
  if (process.platform !== 'linux') {
    return null
  }
  return {
    isPlaying: async () =>
      (await busctl(['get-property', ...MPRIS, PLAYER, 'PlaybackStatus']).catch(() => '')) ===
      's "Playing"',
    pause: async () => {
      await busctl(['call', ...MPRIS, PLAYER, 'Pause'])
    },
    play: async () => {
      await busctl(['call', ...MPRIS, PLAYER, 'Play'])
    },
    getVolume: async () => {
      // Output looks like `d 0.559442`.
      const volume = Number((await busctl(['get-property', ...MPRIS, PLAYER, 'Volume'])).slice(2))
      return Number.isFinite(volume) ? volume : 1
    },
    setVolume: async (volume) => {
      await busctl(['set-property', ...MPRIS, PLAYER, 'Volume', 'd', volume.toFixed(4)])
    }
  }
}
