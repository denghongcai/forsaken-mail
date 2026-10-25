/**
 * Current-account endpoints (Bearer token required):
 *   GET    /api/me  inspect the current account
 *   DELETE /api/me  delete the account (its messages are cascade-deleted via foreign key)
 */
import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { deleteAccount } from '../db.js'
import { toAccountDto } from '../dto.js'

export const meRouter = Router()

meRouter.use(requireAuth)

meRouter.get('/', (req, res) => {
  res.json(toAccountDto(req.account!))
})

meRouter.delete('/', (req, res) => {
  deleteAccount(req.account!.id)
  res.status(204).end()
})
