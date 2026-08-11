/**
 * The Markdown pipeline: markdown-it configured for GFM, a warm syntax
 * highlighter, and a DOM post-pass that resolves local links and images,
 * builds the outline, and turns blockquote alerts into callouts.
 *
 * Mermaid fences are deliberately *not* rendered here. They become inert
 * placeholders carrying their own source, and mermaid-view.js takes over once
 * the document is in the DOM.
 */
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import taskListsPlugin from 'markdown-it-task-lists';
import anchorPlugin from 'markdown-it-anchor';
import frontMatterPlugin from 'markdown-it-front-matter';
import hljs from 'highlight.js/lib/common';

/* ------------------------------------------------------------------ *
 * Language labels
 * ------------------------------------------------------------------ */

const LANGUAGE_NAMES: Record<string, string> = {
  bash: 'Shell', sh: 'Shell', zsh: 'Shell', shell: 'Shell', console: 'Console',
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby',
  go: 'Go', rs: 'Rust', rust: 'Rust', java: 'Java', kt: 'Kotlin', kotlin: 'Kotlin',
  swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#',
  php: 'PHP', pl: 'Perl', lua: 'Lua', r: 'R', scala: 'Scala', dart: 'Dart',
  json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  xml: 'XML', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
  sql: 'SQL', graphql: 'GraphQL', diff: 'Diff', patch: 'Diff',
  md: 'Markdown', markdown: 'Markdown', dockerfile: 'Dockerfile',
  makefile: 'Makefile', ini: 'INI', properties: 'Properties',
  vim: 'Vim', powershell: 'PowerShell', ps1: 'PowerShell', bat: 'Batch',
  mermaid: 'Diagram', text: 'Text', txt: 'Text', plaintext: 'Text',
};

function languageLabel(info: string | undefined): string {
  if (!info) return 'Text';
  const key = info.toLowerCase();
  return (
    LANGUAGE_NAMES[key] ||
    info.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
  );
}

/* ------------------------------------------------------------------ *
 * Fence info parsing:  ```ts title="server.ts"  →  { lang, title }
 * ------------------------------------------------------------------ */

function parseFenceInfo(raw: string | undefined): { lang: string; title: string } {
  const info = (raw || '').trim();
  if (!info) return { lang: '', title: '' };
  const [first = '', ...rest] = info.split(/\s+/);
  const tail = rest.join(' ');
  const titled = tail.match(/(?:title|file|filename)\s*=\s*["']?([^"']+)["']?/i);
  return { lang: first.replace(/[{},]/g, ''), title: titled ? titled[1].trim() : '' };
}

/* ------------------------------------------------------------------ *
 * markdown-it instance
 * ------------------------------------------------------------------ */

let capturedFrontMatter = '';

const md = new MarkdownIt({
  html: true, // sanitized downstream; needed for <details>, <br>, <img>
  linkify: true, // GFM autolinks
  typographer: true, // smart quotes and dashes suit the printed-page look
  breaks: false,
  langPrefix: 'language-',
});

md.use(frontMatterPlugin, (text: string) => {
  capturedFrontMatter = text;
});
md.use(footnotePlugin);
md.use(taskListsPlugin, { enabled: false, label: true, labelAfter: false });
md.use(anchorPlugin, {
  level: [1, 2, 3, 4, 5, 6],
  slugify: slugifyHeading,
  permalink: anchorPlugin.permalink.ariaHidden({
    symbol: '#',
    placement: 'before',
    class: 'heading-anchor',
  }),
});

/** GitHub-compatible heading slugs, so `#some-heading` links keep working. */
function slugifyHeading(text: string): string {
  const base = String(text)
    .trim()
    .toLowerCase()
    .replace(/[ -⁯⸀-⹿'"!,.?:;@#$%^&*()[\]{}<>/\\|`~+=]/g, '')
    .replace(/\s+/g, '-');
  return base || 'section';
}

/** Fenced code: mermaid becomes a placeholder, everything else is highlighted. */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const { lang, title } = parseFenceInfo(token.info);
  const source = token.content;

  if (lang.toLowerCase() === 'mermaid') {
    // The source travels inside the block as escaped text — no attribute
    // encoding to get wrong, and it survives a re-render intact.
    return (
      '<div class="mermaid-block" data-state="pending">' +
      `<pre class="mermaid-source">${md.utils.escapeHtml(source)}</pre>` +
      '</div>\n'
    );
  }

  let body;
  if (lang && hljs.getLanguage(lang)) {
    try {
      body = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
    } catch {
      body = md.utils.escapeHtml(source);
    }
  } else {
    body = md.utils.escapeHtml(source);
  }

  // The header row and copy button are app chrome, so they are built in the
  // DOM pass *after* sanitizing rather than smuggled through it as markup.
  const codeClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
  return (
    `<div class="code-block" data-lang="${md.utils.escapeHtml(lang || 'text')}"` +
    ` data-title="${md.utils.escapeHtml(title || languageLabel(lang))}">` +
    `<pre><code${codeClass}>${body}</code></pre>` +
    '</div>\n'
  );
};

// Wrap tables so wide ones scroll inside their own box instead of the page.
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';

/* ------------------------------------------------------------------ *
 * Sanitizing
 * ------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q', 'rp',
  'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'time', 'tr', 'u', 'ul', 'var', 'wbr',
]);

/** Elements that are dropped along with their contents. */
const STRIPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'button', 'select', 'option', 'textarea', 'noscript', 'template',
  'audio', 'video', 'canvas', 'svg', 'math', 'applet', 'frame', 'frameset',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'srcset', 'alt', 'title', 'align', 'width', 'height', 'class',
  'id', 'colspan', 'rowspan', 'start', 'reversed', 'type', 'checked',
  'disabled', 'open', 'datetime', 'dir', 'lang', 'loading', 'cite', 'value',
  // Emitted by our own renderer rules and read back by the DOM pass.
  'data-lang', 'data-title', 'data-state',
]);

const SAFE_URL = /^(?:https?:|mailto:|tel:|file:|#|\/|\.{1,2}\/|[^:/?#]*(?:[/?#]|$))/i;

/**
 * Scrub the rendered HTML. The document is local and user-chosen, but a
 * Markdown file is still untrusted input — and the CSP alone would not stop,
 * say, an `onerror` handler or a `javascript:` href.
 */
function sanitizeInto(html: string, target: Element): void {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_ELEMENT);
  const doomed: Array<{ node: Element; unwrap: boolean }> = [];
  // SHOW_ELEMENT guarantees Elements, but the DOM types still say Node.
  let node = walker.nextNode() as Element | null;

  while (node) {
    const tag = node.tagName.toLowerCase();

    if (STRIPPED_TAGS.has(tag)) {
      doomed.push({ node, unwrap: false });
    } else if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but harmless (a stray custom element): keep the text, drop the box.
      doomed.push({ node, unwrap: true });
    } else {
      // Column alignment arrives as an inline style, which is about to be
      // stripped — carry it over to the `align` attribute first.
      if ((tag === 'th' || tag === 'td') && node.hasAttribute('style')) {
        const aligned = (node.getAttribute('style') ?? '').match(
          /text-align:\s*(left|center|right)/i
        );
        if (aligned?.[1]) node.setAttribute('align', aligned[1].toLowerCase());
      }

      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
          node.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'srcset') && !SAFE_URL.test(attr.value.trim())) {
          // Allow inline images, refuse every other data:/javascript: payload.
          if (!/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(attr.value.trim())) {
            node.removeAttribute(attr.name);
          }
        }
      }
      // Read-only app: any checkbox that survives stays uninteractive.
      if (tag === 'input') {
        node.setAttribute('disabled', '');
        if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
          doomed.push({ node, unwrap: false });
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }

  for (const { node: victim, unwrap } of doomed) {
    if (!victim.parentNode) continue;
    if (unwrap) victim.replaceWith(...victim.childNodes);
    else victim.remove();
  }

  target.replaceChildren(...parsed.body.childNodes);
}

/* ------------------------------------------------------------------ *
 * Front matter
 * ------------------------------------------------------------------ */

/** Minimal top-level YAML scalar/list reader — enough to show a header. */
function parseFrontMatter(text: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (!text) return entries;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();

    if (!value) {
      // A block list on the following lines.
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(lines[i + 1].replace(/^\s*-\s+/, '').trim());
        i += 1;
      }
      value = items.join(', ');
    }
    value = value.replace(/^["'](.*)["']$/, '$1').replace(/^\[(.*)\]$/, '$1');
    if (value) entries.push([key, value]);
  }
  return entries.slice(0, 12);
}

function frontMatterElement(entries: Array<[string, string]>): HTMLElement | null {
  if (entries.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'doc-frontmatter';
  const dl = document.createElement('dl');
  for (const [key, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  wrap.append(dl);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface Heading {
  id: string;
  level: number;
  text: string;
}

export interface RenderResult {
  headings: Heading[];
  frontMatter: Array<[string, string]>;
}

/**
 * Render Markdown into `target`, replacing its contents.
 * @returns {{ headings: Array<{id:string,level:number,text:string}>, frontMatter: Array<[string,string]> }}
 */
export function renderMarkdown(source: string, target: HTMLElement): RenderResult {
  capturedFrontMatter = '';
  const html = md.render(source);
  const frontMatter = parseFrontMatter(capturedFrontMatter);

  sanitizeInto(html, target);

  const header = frontMatterElement(frontMatter);
  if (header) target.prepend(header);

  transformCallouts(target);
  addCodeHeaders(target);
  const headings = collectHeadings(target);
  return { headings, frontMatter };
}

/**
 * Add the language label and copy button to each fenced block. Built here,
 * post-sanitize, so no interactive chrome has to pass through the scrubber.
 */
function addCodeHeaders(root: Element): void {
  for (const block of root.querySelectorAll<HTMLElement>('.code-block')) {
    if (block.querySelector(':scope > .code-head')) continue;

    const head = document.createElement('div');
    head.className = 'code-head';

    const label = document.createElement('span');
    label.className = 'code-title';
    label.textContent = block.dataset.title || languageLabel(block.dataset.lang);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.textContent = 'Copy';
    copy.dataset.copy = '';

    head.append(label, copy);
    block.prepend(head);
  }
}

/** Turn `> [!NOTE]` blockquotes into callouts. */
function transformCallouts(root: Element): void {
  const KINDS = new Set(['note', 'tip', 'important', 'warning', 'caution']);
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    if (!first || first.tagName !== 'P') continue;
    const match = first.textContent.match(/^\s*\[!(\w+)\]\s*(.*)$/s);
    if (!match) continue;
    const kind = match[1].toLowerCase();
    if (!KINDS.has(kind)) continue;

    quote.classList.add('callout');
    quote.dataset.kind = kind;

    const title = document.createElement('div');
    title.className = 'callout-title';
    title.textContent = kind;
    quote.prepend(title);

    // Drop the marker, keeping any text that followed it on the same line.
    const rest = match[2].trim();
    if (rest) {
      // Re-render the remainder so inline markup on that line survives.
      const holder = document.createElement('div');
      sanitizeInto(md.renderInline(rest), holder);
      first.replaceChildren(...holder.childNodes);
    } else {
      first.remove();
    }
  }
}

function collectHeadings(root: Element): Heading[] {
  const headings: Heading[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const anchor = el.querySelector('.heading-anchor');
    const text = [...el.childNodes]
      .filter((n) => n !== anchor)
      .map((n) => n.textContent)
      .join('')
      .trim();
    if (!el.id) el.id = slugifyHeading(text);
    headings.push({ id: el.id, level: Number(el.tagName[1]), text });
  }
  return headings;
}

export { slugifyHeading, languageLabel };
