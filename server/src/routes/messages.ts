/**
 * Message endpoints (all require a Bearer token):
 *   GET    /api/messages?page=1&limit=20      paginated list (summaries)
 *   GET    /api/messages/:id                  detail (body + attachment metadata)
 *   PATCH  /api/messages/:id                  mark seen/unseen {seen: true}
 *   DELETE /api/messages/:id                  delete one message
 *   GET    /api/messages/:id/source           raw EML (text/plain)
 *   GET    /api/messages/:id/attachments/:aid attachment download
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { deleteMessage, getMessage, listMessages, setMessageSeen } from '../db.js'
import { parseAttachments, toDetailDto, toSummaryDto } from '../dto.js'
import { ApiError } from '../errors.js'
import type { MessageRow } from '../types.js'

export const messagesRouter = Router()

messagesRouter.use(requireAuth)

/* List pagination validation: page starts at 1, limit 1–100 (default 20) */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

messagesRouter.get('/', (req, res) => {
  const { page, limit } = listQuerySchema.parse(req.query)
  const { items, total } = listMessages(req.account!.id, {
    limit,
    offset: (page - 1) * limit,
  })
  res.json({ items: items.map(toSummaryDto), total, page, limit })
})

/**
 * Middleware: load the message from the URL and verify ownership
 * (an account mismatch counts as "not found", preventing cross-account enumeration).
 * On success it attaches the row to res.locals.message for the handlers below.
 */
messagesRouter.use('/:id', (req, res, next) => {
  const message = getMessage(req.account!.id, req.params.id)
  if (message === undefined) {
    throw ApiError.notFound('Message not found')
  }
  res.locals.message = message
  next()
})

messagesRouter.get('/:id', (_req, res) => {
  res.json(toDetailDto(res.locals.message))
})

const patchSchema = z.object({ seen: z.boolean() })

messagesRouter.patch('/:id', (req, res) => {
  const { seen } = patchSchema.parse(req.body)
  const message = res.locals.message as MessageRow
  setMessageSeen(req.account!.id, message.id, seen)
  // Return the fresh detail so the client doesn't need a follow-up GET; under
  // extreme concurrency the message may have been cleaned up already
  const updated = getMessage(req.account!.id, message.id)
  if (updated === undefined) {
    res.status(204).end()
    return
  }
  res.json(toDetailDto(updated))
})

messagesRouter.delete('/:id', (req, res) => {
  const message = res.locals.message as MessageRow
  deleteMessage(req.account!.id, message.id)
  res.status(204).end()
})

/** Raw EML message (RFC 822 source, handy for debugging and forensics) */
messagesRouter.get('/:id/source', (_req, res) => {
  const message = res.locals.message as MessageRow
  res.type('text/plain').send(message.raw)
})

/** Attachment download: restore the binary from base64 and serve it under the original filename */
messagesRouter.get('/:id/attachments/:attachmentId', (req, res) => {
  const message = res.locals.message as MessageRow
  const attachment = parseAttachments(message).find((a) => a.id === req.params.attachmentId)
  if (attachment === undefined) {
    throw ApiError.notFound('Attachment not found')
  }
  res
    .type(attachment.contentType)
    .set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`)
    .send(Buffer.from(attachment.content, 'base64'))
})
