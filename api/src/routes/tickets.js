'use strict';

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const { authenticate, requireRole } = require('../auth');
const { signTicketQr } = require('../qr');
const config = require('../config');
const { badRequest, notFound, conflict, unprocessable } = require('../errors');
const { dbToVietnamISO } = require('../time');

const router = express.Router();
router.use(authenticate);

const ID_RE = /^[A-Z0-9_]{1,20}$/;
const TICKET_STATUSES = ['UNUSED', 'VALID_ENTRY', 'FLAGGED_FRAUD', 'EXPIRED', 'CANCELLED'];

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function requireTicketId(value, field = 'ticket_id') {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw badRequest([{ field, issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' }]);
  }
  return value;
}

function optionalGateId(value, field = 'assigned_gate_id') {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw badRequest([{ field, issue: 'Phải là null hoặc khớp ^[A-Z0-9_]{1,20}$' }]);
  }
  return value;
}

function parsePagination(query) {
  const parse = (raw, fallback, max) => {
    if (raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    if (n < 1) return null;
    return Math.min(n, max);
  };
  const page = parse(query.page, 1, 1_000_000);
  const pageSize = parse(query.page_size, 50, 200);
  if (page === null) throw badRequest([{ field: 'page', issue: 'Số nguyên >= 1' }]);
  if (pageSize === null) throw badRequest([{ field: 'page_size', issue: 'Số nguyên từ 1 đến 200' }]);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function ticketJson(row) {
  return {
    ticket_id: row.ticket_id,
    event_id: row.event_id,
    assigned_gate_id: row.assigned_gate_id,
    ticket_status: row.ticket_status,
  };
}

function scanJson(row) {
  return {
    scan_event_id: String(row.scan_event_id).toLowerCase(),
    gate_id: row.gate_id,
    scanner_id: row.scanner_id,
    received_at: dbToVietnamISO(row.received_at),
    scanned_at: dbToVietnamISO(row.scanned_at),
    scan_result: row.scan_result,
    alert_level: row.alert_level,
    alert_code: row.alert_code,
    ticket_status_before: row.ticket_status_before,
    ticket_status_after: row.ticket_status_after,
    previous_scan_event_id: row.previous_scan_event_id
      ? String(row.previous_scan_event_id).toLowerCase()
      : null,
    previous_scan_gate_id: row.previous_scan_gate_id,
    time_since_previous_scan_ms: row.time_since_previous_scan_ms,
    min_travel_time_ms: row.min_travel_time_ms,
    ticket_assigned_gate_id: row.ticket_assigned_gate_id,
    distinct_wrong_gate_count: row.distinct_wrong_gate_count,
  };
}

async function loadTicket(pool, ticketId) {
  const result = await pool
    .request()
    .input('ticket_id', sql.NVarChar(20), ticketId)
    .query(
      `SELECT ticket_id, event_id, assigned_gate_id, ticket_status
       FROM dbo.ticket
       WHERE ticket_id = @ticket_id`
    );
  return result.recordset[0] || null;
}

async function loadScans(pool, ticketId) {
  const result = await pool
    .request()
    .input('ticket_id', sql.NVarChar(20), ticketId)
    .query(
      `SELECT scan_event_id, gate_id, scanner_id, received_at, scanned_at,
              scan_result, alert_level, alert_code,
              ticket_status_before, ticket_status_after,
              previous_scan_event_id, previous_scan_gate_id,
              time_since_previous_scan_ms, min_travel_time_ms,
              ticket_assigned_gate_id, distinct_wrong_gate_count
       FROM dbo.scan_event
       WHERE ticket_id = @ticket_id
       ORDER BY received_at ASC, scan_event_id ASC`
    );
  return result.recordset.map(scanJson);
}

function sqlErrorNumber(err) {
  if (!err) return null;
  if (typeof err.number === 'number') return err.number;
  if (err.originalError && typeof err.originalError.number === 'number') return err.originalError.number;
  if (err.originalError && err.originalError.info && typeof err.originalError.info.number === 'number') {
    return err.originalError.info.number;
  }
  return null;
}

async function eventExists(pool, eventId) {
  const result = await pool
    .request()
    .input('event_id', sql.NVarChar(20), eventId)
    .query('SELECT 1 AS ok FROM dbo.[event] WHERE event_id = @event_id');
  return result.recordset.length > 0;
}

async function gateInEvent(pool, eventId, gateId) {
  const result = await pool
    .request()
    .input('event_id', sql.NVarChar(20), eventId)
    .input('gate_id', sql.NVarChar(20), gateId)
    .query(
      `SELECT 1 AS ok
       FROM dbo.event_gate
       WHERE event_id = @event_id AND gate_id = @gate_id`
    );
  return result.recordset.length > 0;
}

// ---------------------------------------------------------------------------
// GET /api/tickets — danh sách, phân trang, lọc (file 15 mục 3.2)
// ---------------------------------------------------------------------------
router.get('/', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const details = [];

    const eventId = req.query.event_id;
    if (eventId !== undefined && (typeof eventId !== 'string' || !ID_RE.test(eventId))) {
      details.push({ field: 'event_id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' });
    }

    const status = req.query.ticket_status;
    if (status !== undefined && !TICKET_STATUSES.includes(status)) {
      details.push({ field: 'ticket_status', issue: `Một trong ${TICKET_STATUSES.join(', ')}` });
    }

    const gateId = req.query.assigned_gate_id;
    if (gateId !== undefined && (typeof gateId !== 'string' || !ID_RE.test(gateId))) {
      details.push({ field: 'assigned_gate_id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' });
    }

    const q = req.query.q;
    if (q !== undefined && (typeof q !== 'string' || q.length > 20 || !/^[A-Za-z0-9_]*$/.test(q))) {
      details.push({ field: 'q', issue: 'Tiền tố ticket_id, tối đa 20 ký tự A-Z, a-z, 0-9, _' });
    }

    if (details.length > 0) throw badRequest(details);

    const pool = await db.getPool();
    const build = (withPaging) => {
      const request = pool.request();
      if (withPaging) {
        request.input('offset', sql.Int, offset);
        request.input('page_size', sql.Int, pageSize);
      }
      const where = [];
      if (eventId) {
        request.input('event_id', sql.NVarChar(20), eventId);
        where.push('event_id = @event_id');
      }
      if (status) {
        request.input('ticket_status', sql.NVarChar(20), status);
        where.push('ticket_status = @ticket_status');
      }
      if (gateId) {
        request.input('assigned_gate_id', sql.NVarChar(20), gateId);
        where.push('assigned_gate_id = @assigned_gate_id');
      }
      if (q) {
        request.input('q', sql.NVarChar(20), q);
        // LEFT(...) thay vì LIKE để '_' trong mã vé không bị coi là ký tự đại diện.
        where.push('LEFT(ticket_id, LEN(@q)) = @q');
      }
      return { request, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
    };

    const countBuilt = build(false);
    const countResult = await countBuilt.request.query(
      `SELECT COUNT(*) AS total FROM dbo.ticket ${countBuilt.whereSql}`
    );

    const itemsBuilt = build(true);
    const itemsResult = await itemsBuilt.request.query(
      `SELECT ticket_id, event_id, assigned_gate_id, ticket_status
       FROM dbo.ticket
       ${itemsBuilt.whereSql}
       ORDER BY ticket_id
       OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY`
    );

    return res.json({
      items: itemsResult.recordset.map(ticketJson),
      page,
      page_size: pageSize,
      total: countResult.recordset[0].total,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/tickets/:id/qr — chuỗi QR đã ký (file 15 mục 3.8)
// ---------------------------------------------------------------------------
router.get('/:id/qr', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const ticketId = requireTicketId(req.params.id, ':id');
    const pool = await db.getPool();
    const ticket = await loadTicket(pool, ticketId);
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');

    return res.json({
      ticket_id: ticket.ticket_id,
      qr_payload: signTicketQr(ticket.ticket_id, config.qr.secret),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/tickets/:id — chi tiết + lịch sử quét
// ---------------------------------------------------------------------------
router.get('/:id', requireRole('GATE_OPERATOR', 'EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const ticketId = requireTicketId(req.params.id, ':id');
    const pool = await db.getPool();
    const ticket = await loadTicket(pool, ticketId);
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');

    const scans = await loadScans(pool, ticketId);
    const valid = scans.find((s) => s.scan_result === 'VALID') || null;
    const last = scans.length > 0 ? scans[scans.length - 1] : null;

    return res.json({
      ...ticketJson(ticket),
      scan_count: scans.length,
      valid_entry: valid
        ? { scan_event_id: valid.scan_event_id, gate_id: valid.gate_id, received_at: valid.received_at }
        : null,
      last_scan: last
        ? {
            scan_event_id: last.scan_event_id,
            gate_id: last.gate_id,
            received_at: last.received_at,
            scan_result: last.scan_result,
          }
        : null,
      scans,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tickets — tạo vé (file 15 mục 3.3)
// ---------------------------------------------------------------------------
router.post('/', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (hasOwn(body, 'ticket_status')) {
      throw unprocessable('FIELD_NOT_EDITABLE', 'Không nhận ticket_status khi tạo vé; vé mới luôn là UNUSED.');
    }

    const details = [];
    if (typeof body.ticket_id !== 'string' || !ID_RE.test(body.ticket_id)) {
      details.push({ field: 'ticket_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }
    if (typeof body.event_id !== 'string' || !ID_RE.test(body.event_id)) {
      details.push({ field: 'event_id', issue: 'Bắt buộc, khớp ^[A-Z0-9_]{1,20}$' });
    }
    let assignedGateId = null;
    if (body.assigned_gate_id !== undefined && body.assigned_gate_id !== null) {
      if (typeof body.assigned_gate_id !== 'string' || !ID_RE.test(body.assigned_gate_id)) {
        details.push({ field: 'assigned_gate_id', issue: 'null hoặc khớp ^[A-Z0-9_]{1,20}$' });
      } else {
        assignedGateId = body.assigned_gate_id;
      }
    }
    if (details.length > 0) throw badRequest(details);

    const pool = await db.getPool();
    if (!(await eventExists(pool, body.event_id))) {
      throw unprocessable('EVENT_NOT_FOUND', 'event_id không tồn tại.');
    }
    if (assignedGateId && !(await gateInEvent(pool, body.event_id, assignedGateId))) {
      throw unprocessable('GATE_NOT_IN_EVENT', 'Cổng không nằm trong các cổng của sự kiện.');
    }

    try {
      await pool
        .request()
        .input('ticket_id', sql.NVarChar(20), body.ticket_id)
        .input('event_id', sql.NVarChar(20), body.event_id)
        .input('assigned_gate_id', sql.NVarChar(20), assignedGateId)
        .query(
          `INSERT INTO dbo.ticket (ticket_id, event_id, assigned_gate_id, ticket_status)
           VALUES (@ticket_id, @event_id, @assigned_gate_id, N'UNUSED')`
        );
    } catch (err) {
      const number = sqlErrorNumber(err);
      if (number === 2627 || number === 2601) {
        throw conflict('TICKET_ALREADY_EXISTS', 'ticket_id đã tồn tại.');
      }
      if (number === 547) {
        throw unprocessable('GATE_NOT_IN_EVENT', 'Cổng hoặc sự kiện không hợp lệ.');
      }
      throw err;
    }

    const created = await loadTicket(pool, body.ticket_id);
    return res.status(201).json(ticketJson(created));
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tickets/:id — chỉ sửa assigned_gate_id (file 15 mục 3.4)
// ---------------------------------------------------------------------------
router.put('/:id', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const ticketId = requireTicketId(req.params.id, ':id');
    const body = req.body || {};

    if (hasOwn(body, 'event_id') || hasOwn(body, 'ticket_status')) {
      throw unprocessable(
        'FIELD_NOT_EDITABLE',
        'Chỉ sửa được assigned_gate_id; event_id và ticket_status là bất biến.'
      );
    }
    if (!hasOwn(body, 'assigned_gate_id')) {
      throw badRequest([{ field: 'assigned_gate_id', issue: 'Bắt buộc (có thể là null)' }]);
    }
    const assignedGateId = optionalGateId(body.assigned_gate_id);

    const pool = await db.getPool();
    const ticket = await loadTicket(pool, ticketId);
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');
    if (ticket.ticket_status !== 'UNUSED') {
      throw conflict('TICKET_NOT_EDITABLE', 'Chỉ sửa được cổng của vé còn UNUSED.');
    }
    if (assignedGateId && !(await gateInEvent(pool, ticket.event_id, assignedGateId))) {
      throw unprocessable('GATE_NOT_IN_EVENT', 'Cổng không thuộc sự kiện của vé.');
    }

    const result = await pool
      .request()
      .input('ticket_id', sql.NVarChar(20), ticketId)
      .input('assigned_gate_id', sql.NVarChar(20), assignedGateId)
      .query(
        `UPDATE dbo.ticket
         SET assigned_gate_id = @assigned_gate_id
         WHERE ticket_id = @ticket_id AND ticket_status = N'UNUSED'`
      );

    if (result.rowsAffected[0] === 0) {
      const current = await loadTicket(pool, ticketId);
      if (!current) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');
      throw conflict('TICKET_NOT_EDITABLE', 'Vé vừa đổi khỏi UNUSED, không sửa được nữa.');
    }

    return res.json(ticketJson(await loadTicket(pool, ticketId)));
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/cancel — thu hồi vé (file 15 mục 3.5)
// ---------------------------------------------------------------------------
router.post('/:id/cancel', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const ticketId = requireTicketId(req.params.id, ':id');
    const pool = await db.getPool();
    const result = await pool
      .request()
      .input('ticket_id', sql.NVarChar(20), ticketId)
      .query(
        `UPDATE dbo.ticket
         SET ticket_status = N'CANCELLED'
         WHERE ticket_id = @ticket_id AND ticket_status = N'UNUSED'`
      );

    if (result.rowsAffected[0] === 0) {
      const current = await loadTicket(pool, ticketId);
      if (!current) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');
      throw conflict(
        'INVALID_STATE_TRANSITION',
        `Không thu hồi được vé đang ${current.ticket_status}; chỉ UNUSED → CANCELLED.`
      );
    }

    return res.json(ticketJson(await loadTicket(pool, ticketId)));
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tickets/:id — xóa vé chưa có lượt quét (file 15 mục 3.6)
// ---------------------------------------------------------------------------
router.delete('/:id', requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const ticketId = requireTicketId(req.params.id, ':id');
    const pool = await db.getPool();
    const ticket = await loadTicket(pool, ticketId);
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Không có vé này.');

    const used = await pool
      .request()
      .input('ticket_id', sql.NVarChar(20), ticketId)
      .query('SELECT TOP (1) 1 AS ok FROM dbo.scan_event WHERE ticket_id = @ticket_id');
    if (used.recordset.length > 0) {
      throw conflict('TICKET_IN_USE', 'Vé đã có lượt quét, không xóa được; hãy dùng cancel.');
    }

    try {
      await pool
        .request()
        .input('ticket_id', sql.NVarChar(20), ticketId)
        .query('DELETE FROM dbo.ticket WHERE ticket_id = @ticket_id');
    } catch (err) {
      if (sqlErrorNumber(err) === 547) {
        throw conflict('TICKET_IN_USE', 'Vé đang được dữ liệu khác tham chiếu; hãy dùng cancel.');
      }
      throw err;
    }

    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
