const conf = require('../config/config');
const BullMonitorExpress = require('@bull-monitor/express').BullMonitorExpress;
const BullAdapter = require('@bull-monitor/root/dist/bull-adapter').BullAdapter;

//const master = process.env.REDIS || conf.redis || 'redis-thumbnails:6379';
const master = 'valkey:6379';
let redisPort = 6379;

let redisServer = master.replace(/(.*):\d*$/, '$1');

module.exports = async function (queues) {
  const monitor = new BullMonitorExpress({
    queues: queues.map((q) => new BullAdapter(q)),
    // enables graphql playground at /my/url/graphql. true by default
    gqlPlayground: true,
    // enable metrics collector. false by default
    // metrics are persisted into redis as a list
    // with keys in format "bull_monitor::metrics::{{queue}}"
    metrics: {
      // collect metrics every X
      // where X is any value supported by https://github.com/kibertoad/toad-scheduler
      collectInterval: { hours: 1 },
      maxMetrics: 100,
      // disable metrics for specific queues
      blacklist: ['1'],
    },
  });
  await monitor.init();
  return monitor;
};
