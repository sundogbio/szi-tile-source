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
