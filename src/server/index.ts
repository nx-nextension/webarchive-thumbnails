import express from 'express';
import Bull, { Queue, QueueEvents, Worker } from 'bullmq';
import { createQueueDashExpressMiddleware } from '@queuedash/api';
import { log } from '../lib/logging.ts';
import { shortenPathname } from '../lib/utils.ts';
import IORedis from 'ioredis';

const app = express();
const router = express.Router();

log.info('webarchive screenshot service starting up');

/*--------------------------------------------------------------------------------------------------------------------*/
// SCREENSHOT QUEUE
/*--------------------------------------------------------------------------------------------------------------------*/

const connection = new IORedis('redis://valkey:6379', {
  maxRetriesPerRequest: null,
});
const screenshotQueue = new Queue('screenshots', {
  connection,
});
const screenshotEvents = new QueueEvents('screenshots', { connection });

// clear out failed jobs on startup
// screenshotQueue.clean(0, 'failed').then((res) => {
//   logger.info('cleaned out failed jobs', res);
// });
//screenshotQueue.clean(0, 'completed');
screenshotQueue.clean(0, -1, 'active');

screenshotEvents.on('completed', (job, queue) => {
  log.info(`completed job ${job?.jobId}`);
});

screenshotEvents.on('failed', (job, err) => {
  log.error(`❌ Job ${job.jobId} failed:`, job.failedReason);
  if (job.data.pid) {
    log.warn(`killing job ${job.data.pid} because it failed`);
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

//screenshotQueue.process(conf.maxProcesses || 2, screenshot);
// log.info(
//   `screenshot queue ready, using concurrency level of ${conf.maxProcesses} processes`
// );

/*--------------------------------------------------------------------------------------------------------------------*/
// SCREENSHOT METHODS
/*--------------------------------------------------------------------------------------------------------------------*/

/**
 * Enqueue new items. Supply id (ehs_urn_id) and url (pywb url)
 *
 */
app.get(/\/queue\/add\/(.*?)\/(.*?)\/(.*)$/, async (req, res, next) => {
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
      log.error('returning status 500 %o', err);
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
    log.error('returning status 500', err);
    res.sendStatus(500);
  }
});

/**
 * Get status of item in queue
 */
app.get(/\/queue\/(.*)$/, async (req, res, next) => {
  try {
    const job = await screenshotQueue.getJob(encodeURIComponent(req.params[0]));
    if (!job) {
      return res.sendStatus(404);
    }
    const result = JSON.parse(JSON.stringify(job));
    return res.json({ ...result, state: await job.getState() });
  } catch (e) {
    return res.sendStatus(500);
  }
});

app.delete(/\/queue\/(.*)$/, async (req, res, next) => {
  try {
    const job = await screenshotQueue.getJob(encodeURIComponent(req.params[0]));
    logger.debug(`delete job ${encodeURIComponent(req.params[0])}`);
    await job?.remove();
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(500);
  }
});

app.use(
  '/',
  createQueueDashExpressMiddleware({
    ctx: {
      queues: [
        {
          queue: screenshotQueue,
          displayName: 'Screenshots',
          type: 'bullmq' as const,
        },
      ],
    },
  })
);

app.listen(3000, function () {
  log.info('webarchiving screenshot api ready, listening on port 3000');
});
