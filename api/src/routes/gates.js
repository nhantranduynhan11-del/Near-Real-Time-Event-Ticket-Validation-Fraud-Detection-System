'use strict';

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const { authenticate } = require('../auth');
const { badRequest, notFound } = require('../errors');

const router = express.Router();
router.use(authenticate);

const ID_RE = /^[A-Z0-9_]{1,20}$/;

// Cả hai vai trò đều đọc được danh sách cổng: trang quét của GATE_OPERATOR
// cần ô chọn cổng (file 15 mục 0, mục 4.2).
router.get('/', async (req, res, next) => {
  try {
    const pool = await db.getPool();
    const result = await pool
      .request()
      .query('SELECT gate_id, gate_name FROM dbo.gate ORDER BY gate_id');
    return res.json(result.recordset);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const gateId = req.params.id;
    if (!ID_RE.test(gateId)) {
      throw badRequest([{ field: ':id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' }]);
    }

    const pool = await db.getPool();
    const gate = await pool
      .request()
      .input('gate_id', sql.NVarChar(20), gateId)
      .query('SELECT gate_id, gate_name FROM dbo.gate WHERE gate_id = @gate_id');
    if (gate.recordset.length === 0) throw notFound('GATE_NOT_FOUND', 'Không có cổng này.');

    const scanners = await pool
      .request()
      .input('gate_id', sql.NVarChar(20), gateId)
      .query(
        `SELECT scanner_id, gate_id
         FROM dbo.scanner
         WHERE gate_id = @gate_id
         ORDER BY scanner_id`
      );

    return res.json({
      ...gate.recordset[0],
      scanner_ids: scanners.recordset.map((s) => s.scanner_id),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
