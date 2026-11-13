'use strict';

const pad = (n, len = 2) => String(n).padStart(len, '0');

function format(date, shiftMs) {
  const d = new Date(date.getTime() + shiftMs);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}+07:00`
  );
}

/**
 * Trả chuỗi ISO 8601 kèm offset +07:00, chính xác tới mili giây.
 * Không dùng toISOString() vì nó luôn trả UTC (Z) → sai với quy ước file 15.
 */
function toVietnamISO(date = new Date()) {
  return format(date, 7 * 3600 * 1000);
}

/**
 * DATETIME2 trong SQL Server không có múi giờ. Spark ghi giờ tường Việt Nam
 * (xem spark/silver_logic.py: epoch_ms_to_vn_iso). mssql đọc lại thành Date có
 * thành phần UTC đúng bằng giờ tường đó, nên KHÔNG cộng thêm 7 giờ ở đây.
 */
function dbToVietnamISO(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 0);
}

/**
 * Đổi một mốc thời gian (Date, instant thật) thành chuỗi giờ tường Việt Nam
 * không kèm offset, để ghi vào cột DATETIME2.
 * Ví dụ: 2026-12-12T11:00:00Z → '2026-12-12T18:00:00.000'.
 */
function toDbWallString(date) {
  return toVietnamISO(date).slice(0, 23);
}

/**
 * Regex ISO 8601 bắt buộc có offset (Z hoặc ±HH:MM).
 * File 15 mục 0: thiếu offset → 400.
 */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function parseISOWithOffset(str) {
  if (typeof str !== 'string' || !ISO_WITH_OFFSET.test(str)) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { toVietnamISO, dbToVietnamISO, toDbWallString, parseISOWithOffset };
