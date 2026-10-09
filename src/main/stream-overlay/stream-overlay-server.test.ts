import { createServer, request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { StreamOverlayServer } from './stream-overlay-server'

const TOKEN = 'test-token-0123456789'

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('no port')
  }
  return address.port
}

function get(
  port: number,
  path: string,
  host = `127.0.0.1:${port}`
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
        // Event streams never end; resolve once the initial events have arrived.
        if (
          res.headers['content-type']?.startsWith('text/event-stream') &&
          body.includes('event: stats')
        ) {
          res.destroy()
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        }
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('StreamOverlayServer', () => {
  let server: StreamOverlayServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  async function startServer(): Promise<number> {
    const port = await freePort()
    server = new StreamOverlayServer({
      getChat: () => ({
        channel: 'chan',
        status: 'connected',
        messages: [
          {
            id: '1',
            name: 'Viewer',
            text: '<img src=x onerror=alert(1)>',
            isAction: false,
            color: null
          }
        ]
      }),
      getAgents: () => ({ agents: [] }),
      getStats: () => ({ stats: null })
    })
    server.setToken(TOKEN)
    await server.start(port)
    return port
  }

  it('serves overlay pages only with the token', async () => {
    const port = await startServer()
    expect(server?.getStatus()).toEqual({ state: 'listening', port })

    const page = await get(port, `/overlay/chat?token=${TOKEN}`)
    expect(page.status).toBe(200)
    expect(page.body).toContain('data-page="chat"')
    expect(page.headers['content-security-policy']).toContain("script-src 'self'")

    expect((await get(port, '/overlay/chat')).status).toBe(404)
    expect((await get(port, '/overlay/chat?token=wrong')).status).toBe(404)
    expect((await get(port, `/overlay/nope?token=${TOKEN}`)).status).toBe(404)
    expect((await get(port, '/overlay/overlay.js')).status).toBe(200)
  })

  it('serves the chat dashboard for reader=1 only', async () => {
    const port = await startServer()
    const dashboard = await get(port, `/overlay/chat?token=${TOKEN}&reader=1`)
    expect(dashboard.status).toBe(200)
    expect(dashboard.body).toContain('id="composer"')
    expect(dashboard.body).not.toContain('data-page="chat"')
    expect((await get(port, '/overlay/dashboard.js')).status).toBe(200)
  })

  it('rejects requests whose Host is not loopback', async () => {
    const port = await startServer()
    const rebound = await get(port, `/overlay/chat?token=${TOKEN}`, `evil.example:${port}`)
    expect(rebound.status).toBe(421)
  })

  it('streams the current chat and agents as JSON events', async () => {
    const port = await startServer()
    const events = await get(port, `/overlay/events?token=${TOKEN}`)
    expect(events.status).toBe(200)
    expect(events.body).toContain('event: chat')
    expect(events.body).toContain('event: stats')
    // The raw text travels as JSON data; the page inserts it with textContent.
    expect(events.body).toContain('"text":"<img src=x onerror=alert(1)>"')
  })

  it('cuts off a rotated token and reports a busy port', async () => {
    const port = await startServer()
    server?.setToken('another-token-0123456789')
    expect((await get(port, `/overlay/chat?token=${TOKEN}`)).status).toBe(404)

    const second = new StreamOverlayServer({
      getChat: () => ({ channel: null, status: 'disabled', messages: [] }),
      getAgents: () => ({ agents: [] }),
      getStats: () => ({ stats: null })
    })
    await second.start(port)
    expect(second.getStatus()).toEqual({
      state: 'error',
      port,
      message: `Port ${port} is already in use.`
    })
    await second.stop()
  })
})
