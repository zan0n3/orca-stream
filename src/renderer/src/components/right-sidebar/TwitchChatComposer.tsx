import React, { useCallback, useRef, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import {
  TWITCH_CHAT_MAX_MESSAGE_LENGTH,
  type TwitchChatAuthState
} from '../../../../shared/twitch-chat-types'

type TwitchChatComposerProps = {
  auth: TwitchChatAuthState | null
  onSignIn: () => void
}

export function TwitchChatComposer({ auth, onSignIn }: TwitchChatComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const message = text.trim()
      if (!message || sending) {
        return
      }
      setSending(true)
      setError(null)
      const result = await window.api.twitchChat.send(message).catch(() => ({
        ok: false as const,
        error: translate(
          'auto.components.right.sidebar.TwitchChatComposer.sendFailed',
          'Could not send the message.'
        )
      }))
      setSending(false)
      if (result.ok) {
        setText('')
      } else {
        setError(result.error)
      }
      inputRef.current?.focus()
    },
    [sending, text]
  )

  if (auth?.state !== 'signed-in') {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.TwitchChatComposer.signInHint',
            'Sign in to Twitch to chat.'
          )}
        </span>
        <Button variant="outline" size="xs" onClick={onSignIn}>
          {translate('auto.components.right.sidebar.TwitchChatComposer.signIn', 'Sign in…')}
        </Button>
      </div>
    )
  }

  return (
    <form className="space-y-1 border-t border-border px-3 py-2" onSubmit={submit}>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={TWITCH_CHAT_MAX_MESSAGE_LENGTH}
          disabled={sending}
          placeholder={translate(
            'auto.components.right.sidebar.TwitchChatComposer.placeholder',
            'Chat as {{login}}',
            { login: auth.login }
          )}
          aria-label={translate(
            'auto.components.right.sidebar.TwitchChatComposer.inputLabel',
            'Chat message'
          )}
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={sending || !text.trim()}
          aria-label={translate('auto.components.right.sidebar.TwitchChatComposer.send', 'Send')}
        >
          <SendHorizontal />
        </Button>
      </div>
    </form>
  )
}
