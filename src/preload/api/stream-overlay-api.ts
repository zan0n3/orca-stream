import type { StreamModeState, StreamOverlayStatus } from '../../shared/stream-overlay'

export type StreamOverlayApi = {
  getStatus: () => Promise<StreamOverlayStatus>
  onStatusChanged: (callback: (status: StreamOverlayStatus) => void) => () => void
}

export type StreamModeApi = {
  getState: () => Promise<StreamModeState>
  start: () => Promise<StreamModeState>
  stop: () => Promise<StreamModeState>
  openHooksFolder: () => Promise<void>
  onChanged: (callback: (state: StreamModeState) => void) => () => void
}
