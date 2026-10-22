'use strict';

const sql = require('mssql');
const config = require('./config');

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config.db)
      .connect()
      .catch((err) => {
        poolPromise = null; // cho phép thử lại lần sau
        throw err;
      });
  }
  return poolPromise;
}

async function checkHealth() {
  const started = Date.now();
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    return { status: 'ok', latency_ms: Date.now() - started };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - started,
      error: err.message,
    };
  }
}

async function close() {
  if (poolPromise) {
    const pool = await poolPromise.catch(() => null);
    if (pool) await pool.close();
    poolPromise = null;
  }
}

module.exports = { getPool, checkHealth, close };