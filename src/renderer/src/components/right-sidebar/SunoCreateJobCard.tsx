import React from 'react'
import { Check, Download, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SunoCreateJob } from '../../../../shared/suno-music'

function phaseLabel(job: SunoCreateJob): string {
  switch (job.phase) {
    case 'creating':
      return translate('auto.components.right.sidebar.SunoPanel.phaseCreating', 'Filling in Suno…')
    case 'generating':
      return translate(
        'auto.components.right.sidebar.SunoPanel.phaseGenerating',
        'Suno is making two takes… usually 1–3 minutes'
      )
    case 'downloading':
      return translate(
        'auto.components.right.sidebar.SunoPanel.phaseDownloading',
        'Downloading MP3…'
      )
    case 'ready':
      return translate(
        'auto.components.right.sidebar.SunoPanel.phaseReady',
        'Listen in the Suno tab, then download the take you want.'
      )
    case 'idle':
    case 'error':
      return ''
  }
}

/** The song being made on Suno: progress, then its two takes with play and download. */
export function SunoCreateJobCard({
  job,
  onTogglePlay,
  onDownload
}: {
  job: SunoCreateJob
  onTogglePlay: (clipId: string) => void
  onDownload: (clipId: string) => void
}): React.JSX.Element | null {
  if (job.phase === 'idle') {
    return null
  }
  const busy = job.phase === 'creating' || job.phase === 'generating' || job.phase === 'downloading'
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <div className="space-y-1">
        <p className="truncate text-[13px] font-medium text-foreground">{job.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {phaseLabel(job)}
        </p>
        {job.error ? (
          <p role="alert" className="text-xs text-destructive">
            {job.error}
          </p>
        ) : null}
      </div>
      {job.clips.length > 0 ? (
        <ul className="space-y-1">
          {job.clips.map((clip, index) => (
            <li
              key={clip.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {translate('auto.components.right.sidebar.SunoPanel.take', 'Take {{number}}', {
                  number: index + 1
                })}
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {clip.ready
                    ? clip.duration
                    : translate(
                        'auto.components.right.sidebar.SunoPanel.generating',
                        'generating…'
                      )}
                </span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={!clip.ready}
                    aria-label={translate(
                      'auto.components.right.sidebar.SunoPanel.playInSuno',
                      'Play or pause in the Suno tab (only you hear it)'
                    )}
                    onClick={() => onTogglePlay(clip.id)}
                  >
                    <Play />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {translate(
                    'auto.components.right.sidebar.SunoPanel.playInSuno',
                    'Play or pause in the Suno tab (only you hear it)'
                  )}
                </TooltipContent>
              </Tooltip>
              {clip.downloaded ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Check className="size-3" />
                  {translate('auto.components.right.sidebar.SunoPanel.saved', 'Saved')}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!clip.ready || busy}
                  onClick={() => onDownload(clip.id)}
                >
                  <Download />
                  {translate('auto.components.right.sidebar.SunoPanel.downloadMp3', 'Download MP3')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {job.phase === 'ready' ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.SunoPanel.downloadQuota',
            'Each download uses one of your monthly Suno downloads.'
          )}
        </p>
      ) : null}
    </section>
  )
}
