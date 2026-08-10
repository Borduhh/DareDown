#!/usr/bin/env node
/**
 * Builds the app icons from build/icon-source.png.
 *
 * Two problems with handing electron-builder a single 1024px file:
 *
 *  1. The artwork sits on an opaque near-white field, which macOS and Windows
 *     composite as a pale square tile — they do not crop to the shape.
 *  2. Scaled to 16 or 32px the folder plus wordmark collapses into an
 *     unreadable smudge. Those are the sizes Finder lists and the menu bar use.
 *
 * So: key the background to transparency, then give the small renditions
 * different art. Icon sets are allowed to vary by size, and simplifying at the
 * bottom end is what platform icons do — 16pt and 32pt get the monogram alone,
 * 128pt and up get the full folder.
 *
 * The monogram is located rather than hard-coded: it is the largest connected
 * run of red in the artwork, so re-exporting the source at a different
 * composition does not silently crop the wrong region.
 *
 * Resampling is delegated to `sips`, which ships with macOS and is a better
 * downsampler than anything worth hand-rolling here. `iconutil` builds the
 * .icns. Both are macOS-only, which is why build/icon.icns is committed as a
 * source asset — CI consumes it and never needs to run this.
 *
 *   node scripts/make-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const sourcePath = path.join(buildDir, 'icon-source.png');
const workDir = path.join(buildDir, '.icon-work');

/* Which art each point size uses. Keys are the .iconset basenames. */
const ICNS_RENDITIONS = [
  ['icon_16x16', 16, 'mark'],
  ['icon_16x16@2x', 32, 'mark'],
  ['icon_32x32', 32, 'mark'],
  ['icon_32x32@2x', 64, 'mark'],
  ['icon_128x128', 128, 'full'],
  ['icon_128x128@2x', 256, 'full'],
  ['icon_256x256', 256, 'full'],
  ['icon_256x256@2x', 512, 'full'],
  ['icon_512x512', 512, 'full'],
  ['icon_512x512@2x', 1024, 'full'],
];

/* Windows .ico. The 16 and 32 entries are what the taskbar and Explorer lists show. */
const ICO_SIZES = [
  [16, 'mark'],
  [24, 'mark'],
  [32, 'mark'],
  [48, 'full'],
  [64, 'full'],
  [128, 'full'],
  [256, 'full'],
];

/* ------------------------------------------------------------------ *
 * Minimal PNG codec — 8-bit RGB/RGBA, non-interlaced
 * ------------------------------------------------------------------ */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`);
  if (buffer[28] !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = colorType === 6 ? 4 : 3;
  const parts = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));

  const stride = width * channels;
  const data = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      data[d] = line[s];
      data[d + 1] = line[s + 1];
      data[d + 2] = line[s + 2];
      data[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    previous = line;
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Background removal
 * ------------------------------------------------------------------ */

/**
 * Flood-fill inward from the border and ramp alpha across whatever it reaches.
 *
 * A flood fill rather than a colour key because the field is not flat — it is
 * dozens of shades of faintly blue near-white, so an exact key leaves speckle.
 * Confined to the border-connected region so the artwork's own light pixels are
 * never touched, and ramped by luminance so the drop shadow survives as real
 * partial alpha instead of a hard cut.
 */
function keyBackground(image) {
  const { width, height, data } = image;
  const luminance = (i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

  const edge = [];
  for (let x = 0; x < width; x += 1) {
    edge.push(luminance(x * 4), luminance(((height - 1) * width + x) * 4));
  }
  for (let y = 0; y < height; y += 1) {
    edge.push(luminance(y * width * 4), luminance((y * width + width - 1) * 4));
  }
  edge.sort((a, b) => a - b);
  const fieldLuminance = edge[Math.floor(edge.length / 2)];

  const FLOOD_MIN = 170; // travels through field and shadow, stops at the dark art
  const OPAQUE_AT = 60; // luminance treated as fully part of the artwork
  const CLEAR_BAND = 4;

  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p] || luminance(p * 4) < FLOOD_MIN) return;
    outside[p] = 1;
    queue[tail += 1] = p;
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (head < tail) {
    const p = queue[(head += 1)];
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  for (let p = 0; p < width * height; p += 1) {
    if (!outside[p]) continue;
    const i = p * 4;
    const l = luminance(i);
    if (l >= fieldLuminance - CLEAR_BAND) {
      data[i + 3] = 0;
      continue;
    }
    const alpha = Math.min(1, Math.max(0, (fieldLuminance - l) / (fieldLuminance - OPAQUE_AT)));
    if (alpha < 0.02) {
      data[i + 3] = 0;
      continue;
    }
    // Un-composite from the field so edges keep no pale halo.
    for (let c = 0; c < 3; c += 1) {
      const straight = (data[i + c] - fieldLuminance * (1 - alpha)) / alpha;
      data[i + c] = Math.min(255, Math.max(0, Math.round(straight)));
    }
    data[i + 3] = Math.round(alpha * 255);
  }
  return image;
}

/* ------------------------------------------------------------------ *
 * Locating the monogram
 * ------------------------------------------------------------------ */

/**
 * Bounding box of the largest connected red region.
 *
 * The wordmark is red too, but it breaks into one small component per letter,
 * whereas the monogram is a single large mass — so "largest component" picks it
 * out without needing coordinates baked in.
 */
function findMark(image) {
  const { width, height, data } = image;
  const isRed = (i) => {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    return a > 128 && r > 80 && r > g * 1.35 && r > b * 1.35;
  };

  const label = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  const components = [];
  let best = null;

  for (let start = 0; start < width * height; start += 1) {
    if (label[start] !== -1 || !isRed(start * 4)) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    label[start] = start;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (top > 0) {
      top -= 1;
      const p = stack[top];
      const x = p % width;
      const y = (p - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (label[q] !== -1 || !isRed(q * 4)) continue;
        label[q] = start;
        stack[top] = q;
        top += 1;
      }
    }
    components.push({ area, minX, minY, maxX, maxY });
    if (!best || area > best.area) best = components[components.length - 1];
  }
  if (!best) throw new Error('could not find the monogram: no red region detected');

  // The wordmark is the red that sits below the monogram — many small
  // components, one per letter. Its top edge is measured, not assumed, so the
  // mask below can cut between the two without clipping either.
  const below = components.filter((c) => c.minY > best.maxY);
  const wordmarkTop = below.length ? Math.min(...below.map((c) => c.minY)) : null;

  return { mark: best, wordmarkTop };
}

/**
 * Crop to a padded square around `box`, centred. Returns the source offset too,
 * so callers can translate source coordinates into the crop.
 */
function squareCrop(image, box, padRatio = 0.1) {
  const { width, height, data } = image;
  const boxW = box.maxX - box.minX + 1;
  const boxH = box.maxY - box.minY + 1;
  const side = Math.round(Math.max(boxW, boxH) * (1 + padRatio * 2));
  const cx = Math.round((box.minX + box.maxX) / 2);
  const cy = Math.round((box.minY + box.maxY) / 2);
  const offsetX = cx - Math.floor(side / 2);
  const offsetY = cy - Math.floor(side / 2);
  const out = Buffer.alloc(side * side * 4);

  for (let y = 0; y < side; y += 1) {
    const sy = offsetY + y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < side; x += 1) {
      const sx = offsetX + x;
      if (sx < 0 || sx >= width) continue;
      data.copy(out, (y * side + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  }
  return { width: side, height: side, data: out, offsetX, offsetY };
}

/**
 * Paint out everything from row `cutY` down by extending the row just above it.
 *
 * Used to remove the wordmark from the small-size crop. Copying a real row
 * rather than filling a flat colour keeps the folder's gradient and the glow
 * behind the monogram continuous, so there is no seam where the mask begins.
 */
function maskBelow(image, cutY) {
  const { width, height, data } = image;
  const sourceRow = Math.max(0, Math.min(height - 1, cutY - 2));
  for (let y = Math.max(0, cutY); y < height; y += 1) {
    data.copy(data, y * width * 4, sourceRow * width * 4, (sourceRow + 1) * width * 4);
  }
  return image;
}

/**
 * Round the corners of a square image.
 *
 * The monogram sits on the folder, so cropping to it brings the navy fill along
 * as a hard-edged square. Rounding turns that into a deliberate tile instead of
 * a rectangle that looks clipped. Corner coverage is supersampled so the edge
 * is antialiased rather than stepped.
 */
function roundCorners(image, radiusRatio = 0.2) {
  const { width, height, data } = image;
  const radius = Math.round(Math.min(width, height) * radiusRatio);
  const SUB = 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Only the four corner boxes can be outside the rounded rect.
      const nearLeft = x < radius;
      const nearRight = x >= width - radius;
      const nearTop = y < radius;
      const nearBottom = y >= height - radius;
      if (!((nearLeft || nearRight) && (nearTop || nearBottom))) continue;

      const cx = nearLeft ? radius : width - radius;
      const cy = nearTop ? radius : height - radius;
      let inside = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const px = x + (sx + 0.5) / SUB;
          const py = y + (sy + 0.5) / SUB;
          if ((px - cx) ** 2 + (py - cy) ** 2 <= radius * radius) inside += 1;
        }
      }
      const coverage = inside / (SUB * SUB);
      const i = (y * width + x) * 4;
      data[i + 3] = Math.round(data[i + 3] * coverage);
    }
  }
  return image;
}

/* ------------------------------------------------------------------ *
 * ICO container — a directory of embedded PNGs
 * ------------------------------------------------------------------ */

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory[at] = size >= 256 ? 0 : size; // 0 means 256
    directory[at + 1] = size >= 256 ? 0 : size;
    directory[at + 2] = 0; // palette
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function sips(args) {
  execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function resize(from, to, size) {
  execFileSync('cp', [from, to]);
  sips(['-z', String(size), String(size), to]);
}

if (!existsSync(sourcePath)) {
  console.error(
    `\n[icons] No artwork at build/icon-source.png.\n\n` +
      `  This is the master image the icon set is derived from — a square PNG,\n` +
      `  1024x1024, background included. Put it there and run this again.\n`
  );
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('\n[icons] iconutil and sips are macOS-only. Run this on a Mac; build/icon.icns is committed so CI never needs to.\n');
  process.exit(1);
}

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const master = keyBackground(decodePng(await readFile(sourcePath)));
const { mark: markBox, wordmarkTop } = findMark(master);

// Symmetric padding around the monogram, then the wordmark painted out. Cutting
// halfway between the two keeps a margin on both sides of the measurement.
const crop = squareCrop(master, markBox, 0.14);
if (wordmarkTop !== null) {
  maskBelow(crop, Math.round((markBox.maxY + wordmarkTop) / 2) - crop.offsetY);
}
const mark = roundCorners(crop, 0.2);

const fullPath = path.join(workDir, 'full.png');
const markPath = path.join(workDir, 'mark.png');
await writeFile(fullPath, encodePng(master));
await writeFile(markPath, encodePng(mark));

// build/icon.png is the transparent master: Linux uses it directly, and it is
// the fallback electron-builder would resize if the .icns ever went missing.
await writeFile(path.join(buildDir, 'icon.png'), encodePng(master));

const iconset = path.join(workDir, 'icon.iconset');
await mkdir(iconset, { recursive: true });
for (const [name, size, art] of ICNS_RENDITIONS) {
  resize(art === 'mark' ? markPath : fullPath, path.join(iconset, `${name}.png`), size);
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')]);

const icoEntries = [];
for (const [size, art] of ICO_SIZES) {
  const target = path.join(workDir, `ico-${size}.png`);
  resize(art === 'mark' ? markPath : fullPath, target, size);
  icoEntries.push({ size, png: await readFile(target) });
}
await writeFile(path.join(buildDir, 'icon.ico'), buildIco(icoEntries));

await rm(workDir, { recursive: true, force: true });

const marked = ICNS_RENDITIONS.filter(([, , a]) => a === 'mark').map(([, s]) => s);
console.log(`[icons] master ${master.width}x${master.height}, background keyed`);
console.log(`[icons] monogram found at ${markBox.minX},${markBox.minY} ${markBox.maxX - markBox.minX + 1}x${markBox.maxY - markBox.minY + 1} (${markBox.area} px)`);
console.log(`[icons] wordmark top ${wordmarkTop === null ? 'not detected' : `at y=${wordmarkTop}, masked out of the small crop`}`);
console.log(`[icons] monogram art used for ${[...new Set(marked)].join(', ')} px renditions`);
console.log('[icons] wrote build/icon.png, build/icon.icns, build/icon.ico');
