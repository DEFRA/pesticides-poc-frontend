import {
  PAGE_PATHS,
  applyProfile,
  buildAuthDefaults,
  clearAuthSession,
  createAuthError,
  getAuthSession,
  isAuthenticated,
  requireAuth,
  requireCaseOfficer,
  resolveBaseUrl,
  resolvePostLoginRedirect
} from './session.js'

function fakeYar(initial = {}) {
  const store = { ...initial }
  return {
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value
    },
    clear: (key) => {
      delete store[key]
    }
  }
}

const CONTINUE = Symbol('continue')

function fakeH() {
  return {
    continue: CONTINUE,
    redirect(url) {
      return {
        url,
        takeover() {
          return { isTakeover: true, url }
        }
      }
    },
    response(payload) {
      return {
        payload,
        code(statusCode) {
          this.statusCode = statusCode
          return this
        },
        takeover() {
          this.isTakeover = true
          return this
        }
      }
    }
  }
}

describe('#resolvePostLoginRedirect', () => {
  test('applicants default to the registration journey', () => {
    expect(resolvePostLoginRedirect('applicant', '')).toBe(
      PAGE_PATHS.REGISTER_TYPE
    )
  })

  test('applicants are kept off admin (case-officer) pages', () => {
    expect(resolvePostLoginRedirect('applicant', '/admin/applications')).toBe(
      PAGE_PATHS.REGISTER_TYPE
    )
  })

  test('applicants follow a safe local returnTo', () => {
    expect(resolvePostLoginRedirect('applicant', '/register/type')).toBe(
      '/register/type'
    )
  })

  test('case officers follow an admin returnTo', () => {
    expect(
      resolvePostLoginRedirect('case_officer', '/admin/applications')
    ).toBe('/admin/applications')
  })

  test('case officers default to the admin applications view', () => {
    expect(resolvePostLoginRedirect('case_officer', '')).toBe(
      PAGE_PATHS.ADMIN_APPLICATIONS
    )
  })

  test('case officers are not dropped onto a non-admin returnTo', () => {
    expect(resolvePostLoginRedirect('case_officer', '/register/type')).toBe(
      PAGE_PATHS.ADMIN_APPLICATIONS
    )
  })

  test('blocks open-redirect (protocol-relative) returnTo', () => {
    expect(resolvePostLoginRedirect('applicant', '//evil.example.com')).toBe(
      PAGE_PATHS.REGISTER_TYPE
    )
  })

  test('blocks open-redirect (backslash) returnTo', () => {
    // Browsers normalise `/\evil.com` to `https://evil.com` in a Location header.
    expect(resolvePostLoginRedirect('applicant', '/\\evil.example.com')).toBe(
      PAGE_PATHS.REGISTER_TYPE
    )
  })
})

describe('#getAuthSession', () => {
  test('returns defaults when nothing is stored', () => {
    const request = { yar: fakeYar() }
    expect(getAuthSession(request)).toEqual(buildAuthDefaults())
  })

  test('merges stored values over defaults', () => {
    const request = {
      yar: fakeYar({ auth: { name: 'Alex Grower', isAuthenticated: true } })
    }
    const session = getAuthSession(request)
    expect(session.name).toBe('Alex Grower')
    expect(session.isAuthenticated).toBe(true)
    // Role stays neutral until authentication assigns one.
    expect(session.role).toBe('')
  })
})

describe('#applyProfile', () => {
  test('writes an authenticated session with downstream scope and clears pending state', async () => {
    const request = {
      yar: fakeYar({ auth: { ...buildAuthDefaults(), pendingState: 'mock-1' } })
    }

    const profile = {
      subject: 'urn:applicant',
      email: 'alex.grower@example.com',
      name: 'Alex Grower',
      role: 'applicant',
      roles: ['applicant'],
      organisationId: '5566778',
      organisations: [{ relationshipId: '5566778', organisationId: '5566778' }]
    }

    const session = await applyProfile(request, {
      provider: 'defra-customer-identity',
      profile,
      mode: 'mock'
    })

    expect(session.isAuthenticated).toBe(true)
    expect(session.provider).toBe('defra-customer-identity')
    expect(session.role).toBe('applicant')
    expect(session.roleLabel).toBe('Farmer')
    expect(session.scope).toContain('applicant')
    expect(session.pendingState).toBe('')
  })

  test('an empty/unknown role is NOT granted applicant scope', async () => {
    // e.g. an Entra user whose token lacks the case-officer claim → role ''.
    const request = { yar: fakeYar({ auth: buildAuthDefaults() }) }

    const session = await applyProfile(request, {
      provider: 'microsoft-entra-id',
      profile: { subject: 'urn:staff', name: 'No Role', role: '', roles: [] },
      mode: 'mock'
    })

    expect(session.role).toBe('')
    expect(session.scope).not.toContain('applicant')
    expect(session.scope).not.toContain('case_officer')
  })
})

describe('#clearAuthSession', () => {
  test('resets the session to defaults', () => {
    const request = {
      yar: fakeYar({ auth: { isAuthenticated: true, name: 'Alex' } })
    }
    const cleared = clearAuthSession(request)
    expect(cleared.isAuthenticated).toBe(false)
    expect(getAuthSession(request).name).toBe('')
  })
})

describe('#requireAuth', () => {
  test('continues when authenticated', () => {
    const request = {
      yar: fakeYar({ auth: { isAuthenticated: true } }),
      url: { pathname: '/auth/account', search: '' }
    }
    expect(requireAuth(request, fakeH())).toBe(CONTINUE)
  })

  test('redirects to the neutral sign-in chooser (with returnTo stashed) when not authenticated', () => {
    const request = {
      yar: fakeYar(),
      url: { pathname: '/auth/account', search: '' }
    }
    const result = requireAuth(request, fakeH())
    expect(result.isTakeover).toBe(true)
    // Role-agnostic guard → the chooser, not a specific IdP.
    expect(result.url).toContain(PAGE_PATHS.SIGN_IN)
    expect(result.url).not.toContain(PAGE_PATHS.DEFRA_ID_SIGN_IN)
    expect(getAuthSession(request).returnTo).toBe('/auth/account')
  })
})

describe('#requireCaseOfficer', () => {
  test('redirects an unauthenticated user to the Entra sign-in', () => {
    const request = { yar: fakeYar(), url: { pathname: '/admin', search: '' } }
    const result = requireCaseOfficer(request, fakeH())
    expect(result.url).toContain(PAGE_PATHS.ENTRA_SIGN_IN)
  })

  test('404s an applicant trying to reach a case-officer page', () => {
    const request = {
      yar: fakeYar({
        auth: { isAuthenticated: true, role: 'applicant' }
      }),
      url: { pathname: '/admin', search: '' }
    }
    const result = requireCaseOfficer(request, fakeH())
    expect(result.statusCode).toBe(404)
  })

  test('continues when the case officer role matches', () => {
    const request = {
      yar: fakeYar({
        auth: { isAuthenticated: true, role: 'case_officer' }
      }),
      url: { pathname: '/admin', search: '' }
    }
    expect(requireCaseOfficer(request, fakeH())).toBe(CONTINUE)
  })
})

describe('#isAuthenticated', () => {
  test('reflects the stored session flag', () => {
    expect(isAuthenticated({ yar: fakeYar() })).toBe(false)
    expect(
      isAuthenticated({ yar: fakeYar({ auth: { isAuthenticated: true } }) })
    ).toBe(true)
  })
})

describe('#createAuthError', () => {
  test('carries a status code and details', () => {
    const error = createAuthError(422, 'bad', [{ field: 'x' }])
    expect(error).toBeInstanceOf(Error)
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual([{ field: 'x' }])
  })
})

describe('#resolveBaseUrl', () => {
  test('prefers the configured base URL', () => {
    expect(resolveBaseUrl({}, 'https://configured.example')).toBe(
      'https://configured.example'
    )
  })

  test('derives from the request host when not configured', () => {
    const request = {
      url: { protocol: 'https:' },
      info: { host: 'app.example' }
    }
    expect(resolveBaseUrl(request, '')).toBe('https://app.example')
  })

  test('returns empty string when no host is available', () => {
    expect(resolveBaseUrl({}, '')).toBe('')
  })
})
