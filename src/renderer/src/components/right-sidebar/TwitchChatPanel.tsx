import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { normalizeTwitchChannel } from '../../../../shared/twitch-chat-channel'
import type {
  TwitchChatConnectionStatus,
  TwitchChatMessage
} from '../../../../shared/twitch-chat-types'
import { useTwitchChatSnapshot } from './use-twitch-chat-snapshot'
import { StreamModeButton, StreamModeHookError } from './StreamModeButton'
import { TwitchChatComposer } from './TwitchChatComposer'
import { useTwitchChatAuth } from './use-twitch-chat-auth'

// Why: within this many px of the bottom still counts as "following" so sub-pixel scroll drift doesn't unstick.
const STICK_TO_BOTTOM_THRESHOLD_PX = 24

function statusLabel(status: TwitchChatConnectionStatus): string {
  switch (status) {
    case 'connected':
      return translate('auto.components.right.sidebar.TwitchChatPanel.connected', 'Connected')
    case 'reconnecting':
      return translate(
        'auto.components.right.sidebar.TwitchChatPanel.reconnecting',
        'Reconnecting…'
      )
    case 'connecting':
      return translate('auto.components.right.sidebar.TwitchChatPanel.connecting', 'Connecting…')
    case 'disabled':
      return translate('auto.components.right.sidebar.TwitchChatPanel.disconnected', 'Disconnected')
  }
}

function TwitchChatMessageRow({ message }: { message: TwitchChatMessage }): React.JSX.Element {
  if (message.isAction) {
    return (
      <p className="break-words text-[13px] leading-snug italic text-muted-foreground">
        <span className="font-semibold">{message.displayName}</span> {message.text}
      </p>
    )
  }
  return (
    <p className="break-words text-[13px] leading-snug text-foreground">
      <span className="font-semibold">{message.displayName}</span>
      <span className="text-muted-foreground">: </span>
      {message.text}
    </p>
  )
}

export default function TwitchChatPanel(): React.JSX.Element {
  const rawChannel = useAppStore((s) => s.settings?.twitchChatChannel ?? '')
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const snapshot = useTwitchChatSnapshot()
  const auth = useTwitchChatAuth()
  const scrollRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const [following, setFollowing] = useState(true)

  const configuredChannel = normalizeTwitchChannel(rawChannel)
  const messages = useMemo(
    () => (snapshot?.channel === configuredChannel ? snapshot.messages : []),
    [configuredChannel, snapshot]
  )
  const status = snapshot?.status ?? 'connecting'

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && followingRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages])

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      STICK_TO_BOTTOM_THRESHOLD_PX
    followingRef.current = atBottom
    setFollowing(atBottom)
  }, [])

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
    followingRef.current = true
    setFollowing(true)
  }, [])

  const openChannelSettings = useCallback(() => {
    openSettingsTarget({
      pane: 'experimental',
      repoId: null,
      sectionId: 'experimental-twitch-chat'
    })
    openSettingsPage()
  }, [openSettingsPage, openSettingsTarget])

  if (!configuredChannel) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
        <MessageSquare className="mb-3 size-7 opacity-50" />
        <p className="text-sm font-medium">
          {translate('auto.components.right.sidebar.TwitchChatPanel.noChannel', 'No channel set')}
        </p>
        <p className="mt-1 text-xs">
          {translate(
            'auto.components.right.sidebar.TwitchChatPanel.noChannelHint',
            'Choose which Twitch channel’s chat to show.'
          )}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={openChannelSettings}>
          {translate('auto.components.right.sidebar.TwitchChatPanel.setChannel', 'Set channel…')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          #{configuredChannel}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {status === 'connecting' || status === 'reconnecting' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {statusLabel(status)}
          </span>
          <StreamModeButton />
        </span>
      </div>
      <StreamModeHookError />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-sleek h-full space-y-1 overflow-y-auto px-3 py-2"
          role="log"
          aria-label={translate(
            'auto.components.right.sidebar.TwitchChatPanel.logLabel',
            'Twitch chat messages'
          )}
        >
          {messages.length === 0 ? (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              {status === 'connected'
                ? translate(
                    'auto.components.right.sidebar.TwitchChatPanel.waiting',
                    'Waiting for messages…'
                  )
                : statusLabel(status)}
            </p>
          ) : (
            messages.map((message) => <TwitchChatMessageRow key={message.id} message={message} />)
          )}
        </div>
        {!following ? (
          <Button
            variant="outline"
            size="xs"
            className="absolute bottom-2 left-1/2 -translate-x-1/2"
            onClick={jumpToLatest}
          >
            {translate(
              'auto.components.right.sidebar.TwitchChatPanel.jumpToLatest',
              'Jump to latest'
            )}
          </Button>
        ) : null}
      </div>
      <TwitchChatComposer auth={auth} onSignIn={openChannelSettings} />
    </div>
  )
}
