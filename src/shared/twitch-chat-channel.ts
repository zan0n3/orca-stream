const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/

/** Accepts "name", "#name", "@name" or a twitch.tv URL; returns the lowercase login or null. */
export function normalizeTwitchChannel(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  let value = input.trim().toLowerCase()
  const urlMatch = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#]+)/.exec(value)
  if (urlMatch) {
    value = urlMatch[1]
  }
  value = value.replace(/^[#@]/, '')
  return TWITCH_LOGIN_PATTERN.test(value) ? value : null
}
