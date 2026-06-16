// Microsoft Entra ID OIDC client — INTERNAL case officers / staff.
//
// Ported from prototype-legacy app/services/entra-id-client.js (Express, CJS) to
// ESM. Framework-agnostic: depends only on node:crypto + fetch. The only change is
// that the Express `req` (used to derive a base URL) is replaced by an explicit
// `baseUrl` string passed in by the Hapi route layer.
//
// Authorization-code flow against Entra ID v2.0, endpoints discovered from the
// tenant well-known URL, PKCE (S256) + state + nonce, claim map
// (oid|sub -> subject, email|preferred_username -> email, app `roles` -> roles).
// JWKS signature verification is a documented follow-up (state/nonce/expiry are
// checked); production direction is SAML 2.0.

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'

const HTTP_UNPROCESSABLE_ENTITY = 422
const PKCE_VERIFIER_BYTES = 48

let cachedDiscovery = null

// Shape the convict `auth.entra` block into the fields this client expects,
// deriving the tenant authority / discovery URL and the fixed OIDC parameters.
export function getEntraIdConfig() {
  const raw = config.get('auth.entra')
  const authority = raw.tenantId
    ? `https://login.microsoftonline.com/${raw.tenantId}/v2.0`
    : ''

  return {
    mode: raw.mode,
    tenantId: raw.tenantId,
    authority,
    wellKnownUrl: authority ? `${authority}/.well-known/openid-configuration` : '',
    clientId: raw.clientId,
    clientSecret: raw.clientSecret,
    publicBaseUrl: raw.publicBaseUrl,
    redirectUri: raw.redirectPath,
    postLogoutRedirectUri: raw.signOutRedirectUrl,
    scopes: ['openid', 'profile', 'offline_access'],
    usePkce: true,
    prompt: '',
    roles: { caseOfficerValue: raw.caseOfficerRoleValue }
  }
}

function createHttpError(statusCode, message, details = []) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.details = details
  return error
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function fromBase64Url(value) {
  const normalised = value.replaceAll('-', '+').replaceAll('_', '/')
  const padLength = normalised.length % 4
  const padded = padLength ? normalised + '='.repeat(4 - padLength) : normalised
  return Buffer.from(padded, 'base64').toString('utf8')
}

function createPkcePair() {
  const codeVerifier = toBase64Url(randomBytes(PKCE_VERIFIER_BYTES))
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')

  return { codeVerifier, codeChallenge }
}

function resolveUrl(baseUrl, value) {
  if (!value) {
    return ''
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  const base = (baseUrl || '').replace(/\/$/, '')
  return base ? new URL(value, `${base}/`).toString() : value
}

async function parseJsonSafe(response) {
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

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return {}
  }

  const segments = token.split('.')
  if (segments.length < 2) {
    return {}
  }

  return JSON.parse(fromBase64Url(segments[1]))
}

// OIDC discovery: fetch and cache the tenant endpoints from the well-known URL.
async function getEntraOidcConfig() {
  const entraConfig = getEntraIdConfig()

  if (!entraConfig.wellKnownUrl) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'ENTRA_TENANT_ID is not configured (no discovery URL)'
    )
  }

  if (cachedDiscovery?.wellKnownUrl === entraConfig.wellKnownUrl) {
    return cachedDiscovery.document
  }

  const response = await fetch(entraConfig.wellKnownUrl, {
    headers: { Accept: 'application/json' }
  })

  const document = await parseJsonSafe(response)

  if (!response.ok) {
    throw createHttpError(
      response.status,
      document.error_description ||
        document.error ||
        'Unable to load Microsoft Entra discovery document'
    )
  }

  cachedDiscovery = { wellKnownUrl: entraConfig.wellKnownUrl, document }
  return document
}

function getMissingLiveConfig(entraConfig) {
  const missing = []
  if (!entraConfig.tenantId) {
    missing.push('ENTRA_TENANT_ID')
  }
  if (!entraConfig.clientId) {
    missing.push('ENTRA_CLIENT_ID')
  }
  if (!entraConfig.clientSecret) {
    missing.push('ENTRA_CLIENT_SECRET')
  }
  return missing
}

export function getEntraConfigSummary(baseUrl) {
  const entraConfig = getEntraIdConfig()
  const missing = entraConfig.mode === 'live' ? getMissingLiveConfig(entraConfig) : []

  return {
    mode: entraConfig.mode,
    isLive: entraConfig.mode === 'live',
    configured: missing.length === 0,
    missing,
    usePkce: entraConfig.usePkce,
    tenantId: entraConfig.tenantId,
    authority: entraConfig.authority,
    clientId: entraConfig.clientId,
    redirectUri: resolveUrl(baseUrl, entraConfig.redirectUri),
    scopes: entraConfig.scopes
  }
}

export async function startLiveEntra(baseUrl, options = {}) {
  const entraConfig = getEntraIdConfig()
  const missing = getMissingLiveConfig(entraConfig)

  if (missing.length) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `Microsoft Entra live configuration is incomplete: ${missing.join(', ')}`,
      missing.map((key) => ({ field: key, message: `${key} is required` }))
    )
  }

  const { authorization_endpoint: authorizationEndpoint } = await getEntraOidcConfig()

  const state = randomUUID()
  const nonce = randomUUID()
  const redirectUri = resolveUrl(baseUrl, entraConfig.redirectUri)
  const result = {
    mode: 'live',
    state,
    nonce,
    redirectUri,
    returnTo: options.returnTo || '/admin/applications',
    pkceVerifier: '',
    authorizationUrl: ''
  }

  const search = new URLSearchParams({
    response_type: 'code',
    client_id: entraConfig.clientId,
    redirect_uri: redirectUri,
    scope: entraConfig.scopes.join(' '),
    response_mode: 'query',
    state,
    nonce
  })

  if (entraConfig.usePkce) {
    const pkce = createPkcePair()
    result.pkceVerifier = pkce.codeVerifier
    search.set('code_challenge', pkce.codeChallenge)
    search.set('code_challenge_method', 'S256')
  }

  if (entraConfig.prompt) {
    search.set('prompt', entraConfig.prompt)
  }

  if (options.loginHint) {
    search.set('login_hint', options.loginHint)
  }

  result.authorizationUrl = `${authorizationEndpoint}?${search.toString()}`
  return result
}

function buildTokenRequestBody(entraConfig, params) {
  const body = new URLSearchParams({ client_id: entraConfig.clientId, ...params })
  if (entraConfig.clientSecret) {
    body.set('client_secret', entraConfig.clientSecret)
  }
  return body
}

function throwIfResponseNotOk(response, payload, fallbackMessage) {
  if (response.ok) {
    return
  }

  throw createHttpError(
    response.status,
    payload.error_description || payload.error || fallbackMessage
  )
}

function normaliseTokenResponse(payload) {
  return {
    accessToken: payload.access_token || '',
    idToken: payload.id_token || '',
    refreshToken: payload.refresh_token || '',
    tokenType: payload.token_type || '',
    expiresIn: payload.expires_in || 0
  }
}

async function exchangeCodeForTokens(entraConfig, code, redirectUri, codeVerifier) {
  const { token_endpoint: tokenEndpoint } = await getEntraOidcConfig()

  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }

  if (entraConfig.usePkce && codeVerifier) {
    params.code_verifier = codeVerifier
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: buildTokenRequestBody(entraConfig, params).toString()
  })

  const payload = await parseJsonSafe(response)
  throwIfResponseNotOk(response, payload, 'Entra token exchange failed')

  return normaliseTokenResponse(payload)
}

function readRoles(claims) {
  const rawRoles = claims.roles
  if (Array.isArray(rawRoles)) {
    return rawRoles.map(String)
  }
  return rawRoles ? [String(rawRoles)] : []
}

// Map standard Entra ID v2.0 claims to the prototype's staff profile shape.
export function mapEntraClaimsToProfile(claims, entraConfig) {
  const subject = claims.oid || claims.sub
  if (!subject) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'No subject claim (oid/sub) found in Microsoft Entra token'
    )
  }

  const firstName = String(claims.given_name || '')
  const lastName = String(claims.family_name || '')
  const name = String(claims.name || '') || `${firstName} ${lastName}`.trim()
  const roles = readRoles(claims)

  const caseOfficerValue = String(entraConfig.roles.caseOfficerValue || 'case_officer')
  const hasCaseOfficerRole = roles.some(
    (value) => value.toLowerCase() === caseOfficerValue.toLowerCase()
  )

  return {
    subject: String(subject),
    email: String(claims.email || claims.preferred_username || claims.upn || ''),
    firstName,
    lastName,
    name,
    roles,
    role: 'case_officer',
    hasCaseOfficerRole,
    sessionId: String(claims.sid || ''),
    claims
  }
}

export async function completeLiveEntra(callback, sessionState) {
  const entraConfig = getEntraIdConfig()

  if (!callback?.code || !callback?.state) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Missing code or state in Microsoft Entra callback'
    )
  }

  if (!sessionState?.state || callback.state !== sessionState.state) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Unable to verify Microsoft Entra state value'
    )
  }

  const tokens = await exchangeCodeForTokens(
    entraConfig,
    callback.code,
    sessionState.redirectUri,
    sessionState.pkceVerifier
  )

  const claims = {
    ...decodeJwtPayload(tokens.accessToken),
    ...decodeJwtPayload(tokens.idToken)
  }

  if (sessionState?.nonce && claims?.nonce && claims.nonce !== sessionState.nonce) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Microsoft Entra nonce validation failed in callback'
    )
  }

  const profile = mapEntraClaimsToProfile(claims, entraConfig)

  return {
    profile,
    token: tokens.accessToken || tokens.idToken,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
    returnTo: sessionState.returnTo || '/admin/applications'
  }
}

export async function buildEntraSignOutUrl(baseUrl, idTokenHint) {
  const entraConfig = getEntraIdConfig()
  if (entraConfig.mode !== 'live') {
    return ''
  }

  const { end_session_endpoint: endSessionEndpoint } = await getEntraOidcConfig()
  if (!endSessionEndpoint) {
    return ''
  }

  const search = new URLSearchParams()
  const postLogoutRedirectUri = resolveUrl(baseUrl, entraConfig.postLogoutRedirectUri)
  if (postLogoutRedirectUri) {
    search.set('post_logout_redirect_uri', postLogoutRedirectUri)
  }
  if (idTokenHint) {
    search.set('id_token_hint', idTokenHint)
  }

  const suffix = search.toString()
  return suffix ? `${endSessionEndpoint}?${suffix}` : endSessionEndpoint
}

export function isLiveMode() {
  return getEntraIdConfig().mode === 'live'
}
