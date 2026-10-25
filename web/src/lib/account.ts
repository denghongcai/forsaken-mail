/**
 * Account lifecycle management.
 *
 * Core experience (inherited from v1's "works immediately"): the first visit
 * automatically creates a random account, and the credentials (address +
 * password + token) are stored in localStorage:
 *   - token expired → automatically re-exchange it with the saved password;
 *   - account cleaned up server-side (TTL/deletion) → automatically create a
 *     new random account.
 * Users can also "change address" in the UI or restore an old account with
 * full credentials.
 */
import { createRandomAccount, getMe, login, setTokenProvider } from './api'

/** localStorage storage key */
const STORAGE_KEY = 'forsaken-mail:account'

/** Account credentials saved locally */
export interface StoredAccount {
  id: string
  address: string
  password: string
  token: string
}

/** Read the local credentials; silently clear them when the format is corrupt */
export function loadStoredAccount(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as StoredAccount
    if (typeof parsed.address !== 'string' || typeof parsed.password !== 'string') {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Persist credentials (fields not mentioned in the patch are preserved) */
export function saveStoredAccount(patch: Partial<StoredAccount>): StoredAccount {
  const next = { ...loadStoredAccount(), ...patch } as StoredAccount
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

/** Clear the local credentials (on account deletion/reset) */
export function clearStoredAccount(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// The API client reads the token from this module
setTokenProvider(() => loadStoredAccount()?.token ?? null)

/**
 * Make sure a usable account exists and return it:
 *  1. local credentials with a valid token → return directly;
 *  2. token expired → re-exchange it with the saved password;
 *  3. re-login failed (account cleaned up) → create a new random account.
 */
export async function ensureAccount(): Promise<StoredAccount> {
  const stored = loadStoredAccount()

  if (stored !== null) {
    // Try the existing token first; getMe() is the cheapest validation endpoint
    try {
      await getMe()
      return stored
    } catch {
      // Token expired → try re-login with the password
      try {
        const { token, id } = await login(stored.address, stored.password)
        return saveStoredAccount({ token, id })
      } catch {
        // Account no longer exists → fall through to re-creation
      }
    }
  }

  // First visit or credentials fully invalid: create a random account
  const account = await createRandomAccount()
  const saved = saveStoredAccount({
    id: account.id,
    address: account.address,
    // In random mode the server returns the plaintext password only once
    password: account.password ?? '',
    token: '',
  })
  // Persist again after exchanging for a token
  const { token, id } = await login(saved.address, saved.password)
  return saveStoredAccount({ token, id })
}
