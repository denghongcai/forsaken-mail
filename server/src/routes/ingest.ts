/**
 * POST /api/ingest — raw MIME intake for deployments where mail arrives via an
 * HTTPS relay (e.g. the Cloudflare Email Worker in worker/) instead of the
 * built-in SMTP receiver. The origin then never opens port 25 and its IP can
 * stay hidden behind a proxy.
 *
 * Contract:
 *   - Authorization: Bearer <INGEST_TOKEN> (timing-safe compared; when no
 *     token is configured the endpoint answers 404 like any unknown path)
 *   - Body: the raw RFC 5322 message (any content type)
 *   - X-Envelope-To: optional comma-separated envelope recipients, mirroring
 *     SMTP RCPT TO so routing follows the same header-first, envelope-fallback
 *     order as direct SMTP delivery (forwarded mail keeps its original To:)
 *
 * Unknown-account mail answers 200 {status:"dropped"} — same anti-probing
 * semantics as the SMTP path (accept, then silently discard).
 */
import { timingSafeEqual } from 'node:crypto'
import express, { Router } from 'express'
import { config } from '../config.js'
import { ApiError } from '../errors.js'
import { logger } from '../logger.js'
import { deliverMessage, type NewMessageListener } from '../smtp.js'

/** Constant-time comparison so response timing leaks nothing about the token */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createIngestRouter(notify: NewMessageListener): Router {
  const router = Router()
  // Mounted before the app-level express.json, so the JSON parser never
  // touches these requests and req.body stays the raw Buffer
  router.use(express.raw({ type: '*/*', limit: config.smtp.sizeLimit }))

  router.post('/', async (req, res) => {
    // No token configured → relay mode is off; hide the endpoint's existence
    const expected = config.ingest.token
    if (expected === null) throw ApiError.notFound('Endpoint not found: POST /api/ingest')

    const authorization = req.get('authorization') ?? ''
    const presented = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (presented === '' || !tokenMatches(presented, expected)) {
      throw ApiError.unauthorized('Invalid ingest token')
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw ApiError.badRequest('Body must be the raw MIME message')
    }

    const envelopeRcpts = (req.get('x-envelope-to') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)

    try {
      const status = await deliverMessage(req.body, notify, envelopeRcpts)
      res.json({ status })
    } catch (err) {
      // Malformed MIME must not break the relay — drop it like SMTP does
      logger.error('[ingest] failed to parse message, dropped:', err)
      res.json({ status: 'dropped' })
    }
  })

  return router
}
