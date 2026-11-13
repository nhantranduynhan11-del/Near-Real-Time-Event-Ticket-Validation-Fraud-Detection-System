'use strict';

const express = require('express');
const sql = require('mssql');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const kafka = require('../kafka');
const config = require('../config');
const { authenticate, requireRole } = require('../auth');
const { verifyTicketQr } = require('../qr');
const { badRequest, notFound, unprocessable } = require('../errors');
const { toVietnamISO, dbToVietnamISO, parseISOWithOffset } = require('../time');

const router = express.Router();
router.use(authenticate);

const ID_RE = /^[A-Z0-9_]{1,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCAN_TTL_MS = 5 * 60 * 1000; // GET /scan/:id chỉ nhận mã còn trong 5 phút (file 15 mục 2.2)
const POLL_INTERVAL_MS = 100;

// Bộ nhớ tạm: scan_event_id API đã cấp nhưng Silver chưa có dòng.
// MVP chạy một thể hiện API nên đủ; API khởi động lại thì danh sách mất.
const issuedScans = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rememberScan(scanEventId, receivedAt) {
  issuedScans.set(scanEventId, { receivedAt, expiresAt: Date.now() + SCAN_TTL_MS });
  if (issuedScans.size > 5000) cleanupIssuedScans();
}

function recallScan(scanEventId) {
  const item = issuedScans.get(scanEventId);
  if (!item) return null;
  if (Date.now() >= item.expiresAt) {
    issuedScans.delete(scanEventId);
    return null;
  }
  return item;
}

function cleanupIssuedScans() {
  const now = Date.now();
  for (const [id, item] of issuedScans) {
    if (now >= item.expiresAt) issuedScans.delete(id);
  }
}

const cleanupTimer = setInterval(cleanupIssuedScans, 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function completedBody(row) {
  return {
    scan_event_id: String(row.scan_event_id).toLowerCase(),
    received_at: dbToVietnamISO(row.received_at),
    status: 'COMPLETED',
    scan_result: row.scan_result,
    entry: row.scan_result === 'VALID' ? 'ALLOW' : 'DENY',
    alert_level: row.alert_level,
    alert_code: row.alert_code,
    // Chỉ trả cổng đúng khi WRONG_GATE, để nhân viên chỉ khách sang cổng.
    ticket_assigned_gate_id: row.scan_result === 'WRONG_GATE' ? row.ticket_assigned_gate_id : null,
  };
}

async function readScanEvent(pool, scanEventId) {
  const result = await pool
    .request()
    .input('scan_event_id', sql.UniqueIdentifier, scanEventId)
    .query(
      `SELECT scan_event_id, received_at, scan_result, alert_level, alert_code,
              ticket_assigned_gate_id
       FROM dbo.scan_event
       WHERE scan_event_id = @scan_event_id`
    );
  return result.recordset[0] || null;
}

async function waitForScanEvent(pool, scanEventId) {
  const deadline = Date.now() + config.scan.waitMs;
  let row = await readScanEvent(pool, scanEventId);
  while (!row && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    row = await readScanEvent(pool, scanEventId);
  }
  return row;
}

// ---------------------------------------------------------------------------
// POST /api/scan — nhận lượt quét, đẩy Kafka, chờ Spark ghi Silver
// ---------------------------------------------------------------------------
router.post('/', requireRole('GATE_OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const details = [];

    if (typeof body.raw_qr_payload !== 'string' || body.raw_qr_payload.length === 0) {
      details.push({ field: 'raw_qr_payload', issue: 'Bắt buộc, không được rỗng' });
    } else if (body.raw_qr_payload.length > 512) {
      details.push({ field: 'raw_qr_payload', issue: 'Tối đa 512 ký tự' });
    }

    if (typeof body.decode_error !== 'boolean') {
      details.push({ field: 'decode_error', issue: 'Bắt buộc, kiểu boolean' });
    } else if (body.decode_error === false) {
      if (typeof body.ticket_id !== 'string' || body.ticket_id.length === 0) {
        details.push({ field: 'ticket_id', issue: 'Bắt buộc khi decode_error = false' });
      }
    } else if (body.ticket_id !== null) {
      details.push({ field: 'ticket_id', issue: 'Phải là null khi decode_error = true' });
    }

    if (typeof body.gate_id !== 'string' || !ID_RE.test(body.gate_id)) {
      details.push({ field: 'gate_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }
    if (typeof body.scanner_id !== 'string' || !ID_RE.test(body.scanner_id)) {
      details.push({ field: 'scanner_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }

    const scannedAt = parseISOWithOffset(body.scanned_at);
    if (!scannedAt) {
      details.push({ field: 'scanned_at', issue: 'Bắt buộc, ISO 8601 kèm offset' });
    }

    if (details.length > 0) throw badRequest(details);

    // 1. Kiểm chữ ký QR trước khi đẩy Kafka.
    // Sai chữ ký / sai cấu trúc: vẫn đi tiếp với decode_error = true, ticket_id = null.
    // Đây là kiểm tra toàn vẹn dữ liệu, không phải kết luận nghiệp vụ (file 15 mục 2.1).
    let decodeError = body.decode_error;
    let ticketId = null;
    if (!decodeError) {
      const verifiedTicketId = verifyTicketQr(body.raw_qr_payload, config.qr.secret);
      if (verifiedTicketId) {
        ticketId = verifiedTicketId; // ghi đè ticket_id client gửi
      } else {
        decodeError = true;
      }
    }

    // 2. Cổng và máy quét phải có thật, máy phải đặt đúng cổng.
    const pool = await db.getPool();
    const gate = await pool
      .request()
      .input('gate_id', sql.NVarChar(20), body.gate_id)
      .query('SELECT gate_id FROM dbo.gate WHERE gate_id = @gate_id');
    if (gate.recordset.length === 0) {
      throw unprocessable('UNKNOWN_GATE', 'gate_id không có trong bảng gate.');
    }

    const scanner = await pool
      .request()
      .input('scanner_id', sql.NVarChar(20), body.scanner_id)
      .query('SELECT scanner_id, gate_id FROM dbo.scanner WHERE scanner_id = @scanner_id');
    if (scanner.recordset.length === 0) {
      throw unprocessable('UNKNOWN_SCANNER', 'scanner_id không có trong bảng scanner.');
    }
    if (scanner.recordset[0].gate_id !== body.gate_id) {
      throw unprocessable(
        'SCANNER_GATE_MISMATCH',
        `Máy ${body.scanner_id} đặt tại ${scanner.recordset[0].gate_id}, không phải ${body.gate_id}.`
      );
    }

    // 3. Sinh mã lượt quét và đẩy đúng 9 trường Bronze (file 13 phần A).
    const scanEventId = uuidv4();
    const receivedAt = toVietnamISO();
    const payload = {
      scan_event_id: scanEventId,
      raw_qr_payload: body.raw_qr_payload,
      ticket_id: ticketId,
      decode_error: decodeError,
      gate_id: body.gate_id,
      scanner_id: body.scanner_id,
      operator_id: req.user.user_id,
      scanned_at: toVietnamISO(scannedAt),
      received_at: receivedAt,
    };

    try {
      await kafka.sendScanEvent(payload);
    } catch (err) {
      console.error('[scan] Kafka send failed:', err.message);
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Không đẩy được vào hàng đợi Kafka.' },
      });
    }

    rememberScan(scanEventId, receivedAt);

    // 4. Chờ tối đa SCAN_WAIT_MS để Spark ghi scan_event.
    let row = null;
    try {
      row = await waitForScanEvent(pool, scanEventId);
    } catch (err) {
      // Đã nhận lượt quét rồi; lỗi đọc DB không được làm thiết bị gửi lại.
      console.error('[scan] Không đọc được kết quả, trả 202:', err.message);
    }

    if (row) return res.json(completedBody(row));
    return res.status(202).json({
      scan_event_id: scanEventId,
      received_at: receivedAt,
      status: 'PROCESSING',
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/scan/:scan_event_id — thiết bị hỏi lại khi POST trả 202
// ---------------------------------------------------------------------------
router.get('/:scan_event_id', requireRole('GATE_OPERATOR'), async (req, res, next) => {
  try {
    const rawId = req.params.scan_event_id;
    if (!UUID_RE.test(rawId)) {
      throw badRequest([{ field: 'scan_event_id', issue: 'Phải là UUID' }]);
    }
    const scanEventId = rawId.toLowerCase();

    const pool = await db.getPool();
    const row = await readScanEvent(pool, scanEventId);
    if (row) return res.json(completedBody(row));

    const pending = recallScan(scanEventId);
    if (pending) {
      return res.status(202).json({
        scan_event_id: scanEventId,
        received_at: pending.receivedAt,
        status: 'PROCESSING',
      });
    }

    throw notFound('SCAN_NOT_FOUND', 'Không biết mã này, hoặc đã quá 5 phút mà chưa có kết quả.');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
