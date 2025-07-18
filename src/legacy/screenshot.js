const puppeteer = require('puppeteer-extra');
const sharp = require('sharp');
const pixelmatch = require('pixelmatch');
const { performance, PerformanceObserver } = require('perf_hooks');
const logger = require('./lib/logger')('EHELV-ACCESS-COLLAGE:APP');
const util = require('util');
const { unlink, fstat, copyFile, writeFile } = require('fs');
const { rm } = require('fs/promises');
const copyFileAsync = util.promisify(copyFile);
const writeFileAsync = util.promisify(writeFile);
const path = require('path');
//const proxy = require('./proxy-docker-dev');
const { config } = require('process');
const dns = require('dns');
const { setTimeout } = require('timers/promises');
const { Events } = require('puppeteer');
const { PuppeteerWARCGenerator, PuppeteerCapturer } = require('node-warc');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const { checkDomains } = require('./filter');
const { maxConnections } = require('./proxy-docker-dev');
const { gzipFile } = require('./lib/utils');

const pluginStealth = StealthPlugin();
pluginStealth.enabledEvasions.delete('iframe.contentWindow');
puppeteer.use(pluginStealth);

puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: process.env['CAPTCHA_SOLVER_API_KEY'],
    },
    visualFeedback: true, // colorize reCAPTCHAs (violet = detected, green = solved)
  })
);

// starting with 2.7.x / new calendar picket
let PYWB_TOOLBAR_HEIGHT = 90;
PYWB_TOOLBAR_HEIGHT = 0;

const MAX_META_REDIRECT_TIMEOUT = 5;

const getFrame = (page, name) => {
  let frame = page.mainFrame();
  for (let child of frame.childFrames()) {
    if (child.name() === name) {
      return child;
    }
  }
};

const waitForIFrameLoad = (page, iframeSelector, timeout = 10000) => {
  // if pageFunction returns a promise, $eval will wait for its resolution
  return page.$eval(
    iframeSelector,
    (el, timeout) => {
      const p = new Promise((resolve, reject) => {
        el.onload = () => {
          resolve();
        };
        setTimeout(() => {
          reject(new Error('Waiting for iframe load has timed out'));
        }, timeout);
      });
      return p;
    },
    timeout
  );
};

async function getImageWhite(source) {
  const image = await sharp(source);
  //const metadata = await image.metadata();
  const w = 256;
  const h = 256;

  const buffer = await image.resize(w, h).ensureAlpha().raw().toBuffer();
  const white = await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .raw()
    .toBuffer();

  const diff = pixelmatch(buffer, white, null, w, h, {});

  return diff / (w * h);
}

async function doPageScreenshot(
  job,
  targetFilename,
  page,
  url,
  failedPath,
  conf
) {
  failedPath = failedPath ?? conf.testsFailedDir;

  let response;
  try {
    job.log(`- open ${url}`);

    const parsedUrl = new URL(url);
    const isPdf = parsedUrl.pathname?.endsWith('.pdf');
    if (isPdf) {
      const params = new URLSearchParams({
        // force frameless wayback
        url: url.replace(
          /^(https?\:\/\/.*?\/.*?\/)(\d+)(.*?)\/(.*)/gm,
          '$1$2mp_/$4'
        ),
      });
      url = conf.pdfRendererUrl + '?' + params.toString();
      job.log(`- loading pdf file using custom renderer url=${url}`);
      PYWB_TOOLBAR_HEIGHT = 0;
    }

    // for advanced debugging (devtools console)
    // page
    //   .on('console', (message) =>
    //     logger.info(
    //       `${message.type().substr(0, 3).toUpperCase()} ${message.text()}`
    //     )
    //   )
    //   .on('pageerror', ({ message }) => logger.info(message))
    //   .on('response', (response) =>
    //     logger.info(`${response.status()} ${response.url()}`)
    //   )
    //   .on('requestfailed', (request) =>
    //     logger.info(`${request.failure().errorText} ${request.url()}`)
    //   );

    response = await page.goto(url, {
      waitUntil:
        conf.engine === 'firefox' ? ['load'] : ['load', 'networkidle0'],
      timeout: 10000,
    });
  } catch (e) {
    if (e && e.name !== 'TimeoutError') {
      // ignore timeout errors but rethrow everything else
      throw e;
    } else {
      job.log('> skip page open timeout');
    }
  }

  // const headers = response?.headers();
  // const status = response?.status();
  // const contentType = headers?.['content-type'];
  // job.log(`loading content status='${status}' of type '${contentType}'`);

  if (conf.basicAuth && conf.basicAuth.user?.length > 0) {
    await page.authenticate({
      username: conf.basicAuth.user,
      password: conf.basicAuth.pass,
    });
  }

  // pywb replay: #143 www.compagnieaoc.ch - wait until redirections in the pywb have loaded
  const frame = getFrame(page, 'replay_iframe');

  if (frame) {
    let meta;
    try {
      // problem: a.getAttribute('content') or a.content does not always deliver full url (puppeteer bug?)
      meta = await frame.$eval('meta[http-equiv=refresh]', (a) => a.outerHTML);
      //console.log('meta1=',meta);

      if (meta) {
        // https://developer.mozilla.org/de/docs/Web/HTML/Element/meta
        // <meta http-equiv="refresh" content="0; url=http://example.com/">
        const re = meta.match(/\s*(\d+)\s*;\s*url=(.*)[$|>|\s]*/i);
        //console.log(re);

        // (3) ["0; url=https://blabla.com ", "0", "https://blabla.com", index: 0, input: "0; url=https://blabla.com  ", groups: undefined]
        let timeout, url;
        if (
          re &&
          typeof re[1] !== 'undefined' &&
          typeof re[2] !== 'undefined'
        ) {
          timeout = +re[1] !== NaN ? +re[1] : 0;
          url = re[2];

          // only capture redirects if less than 5s
          if (timeout < MAX_META_REDIRECT_TIMEOUT && url.length > 0) {
            meta = url;
          } else {
            // don't wait for redirect
            meta = null;
          }
        } else {
          // can't parse tag content or just a single timeout
          meta = null;
        }
      }
    } catch (e) {
      //console.error(e);
      meta = null;
    }

    if (meta) {
      job.progress(18);
      await waitForIFrameLoad(page, '#replay_iframe');
    }
  }

  job.progress(20);

  // idle wait for page to initialize
  //await page.waitForTimeout(1000);

  await setTimeout(750);

  // job.log('checking for captchas');
  // await page.solveRecaptchas();
  job.progress(22);

  // eliminate cookie popups
  job.log('checking for popup blockers');
  await page.evaluate((_) => {
    const re = new RegExp(
      /accept|accepteren|accepteer|toestaan|akkoord|aanvaard|consent|allow|toestemming|akzeptieren|verstanden|zustimmen|accept|opslaan|reject/,
      'i'
    );
    // TODO: recursive shadow roots (check https://docs.apify.com/academy/node-js/scraping-shadow-doms)
    const shadowRoots = [...document.querySelectorAll('*')]
      .filter((el) => el.shadowRoot)
      .map((el) => el.shadowRoot);

    // let clicked = false;
    // while (!clicked &&)
    [document, ...shadowRoots].forEach((root) => {
      const elements = Array.from(
        //root.querySelectorAll('button,a,[onclick],.btn')
        root.querySelectorAll('button,a')
      ).filter(
        (el) =>
          re.test(el.textContent) && !el.getAttribute('href')?.startsWith('#')
      );
      elements?.[0]?.click();
    });
  });

  //job.log('waiting for idle');
  //job.progress(25);
  await page.waitForNetworkIdle({ idleTime: 200 });
  job.progress(26);
  //await setTimeout(750);
  job.progress(27);
  // fix ENAMETOOLONG for very long target filenames (maximum 255 characters for ext4)
  targetFilename = targetFilename.substr(0, 255);

  await page.bringToFront();
  const result = await page.screenshot({
    path: targetFilename + '.jpeg',
    type: 'jpeg', // jpeg, png, webp
    //type: 'webp',
    quality: 90,
    omitBackground: false,
    fullPage: true,
    captureBeyondViewport: true,
    // clip: {
    //   x: 2,
    //   y: PYWB_TOOLBAR_HEIGHT,
    //   width: 1366 - 4,
    //   height: 1024,
    // },
  });
  // await page.screenshot({
  //   path: targetFilename + '.webp',
  //   type: 'webp', // jpeg, png, webp
  //   //type: 'webp',
  //   quality: 90,
  //   omitBackground: false,
  //   fullPage: true,

  //   // clip: {
  //   //   x: 2,
  //   //   y: PYWB_TOOLBAR_HEIGHT,
  //   //   width: 1366 - 4,
  //   //   height: 1024,
  //   // },
  // });
  job.progress(80);

  // function PromiseTimeout(delayms) {
  //   return new Promise(function (resolve, reject) {
  //     setTimeout(resolve, delayms);
  //   });
  // }
  // await PromiseTimeout(10000);

  //const t0 = performance.now();
  const diff = await getImageWhite(result);
  job.log(`diff to white is ${(Math.round(diff * 100 * 10) / 10).toFixed(1)}%`);

  //const t1 = performance.now();
  //console.log('used ', (t1-t0) / 1000 );

  if (diff < 0.01) {
    // result screenshot is >99% white
    job.log('white test fails: keep, but copy to failed folder');
    // delete screenshot image
    //await unlinkAsync(targetFilename);
    //throw new Error("white page detected - deleted screenshot and aborting");

    // copy file to failed directory
    const tzOffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
    const localISOTime = new Date(Date.now() - tzOffset)
      .toISOString()
      .slice(0, -1);
    const targetFailed = `${failedPath}${path.sep}${localISOTime.replace(
      /[:.]/g,
      '-'
    )}_${path.basename(targetFilename).replace(/\.jpg$/, '--white-fail.jpg')}`;
    job.log(`copy ${targetFilename} to ${targetFailed}`);

    // copyfile syscall mysteriously fails with EPERM -1 on ehelvetica-test (NFS),
    // possibly due to https://github.com/nodejs/node/issues/36439
    //const result = await copyFileAsync(targetFilename, targetFailed);

    // Workaround 1
    //require('child_process').spawnSync('/bin/cp', ['-bf', targetFilename, targetFailed], { stdio: 'ignore' });

    // Workaround 2 (we have the screenshot already in the result buffer!)
    const res = await writeFileAsync(targetFailed, result);
  }

  job.progress(85);
}

const screenshot = async (
  url,
  targetFilename = 'screenshot.jpg',
  job,
  failedPath,
  conf
) => {
  failedPath = failedPath ?? conf.testsFailedDir;
  logger.info('generateScreenshot', url, 'target filename', targetFilename);

  console.log({ url, targetFilename, job });
  let browser;
  let page;
  try {
    // host rules for local development
    let hostRules;

    if (conf?.dockerHostLookup === true) {
      dockerHostIp = await util.promisify(dns.lookup)('host.docker.internal');
      logger.info(
        `using remapped dns for development (docker host=${dockerHostIp.address})`
      );
      hostRules = `--host-resolver-rules=MAP access.ehelvetica.localhost ${dockerHostIp.address},MAP pywb.ehelvetica.localhost ${dockerHostIp.address}`;
    }

    // family filter
    const results = await checkDomains([new URL(url).hostname]);
    console.log({ results });
    if (!results?.[0]?.allowed) {
      throw new Error(`blocked ${url}`);
    }

    const pathToExtension = '/extensions/consent-o-matic';
    //const pathToExtension = '/extensions/ISDCAC-chrome-source';
    // startup performance: see also https://github.com/GoogleChrome/puppeteer/issues/1718

    // see https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md#tips
    let args = [
      '--disable-dev-shm-usage',
      //'--proxy-server="direct://"',
      //"--proxy-bypass-list=*",
      '--allow-insecure-localhost',
      '--no-first-run',
      '--homepage=about:blank',
      '--disable-gpu',
      '--no-sandbox',
      //'--single-process',
      '--disable-setuid-sandbox',
    ];
    args = [
      '--disable-dev-shm-usage',
      //'--proxy-server=http://127.0.0.1:8000',
      '--allow-insecure-localhost',
      //'--no-first-run',
      '--homepage=about:blank',
      //'--disable-gpu',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',
      '--no-sandbox',
      '--no-zygote',

      // disable cache - see https://stackoverflow.com/questions/68674577/puppeteer-consuming-too-much-disk-space-with-temporary-files
      '--aggressive-cache-discard',
      '--disable-cache',
      '--disable-application-cache',
      '--disable-offline-load-stale-cache',
      '--disable-gpu-shader-disk-cache',
      '--media-cache-size=0',
      '--disk-cache-size=0',
      '--headless=true',
      '--ignore-certificate-errors',
      //`--disable-extensions-except=/extensions/ISDCAC-chrome-source,consent-o-matic`,
      `--disable-extensions-except=/extensions/ISDCAC-chrome-source,/extensions/consent-o-matic,/extensions/uBlock0.chromium`,
      // `--load-extension=/extensions/consent-o-matic`,
      `--load-extension=/extensions/ISDCAC-chrome-source`,
      `--load-extension=/extensions/uBlock0.chromium`,
    ];
    if (hostRules) {
      args.push(hostRules);
    }

    // NL cookies
    // accept|accepteren|accepteer|toestaan|akkoord|consent|allow|toestemming
    // start puppeteer, handle failed launches
    const launchPuppeteer = async () => {
      return await puppeteer.launch({
        //executablePath: `/usr/bin/firefox`,
        //executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox',
        //executablePath: "google-chrome-stable",
        // executablePath:
        //   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        //product: 'firefox',
        executablePath:
          process.env.APP_BROWSER_PATH ?? '/usr/bin/chromium-browser',
        ignoreHTTPSErrors: true,
        dumpio: false,
        args,
        devtools: true,
        extraPrefsFirefox: {
          'network.proxy.type': 1,
          'network.proxy.http': '127.0.0.1',
          'network.proxy.ssl': '127.0.0.1',
          // 'network.proxy.ssl_port': 8001,
          // 'network.proxy.http_port': 8001,
          'network.proxy.no_proxies_on': '',
          'network.proxy.allow_hijacking_localhost': true,
          'network.proxy.share_proxy_settings': true,
          'browser.startup.homepage': 'about:blank',
          'network.captive-portal-service.enabled': false,
        },
        protocolTimeout: 30_000,
        headless:
          process.env['APP_BROWSER_HEADLESS'] === 'false' ? false : true,
      });
    };

    launchRestart = true;
    launchRestartCount = 0;

    while (launchRestart && launchRestartCount < 1) {
      launchRestartCount++;
      launchRestart = false;

      try {
        browser = await launchPuppeteer();
        console.log({ browser });
        browser?.on('error', (err) => {
          console.error(err);
        });
        browser?.on('disconnected', async () => {
          // make sure everything is terminated
          if (browser?.process()) {
            console.log('force terminate');
            browser?.process()?.kill('SIGINT');
          }
        });

        // store chromium pid for killing operations
        await job.update({ ...job.data, pid: browser?.process()?.pid });
      } catch (e) {
        if (launchRestartCount >= 3) {
          // throw exception after 3 failed restarts
          launchRestart = false;
          throw e;
        } else {
          launchRestart = true;
        }
      }
    }

    const page = await browser.newPage();
    await page.setBypassCSP(false);
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    );

    const version = await page.browser().version();
    job.log(`using engine ${version}`);
    logger.info(`using engine ${version}`);

    await page.setViewport({
      width: 1366,
      //height: 1024 + PYWB_TOOLBAR_HEIGHT + 2,
      height: 1024,
      deviceScaleFactor: 2,
      isLandscape: true,
    });

    //await page.setExtraHTTPHeaders(headers);
    //await page.setCookie(cookie);
    if (conf.basicAuth && conf.basicAuth.user?.length > 0) {
      await page.authenticate({
        username: conf.basicAuth.user,
        password: conf.basicAuth.pass,
      });
    }

    job.progress(5);

    // login to e-helvetica
    // job.log(`- open ${conf.frontendUrl}/`);
    // logger.info(`- open ${conf.frontendUrl}/`);
    // await page.goto(`${conf.frontendUrl}/`, {
    //   waitUntil:
    //     conf.engine === 'firefox'
    //       ? ['domcontentloaded']
    //       : ['networkidle2', 'load', 'domcontentloaded'],
    //   timeout: 120000,
    // });
    // job.progress(7);

    // await Promise.all([
    //   page.mainFrame().click('.app__user > button'),
    //   page.waitForSelector('#e-login__userid'),
    // ]);
    // job.progress(10);

    // await page.type('#e-login__userid', conf.accessUser);
    // job.progress(11);
    // await page.type('#e-login__password', conf.accessPassword ?? '');
    // job.progress(12);

    // popup dialog handling
    page.on('dialog', async (dialog) => {
      job.log('-> dismissing dialog');
      await dialog.dismiss();
    });

    // prevent race-conditions (see https://github.com/GoogleChrome/puppeteer/issues/3338)
    // const [response] = await Promise.all([
    //   page.mainFrame().waitForNavigation(),
    //   page.mainFrame().click('.e-login input[type="submit"]'),
    // ]);
    // job.progress(15);
    // job.log('opening blank page');
    // await page.goto('about:blank');
    // job.progress(16);
    job.log('goto url ' + url);

    // let numRedirects = 0;
    // let result = { redirect: url };
    // while (result.redirect && numRedirects < MAX_META_REDIRECTS) {
    //   result = await doPageScreenshot(job, targetFilename, page, url);
    //   if (result.redirect) {
    //     url = result.redirect;
    //     numRedirects++;
    //   }
    //   console.log(result, numRedirects);
    // }
    await doPageScreenshot(job, targetFilename, page, url, failedPath, conf);

    // write out warc
    // const warcGen = new PuppeteerWARCGenerator();
    // const warcFilename = `${targetFilename.replace(/\.jpg|\.webp/, '')}.warc`;
    // await warcGen.generateWARC(cap, {
    //   warcOpts: {
    //     warcPath: warcFilename,
    //   },
    //   winfo: {
    //     description: url,
    //     //isPartOf: 'My awesome pywb collection'
    //   },
    // });
    // await gzipFile(warcFilename, `${warcFilename}.gz`);

    job.progress(90);
    await page.close();
    job.progress(95);
    await browser.close();
    job.progress(100);

    return { filename: targetFilename };
  } catch (error) {
    console.error('got exception', error);
    throw new Error(error);
  } finally {
    const pid = browser?.process().pid ?? -1;
    if (page) {
      console.log('awaiting page(s).close()');
      const pages = await browser.pages();
      for (const page of pages) await page.close();
    }
    if (browser) {
      console.log('awaiting browser.close()');
      await browser.close();
    }

    // clean up dev profile
    // inspired by https://github.com/puppeteer/puppeteer/issues/1791#issuecomment-367715074
    const profileDir = browser
      .process()
      .spawnargs.find((arg) => arg.indexOf('--user-data-dir=') === 0)
      ?.replace('--user-data-dir=', '');

    if (profileDir) {
      await rm(profileDir, { recursive: true, maxRetries: 3, retryDelay: 250 });
    }

    // kill chromium processes still remaining
    // https://github.com/puppeteer/puppeteer/issues/1825#issuecomment-1207929356
    try {
      const killed = browser?.process()?.kill(9);
      logger.debug(`process ${pid} killed? ${killed ? 'yes' : 'no'}`);
      if (!killed && pid >= 0) {
        logger.debug(`sending SIGKILL to ${-pid}`);
        process.kill(-pid, 'SIGKILL');
      }
    } catch (e) {
      if (e.code !== 'ESRCH') {
        // POSIX [ESRCH] No process or process group can be found corresponding to that specified by pid.
        console.error(e);
      }
    }
  }
};

module.exports = {
  screenshot,
};
