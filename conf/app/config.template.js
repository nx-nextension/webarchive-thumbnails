module.exports = {
  // log level of application
  logLevel: process.env['APP_LOG_LEVEL'] ?? 'debug',

  // target directory to store generated screenshots
  targetDir: process.env['APP_DATA_DIR'] ?? '/data',
  testsFailedDir: process.env['APP_FAILED_DIR'] ?? '/failed',

  // concurrency level of bulljs processors
  maxProcesses: +(process.env['APP_MAX_CONCURRENCY'] ?? 4),

  // solr url for cli processes (legacy, unused)
  solrUrl: [],

  basicAuth: {
    user: process.env['APP_BASIC_AUTH_USER'],
    pass: process.env['APP_BASIC_AUTH_PASS'],
  },

  //frontendUrl: 'http://host.docker.internal:8088',
  frontendUrl:
    process.env['APP_FRONTEND_URL'] ??
    'https://access.ehelvetica.localhost:8443',
  webarchivesCollection: process.env['APP_SOLR_COLLECTION'] ?? 'webarchives',

  pywbBaseUrl: 'http://host.docker.internal:8099',

  pdfRendererUrl: 'https://pywb.ehelvetica-dev-host.ch/static/pdf.html',

  accessUser: 'web-thumbnailing@ehelvetica-dev.ch',
  accessPassword: process.env['THUMBNAILS_ACCESS_PASS'] ?? '',

  // browser engine to use (chrome or firefox)
  engine: 'chrome',

  // option - if running locally outside container
  //browserExecutable: '/usr/bin/firefox',
};
