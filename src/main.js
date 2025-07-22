/**
 * Represents a remote file that we are going to try and read from
 */
class RemoteFile {
  /**
   * Create the remote file by fetching its size using a head request
   *
   * @param url url of the file that we eventually want to read
   * @param fetchOptions options to apply to all fetches,
   * @param fetchOptions.mode cors mode to use
   * @param fetchOptions.credentials whether to send credentials
   * @param fetchOptions.headers additional headers to add to all requests
   * @returns {Promise<RemoteFile>}
   */
  static create = async (url, fetchOptions) => {
    const size = await this.fetchContentLength(url, fetchOptions);
    return new RemoteFile(url, size, fetchOptions);
  };

  static fetchContentLength = async (url, fetchOptions) => {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: fetchOptions.headers,
        mode: fetchOptions.mode,
        credentials: fetchOptions.credentials,
      });

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
  };

  constructor(url, size, fetchOptions) {
    this.url = url;
    this.size = size;
    this.fetchOptions = fetchOptions;
  }

  /**
   * Fetch the range of bytes specified. Note that end is *exclusive*, though the header
   * expects *inclusive* values. This removes the need to continually subtract 1 from
   * the more usual end-exclusive values used elsewhere.
   *
   * @param start inclusive start of range to fetch
   * @param end exclusive start of range to fetch
   * @param abortSignal AbortController signal, optionally specify this if you might want to
   *        abort the request
   * @throws Error if the start or end lie outside the file, or if start > end. Also throws
   *         an error if the request fails with anything other than a status between 200 and
   *         299.
   */
  fetchRange = async (start, end, abortSignal) => {
    if (start < 0 || start > this.size) {
      throw new Error(`Start of fetch range (${start}) out of bounds (0 - ${this.size})!`);
    }

    if (end < 0 || end > this.size) {
      throw new Error(`Start of fetch range (${start}) out of bounds (0 - ${this.size})!`);
    }

    if (start > end) {
      throw new Error(`Start of fetch range (${start}) greater than end (${end})!`);
    }

    const rangeHeaderValue = `bytes=${start}-${end - 1}`;
    const headers = this.fetchOptions.headers
      ? { ...this.fetchOptions.headers, Range: rangeHeaderValue }
      : { Range: rangeHeaderValue };

    const response = await fetch(this.url, {
      headers,
      signal: abortSignal,
      mode: this.fetchOptions.mode,
      credentials: this.fetchOptions.credentials,
    });

    if (!response.ok) {
      throw new Error(`Couldn't fetch range ${start}:${end} of ${url} of ${response.status}`);
    }

    return await response.arrayBuffer();
  };
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

  readUint64() {
    const posAfterRead = this.pos + 8;
    this.checkBounds(posAfterRead);

    const bigInt = this.view.getBigUint64(this.pos, true);
    this.pos = posAfterRead;

    if (bigInt > Number.MAX_SAFE_INTEGER) {
      // TODO: this is to stop things getting messy, and we can probably lift it later
      // TODO: but for now it means that we can use numbers everywhere...
      throw new Error('Only values upto 2^53 are supported!');
    }

    return Number(bigInt);
  }

  readString(len) {
    const bytes = this.readUint8Array(len);
    return new TextDecoder().decode(bytes);
  }

  readUint8Array(len) {
    const posAfterRead = this.pos + len;
    this.checkBounds(posAfterRead);

    const bytes = new Uint8Array(this.buffer, this.pos, len);
    this.pos = posAfterRead;

    return bytes;
  }

  skip(len) {
    const posAfterSkip = this.pos + len;
    this.checkBounds(posAfterSkip);

    this.pos = posAfterSkip;
  }
}

// Some standard zip sizes in bytes
const maxUint32 = 0xffffffff;
const maxUint16 = 0xffff;

const maxCommentSize = maxUint16;
const eocdSizeWithoutComment = 22;
const zip64EocdLocatorSize = 20;
const localHeaderBeforeVariableFieldsSize = 26;
const zip64EocdRecordSizeBetweenSizeAndExtensibleFields = 34;

const zip64ExtraFieldHeaderId = 0x0001;

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

function findStartOfEocd(arrayBuffer) {
  const startOfEocdsInBytes = findBackwards(new Uint8Array(arrayBuffer), new Uint8Array([0x50, 0x4b, 0x05, 0x06]));
  if (startOfEocdsInBytes === -1) {
    throw new Error('Invalid SZI file, no End Of Central Directory Record found');
  }
  return startOfEocdsInBytes;
}

function readEocd(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

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

function readZip64EocdLocator(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

  const magicNumber = reader.readUint32();
  const diskNumber = reader.readUint32();
  const zip64EocdOffset = reader.readUint64();
  const totalNumberOfDisks = reader.readUint32();

  return { zip64EocdOffset };
}

function readZip64EocdRecord(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

  const magicNumber = reader.readUint32();
  const sizeOfEocdRecord = reader.readUint64() + 12; // as read, doesn't include this and previous field
  const versionMadeBy = reader.readUint16();
  const versionNeededToExtract = reader.readUint16();
  const diskNumber = reader.readUint32();
  const startOfEocdDiskNumber = reader.readUint32();
  const entriesOnDisk = reader.readUint64();
  const totalEntries = reader.readUint64();
  const centralDirectorySize = reader.readUint64();
  const centralDirectoryOffset = reader.readUint64();

  // There is an additional "zip64 extensible data sector" here, but it is
  // "currently reserved for use by PKWARE", so we are just skipping it for now
  const sizeOfExtensibleDataSector = sizeOfEocdRecord - reader.pos - startPositionInBuffer;
  reader.skip(sizeOfExtensibleDataSector);

  return { totalEntries, centralDirectorySize, centralDirectoryOffset };
}

function readZip64ExtraFields(reader, length, fields) {
  let { compressedSize, uncompressedSize, diskNumberStart, relativeOffsetOfLocalHeader } = fields;
  const initialPos = reader.pos;

  while (reader.pos - initialPos < length) {
    const headerId = reader.readUint16();
    const dataBlockSize = reader.readUint16();
    if (headerId === zip64ExtraFieldHeaderId) {
      if (uncompressedSize === maxUint32) {
        uncompressedSize = reader.readUint64();
      }

      if (compressedSize === maxUint32) {
        compressedSize = reader.readUint64();
      }

      if (relativeOffsetOfLocalHeader === maxUint32) {
        relativeOffsetOfLocalHeader = reader.readUint64();
      }

      if (diskNumberStart === maxUint16) {
        diskNumberStart = reader.readUint32();
      }

      // If this block is empty, its header and size won't be included either!
    } else {
      reader.skip(dataBlockSize);
    }
  }

  return {
    compressedSize,
    uncompressedSize,
    diskNumberStart,
    relativeOffsetOfLocalHeader,
  };
}

function readCentralDirectory(arrayBuffer, totalEntries) {
  const reader = new LittleEndianDataReader(arrayBuffer);
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

    const extraFields = readZip64ExtraFields(reader, extraFieldLength, {
      compressedSize,
      uncompressedSize,
      diskNumberStart,
      relativeOffsetOfLocalHeader,
    });
    const fileComment = reader.readString(fileCommentLength);

    centralDirectory.push({
      compressedSize: extraFields.compressedSize,
      uncompressedSize: extraFields.uncompressedSize,
      relativeOffsetOfLocalHeader: extraFields.relativeOffsetOfLocalHeader,
      filename,
    });
  }
  return centralDirectory;
}

/**
 * Generate a map from the start of a file's entry in the .szi to an upper bound on its end, the latter being
 * either the start of the next file in the .szi, or the beginning of the central directory structures.
 *
 * @param centralDirectory
 * @param centralDirectoryOffset
 * @returns Map<number, number>
 */
function mapEntryStartToMaxEntryEnd(centralDirectory, centralDirectoryOffset) {
  const entryToStartToMaxEntryEnd = new Map();

  // Get the entry offsets in descending order
  const entryStarts = centralDirectory.map((entry) => entry.relativeOffsetOfLocalHeader);
  entryStarts.sort((a, b) => b - a);

  if (centralDirectory.length > 0) {
    //...so we can do the special case of the highest offset first
    let maxEntryEnd = centralDirectoryOffset;
    for (const entryStart of entryStarts) {
      entryToStartToMaxEntryEnd.set(entryStart, maxEntryEnd);
      maxEntryEnd = entryStart;
    }
  }

  return entryToStartToMaxEntryEnd;
}

/**
 * Create a map of filenames to the start of their entries in the .szi, an upper bound on the end of their
 * entries, and the expected length of the file body. The start here is the start of the header, with
 * the upper bound being the start of the next entry in the .szi or the beginning of the central directory
 * structure.
 *
 * We need to do this because it's not possible to reliably predict the size of an entry's local header,
 * which means we have to fetch enough data to make sure we have both the header and the body when reading
 * the file, and the only way to do this is to read up until the next point in the file where we know for
 * sure that something different is happening.
 *
 * @param centralDirectory
 * @param centralDirectoryOffset
 * @returns Map<string, { entryStart, maxEntryEnd, bodyLength}>
 */
function createTableOfContents(centralDirectory, centralDirectoryOffset) {
  const entryStartToMaxEntryEnd = mapEntryStartToMaxEntryEnd(centralDirectory, centralDirectoryOffset);

  return centralDirectory.reduce((filenameToLocation, entry) => {
    const entryStart = entry.relativeOffsetOfLocalHeader;
    const maxEntryEnd = entryStartToMaxEntryEnd.get(entryStart);
    const bodyLength = entry.uncompressedSize;

    filenameToLocation.set(entry.filename, { entryStart, maxEntryEnd, bodyLength });
    return filenameToLocation;
  }, new Map());
}

export async function getContentsOfRemoteSziFile(remoteFile) {
  const minEocdsOffset = remoteFile.size - (zip64EocdLocatorSize + eocdSizeWithoutComment + maxCommentSize);
  const eocdArrayBuffer = await remoteFile.fetchRange(Math.max(0, minEocdsOffset), remoteFile.size);
  const startOfEocdInBuffer = findStartOfEocd(eocdArrayBuffer);
  let { totalEntries, centralDirectoryOffset, centralDirectorySize } = readEocd(eocdArrayBuffer, startOfEocdInBuffer);

  const zip64 =
    totalEntries === maxUint16 || centralDirectoryOffset === maxUint32 || centralDirectorySize === maxUint32;
  if (zip64) {
    const startOfZip64EocdLocatorInBuffer = startOfEocdInBuffer - zip64EocdLocatorSize;
    const zip64EocdLocator = readZip64EocdLocator(eocdArrayBuffer, startOfZip64EocdLocatorInBuffer);

    const zip64EocdBuffer = await remoteFile.fetchRange(
      zip64EocdLocator.zip64EocdOffset,
      minEocdsOffset + startOfZip64EocdLocatorInBuffer,
    );
    ({ totalEntries, centralDirectoryOffset, centralDirectorySize } = readZip64EocdRecord(zip64EocdBuffer, 0));
  }

  const cdArrayBuffer = await remoteFile.fetchRange(
    centralDirectoryOffset,
    centralDirectoryOffset + centralDirectorySize,
  );
  const centralDirectory = readCentralDirectory(cdArrayBuffer, totalEntries);

  return createTableOfContents(centralDirectory, centralDirectoryOffset);
}

class RemoteSziFileReader {
  static create = async (remoteSziFile) => {
    const contents = await getContentsOfRemoteSziFile(remoteSziFile);
    return new RemoteSziFileReader(remoteSziFile, contents);
  };

  constructor(remoteSziFile, contents) {
    this.remoteSziFile = remoteSziFile;
    this.contents = contents;
  }

  fetchFileBody = async (filename, abortSignal) => {
    const location = this.contents.get(filename);
    const arrayBuffer = await this.remoteSziFile.fetchRange(location.entryStart, location.maxEntryEnd, abortSignal);

    const reader = new LittleEndianDataReader(arrayBuffer, 0);

    // We need to make sure we read past the entire local header correctly before trying to read the body.
    // We can't just use the central directory header data to determine the length of the extra fields
    // because various extra fields inconsistently appear either one or the other.
    reader.skip(localHeaderBeforeVariableFieldsSize);
    const filenameLengthInHeader = reader.readUint16();
    const extraFieldsLength = reader.readUint16();
    const filenameInHeader = reader.readString(filenameLengthInHeader);
    if (filenameInHeader !== filename) {
      throw new Error(`Trying to read ${filename} but actually got ${filenameInHeader}`);
    }
    reader.skip(extraFieldsLength);

    // Note we don't just read up to the end, there may be other gubbins between the end of the body
    // and the end of the entry
    return reader.readUint8Array(location.bodyLength);
  };

  dziFilename = () => {
    let dziFilename = '';
    for (const filename of this.contents.keys()) {
      // i.e. "something/something.dzi"
      if (filename.match(/^([^\/]*)\/\1\.dzi$/)) {
        if (dziFilename) {
          throw new Error('Multiple .dzi files found in .szi!');
        } else {
          dziFilename = filename;
        }
      }
    }

    if (!dziFilename) {
      throw new Error('No dzi file found in .szi!');
    }

    return dziFilename;
  };
}

export const enableSziTileSource = (OpenSeadragon) => {
  class SziTileSource extends OpenSeadragon.DziTileSource {
    /**
     * Create an SZI tile source for use with OpenSeadragon.
     *
     * @param url location of the SZI file we want to read
     * @param fetchOptions options to use when making HTTP requests to fetch parts of the file
     * @param fetchOptions.mode cors mode to use. Note that "no-cors" is not accepted, as it breaks Range requests.
     *        (See: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#making_cross-origin_requests)
     * @param fetchOptions.credentials when and how to pass credentials
     *        (see:https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials)
     * @param fetchOptions.headers additional HTTP headers to send with each request
     * @returns {Promise<SziTileSource>}
     */
    static createSziTileSource = async (url, fetchOptions = {}) => {
      if (fetchOptions && fetchOptions.mode === 'no-cors') {
        throw new Error("'no-cors' mode is not supported, as Range headers don't work with it");
      }

      const remoteSziFile = await RemoteFile.create(url, fetchOptions);
      const remoteSziReader = await RemoteSziFileReader.create(remoteSziFile);

      const options = await this.readOptionsFromDziXml(remoteSziReader);

      return new SziTileSource(remoteSziReader, options);
    };

    static async readOptionsFromDziXml(remoteSziReader) {
      const dziFilename = remoteSziReader.dziFilename();
      const dziUint8Buffer = await remoteSziReader.fetchFileBody(dziFilename);
      const dziXmlText = new TextDecoder().decode(dziUint8Buffer);
      const dziXml = OpenSeadragon.parseXml(dziXmlText);
      return OpenSeadragon.DziTileSource.prototype.configure(dziXml, dziFilename, '');
    }

    constructor(remoteSziReader, options) {
      super(options);
      this.remoteSziReader = remoteSziReader;
    }

    /**
     * Download tile data. This is a cut down implementation of the XML-specific path of TileSource.Download
     * that instead of calling makeAjaxRequest, uses the remoteSziFileReader instead.
     *
     * Note that this ignores all the Ajax options as the remoteSziReader uses the fetchOptions supplied in
     * the createSziTileSourceInstead. Also note that only the documented parts of context are used below.
     *
     * @param {ImageJob} context job context that you have to call finish(...) on.
     * @param {String} [context.src] - URL of image to download.
     * @param {*} [context.userData] - Empty object to attach your own data and helper variables to.
     * @param {Function} [context.finish] - Should be called unless abort() was executed, e.g. on all occasions,
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
      context.userData.abortController = new AbortController();

      this.remoteSziReader.fetchFileBody(context.src, context.userData.abortController.signal).then(
        (arrayBuffer) => {
          const imageBlob = new Blob([arrayBuffer]);
          if (imageBlob.size === 0) {
            resetImageHandlers();
            context.finish(null, null, 'Empty image!');
          } else {
            // Turn the blob into an image,
            // When this completes it will trigger finish via the onLoad method of the image
            image.src = (window.URL || window.webkitURL).createObjectURL(imageBlob);
          }
        },
        (error) => {
          resetImageHandlers();
          context.finish(null, null, 'Download failed: ' + error.message);
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
      const abortController = context.userData.abortController;
      if (abortController) {
        abortController.abort();
      }
      const image = context.userData.image;
      if (image) {
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
