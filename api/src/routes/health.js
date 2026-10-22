'use strict';

const express = require('express');
const db = require('../db');
const kafka = require('../kafka');
const { toVietnamISO } = require('../time');

const router = express.Router();

router.get('/', async (req, res) => {
  const [dbHealth, kafkaHealth] = await Promise.all([
    db.checkHealth(),
    kafka.checkHealth(),
  ]);

  const allOk = dbHealth.status === 'ok' && kafkaHealth.status === 'ok';
  const anyOk = dbHealth.status === 'ok' || kafkaHealth.status === 'ok';

  const status = allOk ? 'ok' : anyOk ? 'degraded' : 'error';

  res.status(allOk ? 200 : 503).json({
    status,
    time: toVietnamISO(),
    checks: {
      database: dbHealth,
      kafka: kafkaHealth,
    },
  });
});

module.exports = router;