import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const DEFAULT_OBS_WEBSOCKET_PORT = 4455

const configSchema = z.object({
  server_port: z.number().optional(),
  auth_required: z.boolean().optional(),
  server_password: z.string().optional()
})

export type ObsWebsocketConfig = { url: string; password: string | null }

function obsConfigDirectories(platform: NodeJS.Platform): string[] {
  const home = homedir()
  if (platform === 'win32') {
    return [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'obs-studio')]
  }
  if (platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'obs-studio')]
  }
  return [
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'obs-studio'),
    path.join(home, '.var', 'app', 'com.obsproject.Studio', 'config', 'obs-studio')
  ]
}

/** Reads OBS's own obs-websocket settings so the streamer never re-types the password. */
export async function readObsWebsocketConfig(
  platform: NodeJS.Platform = process.platform
): Promise<ObsWebsocketConfig> {
  for (const directory of obsConfigDirectories(platform)) {
    const file = path.join(directory, 'plugin_config', 'obs-websocket', 'config.json')
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const config = configSchema.safeParse(JSON.parse(raw)).data
    const port = config?.server_port ?? DEFAULT_OBS_WEBSOCKET_PORT
    return {
      url: `ws://127.0.0.1:${port}`,
      password: config?.auth_required === false ? null : config?.server_password || null
    }
  }
  return { url: `ws://127.0.0.1:${DEFAULT_OBS_WEBSOCKET_PORT}`, password: null }
}
