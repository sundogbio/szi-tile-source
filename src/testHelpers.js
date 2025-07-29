import { stat, open } from 'fs/promises';

export function uint8ArrayFromHex(hexString) {
  const bytes = [];
  let currentByteString = '';
  for (let i = 0; i < hexString.length; i++) {
    const currentChar = hexString.substring(i, i + 1);
    if (currentChar !== ' ') {
      currentByteString += currentChar;
    }

    if (currentByteString.length === 2) {
      bytes.push(parseInt(currentByteString, 16));
      currentByteString = '';
    }
  }

  if (currentByteString.length) {
    throw new Error('Odd number of hex chars in string!');
  }
  return Uint8Array.from(bytes);
}

export function bufferFromHex(hexString) {
  return uint8ArrayFromHex(hexString).buffer;
}

export class LocalFile {
  static create = async (path) => {
    const stats = await stat(path);
    return new LocalFile(path, stats.size);
  };

  constructor(path, size) {
    this.size = size;
    this.path = path;
  }

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

    const fileHandle = await open(this.path);
    try {
      const buffer = new Uint8Array(end - start);
      await fileHandle.read(buffer, { offset: 0, length: end - start, position: start });
      return buffer.buffer;
    } catch (e) {
      console.error(e);
    } finally {
      fileHandle.close();
    }
  };
}
