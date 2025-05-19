import { screenshot } from '@app/screenshot.js';
import dotenv from 'dotenv';
import { getJobId, waitForThumbnail, thumbnailExists } from '@app/cli.js';
import axios from 'axios';

const waitForThumbnail = async (jobId) => {
  const url = `http://localhost:3001/queue/${jobId}`;
  let finished = false;
  while (!finished) {
    const result = await axios.get(url);
    console.log('waitForThumbnail result = ', result?.data);
    finished = result?.data?.finishedOn > 0; //result?.data?.status !== 'enqueued';
    if (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

describe('Create puppeteer screenshot', () => {
  jest.setTimeout(60000);

  beforeEach(() => {
    if (process.platform === 'darwin') {
      // run locally on macOS - needs chromium installed
      //executablePath: `/usr/bin/firefox`,
      //executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox',
      //executablePath: "google-chrome-stable",
      // executablePath:
      //   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      //product: 'firefox',
      process.env['APP_BROWSER_PATH'] =
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      //process.env['APP_BROWSER_HEADLESS'] = 'false';
    }
    dotenv.config();
  });
  afterEach(() => {});

  test('create external screenshot using direct library call', async () => {
    // 2019-09-26 Test thumbnailing script
    // (async () => {
    //   const url =
    //     'https://pywb-t.ehelvetica-dev-host.ch/nb-weblaw/20220125144201/https://abcd123456.ch';
    //   await screenshot(
    //     url,
    //     //'/data/screenshot.jpg',
    //     '/tmp/screenshot.jpg',
    //     {
    //       progress: (p) => console.log(p),
    //       log: (t) => console.log(t),
    //     },
    //     process.cwd() + '/failed'
    //   );
    // })();

    const testConfig = {
      ...(await import('../conf/app/config.jest.js')),
    };

    await screenshot(
      './test/results/test-screenshot-external-pdf.jpg',
      {
        progress: (p) => console.log(p),
        log: (t) => console.log(t),
        update: (data) => console.log('updated job data:', data),
      },
      process.cwd() + '/failed',
      testConfig
    );
  });

  test('create external screenshot via enqueue', async () => {
    // index_time is added to the final filename
    const doc = {
      index_time: '2020-11-10T17:56:23.330Z',
      ehs_wayback_date: '20181221142154',
      ehs_webarchive_collection: 'nb-webarchive',
      ehs_start_url: 'http://www.abcd123456.com',
      ehs_urn_id: 'bel-123456',
    };
    const cacheIndexDate = doc['index_time'].substr(0, 10).replace(/-/g, '');
    const pywb = `${doc.ehs_webarchive_collection}/${
      doc.ehs_wayback_date
    }/${encodeURIComponent(doc.ehs_start_url)}`;
    const url = `http://localhost:3001/queue/add/${doc.ehs_urn_id}/${cacheIndexDate}/${pywb}?return=immediate`;

    console.log('getJobId', getJobId, waitForThumbnail);
    // -> sync this with the add queue handler (jobId)
    const jobId = getJobId(doc);
    const filename = `${getJobId(doc)}.jpg`;

    // check if regenerate option is set or thumbnail already exists
    // if (
    //   !(await thumbnailExists(`${conf.targetDir}/${filename}`))
    // ) {
    //   // remove job from queue (if it exists)
    //   const res = await axios.delete(
    //     `http://localhost:3000/queue/${getJobId(doc)}`
    //   );
    //   //const deleteSuccess = res.status === 200;

    console.log('enqueue url', url);
    const response = await axios.get(url);

    await waitForThumbnail(jobId);
  });
});
