<img src="build/icon.png" alt="DareDown" width="112" align="right" />

# DareDown

**A markdown reader that isn't afraid of anything — not even your gnarliest .md files.**

> **DareDown cost a *lot* of tokens to build.** If it earns a spot in your dock,
> a sponsorship keeps it getting updates.
>
> [![Sponsor DareDown](https://img.shields.io/badge/Sponsor-DareDown-B5602F?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Borduhh)

[![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-2C2A26?style=flat-square)](https://github.com/Borduhh/DareDown/releases)
[![Offline](https://img.shields.io/badge/offline-no%20network%20calls-4F7245?style=flat-square)](#offline-and-read-only-enforced)
[![License](https://img.shields.io/badge/license-MIT-6B6862?style=flat-square)](LICENSE)

A quiet, offline desktop reader for local Markdown. View-only by design — it renders
GFM and Mermaid diagrams and stays out of the way. Electron, so it behaves identically
on macOS, Windows and Linux.

The visual target is a printed page under a lamp rather than a code editor: one
warm surface, a measured column, hairline rules, and no shadows anywhere except
the diagram modal.

## Install

Grab an installer from the [latest release](https://github.com/Borduhh/DareDown/releases/latest):

| Platform | Download |
|---|---|
| macOS (Apple silicon) | `DareDown-*-arm64.dmg` |
| macOS (Intel) | `DareDown-*.dmg` |
| Windows | `DareDown.Setup.*.exe`, or `DareDown.*.exe` to run without installing |
| Linux | `DareDown-*.AppImage`, or `daredown_*_amd64.deb` |

### macOS blocks it on first launch

DareDown is signed, but not **notarised** — that needs a paid Apple Developer
account. So the first time you open it, macOS refuses and says it cannot verify
the developer. To get past it, once:

1. Double-click DareDown and dismiss the warning. This step matters — the button
   in the next step only appears after macOS has blocked a launch attempt.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the Security section, find the message about DareDown being blocked,
   and click **Open Anyway**.
4. Confirm with Touch ID or your password.

It opens normally from then on. On macOS 15 and later the old
right-click → Open shortcut no longer works for un-notarised apps; Privacy &
Security is the way. Windows shows the equivalent SmartScreen prompt — choose
**More info → Run anyway**.

### Make it your default Markdown reader

DareDown claims six extensions, and Finder's "Change All…" only does one at a
time, so [`duti`](https://github.com/moretension/duti) is worth it:

```bash
brew install duti
```

```bash
for ext in md markdown mdown mkd mdx qmd; do duti -s com.borduhh.daredown "$ext" all; done
```

Without `duti`: right-click any `.md` → **Get Info** → **Open with:** → DareDown →
**Change All…**

### From source

```bash
git clone https://github.com/Borduhh/DareDown.git
cd DareDown
npm install
npm run open:samples
```

## What it does

**Reading.** Open a single file or a folder. In folder mode you get a Markdown-only
file tree, tabs, and quick open (`⌘P`). Relative links to other `.md` files open in
a new tab — including extension-less and `dir/README.md`-style links, the way
documentation sites write them.

**One left pane, two views.** The file tree and the heading outline share the
sidebar; the `Files` / `Outline` tabs at its top switch between them, as does
`⇧⌘B`. The outline tracks your position as you scroll and jumps on click.

**Width.** Either set a reading measure (`⌘[` / `⌘]`, or the slider in
preferences) or hit `⌘\` for full width, which drops the measure and lets the
column fill the pane — the quick way to give a wide table or diagram more room.
Nudging the measure leaves full width again. (This is the reading column; OS
fullscreen is separate, under View.)

**GFM.** Tables with alignment, task lists, strikethrough, footnotes, autolinks,
`> [!NOTE]` alerts, YAML front matter, and syntax-highlighted fenced code with a
hover copy button. Raw HTML is allowed but sanitized.

**Mermaid.** All standard diagram types render locally — no CDN, no network. Every
diagram has hover-revealed controls (zoom out / level / zoom in / reset /
fullscreen) and opens into a fullscreen modal with click-drag panning, cursor-anchored
scroll and pinch zoom from 25% to 400%, a live zoom indicator, a reset button, and
Esc-or-click-outside to close. Diagrams are themed to the app palette rather than
Mermaid's defaults, and a diagram that fails to parse degrades to an inline error
card showing the message and its source — it never takes the page down.

**Live reload.** Open files and the workspace folder are watched with chokidar and
re-render on external edits, preserving scroll position and any zoom you set on a
diagram. Atomic saves (the write-temp-then-rename that vim and VS Code use) are
recognised as edits, not deletions.

**Memory.** Window size and position, theme, reading width and full-width mode,
text size, sidebar visibility and which sidebar view was open, and the last opened
folder and tabs all persist to one JSON file you can read or delete:

- macOS `~/Library/Application Support/DareDown/config.json`
- Windows `%APPDATA%\DareDown\config.json`
- Linux `~/.config/DareDown/config.json`

## Offline and read-only, enforced

The constraint is load-bearing, so it is enforced in three independent places:

1. Everything is bundled — Mermaid, highlight.js, markdown-it. There are no
   remote assets and no web fonts; the UI uses system font stacks.
2. The main process cancels every request whose scheme could reach the network
   (`src/main/index.js`, `installNetworkBlock`), and denies all permission requests.
3. A CSP in `src/renderer/index.html` sets `connect-src 'none'` and refuses inline
   scripts, so raw HTML inside a Markdown file cannot execute or phone home.

No telemetry, no accounts, no cloud sync. The renderer is sandboxed with
`contextIsolation` on and reaches Node only through the small, explicit bridge in
`src/main/preload.js`.

## Shortcuts

`⌘/` (`Ctrl+/`) lists them all in the app. The essentials:

| Area | Shortcut | Action |
|---|---|---|
| Files | `⌘O` / `⇧⌘O` | Open file / folder |
| Files | `⌘P` | Quick open |
| Files | `⌘R` | Reload document |
| Sidebar | `⌘B` | Show / hide sidebar |
| Sidebar | `⇧⌘B` | Switch view, files ⇄ outline |
| Sidebar | `⇧⌘E` / `⇧⌘Y` | Files / Outline directly |
| Reading | `⌘\` | Full width |
| Reading | `⌘[` `⌘]` | Narrower / wider column |
| Reading | `⌘+` `⌘-` `⌘0` | Text size |
| Reading | `⇧⌘T` | Light / dark theme |
| Navigate | `⌘F` / `⌘G` | Find in document / find next |
| Navigate | `⌘1`–`⌘9` | Jump to tab |

Inside a diagram: click to open fullscreen, drag to pan, scroll or pinch to zoom,
double-click to zoom at the pointer, `+`/`-`/`0` and arrows, `Esc` to close.
`⌘Scroll` zooms a diagram inline without leaving the page.

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
src/renderer/
  main.js           app wiring: tabs, sidebar views, commands, live reload, boot
  markdown.js       markdown-it pipeline, sanitizer, DOM post-pass
  mermaid-view.js   diagram render, inline zoom, fullscreen pan/zoom
  mermaid-theme.js  Mermaid themeVariables derived from the palette
  tabs.js tree.js outline.js find.js overlays.js toast.js
  styles/           tokens, shell, sidebar, prose, code, mermaid, overlays
build/icon.png      the app icon, source asset for .icns and .ico
scripts/build.mjs   esbuild bundle + harness generator
scripts/check-icon.mjs  refuses to package without a usable icon
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
npm run dist:win      # nsis installer + portable
npm run dist:linux    # AppImage + deb
npm run pack          # unpacked directory, for a quick check
```

Output lands in `release/`. `.md` and friends are registered as openable document
types on all three platforms. Builds are unsigned unless a signing identity is
available — on macOS, set up a Developer ID and electron-builder will pick it up;
without one, `release/` artifacts will warn on first launch on another machine.

The app icon is a committed source asset at **`build/icon.png`** — a square PNG,
1024×1024, from which electron-builder generates the macOS `.icns` and Windows
`.ico`. `scripts/check-icon.mjs` runs before every package and fails the build if
it is missing, non-square or under 512px, because electron-builder would otherwise
substitute the stock Electron icon with only a warning.

The icon is a filled tile by design — its background is intentionally opaque
rather than transparent, so it reads as a folder on any surface.

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

### First release

The first push to `main` releases **1.0.0** — semantic-release's default when the
repository has no tags yet, and deliberate here. Don't tag a `v0.1.0` baseline
first; that would start the numbering in `0.x` instead. Everything after that is
derived from the table above.

### A pin worth keeping

`conventional-changelog-conventionalcommits` is pinned to `^8`. Version 10 targets
a newer `conventional-changelog-writer` than `@semantic-release/release-notes-generator@14`
depends on, and the mismatch fails *silently* — versions still come out correct,
but every release gets empty notes and an empty changelog entry. Upgrade it only
together with the semantic-release plugins, and check that `npm run release:dry`
still prints a populated notes block.

## Known limits

- Inline SVG and `<iframe>`/`<script>` in Markdown are stripped by the sanitizer.
  Mermaid is the supported route to diagrams.
- No math rendering (KaTeX/MathJax would need to be bundled; not wired up).
- No print or export.
- Mermaid is ~3 MB of the bundle. That is the price of rendering every diagram type
  offline, and it is the main reason `app.js` is as large as it is.

## Sponsoring

DareDown is free, offline and has no telemetry, so there is no business model behind
it — just tokens and evenings. If it's useful to you, [sponsoring on
GitHub](https://github.com/sponsors/Borduhh) is what funds the next round of work.

## License

MIT — see [LICENSE](LICENSE).
