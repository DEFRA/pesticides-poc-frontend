import { config } from '#/config/config.js'

import {
  completeDefraIdCallback,
  getDefraIdSummary,
  signOutDefraId,
  startDefraIdSignIn
} from './service.js'
import { getAuthSession } from '../session.js'
import {
  generateTestKeyPair,
  idTokenClaims,
  signIdToken
} from '#/test-helpers/oidc-test-keys.js'

const WELL_KNOWN = 'https://b2c.example.com/te/.well-known/openid-configuration'
const ISSUER = 'https://b2c.example.com/'
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: 'https://b2c.example.com/authorize',
  token_endpoint: 'https://b2c.example.com/oauth/token',
  jwks_uri: 'https://b2c.example.com/discovery/keys',
  end_session_endpoint: 'https://b2c.example.com/logout'
}

const keyPair = generateTestKeyPair('defra-svc-kid')

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

function fakeRequest(initial = {}) {
  const store = { ...initial }
  return {
    yar: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value
      },
      clear: (key) => {
        delete store[key]
      }
    },
    info: { host: 'app.example' },
    url: { protocol: 'https:' }
  }
}

function setLiveConfig() {
  config.set('auth.defraId.mode', 'live')
  config.set('auth.defraId.wellKnownUrl', WELL_KNOWN)
  config.set('auth.defraId.clientId', 'client-123')
  config.set('auth.defraId.clientSecret', 'secret-xyz')
  config.set('auth.defraId.serviceId', 'svc-1')
  config.set('auth.defraId.policy', 'b2c_1a_signin')
  config.set('auth.defraId.signOutRedirectUrl', 'https://app.example/bye')
}

afterEach(() => {
  vi.unstubAllGlobals()
  config.set('auth.defraId.mode', 'mock')
})

describe('#getDefraIdSummary (live)', () => {
  test('derives the redirect URI from the request host', () => {
    setLiveConfig()
    const summary = getDefraIdSummary(fakeRequest())
    expect(summary.isLive).toBe(true)
    expect(summary.redirectUri).toBe(
      'https://app.example/auth/defra-id/callback'
    )
  })
})

describe('#startDefraIdSignIn / #completeDefraIdCallback (live)', () => {
  test('starts the live flow then completes the callback into an authenticated session', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const request = fakeRequest()
    const start = await startDefraIdSignIn(request, {
      returnTo: '/register/type'
    })
    expect(start.mode).toBe('live')
    expect(start.authorizationUrl).toContain(
      'https://b2c.example.com/authorize'
    )

    const pending = getAuthSession(request)
    expect(pending.pendingState).toBeTruthy()
    expect(pending.mode).toBe('live')

    const idToken = signIdToken(
      idTokenClaims({
        iss: ISSUER,
        aud: 'client-123',
        sub: 'p1',
        email: 'alex@example.com',
        relationships: ['rel-1:org-1:Org One:::'],
        currentRelationshipId: 'rel-1',
        nonce: pending.pendingNonce
      }),
      keyPair
    )
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/oauth/token': {
          body: { id_token: idToken, token_type: 'Bearer', expires_in: 3600 }
        },
        '/discovery/keys': { body: { keys: [keyPair.publicJwk] } }
      })
    )

    const result = await completeDefraIdCallback(request, {
      code: 'code-1',
      state: pending.pendingState
    })

    expect(result.profile.subject).toBe('p1')
    const session = getAuthSession(request)
    expect(session.isAuthenticated).toBe(true)
    expect(session.mode).toBe('live')
    expect(session.provider).toBe('defra-customer-identity')
  })
})

describe('#signOutDefraId (live)', () => {
  test('returns the end-session URL and clears the session', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const request = fakeRequest({
      auth: {
        isAuthenticated: true,
        idTokenHint: 'token-hint',
        provider: 'defra-customer-identity',
        mode: 'live'
      }
    })

    const url = await signOutDefraId(request)
    expect(url).toContain('https://b2c.example.com/logout')
    expect(getAuthSession(request).isAuthenticated).toBe(false)
  })
})
