'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signTicketQr, verifyTicketQr, SIGNATURE_LENGTH } = require('../src/qr');

const SECRET = 'a'.repeat(64);

test('chuỗi QR gồm ticket_id và 22 ký tự chữ ký base64url', () => {
  const payload = signTicketQr('TK001', SECRET);
  const [ticketId, signature] = payload.split('.');
  assert.equal(ticketId, 'TK001');
  assert.equal(signature.length, SIGNATURE_LENGTH);
  assert.match(signature, /^[A-Za-z0-9_-]+$/);
  assert.ok(!signature.includes('='));
});

test('kiểm chữ ký đúng trả lại ticket_id', () => {
  assert.equal(verifyTicketQr(signTicketQr('TK001', SECRET), SECRET), 'TK001');
  assert.equal(verifyTicketQr(signTicketQr('TK_007', SECRET), SECRET), 'TK_007');
});

test('sửa một ký tự chữ ký thì bị từ chối', () => {
  const payload = signTicketQr('TK001', SECRET);
  const tampered = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  assert.equal(verifyTicketQr(tampered, SECRET), null);
});

test('chữ ký của vé khác không dùng cho vé này được', () => {
  const other = signTicketQr('TK002', SECRET).split('.')[1];
  assert.equal(verifyTicketQr(`TK001.${other}`, SECRET), null);
});

test('sai secret, thiếu dấu chấm, thừa dấu chấm đều bị từ chối', () => {
  const payload = signTicketQr('TK001', SECRET);
  assert.equal(verifyTicketQr(payload, 'b'.repeat(64)), null);
  assert.equal(verifyTicketQr('TK001', SECRET), null);
  assert.equal(verifyTicketQr('TK001.', SECRET), null);
  assert.equal(verifyTicketQr('.abc', SECRET), null);
  assert.equal(verifyTicketQr('TK001.abc.def', SECRET), null);
});

test('ticket_id sai định dạng không được ký', () => {
  assert.throws(() => signTicketQr('tk001', SECRET));
  assert.throws(() => signTicketQr('TK001-2', SECRET));
});
