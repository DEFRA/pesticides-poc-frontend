// Admin applications view — INTERNAL case officers. Guarded by requireCaseOfficer.
//
// Minimal landing for the case-officer sign-in POC: it confirms the role-aware
// redirect target (case officer -> /admin/applications) lands on a real page.
// The full applications list is future work; UI is intentionally minimal. Text
// comes from the central language content (defaults to English).

import { getAuthSession, requireCaseOfficer } from '#/server/auth/session.js'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

export const adminApplicationsController = {
  options: { pre: [{ method: requireCaseOfficer }] },
  handler(request, h, content = english) {
    const { admin } = content

    return h.view('admin/index', {
      pageTitle: admin.pageTitle,
      heading: admin.heading,
      t: admin,
      session: getAuthSession(request),
      lang: LANG_EN
    })
  }
}
