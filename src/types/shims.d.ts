/**
 * Declarations for the two markdown-it plugins that ship no types.
 *
 * Both are small, stable and unlikely to change signature; the alternative is
 * `any` at the call site, which would quietly disable checking of the options
 * objects we pass them. `markdown-it` types `.use()` as accepting any
 * `(md, ...params) => void`, so these match that shape rather than importing a
 * PluginSimple/PluginWithOptions helper, which markdown-it 15 does not export.
 */

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const footnotePlugin: (md: MarkdownIt) => void;
  export default footnotePlugin;
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  interface TaskListsOptions {
    /** Leave the checkboxes interactive. False for a read-only reader. */
    enabled?: boolean;
    /** Wrap the item text in a <label> so the checkbox has an accessible name. */
    label?: boolean;
    labelAfter?: boolean;
  }
  const taskListsPlugin: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default taskListsPlugin;
}

declare module 'markdown-it-front-matter' {
  import type MarkdownIt from 'markdown-it';
  const frontMatterPlugin: (md: MarkdownIt, callback: (text: string) => void) => void;
  export default frontMatterPlugin;
}
