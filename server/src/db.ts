/**
 * Persistence layer: built on node:sqlite, shipped with Node 24 (no native deps).
 *
 * Tables:
 *   meta      — runtime metadata (e.g. the auto-generated JWT secret)
 *   accounts  — mail accounts (unique address)
 *   messages  — full message content (raw EML + base64 attachments), cascade-deleted with accounts
 *
 * Disk protection (retention policy): enforceRetention() runs after every
 * message insert, lazily removing expired/over-quota data — no cron needed:
 *   1. delete messages older than the TTL
 *   2. delete the oldest messages of any account above its cap
 *   3. delete the oldest messages when the database exceeds the global cap
 *   4. delete zombie accounts that have no messages and are older than the TTL
 */
import { mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { config } from './config.js'
import type { AccountRow, MessageRow } from './types.js'

// Make sure the data directory exists (idempotent)
mkdirSync(config.dataDir, { recursive: true })

// Open the database with WAL (concurrency-friendly) and foreign key cascades
export const db = new DatabaseSync(path.join(config.dataDir, 'forsaken-mail.sqlite'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/* --------------------------- Row mapping helpers --------------------------- */
// node:sqlite returns loosely typed Record<string, SQLOutputValue> rows.
// We keep precise row types next to the SQL text and funnel every query
// through the two assertion helpers below. If a table ever drifts from its
// type definition, the tests will surface it immediately.

interface AccountRowDb {
  id: string
  address: string
  password_hash: string
  created_at: number
}

interface MessageRowDb {
  id: string
  account_id: string
  msgid: string | null
  from_addr: string
  from_name: string | null
  to_json: string
  subject: string | null
  intro: string | null
  text: string | null
  html: string | null
  raw: Uint8Array
  seen: number
  has_attachments: number
  size: number
  attachments_json: string
  created_at: number
}

type Row = Record<string, SQLOutputValue>

/** Assert a single row (undefined passes through, meaning "no result") */
function asRow<T>(value: Row | undefined): T | undefined {
  return value as T | undefined
}

/** Assert a list of rows */
function asRows<T>(value: Row[]): T[] {
  return value as T[]
}

/* ------------------------------ Schema ------------------------------ */

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    address       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    msgid             TEXT,
    from_addr         TEXT NOT NULL,
    from_name         TEXT,
    to_json           TEXT NOT NULL,
    subject           TEXT,
    intro             TEXT,
    text              TEXT,
    html              TEXT,
    raw               BLOB NOT NULL,
    seen              INTEGER NOT NULL DEFAULT 0,
    has_attachments   INTEGER NOT NULL DEFAULT 0,
    size              INTEGER NOT NULL,
    attachments_json  TEXT NOT NULL DEFAULT '[]',
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_accounts_created ON accounts(created_at);
`)

/* ------------------------------ meta ------------------------------ */

const stmtGetMeta = db.prepare('SELECT value FROM meta WHERE key = ?')
const stmtSetMeta = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)

/** Read a metadata entry; returns undefined when absent */
export function getMeta(key: string): string | undefined {
  const value = stmtGetMeta.get(key)?.value
  return value === null || value === undefined ? undefined : String(value)
}

/** Write a metadata entry (insert or update) */
export function setMeta(key: string, value: string): void {
  stmtSetMeta.run(key, value)
}

/**
 * Get the JWT signing secret:
 * prefers the JWT_SECRET environment variable; otherwise generates a 64-char
 * random hex once and persists it in the meta table, so tokens survive restarts.
 */
export function getJwtSecret(): string {
  if (process.env.JWT_SECRET !== undefined && process.env.JWT_SECRET !== '') {
    return process.env.JWT_SECRET
  }
  const existing = getMeta('jwt_secret')
  if (existing !== undefined) return existing
  const secret = randomBytes(32).toString('hex')
  setMeta('jwt_secret', secret)
  return secret
}

/* ---------------------------- accounts ---------------------------- */

/** snake_case database row → camelCase type (centralized so call sites stay tidy) */
function toAccount(row: AccountRowDb): AccountRow {
  return {
    id: row.id,
    address: row.address,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }
}

const stmtInsertAccount = db.prepare(
  'INSERT INTO accounts (id, address, password_hash, created_at) VALUES (?, ?, ?, ?)',
)
const stmtAccountByAddress = db.prepare('SELECT * FROM accounts WHERE address = ?')
const stmtAccountById = db.prepare('SELECT * FROM accounts WHERE id = ?')
const stmtDeleteAccount = db.prepare('DELETE FROM accounts WHERE id = ?')

export function insertAccount(account: AccountRow): void {
  stmtInsertAccount.run(account.id, account.address, account.passwordHash, account.createdAt)
}

export function findAccountByAddress(address: string): AccountRow | undefined {
  const row = asRow<AccountRowDb>(stmtAccountByAddress.get(address.toLowerCase()))
  return row === undefined ? undefined : toAccount(row)
}

export function findAccountById(id: string): AccountRow | undefined {
  const row = asRow<AccountRowDb>(stmtAccountById.get(id))
  return row === undefined ? undefined : toAccount(row)
}

/** Delete an account (messages go too via ON DELETE CASCADE) */
export function deleteAccount(id: string): boolean {
  return stmtDeleteAccount.run(id).changes > 0
}

/* ---------------------------- messages ---------------------------- */

function toMessage(row: MessageRowDb): MessageRow {
  return {
    id: row.id,
    accountId: row.account_id,
    msgid: row.msgid,
    fromAddr: row.from_addr,
    fromName: row.from_name,
    toJson: row.to_json,
    subject: row.subject,
    intro: row.intro,
    text: row.text,
    html: row.html,
    // node:sqlite returns BLOBs as Uint8Array; convert to Buffer for the upper layers
    raw: Buffer.from(row.raw),
    seen: row.seen === 1,
    hasAttachments: row.has_attachments === 1,
    size: row.size,
    attachmentsJson: row.attachments_json,
    createdAt: row.created_at,
  }
}

const stmtInsertMessage = db.prepare(`
  INSERT INTO messages
    (id, account_id, msgid, from_addr, from_name, to_json, subject, intro, text, html,
     raw, seen, has_attachments, size, attachments_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const stmtListMessages = db.prepare(
  'SELECT * FROM messages WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
)
const stmtCountMessagesOfAccount = db.prepare(
  'SELECT COUNT(*) AS total FROM messages WHERE account_id = ?',
)
const stmtMessageOfAccount = db.prepare('SELECT * FROM messages WHERE id = ? AND account_id = ?')
const stmtSetSeen = db.prepare('UPDATE messages SET seen = ? WHERE id = ? AND account_id = ?')
const stmtDeleteMessage = db.prepare('DELETE FROM messages WHERE id = ? AND account_id = ?')
const stmtCountAllMessages = db.prepare('SELECT COUNT(*) AS total FROM messages')

/** Total number of messages in the database (used by retention tests and ops) */
export function countAllMessages(): number {
  const total = stmtCountAllMessages.get()?.total
  return typeof total === 'number' ? total : 0
}

/** Insert a message, then immediately apply the retention policy */
export function insertMessage(message: MessageRow): void {
  stmtInsertMessage.run(
    message.id,
    message.accountId,
    message.msgid,
    message.fromAddr,
    message.fromName,
    message.toJson,
    message.subject,
    message.intro,
    message.text,
    message.html,
    message.raw,
    message.seen ? 1 : 0,
    message.hasAttachments ? 1 : 0,
    message.size,
    message.attachmentsJson,
    message.createdAt,
  )
  enforceRetention()
}

/** List an account's messages, newest first (paginated) */
export function listMessages(
  accountId: string,
  pagination: { limit: number; offset: number },
): { items: MessageRow[]; total: number } {
  const items = asRows<MessageRowDb>(
    stmtListMessages.all(accountId, pagination.limit, pagination.offset),
  ).map(toMessage)
  const total = stmtCountMessagesOfAccount.get(accountId)?.total
  return { items, total: typeof total === 'number' ? total : 0 }
}

/** Get one message of an account; an account mismatch counts as "not found" (anti-enumeration) */
export function getMessage(accountId: string, messageId: string): MessageRow | undefined {
  const row = asRow<MessageRowDb>(stmtMessageOfAccount.get(messageId, accountId))
  return row === undefined ? undefined : toMessage(row)
}

/** Mark a message seen/unseen */
export function setMessageSeen(accountId: string, messageId: string, seen: boolean): boolean {
  return stmtSetSeen.run(seen ? 1 : 0, messageId, accountId).changes > 0
}

/** Delete one message of an account */
export function deleteMessage(accountId: string, messageId: string): boolean {
  return stmtDeleteMessage.run(messageId, accountId).changes > 0
}

/* -------------------------- Retention cleanup -------------------------- */

const stmtDeleteExpired = db.prepare('DELETE FROM messages WHERE created_at < ?')
const stmtDeleteOverPerAccount = db.prepare(`
  DELETE FROM messages
  WHERE account_id = ? AND id NOT IN (
    SELECT id FROM messages WHERE account_id = ? ORDER BY created_at DESC LIMIT ?
  )
`)
const stmtDeleteOverTotal = db.prepare(`
  DELETE FROM messages
  WHERE id NOT IN (SELECT id FROM messages ORDER BY created_at DESC LIMIT ?)
`)
const stmtDeleteZombieAccounts = db.prepare(`
  DELETE FROM accounts
  WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.account_id = accounts.id)
`)
const stmtOverQuotaAccounts = db.prepare(
  'SELECT DISTINCT account_id FROM messages GROUP BY account_id HAVING COUNT(*) > ?',
)

/**
 * Disk protection: run the four cleanup categories according to config.
 * Called on every message insert; each statement is nearly free while
 * the data stays within its limits.
 */
export function enforceRetention(): void {
  const ttlCutoff = Date.now() - config.retention.messageTtlHours * 3600_000

  // 1. delete messages older than the TTL
  stmtDeleteExpired.run(ttlCutoff)

  // 2. for accounts above their cap, delete their oldest messages (keep the newest N)
  const overQuota = asRows<{ account_id: string }>(
    stmtOverQuotaAccounts.all(config.retention.maxMessagesPerAccount),
  )
  for (const { account_id } of overQuota) {
    // the account placeholder appears twice in the statement (outer + subquery)
    stmtDeleteOverPerAccount.run(account_id, account_id, config.retention.maxMessagesPerAccount)
  }

  // 3. when the whole database is above the global cap, delete the oldest messages
  stmtDeleteOverTotal.run(config.retention.maxTotalMessages)

  // 4. delete message-less accounts older than the TTL (prevent unbounded growth)
  stmtDeleteZombieAccounts.run(ttlCutoff)
}
