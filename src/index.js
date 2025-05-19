const conf = require('../config/config');
const Queue = require('bull');
const express = require('express');
const logger = require('./lib/logger')('EHELV-ACCESS-COLLAGE:APP');
const screenshot = require('./process');
const indexer = require('./indexer');
const asyncMiddleware = require('./lib/asyncMiddleware');
const arena = require('./arena');
const bullBoard = require('./bull-board');
const bullMonitor = require('./bull-monitor');
//const proxy = require('./proxy-docker-dev');
const { shortenPathname } = require('./lib/utils');

const app = express();
const router = express.Router();

logger.info('e-helvetica thumbnail engine starting up');

/*--------------------------------------------------------------------------------------------------------------------*/
// SCREENSHOT QUEUE
/*--------------------------------------------------------------------------------------------------------------------*/

const screenshotQueue = new Queue('pywb_screenshots', 'redis://valkey:6379');

// clear out failed jobs on startup
// screenshotQueue.clean(0, 'failed').then((res) => {
//   logger.info('cleaned out failed jobs', res);
// });
//screenshotQueue.clean(0, 'completed');
screenshotQueue.clean(0, 'active');
screenshotQueue.on('completed', (job, queue) => {
  console.log('completed', job?.opts?.jobId);
});
screenshotQueue.process(conf.maxProcesses || 2, screenshot);
logger.info(
  `screenshot queue ready, using concurrency level of ${conf.maxProcesses} processes`
);

screenshotQueue.on('failed', (job, error) => {
  // if the process failes with a bulljs timeout because of a hanging chromium browser,
  // we have to manually kill this browser - otherwise it might run forever if caught
  // in a rendering loop and burn CPU
  logger.warn('job failed', job.data, error);
  if (job.data.pid) {
    logger.warn(`killing job ${job.data.pid} because it failed`);
    try {
      process.kill(-job.data.pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') {
        // POSIX [ESRCH] No process or process group can be found corresponding to that specified by pid.
        console.error(e);
      }
    }
  }
});

/*--------------------------------------------------------------------------------------------------------------------*/
// COVER QUEUE
/*--------------------------------------------------------------------------------------------------------------------*/

const coverQueue = new Queue('epub-covers', 'redis://valkey:6379');
coverQueue.on('failed', (job, error) => {
  // if the process failes with a bulljs timeout because of a hanging ebook conversion,
  // we have to manually kill this browser - otherwise it might run forever if caught
  // in a rendering loop and burn CPU
  logger.warn('job failed', job.data, error);
  if (job.data.pid) {
    logger.warn(`killing job ${job.data.pid} because it failed`);
    try {
      process.kill(-job.data.pid, 'SIGKILL');
    } catch (e) {
      if (e.code !== 'ESRCH') {
        // POSIX [ESRCH] No process or process group can be found corresponding to that specified by pid.
        console.error(e);
      }
    }
  }
});

/**
 * Enqueue new items for EPUB cover image extraction.
 * Supply the name of EPUB file.
 */
app.get(
  // epub file URIs should not begin with http(s) protocol
  /\/queue\/add\/(.*)\/(?!http)(.*?)\.epub$/,
  asyncMiddleware(async (req, res, next) => {
    let epubFile;
    let epubId;
    if (req.params && req.params[0] && req.params[1]) {
      epubId = req.params[0];
      epubFile = req.params[1] + '.epub';
    } else {
      return res.status(400).json({ error: 'invalid parameters' });
    }

    logger.debug(`EPUB file (id, path): ${epubId}, ${epubFile}.epub`);

    try {
      const jobId = `${encodeURIComponent(epubFile)}`;
      logger.debug(`using jobId=${jobId}`);

      const coverFile = shortenPathname(`${conf.targetDir}/${epubId}.jpg`);
      logger.debug(`using filename=${coverFile}`);

      const job = await coverQueue.add(
        {
          epubFile: `${epubFile}`,
          coverFile: `${coverFile}`,
        },
        {
          jobId: jobId,
          timeout: 30000,
          removeOnComplete: false,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        }
      );

      const jobStatus = await job.getState();
      if (jobStatus === 'completed') {
        // already in completed queue
        return res.json(job.result);
      }
      logger.debug(`enqueued jobId=${job.id}`);

      if (req.query.return === 'immediate') {
        return res.json({ status: 'enqueued', jobId: job.id });
      }

      try {
        const result = await job.finished();
        return res.json(result);
      } catch (err) {
        logger.error('returning status 500 %o', err);
        return res.sendStatus(500, job);
      }

      // coverQueue.on('completed', function(job, result) {
      //   logger.debug('-------------->  job completed jobId=', job.id, result);
      //   if (job.id === jobId) {
      //     return res.json(result);
      //   }
      // });

      // coverQueue.on('failed', (job) => {
      //   logger.error('--------------> job failed', job);
      //   if (job.id === jobId) {
      //     return res.status(500).json(job);
      //   }
      // });
    } catch (err) {
      logger.error('returning status 500', err);
      res.sendStatus(500);
    }
  })
);

/*--------------------------------------------------------------------------------------------------------------------*/
// INDEX QUEUE
/*--------------------------------------------------------------------------------------------------------------------*/

const indexQueue = new Queue('color_index', 'redis://valkey:6379');
indexQueue.clean(0, 'completed');
indexQueue.process(conf?.colorIndex?.maxProcesses || 2, indexer);

/*--------------------------------------------------------------------------------------------------------------------*/
// SCREENSHOT METHODS
/*--------------------------------------------------------------------------------------------------------------------*/

/**
 * Enqueue new items. Supply id (ehs_urn_id) and url (pywb url)
 *
 */
app.get(
  /\/queue\/add\/(.*?)\/(.*?)\/(.*)$/,
  asyncMiddleware(async (req, res, next) => {
    let url;
    let id;
    if (req.params && req.params[2]) {
      id = req.params[0];
      version = req.params[1];
      url = req.params[2];
    } else {
      return res.status(400).json({ error: 'invalid parameters' });
    }
    console.log(`id=${id} version=${version} url=${url}`);
    try {
      //const jobId = `${encodeURIComponent(id)}-${encodeURIComponent(url)}-${version}`;
      // KJ/NX 20191022 - remove version from target filename
      const jobId = `${
        id && id.length > 0 ? encodeURIComponent(id) + '-' : ''
      }${encodeURIComponent(url)}`;
      logger.debug(`using jobId=${jobId}`);
      const filename = shortenPathname(`${conf.targetDir}/${jobId}.webp`);
      logger.debug(`using filename=${filename}`);

      // replace some dev urls
      // if (url.match(/^http\:\/\/pywb\.ehelvetica\.localhost/)) {
      //   url = url.replace(/^http\:\/\/pywb\.ehelvetica\.localhost\:8088/, 'http://host.docker.internal\:8099');
      // }
      if (!url.match(/^https?/)) {
        url = `${conf.pywbBaseUrl}/${url}`;
      }
      const job = await screenshotQueue.add(
        {
          url,
          filename: `${filename}`,
        },
        {
          jobId: jobId,
          timeout: 150000,
          removeOnComplete: false,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        }
      );

      const jobStatus = await job.getState();
      if (jobStatus === 'completed') {
        // already in completed queue
        return res.json(job.result);
      }
      logger.debug(`enqueued jobId=${job.id}`);

      if (req.query.return === 'immediate') {
        return res.json({ status: 'enqueued', jobId: job.id });
      }

      try {
        const result = await job.finished();
        return res.json(result);
      } catch (err) {
        logger.error('returning status 500 %o', err);
        return res.sendStatus(500, job);
      }

      // screenshotQueue.on('completed', function(job, result) {
      //   logger.debug('-------------->  job completed jobId=', job.id, result);
      //   if (job.id === jobId) {
      //     return res.json(result);
      //   }
      // });

      // screenshotQueue.on('failed', (job) => {
      //   logger.error('--------------> job failed', job);
      //   if (job.id === jobId) {
      //     return res.status(500).json(job);
      //   }
      // });
    } catch (err) {
      logger.error('returning status 500', err);
      res.sendStatus(500);
    }
  })
);

/**
 * Get status of item in queue
 */
app.get(
  /\/queue\/(.*)$/,
  asyncMiddleware(async (req, res, next) => {
    try {
      const job = await screenshotQueue.getJob(
        encodeURIComponent(req.params[0])
      );
      if (!job) {
        return res.sendStatus(404);
      }
      const result = JSON.parse(JSON.stringify(job));
      return res.json({ ...result, state: await job.getState() });
    } catch (e) {
      return res.sendStatus(500);
    }
  })
);

//
app.delete(
  /\/queue\/(.*)$/,
  asyncMiddleware(async (req, res, next) => {
    try {
      const job = await screenshotQueue.getJob(
        encodeURIComponent(req.params[0])
      );
      logger.debug(`delete job ${encodeURIComponent(req.params[0])}`);
      await job?.remove();
      res.sendStatus(200);
    } catch (e) {
      res.sendStatus(500);
    }
  })
);

// Bull Arena UI
//router.use('/', arena);

// Bull Board UI
//router.use('/', bullBoard([screenshotQueue, indexQueue]));

(async () => {
  const monitor = await bullMonitor([screenshotQueue, coverQueue, indexQueue]);
  router.use('/', monitor.router);
  app.use(router);
})();

app.listen(3000, function () {
  logger.info('e-helvetica screenshot api ready, listening on port 3000');
});

const sampleUrls = [];

sampleUrls.forEach((url) => {});
