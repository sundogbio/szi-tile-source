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
    } else if (newPos > this.buffer.byteLength) {
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
      throw new Error('Only values upto 2^53 - 1 are supported!');
    }

    return Number(bigInt);
  }

  readUtf8String(len) {
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
