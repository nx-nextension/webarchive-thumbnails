const Arena = require('bull-arena');
const Bull = require('bull');
const conf = require('../config/config');

const os = require('os');

// using arena as npm module, see https://www.npmjs.com/package/bull-arena

//const master = process.env.REDIS || conf.redis || 'redis:6379';
const master = 'valkey:6379';
let redisPort = 6379;

let redisServer = master.replace(/(.*):\d*$/, '$1');

const arena = Arena(
  {
    Bull,
    queues: [
      {
        type: 'bull',
        name: 'pywb_screenshots',
        hostId: 'thumbnails', //os.hostname(),

        redis: {
          port: 6379,
          host: redisServer,
        },
      },
    ],
  },
  {
    basePath: '/',
    disableListen: true,
  }
);

module.exports = arena;
