/**
 * Account state hook: ensures a usable account on startup and exposes
 * account-switch / deletion actions.
 *
 * State machine: loading (auto-creating/logging in) → ready (usable) | error (init failed).
 * As soon as the account is ready, the socket connects for realtime push.
 */
import { useCallback, useEffect, useState } from 'react'
import { createRandomAccount, deleteMe, login } from '@/lib/api'
import {
  clearStoredAccount,
  ensureAccount,
  saveStoredAccount,
  type StoredAccount,
} from '@/lib/account'
import { connectSocket, disconnectSocket } from '@/lib/socket'

export type AccountState =
  | { status: 'loading' }
  | { status: 'ready'; account: StoredAccount }
  | { status: 'error'; message: string }

export function useAccount(): {
  state: AccountState
  /** Apply a new set of credentials (after an account switch) and reconnect the socket */
  applyAccount: (account: StoredAccount) => void
  /** Switch to a brand-new random account (the old one is left to server-side TTL cleanup) */
  switchToNewRandom: () => Promise<void>
  /** Delete the current account and create a new random one */
  destroyAndRenew: () => Promise<void>
} {
  const [state, setState] = useState<AccountState>({ status: 'loading' })

  /** Apply credentials and establish the realtime connection */
  const applyAccount = useCallback((account: StoredAccount) => {
    setState({ status: 'ready', account })
    connectSocket(account.token)
  }, [])

  // First load: make sure a usable account exists
  useEffect(() => {
    let cancelled = false
    ensureAccount()
      .then((account) => {
        if (!cancelled) applyAccount(account)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Initialization failed',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [applyAccount])

  const switchToNewRandom = useCallback(async () => {
    disconnectSocket()
    // Create the account and exchange for a token first, then persist and apply in one go
    const created = await createRandomAccount()
    // In random mode the server always returns the plaintext password once; treat a missing value as a fault
    if (created.password === undefined) {
      throw new Error('Server did not return the random password')
    }
    const { token, id } = await login(created.address, created.password)
    applyAccount(
      saveStoredAccount({ id, address: created.address, password: created.password, token }),
    )
  }, [applyAccount])

  const destroyAndRenew = useCallback(async () => {
    disconnectSocket()
    await deleteMe()
    clearStoredAccount()
    applyAccount(await ensureAccount())
  }, [applyAccount])

  return { state, applyAccount, switchToNewRandom, destroyAndRenew }
}
