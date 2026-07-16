import { buildAccount } from './build-account.js'

describe('#buildAccount', () => {
  test('returns null when the request has no session store', () => {
    expect(buildAccount(undefined)).toBeNull()
    expect(buildAccount({})).toBeNull()
  })

  test('returns null when reading the session throws (e.g. 404/early render)', () => {
    const request = {
      yar: {
        get: () => {
          throw new Error('session cache not ready')
        }
      }
    }

    expect(buildAccount(request)).toBeNull()
  })

  test('returns null when the user is not signed in', () => {
    const request = { yar: { get: () => ({ isAuthenticated: false }) } }

    expect(buildAccount(request)).toBeNull()
  })

  test('returns name, role label and sign-out link when signed in', () => {
    const request = {
      yar: {
        get: () => ({
          isAuthenticated: true,
          name: 'Jane Smith',
          role: 'case_officer',
          roleLabel: 'Case officer'
        })
      }
    }

    expect(buildAccount(request)).toEqual({
      name: 'Jane Smith',
      roleLabel: 'Case officer',
      signOutUrl: '/auth/sign-out'
    })
  })

  test('falls back to the raw role when no role label is present', () => {
    const request = {
      yar: {
        get: () => ({
          isAuthenticated: true,
          name: 'Jane Smith',
          role: 'case_officer'
        })
      }
    }

    expect(buildAccount(request).roleLabel).toBe('case_officer')
  })
})
