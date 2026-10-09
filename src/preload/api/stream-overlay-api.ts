import type { StreamModeState, StreamOverlayStatus } from '../../shared/stream-overlay'
import type { StreamPrivacyState } from '../../shared/stream-privacy'

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

export type StreamPrivacyApi = {
  getState: () => Promise<StreamPrivacyState>
  set: (enabled: boolean) => Promise<StreamPrivacyState>
  onChanged: (callback: (state: StreamPrivacyState) => void) => () => void
}
