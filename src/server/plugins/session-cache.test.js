import { sessionCache } from '#/server/plugins/session-cache.js'

describe('#sessionCache cookie options', () => {
  const { cookieOptions } = sessionCache.options

  test('ties SameSite to the Secure flag: None when secure, Lax otherwise', () => {
    // Live OIDC (response_mode=form_post) needs SameSite=None so the session
    // cookie survives the cross-site POST callback; local dev over plain HTTP
    // (secure=false) must stay Lax because browsers drop a non-Secure None.
    expect(cookieOptions.isSameSite).toBe(
      cookieOptions.isSecure ? 'None' : 'Lax'
    )
  })

  test('never sets SameSite=None without the Secure flag', () => {
    if (cookieOptions.isSameSite === 'None') {
      expect(cookieOptions.isSecure).toBe(true)
    }
  })
})
