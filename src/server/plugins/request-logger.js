import hapiPino from 'hapi-pino'

import { loggerOptions } from './logger-options.js'

const pathToIgnore = (_, request) =>
  request.path.startsWith('/public') ||
  request.path === '/health' ||
  request.path === '/favicon.ico'

const requestLogger = {
  plugin: hapiPino,
  options: {
    ignoreFunc: pathToIgnore,
    ...loggerOptions
  }
}

export { requestLogger }
