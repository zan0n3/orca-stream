import { z } from 'zod'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import type { StoredTwitchAuth, TwitchAuthStore } from './twitch-chat-sender'

const storedAuthSchema = z.object({
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  login: z.string(),
  userId: z.string()
})

const file = createEncryptedApiKeyFileStore({
  fileName: 'twitch-chat-auth.enc',
  envelopePrefix: 'orca-twitch-chat-auth:v1:',
  providerLabel: 'Twitch',
  logScope: 'twitch-chat'
})

/** OS-encrypted (safeStorage) Twitch tokens; an unreadable file counts as signed out. */
export const twitchAuthFileStore: TwitchAuthStore = {
  read: (): StoredTwitchAuth | null => {
    try {
      const raw = file.read()
      return raw ? (storedAuthSchema.safeParse(JSON.parse(raw)).data ?? null) : null
    } catch {
      return null
    }
  },
  save: (auth) => file.save(JSON.stringify(auth)),
  clear: () => file.clear()
}
