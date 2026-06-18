// Microsoft Entra ID OIDC client — INTERNAL case officers / staff.
//
// Ported from prototype-legacy app/services/entra-id-client.js (Express, CJS) to
// ESM. Framework-agnostic: node:crypto + fetch only (shared plumbing in
// ../oidc-common.js). The Express `req` is replaced by an explicit `baseUrl` string.
//
// Authorization-code flow against Entra ID v2.0, endpoints discovered from the
// tenant well-known URL, PKCE (S256) + state + nonce, claim map
// (oid|sub -> subject, email|preferred_username -> email, app `roles` -> roles).
// State, nonce and token expiry are checked; RS256/JWKS signature plus iss/aud
// verification are the EQ-256 hardening follow-up. Production direction is SAML 2.0.

import { randomUUID } from 'node:crypto'

import { config } from '#/config/config.js'

import {
  HTTP_UNPROCESSABLE_ENTITY,
  buildDisplayName,
  createHttpError,
  createPkcePair,
  exchangeCodeForTokens,
  firstNonEmpty,
  loadDiscovery,
  loadJwks,
  resolveUrl,
  toStringArray,
  verifyIdToken
} from '../oidc-common.js'

const discoveryCache = {}
const jwksCache = {}

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
    wellKnownUrl: authority
      ? `${authority}/.well-known/openid-configuration`
      : '',
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

// OIDC discovery: fetch and cache the tenant endpoints from the well-known URL.
async function getEntraOidcConfig() {
  const { wellKnownUrl } = getEntraIdConfig()

  if (!wellKnownUrl) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'ENTRA_TENANT_ID is not configured (no discovery URL)'
    )
  }

  return loadDiscovery(
    wellKnownUrl,
    discoveryCache,
    'Unable to load Microsoft Entra discovery document'
  )
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
  const missing =
    entraConfig.mode === 'live' ? getMissingLiveConfig(entraConfig) : []

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

  const { authorization_endpoint: authorizationEndpoint } =
    await getEntraOidcConfig()

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
    // form_post keeps the code out of the URL/logs; the callback accepts the
    // code from the POST body.
    response_mode: 'form_post',
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

// Map standard Entra ID v2.0 claims to the prototype's staff profile shape.
export function mapEntraClaimsToProfile(claims, entraConfig) {
  const subject = firstNonEmpty(claims.oid, claims.sub)
  if (!subject) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'No subject claim (oid/sub) found in Microsoft Entra token'
    )
  }

  const firstName = String(claims.given_name || '')
  const lastName = String(claims.family_name || '')
  const roles = toStringArray(claims.roles)
  const caseOfficerValue = String(
    entraConfig.roles.caseOfficerValue || 'case_officer'
  )
  const hasCaseOfficerRole = roles.some(
    (value) => value.toLowerCase() === caseOfficerValue.toLowerCase()
  )

  return {
    subject,
    email: firstNonEmpty(claims.email, claims.preferred_username, claims.upn),
    firstName,
    lastName,
    name: buildDisplayName(firstName, lastName, claims.name),
    roles,
    // Only grant the case-officer role when the token actually carries it.
    // Assigning it unconditionally would let any authenticated Entra user past
    // the case-officer guard on /admin/*.
    role: hasCaseOfficerRole ? 'case_officer' : '',
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

  const discovery = await getEntraOidcConfig()
  const tokens = await exchangeCodeForTokens(
    {
      tokenEndpoint: discovery.token_endpoint,
      clientId: entraConfig.clientId,
      clientSecret: entraConfig.clientSecret,
      usePkce: entraConfig.usePkce,
      errorMessage: 'Entra token exchange failed'
    },
    callback.code,
    sessionState.redirectUri,
    sessionState.pkceVerifier
  )

  // Identity comes from the ID token only (the access token is an opaque bearer
  // credential). Verify its signature against the tenant JWKS and validate the
  // standard claims (issuer, audience, expiry, nonce) before trusting any of them.
  const jwks = await loadJwks(
    discovery.jwks_uri,
    jwksCache,
    'Unable to load Microsoft Entra JWKS'
  )
  const claims = verifyIdToken(tokens.idToken, {
    jwks,
    issuer: discovery.issuer,
    audience: entraConfig.clientId,
    nonce: sessionState.nonce
  })

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

  const { end_session_endpoint: endSessionEndpoint } =
    await getEntraOidcConfig()
  if (!endSessionEndpoint) {
    return ''
  }

  const search = new URLSearchParams()
  const postLogoutRedirectUri = resolveUrl(
    baseUrl,
    entraConfig.postLogoutRedirectUri
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
  return getEntraIdConfig().mode === 'live'
}
