'use strict';

// Ghim timezone VN cho toàn bộ tiến trình Node.
// TZ env phải set trước khi bất kỳ module nào đọc Date.
process.env.TZ = 'Asia/Ho_Chi_Minh';

module.exports = {
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

  activeEventId: process.env.ACTIVE_EVENT_ID || 'EV001',
};