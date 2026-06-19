// Shared auth session orchestration (@hapi/yar) — IdP-agnostic.
//
// Ported from prototype-legacy app/routes/pesticides/shared.js (Express,
// req.session.data.defraId) to Hapi/yar. Both identity populations write into a
// single session object under one yar key; it carries a `provider` field so the
// role guards, views and sign-out work regardless of which IdP authenticated the
// user. Authorisation (role + scope) is resolved downstream via get-permissions,
// NOT taken from the raw IdP token. See docs/auth/AUTH-ARCHITECTURE.md.

import { statusCodes } from '#/server/common/constants/status-codes.js'

import { getPermissions } from './get-permissions.js'

export const AUTH_SESSION_KEY = 'auth'

// Provider labels stored on the session (used by sign-out dispatch + views).
export const DEFRA_ID_PROVIDER = 'defra-customer-identity'
export const ENTRA_PROVIDER = 'microsoft-entra-id'

export const PAGE_PATHS = {
  // Neutral chooser for role-agnostic guards (we don't know the population yet).
  SIGN_IN: '/auth/sign-in',
  DEFRA_ID_SIGN_IN: '/auth/defra-id/sign-in',
  ENTRA_SIGN_IN: '/auth/entra/sign-in',
  SIGN_OUT: '/auth/sign-out',
  ACCOUNT: '/auth/account',
  // Downstream journeys (not yet built in this repo). Kept so role-aware redirects
  // and returnTo deep-links resolve correctly once those pages land.
  REGISTER_TYPE: '/register/type',
  ADMIN_APPLICATIONS: '/admin/applications'
}

export function buildAuthDefaults() {
  return {
    isAuthenticated: false,
    provider: '',
    mode: 'mock',
    subject: '',
    crn: '',
    email: '',
    firstName: '',
    lastName: '',
    name: '',
    organisationId: '',
    organisations: [],
    roles: [],
    role: 'applicant',
    roleLabel: '',
    scope: [],
    claims: {},
    authenticatedAt: '',
    currentRole: 'applicant',
    // Transient values held only between sign-in start and callback.
    pendingState: '',
    pendingNonce: '',
    pkceVerifier: '',
    pendingRedirectUri: '',
    pendingIdentity: 'applicant',
    token: '',
    refreshToken: '',
    idTokenHint: '',
    // Empty by default so each provider's start picks its own home page; the
    // guards override it with the attempted URL for deep-link returnTo.
    returnTo: ''
  }
}

// Read the auth session, merged over defaults so new fields are always present.
export function getAuthSession(request) {
  const current = request.yar.get(AUTH_SESSION_KEY)
  return { ...buildAuthDefaults(), ...current }
}

export function setAuthSession(request, session) {
  request.yar.set(AUTH_SESSION_KEY, session)
  return session
}

export function clearAuthSession(request) {
  const defaults = buildAuthDefaults()
  request.yar.set(AUTH_SESSION_KEY, defaults)
  return defaults
}

export function isAuthenticated(request) {
  return Boolean(getAuthSession(request).isAuthenticated)
}

export function createAuthError(statusCode, message, details = []) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.details = details
  return error
}

// Public base URL for building absolute OIDC redirect URIs. Prefer the configured
// value (must match what's registered with the IdP); fall back to the request host.
export function resolveBaseUrl(request, configuredBaseUrl) {
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const protocol =
    request?.url?.protocol?.replace(':', '') ||
    request?.server?.info?.protocol ||
    'http'
  const host = request?.info?.host || request?.headers?.host || ''
  return host ? `${protocol}://${host}` : ''
}

// Resolve the post-login destination. The IdP returnTo is role-blind, so steer each
// role to a page it can actually access and block open redirects (local paths only).
function isSafeLocalPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
  )
}

export function resolvePostLoginRedirect(role, returnTo) {
  const target = isSafeLocalPath(returnTo) ? returnTo : ''
  const isAdminPath = target.startsWith('/admin')

  if (role === 'case_officer') {
    // Case officers land in the admin area: honour an admin deep-link, otherwise
    // the admin applications view (their home).
    return isAdminPath ? target : PAGE_PATHS.ADMIN_APPLICATIONS
  }

  // Applicants land in the registration journey, never on case-officer-only
  // (admin) pages.
  return target && !isAdminPath ? target : PAGE_PATHS.REGISTER_TYPE
}

// Apply an authenticated profile to the session. Role + scope come from the
// downstream (mock) permissions service, not the IdP token.
export async function applyProfile(
  request,
  { provider, profile, tokens = {}, mode }
) {
  const { role: roleLabel, scope } = await getPermissions(profile)
  const session = getAuthSession(request)

  // Normalise optional fields once so a partial profile/token can't leave gaps.
  const p = {
    subject: '',
    crn: '',
    email: '',
    firstName: '',
    lastName: '',
    name: '',
    organisationId: '',
    organisations: [],
    roles: [],
    claims: {},
    ...profile
  }
  const t = { token: '', refreshToken: '', idToken: '', ...tokens }

  const updated = {
    ...session,
    isAuthenticated: true,
    provider,
    mode,
    subject: p.subject,
    crn: p.crn,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    name: p.name,
    organisationId: p.organisationId,
    organisations: p.organisations,
    roles: p.roles,
    role: p.role,
    roleLabel,
    scope,
    claims: p.claims,
    token: t.token,
    refreshToken: t.refreshToken,
    idTokenHint: t.idToken,
    authenticatedAt: new Date().toISOString(),
    currentRole: p.role,
    // Clear the transient sign-in values now the exchange is complete.
    pendingState: '',
    pendingNonce: '',
    pkceVerifier: '',
    pendingRedirectUri: '',
    pendingIdentity: p.role === 'case_officer' ? 'case_officer' : 'applicant'
  }

  return setAuthSession(request, updated)
}

// --- Route guards (Hapi `pre` handlers) ------------------------------------
// They stash the attempted URL as returnTo and send the visitor to sign in.
// `requireRole` knows the population so it goes straight to that IdP;
// `requireAuth` is role-agnostic (e.g. the account page is for either
// population) so it sends them to the neutral chooser rather than guessing.

export function requireAuth(request, h) {
  const session = getAuthSession(request)
  if (session.isAuthenticated) {
    return h.continue
  }

  const returnTo = request.url.pathname + (request.url.search || '')
  setAuthSession(request, { ...session, returnTo })
  return h.redirect(`${PAGE_PATHS.SIGN_IN}?error=auth-required`).takeover()
}

export function requireRole(requiredRole) {
  return (request, h) => {
    const session = getAuthSession(request)

    if (!session.isAuthenticated) {
      const returnTo = request.url.pathname + (request.url.search || '')
      setAuthSession(request, { ...session, returnTo })
      const signInPath =
        requiredRole === 'case_officer'
          ? PAGE_PATHS.ENTRA_SIGN_IN
          : PAGE_PATHS.DEFRA_ID_SIGN_IN
      return h.redirect(`${signInPath}?error=auth-required`).takeover()
    }

    if (session.currentRole !== requiredRole) {
      return h
        .response(
          requiredRole === 'case_officer'
            ? 'Case officer access is required for this page'
            : 'Applicant access is required for this page'
        )
        .code(statusCodes.notFound)
        .takeover()
    }

    return h.continue
  }
}

export const requireApplicant = requireRole('applicant')
export const requireCaseOfficer = requireRole('case_officer')
