import { statusCodes } from '../constants/status-codes.js'

function statusCodeMessage(statusCode) {
  switch (statusCode) {
    case statusCodes.notFound:
      return 'Page not found'
    case statusCodes.forbidden:
      return 'Forbidden'
    case statusCodes.unauthorized:
      return 'Unauthorized'
    case statusCodes.unprocessableEntity:
      return 'Unprocessable request'
    case statusCodes.badRequest:
      return 'Bad Request'
    default:
      return 'Something went wrong'
  }
}

// Recover the intended HTTP status from errors thrown by the auth/OIDC layer.
// Those are plain Error objects carrying a numeric `statusCode` (e.g. 401/422);
// Hapi boomifies a non-Boom throw to 500 without reading that property, so the
// intended status would otherwise be lost. Only override when Hapi defaulted to
// 500 and the error advertised a valid client/server error status.
function resolveStatusCode(response) {
  const boomStatus = response.output.statusCode
  const intended = response.statusCode
  const recoverable =
    boomStatus === statusCodes.internalServerError &&
    Number.isInteger(intended) &&
    intended >= statusCodes.badRequest &&
    intended < 600
  return recoverable ? intended : boomStatus
}

export function catchAll(request, h) {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  const statusCode = resolveStatusCode(response)
  const errorMessage = statusCodeMessage(statusCode)

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response?.stack)
  }

  return h
    .view('error/index', {
      pageTitle: errorMessage,
      heading: statusCode,
      message: errorMessage
    })
    .code(statusCode)
}
