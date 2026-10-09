import { describe, expect, it } from 'vitest'
import { parseTwitchIrcLine, splitTwitchAction } from './twitch-irc-parser'

describe('parseTwitchIrcLine', () => {
  it('parses a tagged PRIVMSG with escaped tag values', () => {
    const line = parseTwitchIrcLine(
      '@display-name=Foo;id=abc-1;system-msg=hello\\sthere\\:x;emotes= :foo!foo@foo.tmi.twitch.tv PRIVMSG #chan :hi :) there'
    )
    expect(line).toEqual({
      tags: { 'display-name': 'Foo', id: 'abc-1', 'system-msg': 'hello there;x', emotes: '' },
      nick: 'foo',
      command: 'PRIVMSG',
      params: ['#chan', 'hi :) there']
    })
  })

  it('parses server lines without a nick', () => {
    expect(parseTwitchIrcLine('PING :tmi.twitch.tv')).toEqual({
      tags: {},
      nick: null,
      command: 'PING',
      params: ['tmi.twitch.tv']
    })
    expect(parseTwitchIrcLine(':tmi.twitch.tv CLEARCHAT #chan')?.params).toEqual(['#chan'])
  })

  it('rejects blank and truncated lines', () => {
    expect(parseTwitchIrcLine('')).toBeNull()
    expect(parseTwitchIrcLine('@only-tags')).toBeNull()
    expect(parseTwitchIrcLine(':prefix-only')).toBeNull()
  })
})

describe('splitTwitchAction', () => {
  it('unwraps /me actions', () => {
    expect(splitTwitchAction('\u0001ACTION waves\u0001')).toEqual({ text: 'waves', isAction: true })
    expect(splitTwitchAction('plain')).toEqual({ text: 'plain', isAction: false })
  })
})
