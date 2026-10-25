/**
 * socket.io client singleton.
 *
 * Event contract (server → client):
 *   message:new  a new message arrived; payload is a MessageSummary
 *
 * The handshake carries the JWT in the auth payload; call setSocketToken()
 * to reconnect when the token changes (account switch).
 */
import { io, type Socket } from 'socket.io-client'
import type { MessageSummary } from './types'

let socket: Socket | null = null
let currentToken: string | null = null

/** New-message listener set: registered by React hooks, unregistered on unmount */
type NewMessageListener = (summary: MessageSummary) => void
const listeners = new Set<NewMessageListener>()

/** Establish (or re-establish with a new token) the socket connection */
export function connectSocket(token: string): Socket {
  if (socket !== null && currentToken === token) return socket
  socket?.disconnect()
  currentToken = token
  socket = io('/', {
    // Handshake auth: the server verifies the JWT, then joins the account room
    auth: { token },
    transports: ['websocket'],
  })
  socket.on('message:new', (summary: MessageSummary) => {
    for (const listener of listeners) listener(summary)
  })
  return socket
}

/** Subscribe to new-message events; returns the unsubscribe function (for useEffect cleanup) */
export function onNewMessage(listener: NewMessageListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current socket instance (null before the first connect) */
export function getSocket(): Socket | null {
  return socket
}

/** Disconnect (when the account is deleted/logged out) */
export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
  currentToken = null
}
