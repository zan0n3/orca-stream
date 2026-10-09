import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getTwitchChatSearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: translate('auto.components.settings.twitchChat.search.title', 'Twitch chat'),
  description: translate(
    'auto.components.settings.twitchChat.search.description',
    'Show a Twitch channel’s live chat in the right sidebar.'
  ),
  keywords: [
    ...translateSearchKeyword(
      'auto.components.settings.experimental.search.0d24759f14',
      'experimental'
    ),
    ...translateSearchKeyword('auto.components.settings.twitchChat.search.keywordTwitch', 'twitch'),
    ...translateSearchKeyword('auto.components.settings.twitchChat.search.keywordChat', 'chat'),
    ...translateSearchKeyword('auto.components.settings.twitchChat.search.keywordStream', 'stream'),
    ...translateSearchKeyword(
      'auto.components.settings.twitchChat.search.keywordChannel',
      'channel'
    )
  ]
}))
