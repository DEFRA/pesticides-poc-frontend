export const statusCodes = {
  ok: 200,
  noContent: 204,
  redirect: 302,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  imATeapot: 418,
  unprocessableEntity: 422,
  internalServerError: 500
}

// Exclusive upper bound of the HTTP status-code range (all statuses are < 600).
export const HTTP_STATUS_EXCLUSIVE_MAX = 600
