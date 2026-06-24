import { config } from '#/config/config.js'

import {
  completeEntraSamlAcs,
  getEntraSamlSummary,
  startEntraSamlSignIn
} from './service.js'
import { getAuthSession } from '../session.js'

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

afterEach(() => {
  config.set('auth.entraSaml.mode', 'mock')
})

describe('#startEntraSamlSignIn / #completeEntraSamlAcs (mock)', () => {
  test('mock start bounces to the ACS with a state marker', () => {
    const request = fakeRequest()
    const start = startEntraSamlSignIn(request, {
      returnTo: '/admin/applications'
    })
    expect(start.mode).toBe('mock')
    expect(start.redirectUrl).toContain('/auth/entra/saml/acs?saml=mock&state=')

    const pending = getAuthSession(request)
    expect(pending.pendingState).toBeTruthy()
  })

  test('mock ACS completes into a case-officer session', async () => {
    const request = fakeRequest()
    startEntraSamlSignIn(request, { returnTo: '/admin/applications' })
    const { pendingState } = getAuthSession(request)

    const result = await completeEntraSamlAcs(request, {
      saml: 'mock',
      state: pendingState
    })

    expect(result.profile.role).toBe('case_officer')
    const session = getAuthSession(request)
    expect(session.isAuthenticated).toBe(true)
    expect(session.provider).toBe('microsoft-entra-id')
  })

  test('mock ACS rejects a mismatched state', async () => {
    const request = fakeRequest()
    startEntraSamlSignIn(request)
    await expect(
      completeEntraSamlAcs(request, { saml: 'mock', state: 'wrong' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('#getEntraSamlSummary', () => {
  test('exposes the SAML protocol + ACS URL', () => {
    const summary = getEntraSamlSummary(fakeRequest())
    expect(summary.protocol).toBe('SAML 2.0')
    expect(summary.acsUrl).toBe('https://app.example/auth/entra/saml/acs')
  })
})
