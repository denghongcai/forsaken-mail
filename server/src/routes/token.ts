/**
 * POST /api/token — exchange address + password for a JWT.
 */
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { signToken } from '../auth.js'
import { findAccountByAddress } from '../db.js'
import { ApiError } from '../errors.js'

export const tokenRouter = Router()

const tokenSchema = z.object({
  address: z.string(),
  password: z.string(),
})

tokenRouter.post('/', async (req, res) => {
  const { address, password } = tokenSchema.parse(req.body)

  const account = findAccountByAddress(address)
  // Unknown account and wrong password return the same message so probing
  // clients cannot learn whether an address exists
  if (account === undefined || !(await bcrypt.compare(password, account.passwordHash))) {
    throw ApiError.unauthorized('Incorrect address or password')
  }

  res.json({ token: await signToken(account.id), id: account.id })
})
