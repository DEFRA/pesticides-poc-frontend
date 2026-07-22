import { homeTranslations } from './home.js'
import { journeyTranslations } from './journeys.js'

/**
 * Consolidated English translations for the pesticides POC frontend.
 * Split into focused modules for maintainability (mirrors aqie-front-end).
 */
export const english = {
  ...homeTranslations,
  ...journeyTranslations
}
