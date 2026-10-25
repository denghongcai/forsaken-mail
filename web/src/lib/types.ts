/**
 * Frontend type definitions mirroring the backend DTOs.
 * The server contract lives in server/src/dto.ts; fields stay isomorphic on both sides.
 */

/** Email address (shared by sender/recipients) */
export interface AddressDto {
  address: string
  name: string | null
}

/** Attachment metadata (no content; downloaded with auth via downloadUrl) */
export interface AttachmentDto {
  id: string
  filename: string
  contentType: string
  size: number
  downloadUrl: string
}

/** Message list summary */
export interface MessageSummary {
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

/** Message detail = summary + body + attachments */
export interface MessageDetail extends MessageSummary {
  text: string | null
  html: string | null
  attachments: AttachmentDto[]
}

/** Message list response (paginated) */
export interface MessageListResponse {
  items: MessageSummary[]
  total: number
  page: number
  limit: number
}

/** Account info (random creation includes the one-time password field) */
export interface AccountDto {
  id: string
  address: string
  createdAt: number
  password?: string
}

/** Unified error response body */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}
