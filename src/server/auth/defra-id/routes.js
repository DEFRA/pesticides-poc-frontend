// Defra Customer Identity (B2C) sign-in routes — EXTERNAL applicants.
//
//   GET /auth/defra-id/sign-in     render the sign-in page (start button + status)
//   GET /auth/defra-id/start       begin sign-in, redirect to B2C (or mock callback)
//   GET /auth/defra-id/callback    complete sign-in, redirect to the post-login page
//   GET /auth/defra-id/organisation re-run sign-in forcing the B2C org picker
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
  requireApplicant,
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
    // Live uses response_mode=form_post (code in the POST body); mock redirects
    // back with query params. Accept whichever is present.
    const params =
      request.payload && Object.keys(request.payload).length
        ? request.payload
        : request.query
    const { returnTo, profile } = await completeDefraIdCallback(request, params)
    return h.redirect(resolvePostLoginRedirect(profile.role, returnTo))
  }
}

// Organisation/relationship re-selection: re-run sign-in with the B2C org picker
// forced (cross-service SSO). Applicant-only Defra Identity action (so guarded by
// requireApplicant, not the role-agnostic requireAuth); an optional relationshipId
// pre-selects an organisation. Mock mode simply re-runs sign-in.
const organisation = {
  options: { pre: [{ method: requireApplicant }] },
  async handler(request, h) {
    const { returnTo, relationshipId } = request.query
    const { authorizationUrl } = await startDefraIdSignIn(request, {
      returnTo,
      forceReselection: true,
      relationshipId
    })
    return h.redirect(authorizationUrl)
  }
}

export const defraIdRoutes = {
  plugin: {
    name: 'auth-defra-id',
    register(server) {
      server.route([
        { method: 'GET', path: PAGE_PATHS.DEFRA_ID_SIGN_IN, ...signInPage },
        { method: 'GET', path: '/auth/defra-id/start', ...startSignIn },
        {
          method: ['GET', 'POST'],
          path: '/auth/defra-id/callback',
          ...callback
        },
        { method: 'GET', path: '/auth/defra-id/organisation', ...organisation }
      ])
    }
  }
}
