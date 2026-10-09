import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { StreamModeState } from '../../../../shared/stream-overlay'
import { translate } from '@/i18n/i18n'

export type StreamModeControls = {
  state: StreamModeState | null
  pending: boolean
  toggle: () => void
}

export function useStreamMode(): StreamModeControls {
  const [state, setState] = useState<StreamModeState | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let disposed = false
    const accept = (next: StreamModeState | null | undefined): void => {
      if (!disposed && next) {
        setState(next)
      }
    }
    const unsubscribe = window.api.streamMode.onChanged(accept)
    void window.api.streamMode.getState().then(accept, () => {})
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const toggle = useCallback(() => {
    setPending(true)
    const request = state?.active ? window.api.streamMode.stop() : window.api.streamMode.start()
    void request
      .then(setState, () => {
        toast.error(
          translate(
            'auto.components.right.sidebar.streamMode.failed',
            'Could not switch stream mode.'
          )
        )
      })
      .finally(() => setPending(false))
  }, [state?.active])

  return { state, pending, toggle }
}
