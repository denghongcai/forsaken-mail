/**
 * SMTP ingestion built on smtp-server (from the nodemailer family), replacing
 * the unmaintained mailin used by v1.
 *
 * Delivery pipeline:
 *   SMTP session → collect the raw message → parse with mailparser →
 *   locate the recipient account → store → push over WebSocket
 *
 * Acceptance rules:
 *   - Only recipients under our own domains (config.domains) are accepted;
 *     any other RCPT is rejected outright with 550
 *   - Local parts matching the keyword blacklist are rejected as well
 *   - Mail for unknown accounts is "accepted then silently dropped"
 *     (avoids leaking an account-probing oracle to external senders)
 */
import { randomUUID } from 'node:crypto'
import { simpleParser, type ParsedMail, type Attachment } from 'mailparser'
import { SMTPServer, type SMTPServerAddress, type SMTPServerSession } from 'smtp-server'
import { config } from './config.js'
import { findAccountByAddress, insertMessage } from './db.js'
import type { AccountRow, AttachmentRow, MessageRow } from './types.js'

/** Callback signature invoked after a message is stored (implemented by realtime for WebSocket push) */
export type NewMessageListener = (accountId: string, summary: MessageRow) => void

/** Lowercased domain set for normalized comparisons */
const localDomains = new Set(config.domains.map((d) => d.toLowerCase()))

/** Whether the local part hits the keyword blacklist (substring match, same behavior as v1) */
function isBlacklisted(localPart: string): boolean {
  return config.keywordBlacklist.some((keyword) => localPart.includes(keyword))
}

/**
 * RCPT TO check: only accept recipients under our domains that pass the blacklist.
 * Rejections start with "550 ..." so clients treat them as permanent, not retryable.
 */
function onRcptTo(
  address: SMTPServerAddress,
  _session: SMTPServerSession,
  callback: (err?: Error) => void,
): void {
  const [localPart = '', domain = ''] = address.address.toLowerCase().split('@')
  if (!localDomains.has(domain)) {
    callback(new Error('550 <Forsaken Mail> relay denied: recipient domain not served here'))
    return
  }
  if (localPart === '' || isBlacklisted(localPart)) {
    callback(new Error('550 <Forsaken Mail> recipient address not allowed'))
    return
  }
  callback()
}

/** Extract the first "recipient" address object from the parse result (to/cc/bcc, in that order) */
function firstRecipient(parsed: ParsedMail): { address: string; name: string } | undefined {
  const pools = [parsed.to, parsed.cc, parsed.bcc]
  for (const pool of pools) {
    if (pool === undefined) continue
    // AddressObject.value is the address list of that field (HeaderAddress[])
    const list = Array.isArray(pool) ? pool : [pool]
    for (const entry of list) {
      const header = entry.value.find((v) => v.address !== undefined)
      if (header?.address !== undefined) {
        return { address: header.address, name: header.name }
      }
    }
  }
  return undefined
}

/** mailparser attachments → storage rows (content becomes base64; entries without content are skipped) */
function toAttachmentRows(attachments: Attachment[]): AttachmentRow[] {
  return attachments
    .filter((a) => Buffer.isBuffer(a.content))
    .map((a) => ({
      id: randomUUID(),
      filename: a.filename ?? 'unnamed',
      contentType: a.contentType ?? 'application/octet-stream',
      size: a.content!.length,
      content: a.content!.toString('base64'),
      // attachments with contentDisposition "inline" (e.g. embedded images) are flagged inline
      inline: (a.contentDisposition ?? '') === 'inline',
    }))
}

/** First 128 chars of the body as a preview: prefer plain text, fall back to tag-stripped HTML */
function buildIntro(parsed: ParsedMail): string | null {
  const source =
    parsed.text ?? (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]*>/g, ' ') : '')
  const collapsed = source.replace(/\s+/g, ' ').trim()
  return collapsed === '' ? null : collapsed.slice(0, 128)
}

/**
 * Parse and deliver a single message.
 * The return value exists for test assertions: 'stored' = kept, 'dropped' = recipient
 * account unknown and the message discarded.
 */
export async function deliverMessage(
  raw: Buffer,
  notify: NewMessageListener,
): Promise<'stored' | 'dropped'> {
  const parsed = await simpleParser(raw)

  // Locate the recipient account: use the first parsed recipient, lowercased
  const recipient = firstRecipient(parsed)
  if (recipient === undefined) return 'dropped'
  const address = recipient.address.toLowerCase()
  const account: AccountRow | undefined = findAccountByAddress(address)
  if (account === undefined) return 'dropped'

  // Message size: raw message + all attachments
  const attachments = toAttachmentRows(parsed.attachments ?? [])
  const size = raw.length + attachments.reduce((sum, a) => sum + a.size, 0)

  const message: MessageRow = {
    id: randomUUID(),
    accountId: account.id,
    msgid: parsed.messageId ?? null,
    fromAddr: parsed.from?.value[0]?.address ?? 'unknown@unknown',
    fromName: parsed.from?.value[0]?.name ?? null,
    toJson: JSON.stringify(
      // the to field can be one or many AddressObjects; flatten into [{address, name}]
      (Array.isArray(parsed.to) ? parsed.to : parsed.to !== undefined ? [parsed.to] : []).flatMap(
        (t) =>
          t.value
            .filter((v): v is typeof v & { address: string } => v.address !== undefined)
            .map((v) => ({ address: v.address, name: v.name === '' ? null : v.name })),
      ),
    ),
    subject: parsed.subject ?? null,
    intro: buildIntro(parsed),
    text: parsed.text ?? null,
    // parsed.html === false means no HTML part; normalize to null
    html: typeof parsed.html === 'string' ? parsed.html : null,
    raw,
    seen: false,
    hasAttachments: attachments.length > 0,
    size,
    attachmentsJson: JSON.stringify(attachments),
    createdAt: Date.now(),
  }
  insertMessage(message)
  notify(account.id, message)
  return 'stored'
}

/** Start the SMTP server; returns a closable instance (for graceful shutdown and tests) */
export function startSmtp(notify: NewMessageListener): SMTPServer {
  const server = new SMTPServer({
    banner: 'Forsaken Mail SMTP',
    // Zero open-relay risk: RCPT is already restricted to our own domains
    disabledCommands: ['AUTH'],
    size: config.smtp.sizeLimit,
    onRcptTo,
    // Once the full message is collected, hand it to parse+store; parse failures
    // must not affect the SMTP session reply
    onData(stream, _session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        const raw = Buffer.concat(chunks)
        deliverMessage(raw, notify).catch((err: unknown) => {
          console.error('[smtp] failed to parse message, dropped:', err)
        })
        callback()
      })
      stream.on('error', (err: Error) => callback(err))
    },
  })
  // Client misbehavior (aborted connections etc.) is logged only, never crashes the process
  server.on('error', (err: Error) => {
    console.error('[smtp] session error:', err.message)
  })
  server.listen(config.smtp.port, config.smtp.host)
  return server
}
