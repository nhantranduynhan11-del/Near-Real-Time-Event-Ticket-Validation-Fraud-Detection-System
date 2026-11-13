'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');
const { ApiError, unauthorized, forbidden } = require('./errors');

const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * Ký JWT cho một người dùng đã đăng nhập.
 * Claim `sub` = user_id, `role` = vai trò (file 15 mục 0).
 */
function signAccessToken(user) {
  const token = jwt.sign(
    { sub: user.user_id, role: user.role },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: config.jwt.expiresIn }
  );
  const payload = jwt.decode(token);
  return { token, expiresIn: payload.exp - payload.iat };
}

/**
 * Middleware xác thực: gắn req.user = { user_id, role }.
 * Thiếu token / token hỏng → 401 UNAUTHENTICATED; hết hạn → 401 TOKEN_EXPIRED.
 */
function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const match = BEARER_RE.exec(header);
  if (!match) {
    return next(unauthorized('UNAUTHENTICATED', 'Thiếu token Bearer.'));
  }

  let payload;
  try {
    payload = jwt.verify(match[1], config.jwt.secret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return next(unauthorized('TOKEN_EXPIRED', 'Token đã hết hạn.'));
    }
    return next(unauthorized('UNAUTHENTICATED', 'Token không hợp lệ.'));
  }

  if (!payload || typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
    return next(unauthorized('UNAUTHENTICATED', 'Token thiếu claim sub hoặc role.'));
  }

  req.user = { user_id: payload.sub, role: payload.role };
  return next();
}

/**
 * Middleware phân quyền theo vai trò. Phải đứng sau authenticate.
 * Có token nhưng sai vai trò → 403 FORBIDDEN (file 15 mục 0).
 */
function requireRole(...roles) {
  const allowed = new Set(roles);
  return function checkRole(req, res, next) {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Thiếu token.'));
    if (!allowed.has(req.user.role)) return next(forbidden());
    return next();
  };
}

module.exports = { signAccessToken, authenticate, requireRole };
