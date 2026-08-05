import 'server-only';

import { QUIZ_MEDIA_MIME_TYPES } from '@/lib/game/media';

export interface ValidatedImageMetadata {
  readonly mimeType: (typeof QUIZ_MEDIA_MIME_TYPES)[number];
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly width: number;
  readonly height: number;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parsePng(bytes: Uint8Array): ValidatedImageMetadata | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (
    bytes.length < 24 ||
    !signature.every((value, index) => bytes[index] === value)
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);

  return width > 0 && height > 0
    ? { mimeType: 'image/png', extension: 'png', width, height }
    : null;
}

function parseJpeg(bytes: Uint8Array): ValidatedImageMetadata | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      return null;
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame && segmentLength >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];

      return width > 0 && height > 0
        ? { mimeType: 'image/jpeg', extension: 'jpg', width, height }
        : null;
    }

    offset += segmentLength;
  }

  return null;
}

function parseWebp(bytes: Uint8Array): ValidatedImageMetadata | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

  if (
    bytes.length < 30 ||
    ascii(0, 4) !== 'RIFF' ||
    ascii(8, 4) !== 'WEBP'
  ) {
    return null;
  }

  const chunk = ascii(12, 4);
  let width = 0;
  let height = 0;

  if (chunk === 'VP8X') {
    width = readUint24LittleEndian(bytes, 24) + 1;
    height = readUint24LittleEndian(bytes, 27) + 1;
  } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    height =
      1 +
      ((bytes[22] & 0xc0) >> 6) +
      (bytes[23] << 2) +
      ((bytes[24] & 0x0f) << 10);
  } else if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
  }

  return width > 0 && height > 0
    ? { mimeType: 'image/webp', extension: 'webp', width, height }
    : null;
}

export function readImageMetadata(
  bytes: Uint8Array,
): ValidatedImageMetadata | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}
