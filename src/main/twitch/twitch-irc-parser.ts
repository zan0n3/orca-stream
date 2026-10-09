export type TwitchIrcLine = {
  tags: Record<string, string>
  /** Nick from a `nick!user@host` prefix, or null for server-originated lines. */
  nick: string | null
  command: string
  params: string[]
}

const TAG_ESCAPES: Record<string, string> = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' }

function unescapeTagValue(value: string): string {
  return value.replace(/\\(.?)/g, (_match, next: string) => TAG_ESCAPES[next] ?? next)
}

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    if (key) {
      tags[key] = eq === -1 ? '' : unescapeTagValue(pair.slice(eq + 1))
    }
  }
  return tags
}

/** Parses one IRCv3 line as sent by Twitch chat. Returns null for blank or malformed lines. */
export function parseTwitchIrcLine(line: string): TwitchIrcLine | null {
  let rest = line.replace(/\r?\n$/, '')
  let tags: Record<string, string> = {}
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    if (space === -1) {
      return null
    }
    tags = parseTags(rest.slice(1, space))
    rest = rest.slice(space + 1).trimStart()
  }
  let nick: string | null = null
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    if (space === -1) {
      return null
    }
    const prefix = rest.slice(1, space)
    const bang = prefix.indexOf('!')
    nick = bang === -1 ? null : prefix.slice(0, bang)
    rest = rest.slice(space + 1).trimStart()
  }
  const trailingStart = rest.indexOf(' :')
  const trailing = trailingStart === -1 ? null : rest.slice(trailingStart + 2)
  const head = trailingStart === -1 ? rest : rest.slice(0, trailingStart)
  const [command, ...params] = head.split(' ').filter(Boolean)
  if (!command) {
    return null
  }
  if (trailing !== null) {
    params.push(trailing)
  }
  return { tags, nick, command: command.toUpperCase(), params }
}

const ACTION_PREFIX = '\u0001ACTION '
const ACTION_SUFFIX = '\u0001'

export function splitTwitchAction(text: string): { text: string; isAction: boolean } {
  return text.startsWith(ACTION_PREFIX) && text.endsWith(ACTION_SUFFIX)
    ? { text: text.slice(ACTION_PREFIX.length, -ACTION_SUFFIX.length), isAction: true }
    : { text, isAction: false }
}
