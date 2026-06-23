import { registerTypeController } from './controller.js'

/**
 * Applicant registration routes. Registered in src/server/plugins/router.js.
 */
export const register = {
  plugin: {
    name: 'register',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/register/type',
          ...registerTypeController
        }
      ])
    }
  }
}
