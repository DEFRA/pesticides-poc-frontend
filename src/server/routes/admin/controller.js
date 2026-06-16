// Admin applications view — INTERNAL case officers. Guarded by requireCaseOfficer.
//
// Minimal landing for the case-officer sign-in POC: it confirms the role-aware
// redirect target (case officer -> /admin/applications) lands on a real page.
// The full applications list is future work; UI is intentionally minimal.

import { getAuthSession, requireCaseOfficer } from '#/server/auth/session.js'

export const adminApplicationsController = {
  options: { pre: [{ method: requireCaseOfficer }] },
  handler(request, h) {
    return h.view('admin/index', {
      pageTitle: 'Applications',
      heading: 'Applications',
      session: getAuthSession(request)
    })
  }
}
