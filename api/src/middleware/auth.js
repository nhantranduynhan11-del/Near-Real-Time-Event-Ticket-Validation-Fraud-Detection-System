'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

// 1. Hàm kiểm tra token
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: { code: 'UNAUTHENTICATED', message: 'Thiếu hoặc sai token' } 
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded; // Lưu { sub, role } vào request
    next();
  } catch (err) {
    return res.status(401).json({ 
      error: { code: 'TOKEN_EXPIRED', message: 'Token sai hoặc đã hết hạn' } 
    });
  }
}

// 2. Hàm kiểm tra vai trò
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ 
        error: { code: 'FORBIDDEN', message: 'Không có quyền truy cập' } 
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };