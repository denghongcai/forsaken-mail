/**
 * Express application factory.
 *
 * Responsibilities:
 *   - mount the /api routes (domains / accounts / token / me / messages)
 *   - unified error response shape {error: {code, message}}
 *   - in production, serve the frontend build (SPA) and fall back to
 *     index.html for non-API GETs
 *
 * A factory (not a singleton) so tests can create isolated instances per case.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { SERVER_ROOT } from './config.js'
import { ApiError } from './errors.js'
import { logger } from './logger.js'
import { accountsRouter } from './routes/accounts.js'
import { domainsRouter } from './routes/domains.js'
import { createIngestRouter } from './routes/ingest.js'
import { meRouter } from './routes/me.js'
import { messagesRouter } from './routes/messages.js'
import { tokenRouter } from './routes/token.js'
import type { NewMessageListener } from './smtp.js'

/**
 * Frontend build directory (web/dist); may not exist in local development
 * where Vite serves it separately.
 * Resolution order: WEB_DIST env → container layout (SERVER_ROOT/web/dist) → monorepo layout.
 */
function resolveWebDist(): string | null {
  const candidates = [
    process.env.WEB_DIST,
    path.resolve(SERVER_ROOT, 'web/dist'),
    path.resolve(SERVER_ROOT, '../web/dist'),
  ].filter((p): p is string => p !== undefined && p !== '')
  const found = candidates.find((p) => existsSync(path.join(p, 'index.html')))
  return found ?? null
}

const webDistDir = resolveWebDist()

/**
 * @param notify callback fired when the raw-mail ingest route stores a
 *   message (the entrypoint wires it to the WebSocket broadcaster; tests may
 *   omit it)
 */
export function createApp(notify: NewMessageListener = () => {}): Express {
  const app = express()

  app.disable('x-powered-by')

  /* ------------------------- Raw MIME intake -------------------------- */
  // POST /api/ingest (relay mode) must see the untouched raw body, so it is
  // mounted before the JSON parser. It stays a 404 unless INGEST_TOKEN is set.
  app.use('/api/ingest', createIngestRouter(notify))

  // JSON body cap: requests like account creation are tiny, 1MB is plenty
  app.use(express.json({ limit: '1mb' }))

  /* ---------------------------- API routes ---------------------------- */
  app.use('/api/domains', domainsRouter)
  app.use('/api/accounts', accountsRouter)
  app.use('/api/token', tokenRouter)
  app.use('/api/me', meRouter)
  app.use('/api/messages', messagesRouter)

  // Unmatched /api path → JSON 404 (must not fall through to the SPA fallback)
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: `Endpoint not found: ${req.method} ${req.path}` },
    })
  })

  /* ------------------------- Frontend statics ------------------------- */
  if (webDistDir !== null) {
    // Hashed static assets are immutable: cache for a year (RFC-suggested
    // maximum for "effectively forever").
    // index.html must stay no-cache: a cached index would reference hashed
    // assets that no longer exist after a deploy, breaking the app until the
    // cache expires.
    const noCacheHtml = (res: Response, filePath: string): void => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
    app.use(
      express.static(webDistDir, {
        maxAge: 365 * 24 * 3600_000,
        immutable: true,
        setHeaders: noCacheHtml,
      }),
    )
    // SPA fallback: any non-/api GET returns index.html and defers to the frontend router
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next()
        return
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(webDistDir, 'index.html'))
    })
  }

  /* ------------------------- Error fallthrough ------------------------- */
  // Note: Express 5 automatically catches exceptions thrown by async handlers
  // and forwards them here
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // zod validation failure → 422 with a friendly description of the first issue
    if (err instanceof z.ZodError) {
      const first = err.issues[0]
      res.status(422).json({
        error: {
          code: 'validation_error',
          message:
            first !== undefined ? `${first.path.join('.')}: ${first.message}` : 'Validation failed',
        },
      })
      return
    }
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } })
      return
    }
    // body-parser failures (e.g. an ingest body over the size limit) carry
    // their own 4xx status — honor it instead of collapsing into a 500
    if (typeof err === 'object' && err !== null && 'statusCode' in err) {
      const status = (err as { statusCode?: unknown }).statusCode
      if (typeof status === 'number' && status >= 400 && status < 500) {
        res.status(status).json({
          error: {
            code: 'bad_request',
            message: err instanceof Error ? err.message : 'Bad request',
          },
        })
        return
      }
    }
    // Unknown error: log it but never expose details to the client
    logger.error(`[http] ${req.method} ${req.path} failed:`, err)
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } })
  })

  return app
}
