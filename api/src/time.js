'use strict';

const pad = (n, len = 2) => String(n).padStart(len, '0');

/**
 * Trả chuỗi ISO 8601 kèm offset +07:00, chính xác tới mili giây.
 * Không dùng toISOString() vì nó luôn trả UTC (Z) → sai với quy ước file 15.
 */
function toVietnamISO(date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  return (
    `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}` +
    `T${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}` +
    `.${pad(vn.getUTCMilliseconds(), 3)}+07:00`
  );
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

module.exports = { toVietnamISO, parseISOWithOffset };