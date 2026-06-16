// Mock sign-in identities for `mock` auth mode (no credentials needed).
//
// Ported from prototype-legacy app/routes/pesticides/shared.js. Mock mode lets the
// service run for demos and UCD / user research. The applicant carries two
// organisations to exercise the org/relationship-selection journey.
//
// TODO(enrolment): model enrolment states (Pending / Approved / Blocked /
// Offboarded) here so user research can cover the traditional-enrolment gate
// (see docs/auth/AUTH-ARCHITECTURE.md §3).

export function buildMockDefraIdIdentity(identity) {
  if (identity === 'case_officer') {
    return {
      subject: 'urn:fcp:defra-id:case-officer-ulysses',
      crn: '',
      email: 'ulysses.alvarez@defra.gov.uk',
      firstName: 'Ulysses',
      lastName: 'Case Officer',
      name: 'Ulysses Case Officer',
      organisationId: '',
      organisations: [],
      roles: ['case_officer'],
      role: 'case_officer',
      sessionId: 'mock-session-case-officer'
    }
  }

  return {
    subject: 'urn:fcp:defra-id:applicant-ulysses',
    crn: '1100100100',
    email: 'ulysses.alvarez@cognizant.com',
    firstName: 'Ulysses',
    lastName: 'Applicant',
    name: 'Ulysses Applicant',
    organisationId: '5566778',
    organisations: [
      {
        relationshipId: '5566778',
        organisationId: '5566778',
        organisationName: 'Grower Farms Ltd'
      },
      {
        relationshipId: '9988776',
        organisationId: '9988776',
        organisationName: 'Upland Estates'
      }
    ],
    roles: ['applicant'],
    role: 'applicant',
    sessionId: 'mock-session-applicant'
  }
}

export function buildMockEntraIdentity() {
  return {
    subject: 'urn:entra:case-officer-ulysses',
    email: 'ulysses.alvarez@defra.gov.uk',
    firstName: 'Ulysses',
    lastName: 'Case Officer',
    name: 'Ulysses Case Officer',
    roles: ['case_officer'],
    role: 'case_officer',
    sessionId: 'mock-session-entra-case-officer'
  }
}
