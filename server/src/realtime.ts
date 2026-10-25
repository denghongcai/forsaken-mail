/**
 * Realtime push via socket.io v4.
 *
 * Difference from v1:
 *   - v1 routed mail through a "short id ↔ socket" online table; a page refresh
 *     broke the connection;
 *   - v2 carries a JWT in the socket handshake; the server joins each socket to
 *     an `account:<id>` room, so every tab/device of the same account that is
 *     online receives the push.
 *
 * Event contract (server → client):
 *   message:new    a new message arrived; payload is a MessageSummaryDto
 */
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import { verifyToken } from './auth.js'
import { toSummaryDto } from './dto.js'
import type { MessageRow } from './types.js'

/** Room-name prefix a socket joins after connecting */
const roomOf = (accountId: string): string => `account:${accountId}`

/** Create a socket.io instance bound to the HTTP server */
export function createRealtime(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // In production the frontend is served by the same Express instance (same origin);
    // in development requests go through the Vite proxy, so there is no cross-origin traffic
    cors: { origin: true, credentials: true },
  })

  // Handshake auth: invalid tokens are rejected immediately; the client should
  // fall back to obtaining a fresh token
  io.use((socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (typeof token !== 'string' || token === '') {
      next(new Error('unauthorized: missing token'))
      return
    }
    void verifyToken(token).then((accountId) => {
      if (accountId === null) {
        next(new Error('unauthorized: invalid token'))
        return
      }
      socket.data.accountId = accountId
      next()
    })
  })

  io.on('connection', (socket: Socket) => {
    const accountId = socket.data.accountId as string
    void socket.join(roomOf(accountId))
  })

  return io
}

/** Push a new-message summary to every online socket of an account */
export function notifyNewMessage(io: SocketIOServer, accountId: string, message: MessageRow): void {
  io.to(roomOf(accountId)).emit('message:new', toSummaryDto(message))
}
