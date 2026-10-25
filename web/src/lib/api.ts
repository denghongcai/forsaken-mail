/**
 * REST API client.
 *
 * Design notes:
 *  - every request goes through request(), which injects the Bearer token and
 *    parses the unified error body;
 *  - a 401 throws an ApiError carrying the code; upper layers (use-account)
 *    decide whether to re-login;
 *  - in development requests go through the Vite proxy (see vite.config.ts);
 *    in production the frontend shares the backend's origin.
 */
import type { AccountDto, ApiErrorBody, MessageDetail, MessageListResponse } from './types'

/** Error type carrying the HTTP status so the UI can branch on it (e.g. 409 = address taken) */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Token accessor: injected by the account module to avoid a circular dependency */
let tokenProvider: () => string | null = () => null

export function setTokenProvider(provider: () => string | null): void {
  tokenProvider = provider
}

/** Unified request entry: injects the auth header, parses {error: {code, message}} */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const token = tokenProvider()
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(path, { ...init, headers })

  // 204 has no body
  if (res.status === 204) return undefined as T

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
    )
  }
  return body as T
}

/* ------------------------------ Endpoint wrappers ------------------------------ */

/** Fetch the available domains (public endpoint) */
export function getDomains(): Promise<{ domains: string[] }> {
  return request('/api/domains')
}

/** Create a random account: the response carries the one-time plaintext password, save it immediately */
export function createRandomAccount(): Promise<AccountDto> {
  return request('/api/accounts', { method: 'POST', body: JSON.stringify({ random: true }) })
}

/** Create an account with an explicit address */
export function createAccount(address: string, password: string): Promise<AccountDto> {
  return request('/api/accounts', { method: 'POST', body: JSON.stringify({ address, password }) })
}

/** Exchange address + password for a JWT */
export function login(address: string, password: string): Promise<{ token: string; id: string }> {
  return request('/api/token', { method: 'POST', body: JSON.stringify({ address, password }) })
}

/** Current account info */
export function getMe(): Promise<AccountDto> {
  return request('/api/me')
}

/** Delete the current account */
export function deleteMe(): Promise<void> {
  return request('/api/me', { method: 'DELETE' })
}

/** Message list (paginated) */
export function listMessages(page = 1, limit = 50): Promise<MessageListResponse> {
  return request(`/api/messages?page=${page}&limit=${limit}`)
}

/** Message detail */
export function getMessage(id: string): Promise<MessageDetail> {
  return request(`/api/messages/${id}`)
}

/** Mark a message seen/unseen */
export function setMessageSeen(id: string, seen: boolean): Promise<MessageDetail> {
  return request(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ seen }) })
}

/** Delete a message */
export function deleteMessage(id: string): Promise<void> {
  return request(`/api/messages/${id}`, { method: 'DELETE' })
}

/** Raw EML source (text/plain) */
export async function getMessageSource(id: string): Promise<string> {
  const headers = new Headers()
  const token = tokenProvider()
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`/api/messages/${id}/source`, { headers })
  if (!res.ok) throw new Error(`Failed to fetch source (${res.status})`)
  return res.text()
}

/** Download an attachment: fetch the binary with the auth header, return a Blob for saving */
export async function downloadAttachment(downloadUrl: string, filename: string): Promise<void> {
  const headers = new Headers()
  const token = tokenProvider()
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(downloadUrl, { headers })
  if (!res.ok) throw new Error(`Attachment download failed (${res.status})`)
  const blob = await res.blob()
  // Create a temporary object URL and simulate a click to trigger "Save As"
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
