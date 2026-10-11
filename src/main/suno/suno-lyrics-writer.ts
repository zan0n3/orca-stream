import { mkdir } from 'node:fs/promises'
import { runProcess } from '../../shared/child-process/run-process'
import {
  parseSunoSongDraft,
  type SunoLyricsRequest,
  type SunoSongDraft
} from '../../shared/suno-music'

const SYSTEM_PROMPT = `You write songs for Suno (an AI music generator) for a live coding stream on Twitch.
Reply with ONLY a JSON object: {"title": string, "style": string, "lyrics": string}.
- title: short, catchy.
- style: Suno "Style of Music" prompt, under 200 characters: genre, mood, tempo, instruments, vocal type. Never name real artists.
- lyrics: Suno format with section tags on their own lines ([Intro], [Verse 1], [Chorus], [Bridge], [Outro]); about 2-3 minutes of song; family-friendly; original, never quoting existing songs.
When given a previous draft and feedback, revise that draft to apply the feedback and keep what wasn't criticised.`

/** Drafts Suno lyrics with the local Claude CLI (no tools, no session history). */
export async function writeSunoLyrics(
  request: SunoLyricsRequest,
  workingDirectory: string
): Promise<SunoSongDraft> {
  const idea = request.idea.trim().slice(0, 2000)
  if (!idea && !request.previous) {
    throw new Error('Describe the song first.')
  }
  await mkdir(workingDirectory, { recursive: true })
  const result = await runProcess({
    program: process.env.ORCA_SUNO_CLAUDE_PATH || 'claude',
    args: [
      '--print',
      '--safe-mode',
      '--tools',
      '',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-session-persistence',
      '--system-prompt',
      SYSTEM_PROMPT
    ],
    cwd: workingDirectory,
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', CLAUDECODE: undefined },
    input: JSON.stringify({
      idea,
      previousDraft: request.previous,
      feedback: request.feedback?.trim().slice(0, 1000) || undefined
    }),
    timeoutMs: 120_000,
    maxOutputBytes: 64 * 1024
  })
  if (result.timedOut) {
    throw new Error('Writing the lyrics took too long. Try again.')
  }
  if (result.code !== 0) {
    throw new Error(
      `The claude CLI failed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 300)}` : '.'}`
    )
  }
  const draft = parseSunoSongDraft(result.stdout)
  if (!draft) {
    throw new Error('Got an unexpected reply instead of lyrics. Try again.')
  }
  return draft
}
