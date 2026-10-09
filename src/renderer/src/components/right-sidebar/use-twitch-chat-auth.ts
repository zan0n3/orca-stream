import { useEffect, useState } from 'react'
import type { TwitchChatAuthState } from '../../../../shared/twitch-chat-types'

export function useTwitchChatAuth(): TwitchChatAuthState | null {
  const [auth, setAuth] = useState<TwitchChatAuthState | null>(null)

  useEffect(() => {
    let disposed = false
    // Why: a push can land before the initial fetch resolves; never let the fetch overwrite it.
    let pushed = false
    const unsubscribe = window.api.twitchChat.onAuthChanged((next) => {
      pushed = true
      if (!disposed) {
        setAuth(next)
      }
    })
    void window.api.twitchChat.getAuthState().then(
      (next) => {
        if (!disposed && !pushed) {
          setAuth(next)
        }
      },
      () => {}
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return auth
}
