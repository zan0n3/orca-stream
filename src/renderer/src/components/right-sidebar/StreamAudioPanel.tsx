import React from 'react'
import { Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { translate } from '@/i18n/i18n'
import { StreamAudioChecks } from './StreamAudioChecks'
import { StreamAudioMixboard } from './StreamAudioMixboard'
import { useStreamAudio } from './use-stream-audio'

/** Audio tab of the Orca Stream panel: OBS mixboard plus sound checks to run before going live. */
export default function StreamAudioPanel(): React.JSX.Element {
  const { state, levels, running, results, setVolume, setMuted, runCheck } = useStreamAudio()
  return (
    <div className="scrollbar-sleek h-full space-y-4 overflow-y-auto px-3 py-3">
      <section className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('auto.components.right.sidebar.StreamAudio.mixer', 'OBS mixer')}
        </span>
        {state.connected ? (
          state.channels.length > 0 ? (
            <StreamAudioMixboard
              channels={state.channels}
              levels={levels}
              onVolume={setVolume}
              onMuted={setMuted}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.StreamAudio.noInputs',
                'OBS has no audio inputs yet.'
              )}
            </p>
          )
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              {translate(
                'auto.components.right.sidebar.StreamAudio.waiting',
                'Waiting for OBS. Open OBS (or press Go live); this tab connects by itself.'
              )}
            </p>
            {state.error ? <p>{state.error}</p> : null}
          </div>
        )}
      </section>
      <Separator />
      <section className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('auto.components.right.sidebar.StreamAudio.checks', 'Sound checks')}
        </span>
        <StreamAudioChecks
          running={running}
          results={results}
          disabled={!state.connected}
          onRun={(id) => void runCheck(id)}
          onApply={setVolume}
        />
      </section>
    </div>
  )
}
