import {
  buildMockDefraIdIdentity,
  buildMockEntraIdentity
} from './mock-identities.js'

describe('#buildMockDefraIdIdentity', () => {
  test('returns the applicant with two organisations', () => {
    const identity = buildMockDefraIdIdentity()
    expect(identity.role).toBe('applicant')
    expect(identity.organisations).toHaveLength(2)
    expect(identity.name).toBe('Ulysses Applicant')
  })
})

describe('#buildMockEntraIdentity', () => {
  test('returns the staff case-officer identity', () => {
    const identity = buildMockEntraIdentity()
    expect(identity.role).toBe('case_officer')
    expect(identity.roles).toContain('case_officer')
  })
})
