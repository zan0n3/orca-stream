import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getStreamOverlaySearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: translate('auto.components.settings.streamOverlay.search.title', 'OBS overlays'),
  description: translate(
    'auto.components.settings.streamOverlay.search.description',
    'Browser-source overlays for OBS: Twitch chat and live agent status.'
  ),
  keywords: [
    ...translateSearchKeyword(
      'auto.components.settings.experimental.search.0d24759f14',
      'experimental'
    ),
    ...translateSearchKeyword('auto.components.settings.streamOverlay.search.keywordObs', 'obs'),
    ...translateSearchKeyword(
      'auto.components.settings.streamOverlay.search.keywordOverlay',
      'overlay'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.streamOverlay.search.keywordStream',
      'stream'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.streamOverlay.search.keywordBrowserSource',
      'browser source'
    ),
    ...translateSearchKeyword('auto.components.settings.twitchChat.search.keywordTwitch', 'twitch')
  ]
}))
