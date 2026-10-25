/**
 * Configuration loading.
 *
 * Precedence (low to high):
 *   1. config-default.json (defaults, shipped with the repository)
 *   2. config.json / the file pointed to by CONFIG_PATH (optional, for custom deployments)
 *   3. Environment variables (override individual fields; handy for containers)
 *
 * Environment variables:
 *   PORT / HOST                     HTTP listen port and address
 *   SMTP_PORT / SMTP_HOST           SMTP listen port and address
 *   SMTP_DISABLED=1                 disable the built-in SMTP (API-only/test scenarios)
 *   INGEST_TOKEN                    shared secret for POST /api/ingest (relay mode); unset = disabled
 *   DOMAINS                         comma-separated list of mail domains
 *   MESSAGE_TTL_HOURS               message retention period (hours)
 *   MAX_MESSAGES_PER_ACCOUNT        per-account message cap
 *   MAX_TOTAL_MESSAGES              database-wide message cap
 *   DATA_DIR                        SQLite data directory
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Server package root: src/.. during development, dist/.. after build — both equivalent */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Configuration schema (also serves as the type source) */
const configSchema = z.object({
  /** Public mail domains; addresses can only be created under these */
  domains: z.array(z.string()).min(1),
  /** Keyword blacklist: any address containing one of these substrings is rejected */
  keywordBlacklist: z.array(z.string()),
  http: z.object({
    host: z.string(),
    port: z.number().int().min(0).max(65535),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().min(0).max(65535),
    /** Maximum size of a single message in bytes; larger messages are rejected */
    sizeLimit: z.number().int().positive(),
  }),
  /** HTTP intake for relayed mail (routes/ingest.ts) — for CDN-fronted deployments */
  ingest: z.object({
    /** Shared Bearer secret the relay must present; null = endpoint disabled */
    token: z.string().min(1).nullable().default(null),
  }),
  /** Disk protection: retention policy, see docs/plans design document */
  retention: z.object({
    /** Maximum hours a message is kept; expired rows are lazily deleted */
    messageTtlHours: z.number().positive(),
    /** Maximum number of messages per account */
    maxMessagesPerAccount: z.number().int().positive(),
    /** Maximum number of messages in the whole database */
    maxTotalMessages: z.number().int().positive(),
  }),
  /** SQLite data file directory (schema-level default so the config file may omit it) */
  dataDir: z.string().default(path.join(SERVER_ROOT, 'data')),
})

export type AppConfig = z.infer<typeof configSchema>

/** Read a JSON file; return an empty object when missing or invalid, so partial overrides are fine */
function readJsonIfExists(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Recursively merge config objects: fields in override win, everything else stays from base */
function deepMerge<T>(base: T, override: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key]
    result[key] =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
        ? deepMerge(baseValue, value as Record<string, unknown>)
        : value
  }
  return result as T
}

/** Parse an integer environment variable; return undefined when unset */
function intEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name}=${raw} is not a valid integer`)
  }
  return value
}

/* 1) defaults <- 2) user config file */
let merged: Record<string, unknown> = readJsonIfExists(
  path.join(SERVER_ROOT, 'config-default.json'),
)
merged = deepMerge(
  merged,
  readJsonIfExists(process.env.CONFIG_PATH ?? path.join(SERVER_ROOT, 'config.json')),
)

/* 3) environment variable overrides */
if (process.env.DOMAINS !== undefined) {
  merged.domains = process.env.DOMAINS.split(',')
    .map((d) => d.trim())
    .filter(Boolean)
}
const httpEnv: Record<string, unknown> = {}
if (process.env.HOST !== undefined) httpEnv.host = process.env.HOST
const port = intEnv('PORT')
if (port !== undefined) httpEnv.port = port
merged.http = deepMerge(merged.http ?? {}, httpEnv)

const smtpEnv: Record<string, unknown> = {}
if (process.env.SMTP_HOST !== undefined) smtpEnv.host = process.env.SMTP_HOST
const smtpPort = intEnv('SMTP_PORT')
if (smtpPort !== undefined) smtpEnv.port = smtpPort
merged.smtp = deepMerge(merged.smtp ?? {}, smtpEnv)

if (process.env.INGEST_TOKEN !== undefined) {
  merged.ingest = deepMerge(merged.ingest ?? {}, { token: process.env.INGEST_TOKEN })
}

const retentionEnv: Record<string, unknown> = {}
const ttl = intEnv('MESSAGE_TTL_HOURS')
if (ttl !== undefined) retentionEnv.messageTtlHours = ttl
const maxPerAccount = intEnv('MAX_MESSAGES_PER_ACCOUNT')
if (maxPerAccount !== undefined) retentionEnv.maxMessagesPerAccount = maxPerAccount
const maxTotal = intEnv('MAX_TOTAL_MESSAGES')
if (maxTotal !== undefined) retentionEnv.maxTotalMessages = maxTotal
merged.retention = deepMerge(merged.retention ?? {}, retentionEnv)

if (process.env.DATA_DIR !== undefined) merged.dataDir = process.env.DATA_DIR

/** Global config singleton: loaded and validated on first import; invalid config throws immediately */
export const config: AppConfig = configSchema.parse(merged)

/** Whether the built-in SMTP receiver is enabled (can be turned off for tests / API-only mode) */
export const smtpEnabled = process.env.SMTP_DISABLED !== '1'
