import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import {
  STREAM_OVERLAY_PAGES,
  type StreamOverlayAgent,
  type StreamOverlayChatMessage,
  type StreamOverlayStatus
} from '../../shared/stream-overlay'
import type { TwitchStreamStats } from '../../shared/twitch-chat-types'
import { STREAM_OVERLAY_SCRIPT, renderStreamOverlayPage } from './stream-overlay-pages'
import {
  STREAM_CHAT_DASHBOARD_SCRIPT,
  renderStreamChatDashboardPage
} from './stream-chat-dashboard-page'

export type StreamOverlayChatPayload = {
  channel: string | null
  status: string
  messages: StreamOverlayChatMessage[]
}

export type StreamOverlayAgentsPayload = { agents: StreamOverlayAgent[] }

export type StreamOverlayStatsPayload = { stats: TwitchStreamStats | null }

const MAX_EVENT_CLIENTS = 32
// Why: OBS keeps sources open for hours; a comment line stops idle proxies/sockets from timing out.
const KEEPALIVE_MS = 25_000
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'"
}

type StreamOverlayServerOptions = {
  getChat: () => StreamOverlayChatPayload
  getAgents: () => StreamOverlayAgentsPayload
  getStats: () => StreamOverlayStatsPayload
  onStatusChange?: (status: StreamOverlayStatus) => void
}

/** Loopback-only HTTP server for OBS browser sources; every data route requires the token. */
export class StreamOverlayServer {
  private server: Server | null = null
  private token = ''
  private port = 0
  private status: StreamOverlayStatus = { state: 'stopped' }
  private readonly clients = new Set<ServerResponse>()
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: StreamOverlayServerOptions) {}

  getStatus(): StreamOverlayStatus {
    return this.status
  }

  setToken(token: string): void {
    if (token === this.token) {
      return
    }
    this.token = token
    // Why: a regenerated link must cut off sources that connected with the old one.
    this.closeClients()
  }

  async start(port: number): Promise<void> {
    if (this.server && this.port === port) {
      return
    }
    await this.stop()
    this.port = port
    const server = createServer((request, response) => this.handle(request, response))
    this.server = server
    await new Promise<void>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (this.server === server) {
          this.server = null
          this.setStatus({
            state: 'error',
            port,
            message: error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message
          })
        }
        resolve()
      })
      server.listen(port, '127.0.0.1', () => {
        this.setStatus({ state: 'listening', port })
        resolve()
      })
    })
    if (this.server === server && !this.keepaliveTimer) {
      this.keepaliveTimer = setInterval(() => this.writeAll(': keepalive\n\n'), KEEPALIVE_MS)
      this.keepaliveTimer.unref?.()
    }
  }

  async stop(): Promise<void> {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    this.closeClients()
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.setStatus({ state: 'stopped' })
  }

  publishChat(payload: StreamOverlayChatPayload): void {
    this.writeAll(`event: chat\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  publishAgents(payload: StreamOverlayAgentsPayload): void {
    this.writeAll(`event: agents\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  publishStats(payload: StreamOverlayStatsPayload): void {
    this.writeAll(`event: stats\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    // Why: a Host check defeats DNS-rebinding pages that resolve their own name to 127.0.0.1.
    const host = request.headers.host ?? ''
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      this.reply(response, 421, 'text/plain', 'Misdirected request')
      return
    }
    if (request.method !== 'GET') {
      this.reply(response, 405, 'text/plain', 'Method not allowed')
      return
    }
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (url.pathname === '/overlay/overlay.js') {
      this.reply(response, 200, 'text/javascript; charset=utf-8', STREAM_OVERLAY_SCRIPT)
      return
    }
    if (url.pathname === '/overlay/dashboard.js') {
      this.reply(response, 200, 'text/javascript; charset=utf-8', STREAM_CHAT_DASHBOARD_SCRIPT)
      return
    }
    if (!this.isAuthorized(url.searchParams.get('token'))) {
      this.reply(response, 404, 'text/plain', 'Not found')
      return
    }
    if (url.pathname === '/overlay/events') {
      this.openEventStream(response)
      return
    }
    const page = STREAM_OVERLAY_PAGES.find((name) => url.pathname === `/overlay/${name}`)
    if (page) {
      // Why reader=1: the streamer's own chat window gets the dashboard; OBS sources keep the overlay.
      const html =
        page === 'chat' && url.searchParams.get('reader') === '1'
          ? renderStreamChatDashboardPage()
          : renderStreamOverlayPage(page)
      this.reply(response, 200, 'text/html; charset=utf-8', html)
      return
    }
    this.reply(response, 404, 'text/plain', 'Not found')
  }

  private isAuthorized(candidate: string | null): boolean {
    if (!this.token || !candidate) {
      return false
    }
    const expected = Buffer.from(this.token)
    const actual = Buffer.from(candidate)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private openEventStream(response: ServerResponse): void {
    if (this.clients.size >= MAX_EVENT_CLIENTS) {
      this.reply(response, 503, 'text/plain', 'Too many overlay connections')
      return
    }
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive'
    })
    response.write('retry: 2000\n\n')
    this.clients.add(response)
    response.on('close', () => this.clients.delete(response))
    response.write(`event: chat\ndata: ${JSON.stringify(this.options.getChat())}\n\n`)
    response.write(`event: agents\ndata: ${JSON.stringify(this.options.getAgents())}\n\n`)
    response.write(`event: stats\ndata: ${JSON.stringify(this.options.getStats())}\n\n`)
  }

  private reply(response: ServerResponse, status: number, contentType: string, body: string): void {
    response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType })
    response.end(body)
  }

  private writeAll(chunk: string): void {
    for (const client of this.clients) {
      client.write(chunk)
    }
  }

  private closeClients(): void {
    for (const client of this.clients) {
      client.end()
    }
    this.clients.clear()
  }

  private setStatus(status: StreamOverlayStatus): void {
    this.status = status
    this.options.onStatusChange?.(status)
  }
}
