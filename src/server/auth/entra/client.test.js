import { config } from '#/config/config.js'

import {
  buildEntraSignOutUrl,
  completeLiveEntra,
  getEntraConfigSummary,
  getEntraIdConfig,
  isLiveMode,
  mapEntraClaimsToProfile,
  startLiveEntra
} from './client.js'
import {
  generateTestKeyPair,
  idTokenClaims,
  signIdToken
} from '#/test-helpers/oidc-test-keys.js'

const ISSUER = 'https://login.microsoftonline.com/tid/v2.0'
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint:
    'https://login.microsoftonline.com/tid/oauth2/v2.0/authorize',
  token_endpoint: 'https://login.microsoftonline.com/tid/oauth2/v2.0/token',
  jwks_uri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
  end_session_endpoint:
    'https://login.microsoftonline.com/tid/oauth2/v2.0/logout'
}

const keyPair = generateTestKeyPair('entra-kid-1')

function signedIdToken(claims) {
  return signIdToken(
    idTokenClaims({ iss: ISSUER, aud: 'entra-client', ...claims }),
    keyPair
  )
}

function stubFetch(routes) {
  return vi.fn(async (url) => {
    const key = Object.keys(routes).find((part) => String(url).includes(part))
    const route = key
      ? routes[key]
      : { ok: false, status: 404, body: { error: 'not_found' } }
    return {
      ok: route.ok !== false,
      status: route.status || 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(route.body ?? {})
    }
  })
}

function setLiveConfig(overrides = {}) {
  config.set('auth.entra.mode', 'live')
  config.set('auth.entra.tenantId', 'tid')
  config.set('auth.entra.clientId', 'entra-client')
  config.set('auth.entra.clientSecret', 'entra-secret')
  config.set('auth.entra.signOutRedirectUrl', 'https://app.example/bye')
  config.set('auth.entra.caseOfficerRoleValue', 'case_officer')
  Object.entries(overrides).forEach(([key, value]) => {
    config.set(`auth.entra.${key}`, value)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  config.set('auth.entra.mode', 'mock')
})

describe('#getEntraIdConfig', () => {
  test('derives the tenant authority and discovery URL', () => {
    setLiveConfig()
    const entraConfig = getEntraIdConfig()
    expect(entraConfig.authority).toBe(
      'https://login.microsoftonline.com/tid/v2.0'
    )
    expect(entraConfig.wellKnownUrl).toContain(
      '/.well-known/openid-configuration'
    )
  })
})

describe('#getEntraConfigSummary', () => {
  test('reports missing required live values', () => {
    setLiveConfig({ tenantId: '', clientSecret: '' })
    const summary = getEntraConfigSummary('https://app.example')
    expect(summary.isLive).toBe(true)
    expect(summary.missing).toEqual(
      expect.arrayContaining(['ENTRA_TENANT_ID', 'ENTRA_CLIENT_SECRET'])
    )
  })
})

describe('#startLiveEntra', () => {
  test('builds an authorize URL with PKCE', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const start = await startLiveEntra('https://app.example', {
      returnTo: '/admin/applications'
    })
    const url = new URL(start.authorizationUrl)

    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/tid/oauth2/v2.0/authorize'
    )
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(start.state).toBeTruthy()
    expect(start.returnTo).toBe('/admin/applications')
  })

  test('throws 422 when the tenant is not configured', async () => {
    setLiveConfig({ tenantId: '' })
    await expect(startLiveEntra('https://app.example')).rejects.toMatchObject({
      statusCode: 422
    })
  })
})

describe('#mapEntraClaimsToProfile', () => {
  const entraConfig = { roles: { caseOfficerValue: 'case_officer' } }

  test('maps oid/preferred_username and flags the case-officer role', () => {
    const profile = mapEntraClaimsToProfile(
      {
        oid: 'oid-1',
        preferred_username: 'co@defra.gov.uk',
        given_name: 'Casey',
        family_name: 'Officer',
        roles: ['case_officer'],
        sid: 's1'
      },
      entraConfig
    )

    expect(profile.subject).toBe('oid-1')
    expect(profile.email).toBe('co@defra.gov.uk')
    expect(profile.role).toBe('case_officer')
    expect(profile.hasCaseOfficerRole).toBe(true)
  })

  test('does not flag or assign the case-officer role when absent', () => {
    const profile = mapEntraClaimsToProfile(
      { sub: 's', roles: ['other'] },
      entraConfig
    )
    expect(profile.hasCaseOfficerRole).toBe(false)
    // Role must NOT be assigned without the claim, or the user would pass the
    // case-officer guard on /admin/*.
    expect(profile.role).toBe('')
  })

  test('throws 422 when the subject claim is missing', () => {
    expect(() => mapEntraClaimsToProfile({}, entraConfig)).toThrow(
      /subject claim/
    )
  })
})

describe('#completeLiveEntra', () => {
  test('exchanges the code, verifies the ID token, and maps the staff profile', async () => {
    setLiveConfig()
    const idToken = signedIdToken({
      oid: 'oid-1',
      preferred_username: 'co@defra.gov.uk',
      given_name: 'Casey',
      family_name: 'Officer',
      roles: ['case_officer'],
      nonce: 'N1'
    })
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/v2.0/token': {
          body: { id_token: idToken, token_type: 'Bearer', expires_in: 3600 }
        },
        '/keys': { body: { keys: [keyPair.publicJwk] } }
      })
    )

    const result = await completeLiveEntra(
      { code: 'code-1', state: 'st-1' },
      {
        state: 'st-1',
        nonce: 'N1',
        pkceVerifier: 'verifier',
        redirectUri: 'https://app.example/auth/entra/callback',
        returnTo: '/admin/applications'
      }
    )

    expect(result.profile.subject).toBe('oid-1')
    expect(result.profile.role).toBe('case_officer')
    expect(result.returnTo).toBe('/admin/applications')
  })

  test('rejects a mismatched state', async () => {
    setLiveConfig()
    await expect(
      completeLiveEntra({ code: 'c', state: 'bad' }, { state: 'good' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('#completeLiveEntra (token validation)', () => {
  test('rejects a token that omits the nonce claim', async () => {
    setLiveConfig()
    const idToken = signedIdToken({ oid: 'oid-1', roles: ['case_officer'] }) // no nonce
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/v2.0/token': { body: { id_token: idToken } },
        '/keys': { body: { keys: [keyPair.publicJwk] } }
      })
    )
    await expect(
      completeLiveEntra(
        { code: 'c', state: 'st' },
        { state: 'st', nonce: 'EXPECTED', redirectUri: 'https://app/cb' }
      )
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  test('rejects an expired token', async () => {
    setLiveConfig()
    const idToken = signedIdToken({
      oid: 'oid-1',
      roles: ['case_officer'],
      nonce: 'N1',
      exp: Math.floor(Date.now() / 1000) - 120 // already expired (beyond clock skew)
    })
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/v2.0/token': { body: { id_token: idToken } },
        '/keys': { body: { keys: [keyPair.publicJwk] } }
      })
    )
    await expect(
      completeLiveEntra(
        { code: 'c', state: 'st' },
        { state: 'st', nonce: 'N1', redirectUri: 'https://app/cb' }
      )
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('#buildEntraSignOutUrl', () => {
  test('includes the post-logout redirect and id_token_hint', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const url = await buildEntraSignOutUrl('https://app.example', 'token-hint')
    expect(url).toContain('/logout')
    expect(url).toContain('id_token_hint=token-hint')
  })

  test('returns empty string in mock mode', async () => {
    config.set('auth.entra.mode', 'mock')
    expect(await buildEntraSignOutUrl('https://app.example', 'hint')).toBe('')
  })

  test('returns empty string when the tenant has no end-session endpoint', async () => {
    setLiveConfig()
    // Use a distinct tenant so the discovery document isn't served from the
    // module-level cache populated by earlier tests in this file.
    config.set('auth.entra.tenantId', 'tid-no-logout')
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': {
          body: {
            authorization_endpoint: DISCOVERY.authorization_endpoint,
            token_endpoint: DISCOVERY.token_endpoint
          }
        }
      })
    )
    expect(await buildEntraSignOutUrl('https://app.example', 'hint')).toBe('')
  })
})

describe('#completeLiveEntra (errors)', () => {
  test('rejects a missing code', async () => {
    setLiveConfig()
    await expect(
      completeLiveEntra({ state: 'st' }, { state: 'st' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('#mapEntraClaimsToProfile (single-value roles)', () => {
  test('coerces a string roles claim into an array', () => {
    const profile = mapEntraClaimsToProfile(
      { oid: 'oid-1', roles: 'case_officer' },
      { roles: { caseOfficerValue: 'case_officer' } }
    )
    expect(profile.roles).toEqual(['case_officer'])
    expect(profile.hasCaseOfficerRole).toBe(true)
  })
})

describe('#isLiveMode', () => {
  test('reflects the configured mode', () => {
    config.set('auth.entra.mode', 'live')
    expect(isLiveMode()).toBe(true)
    config.set('auth.entra.mode', 'mock')
    expect(isLiveMode()).toBe(false)
  })
})
