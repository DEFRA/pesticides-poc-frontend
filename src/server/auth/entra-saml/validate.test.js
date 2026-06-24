// validateSamlResponse wrapper logic, with @node-saml/node-saml mocked so we test
// OUR integration (option-building, profile -> attributes bridging, error -> 422)
// without re-testing node-saml's vetted crypto. The real fail-closed behaviour on
// invalid input is covered by client.test.js against the actual library.
import { config } from '#/config/config.js'

const { validatePostResponseAsync } = vi.hoisted(() => ({
  validatePostResponseAsync: vi.fn()
}))

vi.mock('@node-saml/node-saml', () => ({
  ValidateInResponseTo: {
    never: 'never',
    ifPresent: 'ifPresent',
    always: 'always'
  },
  // A constructable stub whose method delegates to the hoisted spy.
  SAML: class {
    validatePostResponseAsync(container) {
      return validatePostResponseAsync(container)
    }
  }
}))

const { validateSamlResponse, mapSamlAttributesToProfile } =
  await import('./client.js')

const ROLE_CLAIM =
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'

beforeEach(() => {
  config.set('auth.entraSaml.mode', 'live')
  config.set('auth.entraSaml.idpEntityId', 'https://sts.windows.net/tid/')
  config.set(
    'auth.entraSaml.idpSsoUrl',
    'https://login.microsoftonline.com/tid/saml2'
  )
  config.set('auth.entraSaml.idpCertificate', 'MIIddummycert')
  config.set('auth.entraSaml.spEntityId', 'https://app.example/auth/entra/saml')
  validatePostResponseAsync.mockReset()
})

afterEach(() => {
  config.set('auth.entraSaml.mode', 'mock')
  config.set('auth.entraSaml.idpEntityId', '')
  config.set('auth.entraSaml.idpSsoUrl', '')
  config.set('auth.entraSaml.idpCertificate', '')
  config.set('auth.entraSaml.spEntityId', '')
})

describe('#validateSamlResponse (node-saml mocked)', () => {
  test('returns the assertion attributes (NameID + claims) on a valid response', async () => {
    validatePostResponseAsync.mockResolvedValue({
      profile: { nameID: 'urn:entra:co-1', [ROLE_CLAIM]: 'case_officer' }
    })

    const attributes = await validateSamlResponse('base64-saml', {
      baseUrl: 'https://app.example'
    })

    expect(attributes.nameId).toBe('urn:entra:co-1')
    // And those attributes map to an authorised case officer.
    const profile = mapSamlAttributesToProfile(attributes, {
      caseOfficerValue: 'case_officer'
    })
    expect(profile.subject).toBe('urn:entra:co-1')
    expect(profile.role).toBe('case_officer')
  })

  test('maps a node-saml validation error to a 422', async () => {
    validatePostResponseAsync.mockRejectedValue(new Error('Invalid signature'))
    await expect(
      validateSamlResponse('base64-saml', { baseUrl: 'https://app.example' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  test('throws 422 when node-saml returns no profile', async () => {
    validatePostResponseAsync.mockResolvedValue({ profile: null })
    await expect(
      validateSamlResponse('base64-saml', { baseUrl: 'https://app.example' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
