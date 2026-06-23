import { config } from '#/config/config.js'

import {
  completeEntraCallback,
  getEntraSummary,
  signOutEntra,
  startEntraSignIn
} from './service.js'
import { getAuthSession } from '../session.js'

const DISCOVERY = {
  authorization_endpoint:
    'https://login.microsoftonline.com/tid/oauth2/v2.0/authorize',
  token_endpoint: 'https://login.microsoftonline.com/tid/oauth2/v2.0/token',
  end_session_endpoint:
    'https://login.microsoftonline.com/tid/oauth2/v2.0/logout'
}

function jwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const withExp = { exp: Math.floor(Date.now() / 1000) + 3600, ...payload }
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(withExp)}.sig`
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
  config.set('auth.entra.mode', 'live')
  config.set('auth.entra.tenantId', 'tid')
  config.set('auth.entra.clientId', 'entra-client')
  config.set('auth.entra.clientSecret', 'entra-secret')
  config.set('auth.entra.signOutRedirectUrl', 'https://app.example/bye')
}

afterEach(() => {
  vi.unstubAllGlobals()
  config.set('auth.entra.mode', 'mock')
})

describe('#getEntraSummary (live)', () => {
  test('derives the redirect URI from the request host', () => {
    setLiveConfig()
    const summary = getEntraSummary(fakeRequest())
    expect(summary.isLive).toBe(true)
    expect(summary.redirectUri).toBe('https://app.example/auth/entra/callback')
  })
})

describe('#startEntraSignIn / #completeEntraCallback (live)', () => {
  test('starts the live flow then completes the callback into a case-officer session', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const request = fakeRequest()
    const start = await startEntraSignIn(request, {
      returnTo: '/admin/applications'
    })
    expect(start.mode).toBe('live')

    const pending = getAuthSession(request)
    const idToken = jwt({
      oid: 'oid-1',
      preferred_username: 'co@defra.gov.uk',
      roles: ['case_officer'],
      nonce: pending.pendingNonce
    })
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '.well-known': { body: DISCOVERY },
        '/v2.0/token': {
          body: { id_token: idToken, token_type: 'Bearer', expires_in: 3600 }
        }
      })
    )

    const result = await completeEntraCallback(request, {
      code: 'code-1',
      state: pending.pendingState
    })

    expect(result.profile.role).toBe('case_officer')
    const session = getAuthSession(request)
    expect(session.isAuthenticated).toBe(true)
    expect(session.provider).toBe('microsoft-entra-id')
  })
})

describe('#signOutEntra (live)', () => {
  test('returns the end-session URL and clears the session', async () => {
    setLiveConfig()
    vi.stubGlobal('fetch', stubFetch({ '.well-known': { body: DISCOVERY } }))

    const request = fakeRequest({
      auth: {
        isAuthenticated: true,
        idTokenHint: 'token-hint',
        provider: 'microsoft-entra-id',
        mode: 'live'
      }
    })

    const url = await signOutEntra(request)
    expect(url).toContain('/logout')
    expect(getAuthSession(request).isAuthenticated).toBe(false)
  })
})
