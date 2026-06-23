import { getAuthSession } from '#/server/auth/session.js'

/**
 * A GDS styled example home page controller.
 * Provided as an example, remove or modify as required.
 */
export const homeController = {
  handler(request, h) {
    return h.view('home/index', {
      pageTitle: 'Home',
      heading: 'Home',
      session: getAuthSession(request)
    })
  }
}
