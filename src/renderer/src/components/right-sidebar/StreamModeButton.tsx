import React from 'react'
import { Loader2, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useStreamMode } from './use-stream-mode'

export function StreamModeButton(): React.JSX.Element {
  const { state, pending, toggle } = useStreamMode()
  const active = state?.active === true
  const label = active
    ? translate('auto.components.right.sidebar.streamMode.end', 'End stream')
    : translate('auto.components.right.sidebar.streamMode.start', 'Go live')
  const hint = active
    ? translate(
        'auto.components.right.sidebar.streamMode.endHint',
        'Closes the chat window and runs your stream-stop script.'
      )
    : translate(
        'auto.components.right.sidebar.streamMode.hint',
        'Opens the chat window and runs your stream-start script.'
      )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'outline'}
          size="xs"
          disabled={pending || state === null}
          onClick={toggle}
          aria-pressed={active}
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Radio className="size-3" />}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

export function StreamModeHookError(): React.JSX.Element | null {
  const { state } = useStreamMode()
  if (!state?.hookError) {
    return null
  }
  return (
    <p role="alert" className="border-b border-border px-3 py-1.5 text-xs text-destructive">
      {state.hookError}
    </p>
  )
}
