'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const kafka = require('../kafka');
const { toVietnamISO, parseISOWithOffset } = require('../time');

const router = express.Router();

const ID_RE = /^[A-Z0-9_]{1,20}$/;

function badRequest(res, details) {
  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu gửi lên không hợp lệ.',
      details,
    },
  });
}

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const details = [];

    // raw_qr_payload: bắt buộc, không rỗng, <= 512
    if (typeof body.raw_qr_payload !== 'string' || body.raw_qr_payload.length === 0) {
      details.push({ field: 'raw_qr_payload', issue: 'Bắt buộc, không được rỗng' });
    } else if (body.raw_qr_payload.length > 512) {
      details.push({ field: 'raw_qr_payload', issue: 'Tối đa 512 ký tự' });
    }

    // decode_error: bắt buộc, boolean
    if (typeof body.decode_error !== 'boolean') {
      details.push({ field: 'decode_error', issue: 'Bắt buộc, kiểu boolean' });
    }

    // ticket_id: bắt buộc khi decode_error = false, phải null khi decode_error = true
    // NGOẠI LỆ file 15 mục 0: KHÔNG kiểm tra regex ID_RE ở đây,
    // vì mã lạ phải đi tiếp tới Spark để cho INVALID_QR.
    if (body.decode_error === false) {
      if (typeof body.ticket_id !== 'string' || body.ticket_id.length === 0) {
        details.push({ field: 'ticket_id', issue: 'Bắt buộc khi decode_error = false' });
      }
    } else if (body.decode_error === true) {
      if (body.ticket_id !== null && body.ticket_id !== undefined) {
        details.push({ field: 'ticket_id', issue: 'Phải là null khi decode_error = true' });
      }
    }

    // gate_id, scanner_id: bắt buộc, đúng regex ID
    if (typeof body.gate_id !== 'string' || !ID_RE.test(body.gate_id)) {
      details.push({ field: 'gate_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }
    if (typeof body.scanner_id !== 'string' || !ID_RE.test(body.scanner_id)) {
      details.push({ field: 'scanner_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }

    // scanned_at: bắt buộc, ISO 8601 có offset
    const scannedAtDate = parseISOWithOffset(body.scanned_at);
    if (!scannedAtDate) {
      details.push({ field: 'scanned_at', issue: 'Bắt buộc, ISO 8601 kèm offset (+07:00 hoặc Z)' });
    }

    if (details.length > 0) {
      return badRequest(res, details);
    }

    // Sinh scan_event_id và received_at phía server
    const scanEventId = uuidv4();
    const receivedAt = toVietnamISO();

    // operator_id: Task 3 chưa có auth → null.
    // Phase 5 khi có POST /api/login sẽ lấy từ token.sub (file 15 mục 2.1).
    const operatorId = null;

    const payload = {
      scan_event_id: scanEventId,
      raw_qr_payload: body.raw_qr_payload,
      ticket_id: body.decode_error === true ? null : body.ticket_id,
      decode_error: body.decode_error,
      gate_id: body.gate_id,
      scanner_id: body.scanner_id,
      operator_id: operatorId,
      scanned_at: toVietnamISO(scannedAtDate), // chuẩn hóa về +07:00
      received_at: receivedAt,
    };

    try {
      await kafka.sendScanEvent(payload);
    } catch (err) {
      console.error('[scan] Kafka send failed:', err.message);
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Không đẩy được vào hàng đợi Kafka.',
        },
      });
    }

    // Task 3: Spark mới ghi Bronze, chưa có scan_result.
    // Trả 202 PROCESSING đúng file 15 mục 2.1.
    return res.status(202).json({
      scan_event_id: scanEventId,
      received_at: receivedAt,
      status: 'PROCESSING',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;