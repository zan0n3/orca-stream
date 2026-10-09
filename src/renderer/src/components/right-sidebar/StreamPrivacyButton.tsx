import React, { useCallback, useEffect, useState } from 'react'
import { EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { StreamPrivacyState } from '../../../../shared/stream-privacy'

function useStreamPrivacy(): StreamPrivacyState | null {
  const [state, setState] = useState<StreamPrivacyState | null>(null)
  useEffect(() => {
    let disposed = false
    let pushed = false
    const unsubscribe = window.api.streamPrivacy.onChanged((next) => {
      pushed = true
      if (!disposed) {
        setState(next)
      }
    })
    void window.api.streamPrivacy.getState().then(
      (next) => {
        if (!disposed && !pushed) {
          setState(next)
        }
      },
      () => {}
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])
  return state
}

export function StreamPrivacyButton(): React.JSX.Element {
  const state = useStreamPrivacy()
  const enabled = state?.enabled === true
  const toggle = useCallback(() => {
    void window.api.streamPrivacy.set(!enabled)
  }, [enabled])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={enabled ? 'destructive' : 'outline'}
          size="xs"
          disabled={state === null || state.busy}
          onClick={toggle}
          aria-pressed={enabled}
        >
          {state?.busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <EyeOff className="size-3" />
          )}
          {enabled
            ? translate('auto.components.right.sidebar.streamPrivacy.on', 'Unblur')
            : translate('auto.components.right.sidebar.streamPrivacy.off', 'Blur')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {state?.error ??
          translate(
            'auto.components.right.sidebar.streamPrivacy.hint',
            'Blurs your screen capture in OBS so viewers can’t read it. Your own screen stays sharp.'
          )}
      </TooltipContent>
    </Tooltip>
  )
}
