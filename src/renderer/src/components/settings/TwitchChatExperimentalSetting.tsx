import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { normalizeTwitchChannel } from '../../../../shared/twitch-chat-channel'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { DebouncedSettingsTextInput } from './DebouncedSettingsTextInput'
import { getTwitchChatSearchEntry } from './twitch-chat-search-entry'
import { TwitchChatSignInSetting } from './TwitchChatSignInSetting'

type TwitchChatExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function TwitchChatExperimentalSetting({
  settings,
  updateSettings
}: TwitchChatExperimentalSettingProps): React.JSX.Element {
  const enabled = settings.experimentalTwitchChat === true
  const rawChannel = settings.twitchChatChannel ?? ''
  const invalid = rawChannel !== '' && normalizeTwitchChannel(rawChannel) === null
  const title = translate('auto.components.settings.twitchChat.title', 'Twitch chat')

  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.twitchChat.description',
        'Show a Twitch channel’s live chat in the right sidebar.'
      )}
      keywords={getTwitchChatSearchEntry().keywords}
      className="space-y-3 py-2"
      id="experimental-twitch-chat"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{title}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.twitchChat.copy',
              'Adds a Twitch Chat tab to the right sidebar. Reading chat needs no login; sign in below to send messages.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.twitchChat.toggleLabel',
            'Toggle Twitch chat'
          )}
          onChange={() => updateSettings({ experimentalTwitchChat: !enabled })}
        />
      </div>
      {enabled ? (
        <div className="ml-4 space-y-4 border-l border-border pl-4">
          <div className="space-y-2">
            <Label htmlFor="twitch-chat-channel">
              {translate('auto.components.settings.twitchChat.channelLabel', 'Channel')}
            </Label>
            <DebouncedSettingsTextInput
              id="twitch-chat-channel"
              value={rawChannel}
              commit={(next) => updateSettings({ twitchChatChannel: next })}
              placeholder={translate(
                'auto.components.settings.twitchChat.channelPlaceholder',
                'Channel name or twitch.tv link'
              )}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid || undefined}
              aria-describedby="twitch-chat-channel-description"
            />
            <p id="twitch-chat-channel-description" className="text-xs text-muted-foreground">
              {invalid
                ? translate(
                    'auto.components.settings.twitchChat.channelInvalid',
                    'Use a channel name like “mychannel” or a twitch.tv link.'
                  )
                : translate(
                    'auto.components.settings.twitchChat.channelHint',
                    'Usually your own channel. Changes apply right away.'
                  )}
            </p>
          </div>
          <TwitchChatSignInSetting settings={settings} updateSettings={updateSettings} />
        </div>
      ) : null}
    </SearchableSetting>
  )
}
