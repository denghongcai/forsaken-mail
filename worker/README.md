# Cloudflare Email Worker relay

Forwards mail received by [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
to the app's `POST /api/ingest` endpoint. Use this when the origin server must
keep its IP hidden: the MX records point at Cloudflare, and the origin never
opens port 25.

```
sender MTA -> Cloudflare MX -> this Worker --POST raw MIME--> /api/ingest (proxied HTTPS) -> origin
```

## Setup

Requires the domain's DNS to be hosted on Cloudflare (free plan works).

1. Deploy the relay and set its secrets (wrangler installs on demand, no
   package.json needed in this directory):

   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put INGEST_URL     # e.g. https://mail.example.com/api/ingest
   npx wrangler secret put INGEST_TOKEN   # must equal the server's INGEST_TOKEN
   ```

2. Dashboard -> Email Routing: enable it for the domain, then add a **catch-all**
   rule with the action "Send to a Worker" -> `forsaken-mail-relay`.

3. Run the origin server in relay mode:

   ```bash
   SMTP_DISABLED=1 INGEST_TOKEN=<same secret> node server/dist/index.js
   ```

## Notes

- Mail for unknown accounts is answered `200 {status:"dropped"}` — accepted
  then silently discarded, so the endpoint is not an account-probing oracle.
- If the origin is unreachable, the Worker bounces the message (`setReject`)
  and the sending MTA retries on its normal schedule.
