import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(result).toEqual(expect.stringContaining('Home |'))
    expect(statusCode).toBe(statusCodes.ok)
    // Signed out: the header account block (name + sign out) is not shown.
    expect(result).not.toEqual(
      expect.stringContaining('data-testid="header-sign-out"')
    )
    // The case-officer option is a live sign-in link.
    expect(result).toEqual(
      expect.stringContaining(
        '<a class="govuk-link" href="/auth/entra/sign-in" data-testid="home-staff-sign-in">'
      )
    )
    // The applicant option is present but disabled (not a link) while not ready.
    expect(result).toEqual(
      expect.stringContaining('data-testid="home-applicant-unavailable"')
    )
    expect(result).toEqual(expect.stringContaining('aria-disabled="true"'))
  })
})
