// Test helper: generate an RSA key pair and sign ID tokens so the JWKS
// verification path can be exercised without a real identity provider.
import { createSign, generateKeyPairSync } from 'node:crypto'

const base64url = (input) => Buffer.from(input).toString('base64url')

/**
 * Generate an RSA key pair plus the matching public JWK (with `kid`).
 * @param {string} kid key id advertised in both the JWK and signed tokens
 */
export function generateTestKeyPair(kid = 'test-key-1') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  })
  return {
    privateKey,
    kid,
    publicJwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      use: 'sig',
      alg: 'RS256'
    }
  }
}

/**
 * Sign a JWT (ID token) with the given private key.
 * @param {object} payload token claims
 * @param {{ privateKey: import('node:crypto').KeyObject, kid: string, alg?: string }} options
 */
export function signIdToken(payload, { privateKey, kid, alg = 'RS256' }) {
  const signingInput = `${base64url(
    JSON.stringify({ alg, typ: 'JWT', kid })
  )}.${base64url(JSON.stringify(payload))}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()

  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`
}

/** Default claims for a valid token, overridable per test. */
export function idTokenClaims(overrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    iat: nowSec,
    exp: nowSec + 3600,
    ...overrides
  }
}
