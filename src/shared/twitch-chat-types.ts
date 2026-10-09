export type TwitchChatMessage = {
  id: string
  login: string
  displayName: string
  text: string
  /** `/me` messages render as an action line instead of "name: text". */
  isAction: boolean
  sentAt: number
}

export type TwitchChatConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting'

export type TwitchChatSnapshot = {
  /** Monotonic per main process; lets the renderer drop a snapshot older than one it already has. */
  revision: number
  channel: string | null
  status: TwitchChatConnectionStatus
  messages: TwitchChatMessage[]
}
