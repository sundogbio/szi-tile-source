import { describe, expect, test } from 'vitest';
import { LittleEndianDataReader } from './littleEndianDataReader.js';
import { bufferFromHex } from './testHelpers.js';

describe('Test valid UTF8 strings', async () => {
  test.each([
    ['62 61 64 67 65 72', 'badger'],
    ['63 61 66 C3 A9', 'café'],
    ['4D 6f 74 C3 B6 72 68 65 61 64 20 F0 9F A4 98', 'Motörhead 🤘'],
    ['6C C3 B8 6C F0 9F 98 82', 'løl😂'],
  ])('%s -> %s', (hexString, string) => {
    const buffer = bufferFromHex(hexString);
    const reader = new LittleEndianDataReader(buffer);
    expect(reader.readUtf8String(buffer.byteLength)).toEqual(string);
  });
});

describe('Test invalid UTF8 strings', async () => {
  test.each([
    ['63 61 66 E9 2F 63 61 66 E9 2E 64 7A 69', 'caf�/caf�.dzi'],
    ['4D 6F 74 94 72 68 E0 61 FF 2F 4D 6f 74 94 72 68 65 61 64 5F 66 69 6C 65 73', 'Mot�rh�a�/Mot�rhead_files'],
  ])('%s -> %s', (hexString, string) => {
    const buffer = bufferFromHex(hexString);
    const reader = new LittleEndianDataReader(buffer);
    expect(reader.readUtf8String(buffer.byteLength)).toEqual(string);
  });
});

test('Test bounds check', async () => {
  expect(() => new LittleEndianDataReader(bufferFromHex('FF')).readUint16()).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 02')).readUint32()).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 02 03 04 05 06')).readUint64()).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 02 03 04 05 06')).readUint8Array(8)).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 01 01 01 01 01')).readUtf8String(8)).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 01 01 01 01 01')).skip(8)).toThrowError();
  expect(() => new LittleEndianDataReader(bufferFromHex('FF 01 01 01 01 01 01')).skip(-1)).toThrowError();
});

test('Test mixed buffer', async () => {
  const dataReader = new LittleEndianDataReader(bufferFromHex('01 02 03 04 05 06 06 00 68 65 6C 6C 6F 21'));
  expect(dataReader.readUint16()).toEqual(0x0201);
  expect(dataReader.readUint32()).toEqual(0x06050403);
  expect(dataReader.readUint16()).toEqual(6);
  expect(dataReader.readUtf8String(6)).toEqual('hello!');
  dataReader.skip(-8);
  expect(dataReader.readUint16()).toEqual(6);
  dataReader.skip(4);
  expect(dataReader.readUint8Array(2)).toEqual(Uint8Array.from([0x6f, 0x21]));
});

describe('Test Uint64', async () => {
  test.each([
    [1n, true],
    [0x001f_ffff_ffff_ffffn, true],
    [0x0020_0000_0000_0000n, false],
    [0xffff_ffff_ffff_ffffn, false],
  ])('%s', (value, succeeds) => {
    const reader = new LittleEndianDataReader(new BigUint64Array([value]).buffer);

    if (succeeds) {
      expect(reader.readUint64()).toEqual(Number(value));
    } else {
      expect(() => reader.readUint64()).toThrowError();
    }
  });
});
