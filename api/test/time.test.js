'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toVietnamISO,
  dbToVietnamISO,
  toDbWallString,
  parseISOWithOffset,
} = require('../src/time');

test('toVietnamISO đổi instant UTC sang giờ Việt Nam kèm +07:00', () => {
  assert.equal(
    toVietnamISO(new Date('2026-12-12T11:00:00.000Z')),
    '2026-12-12T18:00:00.000+07:00'
  );
});

test('dbToVietnamISO giữ nguyên giờ tường đã lưu, không cộng thêm 7 giờ', () => {
  // mssql trả DATETIME2 thành Date có thành phần UTC = giờ tường Việt Nam.
  const fromDb = new Date(Date.UTC(2026, 11, 12, 18, 0, 0, 0));
  assert.equal(dbToVietnamISO(fromDb), '2026-12-12T18:00:00.000+07:00');
});

test('toDbWallString bỏ offset để ghi DATETIME2', () => {
  assert.equal(
    toDbWallString(new Date('2026-12-12T11:00:00.000Z')),
    '2026-12-12T18:00:00.000'
  );
});

test('parseISOWithOffset bắt buộc có offset', () => {
  assert.ok(parseISOWithOffset('2026-12-12T18:00:00.000+07:00'));
  assert.ok(parseISOWithOffset('2026-12-12T11:00:00Z'));
  assert.equal(parseISOWithOffset('2026-12-12T18:00:00.000'), null);
  assert.equal(parseISOWithOffset('2026-12-12 18:00:00'), null);
});
