/**
 * Account endpoints:
 *   POST /api/accounts  create an account {address, password} → 201 + account info
 *
 * Convenience enhancement: `{random: true}` makes the server generate a random
 * address and password, returning the one-time plaintext password in the response.
 * The frontend stores it in localStorage to get a "works immediately, credentials
 * restorable across devices" registration-free experience.
 */
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { checkAddress, randomLocalPart, randomPassword } from '../address.js'
import { config } from '../config.js'
import { findAccountByAddress, insertAccount } from '../db.js'
import { toAccountDto } from '../dto.js'
import { ApiError } from '../errors.js'

export const accountsRouter = Router()

const createAccountSchema = z.object({
  address: z.string().optional(),
  password: z.string().min(4, 'Password must be at least 4 characters').optional(),
  /** true = server generates a random address and password */
  random: z.boolean().optional(),
})

accountsRouter.post('/', async (req, res) => {
  const body = createAccountSchema.parse(req.body)
  const wantsRandom = body.random === true

  // 1) Parameter check: non-random mode must provide address + password explicitly
  if (!wantsRandom && (body.address === undefined || body.password === undefined)) {
    throw ApiError.badRequest('Provide address and password, or set random: true')
  }

  // 2) Decide address and password: random mode generates them server-side;
  //    explicit mode runs the format/domain/blacklist checks
  let address: string
  let password: string
  if (wantsRandom) {
    address = `${randomLocalPart()}@${config.domains[0]}`
    password = randomPassword()
  } else {
    const check = checkAddress(body.address!)
    if (!check.ok) {
      throw ApiError.unprocessable(check.reason)
    }
    address = check.address
    password = body.password!
  }

  // 3) Uniqueness check (the UNIQUE column is the backstop; this pre-check
  //    returns a friendly 409 instead of a raw database error)
  if (findAccountByAddress(address) !== undefined) {
    throw ApiError.conflict('This address is already taken')
  }

  // 4) Store (bcrypt hash, cost=10)
  const account = {
    id: randomUUID(),
    address,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: Date.now(),
  }
  insertAccount(account)

  // Random mode returns the plaintext credentials (the only chance to save them)
  const payload: Record<string, unknown> = { ...toAccountDto(account) }
  if (wantsRandom) {
    payload.password = password
  }
  res.status(201).json(payload)
})
