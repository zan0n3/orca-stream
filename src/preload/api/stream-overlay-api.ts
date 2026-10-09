import type { StreamOverlayStatus } from '../../shared/stream-overlay'

export type StreamOverlayApi = {
  getStatus: () => Promise<StreamOverlayStatus>
  onStatusChanged: (callback: (status: StreamOverlayStatus) => void) => () => void
}
