// Defra Customer Identity (B2C) sign-in routes — EXTERNAL applicants.
//
//   GET /auth/defra-id/sign-in   render the sign-in page (start button + status)
//   GET /auth/defra-id/start     begin sign-in, redirect to B2C (or mock callback)
//   GET /auth/defra-id/callback  complete sign-in, redirect to the post-login page
//
// Shared sign-out (/auth/sign-out) and the account page live in ../routes.js.

import {
  getDefraIdSummary,
  startDefraIdSignIn,
  completeDefraIdCallback
} from './service.js'
import {
  PAGE_PATHS,
  getAuthSession,
  resolvePostLoginRedirect
} from '../session.js'

const signInPage = {
  handler(request, h) {
    const summary = getDefraIdSummary(request)
    const session = getAuthSession(request)
    const { returnTo, error } = request.query

    return h.view('defra-id/sign-in', {
      pageTitle: 'Sign in',
      heading: 'Sign in to apply',
      summary,
      session,
      returnTo: returnTo || '',
      authError: error || ''
    })
  }
}

const startSignIn = {
  async handler(request, h) {
    const { returnTo } = request.query
    const { authorizationUrl } = await startDefraIdSignIn(request, { returnTo })
    return h.redirect(authorizationUrl)
  }
}

const callback = {
  async handler(request, h) {
    const { returnTo, profile } = await completeDefraIdCallback(
      request,
      request.query
    )
    return h.redirect(resolvePostLoginRedirect(profile.role, returnTo))
  }
}

export const defraIdRoutes = {
  plugin: {
    name: 'auth-defra-id',
    register(server) {
      server.route([
        { method: 'GET', path: PAGE_PATHS.DEFRA_ID_SIGN_IN, ...signInPage },
        { method: 'GET', path: '/auth/defra-id/start', ...startSignIn },
        { method: 'GET', path: '/auth/defra-id/callback', ...callback }
      ])
    }
  }
}
