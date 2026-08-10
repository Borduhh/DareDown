/**
 * electron-builder afterPack hook — ad-hoc sign macOS builds.
 *
 * With no Developer ID on the machine, electron-builder skips signing entirely
 * and leaves Electron's own linker signature on the renamed binary. That yields
 * a *broken* signature: the code-signing identifier still reads "Electron"
 * rather than the app's bundle id, and no resources are sealed. Locally that
 * still launches, but a build downloaded from a GitHub Release carries the
 * quarantine flag, and macOS refuses a broken signature outright with "the
 * application is damaged" — much worse than the ordinary "unidentified
 * developer" prompt, which a valid ad-hoc signature gets you instead.
 *
 * So: when there is no real identity to sign with, ad-hoc sign properly.
 * Notarization still requires a paid Developer ID; this only avoids the
 * scarier failure and gets the bundle id onto the signature.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** True when a Developer ID is available, in which case electron-builder signs. */
function hasRealIdentity() {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true;
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
    return out.includes('Developer ID Application');
  } catch {
    return false;
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (hasRealIdentity()) return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const identifier = context.packager.appInfo.id;

  // --deep is deprecated for distribution signing but is the pragmatic way to
  // ad-hoc sign a bundle's nested helpers and frameworks in one pass.
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', identifier, appPath],
    { stdio: 'inherit' }
  );
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  console.log(`  • ad-hoc signed  ${path.basename(appPath)} as ${identifier}`);
}
