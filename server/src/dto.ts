/**
 * DTO mapping: database rows → outward-facing JSON structures.
 * Kept in one place so API responses stay consistent and internal fields
 * (password_hash, attachment contents, …) never leak out.
 */
import type {
  AttachmentRow,
  AddressDto,
  MessageDetailDto,
  MessageRow,
  MessageSummaryDto,
} from './types.js'

/** Account row → outward-facing account info */
export function toAccountDto(account: { id: string; address: string; createdAt: number }): {
  id: string
  address: string
  createdAt: number
} {
  return { id: account.id, address: account.address, createdAt: account.createdAt }
}

/** Message row → list summary (no body, no attachment content) */
export function toSummaryDto(message: MessageRow): MessageSummaryDto {
  return {
    id: message.id,
    accountId: message.accountId,
    msgid: message.msgid,
    from: { address: message.fromAddr, name: message.fromName },
    to: JSON.parse(message.toJson) as AddressDto[],
    subject: message.subject,
    intro: message.intro,
    seen: message.seen,
    hasAttachments: message.hasAttachments,
    size: message.size,
    createdAt: message.createdAt,
  }
}

/** Attachment row → outward-facing metadata (content is withheld; a download path is given) */
function toAttachmentDto(messageId: string, attachment: AttachmentRow) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    downloadUrl: `/api/messages/${messageId}/attachments/${attachment.id}`,
  }
}

/** Message row → detail (body plus attachment metadata) */
export function toDetailDto(message: MessageRow): MessageDetailDto {
  const attachments = (JSON.parse(message.attachmentsJson) as AttachmentRow[]).map((a) =>
    toAttachmentDto(message.id, a),
  )
  return {
    ...toSummaryDto(message),
    text: message.text,
    html: message.html,
    attachments,
  }
}

/** Parse attachment rows (with base64 content; used only by the attachment download endpoint) */
export function parseAttachments(message: MessageRow): AttachmentRow[] {
  return JSON.parse(message.attachmentsJson) as AttachmentRow[]
}
