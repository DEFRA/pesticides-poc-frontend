// Auth feature plugin — registers the two identity populations:
//   - Defra Customer Identity (B2C) for EXTERNAL applicants
//   - Entra ID for INTERNAL case officers (interim OIDC; SAML in production)
// Wired into the router plugin. See docs/auth/AUTH-ARCHITECTURE.md.

import { defraIdRoutes } from './defra-id/routes.js'
import { entraRoutes } from './entra/routes.js'
import { sharedAuthRoutes } from './routes.js'

export const auth = {
  plugin: {
    name: 'auth',
    async register(server) {
      await server.register([defraIdRoutes, entraRoutes, sharedAuthRoutes])
    }
  }
}
