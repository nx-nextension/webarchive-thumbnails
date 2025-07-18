# Webarchive Thumbnailing

This repository contains code to generate screenshots from webpages and was initially used for the Webarchive Switzerland Collage application. It can be used free of charge as a starter base to create similar collages and projects.
The code has been extended for generic screenshotting of external websites with the usage of bot detection evasion techniques (e.g. puppeteer-stealth)

## Useful links

- Cloudflare Challenge
  - Test page: https://www.scrapingcourse.com/cloudflare-challenge (and https://www.scrapingcourse.com/ in general)
- Headless Bot detection
  - Test page: https://bot.sannysoft.com
- Browser fingerprinting
  - https://niespodd.github.io/browser-fingerprinting/
  - https://deviceandbrowserinfo.com/info_device
- Puppeteer stealth
  - https://www.npmjs.com/package/puppeteer-extra-plugin-stealth
- Rebrowser Patches and bot detector
  - https://github.com/rebrowser/rebrowser-patches
  - https://bot-detector.rebrowser.net/

## Related repositories

- [Webarchive Collage](https://github.com/SwissNationalLibrary/webarchive-collage) frontend display of interactive collage, backend IIIF serving, permissions, container deployment
- [Webarchive Thumbnailing](https://github.com/SwissNationalLibrary/webarchive-thumbnails) (this repository): reliable mass-production of screenshots of webpages using a headless browser, queuing, container deployment

## Notes

The collage is meant to live behind an instance of [traefik](https://traefik.io/traefik/) running on the same machine. You also need to create the networks mentioned in `compose.dev.yaml`.

## Disclaimer

The code is provided as-is, without any guarantees or warranties. It won't run out-of-the box, it first needs to be integrated with the specific needs of the surrounding systems (like external access and search systems) - these are not part of this project.

## Special Thanks

The release of this code has been made possible by the [Swiss National Library](https://www.nb.admin.ch) in cooperation with the original developer Kai Jauslin at [NEXTENSION GmbH](https://nextension.com).

# License

MIT License

Copyright Swiss National Library and Kai Jauslin
