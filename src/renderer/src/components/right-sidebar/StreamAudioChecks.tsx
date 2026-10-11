import React, { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CircleX, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  STREAM_AUDIO_CHECK_IDS,
  STREAM_AUDIO_CHECK_SECONDS,
  type StreamAudioCheckId,
  type StreamAudioCheckResult,
  type StreamAudioCheckStatus
} from '../../../../shared/stream-audio'

function checkCopy(id: StreamAudioCheckId): { title: string; how: string; prompt: string } {
  switch (id) {
    case 'setup':
      return {
        title: translate('auto.components.right.sidebar.StreamAudio.setupTitle', 'Setup check'),
        how: translate(
          'auto.components.right.sidebar.StreamAudio.setupHow',
          'Mic and music inputs exist, are unmuted, and nothing captures the desktop twice.'
        ),
        prompt: ''
      }
    case 'mic':
      return {
        title: translate('auto.components.right.sidebar.StreamAudio.micTitle', 'Mic check'),
        how: translate(
          'auto.components.right.sidebar.StreamAudio.micHow',
          'Talk like you do on stream for 6 seconds.'
        ),
        prompt: translate('auto.components.right.sidebar.StreamAudio.micPrompt', 'Talk now…')
      }
    case 'music':
      return {
        title: translate('auto.components.right.sidebar.StreamAudio.musicTitle', 'Music check'),
        how: translate(
          'auto.components.right.sidebar.StreamAudio.musicHow',
          'Play your StreamBeats music and stay quiet for 6 seconds.'
        ),
        prompt: translate(
          'auto.components.right.sidebar.StreamAudio.musicPrompt',
          'Listening to the music…'
        )
      }
    case 'balance':
      return {
        title: translate('auto.components.right.sidebar.StreamAudio.balanceTitle', 'Voice + music'),
        how: translate(
          'auto.components.right.sidebar.StreamAudio.balanceHow',
          'Keep the music playing and talk for 8 seconds; your voice should sit well above it.'
        ),
        prompt: translate(
          'auto.components.right.sidebar.StreamAudio.balancePrompt',
          'Talk over the music…'
        )
      }
  }
}

function StatusIcon({ status }: { status: StreamAudioCheckStatus }): React.JSX.Element {
  switch (status) {
    case 'pass':
      return <CircleCheck className="size-3.5 shrink-0 text-status-success" />
    case 'warn':
      return <CircleAlert className="size-3.5 shrink-0 text-status-warning" />
    case 'fail':
      return <CircleX className="size-3.5 shrink-0 text-destructive" />
  }
}

function Countdown({ seconds, prompt }: { seconds: number; prompt: string }): React.JSX.Element {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(
      () => setLeft(Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))),
      250
    )
    return () => clearInterval(timer)
  }, [seconds])
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
      <Loader2 className="size-3 animate-spin" />
      {prompt} {left > 0 ? `${left}s` : ''}
    </p>
  )
}

/** Pre-stream sound checks: each grades what OBS hears and can apply a suggested fader. */
export function StreamAudioChecks({
  running,
  results,
  disabled,
  onRun,
  onApply
}: {
  running: StreamAudioCheckId | null
  results: Partial<Record<StreamAudioCheckId, StreamAudioCheckResult>>
  disabled: boolean
  onRun: (id: StreamAudioCheckId) => void
  onApply: (inputName: string, volumeDb: number) => void
}): React.JSX.Element {
  return (
    <ul className="space-y-2">
      {STREAM_AUDIO_CHECK_IDS.map((id) => {
        const copy = checkCopy(id)
        const result = results[id]
        return (
          <li key={id} className="space-y-1.5 rounded-md border border-border p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  {result ? <StatusIcon status={result.status} /> : null}
                  {copy.title}
                </p>
                <p className="text-[11px] text-muted-foreground">{copy.how}</p>
              </div>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled || running !== null}
                onClick={() => onRun(id)}
              >
                <Play />
                {result
                  ? translate('auto.components.right.sidebar.StreamAudio.again', 'Again')
                  : translate('auto.components.right.sidebar.StreamAudio.run', 'Run')}
              </Button>
            </div>
            {running === id && STREAM_AUDIO_CHECK_SECONDS[id] > 0 ? (
              <Countdown seconds={STREAM_AUDIO_CHECK_SECONDS[id]} prompt={copy.prompt} />
            ) : null}
            {result && running !== id ? (
              <ul className="space-y-1">
                {result.findings.map((finding) => (
                  <li
                    key={finding.message}
                    className="flex items-start gap-1.5 text-xs text-foreground"
                  >
                    <StatusIcon status={finding.status} />
                    <span className="min-w-0 flex-1">{finding.message}</span>
                    {finding.suggestion ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() =>
                          finding.suggestion &&
                          onApply(finding.suggestion.input, finding.suggestion.volumeDb)
                        }
                      >
                        {translate(
                          'auto.components.right.sidebar.StreamAudio.apply',
                          'Set to {{db}} dB',
                          { db: finding.suggestion.volumeDb.toFixed(1) }
                        )}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
