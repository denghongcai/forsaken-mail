/**
 * Mailbox address rules: format, domain, and blacklist checks in one place.
 * Reused by account creation (POST /accounts) and elsewhere.
 */
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

/** Local part (before the @): starts alphanumeric, may contain . _ -, max 64 chars */
const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Check result: on success returns the normalized (lowercased) full address */
export type AddressCheck = { ok: true; address: string } | { ok: false; reason: string }

/** Whether the local part hits the keyword blacklist (substring match) */
export function isBlacklisted(localPart: string): boolean {
  return config.keywordBlacklist.some((keyword) => localPart.includes(keyword))
}

/**
 * Validate a user-submitted address:
 *  - must look like local@domain
 *  - domain must be one of our served domains (case-insensitive)
 *  - local must match LOCAL_PART_RE and pass the blacklist
 */
export function checkAddress(input: string): AddressCheck {
  const normalized = input.trim().toLowerCase()
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return { ok: false, reason: 'Invalid address format, expected user@domain' }
  }
  const localPart = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)

  if (!LOCAL_PART_RE.test(localPart)) {
    return {
      ok: false,
      reason: 'Username may only contain lowercase letters, digits, dots, underscores, and hyphens',
    }
  }
  if (!config.domains.some((d) => d.toLowerCase() === domain)) {
    return {
      ok: false,
      reason: `Domain not available; choose one of: ${config.domains.join(', ')}`,
    }
  }
  if (isBlacklisted(localPart)) {
    return { ok: false, reason: 'This username is reserved and cannot be used' }
  }
  return { ok: true, address: normalized }
}

/** Random local part: two 4-char hex segments like a3f9-81c2 — unambiguous and readable */
export function randomLocalPart(): string {
  return randomUUID().slice(0, 4) + '-' + randomUUID().slice(0, 4)
}

/** Random password (32 hex chars): anonymous account credentials, kept by the frontend for cross-device restore */
export function randomPassword(): string {
  return randomUUID().replace(/-/g, '')
}
