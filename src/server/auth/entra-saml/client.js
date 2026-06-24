// Microsoft Entra ID SAML 2.0 client — INTERNAL case officers / staff (EQ-257).
//
// SCAFFOLD. Entra is the IdP, this app is the SP. SP-initiated flow: redirect to
// Entra's SAML SSO URL with a SAMLRequest, receive a signed SAMLResponse (assertion)
// POSTed back to the ACS endpoint, validate it, and map its attributes to the staff
// profile. SAML config lives on the Entra Enterprise Application (see
// docs/auth/EQ-257-entra-saml-ticket.md).
//
// The Hapi layer passes a `baseUrl`. Implemented here: config + summary, the
// SP-initiated AuthnRequest redirect, assertion validation via @node-saml/node-saml
// (signature against the IdP cert, audience, conditions), and the attribute ->
// profile mapping (with case-officer role enforcement). The remaining live work is
// configuration only: CCoE provide the real IdP cert/SSO URL/entityID, then the
// one-off smoke test (see docs/auth/EQ-257-entra-saml-ticket.md).

import { randomUUID } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

import { SAML, ValidateInResponseTo } from '@node-saml/node-saml'

import { config } from '#/config/config.js'

import {
  HTTP_UNPROCESSABLE_ENTITY,
  buildDisplayName,
  createHttpError,
  firstNonEmpty,
  resolveUrl,
  toStringArray
} from '../oidc-common.js'

// Tolerated clock skew when validating assertion time conditions.
const SAML_CLOCK_SKEW_MS = 60000

// Standard Entra/ADFS SAML attribute claim URIs, tolerated alongside friendly keys.
const SAML_CLAIM = {
  nameId:
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  upn: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
  givenName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  surname: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  roles: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'
}

// Shape the convict `auth.entraSaml` block into the fields this client expects.
// The public base URL and case-officer role value are shared with the OIDC config.
export function getEntraSamlConfig() {
  const raw = config.get('auth.entraSaml')
  const entra = config.get('auth.entra')

  return {
    mode: raw.mode,
    idpEntityId: raw.idpEntityId,
    idpSsoUrl: raw.idpSsoUrl,
    idpCertificate: raw.idpCertificate,
    spEntityId: raw.spEntityId,
    acsPath: raw.acsPath,
    signOutRedirectUri: raw.signOutRedirectUrl,
    publicBaseUrl: entra.publicBaseUrl,
    caseOfficerValue: entra.caseOfficerRoleValue
  }
}

function getMissingLiveConfig(samlConfig) {
  const required = {
    ENTRA_SAML_IDP_ENTITY_ID: samlConfig.idpEntityId,
    ENTRA_SAML_IDP_SSO_URL: samlConfig.idpSsoUrl,
    ENTRA_SAML_IDP_CERTIFICATE: samlConfig.idpCertificate,
    ENTRA_SAML_SP_ENTITY_ID: samlConfig.spEntityId
  }
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)
}

export function getEntraSamlConfigSummary(baseUrl) {
  const samlConfig = getEntraSamlConfig()
  const missing =
    samlConfig.mode === 'live' ? getMissingLiveConfig(samlConfig) : []

  return {
    mode: samlConfig.mode,
    isLive: samlConfig.mode === 'live',
    configured: missing.length === 0,
    missing,
    protocol: 'SAML 2.0',
    idpEntityId: samlConfig.idpEntityId,
    spEntityId: samlConfig.spEntityId,
    acsUrl: resolveUrl(baseUrl, samlConfig.acsPath)
  }
}

// Build the SP-initiated SAML AuthnRequest redirect (HTTP-Redirect binding):
// a deflated + base64 SAMLRequest plus RelayState (the returnTo), sent to the IdP.
export function buildSamlAuthnRedirect(baseUrl, options = {}) {
  const samlConfig = getEntraSamlConfig()
  const missing = getMissingLiveConfig(samlConfig)

  if (missing.length) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `Microsoft Entra SAML live configuration is incomplete: ${missing.join(', ')}`,
      missing.map((key) => ({ field: key, message: `${key} is required` }))
    )
  }

  const requestId = `_${randomUUID()}`
  const issueInstant = new Date().toISOString()
  const acsUrl = resolveUrl(baseUrl, samlConfig.acsPath)
  const returnTo = options.returnTo || '/admin/applications'

  const authnRequestXml =
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}" ` +
    `ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ` +
    `AssertionConsumerServiceURL="${acsUrl}" Destination="${samlConfig.idpSsoUrl}">` +
    `<saml:Issuer>${samlConfig.spEntityId}</saml:Issuer>` +
    `</samlp:AuthnRequest>`

  // HTTP-Redirect binding: DEFLATE (raw) -> base64 -> URL-encode.
  const samlRequest = deflateRawSync(Buffer.from(authnRequestXml)).toString(
    'base64'
  )
  const search = new URLSearchParams({
    SAMLRequest: samlRequest,
    RelayState: returnTo
  })

  return {
    mode: 'live',
    requestId,
    returnTo,
    redirectUrl: `${samlConfig.idpSsoUrl}?${search.toString()}`
  }
}

function readSamlAttribute(attributes, friendlyKey, claimUri) {
  const value = firstNonEmpty(attributes[friendlyKey], attributes[claimUri])
  return value
}

// Map SAML assertion attributes to the staff profile shape (mirrors the OIDC
// mapEntraClaimsToProfile, including case-officer role enforcement). Accepts either
// friendly keys (subject/email/firstName/...) or the standard SAML claim URIs.
export function mapSamlAttributesToProfile(attributes = {}, samlConfig) {
  const subject = firstNonEmpty(
    attributes.subject,
    attributes.nameId,
    attributes[SAML_CLAIM.nameId]
  )
  if (!subject) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'No subject (NameID) found in Microsoft Entra SAML assertion'
    )
  }

  const firstName = readSamlAttribute(
    attributes,
    'firstName',
    SAML_CLAIM.givenName
  )
  const lastName = readSamlAttribute(attributes, 'lastName', SAML_CLAIM.surname)
  const roles = toStringArray(
    attributes.roles || attributes[SAML_CLAIM.roles] || []
  )
  const caseOfficerValue = String(
    samlConfig?.caseOfficerValue ||
      getEntraSamlConfig().caseOfficerValue ||
      'case_officer'
  )
  const hasCaseOfficerRole = roles.some(
    (value) => value.toLowerCase() === caseOfficerValue.toLowerCase()
  )

  return {
    subject,
    email: firstNonEmpty(
      attributes.email,
      attributes[SAML_CLAIM.email],
      attributes[SAML_CLAIM.upn]
    ),
    firstName,
    lastName,
    name: buildDisplayName(
      firstName,
      lastName,
      readSamlAttribute(attributes, 'name', SAML_CLAIM.name)
    ),
    roles,
    // Only grant the case-officer role when the assertion actually carries it —
    // never unconditionally, or any authenticated staff user would pass the guard.
    role: hasCaseOfficerRole ? 'case_officer' : '',
    hasCaseOfficerRole,
    attributes
  }
}

// Build a node-saml SAML instance from our config (the SP side of the trust).
function buildSamlInstance(samlConfig, baseUrl) {
  return new SAML({
    // Trust anchor: verify the assertion signature against the IdP's cert.
    idpCert: samlConfig.idpCertificate,
    idpIssuer: samlConfig.idpEntityId,
    // Our SP identity + where the IdP posts the response back.
    issuer: samlConfig.spEntityId,
    callbackUrl: resolveUrl(baseUrl, samlConfig.acsPath),
    // Validate the assertion is addressed to us.
    audience: samlConfig.spEntityId,
    // Entra signs the assertion by default; confirm against the live tenant
    // config whether the response is also signed and tighten if so.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // POC: no InResponseTo cache yet (would need a shared store, e.g. catbox).
    // Production follow-up: bind the response to our AuthnRequest id.
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: SAML_CLOCK_SKEW_MS
  })
}

// Verify a SAMLResponse end-to-end via node-saml (XML signature against the IdP
// cert, audience, conditions/timestamps), then return the assertion attributes for
// mapping. Fails closed (HTTP 422) on any validation error or incomplete config.
export async function validateSamlResponse(samlResponseB64, options = {}) {
  const samlConfig = getEntraSamlConfig()
  const missing = getMissingLiveConfig(samlConfig)
  if (missing.length) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `Microsoft Entra SAML live configuration is incomplete: ${missing.join(', ')}`,
      missing.map((key) => ({ field: key, message: `${key} is required` }))
    )
  }
  if (!samlResponseB64) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Missing SAMLResponse in Microsoft Entra SAML callback'
    )
  }

  let profile
  try {
    const saml = buildSamlInstance(samlConfig, options.baseUrl)
    const result = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponseB64
    })
    profile = result?.profile
  } catch (error) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      `Microsoft Entra SAML assertion validation failed: ${error.message}`
    )
  }

  if (!profile) {
    throw createHttpError(
      HTTP_UNPROCESSABLE_ENTITY,
      'Microsoft Entra SAML response contained no assertion profile'
    )
  }

  // node-saml flattens attributes (keyed by claim name/URI) onto the profile and
  // exposes the NameID separately; surface both for mapSamlAttributesToProfile.
  return { nameId: profile.nameID, ...profile }
}

export function buildSamlSignOutUrl(baseUrl) {
  const samlConfig = getEntraSamlConfig()
  return resolveUrl(baseUrl, samlConfig.signOutRedirectUri) || '/'
}

export function isLiveMode() {
  return getEntraSamlConfig().mode === 'live'
}
