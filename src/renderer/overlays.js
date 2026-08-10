/**
 * Transient sheets: preferences, quick open, and the shortcut reference.
 * Each returns a controller with open/close/toggle so main.js can treat them
 * uniformly and close whatever is open when Escape is pressed.
 */

const overlayRoot = () => document.getElementById('overlay-root');

/** Shared plumbing: scrim, outside-click, Escape, focus restore. */
function mountSheet(sheet, { onClose, scrim = true, initialFocus = null }) {
  const host = overlayRoot();
  const previousFocus = document.activeElement;
  const nodes = [];

  if (scrim) {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-scrim';
    backdrop.addEventListener('mousedown', () => controller.close());
    nodes.push(backdrop);
    host.append(backdrop);
  }
  host.append(sheet);
  nodes.push(sheet);

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      controller.close();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  let closed = false;
  const controller = {
    get isOpen() {
      return !closed;
    },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      for (const node of nodes) node.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      onClose?.();
    },
  };

  requestAnimationFrame(() => initialFocus?.focus?.());
  return controller;
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

/**
 * @param {object} options
 * @param {object} options.prefs current preference values
 * @param {(patch: object) => void} options.onChange applied live, then persisted
 * @param {string} options.configPath shown at the bottom so the file is findable
 */
export function openPreferences({ prefs, onChange, configPath, onClose }) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet prefs';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Preferences');

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = 'Preferences';

  const body = document.createElement('div');
  body.className = 'prefs-body';

  /* --- theme --- */
  const themeField = field('Theme');
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [value, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.theme = value;
    button.setAttribute('aria-pressed', String(prefs.theme === value));
    button.addEventListener('click', () => {
      for (const sibling of seg.children) sibling.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      onChange({ theme: value });
    });
    seg.append(button);
  }
  themeField.append(seg);

  /* --- width --- */
  const widthField = slider({
    label: 'Reading width',
    min: 560,
    max: 1100,
    step: 20,
    value: prefs.readingWidth,
    format: (v) => `${v}px`,
    // Dragging the measure means you want a measure, so it leaves full width.
    onInput: (v) => {
      if (fullWidthInput.checked) {
        fullWidthInput.checked = false;
        widthField.input.disabled = false;
      }
      onChange({ fullWidth: false, readingWidth: v });
    },
  });

  const fullWidthField = checkbox({
    label: 'Full width',
    checked: Boolean(prefs.fullWidth),
    onChange: (checked) => {
      // The measure slider has no effect while the column fills the pane.
      widthField.input.disabled = checked;
      onChange({ fullWidth: checked });
    },
  });
  const fullWidthInput = fullWidthField.querySelector('input');
  widthField.input.disabled = Boolean(prefs.fullWidth);

  const sizeField = slider({
    label: 'Text size',
    min: 13,
    max: 24,
    step: 1,
    value: prefs.fontSize,
    format: (v) => `${v}px`,
    onInput: (v) => onChange({ fontSize: v }),
  });

  /* --- toggles --- */
  const wrapField = checkbox({
    label: 'Soft-wrap long code lines',
    checked: Boolean(prefs.wrapCode),
    onChange: (checked) => onChange({ wrapCode: checked }),
  });

  body.append(themeField, widthField, fullWidthField, sizeField, wrapField);

  const foot = document.createElement('div');
  foot.className = 'prefs-foot';
  foot.append(document.createTextNode('Saved to '));
  const code = document.createElement('code');
  code.textContent = configPath || 'config.json';
  foot.append(code);

  sheet.append(title, body, foot);
  return mountSheet(sheet, { onClose, scrim: true, initialFocus: seg.firstElementChild });
}

function field(labelText) {
  const wrap = document.createElement('div');
  wrap.className = 'pref';
  const row = document.createElement('div');
  row.className = 'pref-row';
  const label = document.createElement('span');
  label.className = 'pref-label';
  label.textContent = labelText;
  row.append(label);
  wrap.append(row);
  return wrap;
}

/** Returns the field wrapper, with `.input` exposed so callers can disable it. */
function slider({ label, min, max, step, value, format, onInput }) {
  const wrap = field(label);
  const readout = document.createElement('span');
  readout.className = 'pref-value';
  readout.textContent = format(value);
  wrap.querySelector('.pref-row').append(readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    readout.textContent = format(next);
    onInput(next);
  });
  wrap.append(input);
  wrap.input = input;
  return wrap;
}

function checkbox({ label: labelText, checked, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'pref';
  const label = document.createElement('label');
  label.className = 'pref-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.className = 'pref-label';
  text.textContent = labelText;
  label.append(input, text);
  wrap.append(label);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Quick open
 * ------------------------------------------------------------------ */

/**
 * Fuzzy file picker over the workspace.
 * @param {object} options
 * @param {Array<{name: string, path: string}>} options.files
 * @param {string} options.rootPath used to shorten displayed paths
 * @param {(path: string) => void} options.onPick
 */
export function openQuickOpen({ files, rootPath, onPick, onClose }) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet quickopen';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Quick open');

  const input = document.createElement('input');
  input.className = 'qo-input';
  input.type = 'text';
  input.placeholder = 'Go to file…';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search files');

  const list = document.createElement('div');
  list.className = 'qo-list';
  sheet.append(input, list);

  let results = [];
  let selected = 0;

  function shortPath(path) {
    if (rootPath && path.startsWith(rootPath)) {
      return path.slice(rootPath.length).replace(/^[/\\]/, '');
    }
    return path;
  }

  function refresh() {
    const query = input.value.trim();
    results = rank(files, query).slice(0, 80);
    selected = 0;
    draw(query);
  }

  function draw(query) {
    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'qo-empty';
      empty.textContent = files.length === 0 ? 'No folder open.' : 'No matching files.';
      list.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = index === selected ? 'qo-item is-selected' : 'qo-item';
      item.dataset.path = result.file.path;

      const name = document.createElement('span');
      name.className = 'qo-name';
      highlightMatches(name, result.file.name, query);

      const path = document.createElement('span');
      path.className = 'qo-path';
      path.textContent = shortPath(result.file.path);

      item.append(name, path);
      item.addEventListener('click', () => {
        onPick(result.file.path);
        controller.close();
      });
      item.addEventListener('mousemove', () => {
        if (selected === index) return;
        selected = index;
        for (const [i, child] of [...list.children].entries()) {
          child.classList.toggle('is-selected', i === index);
        }
      });
      fragment.append(item);
    });
    list.replaceChildren(fragment);
  }

  function move(offset) {
    if (results.length === 0) return;
    selected = (selected + offset + results.length) % results.length;
    for (const [index, child] of [...list.children].entries()) {
      child.classList.toggle('is-selected', index === selected);
    }
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[selected];
      if (chosen) {
        onPick(chosen.file.path);
        controller.close();
      }
    }
  });

  refresh();
  const controller = mountSheet(sheet, { onClose, scrim: true, initialFocus: input });
  return controller;
}

/**
 * Subsequence matcher. Scores contiguous runs, word starts and basename hits
 * above scattered matches, which is what makes typing initials work.
 */
function rank(files, query) {
  if (!query) {
    return files.map((file) => ({ file, score: 0 }));
  }
  const needle = query.toLowerCase();
  const scored = [];

  for (const file of files) {
    const name = file.name.toLowerCase();
    const nameScore = score(name, needle);
    const pathScore = score(file.path.toLowerCase(), needle);
    // A hit in the filename is worth much more than one in a parent folder.
    const best = Math.max(nameScore * 2.4, pathScore);
    if (best > 0) scored.push({ file, score: best });
  }

  scored.sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name));
  return scored;
}

function score(haystack, needle) {
  let hay = 0;
  let total = 0;
  let streak = 0;

  for (let i = 0; i < needle.length; i += 1) {
    const found = haystack.indexOf(needle[i], hay);
    if (found === -1) return 0;
    if (found === hay && i > 0) {
      streak += 1;
      total += 8 + streak * 3; // contiguous run
    } else {
      streak = 0;
      total += 1;
      const previous = haystack[found - 1];
      if (found === 0 || previous === '/' || previous === '\\' || previous === '-' || previous === '_' || previous === '.') {
        total += 5; // start of a word or path segment
      }
    }
    hay = found + 1;
  }
  // Prefer shorter haystacks when the score is otherwise a tie.
  return total + Math.max(0, 24 - haystack.length * 0.05);
}

/** Bold the matched subsequence characters in a label. */
function highlightMatches(target, text, query) {
  if (!query) {
    target.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let plain = '';

  for (const char of needle) {
    const found = lower.indexOf(char, cursor);
    if (found === -1) break;
    plain += text.slice(cursor, found);
    if (plain) {
      target.append(document.createTextNode(plain));
      plain = '';
    }
    const mark = document.createElement('span');
    mark.className = 'qo-match';
    mark.textContent = text[found];
    target.append(mark);
    cursor = found + 1;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}

/* ------------------------------------------------------------------ *
 * Shortcuts reference
 * ------------------------------------------------------------------ */

export function openShortcuts({ isMac, onClose }) {
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';
  const shift = isMac ? '⇧' : 'Shift';

  const GROUPS = [
    ['Files', [
      [`${mod}O`, 'Open file'],
      [`${shift}${mod}O`, 'Open folder'],
      [`${mod}P`, 'Quick open'],
      [`${mod}R`, 'Reload document'],
      [`${mod}${alt}R`, 'Reveal in file manager'],
      [`${mod}W`, 'Close tab'],
    ]],
    ['Navigate', [
      [isMac ? `${mod}${alt}→` : 'Ctrl+Tab', 'Next tab'],
      [isMac ? `${mod}${alt}←` : `Ctrl+${shift}+Tab`, 'Previous tab'],
      [`${mod}↑`, 'Top of document'],
      [`${mod}↓`, 'Bottom of document'],
      [`${mod}F`, 'Find in document'],
      [`${mod}G`, 'Find next'],
    ]],
    ['Sidebar', [
      [`${mod}B`, 'Show / hide sidebar'],
      [`${shift}${mod}B`, 'Switch files ⇄ outline'],
      [`${shift}${mod}E`, 'Files'],
      [`${shift}${mod}Y`, 'Outline'],
    ]],
    ['View', [
      [`${mod}\\`, 'Full width'],
      [`${mod}[`, 'Narrower column'],
      [`${mod}]`, 'Wider column'],
      [`${shift}${mod}T`, 'Light / dark theme'],
      [`${mod}+`, 'Larger text'],
      [`${mod}−`, 'Smaller text'],
      [`${mod}0`, 'Reset text size'],
      [`${mod},`, 'Preferences'],
    ]],
    ['Diagrams', [
      ['Click', 'Open fullscreen'],
      [`${mod}Scroll`, 'Zoom inline'],
      ['Drag', 'Pan in fullscreen'],
      ['Scroll / pinch', 'Zoom in fullscreen'],
      ['Double-click', 'Zoom in at pointer'],
      ['+ / −', 'Zoom in fullscreen'],
      ['0', 'Reset view'],
      ['Esc', 'Close fullscreen'],
    ]],
  ];

  const sheet = document.createElement('div');
  sheet.className = 'sheet shortcuts';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Keyboard shortcuts');

  const title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = 'Keyboard shortcuts';

  const body = document.createElement('div');
  body.className = 'shortcuts-body';

  for (const [groupName, rows] of GROUPS) {
    const group = document.createElement('div');
    group.className = 'shortcuts-group';
    const heading = document.createElement('h3');
    heading.textContent = groupName;
    group.append(heading);

    for (const [keys, description] of rows) {
      const row = document.createElement('div');
      row.className = 'shortcut';
      const text = document.createElement('span');
      text.textContent = description;
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      row.append(text, kbd);
      group.append(row);
    }
    body.append(group);
  }

  sheet.append(title, body);
  return mountSheet(sheet, { onClose, scrim: true, initialFocus: sheet });
}
