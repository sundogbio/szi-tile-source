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

function uint8ArrayFromUint32(uint32) {
  const uint8Array = new Uint8Array(4);
  new DataView(uint8Array.buffer).setUint32(0, eocdMagicNumber, true);
  return uint8Array;
}

function findStartOfEocd(arrayBuffer) {
  const startOfEocdsInBytes = findBackwards(new Uint8Array(arrayBuffer), uint8ArrayFromUint32(eocdMagicNumber));
  if (startOfEocdsInBytes === -1) {
    throw new Error('Invalid SZI file, no End Of Central Directory Record found');
  }
  return startOfEocdsInBytes;
}

function readEocd(arrayBuffer, startPositionInBuffer) {
  const reader = new LittleEndianDataReader(arrayBuffer);
  reader.skip(startPositionInBuffer);

  const magicNumber = reader.readUint32();
  if (magicNumber !== eocdMagicNumber) {
    throw new Error(`Invalid SZI file: End Of Central Directory Record has unexpected magic number`);
  }

  const diskNumber = reader.readUint16();
  const startOfCdDiskNumber = reader.readUint16();
  const entriesOnDisk = reader.readUint16();
  const totalEntries = reader.readUint16();
  const centralDirectorySize = reader.readUint32();
  const centralDirectoryOffset = reader.readUint32();
  const commentLength = reader.readUint16();
  const comment = commentLength > 0 ? reader.readUtf8String(commentLength) : '';

  return { totalEntries, centralDirectorySize, centralDirectoryOffset };
}

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
    if (magicNumber !== centralDirectoryHeaderMagicNumber) {
      throw new Error(`Invalid SZI file: Central Directory Header ${i} has unexpected magic number`);
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
 * Find and return the properties required to read the Central Directory of the supplied szi file:
 * its offset in the file, its total size, and the number of entries in it.
 *
 * @param sziFile a RemoteFile object, or one satisfying its interface, that points to the szi file whose
 *
 * @returns {Promise<{totalEntries: (number), centralDirectorySize: (number), centralDirectoryOffset: (number)}>}
 */
async function findCentralDirectoryProperties(sziFile) {
  // To start with, we need to find the End of Central Directory Record - this is at the end of
  // the file, but of variable length thanks to a trailing comment field. So we fetch a buffer of
  // its maximum length working back from the file end (plus enough to read the Zip64 End of
  // Central Directory Locator if present)
  const minEocdsOffset = Math.max(0, sziFile.size - (zip64EocdLocatorSize + eocdSizeWithoutComment + maxCommentSize));
  const eocdArrayBuffer = await sziFile.fetchRange(minEocdsOffset, sziFile.size);

  // To find the start of the End of Central Directory Record we search backwards until we find
  // its magic number, and then read forwards from that point
  const startOfEocdInBuffer = findStartOfEocd(eocdArrayBuffer);
  const { totalEntries, centralDirectoryOffset, centralDirectorySize } = readEocd(eocdArrayBuffer, startOfEocdInBuffer);

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
 * @param centralDirectory
 * @param centralDirectoryOffset
 * @returns Map<string, { start, maxEnd, bodyLength}>
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

export async function getContentsOfSziFile(sziFile) {
  const { totalEntries, centralDirectoryOffset, centralDirectorySize } = await findCentralDirectoryProperties(sziFile);

  const cdArrayBuffer = await sziFile.fetchRange(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize);
  const centralDirectory = readCentralDirectory(cdArrayBuffer, totalEntries);

  return createTableOfContents(centralDirectory, centralDirectoryOffset);
}

export class SziFileReader {
  static create = async (sziFile) => {
    const contents = await getContentsOfSziFile(sziFile);
    return new SziFileReader(sziFile, contents);
  };

  constructor(sziFile, contents) {
    this.sziFile = sziFile;
    this.contents = contents;
  }

  fetchFileBody = async (filename, abortSignal) => {
    const location = this.contents.get(filename);
    if (!location) {
      throw new Error(`${filename} is not present inside this .szi file`);
    }

    const arrayBuffer = await this.sziFile.fetchRange(location.start, location.maxEnd, abortSignal);
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

  tilesDirectory = () => {
    const dziFilename = this.dziFilename();
    const path = dziFilename.split('/')[0];
    return `${path}/${path}_files/`;
  };
}
