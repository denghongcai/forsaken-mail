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
import { meRouter } from './routes/me.js'
import { messagesRouter } from './routes/messages.js'
import { tokenRouter } from './routes/token.js'

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

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
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
    // Static assets cached 1 hour (Vite emits content-hashed filenames, safe to cache)
    app.use(express.static(webDistDir, { maxAge: 3600_000 }))
    // SPA fallback: any non-/api GET returns index.html and defers to the frontend router
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next()
        return
      }
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
    // Unknown error: log it but never expose details to the client
    logger.error(`[http] ${req.method} ${req.path} failed:`, err)
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } })
  })

  return app
}
