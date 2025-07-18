import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import sharp, { type FormatEnum } from 'sharp';

/**
 * Updated shortHash function for filename shortening. Need to keep
 * the "shortHash" function above as changing the output would trigger
 * rerendering of many images. The variableShortHash should be used
 * for new features.
 *
 * @param {} message
 * @param {*} count
 */
export const variableShortHash = (message, count = 8) => {
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
export const shortenPathname = (filename, LIMIT_FILENAME = 250) => {
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

export const gzipFile = async (inputFilePath, outputFilePath) => {
  return new Promise((resolve, reject) => {
    const inputStream = fs.createReadStream(inputFilePath);
    const outputStream = fs.createWriteStream(outputFilePath);
    const gzip = zlib.createGzip();

    // Pipe the input stream through the gzip and into the output stream
    inputStream.pipe(gzip).pipe(outputStream);

    // Handle successful completion
    outputStream.on('finish', () => {
      console.log(`File successfully gzipped: ${outputFilePath}`);
      resolve(undefined);
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

export const saveConvertedImage = async (
  buffer: Uint8Array<ArrayBufferLike>,
  format: keyof FormatEnum,
  path: string
) => {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const MAX_WIDTH = 16384;
  const MAX_HEIGHT = 16384;
  let outputImage = image;
  if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
    outputImage = image.extract({
      left: 0,
      top: 0,
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
    });
  }
  await outputImage.toFormat(format).toFile(path);
};
