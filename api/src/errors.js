'use strict';

/**
 * Lỗi có mã HTTP + error.code ổn định cho giao diện (file 15 mục 0).
 * Handler chung ở index.js biến lỗi này thành JSON đúng dạng.
 */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function badRequest(details) {
  return new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không hợp lệ.', details);
}

function unauthorized(code = 'UNAUTHENTICATED', message = 'Thiếu hoặc sai token.') {
  return new ApiError(401, code, message);
}

function forbidden(message = 'Tài khoản không có quyền gọi endpoint này.') {
  return new ApiError(403, 'FORBIDDEN', message);
}

function notFound(code, message) {
  return new ApiError(404, code, message);
}

function conflict(code, message, details) {
  return new ApiError(409, code, message, details);
}

function unprocessable(code, message, details) {
  return new ApiError(422, code, message, details);
}

function serviceUnavailable(message = 'Cơ sở dữ liệu hoặc hàng đợi không dùng được.') {
  return new ApiError(503, 'SERVICE_UNAVAILABLE', message);
}

// Lỗi kết nối SQL Server / Kafka của driver: trả 503 thay vì 500.
function isDependencyError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (['ESOCKET', 'ECONNCLOSED', 'ECONNRESET', 'ETIMEOUT', 'ENOTOPEN', 'ELOGIN', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  return /connection|connect|login failed|failed to connect/i.test(String(err.message || ''));
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    const body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Body JSON không đọc được.' },
    });
  }

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Body quá lớn.' },
    });
  }

  if (isDependencyError(err)) {
    console.error('[error] dependency:', err.message);
    return res.status(503).json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Cơ sở dữ liệu hoặc hàng đợi không dùng được.' },
    });
  }

  console.error('[error]', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Lỗi không lường trước.' },
  });
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  serviceUnavailable,
  errorHandler,
};
