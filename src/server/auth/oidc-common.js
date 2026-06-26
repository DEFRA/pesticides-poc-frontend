// Shared OIDC helpers used by both identity clients (Defra Identity B2C + Entra).
// Framework-agnostic: node:crypto + fetch only. Extracted so the two clients don't
// duplicate the auth-code/PKCE/discovery/token plumbing.

import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes
} from 'node:crypto'

export const HTTP_UNPROCESSABLE_ENTITY = 422
export const HTTP_UNAUTHORIZED = 401
const PKCE_VERIFIER_BYTES = 48
const DEFAULT_CLOCK_TOLERANCE_SEC = 60
const MS_PER_SEC = 1000
const JWT_SEGMENTS = 3 // header.payload.signature

// JWT `alg` -> Node verify algorithm. RSA only (Entra/B2C sign ID tokens with RS256).
const JWT_ALG_TO_HASH = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512'
}

export function createHttpError(statusCode, message, details = []) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.details = details
  return error
}

export function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

export function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export function createPkcePair() {
  const codeVerifier = toBase64Url(randomBytes(PKCE_VERIFIER_BYTES))
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

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

// Fetch a JSON document with simple per-caller, URL-keyed caching. `cache` is a
// mutable holder object ({ url, document }) owned by the caller — used for both the
// discovery document and the JWKS.
//
// POST-POC NOTE: this cache is intentionally minimal for the POC. Before
// production it should be revisited because it is:
//   - in-process memory only — not shared across pods/instances;
//   - has no TTL — a rotated discovery doc / JWKS would be served stale;
//   - inconsistent with the project's existing caching, which already wires up
//     Redis via @hapi/catbox (see common/helpers/session-cache/cache-engine.js).
// A shared, TTL'd cache (or the platform's catbox policy) is the production path.
async function loadJsonDocument(url, cache, errorMessage) {
  if (cache.url === url && cache.document) {
    return cache.document
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  })
  const document = await parseJsonSafe(response)

  if (!response.ok) {
    throw createHttpError(
      response.status,
      document.error_description || document.error || errorMessage
    )
  }

  cache.url = url
  cache.document = document
  return document
}

// OIDC discovery document (per-client cache).
export async function loadDiscovery(wellKnownUrl, cache, errorMessage) {
  return loadJsonDocument(wellKnownUrl, cache, errorMessage)
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

// --- ID token verification (JWKS signature + standard claims) ---------------

// Load the provider JWKS (its `keys` array), cached per-URI like discovery.
export async function loadJwks(jwksUri, cache, errorMessage) {
  const document = await loadJsonDocument(jwksUri, cache, errorMessage)
  return Array.isArray(document.keys) ? document.keys : []
}

function selectSigningKey(jwks, header) {
  // A token MUST name its signing key (`kid`) and that key MUST be in the JWKS.
  // B2C/Entra always set `kid`; reject anything without a matching one (no
  // "use the only key" fallback, which could match a key the token wasn't signed with).
  if (!header.kid) {
    return null
  }
  return (jwks || []).find((key) => key.kid === header.kid) || null
}

// Verify the RSA signature over `<header>.<payload>` using the matching JWK.
function verifyJwtSignature(signingInput, signatureB64, header, jwks) {
  const hashAlgorithm = JWT_ALG_TO_HASH[header.alg]
  if (!hashAlgorithm) {
    throw createHttpError(
      HTTP_UNAUTHORIZED,
      `Unsupported ID token algorithm: ${header.alg}`
    )
  }

  const jwk = selectSigningKey(jwks, header)
  if (!jwk) {
    throw createHttpError(
      HTTP_UNAUTHORIZED,
      'No matching JWKS key for ID token'
    )
  }

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
  const verifier = createVerify(hashAlgorithm)
  verifier.update(signingInput)
  verifier.end()

  if (!verifier.verify(publicKey, Buffer.from(signatureB64, 'base64url'))) {
    throw createHttpError(
      HTTP_UNAUTHORIZED,
      'ID token signature verification failed'
    )
  }
}

// Match checks: iss/aud/nonce must equal what we expect. These are UNCONDITIONAL —
// skipping a check when the expectation is falsy would be a fail-open hole (e.g. a
// missing configured issuer, or a token that omits `nonce`, would pass).
function assertClaimMatch(claims, { issuer, audience, nonce }) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'ID token issuer mismatch')
  }
  if (!audiences.includes(audience)) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'ID token audience mismatch')
  }
  if (claims.nonce !== nonce) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'ID token nonce validation failed')
  }
}

// Timing checks. `exp` is REQUIRED (a token with no expiry is treated as invalid);
// `nbf`/`iat` are validated when present, within the clock-skew tolerance.
function assertClaimTiming(claims, nowSec, skewSec) {
  if (typeof claims.exp !== 'number' || nowSec > claims.exp + skewSec) {
    throw createHttpError(
      HTTP_UNAUTHORIZED,
      'ID token has expired or has no exp'
    )
  }
  if (typeof claims.nbf === 'number' && nowSec < claims.nbf - skewSec) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'ID token is not yet valid (nbf)')
  }
  if (typeof claims.iat === 'number' && claims.iat > nowSec + skewSec) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'ID token issued in the future')
  }
}

// Validate the standard ID token claims (issuer, audience, expiry/nbf/iat, nonce).
function assertIdTokenClaims(claims, options) {
  assertClaimMatch(claims, options)
  assertClaimTiming(
    claims,
    Math.floor(options.now / MS_PER_SEC),
    options.clockToleranceSec
  )
}

// Verify an ID token end-to-end: RSA signature against the JWKS, then the
// standard claims (iss/aud/exp/iat/nonce). Returns the verified payload claims.
export function verifyIdToken(idToken, options = {}) {
  if (!idToken || typeof idToken !== 'string') {
    throw createHttpError(HTTP_UNAUTHORIZED, 'No ID token provided')
  }

  // Require the expectations to be present, so the iss/aud/nonce checks can't pass
  // by both sides being undefined (undefined !== undefined === false).
  if (!options.issuer || !options.audience || !options.nonce) {
    throw createHttpError(
      HTTP_UNAUTHORIZED,
      'ID token verification requires issuer, audience and nonce'
    )
  }

  const segments = idToken.split('.')
  if (segments.length !== JWT_SEGMENTS) {
    throw createHttpError(HTTP_UNAUTHORIZED, 'Malformed ID token')
  }

  const [headerB64, payloadB64, signatureB64] = segments
  const header = JSON.parse(fromBase64Url(headerB64))

  verifyJwtSignature(
    `${headerB64}.${payloadB64}`,
    signatureB64,
    header,
    options.jwks
  )

  const claims = JSON.parse(fromBase64Url(payloadB64))
  assertIdTokenClaims(claims, {
    issuer: options.issuer,
    audience: options.audience,
    nonce: options.nonce,
    now: options.now ?? Date.now(),
    clockToleranceSec: options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC
  })

  return claims
}
