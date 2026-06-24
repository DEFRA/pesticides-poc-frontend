// Microsoft Entra ID SAML 2.0 client — INTERNAL case officers / staff (EQ-257).
//
// SCAFFOLD. Entra is the IdP, this app is the SP. SP-initiated flow: redirect to
// Entra's SAML SSO URL with a SAMLRequest, receive a signed SAMLResponse (assertion)
// POSTed back to the ACS endpoint, validate it, and map its attributes to the staff
// profile. SAML config lives on the Entra Enterprise Application (see
// docs/auth/EQ-257-entra-saml-ticket.md).
//
// Framework-agnostic: node:crypto + node:zlib only; the Hapi layer passes a `baseUrl`.
// IMPLEMENTED here: config + summary, the SP-initiated AuthnRequest redirect, and the
// attribute -> profile mapping (with case-officer role enforcement).
// NOT YET IMPLEMENTED (live seam — blocked on CCoE's IdP signing cert + a vetted SAML
// library decision): cryptographic validation of the SAMLResponse assertion
// (XML signature against the IdP cert, audience, conditions, InResponseTo). See
// `validateSamlResponse`.

import { randomUUID } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

import { config } from '#/config/config.js'

import {
  HTTP_UNPROCESSABLE_ENTITY,
  buildDisplayName,
  createHttpError,
  firstNonEmpty,
  resolveUrl,
  toStringArray
} from '../oidc-common.js'

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

// LIVE SEAM — NOT YET IMPLEMENTED.
// Validating a SAMLResponse means: verify the XML signature on the assertion against
// the IdP signing certificate (samlConfig.idpCertificate), then check audience
// (= spEntityId), conditions (NotBefore/NotOnOrAfter), and InResponseTo. XML-DSig
// canonicalisation is error-prone to hand-roll, so this should use a vetted SAML
// library (e.g. @node-saml/node-saml) once CCoE provide the IdP metadata/cert.
// Until then the live path fails closed.
export function validateSamlResponse() {
  throw createHttpError(
    HTTP_UNPROCESSABLE_ENTITY,
    'Microsoft Entra SAML live assertion validation is not yet implemented ' +
      '(pending CCoE IdP metadata/signing certificate and the SAML library ' +
      'integration). See docs/auth/EQ-257-entra-saml-ticket.md.'
  )
}

export function buildSamlSignOutUrl(baseUrl) {
  const samlConfig = getEntraSamlConfig()
  return resolveUrl(baseUrl, samlConfig.signOutRedirectUri) || '/'
}

export function isLiveMode() {
  return getEntraSamlConfig().mode === 'live'
}
