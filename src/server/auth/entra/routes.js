// Entra ID sign-in routes — INTERNAL case officers. SCAFFOLD ONLY.
// Step 2: GET /auth/entra/sign-in, GET /auth/entra/callback.

const notImplemented = {
  handler(_request, h) {
    return h
      .response({ message: 'entra auth not implemented yet (scaffold)' })
      .code(501)
  }
}

export const entraRoutes = {
  plugin: {
    name: 'auth-entra',
    register(server) {
      server.route([
        { method: 'GET', path: '/auth/entra/sign-in', ...notImplemented },
        { method: 'GET', path: '/auth/entra/callback', ...notImplemented }
      ])
    }
  }
}
