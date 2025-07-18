import { log } from './lib/logging.ts';
import { Browser, Page } from 'puppeteer';
import UserAgent from 'user-agents';
import sharp, { type FormatEnum } from 'sharp';
import { saveConvertedImage, shortenPathname } from './lib/utils.ts';
import { getBrowser } from './puppeteer.ts';
import NodeWARC from 'node-warc';
import { join } from 'node:path';

// @ts-ignore for now
const { PuppeteerCapturer, PuppeteerWARCGenerator } = NodeWARC;

/**
 * Clears the browser cache and cookies for a given page instance.
 * @param page
 */
export const clearCache = async (page: Page) => {
  const client = await page.createCDPSession();
  await client.send('Network.clearBrowserCache');
  await client.send('Network.clearBrowserCookies');
};

const logProgressDefault = (msg: string, progress: number) => {
  log.info(`${progress}: ${msg}`);
};

export interface ScrapeOptions {
  warcCapture?: boolean;
  warcOutputPath?: string;
  fullPage?: boolean;
  imagePath?: string;
  imageNativeFormat?: 'jpeg' | 'webp' | 'png';
  imageConvertFormat?: keyof FormatEnum | undefined;
  timeoutPageOpen?: number;
  viewport?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
    isLandscape?: boolean;
  };
}

export const singleCapture = async (
  url: string,
  browser?: Browser,
  page?: Page,
  logProgress?: (msg: string, progress: number) => void,
  options?: ScrapeOptions
) => {
  const opts: ScrapeOptions = {
    warcCapture: true,
    warcOutputPath: '/data/warcs',
    fullPage: true,
    imageNativeFormat: 'jpeg',
    imageConvertFormat: 'avif',
    imagePath: process.env.APP_IMAGE_PATH ?? '/data/screenshots',
    timeoutPageOpen: 30_000,
    viewport: {
      width: 1400,
      height: 1200,
      deviceScaleFactor: 1.0,
      isLandscape: true,
    },
    ...(options ?? {}),
  };
  // get new browser instance
  if (!browser) {
    browser = await getBrowser({});
  }
  // get new page context
  if (!page) {
    page = await browser.newPage();
  }

  // start request capturing if needed
  let cap: any; //PuppeteerCapturer;
  if (opts.warcCapture) {
    cap = new PuppeteerCapturer(page, 'request');
    cap.startCapturing();
  }

  // global page options
  await page.setBypassCSP(false);

  // create random user agent string
  // const userAgent = new UserAgent({});
  // log.info('using user agent %o', userAgent().toString());
  // await page.setUserAgent(
  //   //'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Chromium/134.0.0.0 Safari/537.36'
  //   userAgent.toString()
  // );

  // set viewport size
  await page.setViewport({
    width: opts.viewport.width,
    height: opts.viewport.height,
    deviceScaleFactor: opts.viewport.deviceScaleFactor,
  });
  // captcha solver
  if (process.env.PPTR_CAPTCHA) {
    const { captchas } = await page.findRecaptchas();
    log.info(`${captchas.length} captchas found`);
    await page.solveRecaptchas();
  }

  try {
    // navigate to page
    await page.goto(url, {
      // waitUntil:
      //   browser.version().engine === 'firefox' ? ['load'] : ['load', 'networkidle0'],
      timeout: opts.timeoutPageOpen,
    });

    await page.waitForNetworkIdle({ idleTime: 500 });
  } catch (e) {
    if (e && e.name !== 'TimeoutError') {
      // ignore timeout errors but rethrow everything else
      throw e;
    } else {
      // continue with unknown loading state (most of time page has loaded, but something hangs)
      log.info('> skipping page open timeout');
    }
  }

  // await page.evaluate(() => {
  //   window.scrollTo({
  //     left: 0,
  //     top: document.body.scrollHeight,
  //     behavior: 'smooth',
  //   });
  // });

  // make sure window is in front (in case of multiple instances and high load)
  await page.bringToFront();

  // create screenshot
  const targetFormat = opts.imageConvertFormat ?? opts.imageNativeFormat;
  const targetPath: string = join(
    opts.imagePath,
    shortenPathname(`${encodeURIComponent(url)}.${targetFormat}`)
  );
  const screenshotBuffer = await page.screenshot({
    fullPage: opts.fullPage,
    captureBeyondViewport: true,
    ...(['jpeg', 'webp', 'png'].indexOf(targetFormat) >= 0 && {
      path: targetPath as `${string}.png` | `${string}.jpeg` | `${string}.webp`,
    }),
  });
  if (opts.imageConvertFormat) {
    log.info(
      `writing screenshot as ${opts.imageConvertFormat} to ${targetPath}`
    );
    await saveConvertedImage(screenshotBuffer, targetFormat, targetPath);
  }
};
