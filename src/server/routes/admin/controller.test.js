import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

// Complete a mock case-officer sign-in and return the authenticated session cookie.
async function signInCaseOfficer(server) {
  const start = await server.inject({ method: 'GET', url: '/auth/entra/start' })
  const startCookie = start.headers['set-cookie'][0].split(';')[0]
  const callback = await server.inject({
    method: 'GET',
    url: start.headers.location,
    headers: { cookie: startCookie }
  })
  const setCookie = callback.headers['set-cookie']
  // Fail loudly rather than silently falling back to the pre-auth cookie, which
  // would let a broken sign-in flow masquerade as authenticated in the tests.
  if (!setCookie?.length) {
    throw new Error('Expected a session cookie after the OIDC callback')
  }
  return setCookie[0].split(';')[0]
}

// Guards the migration to @defra/hapi-oidc-auth 0.3.0: the case-officer landing
// is gated by requireAuthorised, which matches the token role against the
// configured entra.roleValues. If that wiring regressed (e.g. roleValues unset),
// requireAuthorised fails closed and a valid case officer would be denied.
describe('#adminApplicationsController (protected)', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('redirects an unauthenticated visitor to the Entra sign-in', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/admin/applications'
    })

    expect(statusCode).toBe(statusCodes.redirect)
    expect(headers.location).toContain('/auth/entra/sign-in')
  })

  test('renders the applications landing for a signed-in case officer (mock)', async () => {
    const cookie = await signInCaseOfficer(server)

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/admin/applications',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('data-testid="admin-officer"')
    )
    // Role must render from the session `roles` array (0.3.0 dropped role/roleLabel);
    // guards against the empty-parens "(...)" regression.
    expect(result).toEqual(expect.stringContaining('(case_officer)'))
    // Sign-out lives in the header account block as a POST form, not a GET link.
    expect(result).toEqual(
      expect.stringContaining(
        '<form class="app-header__signout-form" method="post" action="/auth/sign-out">'
      )
    )
  })

  test('rejects a GET to /auth/sign-out (POST-only route, GET vector closed)', async () => {
    const cookie = await signInCaseOfficer(server)

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/auth/sign-out',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})
