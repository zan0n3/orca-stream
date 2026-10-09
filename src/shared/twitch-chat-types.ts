export type TwitchChatMessage = {
  id: string
  login: string
  displayName: string
  text: string
  /** `/me` messages render as an action line instead of "name: text". */
  isAction: boolean
  sentAt: number
  /** Viewer's chosen name color (#rrggbb), or null when they never set one. */
  color: string | null
}

export type TwitchChatConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting'

export type TwitchChatSnapshot = {
  /** Monotonic per main process; lets the renderer drop a snapshot older than one it already has. */
  revision: number
  channel: string | null
  status: TwitchChatConnectionStatus
  messages: TwitchChatMessage[]
}

/** Twitch rejects longer chat messages. */
export const TWITCH_CHAT_MAX_MESSAGE_LENGTH = 500

export type TwitchChatAuthState =
  | { state: 'signed-out'; error: string | null }
  /** Device-code sign-in: the user enters `userCode` at `verificationUri` (prefilled there). */
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number }
  | { state: 'signed-in'; login: string }

export type TwitchChatSendResult = { ok: true } | { ok: false; error: string }

/** Live channel numbers for the stream chat dashboard; a null field means Twitch would not tell us. */
export type TwitchStreamStats = {
  channel: string
  live: boolean
  viewerCount: number | null
  startedAt: number | null
  title: string | null
  category: string | null
  followerCount: number | null
  chatterCount: number | null
  chatters: string[] | null
  updatedAt: number
}
