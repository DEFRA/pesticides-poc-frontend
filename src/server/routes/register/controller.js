// Registration journey entry — EXTERNAL applicants. Guarded by requireApplicant.
//
// Minimal landing for the applicant sign-in POC: it confirms the role-aware
// redirect target (applicant -> /register/type) lands on a real page. The full
// registration journey is future work; UI is intentionally minimal. Text comes
// from the central language content (defaults to English).

import { getAuthSession, requireApplicant } from '#/server/auth/session.js'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

export const registerTypeController = {
  options: { pre: [{ method: requireApplicant }] },
  handler(request, h, content = english) {
    const { register } = content

    return h.view('register/index', {
      pageTitle: register.pageTitle,
      heading: register.heading,
      t: register,
      session: getAuthSession(request),
      lang: LANG_EN
    })
  }
}
