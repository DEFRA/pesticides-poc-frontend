// Shared OIDC helpers used by both identity clients (Defra Identity B2C + Entra).
// Framework-agnostic: node:crypto + fetch only. Extracted so the two clients don't
// duplicate the auth-code/PKCE/discovery/token plumbing.

import { createHash, randomBytes } from 'node:crypto'

export const HTTP_UNPROCESSABLE_ENTITY = 422
const PKCE_VERIFIER_BYTES = 48

export function createHttpError(statusCode, message, details = []) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.details = details
  return error
}

export function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

export function fromBase64Url(value) {
  const normalised = value.replaceAll('-', '+').replaceAll('_', '/')
  const padLength = normalised.length % 4
  const padded = padLength ? normalised + '='.repeat(4 - padLength) : normalised
  return Buffer.from(padded, 'base64').toString('utf8')
}

export function createPkcePair() {
  const codeVerifier = toBase64Url(randomBytes(PKCE_VERIFIER_BYTES))
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')

  return { codeVerifier, codeChallenge }
}

export function resolveUrl(baseUrl, value) {
  if (!value) {
    return ''
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  const base = (baseUrl || '').replace(/\/$/, '')
  return base ? new URL(value, `${base}/`).toString() : value
}

export async function parseJsonSafe(response) {
  const text = await response.text()
  if (!text) {
    return {}
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return { raw: text }
  }

  return JSON.parse(text)
}

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return {}
  }

  const segments = token.split('.')
  if (segments.length < 2) {
    return {}
  }

  return JSON.parse(fromBase64Url(segments[1]))
}

// First defined, non-empty value as a string (used for claim fallbacks).
export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return String(value)
    }
  }
  return ''
}

// Display name: prefer a full `name` claim, else "first last".
export function buildDisplayName(firstName, lastName, fullName) {
  return String(fullName || '') || `${firstName} ${lastName}`.trim()
}

// Coerce a roles-style claim (array | scalar | absent) into a string array.
export function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(String)
  }
  return value ? [String(value)] : []
}

export function normaliseTokenResponse(payload) {
  return {
    accessToken: payload.access_token || '',
    idToken: payload.id_token || '',
    refreshToken: payload.refresh_token || '',
    tokenType: payload.token_type || '',
    expiresIn: payload.expires_in || 0
  }
}

// OIDC discovery with per-client caching. `cache` is a mutable holder object
// ({ wellKnownUrl, document }) owned by the calling client.
export async function loadDiscovery(wellKnownUrl, cache, errorMessage) {
  if (cache.wellKnownUrl === wellKnownUrl && cache.document) {
    return cache.document
  }

  const response = await fetch(wellKnownUrl, {
    headers: { Accept: 'application/json' }
  })
  const document = await parseJsonSafe(response)

  if (!response.ok) {
    throw createHttpError(
      response.status,
      document.error_description || document.error || errorMessage
    )
  }

  cache.wellKnownUrl = wellKnownUrl
  cache.document = document
  return document
}

// Authorization-code → token exchange. `spec` carries the per-client details.
export async function exchangeCodeForTokens(
  spec,
  code,
  redirectUri,
  codeVerifier
) {
  const { tokenEndpoint, clientId, clientSecret, usePkce, errorMessage } = spec

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  })
  if (usePkce && codeVerifier) {
    body.set('code_verifier', codeVerifier)
  }
  if (clientSecret) {
    body.set('client_secret', clientSecret)
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  const payload = await parseJsonSafe(response)
  if (!response.ok) {
    throw createHttpError(
      response.status,
      payload.error_description || payload.error || errorMessage
    )
  }

  return normaliseTokenResponse(payload)
}
