/**
 * Global Error Handler Middleware
 * 
 * Catches all unhandled errors and returns a standardized error response.
 * Must be registered LAST in the middleware chain (after all routes).
 */

const { error } = require('../utils/apiResponse');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Log the error with context for debugging
  console.error(`[ERROR] ${req.method} ${req.path}:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    userId: req.user?.id || 'unauthenticated',
  });

  // Prisma known request errors (validation, not found, etc.)
  if (err.code === 'P2002') {
    return error(res, 'DUPLICATE_ENTRY', 'A record with this value already exists.', 409);
  }
  if (err.code === 'P2025') {
    return error(res, 'NOT_FOUND', 'The requested record was not found.', 404);
  }

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return error(res, 'FILE_TOO_LARGE', 'File exceeds the maximum allowed size.', 413);
  }
  if (err.name === 'MulterError') {
    return error(res, 'UPLOAD_ERROR', err.message || 'File upload failed.', 400);
  }
  if (err.message && typeof err.message === 'string' && err.message.startsWith('Only ')) {
    // Multer fileFilter rejections (cb(new Error(...))) — surface as 400
    return error(res, 'INVALID_FILE_TYPE', err.message, 400);
  }

  // Express-validator errors are handled in routes, but catch any escapes
  if (err.type === 'entity.parse.failed') {
    return error(res, 'INVALID_JSON', 'Request body contains invalid JSON.', 400);
  }

  // Default: Internal Server Error
  return error(
    res,
    'INTERNAL_ERROR',
    process.env.NODE_ENV === 'development' ? err.message : 'An internal server error occurred.',
    500
  );
}

module.exports = errorHandler;
