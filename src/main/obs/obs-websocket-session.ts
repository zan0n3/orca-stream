import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { z } from 'zod'

const CONNECT_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 5_000

const helloSchema = z.object({
  op: z.literal(0),
  d: z.object({
    authentication: z.object({ challenge: z.string(), salt: z.string() }).optional()
  })
})
const responseSchema = z.object({
  op: z.literal(7),
  d: z.object({
    requestId: z.string(),
    requestStatus: z.object({
      result: z.boolean(),
      code: z.number(),
      comment: z.string().optional()
    }),
    responseData: z.record(z.string(), z.unknown()).optional()
  })
})

/** obs-websocket v5 auth string: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function obsAuthString(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256')
    .update(password + salt)
    .digest('base64')
  return createHash('sha256')
    .update(secret + challenge)
    .digest('base64')
}

export class ObsRequestError extends Error {
  constructor(
    message: string,
    readonly code: number
  ) {
    super(message)
  }
}

export type ObsSession = {
  request: (
    requestType: string,
    requestData?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
  close: () => void
}

export type ObsSessionOptions = {
  /** obs-websocket EventSubscription bitmask; 0 (default) receives no events. */
  eventSubscriptions?: number
  onEvent?: (eventType: string, eventData: Record<string, unknown>) => void
  /** Called once if the socket closes after the session was identified. */
  onClose?: () => void
}

const eventSchema = z.object({
  op: z.literal(5),
  d: z.object({
    eventType: z.string(),
    eventData: z.record(z.string(), z.unknown()).optional()
  })
})

/** Opens an identified obs-websocket v5 session; callers close it when done. */
export function openObsSession(
  url: string,
  password: string | null,
  options: ObsSessionOptions = {}
): Promise<ObsSession> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS })
    const pending = new Map<
      string,
      { resolve: (data: Record<string, unknown>) => void; reject: (error: Error) => void }
    >()
    let identified = false
    const fail = (error: Error): void => {
      for (const entry of pending.values()) {
        entry.reject(error)
      }
      pending.clear()
      if (!identified) {
        reject(error)
      }
    }
    const timer = setTimeout(() => {
      fail(new Error('OBS did not answer. Is OBS open with WebSocket server enabled?'))
      socket.terminate()
    }, CONNECT_TIMEOUT_MS)

    socket.on('error', (error) => fail(new Error(`Could not reach OBS: ${error.message}`)))
    socket.on('close', (code) => {
      clearTimeout(timer)
      if (identified) {
        options.onClose?.()
      }
      // Why 4009: obs-websocket's "authentication failed" close code.
      fail(
        new Error(
          code === 4009 ? 'OBS rejected the WebSocket password.' : 'The connection to OBS closed.'
        )
      )
    })
    socket.on('message', (raw) => {
      let message: unknown
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      const hello = helloSchema.safeParse(message)
      if (hello.success) {
        const auth = hello.data.d.authentication
        if (auth && !password) {
          fail(new Error('OBS needs a WebSocket password, and none was found.'))
          socket.terminate()
          return
        }
        socket.send(
          JSON.stringify({
            op: 1,
            d: {
              rpcVersion: 1,
              eventSubscriptions: options.eventSubscriptions ?? 0,
              ...(auth && password
                ? { authentication: obsAuthString(password, auth.salt, auth.challenge) }
                : {})
            }
          })
        )
        return
      }
      if (typeof message === 'object' && message !== null && 'op' in message && message.op === 2) {
        identified = true
        clearTimeout(timer)
        resolve({
          request: (requestType, requestData) =>
            new Promise((resolveRequest, rejectRequest) => {
              const requestId = randomUUID()
              const requestTimer = setTimeout(() => {
                pending.delete(requestId)
                rejectRequest(new Error(`OBS did not answer ${requestType}.`))
              }, REQUEST_TIMEOUT_MS)
              pending.set(requestId, {
                resolve: (data) => {
                  clearTimeout(requestTimer)
                  resolveRequest(data)
                },
                reject: (error) => {
                  clearTimeout(requestTimer)
                  rejectRequest(error)
                }
              })
              socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }))
            }),
          close: () => socket.close()
        })
        return
      }
      if (options.onEvent) {
        const event = eventSchema.safeParse(message)
        if (event.success) {
          options.onEvent(event.data.d.eventType, event.data.d.eventData ?? {})
          return
        }
      }
      const response = responseSchema.safeParse(message)
      if (response.success) {
        const entry = pending.get(response.data.d.requestId)
        pending.delete(response.data.d.requestId)
        const status = response.data.d.requestStatus
        if (status.result) {
          entry?.resolve(response.data.d.responseData ?? {})
        } else {
          entry?.reject(
            new ObsRequestError(
              status.comment || `OBS request failed (${status.code}).`,
              status.code
            )
          )
        }
      }
    })
  })
}
