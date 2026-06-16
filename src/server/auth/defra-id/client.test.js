import { config } from '#/config/config.js'

import {
  buildDefraIdSignOutUrl,
  completeLiveDefraId,
  getDefraIdConfig,
  getDefraIdConfigSummary,
  mapDefraIdClaimsToProfile,
  startLiveDefraId
} from './client.js'

const WELL_KNOWN = 'https://b2c.example.com/te/.well-known/openid-configuration'
const DISCOVERY = {
  authorization_endpoint: 'https://b2c.example.com/authorize',
  token_endpoint: 'https://b2c.example.com/oauth/token',
  end_session_endpoint: 'https://b2c.example.com/logout'
}

// Build an unsigned JWT (the client decodes the payload; JWKS verification is a
// documented follow-up so the signature is not checked).
function jwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`
}

// Route fetch by URL substring so discovery + token endpoints can be stubbed together.
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
  config.set('auth.defraId.mode', 'live')
  config.set('auth.defraId.wellKnownUrl', WELL_KNOWN)
  config.set('auth.defraId.clientId', 'client-123')
  config.set('auth.defraId.clientSecret', 'secret-xyz')
  config.set('auth.defraId.serviceId', 'svc-1')
  config.set('auth.defraId.policy', 'b2c_1a_signin')
  config.set('auth.defraId.signOutRedirectUrl', 'https://app.example/bye')
  Object.entries(overrides).forEach(([key, value]) => {
    config.set(`auth.defraId.${key}`, value)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  config.set('auth.defraId.mode', 'mock')
})

describe('#getDefraIdConfig', () => {
  test('adds the client id as an additional scope', () => {
    setLiveConfig()
    expect(getDefraIdConfig().scopes).toEqual([
      'openid',
      'offline_access',
      'client-123'
    ])
  })
})

describe('#getDefraIdConfigSummary', () => {
  test('reports missing required live values', () => {
    setLiveConfig({ clientId: '', serviceId: '' })
    const summary = getDefraIdConfigSummary('https://app.example')
    expect(summary.isLive).toBe(true)
    expect(summary.configured).toBe(false)
    expect(summary.missing).toEqual(
      expect.arrayContaining(['DEFRA_ID_CLIENT_ID', 'DEFRA_ID_SERVICE_ID'])
    )
  })

  test('is configured when all live values are present', () => {
    setLiveConfig()
    const summary = getDefraIdConfigSummary('https://app.example')
    expect(summary.configured).toBe(true)
    expect(summary.redirectUri).toBe(
      'https://app.example/auth/defra-id/callback'
    )
  })
})

describe('#startLiveDefraId', () => {
  test('builds an authorize URL with Defra params + PKCE', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const start = await startLiveDefraId('https://app.example', {
      returnTo: '/register/type'
    })
    const url = new URL(start.authorizationUrl)

    expect(url.origin + url.pathname).toBe('https://b2c.example.com/authorize')
    expect(url.searchParams.get('serviceId')).toBe('svc-1')
    expect(url.searchParams.get('p')).toBe('b2c_1a_signin')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(start.state).toBeTruthy()
    expect(start.nonce).toBeTruthy()
    expect(start.pkceVerifier).toBeTruthy()
    expect(start.returnTo).toBe('/register/type')
  })

  test('passes org re-selection options through', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const start = await startLiveDefraId('https://app.example', {
      forceReselection: true,
      relationshipId: 'rel-9',
      loginHint: 'a@b.com'
    })
    const url = new URL(start.authorizationUrl)
    expect(url.searchParams.get('forceReselection')).toBe('true')
    expect(url.searchParams.get('relationshipId')).toBe('rel-9')
    expect(url.searchParams.get('login_hint')).toBe('a@b.com')
  })

  test('throws 422 when live config is incomplete', async () => {
    setLiveConfig({ serviceId: '' })
    await expect(startLiveDefraId('https://app.example')).rejects.toMatchObject(
      {
        statusCode: 422
      }
    )
  })
})

describe('#mapDefraIdClaimsToProfile', () => {
  test('maps relationships (colon strings) and currentRelationshipId', () => {
    const profile = mapDefraIdClaimsToProfile({
      sub: 'p1',
      email: 'alex@example.com',
      firstName: 'Alex',
      lastName: 'Grower',
      contactId: 'c1',
      currentRelationshipId: 'rel-1',
      relationships: ['rel-1:org-1:Org One:::', 'rel-2:org-2:Org Two:::'],
      roles: 'applicant',
      sid: 's1'
    })

    expect(profile.subject).toBe('p1')
    expect(profile.organisationId).toBe('rel-1')
    expect(profile.organisations).toHaveLength(2)
    expect(profile.organisations[0].organisationName).toBe('Org One')
    expect(profile.roles).toEqual(['applicant'])
    expect(profile.role).toBe('applicant')
  })

  test('tolerates object-form relationships', () => {
    const profile = mapDefraIdClaimsToProfile({
      sub: 'p2',
      relationships: [
        { relationshipId: 'r9', organisationId: 'o9', organisationName: 'Nine' }
      ]
    })
    expect(profile.organisations[0]).toMatchObject({
      relationshipId: 'r9',
      organisationName: 'Nine'
    })
  })

  test('throws 422 when the subject claim is missing', () => {
    expect(() => mapDefraIdClaimsToProfile({})).toThrow(/subject claim/)
  })

  test('honours configured DEFRA_ID_CLAIM_* names', () => {
    config.set('auth.defraId.claims.sub', 'oid')
    config.set('auth.defraId.claims.currentRelationshipId', 'orgId')
    config.set('auth.defraId.claims.relationships', 'orgs')

    const profile = mapDefraIdClaimsToProfile({
      oid: 'subject-from-oid',
      orgId: 'rel-7',
      orgs: ['rel-7:org-7:Org Seven:::']
    })

    expect(profile.subject).toBe('subject-from-oid')
    expect(profile.organisationId).toBe('rel-7')
    expect(profile.organisations[0].organisationName).toBe('Org Seven')

    config.set('auth.defraId.claims.sub', 'sub')
    config.set(
      'auth.defraId.claims.currentRelationshipId',
      'currentRelationshipId'
    )
    config.set('auth.defraId.claims.relationships', 'relationships')
  })
})

describe('#completeLiveDefraId', () => {
  test('exchanges the code and returns the mapped profile', async () => {
    setLiveConfig()
    const idToken = jwt({
      sub: 'p1',
      email: 'alex@example.com',
      firstName: 'Alex',
      lastName: 'Grower',
      currentRelationshipId: 'rel-1',
      relationships: ['rel-1:org-1:Org One:::'],
      nonce: 'N1'
    })
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/oauth/token': {
          body: {
            id_token: idToken,
            access_token: 'at',
            token_type: 'Bearer',
            expires_in: 3600
          }
        }
      })
    )

    const result = await completeLiveDefraId(
      { code: 'code-1', state: 'st-1' },
      {
        state: 'st-1',
        nonce: 'N1',
        pkceVerifier: 'verifier',
        redirectUri: 'https://app.example/auth/defra-id/callback',
        returnTo: '/register/type'
      }
    )

    expect(result.profile.subject).toBe('p1')
    expect(result.profile.organisations[0].organisationName).toBe('Org One')
    expect(result.returnTo).toBe('/register/type')
  })

  test('rejects a mismatched state', async () => {
    setLiveConfig()
    await expect(
      completeLiveDefraId({ code: 'c', state: 'bad' }, { state: 'good' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  test('rejects a missing code', async () => {
    setLiveConfig()
    await expect(
      completeLiveDefraId({ state: 'st' }, { state: 'st' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  test('rejects a mismatched nonce', async () => {
    setLiveConfig()
    const idToken = jwt({ sub: 'p1', nonce: 'WRONG' })
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/oauth/token': { body: { id_token: idToken } }
      })
    )
    await expect(
      completeLiveDefraId(
        { code: 'c', state: 'st' },
        { state: 'st', nonce: 'EXPECTED', redirectUri: 'https://app/cb' }
      )
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('#buildDefraIdSignOutUrl', () => {
  test('includes the post-logout redirect and id_token_hint', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const url = await buildDefraIdSignOutUrl(
      'https://app.example',
      'token-hint'
    )
    expect(url).toContain('https://b2c.example.com/logout')
    expect(url).toContain('post_logout_redirect_uri=')
    expect(url).toContain('id_token_hint=token-hint')
  })

  test('returns empty string in mock mode', async () => {
    config.set('auth.defraId.mode', 'mock')
    expect(await buildDefraIdSignOutUrl('https://app.example', 'hint')).toBe('')
  })
})
