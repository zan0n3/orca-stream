import { useEffect, useState } from 'react'
import type { TwitchChatSnapshot } from '../../../../shared/twitch-chat-types'

export function useTwitchChatSnapshot(): TwitchChatSnapshot | null {
  const [snapshot, setSnapshot] = useState<TwitchChatSnapshot | null>(null)

  useEffect(() => {
    let disposed = false
    // Why: the initial fetch can resolve after a newer push; keep whichever revision is latest.
    const accept = (next: TwitchChatSnapshot | null | undefined): void => {
      if (disposed || !next) {
        return
      }
      setSnapshot((previous) => (previous && previous.revision >= next.revision ? previous : next))
    }
    const unsubscribe = window.api.twitchChat.onChanged(accept)
    void window.api.twitchChat.getSnapshot().then(accept, () => {})
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return snapshot
}
