import { SziFileReader } from './sziFileReader.js';
import { describe, expect, test } from 'vitest';
import { LocalFile, uint8ArrayFromHex } from './testHelpers.js';
import { LittleEndianDataReader } from './littleEndianDataReader.js';
import { XMLValidator } from 'fast-xml-parser';

function checkUint8ArrayIsJpeg(array) {
  expect(array.length).toBeGreaterThanOrEqual(4);
  expect(array.slice(0, 2)).toEqual(uint8ArrayFromHex('FF D8'));
  expect(array.slice(-2)).toEqual(uint8ArrayFromHex('FF D9'));
}

function checkUint8ArrayIsPng(array) {
  expect(array.length).toBeGreaterThanOrEqual(20);
  expect(array.slice(0, 8)).toEqual(uint8ArrayFromHex('89 50 4E 47 0D 0A 1A 0A'));
  expect(array.slice(-12)).toEqual(uint8ArrayFromHex('00 00 00 00 49 45 4E 44 AE 42 60 82'));
}

function checkUint8ArrayIsWebp(array) {
  expect(array.length).toBeGreaterThanOrEqual(12);

  const reader = new LittleEndianDataReader(array.slice(0, 12).buffer);

  expect(reader.readUtf8String(4)).toEqual('RIFF');
  const expectedLength = 8 + reader.readUint32();
  expect(array.length).toEqual(expectedLength);
  expect(reader.readUtf8String(4)).toEqual('WEBP');
}

describe('Check well formed example files are readable', async () => {
  test.each([
    ['mixmas-jpeg.szi', 'jpeg'],
    ['mixmas-jpeg-manually-zipped.szi', 'jpeg'],
    ['mixmas-jpeg-with-comment.szi', 'jpeg'],
    ['mixmas-jpeg-with-bad-comment.szi', 'jpeg'],
    ['mixmas-jpeg-force-zip64.szi', 'jpeg'],
    ['mixmas-png.szi', 'png'],
    ['mixmas-webp.szi', 'webp'],
    ['emoji-eyes-internal-filename-png.szi', 'png'],
  ])('%s is readable', async (filename, type) => {
    const localFile = await LocalFile.create('./public/examples/zipped/' + filename);
    const sziFileReader = await SziFileReader.create(localFile);

    const dziFileAsUint8Array = await sziFileReader.fetchFileBody(sziFileReader.dziFilename());
    const dziFileAsString = new TextDecoder().decode(dziFileAsUint8Array);
    expect(XMLValidator.validate(dziFileAsString)).toBeTruthy();

    const fileAsUint8Array = await sziFileReader.fetchFileBody(sziFileReader.tilesDirectory() + '0/0_0.' + type);
    switch (type) {
      case 'jpeg':
        checkUint8ArrayIsJpeg(fileAsUint8Array);
        break;
      case 'png':
        checkUint8ArrayIsPng(fileAsUint8Array);
        break;
      case 'webp':
        checkUint8ArrayIsWebp(fileAsUint8Array);
        break;
    }
  });
});

test('Compressed SZI errors out', async () => {
  const compressedFile = await LocalFile.create('./public/examples/problematic/eye-png-compressed.szi');
  await expect(SziFileReader.create(compressedFile)).rejects.toThrowError(
    /Invalid SZI file: compressedSize: \d* and uncompressedSize: \d* don't match for .*!/,
  );
});
