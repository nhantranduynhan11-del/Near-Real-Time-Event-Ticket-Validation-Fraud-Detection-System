'use strict';

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const { authenticate, requireRole } = require('../auth');
const config = require('../config');
const { badRequest, notFound, conflict, unprocessable } = require('../errors');
const { dbToVietnamISO, parseISOWithOffset, toDbWallString } = require('../time');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('EVENT_SUPERVISOR'));

const ID_RE = /^[A-Z0-9_]{1,20}$/;

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

function eventJson(row, gateIds) {
  return {
    event_id: row.event_id,
    event_name: row.event_name,
    admission_start: dbToVietnamISO(row.admission_start),
    admission_end: dbToVietnamISO(row.admission_end),
    gate_ids: gateIds,
    gate_count: gateIds.length,
    is_active: row.event_id === config.activeEventId,
  };
}

async function loadEvent(pool, eventId) {
  const event = await pool
    .request()
    .input('event_id', sql.NVarChar(20), eventId)
    .query(
      `SELECT event_id, event_name, admission_start, admission_end
       FROM dbo.[event]
       WHERE event_id = @event_id`
    );
  if (event.recordset.length === 0) return null;

  const gates = await pool
    .request()
    .input('event_id', sql.NVarChar(20), eventId)
    .query(
      `SELECT gate_id
       FROM dbo.event_gate
       WHERE event_id = @event_id
       ORDER BY gate_id`
    );

  return eventJson(event.recordset[0], gates.recordset.map((g) => g.gate_id));
}

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const pool = await db.getPool();

    const count = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.[event]');

    const list = await pool
      .request()
      .input('offset', sql.Int, offset)
      .input('page_size', sql.Int, pageSize)
      .query(
        `SELECT event_id, event_name, admission_start, admission_end
         FROM dbo.[event]
         ORDER BY event_id
         OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY`
      );

    const gateRows = await pool.request().query(
      'SELECT event_id, gate_id FROM dbo.event_gate ORDER BY event_id, gate_id'
    );
    const gatesByEvent = new Map();
    for (const row of gateRows.recordset) {
      if (!gatesByEvent.has(row.event_id)) gatesByEvent.set(row.event_id, []);
      gatesByEvent.get(row.event_id).push(row.gate_id);
    }

    return res.json({
      items: list.recordset.map((row) => eventJson(row, gatesByEvent.get(row.event_id) || [])),
      page,
      page_size: pageSize,
      total: count.recordset[0].total,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const eventId = req.params.id;
    if (!ID_RE.test(eventId)) throw badRequest([{ field: ':id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' }]);

    const pool = await db.getPool();
    const event = await loadEvent(pool, eventId);
    if (!event) throw notFound('EVENT_NOT_FOUND', 'Không có sự kiện này.');
    return res.json(event);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/events/:id — sửa tên, khung giờ, danh sách cổng (file 15 mục 4.1)
// run_test_cases.sh dùng endpoint này để tạm đưa khung giờ về quanh hiện tại.
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res, next) => {
  try {
    const eventId = req.params.id;
    if (!ID_RE.test(eventId)) throw badRequest([{ field: ':id', issue: 'Khớp ^[A-Z0-9_]{1,20}$' }]);

    const body = req.body || {};
    const details = [];

    if (typeof body.event_name !== 'string' || body.event_name.trim() === '' || body.event_name.length > 200) {
      details.push({ field: 'event_name', issue: 'Bắt buộc, 1–200 ký tự' });
    }

    const start = parseISOWithOffset(body.admission_start);
    const end = parseISOWithOffset(body.admission_end);
    if (!start) {
      details.push({ field: 'admission_start', issue: 'Bắt buộc, ISO 8601 kèm offset' });
    }
    if (!end) {
      details.push({ field: 'admission_end', issue: 'Bắt buộc, ISO 8601 kèm offset' });
    }

    const gateIds = body.gate_ids;
    if (!Array.isArray(gateIds) || gateIds.length === 0) {
      details.push({ field: 'gate_ids', issue: 'Mảng, ít nhất 1 phần tử' });
    } else if (gateIds.length > 100) {
      details.push({ field: 'gate_ids', issue: 'Tối đa 100 phần tử' });
    } else {
      const seen = new Set();
      for (const gateId of gateIds) {
        if (typeof gateId !== 'string' || !ID_RE.test(gateId)) {
          details.push({ field: 'gate_ids', issue: 'Mỗi phần tử phải khớp ^[A-Z0-9_]{1,20}$' });
          break;
        }
        if (seen.has(gateId)) {
          details.push({ field: 'gate_ids', issue: `Trùng cổng ${gateId}` });
          break;
        }
        seen.add(gateId);
      }
    }

    if (details.length > 0) throw badRequest(details);
    if (end.getTime() <= start.getTime()) {
      throw unprocessable('INVALID_ADMISSION_WINDOW', 'admission_end phải sau admission_start.');
    }

    const pool = await db.getPool();
    const current = await loadEvent(pool, eventId);
    if (!current) throw notFound('EVENT_NOT_FOUND', 'Không có sự kiện này.');

    // Tất cả cổng mới phải tồn tại trong bảng gate.
    const gateRequest = pool.request();
    const placeholders = gateIds.map((gateId, i) => {
      gateRequest.input(`g${i}`, sql.NVarChar(20), gateId);
      return `@g${i}`;
    });
    const found = await gateRequest.query(
      `SELECT gate_id FROM dbo.gate WHERE gate_id IN (${placeholders.join(', ')})`
    );
    const foundSet = new Set(found.recordset.map((g) => g.gate_id));
    const missing = gateIds.filter((g) => !foundSet.has(g));
    if (missing.length > 0) {
      throw unprocessable('GATE_NOT_FOUND', 'Có cổng không tồn tại.', [
        { field: 'gate_ids', issue: 'Không có trong bảng gate', gate_ids: missing },
      ]);
    }

    // Không được bỏ cổng đang là assigned_gate_id của vé (FK_ticket_event_gate).
    const nextSet = new Set(gateIds);
    const removed = current.gate_ids.filter((g) => !nextSet.has(g));
    if (removed.length > 0) {
      const ticketRequest = pool.request();
      ticketRequest.input('event_id', sql.NVarChar(20), eventId);
      const removedPlaceholders = removed.map((gateId, i) => {
        ticketRequest.input(`r${i}`, sql.NVarChar(20), gateId);
        return `@r${i}`;
      });
      const referenced = await ticketRequest.query(
        `SELECT DISTINCT assigned_gate_id
         FROM dbo.ticket
         WHERE event_id = @event_id
           AND assigned_gate_id IN (${removedPlaceholders.join(', ')})`
      );
      if (referenced.recordset.length > 0) {
        throw conflict(
          'EVENT_IN_USE',
          'Không bỏ được cổng đang được gán cho vé.',
          [
            {
              field: 'gate_ids',
              issue: 'Cổng đang là assigned_gate_id của vé',
              gate_ids: referenced.recordset.map((r) => r.assigned_gate_id),
            },
          ]
        );
      }
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const update = new sql.Request(tx);
      update.input('event_id', sql.NVarChar(20), eventId);
      update.input('event_name', sql.NVarChar(200), body.event_name.trim());
      update.input('admission_start', sql.NVarChar(23), toDbWallString(start));
      update.input('admission_end', sql.NVarChar(23), toDbWallString(end));
      const updated = await update.query(
        `UPDATE dbo.[event]
         SET event_name = @event_name,
             admission_start = @admission_start,
             admission_end = @admission_end
         WHERE event_id = @event_id`
      );
      if (updated.rowsAffected[0] === 0) {
        throw notFound('EVENT_NOT_FOUND', 'Sự kiện vừa bị xóa.');
      }

      if (removed.length > 0) {
        const del = new sql.Request(tx);
        del.input('event_id', sql.NVarChar(20), eventId);
        const delPlaceholders = removed.map((gateId, i) => {
          del.input(`d${i}`, sql.NVarChar(20), gateId);
          return `@d${i}`;
        });
        await del.query(
          `DELETE FROM dbo.event_gate
           WHERE event_id = @event_id AND gate_id IN (${delPlaceholders.join(', ')})`
        );
      }

      const insert = new sql.Request(tx);
      insert.input('event_id', sql.NVarChar(20), eventId);
      const valueRows = gateIds.map((gateId, i) => {
        insert.input(`g${i}`, sql.NVarChar(20), gateId);
        return `(@event_id, @g${i})`;
      });
      await insert.query(
        `INSERT INTO dbo.event_gate (event_id, gate_id)
         SELECT v.event_id, v.gate_id
         FROM (VALUES ${valueRows.join(', ')}) AS v(event_id, gate_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM dbo.event_gate AS eg
           WHERE eg.event_id = v.event_id AND eg.gate_id = v.gate_id
         )`
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }

    return res.json(await loadEvent(pool, eventId));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
