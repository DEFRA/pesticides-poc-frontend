import { inflateRawSync } from 'node:zlib'

import { config } from '#/config/config.js'

import {
  buildSamlAuthnRedirect,
  getEntraSamlConfigSummary,
  isLiveMode,
  mapSamlAttributesToProfile,
  validateSamlResponse
} from './client.js'

function setLiveConfig(overrides = {}) {
  config.set('auth.entraSaml.mode', 'live')
  config.set('auth.entraSaml.idpEntityId', 'https://sts.windows.net/tid/')
  config.set(
    'auth.entraSaml.idpSsoUrl',
    'https://login.microsoftonline.com/tid/saml2'
  )
  config.set('auth.entraSaml.idpCertificate', 'MIIddummycert')
  config.set(
    'auth.entraSaml.spEntityId',
    'https://pesticides-poc-frontend.dev.cdp-int.defra.cloud/auth/entra/saml'
  )
  config.set('auth.entra.caseOfficerRoleValue', 'case_officer')
  Object.entries(overrides).forEach(([key, value]) => {
    config.set(`auth.entraSaml.${key}`, value)
  })
}

afterEach(() => {
  config.set('auth.entraSaml.mode', 'mock')
  config.set('auth.entraSaml.idpEntityId', '')
  config.set('auth.entraSaml.idpSsoUrl', '')
  config.set('auth.entraSaml.idpCertificate', '')
  config.set('auth.entraSaml.spEntityId', '')
})

describe('#getEntraSamlConfigSummary', () => {
  test('reports SAML protocol and the ACS URL in mock mode', () => {
    const summary = getEntraSamlConfigSummary('https://app.example')
    expect(summary.protocol).toBe('SAML 2.0')
    expect(summary.isLive).toBe(false)
    expect(summary.acsUrl).toBe('https://app.example/auth/entra/saml/acs')
  })

  test('flags missing required live values', () => {
    setLiveConfig({ idpSsoUrl: '', idpCertificate: '' })
    const summary = getEntraSamlConfigSummary('https://app.example')
    expect(summary.isLive).toBe(true)
    expect(summary.configured).toBe(false)
    expect(summary.missing).toEqual(
      expect.arrayContaining([
        'ENTRA_SAML_IDP_SSO_URL',
        'ENTRA_SAML_IDP_CERTIFICATE'
      ])
    )
  })
})

describe('#buildSamlAuthnRedirect', () => {
  test('builds a redirect carrying a deflated SAMLRequest + RelayState', () => {
    setLiveConfig()
    const start = buildSamlAuthnRedirect('https://app.example', {
      returnTo: '/admin/applications'
    })
    const url = new URL(start.redirectUrl)

    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/tid/saml2'
    )
    expect(url.searchParams.get('RelayState')).toBe('/admin/applications')

    // The SAMLRequest inflates back to an AuthnRequest naming our SP + ACS.
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest'), 'base64')
    ).toString('utf8')
    expect(xml).toContain('AuthnRequest')
    expect(xml).toContain(
      '<saml:Issuer>https://pesticides-poc-frontend.dev.cdp-int.defra.cloud/auth/entra/saml</saml:Issuer>'
    )
    expect(xml).toContain(
      'AssertionConsumerServiceURL="https://app.example/auth/entra/saml/acs"'
    )
  })

  test('throws 422 when live config is incomplete', () => {
    setLiveConfig({ spEntityId: '' })
    expect(() => buildSamlAuthnRedirect('https://app.example')).toThrow(
      /configuration is incomplete/
    )
  })
})

describe('#mapSamlAttributesToProfile', () => {
  const samlConfig = { caseOfficerValue: 'case_officer' }

  test('maps NameID/email and grants the case-officer role from the assertion', () => {
    const profile = mapSamlAttributesToProfile(
      {
        subject: 'urn:entra:co-1',
        email: 'co@defra.gov.uk',
        firstName: 'Casey',
        lastName: 'Officer',
        roles: ['case_officer']
      },
      samlConfig
    )
    expect(profile.subject).toBe('urn:entra:co-1')
    expect(profile.email).toBe('co@defra.gov.uk')
    expect(profile.role).toBe('case_officer')
    expect(profile.hasCaseOfficerRole).toBe(true)
  })

  test('does not assign the case-officer role when the attribute is absent', () => {
    const profile = mapSamlAttributesToProfile(
      { subject: 'urn:entra:staff-2', roles: ['other'] },
      samlConfig
    )
    expect(profile.hasCaseOfficerRole).toBe(false)
    expect(profile.role).toBe('')
  })

  test('tolerates the standard SAML claim URIs', () => {
    const profile = mapSamlAttributesToProfile(
      {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier':
          'urn:entra:co-3',
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/role':
          'case_officer'
      },
      samlConfig
    )
    expect(profile.subject).toBe('urn:entra:co-3')
    expect(profile.role).toBe('case_officer')
  })

  test('throws 422 when the subject (NameID) is missing', () => {
    expect(() =>
      mapSamlAttributesToProfile({ email: 'x@y.z' }, samlConfig)
    ).toThrow(/NameID/)
  })
})

describe('#validateSamlResponse (real node-saml, fails closed)', () => {
  test('throws 422 when live config is incomplete', async () => {
    config.set('auth.entraSaml.mode', 'live') // required IdP fields left blank
    await expect(
      validateSamlResponse('anything', { baseUrl: 'https://app.example' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  test('throws 422 when the SAMLResponse is missing', async () => {
    setLiveConfig()
    await expect(
      validateSamlResponse('', { baseUrl: 'https://app.example' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  test('rejects an invalid/unsigned SAMLResponse with 422', async () => {
    setLiveConfig()
    const junk = Buffer.from('<samlp:Response/>').toString('base64')
    await expect(
      validateSamlResponse(junk, { baseUrl: 'https://app.example' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('#isLiveMode', () => {
  test('reflects the configured mode', () => {
    config.set('auth.entraSaml.mode', 'live')
    expect(isLiveMode()).toBe(true)
    config.set('auth.entraSaml.mode', 'mock')
    expect(isLiveMode()).toBe(false)
  })
})
