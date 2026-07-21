import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { about } from '../routes/about/index.js'
import { health } from '../routes/health/index.js'
import { admin } from '../routes/admin/index.js'
import { register } from '../routes/register/index.js'
import { hapiOidcAuth } from '@defra/hapi-oidc-auth'
import { serveStaticFiles } from './serve-static-files.js'
import { config } from '#/config/config.js'

// Shared DEFRA sign-in (applicant + case officer) via @defra/hapi-oidc-auth.
// The IdP config comes from this app's convict config (auth.defraId / auth.entra,
// fed by DEFRA_ID_* / ENTRA_* env + CDP Secrets); post-login destinations are our
// own pages.
const authPlugin = {
  plugin: hapiOidcAuth,
  options: {
    defraId: config.get('auth.defraId'),
    entra: config.get('auth.entra'),
    redirects: {
      applicant: '/register/type',
      caseOfficer: '/admin/applications',
      signOut: '/'
    }
  }
}

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([home, about, admin, register, authPlugin])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          await server.register({
            plugin: (await import('@defra/hapi-connect')).default,
            options: {
              path: '/public',
              middleware: [vite.middlewares]
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
