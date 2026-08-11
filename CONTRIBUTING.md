# Contributing to DareDown

Thanks for looking. DareDown is a small, deliberately narrow app: a read-only
Markdown viewer that works offline. Changes that keep it small and quiet are
easier to land than ones that widen its scope.

Two constraints are load-bearing, and a change that breaks either needs to say
so explicitly in its pull request:

- **It stays offline.** No network calls at runtime, no telemetry, no accounts.
  Enforced in three independent places — see
  [Offline and read-only](README.md#offline-and-read-only-enforced).
- **It stays read-only.** There is no editing surface, and the Markdown a user
  opens is treated as untrusted input.

## TypeScript

The renderer is TypeScript; the main process is JavaScript that is type-checked
but never compiled.

```bash
npm run typecheck
```

That runs two projects rather than one, on purpose:

| Project | Covers | lib |
|---|---|---|
| `tsconfig.renderer.json` | `src/renderer`, `src/types` | DOM only |
| `tsconfig.main.json` | `src/main`, `src/types` | Node + Electron, no DOM |

Splitting them means a Node global referenced in the renderer is a type error
rather than a runtime crash — the renderer is sandboxed with no Node integration,
so `require` type-checking there would be a lie. Both run `strict`.

Three things worth knowing before changing any of this:

- **esbuild strips types without checking them.** `npm run build` will happily
  bundle code that does not type-check, which is why CI runs `typecheck` as its
  own step. Removing that step silently removes the whole benefit.
- **`src/types/bridge.ts` is the IPC contract.** `preload.js` is annotated
  against it, the renderer consumes it, and `dev/harness.js` is checked against
  it too. Renaming a bridge member now breaks the build in every place that
  disagrees instead of surfacing as a runtime `undefined`.
- **`dev/harness.js` stays JavaScript.** `scripts/build.mjs` copies it verbatim
  rather than bundling it, so TypeScript there would reach the browser
  untranspiled. It carries JSDoc types instead.
- **`scripts/` is not type-checked.** Build tooling, where a mistake surfaces the
  moment you run it, and where esbuild and electron-builder option objects need
  heavy casting to satisfy their own typings for no safety gained.

The main process stays JavaScript because compiling it would move the Electron
entry point, the preload path and the `build.files` globs — packaging risk for a
codebase where JSDoc plus `checkJs` already gives the same checking.

## Development

```bash
npm run dev        # rebuild renderer on change + launch Electron
npm start          # one-shot build + run
npm run harness    # build dist/renderer/dev.html
```

`npm run harness` emits a page that runs the real renderer against a stubbed IPC
bridge with `samples/` inlined, so the reading experience, theming and the diagram
modal can be checked in any browser without launching Electron. It also shims
`matchMedia` the way `nativeTheme.themeSource` behaves in the real app. Never shipped.

Set `DAREDOWN_DEBUG=1` to enable DevTools and the View ▸ Toggle Developer Tools item.

### Layout

```
src/main/         main process — window, menu, config, watcher, IPC
  index.js          lifecycle, IPC handlers, network block
  config.js         atomic JSON preference store
  files.js          reading documents, walking folders, resolving links
  watcher.js        chokidar wrapper with atomic-save handling
  preload.js        the only renderer↔Node bridge
src/types/bridge.ts  the IPC contract, shared by preload, renderer and harness
src/renderer/
  main.ts           app wiring: tabs, sidebar views, commands, live reload, boot
  markdown.ts       markdown-it pipeline, sanitizer, DOM post-pass
  mermaid-view.ts   diagram render, inline zoom, fullscreen pan/zoom
  mermaid-theme.ts  Mermaid themeVariables derived from the palette
  tabs.ts tree.ts outline.ts find.ts overlays.ts toast.ts
  dev/harness.js    stub IPC bridge; stays JS, copied verbatim by the build
  styles/           tokens, shell, sidebar, prose, code, mermaid, overlays
build/icon.png      the app icon, source asset for .icns and .ico
scripts/build.mjs   esbuild bundle + harness generator
scripts/check-icon.mjs  refuses to package without a usable icon
scripts/after-pack.mjs  ad-hoc signs macOS builds when no Developer ID is present
.releaserc.json     semantic-release: how commits map to versions
commitlint.config.js  commit-message rules enforced on pull requests
.github/workflows/  ci.yml (build + commit lint), release.yml (version + installers)
```

Two notes for anyone editing this:

- **The renderer bundles as an IIFE, not ESM.** A `file://` page cannot load module
  scripts, so `scripts/build.mjs` disables code splitting to force esbuild to inline
  Mermaid's lazily-imported diagram modules, then fails the build if any dynamic
  `import(` survives. Switching to `format: 'esm'` would silently break diagram types.
- **Mermaid emits `<g class="node">`, and diagram SVGs live inside `.prose`.** Sidebar
  and prose CSS must not use selectors generic enough to reach into a diagram; the
  tree rules are scoped under `.tree` for exactly this reason.

`markdown-it`, `highlight.js` and `mermaid` are devDependencies on purpose: they are
compiled into `dist/renderer/app.js`, so shipping them in `node_modules` would double
their weight. `chokidar` is the only runtime dependency, which keeps the packaged
asar around 4 MB.

## Packaging

```bash
npm run dist:mac      # dmg + zip, arm64 and x64
npm run dist:win      # nsis installer
npm run dist:linux    # AppImage + deb
npm run pack          # unpacked directory, for a quick check
```

Output lands in `release/`. `.md` and friends are registered as openable document
types on all three platforms.

### Signing

macOS builds are signed with a Developer ID certificate and notarised when the
credentials are available, and fall back to ad-hoc signing when they are not.

Locally, signing needs nothing but the certificate in your login keychain —
`npm run pack` and `npm run dist:mac` pick it up automatically.
`scripts/after-pack.mjs` only ad-hoc signs when no real identity is found, so it
stands down on its own once a certificate is installed. That fallback matters:
with no identity at all, electron-builder skips signing and leaves Electron's own
signature on the renamed binary, which macOS rejects outright as *damaged* rather
than merely unverified.

Two gotchas worth knowing, both of which cost time the first time:

- **The hardened runtime is required for notarisation**, and it forbids three
  things Chromium needs. `build/entitlements.mac.plist` grants them as exceptions.
  It deliberately does not include `com.apple.security.app-sandbox`.
- **macOS does not ship the Developer ID G2 intermediate CA.** Xcode installs it;
  a machine with only Command Line Tools does not have it, and signing fails with
  `unable to build chain to self-signed root` even though the certificate and its
  private key are both present and correctly paired. Fix:

  ```bash
  curl -fSLo /tmp/DeveloperIDG2CA.cer https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
  security import /tmp/DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db
  ```

  `security find-identity -v -p codesigning` listing the certificate is the check
  that matters — a certificate visible in Keychain Access is not the same thing.

In CI the release workflow reads five secrets. If `MAC_CERT_P12`, `APPLE_ID` and
`APPLE_TEAM_ID` are all present it runs `dist:mac:signed`, which notarises;
otherwise it warns and produces an ad-hoc build, so a missing secret degrades
rather than failing the release.

| Secret | What it is |
|---|---|
| `MAC_CERT_P12` | base64 of the exported Developer ID `.p12` |
| `MAC_CERT_PASSWORD` | the password set when exporting it |
| `APPLE_ID` | the Apple ID that owns the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | from appleid.apple.com — **not** the account password |
| `APPLE_TEAM_ID` | the ten-character team identifier |

Notarisation is only exercised by `dist:mac:signed`; plain `npm run dist:mac` and
`npm run pack` sign without notarising, so they work with no credentials.

The app icon is a committed source asset at **`build/icon.png`** — a square PNG,
1024×1024, from which electron-builder generates the macOS `.icns` and Windows
`.ico`. `scripts/check-icon.mjs` runs before every package and fails the build if
it is missing, non-square or under 512px, because electron-builder would otherwise
substitute the stock Electron icon with only a warning.

The icon is a filled tile by design — its background is intentionally opaque
rather than transparent, so it reads as a folder on any surface.

## Updates

`electron-updater`, opt-in, wired in `src/main/updater.js`. Four things about it
are non-obvious:

- **It needs `build.publish` set** even though the dist scripts all pass
  `--publish never`. That config is the only reason electron-builder writes
  `app-update.yml` into the bundle, and electron-updater fails with a confusing
  ENOENT without it. It does not cause anything to be published.
- **`app-update.yml` is only written for real targets.** `npm run pack` uses
  `--dir` and skips it, so an update check in a `pack` build will not work. Build
  a dmg or zip to test.
- **There is no Windows portable target.** It was removed because a portable exe
  has no installer to re-run, so it can never self-update — shipping it would
  quietly create a population stuck on whatever version they first downloaded.
- **macOS requires a signed, notarised build.** Squirrel.Mac verifies the
  incoming bundle against the running app's designated requirement, and an
  ad-hoc signature's requirement is pinned to its own cdhash — so no future
  build can ever satisfy it. This is why auto-update was impossible before the
  Developer ID.
- **It bypasses the offline protections by design.** electron-updater uses Node's
  https, not Chromium's network stack, so `installNetworkBlock` never sees it.
  That is correct: those protections exist to stop an untrusted document calling
  out from the renderer, and the updater runs in main where no document reaches
  it. Do not "fix" this by routing the updater through the session.

`electron-updater` is a runtime dependency, unlike the rest — it has to ship. It
takes the asar from roughly 3.8 MB to 4.9 MB.

## Versioning and releases

Versions are derived from commit messages by
[semantic-release](https://semantic-release.gitbook.io/). **Don't edit `version` in
`package.json`** — it is written by the release job and committed back.

Write [Conventional Commits](https://www.conventionalcommits.org/):

| Commit type | Release | Version | Example |
|---|---|---|---|
| `fix:` `perf:` `refactor:` `style:` `revert:` | patch | `1.0.1` → `1.0.2` | `fix(outline): clamp scroll offset` |
| `feat:` | minor | `1.0.1` → `1.1.0` | `feat(mermaid): support radar charts` |
| `feat!:` or a `BREAKING CHANGE:` footer | major | `1.0.1` → `2.0.0` | `feat(prefs)!: drop legacy config keys` |
| `docs:` `test:` `build:` `ci:` `chore:` | none | — | `docs: fix a typo` |

Scopes are conventional but optional: `feat(mermaid): …`, `fix(outline): …`. The
allowed list is in `commitlint.config.js`, and CI warns rather than fails on an
unfamiliar one. Commit messages on pull requests are linted, because an
unparseable message silently changes what version ships.

Pushing to `main` runs `.github/workflows/release.yml`, which:

1. works out the next version from the commits since the last tag — and stops
   right there if nothing warrants a release;
2. updates `CHANGELOG.md` and `package.json`, commits them as
   `chore(release): x.y.z [skip ci]`, and tags `vx.y.z`;
3. creates the GitHub Release with generated notes;
4. builds macOS, Windows and Linux installers from that tag in parallel and
   uploads them to the release.

Pushing to `next` publishes a prerelease (`1.2.0-next.1`) on the `next` dist-tag
instead. To see what *would* happen without touching anything:

```bash
npm run release:dry
```

## Icons

`build/icon-source.png` is the artwork of record — the full 1024×1024 image with
its background. Everything else in `build/` is derived from it:

```bash
npm run icons
```

That writes `icon.png` (transparent master, used for Linux), `icon.icns` (macOS)
and `icon.ico` (Windows). All four are committed, because `sips` and `iconutil`
are macOS-only and CI must not have to run this.

Two things the script does that a single resize cannot:

- **Keys the background to transparency.** The artwork sits on an opaque
  near-white field, and macOS and Windows composite that as a pale square tile
  rather than cropping to the shape. A flood fill inward from the border is used
  rather than a colour key, because the field is dozens of shades of near-white.
- **Gives the small renditions different art.** At 16 and 32px the folder plus
  wordmark collapses into an unreadable smudge, so those sizes get the monogram
  alone on a rounded tile; 128px and up keep the full folder. The monogram is
  located by finding the largest connected red region, and the wordmark's top
  edge is measured so it can be masked out rather than clipped — re-exporting
  the source at a different composition will not silently crop the wrong area.

`scripts/check-icon.mjs` runs before every package and fails the build if the
icon is missing, non-square or under 512px, because electron-builder otherwise
substitutes the stock Electron icon with only a warning.
