import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^[']|[']$/g, '');
    }
  }
} catch {
  // CI and shells may provide environment variables directly.
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createPng(width, height, background, accent, variant) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const stripe = ((Math.floor(x / 80) + Math.floor(y / 80) + variant) % 4) === 0;
      const color = stripe ? accent : background;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    rows[target] = 0;
    pixels.copy(rows, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const quizId = '10000000-0000-4000-8000-000000000001';
const questionId = '40000000-0000-4000-8000-000000000001';
const answerIds = [
  '50000000-0000-4000-8000-000000000201',
  '50000000-0000-4000-8000-000000000202',
  '50000000-0000-4000-8000-000000000203',
  '50000000-0000-4000-8000-000000000204',
  '50000000-0000-4000-8000-000000000301',
  '50000000-0000-4000-8000-000000000302',
  '50000000-0000-4000-8000-000000000303',
  '50000000-0000-4000-8000-000000000304',
];
const palettes = [
  [[49, 46, 129], [129, 140, 248]],
  [[6, 78, 59], [52, 211, 153]],
  [[120, 53, 15], [251, 191, 36]],
  [[131, 24, 67], [244, 114, 182]],
];
const assets = [{
  path: `quizzes/${quizId}/questions/${questionId}/demo-calendar.png`,
  bytes: createPng(1200, 800, [15, 23, 42], [99, 102, 241], 0),
}];
answerIds.forEach((id, index) => {
  const palette = palettes[index % palettes.length];
  assets.push({
    path: `quizzes/${quizId}/answers/${id}/demo-${(index % 4) + 1}.png`,
    bytes: createPng(800, 600, palette[0], palette[1], index),
  });
});

for (const asset of assets) {
  const { error } = await supabase.storage.from('quiz-media').upload(asset.path, asset.bytes, {
    contentType: 'image/png', cacheControl: '3600', upsert: true,
  });
  if (error) throw new Error(`Upload failed for ${asset.path}: ${error.message}`);
  console.log(`Uploaded ${asset.path}`);
}
