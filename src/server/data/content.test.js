import { english } from './en/en.js'
import { welsh } from './cy/cy.js'

describe('#language content', () => {
  test('English content exposes the expected page sections', () => {
    expect(english.home.heading).toBe(
      'DEFRA / HSE Entra ID Common Login pattern'
    )
    expect(english.defraIdSignIn.signInButton).toBe('Sign in')
    expect(english.entraSignIn.caption).toBe('Microsoft Entra ID')
    expect(english.authShared.modeLabel).toBe('Mode:')
    expect(english.account.keyName).toBe('Name')
    expect(english.register.heading).toBe(
      'Register for a pesticides application'
    )
    expect(english.admin.heading).toBe('Applications')
  })

  test('Welsh placeholder mirrors English until it is translated', () => {
    expect(welsh).toBe(english)
  })
})
