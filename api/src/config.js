'use strict';

// Ghim timezone VN cho toàn bộ tiến trình Node.
// TZ env phải set trước khi bất kỳ module nào đọc Date.
process.env.TZ = 'Asia/Ho_Chi_Minh';

function parseIntEnv(name, fallback, min = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : NaN;
}

// jsonwebtoken hiểu chuỗi "43200" là 43200 ms, còn số 43200 là 43200 giây.
// File 15 dùng JWT_EXPIRES_IN=12h; vẫn nhận dạng số giây cho dễ cấu hình.
function parseExpiresIn(raw) {
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw;
}

const config = {
  apiPort: parseInt(process.env.API_PORT || '3000', 10),

  db: {
    server: process.env.DB_HOST_INTERNAL || 'sqlserver',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'ticket_system',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: (process.env.DB_ENCRYPT || 'false') === 'true',
      trustServerCertificate: true,
      // mssql đọc DATETIME2 thành Date có thành phần UTC = giờ tường Việt Nam
      // mà Spark ghi xuống (xem spark/silver_logic.py). Giữ true để không lệch 7 giờ.
      useUTC: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 5000,
    requestTimeout: 5000,
  },

  kafka: {
    brokers: [process.env.KAFKA_INTERNAL || 'kafka:29092'],
    clientId: 'ticket-api',
    topic: process.env.KAFKA_TOPIC || 'scan-events',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: parseExpiresIn(process.env.JWT_EXPIRES_IN || '12h'),
  },

  qr: {
    secret: process.env.QR_HMAC_SECRET || '',
  },

  scan: {
    waitMs: parseIntEnv('SCAN_WAIT_MS', 3000, 0),
  },

  activeEventId: process.env.ACTIVE_EVENT_ID || 'EV001',
};

/**
 * Kiểm tra cấu hình bắt buộc trước khi mở cổng.
 * File 15 mục 0: QR_HMAC_SECRET rỗng thì API từ chối khởi động.
 * JWT_SECRET cũng bắt buộc, nếu thiếu thì mọi token đều không an toàn.
 */
config.assertConfig = function assertConfig() {
  const problems = [];

  if (!config.jwt.secret) {
    problems.push('JWT_SECRET chưa đặt. Sinh bằng: openssl rand -hex 32');
  } else if (config.jwt.secret.length < 16) {
    problems.push('JWT_SECRET quá ngắn (cần tối thiểu 16 ký tự, khuyến nghị 32).');
  }

  if (!config.qr.secret) {
    problems.push('QR_HMAC_SECRET chưa đặt. Sinh bằng: openssl rand -hex 32');
  } else if (config.qr.secret.length < 32) {
    problems.push('QR_HMAC_SECRET phải có tối thiểu 32 ký tự (file 15 mục 0).');
  }

  if (!Number.isInteger(config.scan.waitMs)) {
    problems.push('SCAN_WAIT_MS phải là số nguyên không âm (mili giây).');
  }

  const expires = config.jwt.expiresIn;
  const expiresOk =
    (typeof expires === 'number' && Number.isFinite(expires) && expires > 0) ||
    (typeof expires === 'string' && /^\d+[smhdwy]$/i.test(expires));
  if (!expiresOk) {
    problems.push('JWT_EXPIRES_IN phải là số giây hoặc chuỗi như 12h, 1d.');
  }

  if (problems.length > 0) {
    console.error('[config] Không khởi động được API:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (config.jwt.secret.length < 32) {
    console.warn('[config] JWT_SECRET ngắn hơn 32 ký tự; chỉ nên dùng khi phát triển.');
  }
};

module.exports = config;
