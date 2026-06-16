import {
  buildMockDefraIdIdentity,
  buildMockEntraIdentity
} from './mock-identities.js'

describe('#buildMockDefraIdIdentity', () => {
  test('returns the applicant with two organisations by default', () => {
    const identity = buildMockDefraIdIdentity('applicant')
    expect(identity.role).toBe('applicant')
    expect(identity.organisations).toHaveLength(2)
    expect(identity.name).toBe('Alex Grower')
  })

  test('returns the case officer with no organisations', () => {
    const identity = buildMockDefraIdIdentity('case_officer')
    expect(identity.role).toBe('case_officer')
    expect(identity.organisations).toEqual([])
  })
})

describe('#buildMockEntraIdentity', () => {
  test('returns the staff case-officer identity', () => {
    const identity = buildMockEntraIdentity()
    expect(identity.role).toBe('case_officer')
    expect(identity.roles).toContain('case_officer')
  })
})
