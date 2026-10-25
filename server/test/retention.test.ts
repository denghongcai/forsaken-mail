/**
 * Retention (disk-protection) tests: verify all four cleanup categories with
 * tiny quotas. A separate file = a separate process (vitest forks pool), so
 * environment variables don't interfere with other test files.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.JWT_SECRET = 'test-secret'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'forsaken-rt2-'))
process.env.MAX_MESSAGES_PER_ACCOUNT = '3'
process.env.MAX_TOTAL_MESSAGES = '6'

const { insertMessage, insertAccount, listMessages, countAllMessages } =
  await import('../src/db.js')
const { randomUUID } = await import('node:crypto')
import type { MessageRow } from '../src/types.js'

// Foreign keys are enforced, so seed the test accounts first
insertAccount({ id: 'acc-1', address: 'acc1@test.local', passwordHash: 'x', createdAt: Date.now() })
insertAccount({ id: 'acc-2', address: 'acc2@test.local', passwordHash: 'x', createdAt: Date.now() })

function seed(accountId: string, createdAt: number): MessageRow {
  return {
    id: randomUUID(),
    accountId,
    msgid: null,
    fromAddr: 'a@b.c',
    fromName: null,
    toJson: '[]',
    subject: String(createdAt),
    intro: null,
    text: null,
    html: null,
    raw: Buffer.from(''),
    seen: false,
    hasAttachments: false,
    size: 0,
    attachmentsJson: '[]',
    createdAt,
  }
}

const ACCOUNT = 'acc-1'

describe('retention policy', () => {
  it('deletes the oldest messages when an account exceeds 3', () => {
    // Base = "1 minute ago": newer than the TTL window (won't be purged as
    // expired) yet older than the timestamps of the following cases
    const base = Date.now() - 60_000
    for (let i = 0; i < 5; i++) {
      insertMessage(seed(ACCOUNT, base + i * 1000))
    }
    const { total } = listMessages(ACCOUNT, { limit: 10, offset: 0 })
    expect(total).toBe(3)
    // The newest 3 should survive
    const subjects = listMessages(ACCOUNT, { limit: 10, offset: 0 }).items.map((m) => m.subject)
    expect(subjects).toEqual([String(base + 4000), String(base + 3000), String(base + 2000)])
  })

  it('deletes the globally oldest messages when the database exceeds 6', () => {
    // The per-account cap fires before the global cap, so the global cap only
    // kicks in when every account is individually within its limit. Use
    // 4 accounts × 2 messages (below the per-account cap of 3) with timestamps
    // older than the previous case, making them the oldest in the database.
    const base = Date.now() - 120_000
    for (let a = 0; a < 4; a++) {
      const id = `bulk-${a}`
      insertAccount({ id, address: `bulk${a}@test.local`, passwordHash: 'x', createdAt: base })
      insertMessage(seed(id, base + a * 100))
      insertMessage(seed(id, base + a * 100 + 50))
    }
    // The database is squeezed back down to 6
    expect(countAllMessages()).toBe(6)
    // The oldest, bulk-0 (two messages), should have been reclaimed
    expect(listMessages('bulk-0', { limit: 10, offset: 0 }).total).toBe(0)
  })

  it('expired messages are purged by TTL', async () => {
    // MESSAGE_TTL_HOURS uses the default (24h); backdate all rows by 2 days to simulate expiry
    const { db } = await import('../src/db.js')
    const { enforceRetention } = await import('../src/db.js')
    const stale = Date.now() - 48 * 3600_000
    db.prepare('UPDATE messages SET created_at = ?').run(stale)
    enforceRetention()
    expect(countAllMessages()).toBe(0)
  })

  afterAll(() => {
    rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
  })
})
