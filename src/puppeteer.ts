import { lookup } from 'node:dns/promises';
import { tmpdir } from 'node:os';
import { log } from './lib/logging.ts';
import { type Browser } from 'puppeteer';
import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { type VanillaPuppeteer, addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import AnonymizeUA from 'puppeteer-extra-plugin-anonymize-ua';
import AdBlocker from 'puppeteer-extra-plugin-adblocker';
import UserPreferences from 'puppeteer-extra-plugin-user-preferences';

/**
 * Remaps hosts for chromium DNS lookup in order to access localhost
 * sites. This is especially useful in development in order to work with
 * services running on the docker host (in container: host.docker.internal)
 * Remapping can also be used to blacklist selected hosts (e.g. analytics
 * software)
 *
 * Documentation on rules:
 * - https://chromium.googlesource.com/chromium/src/+/main/net/dns/README.md
 * - https://github.com/seleniumbase/SeleniumBase/issues/2281
 *
 * @returns string command line flags with remapped host lookup
 */
export type HostMapRules = Record<string, string>;
const buildDevHostRules = async (rules: HostMapRules) => {
  //if (conf?.dockerHostLookup === true) {
  // get internal ip of docker host
  let dockerHost;
  try {
    const dockerHost = await lookup('host.docker.internal');
  } catch (e) {
    dockerHost = { address: 'host.docker.internal' };
  }
  return Object.entries(rules).map(
    ([source, target]) =>
      `MAP ${source} ${target?.replace(
        'host.docker.internal',
        dockerHost.address
      )})}`
  );
};

/**
 * Imports and initializes an instance of the puppeteer module, configured with the
 * requested puppeteer-extra modules
 *
 */
const getModule = async () => {
  const vanillaPuppeteer = (await import('puppeteer')).default;
  const puppeteer = addExtra(vanillaPuppeteer);

  if (process.env.PPTR_STEALTH) {
    // plug-in stealth
    log.info('using puppeteer-extra stealth plugin');
    const stealth = StealthPlugin();
    //pluginStealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('user-agent-override');
    puppeteer.use(stealth);
  } else {
    log.info('NOT using puppeteer-extra stealth plugin');
  }

  if (process.env.PPTR_CAPTCHA === 'true') {
    // plug-in recaptcha solver
    log.info('using 2captcha plugin');
    const recaptcha = RecaptchaPlugin({
      provider: {
        id: '2captcha',
        token: process.env['CAPTCHA_SOLVER_API_KEY'],
      },
      // colorize reCAPTCHAs (violet = detected, green = solved)
      visualFeedback: true,
      solveScoreBased: true,
    });
    puppeteer.use(recaptcha);
  }

  if (process.env.PPTR_ANONYMIZE_UA === 'true') {
    log.info('using random UA');
    // const anonymizeUA = AnonymizeUA({
    //   stripHeadless: true,
    // });
    //puppeteer.use(anonymizeUA);

    // see https://github.com/berstend/puppeteer-extra/tree/39248f1f5deeb21b1e7eb6ae07b8ef73f1231ab9/packages/puppeteer-extra-plugin-stealth/evasions/user-agent-override
    // for detailed usage of UA override plugin
    const UserAgentOverride = (
      await import(
        'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js'
      )
    ).default;
    const ua = UserAgentOverride({
      // userAgent:
      //   'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1) Chrome/137.0.0.0',
      // locale: 'de-DE,de',
    });
    console.log({ ua });
    puppeteer.use(ua);
  }

  if (process.env.PPTR_USER_PREFERENCES === 'true') {
    // see https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/pref_names.cc
    const userPrefs = UserPreferences({
      userPrefs: {
        'profile.ephemeral_mode': true,
        enable_do_not_track: true,
      },
    });
    puppeteer.use(userPrefs);
  }
  return puppeteer;
};

/**
 * Launches a puppeteer browser process.
 *
 * @param args
 * @param options
 * @returns
 */
const launchPuppeteer = async (
  args: string[],
  options: Parameters<VanillaPuppeteer['launch']>
) => {
  const puppeteer = await getModule();
  return puppeteer.launch({
    executablePath: process.env.APP_BROWSER_PATH ?? '/usr/bin/chromium-browser',
    acceptInsecureCerts: true,
    dumpio: false,
    devtools: false,
    // see https://github.com/berstend/puppeteer-extra/wiki/Common-stealth-issues
    defaultViewport: null,
    headless: process.env['APP_BROWSER_HEADLESS'] === 'false' ? false : true,
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
    env: {
      TZ: process.env.TZ,
    },
    protocolTimeout: 30_000,
    ...options,
    ...args,
  });
};

/**
 * Starts a browser process instance.
 * @param options
 */
export const getBrowser = async (options: any): Promise<Browser> => {
  const userDataDir = mkdtemp(join(tmpdir(), 'pptr-'));
  const args = [
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
    // '--disable-setuid-sandbox',
    // disable cache - see https://stackoverflow.com/questions/68674577/puppeteer-consuming-too-much-disk-space-with-temporary-files
    '--aggressive-cache-discard',
    '--disable-cache',
    '--disable-application-cache',
    '--disable-offline-load-stale-cache',
    '--disable-gpu-shader-disk-cache',
    '--media-cache-size=0',
    '--disk-cache-size=0',
    //"--single-process",
    '--headless=true',
    `--user-data-dir=${userDataDir}`,
    '--ignore-certificate-errors',
    '--disable-infobars',
    '--window-position=0,0',
    //`--disable-extensions-except=/extensions/ISDCAC-chrome-source,consent-o-matic`,
    `--disable-extensions-except=/extensions/ISDCAC-chrome-source,/extensions/consent-o-matic,/extensions/uBlock0.chromium`,
    // `--load-extension=/extensions/consent-o-matic`,
    `--load-extension=/extensions/ISDCAC-chrome-source`,
    `--load-extension=/extensions/uBlock0.chromium`,
  ];
  const hostRules = await buildDevHostRules({});
  if (hostRules) {
    args.push(`--host-resolver-rules=${hostRules}`);
  }

  let keepLaunching = true;
  let launchRestartCount = 0;
  const MAX_LAUNCH_RESTARTS = 3;
  let browser: Browser;
  const puppeteerOptions: Parameters<VanillaPuppeteer['launch']> = [];

  // the browser start may fail for various reasons, e.g. temporary
  // lack of resources, timed-out startup. Instead of directly returning
  // to the caller, we retry a number of times to make the process
  // more stable
  while (keepLaunching && launchRestartCount < MAX_LAUNCH_RESTARTS) {
    launchRestartCount++;
    keepLaunching = false;

    try {
      log.info(
        'launching browser using using args=%o and options %o [attempt=%d]',
        args,
        options,
        launchRestartCount
      );
      browser = await launchPuppeteer(args, puppeteerOptions);

      browser?.on('error', (err) => {
        log.error(err);
      });

      browser?.on('disconnected', async () => {
        // is called when puppeteer is disconnected from browser
        if (browser?.process()) {
          log.info(
            'force terminating browser process id=%d',
            browser?.process()?.pid
          );
          browser?.process()?.kill('SIGKILL');
        }
      });
    } catch (e) {
      if (launchRestartCount >= MAX_LAUNCH_RESTARTS) {
        keepLaunching = false;
        browser = null;
        throw e;
      } else {
        keepLaunching = true;
      }
    }

    if (browser) {
      log.info(
        'successfully started browser engine version=%o',
        await browser.version()
      );
    }
  }

  return browser;
};

/**
 * Removes the created profile directory which can consume large amounts of
 * diskspace.
 *
 * Inspired by https://github.com/puppeteer/puppeteer/issues/1791#issuecomment-367715074
 * @param browser
 */
const cleanupProfileDir = async (browser: Browser) => {
  const profileDir = browser
    .process()
    .spawnargs.find((arg) => arg.indexOf('--user-data-dir=') === 0)
    ?.replace('--user-data-dir=', '');

  if (profileDir) {
    await rm(profileDir, { recursive: true, maxRetries: 3, retryDelay: 250 });
  }
};

/**
 * Terminates a previously created browser process. Uses various methods from
 * nicely asking up to external forceful kill -9
 *
 * @param browser
 */
export const terminateBrowser = async (browser: Browser) => {
  const pid = browser?.process().pid ?? -1;
  log.info('terminating browser process instance pid=%d', pid);

  // close all open pages
  const pages = await browser.pages();
  log.debug('closing %d open page(s)', pages?.length);
  for (const page of pages) await page.close();

  // ask browser to quit
  await browser.close();

  // check if process is still lurking around as zombie
  // https://github.com/puppeteer/puppeteer/issues/1825#issuecomment-1207929356
  try {
    const killed = browser?.process()?.kill(9);
    log.debug(`process ${pid} killed? ${killed ? 'yes' : 'no'}`);

    // sigkill to process group
    if (!killed && pid >= 0) {
      log.debug(`sending SIGKILL to ${-pid}`);
      process.kill(-pid, 'SIGKILL');
    }
  } catch (e) {
    // everything fine is process not found (ESRCH)
    // POSIX [ESRCH] No process or process group can be found corresponding to that
    // specified by pid.
    if (e.code !== 'ESRCH') {
      log.error(e);
    }
  }
};
