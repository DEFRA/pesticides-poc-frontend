// Microsoft Entra ID SAML 2.0 sign-in orchestration — INTERNAL case officers (EQ-257).
//
// SCAFFOLD mirroring entra/service.js but for the SAML SP flow. Dispatches mock vs
// live over the framework-agnostic ./client.js. Mock mode completes locally so demos
// keep working; live mode is wired but its assertion validation is the documented
// follow-up (see ./client.js validateSamlResponse). Staff have no external-org context.

import { config } from '#/config/config.js'

import {
  getEntraSamlConfigSummary,
  buildSamlAuthnRedirect,
  validateSamlResponse,
  mapSamlAttributesToProfile,
  getEntraSamlConfig,
  buildSamlSignOutUrl
} from './client.js'
import { buildMockEntraIdentity } from '../mock-identities.js'
import { HTTP_UNPROCESSABLE_ENTITY } from '../oidc-common.js'
import {
  ENTRA_PROVIDER,
  PAGE_PATHS,
  applyProfile,
  clearAuthSession,
  createAuthError,
  getAuthSession,
  resolveBaseUrl,
  setAuthSession
} from '../session.js'

function baseUrlFor(request) {
  // Reuses the Entra public base URL (shared by the OIDC + SAML staff flows).
  return resolveBaseUrl(request, config.get('auth.entra.publicBaseUrl'))
}

export function getEntraSamlSummary(request) {
  return getEntraSamlConfigSummary(baseUrlFor(request))
}

export function startEntraSamlSignIn(request, options = {}) {
  const summary = getEntraSamlSummary(request)
  const session = getAuthSession(request)
  session.returnTo =
    options.returnTo || session.returnTo || PAGE_PATHS.ADMIN_APPLICATIONS

  if (!summary.isLive) {
    // Mock: skip the IdP round trip and bounce straight to our ACS with a marker.
    session.pendingState = `mock-entra-saml-${Date.now()}`
    session.pendingIdentity = 'case_officer'
    session.mode = 'mock'
    setAuthSession(request, session)

    const acsPath = getEntraSamlConfig().acsPath
    return {
      mode: 'mock',
      redirectUrl: `${acsPath}?saml=mock&state=${session.pendingState}`
    }
  }

  const start = buildSamlAuthnRedirect(baseUrlFor(request), {
    returnTo: session.returnTo
  })

  session.pendingState = start.requestId
  session.pendingIdentity = 'case_officer'
  session.mode = 'live'
  setAuthSession(request, session)

  return { mode: 'live', redirectUrl: start.redirectUrl }
}

export async function completeEntraSamlAcs(request, params = {}) {
  const summary = getEntraSamlSummary(request)
  const session = getAuthSession(request)

  if (!summary.isLive) {
    if (
      !params.state ||
      !session.pendingState ||
      params.state !== session.pendingState
    ) {
      throw createAuthError(
        HTTP_UNPROCESSABLE_ENTITY,
        'Unable to verify Microsoft Entra SAML sign-in state'
      )
    }

    const mockProfile = buildMockEntraIdentity()
    await applyProfile(request, {
      provider: ENTRA_PROVIDER,
      profile: mockProfile,
      mode: 'mock'
    })
    return {
      returnTo: session.returnTo || PAGE_PATHS.ADMIN_APPLICATIONS,
      profile: mockProfile
    }
  }

  // Live: verify the SAMLResponse assertion (node-saml), then map its attributes.
  const attributes = await validateSamlResponse(params.SAMLResponse, {
    baseUrl: baseUrlFor(request)
  })
  const profile = mapSamlAttributesToProfile(attributes, getEntraSamlConfig())

  await applyProfile(request, {
    provider: ENTRA_PROVIDER,
    profile,
    mode: 'live'
  })
  return {
    returnTo:
      params.RelayState || session.returnTo || PAGE_PATHS.ADMIN_APPLICATIONS,
    profile
  }
}

export async function signOutEntraSaml(request) {
  const signOutUrl = buildSamlSignOutUrl(baseUrlFor(request))
  clearAuthSession(request)
  return signOutUrl
}
