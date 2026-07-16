import yar from '@hapi/yar'

import { config } from '#/config/config.js'

const sessionConfig = config.get('session')
const isSecureCookie = config.get('session.cookie.secure')

/**
 * Set options.maxCookieSize to 0 to always use server-side storage
 */
export const sessionCache = {
  plugin: yar,
  options: {
    name: sessionConfig.cache.name,
    cache: {
      cache: sessionConfig.cache.name,
      expiresIn: sessionConfig.cache.ttl
    },
    storeBlank: false,
    errorOnCacheNotReady: true,
    cookieOptions: {
      password: sessionConfig.cookie.password,
      ttl: sessionConfig.cookie.ttl,
      isSecure: isSecureCookie,
      // OIDC live sign-in uses response_mode=form_post, so the IdP returns the
      // result via a cross-site POST to the callback. A Lax/Strict cookie is not
      // sent on a cross-site POST, so the session (holding the OIDC state/nonce)
      // would be lost and the callback would 422. 'None' lets the cookie ride
      // that hop, but browsers drop a SameSite=None cookie that is not Secure,
      // so it is tied to isSecure: deployed (HTTPS, secure) gets 'None'; local
      // dev (plain HTTP, secure=false) keeps 'Lax', which is fine because local
      // uses mock mode — a same-site GET callback that never crosses origins.
      isSameSite: isSecureCookie ? 'None' : 'Lax',
      clearInvalid: true
    }
  }
}
