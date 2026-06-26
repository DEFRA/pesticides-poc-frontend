import {
  buildDisplayName,
  createHttpError,
  decodeJwtPayload,
  exchangeCodeForTokens,
  firstNonEmpty,
  fromBase64Url,
  loadDiscovery,
  loadJwks,
  normaliseTokenResponse,
  parseJsonSafe,
  resolveUrl,
  toBase64Url,
  toStringArray,
  verifyIdToken
} from './oidc-common.js'
import {
  generateTestKeyPair,
  idTokenClaims,
  signIdToken
} from '#/test-helpers/oidc-test-keys.js'

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body)
  }
}

describe('#createHttpError', () => {
  test('carries status code and details', () => {
    const error = createHttpError(422, 'bad', [{ field: 'x' }])
    expect(error).toBeInstanceOf(Error)
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual([{ field: 'x' }])
  })
})

describe('#base64url', () => {
  test('round-trips a value', () => {
    expect(fromBase64Url(toBase64Url('héllo:world'))).toBe('héllo:world')
  })
})

describe('#resolveUrl', () => {
  test('returns empty string for a falsy value', () => {
    expect(resolveUrl('https://app.example', '')).toBe('')
  })

  test('passes absolute URLs through unchanged', () => {
    expect(resolveUrl('https://app.example', 'https://other/cb')).toBe(
      'https://other/cb'
    )
  })

  test('joins a relative path onto the base', () => {
    expect(resolveUrl('https://app.example/', '/auth/cb')).toBe(
      'https://app.example/auth/cb'
    )
  })

  test('returns the value unchanged when there is no base', () => {
    expect(resolveUrl('', '/auth/cb')).toBe('/auth/cb')
  })
})

describe('#parseJsonSafe', () => {
  test('returns {} for an empty body', async () => {
    expect(
      await parseJsonSafe({
        headers: { get: () => 'application/json' },
        text: async () => ''
      })
    ).toEqual({})
  })

  test('returns { raw } for non-JSON content', async () => {
    const result = await parseJsonSafe({
      headers: { get: () => 'text/html' },
      text: async () => '<html>'
    })
    expect(result).toEqual({ raw: '<html>' })
  })

  test('parses JSON content', async () => {
    expect(await parseJsonSafe(jsonResponse({ a: 1 }))).toEqual({ a: 1 })
  })
})

describe('#decodeJwtPayload', () => {
  test('returns {} for a non-string or malformed token', () => {
    expect(decodeJwtPayload(null)).toEqual({})
    expect(decodeJwtPayload('only-one-segment')).toEqual({})
  })

  test('decodes the payload segment', () => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${enc({ h: 1 })}.${enc({ sub: 'p1' })}.sig`
    expect(decodeJwtPayload(token)).toEqual({ sub: 'p1' })
  })
})

describe('#firstNonEmpty', () => {
  test('returns the first defined non-empty value', () => {
    expect(firstNonEmpty(undefined, null, '', 'first', 'second')).toBe('first')
  })

  test('returns empty string when all are empty', () => {
    expect(firstNonEmpty(undefined, null, '')).toBe('')
  })
})

describe('#buildDisplayName', () => {
  test('prefers the full name claim', () => {
    expect(buildDisplayName('A', 'B', 'Full Name')).toBe('Full Name')
  })

  test('falls back to first + last', () => {
    expect(buildDisplayName('Alex', 'Grower', '')).toBe('Alex Grower')
  })
})

describe('#toStringArray', () => {
  test('maps an array to strings', () => {
    expect(toStringArray([1, 'a'])).toEqual(['1', 'a'])
  })

  test('wraps a scalar', () => {
    expect(toStringArray('role')).toEqual(['role'])
  })

  test('returns [] for absent values', () => {
    expect(toStringArray(undefined)).toEqual([])
  })
})

describe('#normaliseTokenResponse', () => {
  test('defaults missing fields', () => {
    expect(normaliseTokenResponse({})).toEqual({
      accessToken: '',
      idToken: '',
      refreshToken: '',
      tokenType: '',
      expiresIn: 0
    })
  })
})

describe('#loadDiscovery', () => {
  const DOC = { token_endpoint: 'https://idp/token' }

  test('fetches then serves from cache on the second call', async () => {
    const cache = {}
    const fetchMock = vi.fn(async () => jsonResponse(DOC))
    vi.stubGlobal('fetch', fetchMock)

    expect(
      await loadDiscovery('https://idp/.well-known', cache, 'err')
    ).toEqual(DOC)
    expect(
      await loadDiscovery('https://idp/.well-known', cache, 'err')
    ).toEqual(DOC)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  test('throws on a non-ok discovery response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'nope' }, false, 500))
    )
    await expect(
      loadDiscovery('https://idp/x', {}, 'fallback')
    ).rejects.toMatchObject({
      statusCode: 500
    })
    vi.unstubAllGlobals()
  })
})

describe('#exchangeCodeForTokens', () => {
  const spec = {
    tokenEndpoint: 'https://idp/token',
    clientId: 'c1',
    clientSecret: 'secret',
    usePkce: true,
    errorMessage: 'exchange failed'
  }

  test('posts and normalises the token response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id_token: 'idt', access_token: 'at' }))
    )
    const tokens = await exchangeCodeForTokens(
      spec,
      'code',
      'https://app/cb',
      'verifier'
    )
    expect(tokens.idToken).toBe('idt')
    expect(tokens.accessToken).toBe('at')
    vi.unstubAllGlobals()
  })

  test('works without a client secret or PKCE verifier', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id_token: 'idt' }))
    )
    const tokens = await exchangeCodeForTokens(
      { ...spec, clientSecret: '', usePkce: false },
      'code',
      'https://app/cb',
      ''
    )
    expect(tokens.idToken).toBe('idt')
    vi.unstubAllGlobals()
  })

  test('throws on a non-ok token response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error_description: 'bad grant' }, false, 400)
      )
    )
    await expect(
      exchangeCodeForTokens(spec, 'code', 'https://app/cb', 'verifier')
    ).rejects.toMatchObject({ statusCode: 400 })
    vi.unstubAllGlobals()
  })
})

describe('#loadJwks', () => {
  test('returns the keys array from the JWKS document', async () => {
    const keys = [{ kid: 'k1' }, { kid: 'k2' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ keys }))
    )
    expect(await loadJwks('https://idp/keys', {}, 'err')).toEqual(keys)
    vi.unstubAllGlobals()
  })

  test('returns [] when the document has no keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}))
    )
    expect(await loadJwks('https://idp/keys', {}, 'err')).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('#verifyIdToken', () => {
  const ISSUER = 'https://idp.example/'
  const AUDIENCE = 'client-123'
  const NONCE = 'nonce-1'
  const keyPair = generateTestKeyPair('kid-1')

  const validToken = (overrides = {}) =>
    signIdToken(
      idTokenClaims({
        iss: ISSUER,
        aud: AUDIENCE,
        nonce: NONCE,
        sub: 'subject-1',
        ...overrides
      }),
      keyPair
    )

  const verifyOpts = (overrides = {}) => ({
    jwks: [keyPair.publicJwk],
    issuer: ISSUER,
    audience: AUDIENCE,
    nonce: NONCE,
    ...overrides
  })

  test('returns the claims for a valid, correctly-signed token', () => {
    const claims = verifyIdToken(validToken(), verifyOpts())
    expect(claims.sub).toBe('subject-1')
  })

  test('rejects a token signed by a different key (bad signature)', () => {
    const otherKey = generateTestKeyPair('kid-1')
    const token = signIdToken(
      idTokenClaims({ iss: ISSUER, aud: AUDIENCE, nonce: NONCE }),
      otherKey
    )
    expect(() => verifyIdToken(token, verifyOpts())).toThrow(/signature/)
  })

  test('rejects an unknown algorithm (e.g. alg none)', () => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'x' })}.`
    expect(() => verifyIdToken(token, verifyOpts())).toThrow(/algorithm/)
  })

  test('rejects when no JWKS key matches the kid', () => {
    expect(() =>
      verifyIdToken(validToken(), verifyOpts({ jwks: [{ kid: 'other' }] }))
    ).toThrow(/No matching JWKS key/)
  })

  test('rejects an issuer mismatch', () => {
    expect(() =>
      verifyIdToken(validToken(), verifyOpts({ issuer: 'https://evil/' }))
    ).toThrow(/issuer/)
  })

  test('rejects an audience mismatch', () => {
    expect(() =>
      verifyIdToken(validToken(), verifyOpts({ audience: 'other-client' }))
    ).toThrow(/audience/)
  })

  test('rejects an expired token', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    expect(() =>
      verifyIdToken(validToken({ exp: nowSec - 600 }), verifyOpts())
    ).toThrow(/expired/)
  })

  test('rejects a token with no exp claim', () => {
    expect(() =>
      verifyIdToken(validToken({ exp: undefined }), verifyOpts())
    ).toThrow(/expired or has no exp/)
  })

  test('rejects when the verify options omit issuer/audience/nonce', () => {
    expect(() =>
      verifyIdToken(validToken(), verifyOpts({ nonce: undefined }))
    ).toThrow(/requires issuer, audience and nonce/)
  })

  test('rejects a nonce mismatch', () => {
    expect(() =>
      verifyIdToken(validToken({ nonce: 'wrong' }), verifyOpts())
    ).toThrow(/nonce/)
  })

  test('rejects a token that is not yet valid (nbf in the future)', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    expect(() =>
      verifyIdToken(validToken({ nbf: nowSec + 600 }), verifyOpts())
    ).toThrow(/not yet valid/)
  })

  test('rejects a token issued in the future (iat)', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    expect(() =>
      verifyIdToken(validToken({ iat: nowSec + 600 }), verifyOpts())
    ).toThrow(/issued in the future/)
  })

  test('rejects a token with no kid (must name its signing key)', () => {
    const noKidKey = generateTestKeyPair('')
    const token = signIdToken(
      idTokenClaims({ iss: ISSUER, aud: AUDIENCE, nonce: NONCE, sub: 's-2' }),
      noKidKey
    )
    expect(() =>
      verifyIdToken(token, verifyOpts({ jwks: [noKidKey.publicJwk] }))
    ).toThrow(/No matching JWKS key/)
  })

  test('rejects a malformed or missing token', () => {
    expect(() => verifyIdToken('', verifyOpts())).toThrow(/No ID token/)
    expect(() => verifyIdToken('a.b', verifyOpts())).toThrow(/Malformed/)
  })
})
