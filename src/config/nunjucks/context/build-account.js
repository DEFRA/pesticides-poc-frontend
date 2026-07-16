import { getAuthSession, PAGE_PATHS } from '#/server/auth/session.js'

// Account details for the top-right of the service navigation (who is signed in
// + a sign-out link), shown on every page once authenticated. Returns null when
// signed out or when the session cannot be read, so the header omits the block.
export function buildAccount(request) {
  // Defensive / test-only: yar decorates request.yar on every real request.
  if (!request?.yar) {
    return null
  }

  // The session store is only loaded for matched routes; on a 404/early-error
  // render reading it throws, so fail closed to no account block rather than 500.
  let session
  try {
    session = getAuthSession(request)
  } catch {
    return null
  }

  if (!session.isAuthenticated) {
    return null
  }

  return {
    name: session.name,
    roleLabel: session.roleLabel || session.role,
    accountUrl: PAGE_PATHS.ACCOUNT,
    signOutUrl: PAGE_PATHS.SIGN_OUT
  }
}
