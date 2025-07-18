/**
 * Fetch the range of bytes specified. Note that end is *exclusive*, though the header
 * expects *inclusive* values. This removes the need to continually subtract 1 from
 * the more usual end-exclusive values used elsewhere.
 *
 * @param url
 * @param start
 * @param end
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchRange(url, start, end) {
  try {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end - 1}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error(`Error fetching range ${start}-${end - 1}:`, error);
    throw error;
  }
}

export async function fetchContentLength(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      throw new Error("Couldn't get content length from headers");
    }

    return parseInt(contentLength, 10);
  } catch (error) {
    console.error('Error getting file size:', error);
    throw error;
  }
}

/**
 * Wrapper around an ArrayBuffer that allows sequential reading of Uint16,
 * Uint32 and UTF-8 strings, without the need for having to keep track of
 * where you are in the buffer. Will also throw an error if you attempt to
 * overrun the bounds of the buffer.
 */
export class LittleEndianDataReader {
  constructor(buffer) {
    this.buffer = buffer;

    this.view = new DataView(buffer);
    this.pos = 0;
  }

  checkBounds(newPos) {
    if (newPos < 0) {
      throw new Error('Trying to move before start of buffer');
    } else if (newPos > this.buffer) {
      throw new Error('Trying to move after end of buffer');
    }
  }

  readUint16() {
    const posAfterRead = this.pos + 2;
    this.checkBounds(posAfterRead);

    const num = this.view.getUint16(this.pos, true);
    this.pos = posAfterRead;

    return num;
  }

  readUint32() {
    const posAfterRead = this.pos + 4;
    this.checkBounds(posAfterRead);

    const num = this.view.getUint32(this.pos, true);
    this.pos = posAfterRead;

    return num;
  }

  readString(len) {
    const posAfterRead = this.pos + len;
    this.checkBounds(posAfterRead);

    const bytes = new Uint8Array(this.buffer, this.pos, len);
    this.pos = posAfterRead;

    return new TextDecoder().decode(bytes);
  }

  skip(len) {
    const posAfterSkip = this.pos + len;
    this.checkBounds(posAfterSkip);

    this.pos = posAfterSkip;
  }

  reset(pos) {
    this.checkBounds(pos);
    this.pos = pos;
  }
}

// Some standard zip sizes in bytes
const maxCommentSize = 0xffff;
const eocdSizeWithoutComment = 22;
const zip64EocdLocatorSize = 20;
const fixedLocalHeaderSize = 30;

/**
 * Searches backwards in the supplied bytesToSearchIn for the bytesToFind
 *
 * @param bytesToSearchIn
 * @param bytesToFind
 * @return -1 if bytesToFind is not found, otherwise the index of
 *         the start of the last occurrence of bytesToFind in bytesToSearchIn
 */
function findBackwards(bytesToSearchIn, bytesToFind) {
  if (bytesToFind.length > bytesToSearchIn.length) {
    return -1;
  }

  for (let i = bytesToSearchIn.length - bytesToFind.length; i > -1; i--) {
    let found = true;
    for (let j = 0; j < bytesToFind.length && found; j++) {
      if (bytesToSearchIn.at(i + j) !== bytesToFind.at(j)) {
        found = false;
      }
    }
    if (found) {
      return i;
    }
  }

  return -1;
}

function readEocd(reader) {
  const magicNumber = reader.readUint32();
  const diskNumber = reader.readUint16();
  const startOfCdDiskNumber = reader.readUint16();
  const entriesOnDisk = reader.readUint16();
  const totalEntries = reader.readUint16();
  const centralDirectorySize = reader.readUint32();
  const centralDirectoryOffset = reader.readUint32();
  const commentLength = reader.readUint16();
  const comment = commentLength > 0 ? reader.readString(commentLength) : '';

  return { totalEntries, centralDirectorySize, centralDirectoryOffset };
}

function findAndReadEocd(eocdArrayBuffer) {
  const startOfEocdsInBytes = findBackwards(new Uint8Array(eocdArrayBuffer), new Uint8Array([0x50, 0x4b, 0x05, 0x06]));
  if (startOfEocdsInBytes === -1) {
    throw new Error('Invalid SZI file, no End Of Central Directory Record found');
  }

  const eocdReader = new LittleEndianDataReader(eocdArrayBuffer);
  eocdReader.skip(startOfEocdsInBytes);

  return readEocd(eocdReader);
}

function readCentralDirectory(cdArrayBuffer, totalEntries) {
  const reader = new LittleEndianDataReader(cdArrayBuffer);
  const centralDirectory = [];
  for (let i = 0; i < totalEntries; i++) {
    const magicNumber = reader.readUint32();
    if (magicNumber !== 0x02014b50) {
      throw new Error(`Invalid SZI file: entry ${i} has unexpected magic number`);
    }

    const versionMadeBy = reader.readUint16();
    const versionNeededToExtract = reader.readUint16();
    const bitFlag = reader.readUint16();
    const compressionMethod = reader.readUint16();
    const lastModFileTime = reader.readUint16();
    const lastModeFileDate = reader.readUint16();
    const crc32 = reader.readUint32();
    const compressedSize = reader.readUint32();
    const uncompressedSize = reader.readUint32();

    if (compressedSize !== uncompressedSize) {
      throw new Error(
        `Invalid SZI file: compressedSize: ${compressedSize}` +
          `and uncompressedSize: ${uncompressedSize} don't match!`,
      );
    }

    const filenameLength = reader.readUint16();
    const extraFieldLength = reader.readUint16();
    const fileCommentLength = reader.readUint16();

    const diskNumberStart = reader.readUint16();
    const internalFileAttributes = reader.readUint16();
    const externalFileAttributes = reader.readUint32();
    const relativeOffsetOfLocalHeader = reader.readUint32();

    const filename = reader.readString(filenameLength);
    const extraField = reader.readString(extraFieldLength);
    const fileComment = reader.readString(fileCommentLength);

    centralDirectory.push({
      compressedSize,
      uncompressedSize,
      relativeOffsetOfLocalHeader,
      filename,
      extraField,
      filenameLength,
      extraFieldLength,
    });
  }
  return centralDirectory;
}

function generateMapOfFileBodyLocations(centralDirectory) {
  return centralDirectory.reduce((filenameToLocation, entry) => {
    // Assume that the extra fields on the local header are the same length of those
    // on the central directory entry. This feels a bit ehhhhh....
    const start =
      entry.relativeOffsetOfLocalHeader + fixedLocalHeaderSize + entry.filenameLength + entry.extraFieldLength;
    const end = start + entry.uncompressedSize;

    filenameToLocation.set(entry.filename, { start, end });
    return filenameToLocation;
  }, new Map());
}

export async function getContentsOfSziFile(url) {
  const fileSize = await fetchContentLength(url);

  const minStartOfEocds = fileSize - (zip64EocdLocatorSize + eocdSizeWithoutComment + maxCommentSize);
  const eocdArrayBuffer = await fetchRange(url, Math.max(0, minStartOfEocds), fileSize);
  const eocd = findAndReadEocd(eocdArrayBuffer);

  if (eocd.centralDirectoryOffset === 0xffff || eocd.centralDirectorySize === 0xffff) {
    throw Error('Yikes, this looks like a zip64, deal with this later');
  }

  const cdArrayBuffer = await fetchRange(
    url,
    eocd.centralDirectoryOffset,
    eocd.centralDirectoryOffset + eocd.centralDirectorySize,
  );
  const centralDirectory = readCentralDirectory(cdArrayBuffer, eocd.totalEntries);
  return generateMapOfFileBodyLocations(centralDirectory);
}

export class UrlMapper {
  constructor(sziUrl) {
    this.sziParsedUrl = URL.parse(sziUrl);
    if (!this.sziParsedUrl) {
      throw new Error('Invalid Szi Tile Source URL!');
    }

    const sziPathParts = this.sziParsedUrl.pathname.split('/');
    if (!sziPathParts.length) {
      throw new Error('Invalid Szi Tile Source URL!');
    }

    const sziFilename = sziPathParts.at(-1);
    if (!sziFilename || !sziFilename.endsWith('.szi')) {
      throw new Error(`Invalid Szi Tile Source filename: ${sziFilename}`);
    }

    this.sziFilenameWithoutSuffix = sziFilename.substring(0, sziFilename.length - 4);
    this.sziPathWithoutFilename = sziPathParts.slice(0, -1).join('/') + '/';
  }

  pathInSziFromDziUrl(dziUrl) {
    const dziParsedUrl = URL.parse(dziUrl);
    if (!dziParsedUrl.pathname.startsWith(this.sziPathWithoutFilename)) {
      throw new Error('Invalid Dzi Tile Source URL!');
    }

    return dziParsedUrl.pathname.substring(this.sziPathWithoutFilename.length);
  }

  dziXmlUrl() {
    const url = this.sziParsedUrl.href;
    const dziParsedUrl = URL.parse(url);
    dziParsedUrl.pathname = `${this.sziPathWithoutFilename}${this.sziFilenameWithoutSuffix}/${this.sziFilenameWithoutSuffix}.dzi`;
    return dziParsedUrl.href;
  }
}

export const enableSziTileSource = (OpenSeadragon) => {
  class SziTileSource extends OpenSeadragon.DziTileSource {
    constructor(contents, urlMapper, options = {}) {
      super(options);
      this.contents = contents;
      this.urlMapper = urlMapper;
    }

    static createSziTileSource = async (url) => {
      const contents = await getContentsOfSziFile(url);
      const urlMapper = new UrlMapper(url);

      const dziXmlUrl = urlMapper.dziXmlUrl();

      const dziRange = contents.get(urlMapper.pathInSziFromDziUrl(dziXmlUrl));
      if (!dziRange) {
        throw new Error('.dzi file not found in .szi file');
      }

      const dziArrayBuffer = await fetchRange(url, dziRange.start, dziRange.end);
      const dziXmlText = new TextDecoder().decode(new Uint8Array(dziArrayBuffer));
      const dziXml = OpenSeadragon.parseXml(dziXmlText);

      const options = OpenSeadragon.DziTileSource.prototype.configure(dziXml, dziXmlUrl, '');

      return new SziTileSource(contents, urlMapper, options);
    };

    /**
     * Download tile data.
     * Note that if you override this function, you should override also downloadTileAbort().
     * @param {ImageJob} context job context that you have to call finish(...) on.
     * @param {String} [context.src] - URL of image to download.
     * @param {String} [context.loadWithAjax] - Whether to load this image with AJAX.
     * @param {String} [context.ajaxHeaders] - Headers to add to the image request if using AJAX.
     * @param {Boolean} [context.ajaxWithCredentials] - Whether to set withCredentials on AJAX requests.
     * @param {String} [context.crossOriginPolicy] - CORS policy to use for downloads
     * @param {String} [context.postData] - HTTP POST data (usually but not necessarily in k=v&k2=v2... form,
     *   see TileSource::getPostData) or null
     * @param {*} [context.userData] - Empty object to attach your own data and helper variables to.
     * @param {Function} [context.finish] - Should be called unless abort() was executed, e.g. on all occasions,
     *   be it successful or unsuccessful request.
     *   Usage: context.finish(data, request, errMessage). Pass the downloaded data object or null upon failure.
     *   Add also reference to an ajax request if used. Provide error message in case of failure.
     * @param {Function} [context.abort] - Called automatically when the job times out.
     *   Usage: context.abort().
     * @param {Function} [context.callback] @private - Called automatically once image has been downloaded
     *   (triggered by finish).
     * @param {Number} [context.timeout] @private - The max number of milliseconds that
     *   this image job may take to complete.
     * @param {string} [context.errorMsg] @private - The final error message, default null (set by finish).
     */
    downloadTileStart = (context) => {
      const image = new Image();
      image.onload = function () {
        resetImageHandlers();
        context.finish(image, context.userData.request, null);
      };
      image.onabort = image.onerror = function () {
        resetImageHandlers();
        context.finish(null, context.userData.request, 'Image load aborted.');
      };

      const resetImageHandlers = () => {
        image.onload = image.onerror = image.onabort = null;
      };

      context.userData.image = image;
      context.userData.request = null;

      const dziUrl = context.src;
      const dziRange = this.contents.get(this.urlMapper.pathInSziFromDziUrl(dziUrl));
      if (!dziRange) {
        throw new Error('.dzi file not found in .szi file');
      }

      fetchRange(this.urlMapper.sziParsedUrl.href, dziRange.start, dziRange.end).then(
        (arrayBuffer) => {
          const imageBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });
          if (imageBlob.size === 0) {
            resetImageHandlers();
            context.finish(null, context.userData.request, 'Empty image!');
          } else {
            // Turn the blob into an image,
            // When this completes it will trigger finish via the onLoad method of the image
            image.src = (window.URL || window.webkitURL).createObjectURL(imageBlob);
          }
        },
        (error) => {
          resetImageHandlers();
          context.finish(null, context.userData.request, 'Download failed: ' + error.message);
        },
      );
    };

    /**
     * Provide means of aborting the execution.
     * Note that if you override this function, you should override also downloadTileStart().
     * @param {ImageJob} context job, the same object as with downloadTileStart(..)
     * @param {*} [context.userData] - Empty object to attach (and mainly read) your own data.
     */
    downloadTileAbort = (context) => {
      // Note this doesn't actually abort the network request as it's a bit
      // faffy to do, and I'm not sure that it's really necessary!
      var image = context.userData.image;
      if (context.userData.image) {
        image.onload = image.onerror = image.onabort = null;
      }
    };
  }

  OpenSeadragon.SziTileSource = SziTileSource;
};

(function (global, factory) {
  // Skip if currently in ESM mode
  if (typeof exports === 'undefined') {
    return;
  }

  // Check if OpenSeadragon is available
  if (typeof global.OpenSeadragon !== 'undefined') {
    // Attach the GeoTIFFTileSource to the OpenSeadragon namespace
    factory(global.OpenSeadragon);
  }
})(typeof window !== 'undefined' ? window : this, enableSziTileSource);
