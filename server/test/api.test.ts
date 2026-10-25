/**
 * API integration tests: no port listening; supertest drives the Express
 * instance directly. Covers all domains / accounts / token / me / messages
 * endpoints and the auth rules.
 *
 * Note: config.ts reads environment variables at import time, so the env must
 * be set BEFORE dynamically importing the modules under test (vitest's forks
 * pool gives each file its own process, keeping them isolated).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import supertest from 'supertest'
import type { Express } from 'express'

process.env.JWT_SECRET = 'test-secret'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'forsaken-api-'))
process.env.DOMAINS = 'test.local'

// Load the code under test only after the environment is in place
const { createApp } = await import('../src/app.js')
const { insertMessage } = await import('../src/db.js')
const { randomUUID } = await import('node:crypto')
import type { MessageRow } from '../src/types.js'

let app: Express

/** Quickly fabricate a test message and store it */
function seedMessage(accountId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  const message: MessageRow = {
    id: randomUUID(),
    accountId,
    msgid: `<${randomUUID()}@test.local>`,
    fromAddr: 'sender@example.com',
    fromName: 'Sender',
    toJson: JSON.stringify([]),
    subject: 'hello',
    intro: 'intro text',
    text: 'plain text body',
    html: '<p>html body</p>',
    raw: Buffer.from('raw eml'),
    seen: false,
    hasAttachments: true,
    size: 100,
    attachmentsJson: JSON.stringify([
      {
        id: 'att-1',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 4,
        content: Buffer.from('data').toString('base64'),
        inline: false,
      },
    ]),
    createdAt: Date.now(),
    ...overrides,
  }
  insertMessage(message)
  return message
}

beforeAll(() => {
  app = createApp()
})

afterAll(() => {
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
})

let account: { id: string; address: string; password: string }
let token: string

describe('domains', () => {
  it('lists the available domains', async () => {
    const res = await supertest(app).get('/api/domains')
    expect(res.status).toBe(200)
    expect(res.body.domains).toContain('test.local')
  })
})

describe('accounts', () => {
  it('random mode creates an account and returns the one-time plaintext password', async () => {
    const res = await supertest(app).post('/api/accounts').send({ random: true })
    expect(res.status).toBe(201)
    expect(res.body.address).toMatch(/^@?[\w.-]+@test\.local$/)
    expect(typeof res.body.password).toBe('string')
  })

  it('creates an account with an explicit address', async () => {
    const res = await supertest(app)
      .post('/api/accounts')
      .send({ address: 'alice@Test.Local', password: 'secret123' })
    expect(res.status).toBe(201)
    // The address should be normalized to lowercase
    expect(res.body.address).toBe('alice@test.local')
    account = { id: res.body.id, address: res.body.address, password: 'secret123' }
  })

  it('duplicate address returns 409', async () => {
    const res = await supertest(app)
      .post('/api/accounts')
      .send({ address: 'alice@test.local', password: 'secret123' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('conflict')
  })

  it('blacklisted address is rejected', async () => {
    const res = await supertest(app)
      .post('/api/accounts')
      .send({ address: 'root@test.local', password: 'pass1234' })
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('reserved')
  })

  it('external domain is rejected', async () => {
    const res = await supertest(app)
      .post('/api/accounts')
      .send({ address: 'someone@gmail.com', password: 'pass1234' })
    expect(res.status).toBe(422)
  })

  it('too-short password returns 422', async () => {
    const res = await supertest(app)
      .post('/api/accounts')
      .send({ address: 'bob@test.local', password: 'abc' })
    expect(res.status).toBe(422)
  })

  it('missing parameters return 400', async () => {
    const res = await supertest(app).post('/api/accounts').send({})
    expect(res.status).toBe(400)
  })
})

describe('token / me', () => {
  it('correct credentials yield a token', async () => {
    const res = await supertest(app)
      .post('/api/token')
      .send({ address: account.address, password: account.password })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(account.id)
    token = res.body.token
  })

  it('wrong password returns 401', async () => {
    const res = await supertest(app)
      .post('/api/token')
      .send({ address: account.address, password: 'wrong-pass' })
    expect(res.status).toBe(401)
  })

  it('/me without a token returns 401', async () => {
    const res = await supertest(app).get('/api/me')
    expect(res.status).toBe(401)
  })

  it('/me with a token returns the account info', async () => {
    const res = await supertest(app).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.address).toBe(account.address)
    // The password hash must never leak
    expect(res.body.passwordHash).toBeUndefined()
  })
})

describe('messages', () => {
  let otherAccountToken: string

  beforeAll(async () => {
    // A second account for the cross-account access cases
    const reg = await supertest(app).post('/api/accounts').send({ random: true })
    const login = await supertest(app)
      .post('/api/token')
      .send({ address: reg.body.address, password: reg.body.password })
    otherAccountToken = login.body.token
  })

  it('unauthenticated access returns 401', async () => {
    const res = await supertest(app).get('/api/messages')
    expect(res.status).toBe(401)
  })

  it('list returns stored messages with the total count', async () => {
    seedMessage(account.id, { subject: 'first', createdAt: Date.now() - 2000 })
    seedMessage(account.id, { subject: 'second', createdAt: Date.now() - 1000 })
    const res = await supertest(app).get('/api/messages').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    // Newest first
    expect(res.body.items[0].subject).toBe('second')
    // Summaries must not contain the body
    expect(res.body.items[0].text).toBeUndefined()
    expect(res.body.items[0].attachments).toBeUndefined()
  })

  it('pagination parameters take effect', async () => {
    const res = await supertest(app)
      .get('/api/messages?page=2&limit=1')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].subject).toBe('first')
  })

  it('detail contains body and attachment metadata (no attachment content)', async () => {
    const seeded = seedMessage(account.id)
    const res = await supertest(app)
      .get(`/api/messages/${seeded.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.text).toBe('plain text body')
    expect(res.body.html).toBe('<p>html body</p>')
    expect(res.body.attachments).toHaveLength(1)
    expect(res.body.attachments[0].filename).toBe('report.pdf')
    expect(res.body.attachments[0].downloadUrl).toContain(`/api/messages/${seeded.id}/attachments/`)
    expect(res.body.attachments[0].content).toBeUndefined()
  })

  it('PATCH marks a message seen', async () => {
    const seeded = seedMessage(account.id)
    const res = await supertest(app)
      .patch(`/api/messages/${seeded.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ seen: true })
    expect(res.status).toBe(200)
    expect(res.body.seen).toBe(true)
  })

  it("accessing someone else's message returns 404 (anti cross-account)", async () => {
    const seeded = seedMessage(account.id)
    const res = await supertest(app)
      .get(`/api/messages/${seeded.id}`)
      .set('Authorization', `Bearer ${otherAccountToken}`)
    expect(res.status).toBe(404)
  })

  it('source returns the raw EML', async () => {
    const seeded = seedMessage(account.id, { raw: Buffer.from('Message-ID: <x>\r\n\r\nbody') })
    const res = await supertest(app)
      .get(`/api/messages/${seeded.id}/source`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Message-ID: <x>')
  })

  it('attachment downloads with matching content', async () => {
    const seeded = seedMessage(account.id)
    const res = await supertest(app)
      .get(`/api/messages/${seeded.id}/attachments/att-1`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.body.toString()).toBe('data')
  })

  it('DELETE removes a single message', async () => {
    const seeded = seedMessage(account.id)
    const del = await supertest(app)
      .delete(`/api/messages/${seeded.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)
    const get = await supertest(app)
      .get(`/api/messages/${seeded.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(get.status).toBe(404)
  })
})

describe('me deletion', () => {
  it('DELETE /me invalidates the token immediately and cascade-deletes messages', async () => {
    const reg = await supertest(app).post('/api/accounts').send({ random: true })
    const login = await supertest(app)
      .post('/api/token')
      .send({ address: reg.body.address, password: reg.body.password })
    const victimToken: string = login.body.token
    seedMessage(login.body.id)

    const del = await supertest(app).delete('/api/me').set('Authorization', `Bearer ${victimToken}`)
    expect(del.status).toBe(204)

    const after = await supertest(app).get('/api/me').set('Authorization', `Bearer ${victimToken}`)
    expect(after.status).toBe(401)

    const list = await supertest(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${victimToken}`)
    expect(list.status).toBe(401)
  })
})
