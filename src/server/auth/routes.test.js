import { config } from '#/config/config.js'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

// Carry the yar session cookie between injected requests.
function cookieFrom(response) {
  const setCookie = response.headers['set-cookie']
  if (!setCookie) {
    return ''
  }
  return setCookie.map((entry) => entry.split(';')[0]).join('; ')
}

let server

beforeAll(async () => {
  server = await createServer()
  await server.initialize()
})

afterAll(async () => {
  await server.stop({ timeout: 0 })
})

describe('#auth sign-in pages (mock mode)', () => {
  test('the Defra Identity sign-in page renders a start button in mock mode', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/sign-in'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('defra-id-start'))
    expect(result).toEqual(expect.stringContaining('Mode:'))
  })

  test('the Entra staff sign-in page renders a start button in mock mode', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/entra/sign-in'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('entra-start'))
    expect(result).toEqual(expect.stringContaining('Mode:'))
  })

  test('an unauthenticated visit to /auth/account redirects to the neutral sign-in chooser', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/account'
    })

    expect(statusCode).toBe(statusCodes.redirect)
    // Role-agnostic page → chooser, not a specific IdP.
    expect(headers.location).toBe('/auth/sign-in?error=auth-required')
  })

  test('the sign-in chooser offers both populations', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/sign-in?error=auth-required'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('choose-applicant'))
    expect(result).toEqual(expect.stringContaining('choose-case-officer'))
    expect(result).toEqual(expect.stringContaining('You need to sign in'))
  })
})

describe('#auth sign-in flows (mock mode)', () => {
  test('Defra Identity mock sign-in completes end-to-end and lands on the registration journey', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/start'
    })
    expect(start.statusCode).toBe(statusCodes.redirect)
    expect(start.headers.location).toContain(
      '/auth/defra-id/callback?code=mock-auth-code'
    )

    const cookie = cookieFrom(start)
    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    expect(callback.statusCode).toBe(statusCodes.redirect)
    expect(callback.headers.location).toBe('/register/type')

    const sessionCookie = cookieFrom(callback) || cookie

    const register = await server.inject({
      method: 'GET',
      url: '/register/type',
      headers: { cookie: sessionCookie }
    })
    expect(register.statusCode).toBe(statusCodes.ok)
    expect(register.result).toEqual(
      expect.stringContaining('Ulysses Applicant')
    )

    const account = await server.inject({
      method: 'GET',
      url: '/auth/account',
      headers: { cookie: sessionCookie }
    })
    expect(account.statusCode).toBe(statusCodes.ok)
    expect(account.result).toEqual(expect.stringContaining('Grower Farms Ltd'))
  })

  test('Entra mock sign-in authenticates a case officer', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/entra/start'
    })
    const cookie = cookieFrom(start)
    expect(start.headers.location).toContain(
      '/auth/entra/callback?code=mock-auth-code'
    )

    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    expect(callback.headers.location).toBe('/admin/applications')

    const admin = await server.inject({
      method: 'GET',
      url: '/admin/applications',
      headers: { cookie: cookieFrom(callback) || cookie }
    })
    expect(admin.statusCode).toBe(statusCodes.ok)
    expect(admin.result).toEqual(
      expect.stringContaining('Ulysses Case Officer')
    )
    expect(admin.result).toEqual(expect.stringContaining('Applications'))
  })

  test('sign-out clears the session and redirects home', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/start'
    })
    const cookie = cookieFrom(start)
    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    const sessionCookie = cookieFrom(callback) || cookie

    const signOut = await server.inject({
      method: 'GET',
      url: '/auth/sign-out',
      headers: { cookie: sessionCookie }
    })
    expect(signOut.statusCode).toBe(statusCodes.redirect)
    expect(signOut.headers.location).toBe('/')

    // The session is no longer authenticated, so the account page bounces again.
    const account = await server.inject({
      method: 'GET',
      url: '/auth/account',
      headers: { cookie: cookieFrom(signOut) || sessionCookie }
    })
    expect(account.statusCode).toBe(statusCodes.redirect)
    expect(account.headers.location).toContain('/auth/sign-in')
  })
})

describe('#organisation re-selection', () => {
  test('redirects an unauthenticated user to the applicant sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/organisation'
    })
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toContain('/auth/defra-id/sign-in')
  })

  test('re-runs sign-in for an authenticated applicant', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/start'
    })
    const cookie = cookieFrom(start)
    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    const sessionCookie = cookieFrom(callback) || cookie

    const reselect = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/organisation',
      headers: { cookie: sessionCookie }
    })
    expect(reselect.statusCode).toBe(statusCodes.redirect)
    expect(reselect.headers.location).toContain('/auth/defra-id/callback')
  })
})

describe('#Defra Identity sign-in page (live mode)', () => {
  afterEach(() => {
    config.set('auth.defraId.mode', 'mock')
  })

  test('confirms "Live mode is enabled" when fully configured', async () => {
    config.set('auth.defraId.mode', 'live')
    config.set(
      'auth.defraId.wellKnownUrl',
      'https://b2c.example/.well-known/openid-configuration'
    )
    config.set('auth.defraId.clientId', 'client-123')
    config.set('auth.defraId.clientSecret', 'secret-xyz')
    config.set('auth.defraId.serviceId', 'svc-1')
    config.set('auth.defraId.policy', 'b2c_1a_signin')

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/sign-in'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Live mode is enabled'))
    expect(result).toEqual(expect.stringContaining('defra-id-start'))
  })

  test('warns when live mode is enabled but not fully configured', async () => {
    config.set('auth.defraId.mode', 'live')
    config.set('auth.defraId.clientId', '')

    const { result } = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/sign-in'
    })

    expect(result).toEqual(expect.stringContaining('not fully configured'))
  })
})

describe('#Entra sign-in page (live mode)', () => {
  afterEach(() => {
    config.set('auth.entra.mode', 'mock')
  })

  test('confirms "Live mode is enabled" when fully configured', async () => {
    config.set('auth.entra.mode', 'live')
    config.set('auth.entra.tenantId', 'tid')
    config.set('auth.entra.clientId', 'entra-client')
    config.set('auth.entra.clientSecret', 'entra-secret')

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/auth/entra/sign-in'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Live mode is enabled'))
    expect(result).toEqual(expect.stringContaining('entra-start'))
  })
})

describe('#admin applications (case-officer guard)', () => {
  test('redirects an unauthenticated user to the staff sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/admin/applications'
    })
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toContain('/auth/entra/sign-in')
  })

  test('404s an applicant who is not a case officer', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/defra-id/start'
    })
    const cookie = cookieFrom(start)
    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    const sessionCookie = cookieFrom(callback) || cookie

    const admin = await server.inject({
      method: 'GET',
      url: '/admin/applications',
      headers: { cookie: sessionCookie }
    })
    expect(admin.statusCode).toBe(statusCodes.notFound)
  })
})

describe('#register journey (applicant guard)', () => {
  test('redirects an unauthenticated user to the applicant sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/register/type'
    })
    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toContain('/auth/defra-id/sign-in')
  })

  test('404s a case officer who is not an applicant', async () => {
    const start = await server.inject({
      method: 'GET',
      url: '/auth/entra/start'
    })
    const cookie = cookieFrom(start)
    const callback = await server.inject({
      method: 'GET',
      url: start.headers.location,
      headers: { cookie }
    })
    const sessionCookie = cookieFrom(callback) || cookie

    const register = await server.inject({
      method: 'GET',
      url: '/register/type',
      headers: { cookie: sessionCookie }
    })
    expect(register.statusCode).toBe(statusCodes.notFound)
  })
})
