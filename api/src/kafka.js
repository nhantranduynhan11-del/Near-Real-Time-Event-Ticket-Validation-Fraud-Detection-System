'use strict';

const { Kafka, Partitioners, logLevel } = require('kafkajs');
const config = require('./config');

const kafka = new Kafka({
  clientId: config.kafka.clientId,
  brokers: config.kafka.brokers,
  logLevel: logLevel.WARN,
  retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 5000 },
});

const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
  allowAutoTopicCreation: false,
});

let producerConnected = false;

async function connectProducer() {
  if (producerConnected) return;
  await producer.connect();
  producerConnected = true;
  console.log('[kafka] producer connected');
}

async function checkHealth() {
  const started = Date.now();
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.listTopics();
    return { status: 'ok', latency_ms: Date.now() - started };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - started,
      error: err.message,
    };
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

/**
 * Đẩy scan event vào topic. Key = ticket_id (null thì không đặt key).
 * File 11 mục 5: khóa phân vùng theo ticket_id để mọi lượt quét
 * của cùng một vé đi vào cùng một partition → R3/R4 so đúng thứ tự.
 */
async function sendScanEvent(event) {
  await connectProducer();
  const key = event.ticket_id || null;
  await producer.send({
    topic: config.kafka.topic,
    messages: [
      {
        key,
        value: JSON.stringify(event),
      },
    ],
  });
}

async function close() {
  if (producerConnected) {
    await producer.disconnect().catch(() => {});
    producerConnected = false;
  }
}

module.exports = { checkHealth, sendScanEvent, close };