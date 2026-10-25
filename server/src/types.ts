/**
 * Domain-wide shared type definitions.
 *
 * Design note: types are split into two layers — "database row" and "API DTO".
 * The db layer produces Row types; routes map Rows into outward-facing DTOs.
 * This prevents internal structures (e.g. base64 attachment content) from
 * leaking into API responses.
 */

/** An account (one row of the accounts table) */
export interface AccountRow {
  id: string
  /** Full email address, e.g. user@example.com (stored lowercase) */
  address: string
  /** bcrypt-hashed password; never sent to clients */
  passwordHash: string
  /** Creation timestamp (Unix milliseconds) */
  createdAt: number
}

/** Outward-facing account info (response of /accounts, /me) */
export interface AccountDto {
  id: string
  address: string
  createdAt: number
}

/** Attachment metadata (stored in messages.attachments_json; content is base64) */
export interface AttachmentRow {
  id: string
  filename: string
  contentType: string
  /** Size in bytes */
  size: number
  /** Base64-encoded content (database only; never included in list/detail DTOs) */
  content: string
  /** true when the attachment is an inline resource (e.g. an image inside the body) */
  inline: boolean
}

/** Outward-facing attachment metadata (without content) */
export interface AttachmentDto {
  id: string
  filename: string
  contentType: string
  size: number
  /** Download path relative to the API prefix, e.g. /api/messages/<mid>/attachments/<aid> */
  downloadUrl: string
}

/** A message (one row of the messages table); parsed fields are stored per column */
export interface MessageRow {
  id: string
  accountId: string
  /** The Message-ID header of the email */
  msgid: string | null
  fromAddr: string
  fromName: string | null
  /** Recipient list, JSON-serialized [{address, name}] */
  toJson: string
  subject: string | null
  /** First 128 chars of plain-text preview (shown in the list view) */
  intro: string | null
  /** Plain-text body */
  text: string | null
  /** HTML body (may be null) */
  html: string | null
  /** Raw EML source (replayed by the /source endpoint) */
  raw: Buffer
  seen: boolean
  hasAttachments: boolean
  /** Total size in bytes (body + attachments) */
  size: number
  /** JSON-serialized AttachmentRow[] */
  attachmentsJson: string
  /** Received-at timestamp (Unix milliseconds) */
  createdAt: number
}

/** List-view summary: no body and no attachment content */
export interface MessageSummaryDto {
  id: string
  accountId: string
  msgid: string | null
  from: AddressDto
  to: AddressDto[]
  subject: string | null
  intro: string | null
  seen: boolean
  hasAttachments: boolean
  size: number
  createdAt: number
}

/** Detail view: adds body and attachment metadata */
export interface MessageDetailDto extends MessageSummaryDto {
  text: string | null
  html: string | null
  attachments: AttachmentDto[]
}

/** Email address (shared by sender/recipients) */
export interface AddressDto {
  address: string
  name: string | null
}
