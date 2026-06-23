// Downstream permissions / enrolment resolution.
//
// Ported from prototype-legacy app/services/get-permissions.js (CJS -> ESM).
// The IdP authenticates the person and (for applicants) which organisation they
// selected, but NOT their permission set. Per the Customer Identity FAQ, that lives
// in the LOB Service User Link enrolment record (Service Role + Enrolment Status),
// resolved downstream. Here it is simulated so the prototype can exercise role +
// scope-based access without a backend. IdP-agnostic (Entra or Defra Identity).

const DEFAULT_SCOPE = 'user'

// Mock privilege sets, keyed by the prototype role. A real implementation resolves
// these per person + organisation from the downstream authorisation API.
const MOCK_PRIVILEGES = {
  applicant: ['Full permission - business', 'Submit - pesticides'],
  case_officer: ['Review - pesticides', 'Decide - pesticides']
}

const MOCK_ROLE_LABELS = {
  applicant: 'Farmer',
  case_officer: 'Case officer'
}

export async function getPermissions(profile) {
  // Key strictly off a recognised role. A blank/unknown role (e.g. an Entra user
  // whose token lacks the case-officer claim) must NOT fall back to applicant —
  // that would grant applicant scope to someone who never authenticated as one.
  const roleKey = MOCK_PRIVILEGES[profile?.role] ? profile.role : ''

  if (!roleKey) {
    // Authenticated but no recognised role: no role privileges.
    return { role: '', scope: [DEFAULT_SCOPE] }
  }

  const privileges = MOCK_PRIVILEGES[roleKey]

  // Map roles + privileges to a Hapi-style `scope` array.
  const scope = [DEFAULT_SCOPE, roleKey, ...privileges]

  return {
    role: MOCK_ROLE_LABELS[roleKey],
    scope
  }
}
