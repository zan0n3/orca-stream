import { describe, expect, it } from 'vitest'
import {
  isSunoShareUrl,
  isSunoTrackFileName,
  parseSunoSongDraft,
  sunoSongIdFromUrl,
  sunoTrackFileStem
} from './suno-music'

const ID = '0f3c2a1b-1234-4abc-9def-0123456789ab'

describe('suno song links', () => {
  it('reads the song id from suno.com song URLs only', () => {
    expect(sunoSongIdFromUrl(`https://suno.com/song/${ID}`)).toBe(ID)
    expect(sunoSongIdFromUrl(` https://www.suno.com/song/${ID.toUpperCase()}?sh=x `)).toBe(ID)
    expect(sunoSongIdFromUrl(`http://suno.com/song/${ID}`)).toBeNull()
    expect(sunoSongIdFromUrl(`https://evil.example/song/${ID}`)).toBeNull()
    expect(sunoSongIdFromUrl(`https://suno.com/song/${ID}x`)).toBeNull()
    expect(sunoSongIdFromUrl('not a url')).toBeNull()
  })

  it('recognises share links that redirect to a song', () => {
    expect(isSunoShareUrl('https://suno.com/s/AbC123')).toBe(true)
    expect(isSunoShareUrl('https://suno.com/create')).toBe(false)
  })
})

describe('suno track files', () => {
  it('accepts audio extensions only', () => {
    expect(isSunoTrackFileName('Song.MP3')).toBe(true)
    expect(isSunoTrackFileName('notes.txt')).toBe(false)
  })

  it('builds a safe file stem from the title', () => {
    expect(sunoTrackFileStem('Ship it! / 2am', ID)).toBe('Ship it 2am (0f3c2a1b)')
    expect(sunoTrackFileStem('', ID)).toBe('Suno song (0f3c2a1b)')
  })
})

describe('parseSunoSongDraft', () => {
  it('parses a fenced JSON reply', () => {
    const reply = '```json\n{"title":" Orca ","style":"lofi","lyrics":"[Verse]\\nhi"}\n```'
    expect(parseSunoSongDraft(reply)).toEqual({
      title: 'Orca',
      style: 'lofi',
      lyrics: '[Verse]\nhi'
    })
  })

  it('rejects replies without lyrics', () => {
    expect(parseSunoSongDraft('{"title":"x"}')).toBeNull()
    expect(parseSunoSongDraft('sorry, no')).toBeNull()
  })
})

describe('parseSunoSongDraft for instrumentals', () => {
  it('keeps a style-only reply and drops any lyrics', () => {
    expect(
      parseSunoSongDraft('{"title":"Deep","style":"instrumental lofi","lyrics":"la"}', true)
    ).toEqual({ title: 'Deep', style: 'instrumental lofi', lyrics: '' })
    expect(parseSunoSongDraft('{"title":"Deep","lyrics":""}', true)).toBeNull()
  })
})
