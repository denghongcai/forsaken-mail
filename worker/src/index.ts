/**
 * Cloudflare Email Worker — relays inbound mail to the app's POST /api/ingest.
 *
 * Deployment shape (origin IP stays hidden, no port 25 ever opened):
 *
 *   sender MTA -> Cloudflare MX (Email Routing) -> this Worker
 *     -> POST raw MIME -> https://demo.example/api/ingest (behind the proxy) -> origin
 *
 * The envelope recipient rides in X-Envelope-To because auto-forwarded mail
 * keeps its original recipient in the To: header — the origin routes
 * header-first, envelope-fallback (same order as direct SMTP delivery).
 */
interface Env {
  /** Full URL of the origin's POST /api/ingest endpoint */
  INGEST_URL: string
  /** Shared secret; must equal the server's INGEST_TOKEN */
  INGEST_TOKEN: string
}

/** The slice of the Cloudflare EmailMessage API this Worker uses */
interface EmailMessage {
  /** Envelope sender */
  readonly from: string
  /** Envelope recipient (the address the mail was actually sent to) */
  readonly to: string
  /** Raw RFC 5322 message */
  readonly raw: ReadableStream<Uint8Array>
  /** Bounce the message with an SMTP error (the sender's MTA will retry) */
  setReject(reason: string): void
}

/** Drain a ReadableStream into a single Uint8Array */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    try {
      const response = await fetch(env.INGEST_URL, {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          // Envelope recipient for routing (headers can lie on forwarded mail)
          'x-envelope-to': message.to,
          authorization: `Bearer ${env.INGEST_TOKEN}`,
        },
        body: await readAll(message.raw),
      })
      if (!response.ok) {
        message.setReject(`relay refused the message (HTTP ${response.status})`)
      }
    } catch (err) {
      // Origin unreachable: reject so the sending MTA retries later
      message.setReject(`relay unavailable: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  },
}
