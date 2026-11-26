'use strict';

// Test route với DB giả: kiểm tra wiring Express, auth, QR và dạng phản hồi.
process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '12h';
process.env.QR_HMAC_SECRET = 'abcdef0123456789abcdef0123456789';
process.env.SCAN_WAIT_MS = '20';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');

const db = require('../src/db');
const kafka = require('../src/kafka');
const { errorHandler } = require('../src/errors');
const { signTicketQr, verifyTicketQr } = require('../src/qr');

const SECRET = process.env.JWT_SECRET;
const QR_SECRET = process.env.QR_HMAC_SECRET;
const DEMO_HASH = '$2b$10$uFh.p9INxlgA5mFgk14A3efGe603s2Hc/oBhFCU0X2Gv6jJRPFWJa';

const opToken = jwt.sign({ sub: 'OP_A', role: 'GATE_OPERATOR' }, SECRET, { expiresIn: '12h' });
const supToken = jwt.sign({ sub: 'SUP1', role: 'EVENT_SUPERVISOR' }, SECRET, { expiresIn: '12h' });

const at = (h, m, s) => new Date(Date.UTC(2026, 11, 12, h, m, s));

const ticketRow = {
  ticket_id: 'TK001',
  event_id: 'EV001',
  assigned_gate_id: 'GATE_A',
  ticket_status: 'FLAGGED_FRAUD',
};

const scanRows = [
  {
    scan_event_id: '11111111-1111-4111-8111-111111111111',
    gate_id: 'GATE_A',
    scanner_id: 'SC_A1',
    received_at: at(19, 0, 1),
    scanned_at: at(19, 0, 0),
    scan_result: 'VALID',
    alert_level: 'NONE',
    alert_code: null,
    ticket_status_before: 'UNUSED',
    ticket_status_after: 'VALID_ENTRY',
    previous_scan_event_id: null,
    previous_scan_gate_id: null,
    time_since_previous_scan_ms: null,
    min_travel_time_ms: null,
    ticket_assigned_gate_id: 'GATE_A',
    distinct_wrong_gate_count: null,
  },
  {
    scan_event_id: '22222222-2222-4222-8222-222222222222',
    gate_id: 'GATE_D',
    scanner_id: 'SC_D1',
    received_at: at(19, 0, 4),
    scanned_at: at(19, 0, 4),
    scan_result: 'USED',
    alert_level: 'FRAUD',
    alert_code: 'IMPOSSIBLE_TRAVEL',
    ticket_status_before: 'VALID_ENTRY',
    ticket_status_after: 'FLAGGED_FRAUD',
    previous_scan_event_id: '11111111-1111-4111-8111-111111111111',
    previous_scan_gate_id: 'GATE_A',
    time_since_previous_scan_ms: 3000,
    min_travel_time_ms: 140000,
    ticket_assigned_gate_id: 'GATE_A',
    distinct_wrong_gate_count: null,
  },
];

let scanRow = {
  scan_event_id: '33333333-3333-4333-8333-333333333333',
  received_at: at(19, 0, 5),
  scan_result: 'VALID',
  alert_level: 'NONE',
  alert_code: null,
  ticket_assigned_gate_id: 'GATE_A',
  previous_scan_gate_id: null,
  time_since_previous_scan_ms: null,
};

let gateRow = { gate_id: 'GATE_A' };
let scannerRow = { scanner_id: 'SC_A1', gate_id: 'GATE_A' };
let goldAlerts = [];

const sent = [];

function fakeQuery(sqlText, params) {
  const text = String(sqlText).replace(/\s+/g, ' ');

  if (text.includes('FROM dbo.scan_event') && text.includes('WHERE ticket_id')) {
    return { recordset: scanRows };
  }
  if (text.includes('FROM dbo.scan_event') && text.includes('WHERE scan_event_id')) {
    return {
      recordset: scanRow
        ? [{ ...scanRow, scan_event_id: params.scan_event_id }]
        : [],
    };
  }
  if (text.includes('FROM dbo.ticket') && text.includes('WHERE ticket_id')) {
    return { recordset: [ticketRow] };
  }
  if (text.includes('FROM dbo.gate') && text.includes('WHERE gate_id')) {
    return { recordset: gateRow ? [gateRow] : [] };
  }
  if (text.includes('FROM dbo.scanner') && text.includes('WHERE scanner_id')) {
    return { recordset: scannerRow ? [scannerRow] : [] };
  }
  if (text.includes('FROM dbo.app_user') && text.includes('WHERE username')) {
    return {
      recordset:
        params.username === 'op_gate_a'
          ? [{
              user_id: 'OP_A',
              username: 'op_gate_a',
              password_hash: DEMO_HASH,
              last_name: 'Nguyễn',
              first_name: 'An',
              role: 'GATE_OPERATOR',
            }]
          : [],
    };
  }
  if (text.includes('FROM EVENT e')) {
    return {
      recordset:
        params.id === 'EV001'
          ? [{
              event_id: 'EV001',
              event_name: 'Concert Demo',
              admission_start: at(18, 0, 0),
              admission_end: at(20, 0, 0),
              gate_count: 2,
            }]
          : [],
    };
  }
  if (text.includes('FROM GOLD_EVENT_STATS')) {
    return {
      recordset: [{
        total_scans: 0,
        fraud_count: 0,
        warning_count: 0,
        cnt_valid: 0,
        cnt_invalid: 0,
        cnt_used: 0,
        cnt_cancelled: 0,
        cnt_expired: 0,
        cnt_wrong_gate: 0,
        updated_at: null,
      }],
    };
  }
  if (text.includes('FROM GATE g')) {
    return {
      recordset: [
        {
          gate_id: 'GATE_A',
          gate_name: 'Cổng A',
          total_scans: 0,
          valid_entries: 0,
          rejected_scans: 0,
          fraud_count: 0,
          warning_count: 0,
          last_scan_at: null,
          updated_at: null,
        },
        {
          gate_id: 'GATE_B',
          gate_name: 'Cổng B',
          total_scans: 0,
          valid_entries: 0,
          rejected_scans: 0,
          fraud_count: 0,
          warning_count: 0,
          last_scan_at: null,
          updated_at: null,
        },
      ],
    };
  }
  if (text.includes('FROM GOLD_ALERT')) {
    return { recordset: goldAlerts };
  }
  return { recordset: [] };
}

const fakePool = {
  request() {
    const params = {};
    return {
      input(name, type, value) {
        params[name] = value;
        return this;
      },
      async query(sqlText) {
        return fakeQuery(sqlText, params);
      },
    };
  },
};

db.getPool = async () => fakePool;
kafka.sendScanEvent = async (payload) => {
  sent.push(payload);
};

const app = express();
app.use(express.json());
app.use('/api/login', require('../src/routes/login'));
app.use('/api/tickets', require('../src/routes/tickets'));
app.use('/api/scan', require('../src/routes/scan'));
app.use('/api/dashboard', require('../src/routes/dashboard'));
app.use(errorHandler);

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

function call(path, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { ...options, headers });
}

test('POST /api/login trả token và không lộ password_hash', async () => {
  const res = await call('/api/login', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'op_gate_a', password: 'Demo@123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.access_token);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 12 * 3600);
  assert.equal(body.user.user_id, 'OP_A');
  assert.equal(body.user.password_hash, undefined);
});

test('POST /api/login sai mật khẩu hoặc tài khoản đều trả 401', async () => {
  for (const creds of [
    { username: 'op_gate_a', password: 'sai' },
    { username: 'khong_ton_tai', password: 'Demo@123' },
  ]) {
    const res = await call('/api/login', null, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'INVALID_CREDENTIALS');
  }
});

test('GET /api/tickets/:id trả valid_entry, last_scan và toàn bộ scans', async () => {
  const res = await call('/api/tickets/TK001', supToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ticket_status, 'FLAGGED_FRAUD');
  assert.equal(body.scan_count, 2);
  assert.equal(body.valid_entry.gate_id, 'GATE_A');
  assert.equal(body.valid_entry.received_at, '2026-12-12T19:00:01.000+07:00');
  assert.equal(body.last_scan.scan_result, 'USED');
  assert.equal(body.scans.length, 2);
  assert.equal(body.scans[1].alert_code, 'IMPOSSIBLE_TRAVEL');
});

test('GET /api/tickets/:id/qr ký đúng và chỉ supervisor được gọi', async () => {
  const res = await call('/api/tickets/TK001/qr', supToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(verifyTicketQr(body.qr_payload, QR_SECRET), 'TK001');

  const forbidden = await call('/api/tickets/TK001/qr', opToken);
  assert.equal(forbidden.status, 403);
});

test('POST /api/scan kiểm chữ ký, ghi đè ticket_id và trả kết quả', async () => {
  sent.length = 0;
  scanRow = {
    scan_event_id: '33333333-3333-4333-8333-333333333333',
    received_at: at(19, 0, 5),
    scan_result: 'VALID',
    alert_level: 'NONE',
    alert_code: null,
    ticket_assigned_gate_id: 'GATE_A',
    previous_scan_gate_id: null,
    time_since_previous_scan_ms: null,
  };

  const res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_qr_payload: signTicketQr('TK001', QR_SECRET),
      ticket_id: 'TK999',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:05.000+07:00',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scan_result, 'VALID');
  assert.equal(body.entry, 'ALLOW');
  assert.equal(body.ticket_assigned_gate_id, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ticket_id, 'TK001'); // lấy từ QR, không lấy TK999 của client
  assert.equal(sent[0].decode_error, false);
  assert.equal(sent[0].operator_id, 'OP_A');
});

test('POST /api/scan với QR sai chữ ký vẫn đi tiếp với decode_error = true', async () => {
  sent.length = 0;
  scanRow = {
    scan_event_id: '44444444-4444-4444-8444-444444444444',
    received_at: at(19, 0, 6),
    scan_result: 'INVALID',
    alert_level: 'FRAUD',
    alert_code: 'INVALID_QR',
    ticket_assigned_gate_id: null,
  };

  const res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_qr_payload: 'TK001.aaaaaaaaaaaaaaaaaaaaaa',
      ticket_id: 'TK001',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:06.000+07:00',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scan_result, 'INVALID');
  assert.equal(body.entry, 'DENY');
  assert.equal(body.alert_code, 'INVALID_QR');
  assert.equal(sent[0].ticket_id, null);
  assert.equal(sent[0].decode_error, true);
});

test('POST /api/scan trả 422 đúng mã lỗi cổng và máy quét', async () => {
  sent.length = 0;
  scanRow = null;
  const payload = () =>
    JSON.stringify({
      raw_qr_payload: signTicketQr('TK001', QR_SECRET),
      ticket_id: 'TK001',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:08.000+07:00',
    });

  gateRow = null;
  let res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload(),
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'UNKNOWN_GATE');

  gateRow = { gate_id: 'GATE_A' };
  scannerRow = null;
  res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload(),
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'UNKNOWN_SCANNER');

  scannerRow = { scanner_id: 'SC_B1', gate_id: 'GATE_B' };
  res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload(),
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'SCANNER_GATE_MISMATCH');

  assert.equal(sent.length, 0);
  gateRow = { gate_id: 'GATE_A' };
  scannerRow = { scanner_id: 'SC_A1', gate_id: 'GATE_A' };
});

test('POST trả 202 và GET /api/scan/:id trả 202 khi chưa có dòng Silver', async () => {
  sent.length = 0;
  scanRow = null;

  const res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_qr_payload: signTicketQr('TK001', QR_SECRET),
      ticket_id: 'TK001',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:07.000+07:00',
    }),
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.status, 'PROCESSING');

  const poll = await call(`/api/scan/${body.scan_event_id}`, opToken);
  assert.equal(poll.status, 202);
  assert.equal((await poll.json()).status, 'PROCESSING');
});

test('GET /api/scan/:id lạ trả 404 SCAN_NOT_FOUND', async () => {
  const res = await call('/api/scan/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', opToken);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'SCAN_NOT_FOUND');
});

// --- TEST CHO C1 ---
test('C1: Khi scan_result là USED, phải trả về previous_scan_gate_id và time_since_previous_scan_ms', async () => {
  sent.length = 0;
  scanRow = {
    scan_event_id: '44444444-4444-4444-8444-444444444444',
    received_at: at(19, 0, 6),
    scan_result: 'USED',
    alert_level: 'FRAUD',
    alert_code: 'DUPLICATE_SCAN',
    ticket_assigned_gate_id: 'GATE_A',
    previous_scan_gate_id: 'GATE_A',
    time_since_previous_scan_ms: 5000
  };
  const res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_qr_payload: signTicketQr('TK001', QR_SECRET),
      ticket_id: 'TK001',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:06.000+07:00',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.previous_scan_gate_id, 'GATE_A');
  assert.equal(body.time_since_previous_scan_ms, 5000);
});

test('C1: Khi scan_result KHÁC USED, hai trường này phải là null', async () => {
  sent.length = 0;
  scanRow = {
    scan_event_id: '55555555-5555-4555-8555-555555555555',
    received_at: at(19, 0, 7),
    scan_result: 'VALID',
    alert_level: 'NONE',
    alert_code: null,
    ticket_assigned_gate_id: 'GATE_A',
    previous_scan_gate_id: 'GATE_A',
    time_since_previous_scan_ms: 5000
  };
  const res = await call('/api/scan', opToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw_qr_payload: signTicketQr('TK001', QR_SECRET),
      ticket_id: 'TK001',
      decode_error: false,
      gate_id: 'GATE_A',
      scanner_id: 'SC_A1',
      scanned_at: '2026-12-12T19:00:07.000+07:00',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.previous_scan_gate_id, null);
  assert.equal(body.time_since_previous_scan_ms, null);
});

// --- TEST CHO C2 ---
test('C2: GET /api/dashboard/live không token phải trả về 401', async () => {
  const res = await call('/api/dashboard/live');
  assert.equal(res.status, 401);
});

test('C2: GET /api/dashboard/live sai vai trò (Operator) phải trả về 403', async () => {
  const res = await call('/api/dashboard/live', opToken);
  assert.equal(res.status, 403);
});

test('C2: GET /api/dashboard/live khi Gold trống trả toàn 0 và đủ 6 khóa by_result', async () => {
  goldAlerts = [];
  const res = await call('/api/dashboard/live', supToken);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.totals.total_scans, 0);
  assert.equal(body.totals.fraud_count, 0);
  assert.equal(body.totals.warning_count, 0);
  assert.equal(body.totals.fraud_rate, 0);
  assert.equal(body.totals.updated_at, null);
  assert.deepEqual(body.totals.by_result, {
    VALID: 0,
    INVALID: 0,
    USED: 0,
    CANCELLED: 0,
    EXPIRED: 0,
    WRONG_GATE: 0,
  });
  assert.equal(body.gates.length, 2);
  for (const g of body.gates) {
    assert.equal(g.total_scans, 0);
    assert.equal(g.valid_entries, 0);
    assert.equal(g.rejected_scans, 0);
    assert.equal(g.fraud_count, 0);
    assert.equal(g.warning_count, 0);
    assert.equal(g.fraud_rate, 0);
  }
  assert.deepEqual(body.latest_alerts, []);
});

test('C2: GET /api/dashboard/live trả scan_event_id chữ thường', async () => {
  goldAlerts = [{
    scan_event_id: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    created_at: at(19, 0, 5),
    received_at: at(19, 0, 4),
    alert_level: 'FRAUD',
    alert_code: 'INVALID_QR',
    scan_result: 'INVALID',
    ticket_id: null,
    gate_id: 'GATE_A',
    scanner_id: 'SC_A1',
    previous_scan_gate_id: null,
    time_since_previous_scan_ms: null,
    min_travel_time_ms: null,
    ticket_assigned_gate_id: null,
    distinct_wrong_gate_count: null,
    raw_qr_preview: 'TK001.bad',
  }];
  const res = await call('/api/dashboard/live', supToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.latest_alerts.length, 1);
  assert.equal(body.latest_alerts[0].scan_event_id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  goldAlerts = [];
});