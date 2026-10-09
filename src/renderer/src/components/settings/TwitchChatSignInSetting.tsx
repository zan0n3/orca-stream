import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { DebouncedSettingsTextInput } from './DebouncedSettingsTextInput'
import { useTwitchChatAuth } from '../right-sidebar/use-twitch-chat-auth'

const TWITCH_APP_CONSOLE_URL = 'https://dev.twitch.tv/console/apps/create'

type TwitchChatSignInSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function TwitchChatSignInStatus({ hasClientId }: { hasClientId: boolean }): React.JSX.Element {
  const auth = useTwitchChatAuth()

  if (auth?.state === 'signed-in') {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {translate('auto.components.settings.twitchChat.signedInAs', 'Signed in as {{login}}.', {
            login: auth.login
          })}
        </p>
        <Button variant="outline" size="xs" onClick={() => void window.api.twitchChat.signOut()}>
          {translate('auto.components.settings.twitchChat.signOut', 'Sign out')}
        </Button>
      </div>
    )
  }

  if (auth?.state === 'pending') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {translate(
            'auto.components.settings.twitchChat.enterCode',
            'On Twitch, approve the sign-in with this code:'
          )}{' '}
          <span className="font-mono font-semibold text-foreground">{auth.userCode}</span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => void window.api.shell.openUrl(auth.verificationUri)}
          >
            {translate('auto.components.settings.twitchChat.openTwitch', 'Open Twitch')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void window.api.twitchChat.cancelSignIn()}
          >
            {translate('auto.components.settings.twitchChat.cancelSignIn', 'Cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="xs"
        disabled={!hasClientId}
        onClick={() => void window.api.twitchChat.startSignIn()}
      >
        {translate('auto.components.settings.twitchChat.signIn', 'Sign in with Twitch')}
      </Button>
      {auth?.error ? <p className="text-xs text-destructive">{auth.error}</p> : null}
    </div>
  )
}

export function TwitchChatSignInSetting({
  settings,
  updateSettings
}: TwitchChatSignInSettingProps): React.JSX.Element {
  const clientId = settings.twitchChatClientId ?? ''

  return (
    <div className="space-y-2">
      <Label htmlFor="twitch-chat-client-id">
        {translate('auto.components.settings.twitchChat.chatBackLabel', 'Chat as yourself')}
      </Label>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.twitchChat.clientIdHint',
          'To send messages, register a Twitch app (Client Type: Public, OAuth redirect http://localhost) and paste its Client ID.'
        )}
      </p>
      <Button
        variant="outline"
        size="xs"
        onClick={() => void window.api.shell.openUrl(TWITCH_APP_CONSOLE_URL)}
      >
        {translate('auto.components.settings.twitchChat.registerApp', 'Register an app')}
      </Button>
      <DebouncedSettingsTextInput
        id="twitch-chat-client-id"
        value={clientId}
        commit={(next) => updateSettings({ twitchChatClientId: next })}
        placeholder={translate(
          'auto.components.settings.twitchChat.clientIdPlaceholder',
          'Client ID'
        )}
        spellCheck={false}
        autoComplete="off"
      />
      <TwitchChatSignInStatus hasClientId={clientId.trim() !== ''} />
    </div>
  )
}
