import type {
  StreamAudioCheckId,
  StreamAudioCheckResult,
  StreamAudioLevel,
  StreamAudioState
} from '../../shared/stream-audio'

export type StreamAudioApi = {
  /** Connects to OBS while the Audio tab is open and starts level updates. */
  watch: () => Promise<StreamAudioState>
  unwatch: () => Promise<void>
  setVolume: (inputName: string, volumeDb: number) => Promise<StreamAudioState>
  setMuted: (inputName: string, muted: boolean) => Promise<StreamAudioState>
  /** Records a few seconds of levels (none for 'setup') and grades them. */
  runCheck: (id: StreamAudioCheckId) => Promise<StreamAudioCheckResult>
  onChanged: (callback: (state: StreamAudioState) => void) => () => void
  onLevels: (callback: (levels: Record<string, StreamAudioLevel>) => void) => () => void
}
