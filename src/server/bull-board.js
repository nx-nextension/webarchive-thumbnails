const conf = require('../config/config');
const { ExpressAdapter } = require('@bull-board/express');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');

//const master = process.env.REDIS || conf.redis || 'redis-thumbnails:6379';
const master = 'valkey:6379';
let redisPort = 6379;

let redisServer = master.replace(/(.*):\d*$/, '$1');

const serverAdapter = new ExpressAdapter();

module.exports = (queues) => {
  const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: queues.map((queue) => new BullAdapter(queue)),
    serverAdapter: serverAdapter,
  });
  return serverAdapter.getRouter();
};
