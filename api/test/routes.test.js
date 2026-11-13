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
};

let gateRow = { gate_id: 'GATE_A' };
let scannerRow = { scanner_id: 'SC_A1', gate_id: 'GATE_A' };

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
