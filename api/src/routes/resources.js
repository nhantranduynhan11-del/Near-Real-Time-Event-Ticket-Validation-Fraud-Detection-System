'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Lấy danh sách cổng (dùng cho trang quét của D)
router.get('/gates', requireAuth, async (req, res, next) => {
  try {
    const pool = await db.getPool();
    const result = await pool.request().query('SELECT gate_id, gate_name FROM GATE');
    res.json({ items: result.recordset });
  } catch (err) { next(err); }
});

// Lấy danh sách máy quét
router.get('/scanners', requireAuth, async (req, res, next) => {
  try {
    const pool = await db.getPool();
    const result = await pool.request().query('SELECT scanner_id, gate_id FROM SCANNER');
    res.json({ items: result.recordset });
  } catch (err) { next(err); }
});

module.exports = router;