const ascii = (bytes, offset, value) => value.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
const u16be = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const u24le = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const u32le = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

/** Parse dimensions from encoded image headers without decoding/allocating a bitmap. */
export function parseImageDimensions(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG') && ascii(bytes, 12, 'IHDR')) {
    return { width: (bytes[16] * 0x1000000) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19], height: (bytes[20] * 0x1000000) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23] };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = u16be(bytes, offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) break;
        return { height: u16be(bytes, offset + 3), width: u16be(bytes, offset + 5) };
      }
      offset += length;
    }
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = u32le(bytes, offset + 4);
      const data = offset + 8;
      if (data + size > bytes.length) break;
      if (ascii(bytes, offset, 'VP8X') && size >= 10) return { width: u24le(bytes, data + 4) + 1, height: u24le(bytes, data + 7) + 1 };
      if (ascii(bytes, offset, 'VP8 ') && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) return { width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff, height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff };
      if (ascii(bytes, offset, 'VP8L') && size >= 5 && bytes[data] === 0x2f) return { width: 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8), height: 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10) };
      offset = data + size + (size & 1);
    }
  }
  throw new Error('Görsel boyutları dosya başlığından doğrulanamadı; geçerli PNG, JPEG veya WebP dosyası kullanın.');
}
