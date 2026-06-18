// Microsoft Entra ID sign-in routes — INTERNAL case officers / staff.
//
//   GET /auth/entra/sign-in   render the staff sign-in page
//   GET /auth/entra/start     begin sign-in, redirect to Entra (or mock callback)
//   GET /auth/entra/callback  complete sign-in, redirect to the post-login page

import {
  getEntraSummary,
  startEntraSignIn,
  completeEntraCallback
} from './service.js'
import {
  PAGE_PATHS,
  getAuthSession,
  resolvePostLoginRedirect
} from '../session.js'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

const signInPage = {
  handler(request, h) {
    const summary = getEntraSummary(request)
    const session = getAuthSession(request)
    const { returnTo, error } = request.query

    return h.view('entra/sign-in', {
      pageTitle: english.entraSignIn.pageTitle,
      heading: english.entraSignIn.heading,
      t: english.entraSignIn,
      shared: english.authShared,
      summary,
      session,
      returnTo: returnTo || '',
      authError: error || '',
      lang: LANG_EN
    })
  }
}

const startSignIn = {
  async handler(request, h) {
    const { returnTo } = request.query
    const { authorizationUrl } = await startEntraSignIn(request, { returnTo })
    return h.redirect(authorizationUrl)
  }
}

const callback = {
  async handler(request, h) {
    const { returnTo, profile } = await completeEntraCallback(
      request,
      request.query
    )
    return h.redirect(resolvePostLoginRedirect(profile.role, returnTo))
  }
}

export const entraRoutes = {
  plugin: {
    name: 'auth-entra',
    register(server) {
      server.route([
        { method: 'GET', path: PAGE_PATHS.ENTRA_SIGN_IN, ...signInPage },
        { method: 'GET', path: '/auth/entra/start', ...startSignIn },
        { method: 'GET', path: '/auth/entra/callback', ...callback }
      ])
    }
  }
}
