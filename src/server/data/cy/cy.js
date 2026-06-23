// Welsh translations are NOT built yet — the service defaults to English.
//
// This placeholder mirrors the English structure so the en/cy language-selection
// logic matches aqie-front-end and Welsh can be populated later (replace the
// re-export below with focused -welsh.js content modules). Until then, selecting
// `cy` will render English copy rather than fail.
import { english } from '../en/en.js'

export const welsh = english
