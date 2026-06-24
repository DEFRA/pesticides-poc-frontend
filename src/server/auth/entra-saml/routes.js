// Microsoft Entra ID SAML 2.0 sign-in routes — INTERNAL case officers (EQ-257).
//
//   GET  /auth/entra/saml/start  begin SP-initiated sign-in (redirect to Entra, or mock)
//   GET  /auth/entra/saml/acs    Assertion Consumer Service — mock query callback
//   POST /auth/entra/saml/acs    Assertion Consumer Service — live SAMLResponse (form POST)
//
// The shared sign-in page (/auth/entra/sign-in) and sign-out (/auth/sign-out) are
// unchanged; this scaffold adds the SAML SP endpoints alongside the OIDC ones.

import { startEntraSamlSignIn, completeEntraSamlAcs } from './service.js'
import { resolvePostLoginRedirect } from '../session.js'

const startSignIn = {
  handler(request, h) {
    const { returnTo } = request.query
    const { redirectUrl } = startEntraSamlSignIn(request, { returnTo })
    return h.redirect(redirectUrl)
  }
}

const acs = {
  async handler(request, h) {
    // Live posts the SAMLResponse in the form body; mock bounces back via query.
    const params =
      request.payload && Object.keys(request.payload).length
        ? request.payload
        : request.query
    const { returnTo, profile } = await completeEntraSamlAcs(request, params)
    return h.redirect(resolvePostLoginRedirect(profile.role, returnTo))
  }
}

export const entraSamlRoutes = {
  plugin: {
    name: 'auth-entra-saml',
    register(server) {
      server.route([
        { method: 'GET', path: '/auth/entra/saml/start', ...startSignIn },
        { method: ['GET', 'POST'], path: '/auth/entra/saml/acs', ...acs }
      ])
    }
  }
}
