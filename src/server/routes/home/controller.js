import { getAuthSession } from '#/server/auth/session.js'
import { english } from '#/server/data/en/en.js'
import { LANG_EN } from '#/server/data/constants.js'

/**
 * Home page controller. Text comes from the central language content
 * (`content` defaults to English); Welsh is not built yet.
 */
export const homeController = {
  handler(request, h, content = english) {
    const { home } = content

    return h.view('home/index', {
      pageTitle: home.pageTitle,
      heading: home.heading,
      t: home,
      session: getAuthSession(request),
      lang: LANG_EN
    })
  }
}
