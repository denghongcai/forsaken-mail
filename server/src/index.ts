/**
 * Service entrypoint: wires up the three main pieces — HTTP (API+SPA),
 * WebSocket push, and SMTP ingestion.
 *
 * Startup order:
 *   Express app → HTTP server → socket.io → SMTP (optional) → listen
 * Shutdown (SIGTERM/SIGINT):
 *   close SMTP → HTTP → socket.io → SQLite in order, so all data is flushed.
 */
import { createServer } from 'node:http'
import { config, smtpEnabled } from './config.js'
import { db } from './db.js'
import { createApp } from './app.js'
import { logger } from './logger.js'
import { createRealtime, notifyNewMessage } from './realtime.js'
import { startSmtp, type NewMessageListener } from './smtp.js'

const app = createApp()
const httpServer = createServer(app)

// WebSocket push and SMTP ingestion are decoupled through a callback: after a
// message is stored, broadcast to the recipient account's room
const io = createRealtime(httpServer)
const notify: NewMessageListener = (accountId, message) => notifyNewMessage(io, accountId, message)

const smtpServer = smtpEnabled ? startSmtp(notify) : null

// Fail listen attempts (e.g. port already in use) with a friendly message
// instead of an unhandled exception
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      `[http] port ${config.http.port} is already in use; change PORT or stop the process holding it`,
    )
  } else {
    logger.error('[http] failed to listen:', err.message)
  }
  process.exit(1)
})

httpServer.listen(config.http.port, config.http.host, () => {
  logger.info(`[http] listening on ${config.http.host}:${config.http.port}`)
  if (smtpServer !== null) {
    logger.info(`[smtp] listening on ${config.smtp.host}:${config.smtp.port}`)
  } else {
    logger.info('[smtp] disabled (SMTP_DISABLED=1)')
  }
})

/** Graceful shutdown: close SMTP, HTTP, and socket.io in order, then the database */
function shutdown(signal: string): void {
  logger.info(`[server] received ${signal}, shutting down...`)
  smtpServer?.close(() => {
    httpServer.close(() => {
      io.close(() => {
        db.close()
        process.exit(0)
      })
    })
  })
  // Backstop: force-exit if shutdown hasn't finished within 5s so stuck
  // connections don't block container stops
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
