import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from './lib/logging.ts';
import readline from 'readline';
import { clearCache, singleCapture } from './page.ts';
import { getBrowser, terminateBrowser } from './puppeteer.ts';

// get cli arguments
const argv = yargs(hideBin(process.argv)).parse();
//log.info(argv);

// read list of urls from stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  log.info(`processing ${line}`);
  const browser = await getBrowser({});
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await singleCapture(line, browser, page, null, {
    imageConvertFormat: 'avif',
  });
  await clearCache(page);
  // await singleCapture(line, browser, page, null, {
  //   imageConvertFormat: 'avif',
  // });
  await context.close();
  await terminateBrowser(browser);
});
rl.on('close', () => {});
