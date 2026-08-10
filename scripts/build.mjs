#!/usr/bin/env node
/**
 * Builds the renderer bundle (JS + CSS) with esbuild and copies static assets
 * into dist/renderer. The main process runs straight from src/main (CommonJS),
 * so it needs no build step.
 *
 *   node scripts/build.mjs                 one-shot production build
 *   node scripts/build.mjs --watch          rebuild on change
 *   node scripts/build.mjs --watch --electron   rebuild + launch electron
 */
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist', 'renderer');

const watch = process.argv.includes('--watch');
const launchElectron = process.argv.includes('--electron');
const harness = process.argv.includes('--harness');
const dev = watch || harness;

/** Copy index.html and any static assets into the output directory. */
async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await cp(path.join(root, 'src', 'renderer', 'index.html'), path.join(outdir, 'index.html'));
  if (harness) await buildHarness();
}

/**
 * Emit dist/renderer/dev.html — the real renderer with a stub IPC bridge and
 * the samples/ tree inlined, so the reading experience can be checked in a
 * plain browser. Never produced by a normal build.
 */
async function buildHarness() {
  const samplesDir = path.join(root, 'samples');
  const files = {};

  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(abs);
      else if (/\.(md|markdown)$/i.test(entry.name)) {
        // Keys use POSIX separators to match the fixture path scheme.
        files[`/${path.relative(root, abs).split(path.sep).join('/')}`] = await readFile(abs, 'utf8');
      }
    }
  }
  await collect(samplesDir);

  const fixtures = {
    root: '/samples',
    files,
    openFiles: ['/samples/README.md', '/samples/diagrams.md', '/samples/typography.md'],
    activeFile: '/samples/README.md',
  };

  const stub = await readFile(path.join(root, 'src', 'renderer', 'dev', 'harness.js'), 'utf8');
  await writeFile(
    path.join(outdir, 'harness.js'),
    `window.__DAREDOWN_FIXTURES__ = ${JSON.stringify(fixtures)};\n${stub}`,
    'utf8'
  );

  const html = (await readFile(path.join(root, 'src', 'renderer', 'index.html'), 'utf8'))
    .replace('<title>DareDown</title>', '<title>DareDown (harness)</title>')
    .replace('<script src="app.js"></script>', '<script src="harness.js"></script>\n    <script src="app.js"></script>');
  await writeFile(path.join(outdir, 'dev.html'), html, 'utf8');
  console.log(`[build] harness: dist/renderer/dev.html (${Object.keys(files).length} fixture files)`);
}

/**
 * esbuild inlines dynamic import() calls when the output format has no code
 * splitting, which is what lets mermaid's lazily-loaded diagram modules ship in
 * a single classic script. A leftover bare `import(` would mean some diagram
 * type silently fails at runtime, so fail the build loudly instead.
 */
async function verifyNoDynamicImports() {
  const js = await readFile(path.join(outdir, 'app.js'), 'utf8');
  // Comments mention import() in JSDoc typedefs, so strip them before looking.
  const { code } = await esbuild.transform(js, { minify: true, loader: 'js' });
  const leftovers = code.match(/\bimport\s*\(/g);
  if (leftovers) {
    throw new Error(
      `Bundle still contains ${leftovers.length} un-inlined dynamic import(); ` +
        'lazy-loaded modules would fail at runtime under file://.'
    );
  }
}

const options = {
  entryPoints: [path.join(root, 'src', 'renderer', 'main.js')],
  outfile: path.join(outdir, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome128'],
  // Classic script, not a module: file:// pages cannot load ES modules (CORS).
  splitting: false,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  loader: { '.css': 'css', '.svg': 'text' },
};

if (watch) {
  await copyStatic();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/renderer …');
  if (launchElectron) {
    const electron = (await import('electron')).default;
    spawn(electron, [root], { stdio: 'inherit' }).on('exit', () => process.exit(0));
  }
} else {
  await copyStatic();
  const result = await esbuild.build(options);
  await verifyNoDynamicImports();
  const sizes = Object.entries(result.metafile.outputs)
    .map(([file, o]) => `  ${path.relative(root, file)}  ${(o.bytes / 1024).toFixed(0)} kB`)
    .join('\n');
  console.log(`[build] done\n${sizes}`);
  await writeFile(path.join(root, 'dist', 'meta.json'), JSON.stringify(result.metafile));
}
