import { adminApplicationsController } from './controller.js'

/**
 * Case-officer admin routes. Registered in src/server/plugins/router.js.
 */
export const admin = {
  plugin: {
    name: 'admin',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/admin/applications',
          ...adminApplicationsController
        }
      ])
    }
  }
}
