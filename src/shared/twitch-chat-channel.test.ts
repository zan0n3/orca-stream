import { describe, expect, it } from 'vitest'
import { normalizeTwitchChannel } from './twitch-chat-channel'

describe('normalizeTwitchChannel', () => {
  it.each([
    ['MyChannel', 'mychannel'],
    ['  #my_channel ', 'my_channel'],
    ['@streamer', 'streamer'],
    ['https://www.twitch.tv/Streamer', 'streamer'],
    ['twitch.tv/streamer/videos?filter=all', 'streamer'],
    ['m.twitch.tv/streamer', 'streamer']
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeTwitchChannel(input)).toBe(expected)
  })

  it.each(['', '   ', 'two words', 'bad-dash', 'a'.repeat(26), 'https://example.com/x', 42, null])(
    'rejects %j',
    (input) => {
      expect(normalizeTwitchChannel(input)).toBeNull()
    }
  )
})
