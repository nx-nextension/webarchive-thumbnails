const { screenshot } = require('./screenshot');
const conf = require('../config/config');
const logger = require('./lib/logger')('EHELV-ACCESS-COLLAGE:APP');

module.exports = function (job) {
  logger.debug('running job', job);
  return screenshot(job.data.url, job.data.filename, job, undefined, conf);
};
