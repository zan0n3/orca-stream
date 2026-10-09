import type { GlobalSettings } from '../../../shared/global-settings-types'
import { normalizeStreamOverlayPort } from '../../../shared/stream-overlay'

/** Twitch chat and OBS overlay settings, sanitized in place on `sanitizedUpdates`. */
export function sanitizeStreamSettingsUpdates(
  updates: Partial<GlobalSettings>,
  sanitizedUpdates: Partial<GlobalSettings>
): void {
  if ('experimentalStreamOverlay' in updates) {
    sanitizedUpdates.experimentalStreamOverlay = updates.experimentalStreamOverlay === true
  }
  if ('streamOverlayPort' in updates) {
    sanitizedUpdates.streamOverlayPort = normalizeStreamOverlayPort(updates.streamOverlayPort)
  }
  // Why: an empty token makes main mint a fresh one; anything else must look like one we generated.
  if ('streamOverlayToken' in updates) {
    sanitizedUpdates.streamOverlayToken =
      typeof updates.streamOverlayToken === 'string' &&
      /^[A-Za-z0-9_-]{16,128}$/.test(updates.streamOverlayToken)
        ? updates.streamOverlayToken
        : ''
  }
  if ('experimentalTwitchChat' in updates) {
    sanitizedUpdates.experimentalTwitchChat = updates.experimentalTwitchChat === true
  }
  // Why raw text, not the normalized login: normalizing mid-typing would rewrite the field under the user.
  if ('twitchChatChannel' in updates) {
    sanitizedUpdates.twitchChatChannel =
      typeof updates.twitchChatChannel === 'string'
        ? updates.twitchChatChannel.trim().slice(0, 200)
        : ''
  }
  if ('twitchChatClientId' in updates) {
    sanitizedUpdates.twitchChatClientId =
      typeof updates.twitchChatClientId === 'string'
        ? updates.twitchChatClientId.trim().slice(0, 100)
        : ''
  }
}
