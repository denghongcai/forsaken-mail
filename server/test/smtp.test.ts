/**
 * SMTP ingestion integration tests: exercise the full path
 * "nodemailer delivery → smtp-server receive → parse+store → notify callback".
 * Uses high ports to avoid needing root.
 *
 * Test fixtures deliberately contain non-ASCII (Chinese) content to exercise
 * UTF-8/encoded-word handling in the MIME parser.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'
import type { MessageRow } from '../src/types.js'

process.env.JWT_SECRET = 'test-secret'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'forsaken-smtp-'))
process.env.DOMAINS = 'test.local'
process.env.SMTP_PORT = '35253'
process.env.SMTP_HOST = '127.0.0.1'

const { startSmtp } = await import('../src/smtp.js')
const { findAccountByAddress, insertAccount, listMessages } = await import('../src/db.js')
const { randomUUID } = await import('node:crypto')

const SMTP_PORT = 35253

/** Notification queue of received messages; tests wait on / assert against it */
const received: MessageRow[] = []

const smtp = startSmtp((_accountId, message) => {
  received.push(message)
})

/** Wait until n new messages have arrived (with a timeout so cases can't hang) */
async function waitForMail(count: number): Promise<void> {
  const deadline = Date.now() + 5000
  while (received.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(received.length).toBeGreaterThanOrEqual(count)
}

// ignoreTLS: the local test server has no TLS certificate, skip STARTTLS negotiation
const transporter: Mail = nodemailer.createTransport({
  port: SMTP_PORT,
  host: '127.0.0.1',
  secure: false,
  ignoreTLS: true,
})

// Seed two recipient accounts
const aliceId = randomUUID()
insertAccount({
  id: aliceId,
  address: 'alice@test.local',
  passwordHash: 'x',
  createdAt: Date.now(),
})
insertAccount({
  id: randomUUID(),
  address: 'bob@test.local',
  passwordHash: 'x',
  createdAt: Date.now(),
})

afterAll(async () => {
  await new Promise<void>((resolve) => smtp.close(() => resolve()))
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
})

describe('SMTP ingestion', () => {
  it('delivered messages are parsed, stored, and trigger a notification', async () => {
    await transporter.sendMail({
      from: { name: '外部发件人', address: 'outside@example.com' },
      to: 'Alice@Test.Local',
      subject: '你好，世界',
      text: '纯文本内容',
      html: '<p>HTML <b>内容</b></p>',
      attachments: [{ filename: 'note.txt', content: '附件内容', contentType: 'text/plain' }],
    })
    await waitForMail(1)

    const message = received[0]!
    expect(message.accountId).toBe(aliceId)
    expect(message.fromAddr).toBe('outside@example.com')
    expect(message.fromName).toBe('外部发件人')
    expect(message.subject).toBe('你好，世界')
    expect(message.text).toContain('纯文本内容')
    expect(message.html).toContain('<b>内容</b>')
    expect(message.seen).toBe(false)

    // Attachments stored as base64
    const attachments: { filename: string; content: string }[] = JSON.parse(message.attachmentsJson)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]!.filename).toBe('note.txt')
    expect(Buffer.from(attachments[0]!.content, 'base64').toString()).toBe('附件内容')

    // The stored result is visible through the db layer
    const stored = listMessages(aliceId, { limit: 10, offset: 0 })
    expect(stored.total).toBe(1)
  })

  it('intro is a whitespace-collapsed preview of at most 128 chars', () => {
    const message = received[0]!
    expect(message.intro).toContain('纯文本内容')
    expect((message.intro ?? '').length).toBeLessThanOrEqual(128)
  })

  it('unknown account: accepted but silently dropped', async () => {
    await transporter.sendMail({
      from: 'outside@example.com',
      to: 'nobody@test.local',
      subject: '无主邮件',
      text: 'x',
    })
    // Wait 500ms to confirm no new notification arrived
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(received).toHaveLength(1)
    expect(findAccountByAddress('nobody@test.local')).toBeUndefined()
  })

  it('auto-forwarded mail is routed via the SMTP envelope when the To header points elsewhere', async () => {
    // Simulate an auto-forward: the To: header still shows the ORIGINAL
    // recipient (an external mailbox) while the envelope recipient is our
    // address — the server must fall back to the envelope to find the account
    await transporter.sendMail({
      from: 'service@example.com',
      to: 'someone@163.com',
      envelope: {
        from: 'service@example.com',
        to: 'alice@test.local',
      },
      subject: 'forwarded verification code',
      text: 'your code is 123456',
    })
    await waitForMail(2)

    const forwarded = received[1]!
    expect(forwarded.accountId).toBe(aliceId)
    expect(forwarded.subject).toBe('forwarded verification code')
    // The stored "to" stays truthful to the headers (the original recipient)
    const to: { address: string }[] = JSON.parse(forwarded.toJson)
    expect(to[0]!.address).toBe('someone@163.com')
  })

  it('header recipients take priority over the envelope', async () => {
    // Both accounts exist; the header To must win over the envelope RCPT
    await transporter.sendMail({
      from: 'outside@example.com',
      to: 'alice@test.local',
      envelope: {
        from: 'outside@example.com',
        to: 'bob@test.local',
      },
      subject: 'direct',
      text: 'x',
    })
    await waitForMail(3)
    expect(received[2]!.accountId).toBe(aliceId)
  })

  it('blacklisted recipient is rejected at the RCPT stage', async () => {
    await expect(
      transporter.sendMail({
        from: 'outside@example.com',
        to: 'root@test.local',
        subject: 'x',
        text: 'x',
      }),
    ).rejects.toThrow()
  })

  it('non-served domains are rejected at the RCPT stage (anti open relay)', async () => {
    await expect(
      transporter.sendMail({
        from: 'outside@example.com',
        to: 'someone@gmail.com',
        subject: 'x',
        text: 'x',
      }),
    ).rejects.toThrow()
  })
})
