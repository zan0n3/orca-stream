import React, { useState } from 'react'
import { FolderOpen, Headphones, Loader2, Plus, Radio, RefreshCw, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SunoTrack } from '../../../../shared/suno-music'
import { useSunoPreview, useSunoStream, type useSunoTracks } from './use-suno-music'

function IconAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function trackMeta(track: SunoTrack): string {
  const megabytes = (track.sizeBytes / (1024 * 1024)).toFixed(1)
  return `${new Date(track.addedAt).toLocaleDateString()} · ${megabytes} MB`
}

/** Songs in the Suno folder: preview privately, then send one to OBS (music input fades under it). */
export function SunoTrackList({
  library
}: {
  library: ReturnType<typeof useSunoTracks>
}): React.JSX.Element {
  const { tracks, loading, importing, refresh, importLink } = library
  const stream = useSunoStream()
  const preview = useSunoPreview()
  const [link, setLink] = useState('')
  const onStream = stream.state.playing
  const onStreamTitle = tracks.find((track) => track.fileName === onStream)?.title ?? onStream

  const sendToStream = (fileName: string): void => {
    // Why: hearing the preview and the stream copy at once is confusing.
    preview.close()
    stream.play(fileName)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('auto.components.right.sidebar.SunoPanel.songs', 'Songs')}
        </span>
        <span className="flex items-center gap-1">
          <IconAction
            label={translate('auto.components.right.sidebar.SunoPanel.refresh', 'Refresh')}
            onClick={refresh}
          >
            <RefreshCw />
          </IconAction>
          <IconAction
            label={translate(
              'auto.components.right.sidebar.SunoPanel.openFolder',
              'Open song folder'
            )}
            onClick={() => void window.api.sunoMusic.openFolder()}
          >
            <FolderOpen />
          </IconAction>
        </span>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void importLink(link).then((added) => added && setLink(''))
        }}
      >
        <Input
          value={link}
          disabled={importing}
          aria-label={translate(
            'auto.components.right.sidebar.SunoPanel.linkLabel',
            'Suno song link'
          )}
          placeholder={translate(
            'auto.components.right.sidebar.SunoPanel.linkPlaceholder',
            'Paste a suno.com song link'
          )}
          onChange={(event) => setLink(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={importing || !link.trim()}>
          {importing ? <Loader2 className="animate-spin" /> : <Plus />}
          {translate('auto.components.right.sidebar.SunoPanel.add', 'Add')}
        </Button>
      </form>

      {onStream ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <Radio className="size-3 shrink-0 text-destructive" />
            <span className="truncate">
              {translate(
                'auto.components.right.sidebar.SunoPanel.onStream',
                'On stream: {{title}}',
                {
                  title: onStreamTitle
                }
              )}
            </span>
          </span>
          <Button variant="secondary" size="xs" disabled={stream.state.busy} onClick={stream.stop}>
            <Square />
            {translate('auto.components.right.sidebar.SunoPanel.stop', 'Stop')}
          </Button>
        </div>
      ) : null}
      {stream.state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {stream.state.error}
        </p>
      ) : null}

      {!loading && tracks.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.SunoPanel.empty',
            'No songs yet. Paste a Suno link above, or save MP3s into the song folder.'
          )}
        </p>
      ) : null}

      <ul className="space-y-1">
        {tracks.map((track) => {
          const previewing = preview.file === track.fileName
          const live = onStream === track.fileName
          return (
            <li key={track.fileName} className="rounded-md px-2 py-1.5 hover:bg-accent">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">{track.title}</p>
                  <p className="text-[11px] text-muted-foreground">{trackMeta(track)}</p>
                </div>
                <IconAction
                  label={
                    previewing
                      ? translate(
                          'auto.components.right.sidebar.SunoPanel.closePreview',
                          'Close preview'
                        )
                      : translate(
                          'auto.components.right.sidebar.SunoPanel.preview',
                          'Preview (only you hear it)'
                        )
                  }
                  onClick={() => (previewing ? preview.close() : preview.open(track.fileName))}
                >
                  {previewing ? <X /> : <Headphones />}
                </IconAction>
                {live ? (
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={stream.state.busy}
                    onClick={stream.stop}
                  >
                    <Square />
                    {translate('auto.components.right.sidebar.SunoPanel.stop', 'Stop')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={stream.state.busy}
                    onClick={() => sendToStream(track.fileName)}
                  >
                    {stream.state.busy ? <Loader2 className="animate-spin" /> : <Radio />}
                    {translate('auto.components.right.sidebar.SunoPanel.send', 'Send to stream')}
                  </Button>
                )}
              </div>
              {previewing && preview.url ? (
                <audio
                  controls
                  autoPlay
                  src={preview.url}
                  className="mt-1.5 h-8 w-full"
                  onEnded={preview.close}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
