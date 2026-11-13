'use strict';

process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '12h';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signAccessToken, authenticate, requireRole } = require('../src/auth');

const SECRET = process.env.JWT_SECRET;

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err || null));
  });
}

test('signAccessToken tạo JWT có sub, role và hạn 12 giờ', () => {
  const { token, expiresIn } = signAccessToken({ user_id: 'OP_A', role: 'GATE_OPERATOR' });
  const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, 'OP_A');
  assert.equal(payload.role, 'GATE_OPERATOR');
  assert.equal(expiresIn, 12 * 3600);
});

test('authenticate gắn req.user khi token hợp lệ', async () => {
  const { token } = signAccessToken({ user_id: 'SUP1', role: 'EVENT_SUPERVISOR' });
  const req = { get: () => `Bearer ${token}` };
  const err = await runMiddleware(authenticate, req);
  assert.equal(err, null);
  assert.deepEqual(req.user, { user_id: 'SUP1', role: 'EVENT_SUPERVISOR' });
});

test('authenticate trả 401 khi thiếu token', async () => {
  const req = { get: () => '' };
  const err = await runMiddleware(authenticate, req);
  assert.equal(err.status, 401);
  assert.equal(err.code, 'UNAUTHENTICATED');
});

test('authenticate trả TOKEN_EXPIRED khi token hết hạn', async () => {
  const token = jwt.sign({ sub: 'OP_A', role: 'GATE_OPERATOR' }, SECRET, {
    algorithm: 'HS256',
    expiresIn: -1,
  });
  const req = { get: () => `Bearer ${token}` };
  const err = await runMiddleware(authenticate, req);
  assert.equal(err.status, 401);
  assert.equal(err.code, 'TOKEN_EXPIRED');
});

test('requireRole trả 403 khi sai vai trò', async () => {
  const req = { user: { user_id: 'OP_A', role: 'GATE_OPERATOR' } };
  const err = await runMiddleware(requireRole('EVENT_SUPERVISOR'), req);
  assert.equal(err.status, 403);
  assert.equal(err.code, 'FORBIDDEN');
});
