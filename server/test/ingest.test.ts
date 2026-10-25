/**
 * HTTP ingest tests: POST /api/ingest with a raw MIME body — the way a relay
 * (e.g. the Cloudflare Email Worker) delivers mail in CDN-fronted deployments.
 * Covers auth, storage + notify, envelope-header routing, and disabled mode.
 *
 * Note: config.ts reads environment variables at import time, so the env must
 * be set BEFORE dynamically importing the modules under test.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import supertest from 'supertest'
import type { Express } from 'express'

process.env.JWT_SECRET = 'test-secret'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'forsaken-ingest-'))
process.env.DOMAINS = 'test.local'
process.env.INGEST_TOKEN = 'test-ingest-token'

// Load the code under test only after the environment is in place
const { createApp } = await import('../src/app.js')
const { config } = await import('../src/config.js')
const { insertAccount, listMessages } = await import('../src/db.js')
const { randomUUID } = await import('node:crypto')

let app: Express

/** Notify collector: every stored message lands here */
const received: { accountId: string; subject: string | null }[] = []

/** Minimal RFC 822 plain-text message for posting */
function mime(to: string, subject: string): Buffer {
  return Buffer.from(
    'From: Outside <outside@example.com>\r\n' +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      'Date: Sat, 25 Oct 2026 00:00:00 +0000\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      '\r\n' +
      'hello ingest\r\n',
  )
}

beforeAll(() => {
  insertAccount({
    id: randomUUID(),
    address: 'carol@test.local',
    passwordHash: 'x',
    createdAt: Date.now(),
  })
  app = createApp((accountId, message) => {
    received.push({ accountId, subject: message.subject })
  })
})

afterAll(() => {
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
})

describe('POST /api/ingest', () => {
  it('rejects missing and wrong bearer tokens', async () => {
    const noAuth = await supertest(app)
      .post('/api/ingest')
      .set('content-type', 'message/rfc822')
      .send(mime('carol@test.local', 'nope'))
    expect(noAuth.status).toBe(401)

    const wrong = await supertest(app)
      .post('/api/ingest')
      .set('authorization', 'Bearer wrong-token')
      .set('content-type', 'message/rfc822')
      .send(mime('carol@test.local', 'nope'))
    expect(wrong.status).toBe(401)
  })

  it('stores a raw MIME message and fires the notify callback', async () => {
    const res = await supertest(app)
      .post('/api/ingest')
      .set('authorization', 'Bearer test-ingest-token')
      .set('content-type', 'message/rfc822')
      .send(mime('carol@test.local', 'via ingest'))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('stored')
    expect(received).toHaveLength(1)
    expect(received[0]!.subject).toBe('via ingest')
    expect(listMessages(received[0]!.accountId, { limit: 10, offset: 0 }).total).toBe(1)
  })

  it('routes via the X-Envelope-To header when To: points elsewhere', async () => {
    // Same scenario as auto-forwarded SMTP mail: the header To shows an
    // external address while the envelope recipient is our account
    const res = await supertest(app)
      .post('/api/ingest')
      .set('authorization', 'Bearer test-ingest-token')
      .set('content-type', 'message/rfc822')
      .set('x-envelope-to', 'carol@test.local')
      .send(mime('someone@163.com', 'envelope routed'))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('stored')
    expect(received[1]!.subject).toBe('envelope routed')
  })

  it('drops mail matching no account (accepted, not stored)', async () => {
    const res = await supertest(app)
      .post('/api/ingest')
      .set('authorization', 'Bearer test-ingest-token')
      .set('content-type', 'message/rfc822')
      .send(mime('nobody@test.local', 'no account'))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('dropped')
    expect(received).toHaveLength(2)
  })

  it('answers 404 when no ingest token is configured', async () => {
    config.ingest.token = null
    try {
      const res = await supertest(app)
        .post('/api/ingest')
        .set('content-type', 'message/rfc822')
        .send(mime('carol@test.local', 'disabled'))
      expect(res.status).toBe(404)
    } finally {
      config.ingest.token = 'test-ingest-token'
    }
  })
})
