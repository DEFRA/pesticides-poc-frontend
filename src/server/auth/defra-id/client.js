// Defra Customer Identity (Azure AD B2C) OIDC client — EXTERNAL applicants.
//
// Reconstructed (the standalone defra-id-client.js was removed from prototype-legacy
// and not committed) by adapting the surviving entra-id-client.js to the Defra-
// specific shape documented in Defra-Identity-POC-Technical-Briefing-Note.md:
//   - authorize params: `serviceId` and B2C policy `p`
//   - the client id is also sent as an additional scope
//     (scope = `openid offline_access <clientId>`)
//   - claim map carries ORGANISATION/RELATIONSHIP context the Entra flow lacks:
//     sub -> subject, contactId, currentRelationshipId -> organisationId,
//     relationships -> organisations[], roles, sid
//
// Framework-agnostic: node:crypto + fetch only; the Hapi layer passes a `baseUrl`
// string. Authorization-code + PKCE (S256) + state + nonce. JWKS signature
// verification is a documented follow-up (state/nonce/expiry are checked).

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'

const HTTP_UNPROCESSABLE_ENTITY = 422
const PKCE_VERIFIER_BYTES = 48

let cachedDiscovery = null

export function getDefraIdConfig() {
  const raw = config.get('auth.defraId')

  // Defra Identity requires the client id to also be present as a scope.
  const scopes = ['openid', 'offline_access']
  if (raw.clientId) {
    scopes.push(raw.clientId)
  }

  return {
    mode: raw.mode,
    wellKnownUrl: raw.wellKnownUrl,
    clientId: raw.clientId,
    clientSecret: raw.clientSecret,
    serviceId: raw.serviceId,
    policy: raw.policy,
    publicBaseUrl: raw.publicBaseUrl,
    redirectUri: raw.redirectPath,
    postLogoutRedirectUri: raw.signOutRedirectUrl,
    claims: raw.claims,
    scopes,
    usePkce: true
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

async function getDefraIdOidcConfig() {
  const defraIdConfig = getDefraIdConfig()

  if (!defraIdConfig.wellKnownUrl) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'DEFRA_ID_WELL_KNOWN_URL is not configured (no discovery URL)'
    )
  }

  if (cachedDiscovery?.wellKnownUrl === defraIdConfig.wellKnownUrl) {
    return cachedDiscovery.document
  }

  const response = await fetch(defraIdConfig.wellKnownUrl, {
    headers: { Accept: 'application/json' }
  })

  const document = await parseJsonSafe(response)

  if (!response.ok) {
    throw createHttpError(
      response.status,
      document.error_description ||
        document.error ||
        'Unable to load Defra Identity discovery document'
    )
  }

  cachedDiscovery = { wellKnownUrl: defraIdConfig.wellKnownUrl, document }
  return document
}

function getMissingLiveConfig(defraIdConfig) {
  const missing = []
  if (!defraIdConfig.wellKnownUrl) {
    missing.push('DEFRA_ID_WELL_KNOWN_URL')
  }
  if (!defraIdConfig.clientId) {
    missing.push('DEFRA_ID_CLIENT_ID')
  }
  if (!defraIdConfig.clientSecret) {
    missing.push('DEFRA_ID_CLIENT_SECRET')
  }
  if (!defraIdConfig.serviceId) {
    missing.push('DEFRA_ID_SERVICE_ID')
  }
  if (!defraIdConfig.policy) {
    missing.push('DEFRA_ID_POLICY')
  }
  return missing
}

export function getDefraIdConfigSummary(baseUrl) {
  const defraIdConfig = getDefraIdConfig()
  const missing =
    defraIdConfig.mode === 'live' ? getMissingLiveConfig(defraIdConfig) : []

  return {
    mode: defraIdConfig.mode,
    isLive: defraIdConfig.mode === 'live',
    configured: missing.length === 0,
    missing,
    usePkce: defraIdConfig.usePkce,
    clientId: defraIdConfig.clientId,
    serviceId: defraIdConfig.serviceId,
    policy: defraIdConfig.policy,
    redirectUri: resolveUrl(baseUrl, defraIdConfig.redirectUri),
    scopes: defraIdConfig.scopes
  }
}

export async function startLiveDefraId(baseUrl, options = {}) {
  const defraIdConfig = getDefraIdConfig()
  const missing = getMissingLiveConfig(defraIdConfig)

  if (missing.length) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `Defra Identity live configuration is incomplete: ${missing.join(', ')}`,
      missing.map((key) => ({ field: key, message: `${key} is required` }))
    )
  }

  const { authorization_endpoint: authorizationEndpoint } =
    await getDefraIdOidcConfig()

  const state = randomUUID()
  const nonce = randomUUID()
  const redirectUri = resolveUrl(baseUrl, defraIdConfig.redirectUri)
  const result = {
    mode: 'live',
    state,
    nonce,
    redirectUri,
    returnTo: options.returnTo || '/register/type',
    pkceVerifier: '',
    authorizationUrl: ''
  }

  const search = new URLSearchParams({
    response_type: 'code',
    client_id: defraIdConfig.clientId,
    redirect_uri: redirectUri,
    scope: defraIdConfig.scopes.join(' '),
    response_mode: 'query',
    state,
    nonce,
    // Defra Identity-specific authorize parameters.
    serviceId: defraIdConfig.serviceId,
    p: defraIdConfig.policy
  })

  if (defraIdConfig.usePkce) {
    const pkce = createPkcePair()
    result.pkceVerifier = pkce.codeVerifier
    search.set('code_challenge', pkce.codeChallenge)
    search.set('code_challenge_method', 'S256')
  }

  // Organisation re-selection (cross-service SSO): force the org picker and/or
  // pre-select a relationship.
  if (options.forceReselection) {
    search.set('forceReselection', 'true')
  }
  if (options.relationshipId) {
    search.set('relationshipId', options.relationshipId)
  }
  if (options.loginHint) {
    search.set('login_hint', options.loginHint)
  }

  result.authorizationUrl = `${authorizationEndpoint}?${search.toString()}`
  return result
}

function buildTokenRequestBody(defraIdConfig, params) {
  const body = new URLSearchParams({
    client_id: defraIdConfig.clientId,
    ...params
  })
  if (defraIdConfig.clientSecret) {
    body.set('client_secret', defraIdConfig.clientSecret)
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

async function exchangeCodeForTokens(
  defraIdConfig,
  code,
  redirectUri,
  codeVerifier
) {
  const { token_endpoint: tokenEndpoint } = await getDefraIdOidcConfig()

  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }

  if (defraIdConfig.usePkce && codeVerifier) {
    params.code_verifier = codeVerifier
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: buildTokenRequestBody(defraIdConfig, params).toString()
  })

  const payload = await parseJsonSafe(response)
  throwIfResponseNotOk(
    response,
    payload,
    'Defra Identity token exchange failed'
  )

  return normaliseTokenResponse(payload)
}

// Normalise the `relationships` claim into the prototype's organisations[] shape.
// Defra Identity sends relationships as colon-delimited strings; tolerate objects.
function readOrganisations(relationships) {
  if (!Array.isArray(relationships)) {
    return []
  }

  return relationships
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        return {
          relationshipId: String(
            entry.relationshipId || entry.organisationId || ''
          ),
          organisationId: String(entry.organisationId || ''),
          organisationName: String(entry.organisationName || entry.name || '')
        }
      }

      // "relationshipId:organisationId:organisationName:..." (Defra ID format)
      const parts = String(entry).split(':')
      return {
        relationshipId: parts[0] || '',
        organisationId: parts[1] || parts[0] || '',
        organisationName: parts[2] || ''
      }
    })
    .filter((org) => org.relationshipId || org.organisationId)
}

export function mapDefraIdClaimsToProfile(claims) {
  // Claim names are configurable (DEFRA_ID_CLAIM_*) so the mapping can match the
  // live token without code changes; standard OIDC names are kept as fallbacks.
  const claimMap = getDefraIdConfig().claims

  const subject = claims[claimMap.sub]
  if (!subject) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `No subject claim (${claimMap.sub}) found in Defra Identity token`
    )
  }

  const firstName = String(
    claims[claimMap.firstName] || claims.given_name || ''
  )
  const lastName = String(claims[claimMap.lastName] || claims.family_name || '')
  const name = String(claims.name || '') || `${firstName} ${lastName}`.trim()
  const organisations = readOrganisations(claims[claimMap.relationships])
  const currentRelationshipId = String(
    claims[claimMap.currentRelationshipId] || ''
  )
  const rawRoles = claims[claimMap.roles]
  const roles = Array.isArray(rawRoles)
    ? rawRoles.map(String)
    : rawRoles
      ? [String(rawRoles)]
      : []

  return {
    subject: String(subject),
    contactId: String(claims[claimMap.contactId] || ''),
    email: String(claims[claimMap.email] || ''),
    firstName,
    lastName,
    name,
    crn: String(claims.crn || ''),
    organisationId: currentRelationshipId,
    organisations,
    roles,
    role: 'applicant',
    sessionId: String(claims[claimMap.sessionId] || ''),
    claims
  }
}

export async function completeLiveDefraId(callback, sessionState) {
  const defraIdConfig = getDefraIdConfig()

  if (!callback?.code || !callback?.state) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Missing code or state in Defra Identity callback'
    )
  }

  if (!sessionState?.state || callback.state !== sessionState.state) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Unable to verify Defra Identity state value'
    )
  }

  const tokens = await exchangeCodeForTokens(
    defraIdConfig,
    callback.code,
    sessionState.redirectUri,
    sessionState.pkceVerifier
  )

  const claims = {
    ...decodeJwtPayload(tokens.accessToken),
    ...decodeJwtPayload(tokens.idToken)
  }

  if (
    sessionState?.nonce &&
    claims?.nonce &&
    claims.nonce !== sessionState.nonce
  ) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Defra Identity nonce validation failed in callback'
    )
  }

  const profile = mapDefraIdClaimsToProfile(claims)

  return {
    profile,
    token: tokens.accessToken || tokens.idToken,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
    returnTo: sessionState.returnTo || '/register/type'
  }
}

export async function buildDefraIdSignOutUrl(baseUrl, idTokenHint) {
  const defraIdConfig = getDefraIdConfig()
  if (defraIdConfig.mode !== 'live') {
    return ''
  }

  const { end_session_endpoint: endSessionEndpoint } =
    await getDefraIdOidcConfig()
  if (!endSessionEndpoint) {
    return ''
  }

  const search = new URLSearchParams()
  const postLogoutRedirectUri = resolveUrl(
    baseUrl,
    defraIdConfig.postLogoutRedirectUri
  )
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
  return getDefraIdConfig().mode === 'live'
}
