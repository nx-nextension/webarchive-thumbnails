const dns = require('dns').promises;
const fs = require('fs').promises;

// Cloudflare's Parental DNS Filter IP
const CF_FAMILY_DNS = '1.1.1.3';

// Rate limiter: maximum parallel requests
const MAX_PARALLEL_REQUESTS = 5;
let pLimit;

async function loadBlockedDomains(path) {
  try {
    const data = await fs.readFile(`${path}/blocked-domains.txt`, 'utf8');
    return new Set(data.split('\n').filter(Boolean));
  } catch (err) {
    if (err.code === 'ENOENT') return new Set(); // file doesn't exist yet
    throw err;
  }
}

let blockedDomainsSet = new Set();
async function checkDomain(domain) {
  if (blockedDomainsSet.has(domain)) {
    return { domain, allowed: false };
  }

  try {
    const resolver = new dns.Resolver();
    resolver.setServers([CF_FAMILY_DNS]);

    // Query for A record
    const addresses = await resolver.resolve(domain);
    //console.log(`query cf dns for ${addresses}`);

    if (addresses.includes('0.0.0.0')) {
      console.log(`${domain}: BLOCKED`);
      return { domain, allowed: false, reason: 'blocked' };
    }

    console.log(`${domain}: ALLOWED`);
    return { domain, allowed: true };
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      console.log(`${domain}: BLOCKED`);
      return { domain, allowed: false, reason: 'error' };
    }
    console.error(`${domain}: ERROR - ${error.message}`);
    return { domain, error: error.message };
  }
}

async function runChecks(domains) {
  pLimit = (await import('p-limit')).default;
  const limit = pLimit(MAX_PARALLEL_REQUESTS);

  const results = await Promise.all(
    domains.map((domain) => limit(() => checkDomain(domain)))
  );

  const newBlockedDomains = results
    .filter(
      (result) =>
        result.allowed === false &&
        result.reason === 'blocked' &&
        !blockedDomainsSet.has(result.domain)
    )
    .map((result) => result.domain);

  if (newBlockedDomains.length > 0) {
    await fs.appendFile(
      '/failed/blocked-domains.txt',
      newBlockedDomains.join('\n') + '\n'
    );
    console.log(
      `\nNew blocked domains have been appended to blocked-domains.txt ${newBlockedDomains.join(
        '\n'
      )}`
    );
    newBlockedDomains.forEach((domain) => blockedDomainsSet.add(domain));
  }

  // console.log('\nResults:');
  // results.forEach((result) => {
  //   if (result.allowed === true) {
  //     console.log(`${result.domain}: ✅ Allowed`);
  //   } else if (result.allowed === false) {
  //     console.log(`${result.domain}: 🚫 Blocked`);
  //   } else {
  //     console.log(`${result.domain}: ⚠️ Error (${result.error})`);
  //   }
  // });
  return results;
}

async function main() {
  const path = '/failed';
  blockedDomainsSet = new Set(await loadBlockedDomains(path));
  // Domains to check
  // const domains = [
  // ];
  // await runChecks(domains);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
});

const checkDomains = async (domains) => {
  return await runChecks(domains);
};

module.exports = {
  checkDomains,
};
