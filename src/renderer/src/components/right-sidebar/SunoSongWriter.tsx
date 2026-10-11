import React, { useState } from 'react'
import { Copy, Loader2, Music, Piano, RotateCcw, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { SunoSongDraft } from '../../../../shared/suno-music'
import { sunoErrorMessage } from './use-suno-music'

const DRAFT_STORAGE_KEY = 'orca.suno.songDraft'

type StoredDraft = { idea: string; draft: SunoSongDraft | null }

function loadStoredDraft(): StoredDraft {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null')
    if (typeof raw === 'object' && raw !== null) {
      const idea: unknown = Reflect.get(raw, 'idea')
      const draft: unknown = Reflect.get(raw, 'draft')
      const text = (key: string): string => {
        const value: unknown = typeof draft === 'object' && draft ? Reflect.get(draft, key) : ''
        return typeof value === 'string' ? value : ''
      }
      return {
        idea: typeof idea === 'string' ? idea : '',
        // Why style too: an instrumental draft has no lyrics.
        draft:
          text('lyrics') || text('style')
            ? { title: text('title'), style: text('style'), lyrics: text('lyrics') }
            : null
      }
    }
  } catch {
    // Storage can be unavailable or hold an old shape; start blank.
  }
  return { idea: '', draft: null }
}

function storeDraft(value: StoredDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Losing the draft on restart is acceptable.
  }
}

function copy(text: string, what: string): void {
  void window.api.ui
    .writeClipboardText(text)
    .then(() =>
      toast.success(
        translate('auto.components.right.sidebar.SunoPanel.copied', '{{what}} copied', { what })
      )
    )
}

/** Song idea → lyrics and style via the local Claude CLI, editable and ready to paste into Suno. */
export function SunoSongWriter({
  creating,
  onCreate
}: {
  creating: boolean
  onCreate: (draft: SunoSongDraft) => void
}): React.JSX.Element {
  const [stored] = useState(loadStoredDraft)
  const [idea, setIdea] = useState(stored.idea)
  const [draft, setDraftState] = useState<SunoSongDraft | null>(stored.draft)
  const [feedback, setFeedback] = useState('')
  const [writing, setWriting] = useState<'lyrics' | 'instrumental' | null>(null)

  const setDraft = (next: SunoSongDraft | null, nextIdea = idea): void => {
    setDraftState(next)
    storeDraft({ idea: nextIdea, draft: next })
  }

  const write = async (revise: boolean, instrumentalRequest = false): Promise<void> => {
    // Why: a revision keeps the draft's kind; an instrumental draft is one without lyrics.
    const instrumental = revise && draft ? !draft.lyrics.trim() : instrumentalRequest
    setWriting(instrumental ? 'instrumental' : 'lyrics')
    try {
      const next = await window.api.sunoMusic.writeLyrics(
        revise && draft ? { idea, previous: draft, feedback, instrumental } : { idea, instrumental }
      )
      setDraft(next)
      if (revise) {
        setFeedback('')
      }
    } catch (error) {
      toast.error(sunoErrorMessage(error))
    } finally {
      setWriting(null)
    }
  }

  const reset = (): void => {
    setIdea('')
    setFeedback('')
    setDraft(null, '')
  }

  const updateDraft = (key: keyof SunoSongDraft, value: string): void => {
    if (draft) {
      setDraft({ ...draft, [key]: value })
    }
  }

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="suno-idea">
            {translate('auto.components.right.sidebar.SunoPanel.ideaLabel', 'Song idea')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.SunoPanel.ideaHint',
              'Describe the vibe, topic and genre. AI drafts the lyrics and Suno style.'
            )}
          </p>
        </div>
        <Textarea
          id="suno-idea"
          rows={3}
          value={idea}
          placeholder={translate(
            'auto.components.right.sidebar.SunoPanel.ideaPlaceholder',
            'A lo-fi hype track about shipping code at 2am with an orca mascot'
          )}
          onChange={(event) => {
            setIdea(event.target.value)
            storeDraft({ idea: event.target.value, draft })
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={writing !== null || !idea.trim()}
            onClick={() => void write(false)}
          >
            {writing === 'lyrics' ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {writing === 'lyrics'
              ? translate('auto.components.right.sidebar.SunoPanel.writing', 'Writing lyrics…')
              : draft
                ? translate('auto.components.right.sidebar.SunoPanel.rewrite', 'Write new lyrics')
                : translate('auto.components.right.sidebar.SunoPanel.write', 'Write lyrics')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={writing !== null || !idea.trim()}
            onClick={() => void write(false, true)}
          >
            {writing === 'instrumental' ? <Loader2 className="animate-spin" /> : <Piano />}
            {writing === 'instrumental'
              ? translate(
                  'auto.components.right.sidebar.SunoPanel.writingInstrumental',
                  'Writing style…'
                )
              : translate('auto.components.right.sidebar.SunoPanel.instrumental', 'Instrumental')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={writing !== null || (!idea.trim() && !draft)}
            onClick={reset}
          >
            <RotateCcw />
            {translate('auto.components.right.sidebar.SunoPanel.reset', 'Reset')}
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="suno-title">
              {translate('auto.components.right.sidebar.SunoPanel.title', 'Title')}
            </Label>
            <Input
              id="suno-title"
              value={draft.title}
              onChange={(event) => updateDraft('title', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suno-style">
              {translate('auto.components.right.sidebar.SunoPanel.style', 'Style of music')}
            </Label>
            <Textarea
              id="suno-style"
              rows={2}
              value={draft.style}
              onChange={(event) => updateDraft('style', event.target.value)}
            />
          </div>
          {draft.lyrics.trim() ? (
            <div className="space-y-1">
              <Label htmlFor="suno-lyrics">
                {translate('auto.components.right.sidebar.SunoPanel.lyrics', 'Lyrics')}
              </Label>
              <Textarea
                id="suno-lyrics"
                rows={12}
                variant="code"
                value={draft.lyrics}
                onChange={(event) => updateDraft('lyrics', event.target.value)}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.SunoPanel.instrumentalNote',
                'Instrumental: no lyrics, so Suno makes music only.'
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {draft.lyrics.trim() ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  copy(
                    draft.lyrics,
                    translate('auto.components.right.sidebar.SunoPanel.lyrics', 'Lyrics')
                  )
                }
              >
                <Copy />
                {translate('auto.components.right.sidebar.SunoPanel.copyLyrics', 'Copy lyrics')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                copy(
                  draft.style,
                  translate('auto.components.right.sidebar.SunoPanel.style', 'Style of music')
                )
              }
            >
              <Copy />
              {translate('auto.components.right.sidebar.SunoPanel.copyStyle', 'Copy style')}
            </Button>
            <Button
              size="xs"
              disabled={
                creating || writing !== null || !(draft.lyrics.trim() || draft.style.trim())
              }
              onClick={() => onCreate(draft)}
            >
              {creating ? <Loader2 className="animate-spin" /> : <Music />}
              {translate('auto.components.right.sidebar.SunoPanel.createOnSuno', 'Create on Suno')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.SunoPanel.createHint',
              'Create on Suno fills Suno’s form in your Orca browser tab and makes two takes (uses Suno credits). Solve any captcha there.'
            )}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (feedback.trim()) {
                void write(true)
              }
            }}
          >
            <Input
              value={feedback}
              disabled={writing !== null}
              aria-label={translate(
                'auto.components.right.sidebar.SunoPanel.feedbackLabel',
                'What to change'
              )}
              placeholder={translate(
                'auto.components.right.sidebar.SunoPanel.feedbackPlaceholder',
                'Change something… e.g. punchier chorus'
              )}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={writing !== null || !feedback.trim()}
            >
              <Wand2 />
              {translate('auto.components.right.sidebar.SunoPanel.revise', 'Revise')}
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  )
}
