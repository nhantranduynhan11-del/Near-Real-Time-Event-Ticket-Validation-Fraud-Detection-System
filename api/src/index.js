'use strict';

require('./config'); // ép TZ trước khi load module khác

const path = require('path');
const express = require('express');
const db = require('./db');
const kafka = require('./kafka');
const config = require('./config');

const app = express();

app.use(express.json({ limit: '1mb' }));

// Dashboard tĩnh — D sẽ thay nội dung public/index.html sau
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/health', require('./routes/health'));
app.use('/api/scan', require('./routes/scan'));

// 404 cho route /api/*
app.use('/api', (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Không có endpoint ${req.method} ${req.originalUrl}` },
  });
});

// Error handler chung
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Lỗi không lường trước.' },
  });
});

const server = app.listen(config.apiPort, () => {
  console.log(`[api] listening on :${config.apiPort} (TZ=${process.env.TZ})`);
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down...`);
  server.close();
  await Promise.allSettled([kafka.close(), db.close()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));