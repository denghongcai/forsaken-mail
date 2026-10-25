/**
 * GET /api/domains — public endpoint: lists the mail domains this instance serves.
 * Clients should fetch this before generating a random address (domains can
 * change with deployment configuration).
 */
import { Router } from 'express'
import { config } from '../config.js'

export const domainsRouter = Router()

domainsRouter.get('/', (_req, res) => {
  res.json({ domains: config.domains })
})
