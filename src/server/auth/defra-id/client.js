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
// Framework-agnostic: node:crypto + fetch only (shared plumbing in ../oidc-common.js);
// the Hapi layer passes a `baseUrl` string. Authorization-code + PKCE (S256) + state +
// nonce. JWKS signature verification is a documented follow-up (state/nonce/expiry are
// checked).

import { randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'

import {
  HTTP_UNPROCESSABLE_ENTITY,
  buildDisplayName,
  createHttpError,
  createPkcePair,
  decodeJwtPayload,
  exchangeCodeForTokens,
  loadDiscovery,
  resolveUrl,
  toStringArray
} from '../oidc-common.js'

// In-process discovery cache (POC). See loadDiscovery in ../oidc-common.js for the
// post-POC caveats (no TTL, per-pod, vs the project's Redis/catbox caching).
const discoveryCache = {}

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

async function getDefraIdOidcConfig() {
  const { wellKnownUrl } = getDefraIdConfig()

  if (!wellKnownUrl) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'DEFRA_ID_WELL_KNOWN_URL is not configured (no discovery URL)'
    )
  }

  return loadDiscovery(
    wellKnownUrl,
    discoveryCache,
    'Unable to load Defra Identity discovery document'
  )
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

// Relationship claim -> organisations[]. Defra Identity sends relationships as
// colon-delimited strings; tolerate objects too.
function objectToOrganisation(entry) {
  return {
    relationshipId: String(entry.relationshipId || entry.organisationId || ''),
    organisationId: String(entry.organisationId || ''),
    organisationName: String(entry.organisationName || entry.name || '')
  }
}

function stringToOrganisation(value) {
  // "relationshipId:organisationId:organisationName:..." (Defra ID format)
  const parts = String(value).split(':')
  return {
    relationshipId: parts[0] || '',
    organisationId: parts[1] || parts[0] || '',
    organisationName: parts[2] || ''
  }
}

function toOrganisation(entry) {
  return entry && typeof entry === 'object'
    ? objectToOrganisation(entry)
    : stringToOrganisation(entry)
}

function readOrganisations(relationships) {
  if (!Array.isArray(relationships)) {
    return []
  }

  return relationships
    .map(toOrganisation)
    .filter((org) => org.relationshipId || org.organisationId)
}

function readName(claims, claimMap) {
  const firstName = String(
    claims[claimMap.firstName] || claims.given_name || ''
  )
  const lastName = String(claims[claimMap.lastName] || claims.family_name || '')
  return {
    firstName,
    lastName,
    name: buildDisplayName(firstName, lastName, claims.name)
  }
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

  const { firstName, lastName, name } = readName(claims, claimMap)
  const currentRelationshipId = String(
    claims[claimMap.currentRelationshipId] || ''
  )

  return {
    subject: String(subject),
    contactId: String(claims[claimMap.contactId] || ''),
    email: String(claims[claimMap.email] || ''),
    firstName,
    lastName,
    name,
    crn: String(claims.crn || ''),
    organisationId: currentRelationshipId,
    organisations: readOrganisations(claims[claimMap.relationships]),
    roles: toStringArray(claims[claimMap.roles]),
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

  const { token_endpoint: tokenEndpoint } = await getDefraIdOidcConfig()
  const tokens = await exchangeCodeForTokens(
    {
      tokenEndpoint,
      clientId: defraIdConfig.clientId,
      clientSecret: defraIdConfig.clientSecret,
      usePkce: defraIdConfig.usePkce,
      errorMessage: 'Defra Identity token exchange failed'
    },
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
