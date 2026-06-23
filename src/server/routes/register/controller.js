// Registration journey entry — EXTERNAL applicants. Guarded by requireApplicant.
//
// Minimal landing for the applicant sign-in POC: it confirms the role-aware
// redirect target (applicant -> /register/type) lands on a real page. The full
// registration journey is future work; UI is intentionally minimal.

import { getAuthSession, requireApplicant } from '#/server/auth/session.js'

export const registerTypeController = {
  options: { pre: [{ method: requireApplicant }] },
  handler(request, h) {
    return h.view('register/index', {
      pageTitle: 'Register',
      heading: 'Register for a pesticides application',
      session: getAuthSession(request)
    })
  }
}
