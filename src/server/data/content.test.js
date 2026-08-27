import { english } from './en/en.js'
import { welsh } from './cy/cy.js'

describe('#language content', () => {
  test('English content exposes the expected page sections', () => {
    expect(english.home.heading).toBe('OCR Register')
    // Sign-in / account content now ships with @defra/hapi-oidc-auth; the
    // applicant register journey is parked until that plugin is published.
    expect(english.admin.heading).toBe('OCR Register')
  })

  test('Welsh placeholder mirrors English until it is translated', () => {
    expect(welsh).toBe(english)
  })
})
