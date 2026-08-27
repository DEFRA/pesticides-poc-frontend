// Admin applications view — INTERNAL case officers. Guarded by requireAuthorised
// (authenticated AND carrying a configured case-officer role value).
//
// Minimal landing for the case-officer sign-in POC: it confirms the post-login
// redirect target (/admin/applications) lands on a real page. The full
// applications list is future work; UI is intentionally minimal. Text comes from
// the central language content (defaults to English).

import { getAuthSession, requireAuthorised } from '@defra/hapi-oidc-auth'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

export const adminApplicationsController = {
  options: { pre: [{ method: requireAuthorised }] },
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
