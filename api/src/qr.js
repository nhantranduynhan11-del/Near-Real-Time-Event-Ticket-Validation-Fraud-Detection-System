'use strict';

const crypto = require('crypto');

const TICKET_ID_RE = /^[A-Z0-9_]{1,20}$/;
const SIGNATURE_BYTES = 16;
const SIGNATURE_LENGTH = 22; // base64url(16 byte), bỏ dấu '='

/**
 * Chuỗi QR: `<ticket_id>.<chữ_ký>`.
 * Chữ ký = base64url(HMAC-SHA256(QR_HMAC_SECRET, ticket_id)), lấy 16 byte đầu.
 * Chỉ ký ticket_id; vé thuộc sự kiện nào do Spark tra DB (file 15 mục 0).
 */
function signTicketQr(ticketId, secret) {
  if (!TICKET_ID_RE.test(ticketId)) {
    throw new Error('ticket_id không khớp ^[A-Z0-9_]{1,20}$');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('QR_HMAC_SECRET chưa đặt');
  }
  const signature = crypto
    .createHmac('sha256', secret)
    .update(ticketId, 'utf8')
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString('base64url');
  return `${ticketId}.${signature}`;
}

/**
 * Kiểm chữ ký của raw_qr_payload.
 * Trả ticket_id khi hợp lệ, null khi sai cấu trúc / sai chữ ký.
 * Cắt tại dấu '.' CUỐI CÙNG (file 15 mục 0).
 */
function verifyTicketQr(payload, secret) {
  if (typeof payload !== 'string' || payload.length === 0) return null;

  const dot = payload.lastIndexOf('.');
  if (dot <= 0 || dot === payload.length - 1) return null;

  const ticketId = payload.slice(0, dot);
  const signature = payload.slice(dot + 1);
  if (!TICKET_ID_RE.test(ticketId) || signature.length !== SIGNATURE_LENGTH) return null;

  let expected;
  try {
    expected = signTicketQr(ticketId, secret).slice(dot + 1);
  } catch (err) {
    return null;
  }

  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return ticketId;
}

module.exports = {
  TICKET_ID_RE,
  SIGNATURE_LENGTH,
  signTicketQr,
  verifyTicketQr,
};
