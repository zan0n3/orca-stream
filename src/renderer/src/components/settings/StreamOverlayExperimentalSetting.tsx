import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_STREAM_OVERLAY_PORT,
  buildMaskedStreamOverlayUrl,
  buildStreamOverlayUrl,
  normalizeStreamOverlayPort,
  type StreamOverlayPage,
  type StreamOverlayStatus
} from '../../../../shared/stream-overlay'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { NumberField, SettingsSwitch } from './SettingsFormControls'
import { getStreamOverlaySearchEntry } from './stream-overlay-search-entry'

type StreamOverlayExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function useStreamOverlayStatus(enabled: boolean): StreamOverlayStatus | null {
  const [status, setStatus] = useState<StreamOverlayStatus | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let disposed = false
    const unsubscribe = window.api.streamOverlay.onStatusChanged((next) => {
      if (!disposed) {
        setStatus(next)
      }
    })
    void window.api.streamOverlay.getStatus().then(
      (next) => {
        if (!disposed) {
          setStatus(next)
        }
      },
      () => {}
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [enabled])
  return enabled ? status : null
}

function statusText(status: StreamOverlayStatus | null): string {
  if (status?.state === 'listening') {
    return translate(
      'auto.components.settings.streamOverlay.statusListening',
      'Running on port {{port}}.',
      { port: status.port }
    )
  }
  if (status?.state === 'error') {
    return status.message
  }
  return translate('auto.components.settings.streamOverlay.statusStarting', 'Starting…')
}

export function StreamOverlayExperimentalSetting({
  settings,
  updateSettings
}: StreamOverlayExperimentalSettingProps): React.JSX.Element | null {
  const enabled = settings.experimentalStreamOverlay === true
  const status = useStreamOverlayStatus(enabled)
  const port = normalizeStreamOverlayPort(settings.streamOverlayPort)
  const token = settings.streamOverlayToken ?? ''
  const title = translate('auto.components.settings.streamOverlay.title', 'OBS overlays')

  // Why: the overlay server runs in the desktop app; a browser client has nothing to configure.
  if (isWebClientLocation()) {
    return null
  }

  const copyUrl = async (page: StreamOverlayPage): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(buildStreamOverlayUrl(port, token, page))
      toast.success(translate('auto.components.settings.streamOverlay.copied', 'Link copied.'))
    } catch {
      toast.error(
        translate('auto.components.settings.streamOverlay.copyFailed', 'Could not copy the link.')
      )
    }
  }

  const overlays: { page: StreamOverlayPage; label: string; hint: string }[] = [
    {
      page: 'chat',
      label: translate('auto.components.settings.streamOverlay.chatLabel', 'Chat'),
      hint: translate(
        'auto.components.settings.streamOverlay.chatHint',
        'Twitch chat from the Twitch chat setting. Suggested size 400×600.'
      )
    },
    {
      page: 'agents',
      label: translate('auto.components.settings.streamOverlay.agentsLabel', 'Agent status'),
      hint: translate(
        'auto.components.settings.streamOverlay.agentsHint',
        'Which agents are working or need input. Never shows prompts or file paths.'
      )
    }
  ]

  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.streamOverlay.description',
        'Browser-source overlays for OBS: Twitch chat and live agent status.'
      )}
      keywords={getStreamOverlaySearchEntry().keywords}
      className="space-y-3 py-2"
      id="experimental-stream-overlay"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{title}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.streamOverlay.copy',
              'Serves transparent overlay pages from this computer. In OBS, add a Browser source and paste a link below.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.streamOverlay.toggleLabel',
            'Toggle OBS overlays'
          )}
          onChange={() => updateSettings({ experimentalStreamOverlay: !enabled })}
        />
      </div>
      {enabled ? (
        <div className="ml-4 space-y-3 border-l border-border pl-4">
          <p
            className="text-xs text-muted-foreground"
            aria-live="polite"
            data-overlay-status={status?.state ?? 'pending'}
          >
            {statusText(status)}
          </p>
          {overlays.map((overlay) => (
            <div key={overlay.page} className="flex items-start justify-between gap-4">
              <div className="min-w-0 shrink space-y-0.5">
                <Label>{overlay.label}</Label>
                <p className="text-xs text-muted-foreground">{overlay.hint}</p>
                {/* Why masked: Settings may be open on stream; the full link only goes to the clipboard. */}
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {buildMaskedStreamOverlayUrl(port, overlay.page)}
                </p>
              </div>
              <Button
                variant="outline"
                size="xs"
                disabled={!token}
                onClick={() => void copyUrl(overlay.page)}
              >
                {translate('auto.components.settings.streamOverlay.copyLink', 'Copy link')}
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.streamOverlay.params',
              'Optional: add &max=8 to limit how many rows show, or &fade=30 to fade chat messages after 30 seconds.'
            )}
          </p>
          <NumberField
            label={translate('auto.components.settings.streamOverlay.portLabel', 'Port')}
            description={translate(
              'auto.components.settings.streamOverlay.portDescription',
              'Change this if another app already uses the port. Update your OBS sources after changing it.'
            )}
            value={port}
            defaultValue={DEFAULT_STREAM_OVERLAY_PORT}
            min={1024}
            max={65_535}
            integer
            onChange={(next) => updateSettings({ streamOverlayPort: next })}
          />
          <div className="flex items-start justify-between gap-4">
            <p className="min-w-0 shrink text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.streamOverlay.resetHint',
                'If a link leaks, make a new one. Existing OBS sources stop working until you paste the new link.'
              )}
            </p>
            <Button
              variant="outline"
              size="xs"
              onClick={() => updateSettings({ streamOverlayToken: '' })}
            >
              {translate('auto.components.settings.streamOverlay.resetLink', 'New links')}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 shrink space-y-0.5">
              <Label>
                {translate('auto.components.settings.streamOverlay.streamModeLabel', 'Stream mode')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.streamOverlay.streamModeCopy',
                  'Go live (in the Twitch Chat tab) opens a chat window on your second screen and runs the stream-start script in the scripts folder; End stream runs stream-stop. Use the scripts to launch OBS or arrange windows.'
                )}
              </p>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void window.api.streamMode.openHooksFolder()}
            >
              {translate(
                'auto.components.settings.streamOverlay.openScripts',
                'Open scripts folder'
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </SearchableSetting>
  )
}
