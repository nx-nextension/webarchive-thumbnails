const sharp = require('sharp');
const { performance, PerformanceObserver } = require('perf_hooks');
const logger = require('./lib/logger')();
const conf = require('../config/config');
const path = require('path');

async function doColorAnalysis(job, targetFilename) {
  job.log('- get dominant colors of ', targetFilename);
  job.progress(100);
}

async function doSolrIndexing(job, targetFilename) {}

async function doIndex(job, targetFilename) {
  await doColorAnalysis(job, targetFilename);
  job.progress(100);
}

// (async () => {
//   const url = 'http://pywb.ehelvetica.localhost:8088/nb-webarchive/20180911013031/https://abcd123456.ch/';
//   await screenshot(url, '/Users/kjauslin/projects/nb/e-helvetica-access/access-thumbnails/screenshot.jpg', {
//      progress: p => console.log(p),
//      log: t => console.log(t)
//   }, process.cwd() + '/failed');
// })();

module.exports = function (job) {
  return doIndex(job);
};
