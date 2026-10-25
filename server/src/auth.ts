/**
 * Authentication: JWT issuing and verification.
 *
 * Flow:
 *   POST /api/token {address, password} → verify the bcrypt password → issue a JWT
 *   Subsequent requests carry `Authorization: Bearer <token>`; the requireAuth
 *   middleware parses it and, on success, attaches the account to req.account
 *   for the route handlers.
 */
import type { NextFunction, Request, Response } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { findAccountById, getJwtSecret } from './db.js'
import { ApiError } from './errors.js'
import type { AccountRow } from './types.js'

/** Token lifetime: 7 days (plenty for a disposable-mail use case; re-login after expiry) */
const TOKEN_TTL_SECONDS = 7 * 24 * 3600

/** Secret format required by jose (HMAC) */
const secretKey = new TextEncoder().encode(getJwtSecret())

/** Extend the Express Request: requireAuth attaches the current account after auth succeeds */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- idiomatic way to augment Express types
  namespace Express {
    interface Request {
      account?: AccountRow
    }
  }
}

/** Issue a JWT for an account (sub = account id) */
export async function signToken(accountId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey)
}

/** Verify a JWT and return the account id; null when the signature is invalid or expired */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey)
    return payload.sub ?? null
  } catch {
    return null
  }
}

/** Express middleware: require a valid Bearer token and attach the account to req.account */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(ApiError.unauthorized())
    return
  }
  const accountId = await verifyToken(header.slice('Bearer '.length))
  if (accountId === null) {
    next(ApiError.unauthorized())
    return
  }
  const account = findAccountById(accountId)
  if (account === undefined) {
    // Token is valid but the account has been deleted / cleaned up
    next(ApiError.unauthorized('Account does not exist or has been deleted'))
    return
  }
  req.account = account
  next()
}
