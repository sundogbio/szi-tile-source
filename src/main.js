export async function fetchRange(url, start, end) {
  try {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error(`Error fetching range ${start}-${end}:`, error);
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
