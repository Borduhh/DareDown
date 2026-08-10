#!/usr/bin/env node
/**
 * Guards the app icon before packaging.
 *
 * electron-builder falls back to the stock Electron icon with only a warning
 * when build/icon.png is missing or too small — which is easy to miss in CI log
 * output and ships a release wearing the wrong face. Fail loudly instead.
 *
 * Checks only what is unambiguous: present, PNG, square, big enough. The icon's
 * background being opaque is a deliberate design choice here, not a defect, so
 * it is reported as information and never warned about.
 *
 * Reads the PNG header directly; no image dependency.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconPath = path.join(root, 'build', 'icon.png');
const rel = path.relative(root, iconPath);

const MIN_SIZE = 512; // electron-builder needs >=512 to generate .icns and .ico
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let buffer;
try {
  buffer = await readFile(iconPath);
} catch {
  fail(
    `No app icon at ${rel}.\n\n` +
      `  Save the DareDown icon there as a square PNG (1024x1024 preferred),\n` +
      `  then run this again. Packaging is blocked because electron-builder\n` +
      `  would silently substitute the default Electron icon.`
  );
}

if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
  fail(`${rel} is not a PNG. Convert the artwork to PNG and save it there.`);
}

const width = buffer.readUInt32BE(16);
const height = buffer.readUInt32BE(20);
const colorType = buffer[25];

if (width < MIN_SIZE || height < MIN_SIZE) {
  fail(`${rel} is ${width}x${height}; at least ${MIN_SIZE}x${MIN_SIZE} is required.`);
}
if (width !== height) {
  fail(`${rel} is ${width}x${height}. App icons must be square — pad it to a square canvas.`);
}

const COLOR_TYPES = {
  0: 'greyscale',
  2: 'RGB',
  3: 'palette',
  4: 'greyscale + alpha',
  6: 'RGBA',
};

console.log(`[icon] ${rel} — ${width}x${height}, ${COLOR_TYPES[colorType] ?? `color type ${colorType}`}`);

function fail(message) {
  console.error(`\n[icon] ${message}\n`);
  process.exit(1);
}
