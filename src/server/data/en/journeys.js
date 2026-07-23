// English translations — post-login journey landing pages (register, admin).
const VIEW_ACCOUNT = 'View your account'
const OR = 'or'
const SIGN_OUT = 'sign out'
const SIGNED_IN_PREFIX = 'Signed in as'

export const journeyTranslations = {
  register: {
    pageTitle: 'Register',
    heading: 'Register for a pesticides application',
    caption: 'Applicant',
    signedInPrefix: SIGNED_IN_PREFIX,
    forOrganisation: 'for organisation',
    placeholder:
      'The registration journey will start here. This view is a placeholder for the applicant sign-in POC.',
    viewAccount: VIEW_ACCOUNT,
    or: OR,
    signOut: SIGN_OUT
  },

  admin: {
    pageTitle: 'Applications',
    heading: 'OCR Register',
    caption: 'Case officer',
    signedInPrefix: SIGNED_IN_PREFIX,
    placeholder:
      'The applications list will appear here. This view is a placeholder for the case-officer sign-in POC.',
    viewAccount: VIEW_ACCOUNT,
    or: OR,
    signOut: SIGN_OUT
  }
}
