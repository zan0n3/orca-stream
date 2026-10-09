import type { TwitchChatSnapshot } from '../../shared/twitch-chat-types'

export type TwitchChatApi = {
  getSnapshot: () => Promise<TwitchChatSnapshot>
  onChanged: (callback: (snapshot: TwitchChatSnapshot) => void) => () => void
}
