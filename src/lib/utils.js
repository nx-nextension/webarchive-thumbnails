const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

/**
 * Note: these functions are duplicated from module access-middleware
 * and need to match.
 */

/**
 * Updated shortHash function for filename shortening. Need to keep
 * the "shortHash" function above as changing the output would trigger
 * rerendering of many images. The variableShortHash should be used
 * for new features.
 *
 * @param {} message
 * @param {*} count
 */
variableShortHash = (message, count = 8) => {
  return crypto
    .createHash('shake256', { outputLength: count })
    .update(message)
    .digest('hex');
};

/**
 * Shortens a filename (incl. path) to fit into a given limit of characters. EXT4 limits
 * filenames to 255 chars and pathname is generally limited to 4096 chars in Linux.
 * @note Path limit is currently not enforced as this is controlled in the application.
 * @see https://doc.owncloud.com/server/next/admin_manual/troubleshooting/path_filename_length.html
 *
 * @param {*} filename
 */
shortenPathname = (filename, LIMIT_FILENAME = 250) => {
  const { dir, root, base, name, ext } = path.parse(filename);

  if (base?.length > LIMIT_FILENAME) {
    const hash = variableShortHash(base, 4);
    console.log(hash);
    const shortenedName = name.substring(
      0,
      LIMIT_FILENAME - hash.length - (ext?.length ?? 0) - path.sep.length - 2
    );
    console.log(shortenedName);
    return `${dir}${path.sep}${shortenedName}-${hash}${ext}`;
  } else {
    return filename;
  }
};

const gzipFile = async (inputFilePath, outputFilePath) => {
  return new Promise((resolve, reject) => {
    const inputStream = fs.createReadStream(inputFilePath);
    const outputStream = fs.createWriteStream(outputFilePath);
    const gzip = zlib.createGzip();

    // Pipe the input stream through the gzip and into the output stream
    inputStream.pipe(gzip).pipe(outputStream);

    // Handle successful completion
    outputStream.on('finish', () => {
      console.log(`File successfully gzipped: ${outputFilePath}`);
      resolve();
    });

    // Handle any errors during the process
    inputStream.on('error', (err) => {
      console.error('Error reading file:', err);
      reject(err);
    });

    outputStream.on('error', (err) => {
      console.error('Error writing file:', err);
      reject(err);
    });
  });
};
module.exports = {
  shortenPathname,
  gzipFile,
};
