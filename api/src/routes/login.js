'use strict';

const express = require('express');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signAccessToken } = require('../auth');
const { ApiError, badRequest } = require('../errors');

const router = express.Router();

// Hash giả để trường hợp không có username vẫn tốn thời gian bcrypt tương đương,
// tránh lộ tài khoản có tồn tại hay không qua thời gian phản hồi.
const DUMMY_HASH = '$2b$10$uFh.p9INxlgA5mFgk14A3efGe603s2Hc/oBhFCU0X2Gv6jJRPFWJa';

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const details = [];

    if (typeof body.username !== 'string' || body.username.trim() === '') {
      details.push({ field: 'username', issue: 'Bắt buộc' });
    }
    if (typeof body.password !== 'string' || body.password === '') {
      details.push({ field: 'password', issue: 'Bắt buộc' });
    }
    if (details.length > 0) throw badRequest(details);

    const username = body.username.trim();
    const pool = await db.getPool();
    const result = await pool
      .request()
      .input('username', sql.NVarChar(50), username)
      .query(
        `SELECT user_id, username, password_hash, last_name, first_name, role
         FROM dbo.app_user
         WHERE username = @username`
      );

    const user = result.recordset[0];
    const passwordOk = bcrypt.compareSync(body.password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      // Một thông báo chung cho sai tên đăng nhập và sai mật khẩu.
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
    }

    const { token, expiresIn } = signAccessToken(user);
    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: {
        user_id: user.user_id,
        username: user.username,
        last_name: user.last_name,
        first_name: user.first_name,
        role: user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
