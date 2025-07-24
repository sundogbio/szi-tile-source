// Some standard zip sizes in bytes
import { LittleEndianDataReader } from './littleEndianDataReader.js';

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
  const comment = commentLength > 0 ? reader.readUtf8String(commentLength) : '';

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

async function findCentralDirectoryProperties(sziFile) {
  const minEocdsOffset = sziFile.size - (zip64EocdLocatorSize + eocdSizeWithoutComment + maxCommentSize);
  const eocdArrayBuffer = await sziFile.fetchRange(Math.max(0, minEocdsOffset), sziFile.size);
  const startOfEocdInBuffer = findStartOfEocd(eocdArrayBuffer);
  const { totalEntries, centralDirectoryOffset, centralDirectorySize } = readEocd(eocdArrayBuffer, startOfEocdInBuffer);

  const zip64 =
    totalEntries === maxUint16 || centralDirectoryOffset === maxUint32 || centralDirectorySize === maxUint32;
  if (zip64) {
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

    const arrayBuffer = await this.sziFile.fetchRange(location.entryStart, location.maxEntryEnd, abortSignal);

    const reader = new LittleEndianDataReader(arrayBuffer, 0);

    // We need to make sure we read past the entire local header correctly before trying to read the body.
    // We can't just use the central directory header data to determine the length of the extra fields
    // because various extra fields inconsistently appear either one or the other.
    reader.skip(localHeaderBeforeVariableFieldsSize);
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
