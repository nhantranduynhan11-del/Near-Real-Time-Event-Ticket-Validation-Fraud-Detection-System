'use strict';

const express = require('express');
const sql = require('mssql');
const db = require('../db');
const config = require('../config');
const { authenticate, requireRole } = require('../auth');
const { dbToVietnamISO } = require('../time');
const router = express.Router();

router.get('/live', authenticate, requireRole('EVENT_SUPERVISOR'), async (req, res, next) => {
  try {
    const eventId = req.query.event_id || config.activeEventId;
    const alertsLimit = parseInt(req.query.alerts_limit || '20', 10);
    
    if (isNaN(alertsLimit) || alertsLimit < 1 || alertsLimit > 100) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'alerts_limit phải từ 1 đến 100' }});
    }

    const pool = await db.getPool();

    // 1. Lấy thông tin Event
    const eventRes = await pool.request()
      .input('id', sql.NVarChar, eventId)
      .query(`
        SELECT e.event_id, e.event_name, e.admission_start, e.admission_end,
               (SELECT COUNT(*) FROM EVENT_GATE WHERE event_id = e.event_id) as gate_count
        FROM EVENT e WHERE e.event_id = @id
      `);
      
    if (eventRes.recordset.length === 0) {
      return res.status(404).json({ error: { code: 'EVENT_NOT_FOUND', message: 'Sự kiện không tồn tại' } });
    }
    const eventData = eventRes.recordset[0];
    eventData.admission_start = dbToVietnamISO(eventData.admission_start);
    eventData.admission_end = dbToVietnamISO(eventData.admission_end);

    // 2. Lấy tổng quan (đọc từ Gold Event Stats)
    const totalsRes = await pool.request()
      .input('id', sql.NVarChar, eventId)
      .query(`
        SELECT 
          ISNULL(SUM(total_scans), 0) as total_scans,
          ISNULL(SUM(fraud_count), 0) as fraud_count,
          ISNULL(SUM(warning_count), 0) as warning_count,
          ISNULL(SUM(cnt_valid), 0) as cnt_valid,
          ISNULL(SUM(cnt_invalid), 0) as cnt_invalid,
          ISNULL(SUM(cnt_used), 0) as cnt_used,
          ISNULL(SUM(cnt_cancelled), 0) as cnt_cancelled,
          ISNULL(SUM(cnt_expired), 0) as cnt_expired,
          ISNULL(SUM(cnt_wrong_gate), 0) as cnt_wrong_gate,
          MAX(updated_at) as updated_at
        FROM GOLD_EVENT_STATS WHERE event_id = @id
      `);
      
    const t = totalsRes.recordset[0];
    const fraudRate = t.total_scans > 0 ? (t.fraud_count / t.total_scans) : 0;

    // 3. Lấy thống kê theo cổng (đọc từ Gold Gate Stats)
    const gatesRes = await pool.request()
      .input('id', sql.NVarChar, eventId)
      .query(`
        SELECT 
          g.gate_id, g.gate_name,
          ISNULL(s.total_scans, 0) as total_scans,
          ISNULL(s.cnt_valid, 0) as valid_entries,
          (ISNULL(s.total_scans, 0) - ISNULL(s.cnt_valid, 0)) as rejected_scans,
          ISNULL(s.fraud_count, 0) as fraud_count,
          ISNULL(s.warning_count, 0) as warning_count,
          s.last_scan_at,
          s.updated_at
        FROM GATE g
        JOIN EVENT_GATE eg ON g.gate_id = eg.gate_id
        LEFT JOIN GOLD_GATE_STATS s ON g.gate_id = s.gate_id AND s.event_id = @id
        WHERE eg.event_id = @id
      `);
      
    const gates = gatesRes.recordset.map(g => ({
      gate_id: g.gate_id,
      gate_name: g.gate_name,
      total_scans: g.total_scans,
      valid_entries: g.valid_entries,
      rejected_scans: g.rejected_scans,
      fraud_count: g.fraud_count,
      warning_count: g.warning_count,
      fraud_rate: Math.round((g.total_scans > 0 ? (g.fraud_count / g.total_scans) : 0) * 10000) / 10000,
      last_scan_at: g.last_scan_at ? dbToVietnamISO(g.last_scan_at) : null,
      updated_at: g.updated_at ? dbToVietnamISO(g.updated_at) : null
    }));

    // 4. Lấy cảnh báo mới nhất (đọc từ Gold Alert)
    const alertsRes = await pool.request()
      .input('id', sql.NVarChar, eventId)
      .input('limit', sql.Int, alertsLimit)
      .query(`
        SELECT TOP (@limit) *
        FROM GOLD_ALERT 
        WHERE event_id = @id 
        ORDER BY created_at DESC
      `);

    const latest_alerts = alertsRes.recordset.map(a => {
      const isUsed = a.scan_result === 'USED';
      const isWrongGate = a.scan_result === 'WRONG_GATE';
      return {
        scan_event_id: String(a.scan_event_id).toLowerCase(),
        created_at: dbToVietnamISO(a.created_at),
        received_at: dbToVietnamISO(a.received_at),
        alert_level: a.alert_level,
        alert_code: a.alert_code,
        scan_result: a.scan_result,
        ticket_id: a.ticket_id,
        gate_id: a.gate_id,
        scanner_id: a.scanner_id,
        previous_scan_gate_id: isUsed ? a.previous_scan_gate_id : null,
        time_since_previous_scan_ms: isUsed ? a.time_since_previous_scan_ms : null,
        min_travel_time_ms: (isUsed && a.previous_scan_gate_id && a.previous_scan_gate_id !== a.gate_id) ? a.min_travel_time_ms : null,
        ticket_assigned_gate_id: isWrongGate ? a.ticket_assigned_gate_id : null,
        distinct_wrong_gate_count: isWrongGate ? a.distinct_wrong_gate_count : null,
        raw_qr_preview: a.ticket_id === null ? a.raw_qr_preview : null
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      generated_at: new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('Z', '+07:00'),
      event: eventData,
      totals: {
        total_scans: t.total_scans,
        fraud_count: t.fraud_count,
        warning_count: t.warning_count,
        fraud_rate: Math.round(fraudRate * 10000) / 10000,
        by_result: {
          VALID: t.cnt_valid,
          INVALID: t.cnt_invalid,
          USED: t.cnt_used,
          CANCELLED: t.cnt_cancelled,
          EXPIRED: t.cnt_expired,
          WRONG_GATE: t.cnt_wrong_gate
        },
        updated_at: t.updated_at ? dbToVietnamISO(t.updated_at) : null
      },
      gates: gates,
      latest_alerts: latest_alerts
    });
  } catch (err) {
    if (err.message.includes('connection') || err.message.includes('Login')) {
      return res.status(503).json({ error: { code: 'DASHBOARD_DATA_UNAVAILABLE', message: 'Không nối được SQL Server' }});
    }
    next(err);
  }
});

module.exports = router;