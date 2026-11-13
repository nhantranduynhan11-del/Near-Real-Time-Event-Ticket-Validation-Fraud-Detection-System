'use strict';

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const { authenticate } = require('../auth');
const { badRequest, notFound } = require('../errors');

const router = express.Router();
router.use(authenticate);

const ID_RE = /^[A-Z0-9_]{1,20}$/;

// Trang quét cần danh sách máy quét theo cổng; cả hai vai trò đều đọc được.
router.get('/', async (req, res, next) => {
  try {
    const gateId = req.query.gate_id;
    if (gateId !== undefined && (typeof gateId !== 'string' || !ID_RE.test(gateId))) {
      throw badRequest([{ field: 'gate_id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' }]);
    }

    const pool = await db.getPool();
    const request = pool.request();
    let where = '';
    if (gateId) {
      request.input('gate_id', sql.NVarChar(20), gateId);
      where = 'WHERE gate_id = @gate_id';
    }
    const result = await request.query(
      `SELECT scanner_id, gate_id FROM dbo.scanner ${where} ORDER BY scanner_id`
    );
    return res.json(result.recordset);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const scannerId = req.params.id;
    if (!ID_RE.test(scannerId)) {
      throw badRequest([{ field: ':id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' }]);
    }
    const pool = await db.getPool();
    const result = await pool
      .request()
      .input('scanner_id', sql.NVarChar(20), scannerId)
      .query('SELECT scanner_id, gate_id FROM dbo.scanner WHERE scanner_id = @scanner_id');
    if (result.recordset.length === 0) {
      throw notFound('SCANNER_NOT_FOUND', 'Không có máy quét này.');
    }
    return res.json(result.recordset[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
