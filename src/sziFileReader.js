import { LittleEndianDataReader } from './littleEndianDataReader.js';

const maxUint32 = 0xffffffff;
const maxUint16 = 0xffff;

const maxCommentSize = maxUint16;
const eocdSizeWithoutComment = 22;
const zip64EocdLocatorSize = 20;

const zip64ExtraFieldHeaderId = 0x0001;

const eocdMagicNumber = 0x06054b50;
const zip64EocdLocatorMagicNumber = 0x07064b50;
const zip64EocdRecordMagicNumber = 0x06064b50;
const centralDirectoryHeaderMagicNumber = 0x02014b50;
const localFileHeaderMagicNumber = 0x04034b50;

// Size of the fixed-length portion of a Central Directory file header,
// not including the variable filename, extra field, and file comment.
const fixedCentralDirectoryHeaderSize = 46;

/**
 * Searches backwards in the supplied bytesToSearchIn for the bytesToFind
 *
 * @param {Uint8Array} bytesToSearchIn
 * @param {Uint8Array} bytesToFind
 * @return{number} -1 if bytesToFind is not found, otherwise the index of
 *         the start of the last occurrence of bytesToFind in bytesToSearchIn
 */
function findBackwards(bytesToSearchIn, startSearchFrom, bytesToFind) {
  if (bytesToFind.length > bytesToSearchIn.length) {
    return -1;
  }

  startSearchFrom = Math.min(startSearchFrom, bytesToSearchIn.length - bytesToFind.length);

  for (let i = startSearchFrom; i > -1; i--) {
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

/**
 * Create Uint8Array containing a little endian representation of the supplied uint32
 * @param {number} uint32
 * @returns {Uint8Array}
 */
function uint8ArrayFromUint32(uint32) {
  const uint8Array = new Uint8Array(4);
  new DataView(uint8Array.buffer).setUint32(0, eocdMagicNumber, true);
  return uint8Array;
}

/**
 * Look for the End Of Central Directory Record by searching backwards in the supplied buffer for
 * its magic number and then attempting to read in an EOCD forward of that point. If the EOCD is
 * well-formed, and exactly reaches the end of the buffer, we can be pretty sure that we have
 * a valid EOCD. If it isn't well-formed, and doesn't reach the end, then it's possible that the
 * magic number just happened to appear in the comment, and we restart the search from where we
 * left off (this is unlikely, given it contains two non-printable characters, but...).
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{
 *     totalEntries: (number),
 *     centralDirectorySize: (number),
 *     centralDirectoryOffset: (number),
 *     startOfEocdInBuffer: (number)
 *  }}
 */
function findAndReadEocd(arrayBuffer) {
  const bufferAsUint8Array = new Uint8Array(arrayBuffer);
  const eocdMagicNumberAsUint8Array = uint8ArrayFromUint32(eocdMagicNumber);

  let startSearchFrom = arrayBuffer.byteLength - eocdSizeWithoutComment; // no point in checking after this!
  while (startSearchFrom >= 0) {
    const startOfEocdInBuffer = findBackwards(bufferAsUint8Array, startSearchFrom, eocdMagicNumberAsUint8Array);
    if (startOfEocdInBuffer === -1) {
      throw new Error('Invalid SZI file, no valid End Of Central Directory Record found');
    }

    const reader = new LittleEndianDataReader(arrayBuffer);
    reader.skip(startOfEocdInBuffer);

    const magicNumber = reader.readUint32();
    if (magicNumber !== eocdMagicNumber) {
      // If this happens, it's a logic problem elsewhere, not an artifact of the file..,
      throw new Error(`Programming Error: End Of Central Directory Record has unexpected magic number`);
    }

    const diskNumber = reader.readUint16();
    const startOfCdDiskNumber = reader.readUint16();
    const entriesOnDisk = reader.readUint16();
    const totalEntries = reader.readUint16();
    const centralDirectorySize = reader.readUint32();
    const centralDirectoryOffset = reader.readUint32();
    const commentLength = reader.readUint16();

    // If the candidate EOCD ends at the end of the file, we are probably OK!
    if (reader.pos + commentLength === arrayBuffer.byteLength) {
      const comment = commentLength > 0 ? reader.readUtf8String(commentLength) : '';

      return { totalEntries, centralDirectorySize, centralDirectoryOffset, startOfEocdInBuffer };
    }

    // Restart the search, starting from the byte before
    startSearchFrom = startOfEocdInBuffer - 1;
  }

  if (startSearchFrom < 0) {
    throw new Error('Invalid SZI file, no End Of Central Directory Record found');
  }
}

/**
 * Read the Zip64 End Of Central Directory Record from the supplied array buffer
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} startPositionInBuffer
 * @returns {{zip64EocdOffset: (*|number)}}
 */
function readZip64EocdLocator(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

  const magicNumber = reader.readUint32();
  if (magicNumber !== zip64EocdLocatorMagicNumber) {
    throw new Error(`Invalid SZI file: Zip64 End Of Central Directory Locator has unexpected magic number`);
  }
  const diskNumber = reader.readUint32();
  const zip64EocdOffset = reader.readUint64();
  const totalNumberOfDisks = reader.readUint32();

  return { zip64EocdOffset };
}

/**
 * Read the Zip64 End Of Central Directory Record from the supplied array buffer
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} startPositionInBuffer
 * @returns {{totalEntries: (number), centralDirectorySize: (number), centralDirectoryOffset: (number)}}
 */
function readZip64EocdRecord(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

  const magicNumber = reader.readUint32();
  if (magicNumber !== zip64EocdRecordMagicNumber) {
    throw new Error(`Invalid SZI file: Zip64 End Of Central Directory Record has unexpected magic number`);
  }

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

/**
 * Read the extra fields from a Central Directory header.
 *
 * The valuesReadFromNormalFields param should contain the values read from the "normal" fields of the header that
 * might be overridden in the extra fields.
 *
 * @param {LittleEndianDataReader} reader
 * @param {number} length length of the extra fields
 * @param {compressedSize, uncompressedSize, diskNumberStart, relativeOffsetOfLocalHeader} valuesReadFromNormalFields
 * @returns {{compressedSize, uncompressedSize, diskNumberStart, relativeOffsetOfLocalHeader}}
 */
function readZip64ExtraFields(reader, length, valuesReadFromNormalFields) {
  let { compressedSize, uncompressedSize, diskNumberStart, relativeOffsetOfLocalHeader } = valuesReadFromNormalFields;
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

/**
 * Read a single Central Directory file header from the supplied reader, advancing
 * it past the entry.
 *
 * @param {LittleEndianDataReader} reader
 * @param {number} indexForErrors index used in error messages to identify which entry was malformed
 * @returns {{filename: (string), uncompressedSize: (number), relativeOffsetOfLocalHeader: (number)}}
 */
function readCentralDirectoryEntry(reader, indexForErrors) {
  const magicNumber = reader.readUint32();
  if (magicNumber !== centralDirectoryHeaderMagicNumber) {
    throw new Error(`Invalid SZI file: Central Directory Header ${indexForErrors} has unexpected magic number`);
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

  const filenameLength = reader.readUint16();
  const extraFieldLength = reader.readUint16();
  const fileCommentLength = reader.readUint16();
  const diskNumberStart = reader.readUint16();
  const internalFileAttributes = reader.readUint16();
  const externalFileAttributes = reader.readUint32();
  const relativeOffsetOfLocalHeader = reader.readUint32();

  // So, technically, the ZIP file format specifies that the name of files should be encoded
  // as CP-437 unless the 11th bit of bitFlag is set. But most encoders do use UTF-8 now,
  // with some of them not setting that flag, and CP-437, being a pre-Windows DOS encoding, isn't
  // part of the standard set of JS encodings available in the browser. Given that the only name
  // in the SZI that we are interested is the original image name, and its use in the
  // imagename/imagename.dzi and imagename_files/ patterns, it's safe enough to read in as UTF-8.
  //
  // This might result in some non-ASCII characters being mapped to odd bits of UTF-8, or to the
  // U+FFFD replacement characters, but this will be done consistently, and the all-important '/',
  // '_files', and '.dzi' will be conserved, so for the purposes of generating the contents table
  // and serving up tiles, it's fine if the name looks a little corrupted.
  const filename = reader.readUtf8String(filenameLength);

  if (compressedSize !== uncompressedSize) {
    throw new Error(
      `Invalid SZI file: compressedSize: ${compressedSize} ` +
        `and uncompressedSize: ${uncompressedSize} don't match for ${filename}!`,
    );
  }

  const extraFields = readZip64ExtraFields(reader, extraFieldLength, {
    compressedSize,
    uncompressedSize,
    diskNumberStart,
    relativeOffsetOfLocalHeader,
  });
  const fileComment = reader.readUtf8String(fileCommentLength);

  return {
    uncompressedSize: extraFields.uncompressedSize,
    relativeOffsetOfLocalHeader: extraFields.relativeOffsetOfLocalHeader,
    filename,
  };
}

/**
 * Read all the entries in the Central Directory of an SZI file from the supplied arrayBuffer
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} totalEntries
 * @returns {{filename: (string), uncompressedSize: (number), relativeOffsetOfLocalHeader: (number)}[]}
 */
function readCentralDirectory(arrayBuffer, totalEntries) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  const centralDirectory = [];
  for (let i = 0; i < totalEntries; i++) {
    centralDirectory.push(readCentralDirectoryEntry(reader, i));
  }
  return centralDirectory;
}

/**
 * Find and return the properties required to read the Central Directory of the supplied szi file:
 * its offset in the file, its total size, and the number of entries in it.
 *
 * @param {RemoteFile} sziFile a RemoteFile object, or one satisfying its interface, that points to the szi file whose
 *
 * @returns {Promise<{totalEntries: (number), centralDirectorySize: (number), centralDirectoryOffset: (number)}>}
 */
async function findCentralDirectoryProperties(sziFile) {
  // To start with, we need to find the End of Central Directory Record - this is at the end of
  // the file, but of variable length thanks to a trailing comment field. So we fetch a buffer of
  // its maximum possible length working back from the file end (plus enough to read the Zip64
  // End of Central Directory Locator if present) and try to locate our EOCD in it
  const minEocdsOffset = Math.max(0, sziFile.size - (zip64EocdLocatorSize + eocdSizeWithoutComment + maxCommentSize));
  const eocdArrayBuffer = await sziFile.fetchRange(minEocdsOffset, sziFile.size);
  const { totalEntries, centralDirectoryOffset, centralDirectorySize, startOfEocdInBuffer } =
    findAndReadEocd(eocdArrayBuffer);

  // For large files, one or all of the properties we are interested in might not fit in the 16 or
  // 32 bits available for them in the EOCD, so these are stored in an extended Zip64 EOCD Record...
  const zip64 =
    totalEntries === maxUint16 || centralDirectoryOffset === maxUint32 || centralDirectorySize === maxUint32;
  if (zip64) {
    //...but that Record might be so big that just scanning backwards to find its start is
    // impractical, so there is an additional Locator that comes after it, that gives the size
    // and location of the Record
    const startOfZip64EocdLocatorInBuffer = startOfEocdInBuffer - zip64EocdLocatorSize;
    const zip64EocdLocator = readZip64EocdLocator(eocdArrayBuffer, startOfZip64EocdLocatorInBuffer);

    const zip64EocdBuffer = await sziFile.fetchRange(
      zip64EocdLocator.zip64EocdOffset,
      minEocdsOffset + startOfZip64EocdLocatorInBuffer,
    );

    return readZip64EocdRecord(zip64EocdBuffer, 0);
  } else {
    return { totalEntries, centralDirectoryOffset, centralDirectorySize };
  }
}

/**
 * Create a map of filenames to the start of their data in the .szi, an upper bound on the end of their
 * data, and the expected length of the file body. The start here is the start of the header, with
 * the upper bound being the start of the next file's data in the .szi or the beginning of the central
 * directory structure.
 *
 * We need to do this because it's not possible to reliably predict the size of a file's local header,
 * which means we have to fetch enough data to make sure we have both the header and the body when reading
 * the file, and the only way to do this is to read up until the next point in the file where we know for
 * sure that something different is happening.
 *
 * @param {[{filename: (string), uncompressedSize: (number), relativeOffsetOfLocalHeader: (number)}]} centralDirectory
 * @param {number} centralDirectoryOffset
 * @returns {Map<string, {start : (number), maxEnd: (number), bodyLength: (number)}>}
 */
function createTableOfContents(centralDirectory, centralDirectoryOffset) {
  const tableOfContents = new Map();

  // We sort the central directory in reverse order...
  const cdInReverseOrder = centralDirectory.toSorted(
    (a, b) => b.relativeOffsetOfLocalHeader - a.relativeOffsetOfLocalHeader,
  );

  //...so we can handle the special end case first
  let maxEndOfFile = centralDirectoryOffset;
  for (const cdEntry of cdInReverseOrder) {
    const startOfFile = cdEntry.relativeOffsetOfLocalHeader;
    tableOfContents.set(cdEntry.filename, {
      start: startOfFile,
      maxEnd: maxEndOfFile,
      bodyLength: cdEntry.uncompressedSize,
    });
    maxEndOfFile = startOfFile;
  }

  return tableOfContents;
}

/**
 * Fetch the table of contents from the SZI represented by the RemoteFile
 *
 * @param {RemoteFile} sziFile
 * @returns {Promise<Map<string, {start: number, maxEnd: number, bodyLength: number}>>}
 */
export async function getContentsOfSziFile(sziFile) {
  const { totalEntries, centralDirectoryOffset, centralDirectorySize } = await findCentralDirectoryProperties(sziFile);

  const cdArrayBuffer = await sziFile.fetchRange(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize);
  const centralDirectory = readCentralDirectory(cdArrayBuffer, totalEntries);

  return createTableOfContents(centralDirectory, centralDirectoryOffset);
}

/**
 * Open a streaming reader over a range of bytes in the supplied file. Prefers the file's
 * fetchRangeStream if it exists (eg RemoteFile), otherwise falls back to fetchRange and
 * wraps the result in a single-chunk stream.
 *
 * @param {object} sziFile
 * @param {number} start
 * @param {number} end
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
async function openRangeStream(sziFile, start, end, abortSignal) {
  if (typeof sziFile.fetchRangeStream === 'function') {
    return sziFile.fetchRangeStream(start, end, abortSignal);
  }
  const arrayBuffer = await sziFile.fetchRange(start, end, abortSignal);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(arrayBuffer));
      controller.close();
    },
  });
}

/**
 * Stream the Central Directory of an SZI file, invoking onEntry for each entry as soon as
 * enough bytes are available to parse it. This is what lets the tile source start showing
 * low-magnification tiles before the entire CD has been downloaded.
 *
 * @param {object} sziFile
 * @param {number} centralDirectoryOffset
 * @param {number} centralDirectorySize
 * @param {number} totalEntries
 * @param {(entry: {filename: string, uncompressedSize: number, relativeOffsetOfLocalHeader: number}) => void} onEntry
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<void>}
 */
async function streamCentralDirectory(
  sziFile,
  centralDirectoryOffset,
  centralDirectorySize,
  totalEntries,
  onEntry,
  abortSignal,
) {
  const stream = await openRangeStream(
    sziFile,
    centralDirectoryOffset,
    centralDirectoryOffset + centralDirectorySize,
    abortSignal,
  );
  const streamReader = stream.getReader();

  // The CD size is known upfront, so we allocate exactly the right buffer once.
  const buffer = new Uint8Array(centralDirectorySize);
  let validLength = 0;
  let cursor = 0;
  let entriesParsed = 0;

  const tryParseOne = () => {
    if (validLength - cursor < fixedCentralDirectoryHeaderSize) {
      return false;
    }

    // Peek the three length fields without advancing a reader.
    const peek = new DataView(buffer.buffer, cursor, fixedCentralDirectoryHeaderSize);
    const filenameLength = peek.getUint16(28, true);
    const extraFieldLength = peek.getUint16(30, true);
    const fileCommentLength = peek.getUint16(32, true);
    const totalEntrySize = fixedCentralDirectoryHeaderSize + filenameLength + extraFieldLength + fileCommentLength;

    if (validLength - cursor < totalEntrySize) {
      return false;
    }

    const reader = new LittleEndianDataReader(buffer.buffer);
    reader.skip(cursor);
    const entry = readCentralDirectoryEntry(reader, entriesParsed);
    onEntry(entry);
    cursor += totalEntrySize;
    entriesParsed++;
    return true;
  };

  try {
    while (entriesParsed < totalEntries) {
      // Drain whatever entries we can with what we already have.
      while (tryParseOne()) {
        // intentionally empty
      }
      if (entriesParsed >= totalEntries) {
        break;
      }

      const { done, value } = await streamReader.read();
      if (done) {
        throw new Error(
          `Central Directory stream ended after ${entriesParsed} entries, expected ${totalEntries}`,
        );
      }
      if (validLength + value.length > buffer.length) {
        throw new Error(
          `Central Directory stream produced more bytes than expected (${centralDirectorySize})`,
        );
      }
      buffer.set(value, validLength);
      validLength += value.length;
    }
  } finally {
    // Make sure we release the underlying HTTP connection if anything throws above.
    try {
      streamReader.releaseLock();
    } catch (_) {
      // ignore
    }
  }
}

/**
 * SziFileReader wraps a remote (or local) SZI file, and allows its users to fetch the uncompressed body of
 * any of the files contained within the supplied SZI file.
 *
 * Note that you should always use the static create constructor to initialise this class, as this is the
 * only supported way of generating the table of contents.
 *
 * Internally the Central Directory is parsed progressively: create() resolves as soon as the .dzi entry
 * has been parsed (which lets OpenSeadragon start rendering low-magnification tiles immediately), while
 * the remaining entries continue to stream in in the background. fetchFileBody for any entry that has
 * not yet been parsed will await the streaming parser reaching that entry.
 */
export class SziFileReader {
  /**
   * Asynchronously create an instance of a reader for the supplied SZI remote file. Resolves once
   * enough of the Central Directory has been parsed to identify the .dzi entry, even if the rest
   * of the CD is still streaming in the background.
   *
   * @param {object} sziFile
   * @param {AbortSignal} [abortSignal] cancels the background CD stream if the caller no longer
   *        needs the reader
   * @returns {Promise<SziFileReader>}
   */
  static create = async (sziFile, abortSignal) => {
    const reader = new SziFileReader(sziFile);
    await reader._init(abortSignal);
    return reader;
  };

  constructor(sziFile) {
    this.sziFile = sziFile;
    // filename -> { start, bodyLength }. maxEnd is computed lazily from sortedStarts at fetch time.
    this.contents = new Map();
    // Sorted ascending array of all start offsets seen so far. Used to determine the upper bound
    // of an entry's data: the next file start above it, or centralDirectoryOffset if none.
    this.sortedStarts = [];
    // filename -> [{resolve, reject}] for fetches whose entry hasn't been parsed yet.
    this.waiters = new Map();
    this.dziFilenameValue = null;
    this.duplicateDziError = null;
    this.parsingDone = false;
    this.parsingError = null;
    this.parsingFinished = null;
    this.centralDirectoryOffset = null;
  }

  async _init(abortSignal) {
    const { totalEntries, centralDirectoryOffset, centralDirectorySize } = await findCentralDirectoryProperties(
      this.sziFile,
    );
    this.centralDirectoryOffset = centralDirectoryOffset;

    let resolveDziReady;
    let rejectDziReady;
    const dziReady = new Promise((resolve, reject) => {
      resolveDziReady = resolve;
      rejectDziReady = reject;
    });

    const onEntry = (entry) => {
      this._addEntry(entry);
      if (entry.filename.match(/\.dzi$/)) {
        if (!this.dziFilenameValue) {
          this.dziFilenameValue = entry.filename;
          resolveDziReady();
        } else if (entry.filename !== this.dziFilenameValue && !this.duplicateDziError) {
          // Surfaced through parsingFinished; the reader is already in use by this point so
          // we don't roll back the early resolution.
          this.duplicateDziError = new Error('Multiple .dzi files found in .szi!');
        }
      }
    };

    this.parsingFinished = streamCentralDirectory(
      this.sziFile,
      centralDirectoryOffset,
      centralDirectorySize,
      totalEntries,
      onEntry,
      abortSignal,
    )
      .then(() => {
        this.parsingDone = true;
        if (!this.dziFilenameValue) {
          const err = new Error('No dzi file found in .szi!');
          this.parsingError = err;
          rejectDziReady(err);
          this._rejectAllPendingWaiters(err);
          throw err;
        }
        this._rejectAllPendingWaiters();
        if (this.duplicateDziError) {
          throw this.duplicateDziError;
        }
      })
      .catch((err) => {
        if (!this.parsingError) {
          this.parsingError = err;
        }
        this.parsingDone = true;
        rejectDziReady(err);
        this._rejectAllPendingWaiters(err);
        throw err;
      });

    // Prevent unhandled rejection warnings; consumers can still observe parsingFinished.
    this.parsingFinished.catch(() => {});

    await dziReady;
  }

  _addEntry(entry) {
    if (this.contents.has(entry.filename)) {
      return;
    }
    const location = {
      start: entry.relativeOffsetOfLocalHeader,
      bodyLength: entry.uncompressedSize,
    };
    this.contents.set(entry.filename, location);
    this._insertSortedStart(entry.relativeOffsetOfLocalHeader);

    const waitersForName = this.waiters.get(entry.filename);
    if (waitersForName) {
      this.waiters.delete(entry.filename);
      for (const { resolve } of waitersForName) {
        resolve(location);
      }
    }
  }

  _insertSortedStart(start) {
    let lo = 0;
    let hi = this.sortedStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedStarts[mid] < start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.sortedStarts.splice(lo, 0, start);
  }

  _computeMaxEnd(start) {
    // First start strictly greater than `start`. If none, the entry runs up to the CD.
    let lo = 0;
    let hi = this.sortedStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedStarts[mid] <= start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo < this.sortedStarts.length) {
      return this.sortedStarts[lo];
    }
    return this.centralDirectoryOffset;
  }

  _computeFetchUpperBound(location) {
    // A local file header is 30 fixed bytes + variable filename + variable extra fields, with
    // each of those lengths a uint16, so each is at most 0xffff. We don't know the exact size
    // of the local header until we parse it, so cap the worst case here. Add the body length
    // on top, and we have a tight upper bound that does not depend on having seen any other
    // entry yet. This matters because during the very first fetches (typically the dzi xml)
    // the progressive CD parser may not yet have streamed in any entry above us, in which case
    // _computeMaxEnd would otherwise return centralDirectoryOffset and we would issue a fetch
    // that spans the entire archive payload.
    const localHeaderMaxOverhead = 30 + 0xffff + 0xffff;
    const tightBound = location.start + localHeaderMaxOverhead + location.bodyLength;
    const sortedBound = this._computeMaxEnd(location.start);
    return Math.min(tightBound, sortedBound);
  }

  _rejectAllPendingWaiters(err) {
    for (const [filename, waitersForName] of this.waiters) {
      for (const { reject } of waitersForName) {
        reject(err || new Error(`${filename} is not present inside this .szi file`));
      }
    }
    this.waiters.clear();
  }

  _waitForEntry(filename) {
    const existing = this.contents.get(filename);
    if (existing) {
      return Promise.resolve(existing);
    }
    if (this.parsingError) {
      return Promise.reject(this.parsingError);
    }
    if (this.parsingDone) {
      return Promise.reject(new Error(`${filename} is not present inside this .szi file`));
    }
    return new Promise((resolve, reject) => {
      let waitersForName = this.waiters.get(filename);
      if (!waitersForName) {
        waitersForName = [];
        this.waiters.set(filename, waitersForName);
      }
      waitersForName.push({ resolve, reject });
    });
  }

  /**
   * Read the body of the filename contained in the SZI file. If the entry's Central Directory
   * record has not yet been streamed in, this awaits the progressive parser reaching it.
   *
   * @param {string} filename filename whose body you want to read
   * @param {AbortSignal} abortSignal AbortController.signal for cancelling the request
   * @returns {Promise<Uint8Array>} The body of the file specified
   */
  fetchFileBody = async (filename, abortSignal) => {
    const location = await this._waitForEntry(filename);
    const maxEnd = this._computeFetchUpperBound(location);

    const arrayBuffer = await this.sziFile.fetchRange(location.start, maxEnd, abortSignal);
    const reader = new LittleEndianDataReader(arrayBuffer, 0);

    const magicNumber = reader.readUint32();
    if (magicNumber !== localFileHeaderMagicNumber) {
      throw new Error(`Invalid SZI file: Local Header for ${filename} has unexpected magic number`);
    }
    const version = reader.readUint16();
    const bitFlag = reader.readUint16();
    const compressionMethod = reader.readUint16();
    const lastModifiedTime = reader.readUint16();
    const lastModifiedDate = reader.readUint16();
    const crc32 = reader.readUint32();
    const compressedSize = reader.readUint32();
    const uncompressedSize = reader.readUint32();
    const filenameLengthInHeader = reader.readUint16();
    const extraFieldsLength = reader.readUint16();
    const filenameInHeader = reader.readUtf8String(filenameLengthInHeader);
    if (filenameInHeader !== filename) {
      throw new Error(`Trying to read ${filename} but actually got ${filenameInHeader}`);
    }
    reader.skip(extraFieldsLength);

    // Note we don't just read up to the end, there may be other gubbins between the end of the body
    // and the end of the entry
    return reader.readUint8Array(location.bodyLength);
  };

  /**
   * Find the filename of the .dzi config file inside the contents. After create() resolves this
   * is guaranteed to be set.
   *
   * @returns {string}
   */
  dziFilename = () => {
    if (!this.dziFilenameValue) {
      throw new Error('No dzi file found in .szi!');
    }
    return this.dziFilenameValue;
  };

  /**
   * Find the top level tiles directory. For a dzi file at "path/name.dzi" this should be of the form
   * "path/name_files/" and contain subdirectories containing tiles for each zoom level
   *
   * @returns {string}
   */
  tilesDirectory = () => {
    return this.dziFilename().replace(/\.dzi$/, '_files/');
  };
}
