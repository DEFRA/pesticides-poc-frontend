// isSameSite is computed at module load from session.cookie.secure, so each
// branch is exercised by re-importing the module with SESSION_COOKIE_SECURE set.
async function loadCookieOptions(secure) {
  const previous = process.env.SESSION_COOKIE_SECURE
  process.env.SESSION_COOKIE_SECURE = String(secure)
  vi.resetModules()
  try {
    const { sessionCache } = await import('#/server/plugins/session-cache.js')
    return sessionCache.options.cookieOptions
  } finally {
    if (previous === undefined) {
      delete process.env.SESSION_COOKIE_SECURE
    } else {
      process.env.SESSION_COOKIE_SECURE = previous
    }
  }
}

describe('#sessionCache cookie options', () => {
  afterAll(() => {
    vi.resetModules()
  })

  test('deployed (secure) uses SameSite=None so the cross-site form_post callback keeps the session', async () => {
    const cookieOptions = await loadCookieOptions(true)

    expect(cookieOptions.isSecure).toBe(true)
    expect(cookieOptions.isSameSite).toBe('None')
  })

  test('local dev (non-secure) keeps SameSite=Lax, since browsers drop a non-Secure None cookie', async () => {
    const cookieOptions = await loadCookieOptions(false)

    expect(cookieOptions.isSecure).toBe(false)
    expect(cookieOptions.isSameSite).toBe('Lax')
  })
})
