import type {
  TwitchChatAuthState,
  TwitchChatSendResult,
  TwitchChatSnapshot
} from '../../shared/twitch-chat-types'

export type TwitchChatApi = {
  getSnapshot: () => Promise<TwitchChatSnapshot>
  onChanged: (callback: (snapshot: TwitchChatSnapshot) => void) => () => void
  getAuthState: () => Promise<TwitchChatAuthState>
  startSignIn: () => Promise<TwitchChatAuthState>
  cancelSignIn: () => Promise<TwitchChatAuthState>
  signOut: () => Promise<TwitchChatAuthState>
  onAuthChanged: (callback: (state: TwitchChatAuthState) => void) => () => void
  send: (text: string) => Promise<TwitchChatSendResult>
}
