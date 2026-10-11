import React, { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  FADER_MAX_DB,
  FADER_MIN_DB,
  type StreamAudioChannel,
  type StreamAudioLevel
} from '../../../../shared/stream-audio'

const METER_FLOOR_DB = -60

function meterPercent(db: number): number {
  if (!Number.isFinite(db)) {
    return 0
  }
  return Math.max(0, Math.min(100, ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100))
}

function formatFader(db: number): string {
  return db <= FADER_MIN_DB ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

function LevelMeter({ level }: { level: StreamAudioLevel | undefined }): React.JSX.Element {
  const peak = level?.peakDb ?? Number.NEGATIVE_INFINITY
  const rms = level?.rmsDb ?? Number.NEGATIVE_INFINITY
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-100',
          peak > -3 ? 'bg-destructive' : peak > -12 ? 'bg-status-warning' : 'bg-status-success'
        )}
        style={{ width: `${meterPercent(rms)}%` }}
      />
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground/70"
        style={{ left: `${meterPercent(peak)}%` }}
      />
    </div>
  )
}

function ChannelStrip({
  channel,
  level,
  onVolume,
  onMuted
}: {
  channel: StreamAudioChannel
  level: StreamAudioLevel | undefined
  onVolume: (volumeDb: number) => void
  onMuted: (muted: boolean) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const fader = Math.max(FADER_MIN_DB, Math.min(FADER_MAX_DB, channel.volumeDb))
  const shown = dragging ?? fader
  const muteLabel = channel.muted
    ? translate('auto.components.right.sidebar.StreamAudio.unmute', 'Unmute {{name}}', {
        name: channel.name
      })
    : translate('auto.components.right.sidebar.StreamAudio.mute', 'Mute {{name}}', {
        name: channel.name
      })
  return (
    <li className="space-y-1.5 rounded-md px-2 py-1.5 hover:bg-accent">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={muteLabel}
              aria-pressed={channel.muted}
              onClick={() => onMuted(!channel.muted)}
            >
              {channel.muted ? <VolumeX className="text-destructive" /> : <Volume2 />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {muteLabel}
          </TooltipContent>
        </Tooltip>
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{channel.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatFader(shown)}
        </span>
      </div>
      <Slider
        min={FADER_MIN_DB}
        max={FADER_MAX_DB}
        step={0.5}
        value={[shown]}
        aria-label={translate(
          'auto.components.right.sidebar.StreamAudio.fader',
          '{{name}} volume',
          {
            name: channel.name
          }
        )}
        onValueChange={([value]) => setDragging(value)}
        onValueCommit={([value]) => {
          onVolume(value)
          setDragging(null)
        }}
      />
      <LevelMeter level={channel.muted ? undefined : level} />
    </li>
  )
}

/** Every OBS input with audio: mute, fader (−60 to 0 dB) and a live post-fader meter. */
export function StreamAudioMixboard({
  channels,
  levels,
  onVolume,
  onMuted
}: {
  channels: StreamAudioChannel[]
  levels: Record<string, StreamAudioLevel>
  onVolume: (inputName: string, volumeDb: number) => void
  onMuted: (inputName: string, muted: boolean) => void
}): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {channels.map((channel) => (
        <ChannelStrip
          key={channel.name}
          channel={channel}
          level={levels[channel.name]}
          onVolume={(volumeDb) => onVolume(channel.name, volumeDb)}
          onMuted={(muted) => onMuted(channel.name, muted)}
        />
      ))}
    </ul>
  )
}
