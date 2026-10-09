import type { AgentStatusState } from './agent-status-types'

export const DEFAULT_STREAM_OVERLAY_PORT = 47_320
export const STREAM_OVERLAY_PAGES = ['chat', 'agents'] as const
export type StreamOverlayPage = (typeof STREAM_OVERLAY_PAGES)[number]

export type StreamOverlayAgent = {
  /** Opaque per-pane id; never the pane key itself. */
  id: string
  agent: string
  state: AgentStatusState
  tool: string | null
  since: number
}

export type StreamOverlayChatMessage = {
  id: string
  name: string
  text: string
  isAction: boolean
}

export type StreamOverlayStatus =
  | { state: 'stopped' }
  | { state: 'listening'; port: number }
  | { state: 'error'; port: number; message: string }

export function normalizeStreamOverlayPort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65_535
    ? value
    : DEFAULT_STREAM_OVERLAY_PORT
}

export function buildStreamOverlayUrl(
  port: number,
  token: string,
  page: StreamOverlayPage
): string {
  return `http://127.0.0.1:${port}/overlay/${page}?token=${encodeURIComponent(token)}`
}

/** Display form for UI that may be on stream; only the clipboard ever gets the real token. */
export function buildMaskedStreamOverlayUrl(port: number, page: StreamOverlayPage): string {
  return `127.0.0.1:${port}/overlay/${page}?token=••••••`
}

export const STREAM_CHAT_WINDOW_TITLE = 'Orca Stream Chat'

export type StreamModeState = {
  active: boolean
  startedAt: number | null
  /** Last start/stop script failure, shown in the UI; null when the script ran or none exists. */
  hookError: string | null
}
