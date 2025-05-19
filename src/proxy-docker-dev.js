const httpProxy = require('http-proxy');
const url = require('url');
const net = require('net');
const http = require('http');
const logger = require('./lib/logger')('EHELV-ACCESS-COLLAGE:APP');
const util = require('util');
const dns = require('dns');

let dockerHost;
util
  .promisify(dns.lookup)('host.docker.internal')
  .then((result) => {
    dockerHost = result;
    logger.info(
      `using remapped dns for development (docker host=${dockerHost.address})`
    );
  });

const proxy = httpProxy.createServer({});
// proxy.on('proxyReq', function (proxyReq, req, res, options) {
//   console.log('proxyReq', req.url, options);
//   //delete req.headers['proxy-authorization'];
// });
proxy.on('error', function (err, req, res) {
  console.error(err);
  // res.writeHead(500, {
  //   'Content-Type': 'text/plain',
  // });

  // res.end('Something went wrong. And we are reporting a custom error message.');
});
proxy.on('proxyRes', function (proxyRes, req, res) {
  console.log(
    'RAW Response from the target',
    JSON.stringify(proxyRes.headers, true, 2)
  );
});

const server = http.createServer(function (req, res) {
  console.log('dockerHostIp', dockerHost);
  console.log('proxyServer', req.method, req.url, req.headers);
  // remove any proxy server authentication (if set)

  const targetUrl = new URL(req.url);
  let target = `${targetUrl.method}://${targetUrl.hostname}:${
    targetUrl.port ?? 80
  }`;
  if (req.headers.host?.match(/\.ehelvetica.localhost/)) {
    target = `http://${dockerHost.address}:8088`;
  }

  console.log('proxy to target', target);
  proxy.web(req, res, {
    target,
  });
});

server.listen(8001);

module.exports = server;
