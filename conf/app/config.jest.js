module.exports = {
  // log level of application
  logLevel: process.env['APP_LOG_LEVEL'] ?? 'debug',

  // target directory to store generated screenshots
  targetDir: process.env['APP_DATA_DIR'] ?? '/data',
  testsFailedDir: process.env['APP_FAILED_DIR'] ?? '/failed',

  // concurrency level of bulljs processors
  maxProcesses: +(process.env['APP_MAX_CONCURRENCY'] ?? 12),

  // URL to render pdf files
  // 'https://pywb.ehelvetica-dev.ch/static/pdf.html'
  pdfRendererUrl: process.env['APP_PDF_URL'],

  accessUser: process.env['APP_ACCESS_USER'],
  accessPassword: process.env['APP_ACCESS_PASS'] ?? '',

  // solr url for cli processes (legacy, unused)
  solrUrl: [],

  basicAuth: null,

  //frontendUrl: 'http://host.docker.internal:8088',
  frontendUrl: 'https://access.ehelvetica.localhost:8443',
  webarchivesCollection: 'webarchives',

  pywbBaseUrl: 'http://host.docker.internal:8099',

  // browser engine to use (chrome or firefox)
  engine: 'chrome',

  // option - if running locally outside container
  //browserExecutable: '/usr/bin/firefox',
};
