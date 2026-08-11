/**
 * The contract between the main process and the renderer.
 *
 * Four things have to agree about this shape and nothing but discipline held
 * them in agreement before: `src/main/preload.js` exposes it,
 * `src/main/index.js` implements the handlers behind it, `src/renderer/*`
 * consumes it, and `src/renderer/dev/harness.js` re-implements it as a stub for
 * the browser harness. Renaming a member used to be a runtime `undefined`; with
 * this file it is a type error.
 *
 * Kept as types only — nothing here is emitted or bundled.
 */

/* ------------------------------------------------------------------ *
 * Preferences — mirrors DEFAULTS in src/main/config.js
 * ------------------------------------------------------------------ */

export type ThemePreference = 'system' | 'light' | 'dark';
export type SidebarPane = 'files' | 'outline';

export interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

export interface Config {
  window: WindowState;
  theme: ThemePreference;
  readingWidth: number;
  fullWidth: boolean;
  fontSize: number;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarPane: SidebarPane;
  wrapCode: boolean;
  /** Check GitHub for a newer release on launch. Off by default. */
  autoUpdate: boolean;
  lastFolder: string | null;
  lastFiles: string[];
  activeFile: string | null;
}

/** Every field is optional on the way in; main sanitizes and returns the whole. */
export type ConfigPatch = Partial<Config>;

/**
 * What `config:get` actually resolves to. The path is not stored in the config
 * file — main appends it so the preferences panel can show where it saves —
 * which is why reads and writes are not the same shape.
 */
export interface ConfigWithPath extends Config {
  configPath: string;
}

/* ------------------------------------------------------------------ *
 * Documents and the folder tree
 * ------------------------------------------------------------------ */

export interface MarkdownDocument {
  path: string;
  name: string;
  dir: string;
  content: string;
  mtimeMs: number;
  size: number;
}

export interface TreeFile {
  type: 'file';
  name: string;
  path: string;
}

export interface TreeDirectory {
  type: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDirectory;

export interface FolderTree {
  root: string;
  name: string;
  children: TreeNode[];
  /** Set when the walk hit its depth or entry budget. */
  truncated: boolean;
}

export interface PathInfo {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
}

export interface WatchRequest {
  files: string[];
  folder: string | null;
}

export interface MenuCommand {
  command: string;
  arg?: unknown;
}

export interface RendererReady {
  platform: string;
  version: string;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error'
  | 'unsupported';

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  /** Download progress, 0-100. */
  percent?: number;
  message?: string;
}

/** Every `on*` member returns its own unsubscribe function. */
export type Unsubscribe = () => void;

/* ------------------------------------------------------------------ *
 * The bridge
 * ------------------------------------------------------------------ */

export interface DareDownApi {
  readonly platform: string;

  // ---- documents -------------------------------------------------------
  readFile(filePath: string): Promise<MarkdownDocument>;
  readTree(folder: string): Promise<FolderTree>;
  resolveLink(fromFile: string, href: string): Promise<string | null>;
  pathInfo(filePath: string): Promise<PathInfo | null>;

  // ---- dialogs & shell -------------------------------------------------
  openFileDialog(): Promise<string[]>;
  openFolderDialog(): Promise<string | null>;
  /** False when the URL is not http(s) or mailto, which main refuses to open. */
  openExternal(url: string): Promise<boolean>;
  revealInFolder(filePath: string): Promise<void>;

  // ---- preferences -----------------------------------------------------
  getConfig(): Promise<ConfigWithPath>;
  /** Returns the whole config after main has merged and clamped the patch. */
  setConfig(patch: ConfigPatch): Promise<Config>;
  setThemeSource(source: ThemePreference): Promise<boolean>;

  // ---- live reload -----------------------------------------------------
  watch(payload: WatchRequest): Promise<boolean>;

  // ---- events from main ------------------------------------------------
  onFileChanged(handler: (path: string) => void): Unsubscribe;
  onFileRemoved(handler: (path: string) => void): Unsubscribe;
  onTreeChanged(handler: (path: string) => void): Unsubscribe;
  onNativeThemeChanged(handler: (isDark: boolean) => void): Unsubscribe;
  onMenuCommand(handler: (payload: MenuCommand) => void): Unsubscribe;
  onOpenPaths(handler: (paths: string[]) => void): Unsubscribe;

  // ---- updates ---------------------------------------------------------
  /** Ask GitHub for a newer release. Progress arrives via onUpdateStatus. */
  checkForUpdates(): Promise<void>;
  /** Restart into an already-downloaded update. */
  installUpdate(): Promise<void>;
  onUpdateStatus(handler: (status: UpdateStatus) => void): Unsubscribe;

  // ---- lifecycle -------------------------------------------------------
  ready(): Promise<RendererReady>;
}

declare global {
  interface Window {
    daredown: DareDownApi;
    /** Present only in the dev harness; see src/renderer/dev/harness.js. */
    __harness?: {
      fixtures: { root: string; files: Record<string, string> };
      /** Fire a menu command, as the main process would. */
      command(name: string): void;
      emit(name: string, payload?: unknown): void;
      /** Simulate an external edit, for live-reload checks. */
      editFile(path: string, content: string): void;
    };
  }
}
