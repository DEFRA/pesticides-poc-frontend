// Shared auth routes — provider-agnostic.
//
//   GET /auth/sign-in    neutral sign-in chooser (applicant vs case officer)
//   GET /auth/sign-out   sign out of whichever IdP authenticated the user
//   GET /auth/account    authenticated "who am I" page (session diagnostic / POC landing)

import { signOutDefraId } from './defra-id/service.js'
import { signOutEntra } from './entra/service.js'
import {
  ENTRA_PROVIDER,
  PAGE_PATHS,
  getAuthSession,
  requireAuth
} from './session.js'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

// Where requireAuth lands an unauthenticated visitor: we don't yet know whether
// they're an applicant or a case officer, so offer both rather than guess.
const signInChooser = {
  handler(request, h) {
    return h.view('sign-in', {
      pageTitle: 'Sign in',
      heading: 'Sign in',
      authError: request.query.error || ''
    })
  }
}

const signOut = {
  async handler(request, h) {
    const { provider } = getAuthSession(request)
    // Dispatch to the right IdP so a live end-session URL can be built before the
    // local session is cleared. Both services clear the session themselves.
    const signOutUrl =
      provider === ENTRA_PROVIDER
        ? await signOutEntra(request)
        : await signOutDefraId(request)

    return h.redirect(signOutUrl || '/')
  }
}

const account = {
  options: { pre: [{ method: requireAuth }] },
  handler(request, h) {
    const session = getAuthSession(request)

    return h.view('account', {
      pageTitle: english.account.pageTitle,
      heading: english.account.heading,
      t: english.account,
      session,
      lang: LANG_EN
    })
  }
}

export const sharedAuthRoutes = {
  plugin: {
    name: 'auth-shared',
    register(server) {
      server.route([
        { method: 'GET', path: PAGE_PATHS.SIGN_IN, ...signInChooser },
        { method: 'GET', path: PAGE_PATHS.SIGN_OUT, ...signOut },
        { method: 'GET', path: PAGE_PATHS.ACCOUNT, ...account }
      ])
    }
  }
}
