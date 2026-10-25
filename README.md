# Forsaken Mail

[![CI](https://github.com/denghongcai/forsaken-mail/actions/workflows/ci.yml/badge.svg?branch=v2)](https://github.com/denghongcai/forsaken-mail/actions/workflows/ci.yml)

Self-hosted disposable (temporary) email service. v2 is a full-stack TypeScript rewrite:

- Get a working mailbox the moment you open the page — no registration
- Messages persist in SQLite and survive refreshes and restarts
- New mail is pushed to the browser in realtime (WebSocket)
- Three body views — sandboxed HTML preview, plain text, raw source — plus attachment downloads
- Custom mailbox addresses; credentials can restore the same mailbox across devices
- Disk protection: messages are cleaned up automatically by TTL and count caps

Live demo: https://disposable.dhc.house

## Architecture

| Module    | Stack                                                                                   |
| --------- | --------------------------------------------------------------------------------------- |
| `server/` | Node 24 + TypeScript + Express 5 + socket.io 4 + smtp-server / mailparser + node:sqlite |
| `web/`    | React 19 + Vite 8 + Tailwind CSS v4 + shadcn/ui + TanStack Query                        |

```
Browser ---HTTP---> Express API ------> SQLite
   ^                   ^                (accounts / messages)
   |                   |                    ^
   +- new-mail push ---+                    |
                                            |
Inbound mail --SMTP:25--> smtp-server ------+
                          (mailparser -> store)
```

## API

REST API with Bearer token auth, under the `/api` prefix:

| Method       | Path                             | Description                                                 |
| ------------ | -------------------------------- | ----------------------------------------------------------- |
| GET          | `/domains`                       | Available mail domains                                      |
| POST         | `/accounts`                      | Create an account `{address, password}` or `{random: true}` |
| POST         | `/token`                         | Exchange address + password for a JWT                       |
| GET / DELETE | `/me`                            | Current account info / delete the account                   |
| GET          | `/messages?page&limit`           | Message list                                                |
| GET          | `/messages/:id`                  | Message detail (with attachment metadata)                   |
| PATCH        | `/messages/:id`                  | Mark seen `{seen: true}`                                    |
| DELETE       | `/messages/:id`                  | Delete a message                                            |
| GET          | `/messages/:id/source`           | Raw EML                                                     |
| GET          | `/messages/:id/attachments/:aid` | Attachment download                                         |
| POST         | `/ingest`                        | Raw MIME intake for relayed mail (Bearer token, see below)  |

## Local development

Requires Node ≥ 24 and pnpm ≥ 12 (the exact version is pinned in `packageManager`; Corepack handles it).

```bash
pnpm install

# Backend (HTTP :3000, SMTP :25; switch ports if you lack privileges)
SMTP_PORT=2525 pnpm --filter @forsaken/server dev

# Frontend (Vite :5173; /api and socket.io are proxied to :3000)
pnpm --filter @forsaken/web dev
```

Test / build / lint:

```bash
pnpm test        # vitest (API / SMTP / WebSocket / retention)
pnpm build       # web first, then server
pnpm lint
pnpm typecheck
pnpm exec prettier --check .
```

## Deployment

### DNS

To receive mail for `*@subdomain.domain.com`, two DNS records are required:

```
subdomain.domain.com.    MX   10  mxsubdomain.domain.com.
mxsubdomain.domain.com.  A        <server IP>
```

You can verify them with [mxtoolbox](https://mxtoolbox.com/diagnostic.aspx).

### Docker (recommended)

```bash
docker build -t forsaken-mail .
# The production domains come from the DOMAINS env; port 25 must be reachable for direct delivery
docker run --name forsaken-mail -d \
  -p 25:25 -p 3000:3000 \
  -e DOMAINS=mail.example.com \
  -v forsaken-data:/app/data \
  forsaken-mail
```

Open `http://<host>:3000` and it works.

### Bare metal

```bash
pnpm install && pnpm build
SMTP_PORT=25 DOMAINS=mail.example.com node server/dist/index.js
```

### Without exposing the server IP (Cloudflare Email Routing)

The MX setup above publishes the server IP in DNS. To keep it hidden, let
Cloudflare receive the mail and relay it over HTTPS — the origin then runs
with `SMTP_DISABLED=1` and never opens port 25:

```
sender MTA -> Cloudflare MX (Email Routing) -> Email Worker
    --POST /api/ingest (proxied HTTPS)--> origin
```

See [`worker/`](worker/) for the relay setup. Set `INGEST_TOKEN` on both
sides (server env + Worker secret); the endpoint answers 404 unless a token
is configured.

## Configuration

Precedence: environment variables > `config.json` / `CONFIG_PATH` > `server/config-default.json`.

| Env variable               | Default                   | Description                             |
| -------------------------- | ------------------------- | --------------------------------------- |
| `PORT` / `HOST`            | 3000 / 0.0.0.0            | HTTP listen                             |
| `SMTP_PORT` / `SMTP_HOST`  | 25 / 0.0.0.0              | SMTP listen                             |
| `SMTP_DISABLED`            | —                         | Set to `1` to disable the built-in SMTP |
| `INGEST_TOKEN`             | — (endpoint disabled)     | Shared secret for `POST /api/ingest`    |
| `DOMAINS`                  | example domains           | Comma-separated mail domains            |
| `MESSAGE_TTL_HOURS`        | 24                        | Message retention (hours)               |
| `MAX_MESSAGES_PER_ACCOUNT` | 100                       | Per-account message cap                 |
| `MAX_TOTAL_MESSAGES`       | 20000                     | Database-wide message cap               |
| `DATA_DIR`                 | `server/data`             | SQLite data directory                   |
| `JWT_SECRET`               | auto-generated, persisted | Token signing secret                    |
| `WEB_DIST`                 | auto-detected             | Frontend build directory                |

Disk protection: after every inbound message, a lazy cleanup pass removes
expired messages, the oldest messages beyond the per-account/global caps, and
expired zombie accounts with no messages — keeping disk usage bounded.

## License

GPL-2.0
