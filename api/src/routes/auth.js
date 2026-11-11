'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sql = require('mssql');
const db = require('../db');
const config = require('../config');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Thiếu username hoặc password' }
      });
    }

    const pool = await db.getPool();
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query(`
        SELECT user_id, username, password_hash, last_name, first_name, role 
        FROM APP_USER 
        WHERE username = @username
      `);

    const user = result.recordset[0];
    
    // Kiểm tra mật khẩu
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Sai tài khoản hoặc mật khẩu' }
      });
    }

    // Tạo JWT Token
    const token = jwt.sign(
      { sub: user.user_id, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 43200, // 12 tiếng
      user: {
        user_id: user.user_id,
        username: user.username,
        last_name: user.last_name,
        first_name: user.first_name,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;