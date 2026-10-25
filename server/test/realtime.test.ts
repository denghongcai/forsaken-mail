/**
 * WebSocket push integration tests:
 *   valid JWT handshake → join the account room → new-message events reach
 *   every socket of that account; invalid-token handshakes are rejected.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import type { MessageRow } from '../src/types.js'

process.env.JWT_SECRET = 'test-secret'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'forsaken-rt-'))

// Same pattern as the other tests: load the modules only after env setup
const { createRealtime, notifyNewMessage } = await import('../src/realtime.js')
const { signToken } = await import('../src/auth.js')

let httpServer: Server
let serverIo: ReturnType<typeof createRealtime>
let baseUrl: string

beforeAll(async () => {
  httpServer = createServer()
  serverIo = createRealtime(httpServer)
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const addr = httpServer.address()
  if (addr === null || typeof addr === 'string') throw new Error('failed to read the listen port')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  serverIo.close()
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
})

/** Open an authenticated client connection */
function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, { auth: { token }, transports: ['websocket'] })
    client.on('connect', () => resolve(client))
    client.on('connect_error', reject)
  })
}

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

/** Build a minimal usable test message */
function fakeMessage(): MessageRow {
  return {
    id: 'm-1',
    accountId: ACCOUNT_ID,
    msgid: null,
    fromAddr: 'a@b.c',
    fromName: null,
    toJson: '[]',
    subject: 'realtime',
    intro: null,
    text: null,
    html: null,
    raw: Buffer.from(''),
    seen: false,
    hasAttachments: false,
    size: 0,
    attachmentsJson: '[]',
    createdAt: Date.now(),
  }
}

describe('realtime', () => {
  it('a socket with a valid token receives the message:new push', async () => {
    const token = await signToken(ACCOUNT_ID)
    const client = await connect(token)
    try {
      const received = new Promise<unknown>((resolve) => client.on('message:new', resolve))
      notifyNewMessage(serverIo, ACCOUNT_ID, fakeMessage())
      const payload = (await received) as { subject: string; from: { address: string } }
      expect(payload.subject).toBe('realtime')
      expect(payload.from.address).toBe('a@b.c')
    } finally {
      client.disconnect()
    }
  })

  it('an invalid-token handshake is rejected', async () => {
    await expect(connect('not-a-valid-token')).rejects.toThrow(/unauthorized|invalid/)
  })
})
