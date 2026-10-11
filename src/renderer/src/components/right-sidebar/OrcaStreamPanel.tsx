import React, { useState } from 'react'
import { Loader2, MessageSquare, Music } from 'lucide-react'
import { useAppStore } from '@/store'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { normalizeTwitchChannel } from '../../../../shared/twitch-chat-channel'
import { StreamModeButton, StreamModeHookError } from './StreamModeButton'
import { StreamPrivacyButton } from './StreamPrivacyButton'
import SunoPanel from './SunoPanel'
import TwitchChatPanel, { statusLabel } from './TwitchChatPanel'
import { useTwitchChatSnapshot } from './use-twitch-chat-snapshot'

type StreamPanelTab = 'chat' | 'suno'

// Why module-level: the sidebar unmounts panels on tab switch; coming back should land on the same tab.
let lastStreamPanelTab: StreamPanelTab = 'chat'

function StreamControlsBar(): React.JSX.Element {
  const rawChannel = useAppStore((s) => s.settings?.twitchChatChannel ?? '')
  const snapshot = useTwitchChatSnapshot()
  const channel = normalizeTwitchChannel(rawChannel)
  const status = snapshot?.status ?? 'connecting'
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {channel ? `#${channel}` : ''}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {channel ? (
          <span className="flex items-center gap-1">
            {status === 'connecting' || status === 'reconnecting' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {statusLabel(status)}
          </span>
        ) : null}
        <StreamPrivacyButton />
        <StreamModeButton />
      </span>
    </div>
  )
}

export default function OrcaStreamPanel(): React.JSX.Element {
  const [tab, setTab] = useState<StreamPanelTab>(lastStreamPanelTab)
  const selectTab = (value: string): void => {
    const next: StreamPanelTab = value === 'suno' ? 'suno' : 'chat'
    lastStreamPanelTab = next
    setTab(next)
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-1">
        <Tabs value={tab} onValueChange={selectTab}>
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="chat">
              <MessageSquare />
              {translate('auto.components.right.sidebar.OrcaStreamPanel.chat', 'Chat')}
            </TabsTrigger>
            <TabsTrigger value="suno">
              <Music />
              {translate('auto.components.right.sidebar.OrcaStreamPanel.suno', 'Suno')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <StreamControlsBar />
      <StreamModeHookError />
      <div className="min-h-0 flex-1">{tab === 'chat' ? <TwitchChatPanel /> : <SunoPanel />}</div>
    </div>
  )
}
