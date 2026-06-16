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

  test('an unauthenticated visit to /auth/account redirects to the applicant sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/account'
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toContain('/auth/defra-id/sign-in')
  })
})

describe('#auth sign-in flows (mock mode)', () => {
  test('Defra Identity mock sign-in completes end-to-end and lands on the account page', async () => {
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
    expect(callback.headers.location).toBe('/auth/account')

    const account = await server.inject({
      method: 'GET',
      url: '/auth/account',
      headers: { cookie: cookieFrom(callback) || cookie }
    })
    expect(account.statusCode).toBe(statusCodes.ok)
    expect(account.result).toEqual(expect.stringContaining('Alex Grower'))
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
    expect(callback.headers.location).toBe('/auth/account')

    const account = await server.inject({
      method: 'GET',
      url: '/auth/account',
      headers: { cookie: cookieFrom(callback) || cookie }
    })
    expect(account.result).toEqual(expect.stringContaining('Ulysses Alvarez'))
    expect(account.result).toEqual(expect.stringContaining('Case officer'))
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
    expect(account.headers.location).toContain('/auth/defra-id/sign-in')
  })
})
