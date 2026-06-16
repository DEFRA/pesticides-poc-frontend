// Defra Identity (B2C) sign-in routes — EXTERNAL applicants. SCAFFOLD ONLY.
//
// Step 2 implements: GET /auth/defra-id/sign-in, GET /auth/defra-id/callback,
// GET /auth/defra-id/organisation (relationship re-selection), GET /auth/sign-out.
// Express handlers from the recovered auth-routes.js are rewritten to Hapi here
// (h.redirect / h.view, @hapi/yar session).

const notImplemented = {
  handler(_request, h) {
    return h
      .response({ message: 'defra-id auth not implemented yet (scaffold)' })
      .code(501)
  }
}

export const defraIdRoutes = {
  plugin: {
    name: 'auth-defra-id',
    register(server) {
      server.route([
        { method: 'GET', path: '/auth/defra-id/sign-in', ...notImplemented },
        { method: 'GET', path: '/auth/defra-id/callback', ...notImplemented }
      ])
    }
  }
}
