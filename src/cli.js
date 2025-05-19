const axios = require('axios');
const querystring = require('querystring');
const conf = require('../config/config');
const crypto = require('crypto');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const fs = require('fs/promises');
const logger = require('./lib/logger')('EHELV-ACCESS-THUMBNAILS:ENQUEUE');
const readline = require('readline');
const dns = require('dns').promises;
const { checkDomains } = require('./filter');

const PYWB_BASE = conf.pywbBaseUrl;

const getSolrHost = () => {
  return conf.solrUrl[Math.floor(Math.random() * conf.solrUrl.length)];
};

const thumbnailExists = async (path) => {
  try {
    await fs.access(path, fs.F_OK);
    return true;
  } catch (e) {
    return false;
  }
};

const getJobId = (url, cacheBuster = null) => {
  return `${
    cacheBuster ? encodeURIComponent(cacheBuster) + '-' : ''
  }${encodeURIComponent(url)}`;
};

const waitForThumbnail = async (jobId) => {
  const url = `http://puppeteer:3000/queue/${jobId}`;
  let finished = false;
  while (!finished) {
    const result = await axios.get(url);
    //logger.debug('waitForThumbnail result = ', result?.data);
    finished = result?.data?.finishedOn > 0; //result?.data?.status !== 'enqueued';
    if (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

const optionDefs = [
  { name: 'regenerate', alias: 'r', type: Boolean },
  // {
  //   name: 'query',
  //   alias: 'q',
  //   type: String,
  //   defaultOption: true,
  //   defaultOption: 'ehs_group:*',
  // },
  { name: 'limit', alias: 'l', type: Number },
  { name: 'dry-run', alias: 'd', type: Boolean },
  { name: 'help', alias: 'h', type: Boolean },
  { name: 'wait', alias: 'w', type: Boolean },
  { name: 'command', type: String, defaultOption: true },
];
const options = commandLineArgs(optionDefs, { stopAtFirstUnknown: true });
const sections = [
  {
    header: 'e-Helvetica Access Thumbnails',
    content:
      'Adds / enqueues webarchive snapshots to the thumbnailing queue. By default, already existing thumbnails will be re-used' +
      ' and not be regenerated.',
  },
  {
    header: 'Options',
    optionList: [
      {
        name: 'regenerate',
        typeLabel: '',
        description:
          'Ignores existing thumbnails and just adds all snapshots to the queue',
      },
      {
        name: 'query',
        typeLabel: '{underline solrQueryString}',
        description:
          "Filter to apply when querying snapshot list. Use 'ehs_group:*' to include all snapshots",
      },
      {
        name: 'limit',
        typeLabel: '{underline count}',
        description: 'Maximum number of domains to fetch',
      },
      {
        name: 'wait',
        typeLabel: '',
        description:
          'Wait until last enqueued thumbnails has been processed (polling the queue)',
      },
      {
        name: 'dry-run',
        typeLabel: '',
        description: 'Skip enqueuing, just fetch snapshots',
      },
      {
        name: 'add',
        typeLabel: '{underline url}',
        description: 'URL of page to screenshot',
      },
    ],
  },
];

const search = async (q, params) => {
  const options = {
    q: q || 'ehs_group:*',
    wt: 'json',
    rows: '10',
    start: '0',
    sort: 'ehs_group asc',
    fq: ['ehs_searchable:true'],
    group: 'on',
    'group.field': 'ehs_group',
    'group.limit': 1,
    'group.ngroups': true,
    // 'facet': 'on',
    // 'facet.pivot': 'ehs_group,ehs_urn_id',
    // 'facet.field': 'ehs_urn_id',
    //rows: 0,
    ...params,
  };
  return axios.get(
    `${getSolrHost()}/solr/${
      conf.webarchivesCollection
    }/select?${new URLSearchParams(options).toString()}`
  );
};

const enqueue = async (doc) => {
  // http://localhost:3001/queue/add/myurnid/https://pywb.ehelvetica-dev-host.ch/collection/20160417143248/http%3A%2F%2Fwww.abcd.ch%2Findex.php%3Fid%3D145%26L%3D2

  // index_time is added to the final filename
  const cacheIndexDate = doc['index_time'].substr(0, 10).replace(/-/g, '');
  const pywb = encodeURIComponent(
    `${doc.ehs_webarchive_collection}/${doc.ehs_wayback_date}/${doc.ehs_start_url}`
  );
  const url = `http://puppeteer:3000/queue/add/${doc.ehs_urn_id}/${cacheIndexDate}/${pywb}?return=immediate`;

  // -> sync this with the add queue handler (jobId)
  const jobId = getJobId(doc);
  const filename = `${getJobId(doc)}.jpg`;

  // check if regenerate option is set or thumbnail already exists
  if (
    options.regenerate ||
    !(await thumbnailExists(`${conf.targetDir}/${filename}`))
  ) {
    // remove job from queue (if it exists)
    const res = await axios.delete(
      `http://puppeteer:3000/queue/${getJobId(doc)}`
    );
    //const deleteSuccess = res.status === 200;

    logger.debug(`enqueue ${url}`);
    return axios.get(url);
  } else {
    logger.debug(`thumbnail exists ${filename}`);
    return Promise.resolve(true);
  }
};

const add = async (url) => {
  // http://localhost:3001/queue/add/myurnid/https://pywb.ehelvetica-dev-host.ch/collection/20160417143248/http%3A%2F%2Fwww.abcd.ch%2Findex.php%3Fid%3D145%26L%3D2

  // index_time is added to the final filename
  // const cacheIndexDate = doc['index_time'].substr(0, 10).replace(/-/g, '');
  // const pywb = encodeURIComponent(
  //   `${doc.ehs_webarchive_collection}/${doc.ehs_wayback_date}/${doc.ehs_start_url}`
  // );

  const id = '';
  const cacheBuster = '';
  const enqueueUrl = `http://puppeteer:3000/queue/add/${id}/${cacheBuster}/${url}?return=immediate`;

  // -> sync this with the add queue handler (jobId)
  const jobId = getJobId(url);
  const filename = `${getJobId(url)}.webp`;

  // check if regenerate option is set or thumbnail already exists
  if (
    options.regenerate ||
    !(await thumbnailExists(`${conf.targetDir}/${filename}`))
  ) {
    // remove job from queue (if it exists)
    const res = await axios.delete(
      `http://puppeteer:3000/queue/${getJobId(url)}`
    );
    //const deleteSuccess = res.status === 200;

    logger.debug(`enqueue ${url} with request ${enqueueUrl}`);
    try {
      return axios.get(enqueueUrl);
    } catch (e) {
      console.error(e);
    }
  } else {
    logger.debug(`thumbnail exists ${filename}`);
    return Promise.resolve(true);
  }
};

/**
 * TODO: auto-clear thumbnail cache
 * @param {} doc
 */
const clearCache = async (doc) => {
  // 20201230 - TODO: send cache clear commands to cantaloupe rest api
  const cacheIndexDate = doc['index_time'].substr(0, 10).replace(/-/g, '');
  const filename = `${doc.ehs_webarchive_collection}/${doc.ehs_wayback_date}/${doc.ehs_start_url}`;
  const url = 'http://cantaloupe';
  axios.post(url);
};

/**
 * Fetches a list of webarchive groups (=domains) from Solr.
 * Note: pagesize is limited to avoid overloading memory in the Solr Cloud
 *
 * @param {string} query in solr querystring syntax
 * @returns
 */
const fetchWebarchiveGroups = async (query, groupLimit = 3) => {
  const groups = [];
  const pageSize = Math.min(groupLimit, 500);
  let start = 0;
  let hasMore = true;
  while (hasMore) {
    logger.debug(`- fetching domains start=${start}`);
    const response = await search('', {
      q: query,
      fl: 'id,ehs_group,ehs_title,ehs_urn_id,ehs_domain,wayback_date',
      rows: pageSize,
      start,
    });

    let numWebarchives = Math.min(
      groupLimit,
      response.data.grouped.ehs_group.ngroups
    );
    //numWebarchives = 1;
    const results = response.data.grouped.ehs_group.groups;
    for (let i = 0; i < results.length; i++) {
      const g = results[i].doclist.docs[0];
      g._groupValue = results[i].groupValue;
      groups.push(g);
    }

    start += pageSize;
    hasMore = start < numWebarchives;
  }
  return groups;
};

let snapshotsCount = 0;
let lastJobId;
let groupCount = 0;
const NUM_RETRIES = 3;

const fetchAndEnqueueSnapshots = async (group, dryRun = false) => {
  logger.debug(
    `[processing group ${groupCount}] - total number of snapshots [${snapshotsCount}]`
  );
  logger.debug(
    `- fetching snapshots for domain ${group.ehs_domain} group ${group.ehs_group} ***`
  );
  logger.debug(group);

  const response = await search('', {
    fq: `ehs_group:"${group.ehs_group}"`,
    fl: 'id,ehs_group,ehs_urn_id,ehs_domain,ehs_wayback_date,ehs_start_url,ehs_webarchive_collection,index_time',
    sort: 'ehs_urn_id asc',
    'group.field': 'ehs_urn_id',
    'group.limit': '1',
  });

  const snapshots = response.data.grouped.ehs_urn_id.groups.map(
    (g) => g.doclist.docs[0]
  );

  // enqueue snapshots for this group
  let enqueueResult = {};
  for (const snapshot of snapshots) {
    if (!dryRun) {
      enqueueResult = await enqueue(snapshot);
      logger.debug(`enqueueResult ${JSON.stringify(enqueueResult?.data)}`);
      lastJobId = enqueueResult?.data?.jobId;
    }
    snapshotsCount += 1;
  }

  return { count: snapshotsCount, result: enqueueResult };
};

module.exports = {
  getJobId,
  enqueue,
  thumbnailExists,
  waitForThumbnail,
};

if (options.help || !options.command) {
  const usage = commandLineUsage(sections);
  return console.log(usage);
}

const startTime = new Date();
logger.info(
  `enqueuing snapshots for webarchive thumbnailing started at ${startTime}`
);

(async () => {
  const pLimit = await import('p-limit').then((m) => m.default);
  const argv = options._unknown || [];
  let mergeOptions = {};
  if (options.command === 'add') {
    const mergeDefinitions = [
      { name: 'url', alias: 'u', type: String },
      { name: 'message', alias: 'm' },
    ];
    mergeOptions = commandLineArgs(mergeDefinitions, { argv });
  }

  if (mergeOptions.url) {
    enqueueResult = await add(mergeOptions.url);
    logger.debug(`enqueueResult ${JSON.stringify(enqueueResult?.data)}`);
  } else {
    // read from stdin
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    rl.on('line', async (line) => {
      enqueueResult = await add(line);
      logger.debug(`enqueue line ${JSON.stringify(enqueueResult?.data)}`);
    });
    rl.on('close', () => {});
  }

  // // Step 1. Fetch list of all (or filtered) webarchive domains (group by ehs_group) -> ca. 10'000 (in 2021)
  // const groups = await fetchWebarchiveGroups(
  //   options.query,
  //   options.limit ?? 10
  // );
  // logger.debug('fetched domain', groups);

  // // fetch list of all snapshots of each individual group -> ca. 1-5 per group
  // // and enqueue snapshots
  // const limit = pLimit(3);
  // let retries = [];
  // const responses = [];
  // let pendingList = groups;
  // let retryCount = 0;
  // let groupIndex = 0;

  // while (pendingList.length > 0 && retryCount < NUM_RETRIES) {
  //   logger.info(
  //     `fetching metadata for ${pendingList.length} snapshots, retryCount=${retryCount}`
  //   );
  //   for (const group of pendingList) {
  //     group.groupIndex = group.groupIndex ?? groupIndex++;
  //     responses.push(
  //       limit(() => {
  //         logger.debug(`group ${group.groupIndex} SNAPSHOT #${snapshotsCount}`);
  //         return fetchAndEnqueueSnapshots(
  //           group,
  //           options.dryRun,
  //           groupIndex
  //         ).catch((reason) => {
  //           // handle errors on fetching (e.g. ETIMEDOUT) - requeue
  //           logger.error(reason);
  //           retries.push(group);
  //         });
  //       })
  //     );
  //     groupCount += 1;
  //   }

  //   // wait until all groups have been enqueued
  //   await Promise.all(responses);
  //   pendingList = [...retries];
  //   if (retries.length > 0) {
  //     logger.warn(`${retries.length} request(s) failed`);
  //   }

  //   retryCount++;
  //   if (retryCount < NUM_RETRIES) {
  //     retries = [];
  //   }
  // }

  // if (retries.length > 0) {
  //   logger.error(
  //     `${retries.length} requests finally failed (after retrying ${NUM_RETRIES} times)`
  //   );
  //   logger.error(retries);
  // }

  // waiting: lastJobId might be undefined if all thumbnails already exist
  if (options.wait && !options.dryRun && lastJobId) {
    await waitForThumbnail(lastJobId);
  }
})().then(() => {
  const endTime = new Date();
  let msec = endTime - startTime;
  const hh = Math.floor(msec / 1000 / 60 / 60);
  msec -= hh * 1000 * 60 * 60;
  const mm = Math.floor(msec / 1000 / 60);
  msec -= mm * 1000 * 60;
  const ss = Math.floor(msec / 1000);
  msec -= ss * 1000;
  logger.info(`finished (duration=${hh}:${mm}:${ss}.${msec})`);
});
