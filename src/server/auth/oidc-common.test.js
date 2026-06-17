import {
  buildDisplayName,
  createHttpError,
  decodeJwtPayload,
  exchangeCodeForTokens,
  firstNonEmpty,
  fromBase64Url,
  loadDiscovery,
  normaliseTokenResponse,
  parseJsonSafe,
  resolveUrl,
  toBase64Url,
  toStringArray
} from './oidc-common.js'

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
