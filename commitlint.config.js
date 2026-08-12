/**
 * Commit messages decide the version number, so they have to stay parseable.
 * Conventional Commits, checked in CI on every pull request.
 *
 *   feat: …            → minor    (0.3.0 → 0.4.0)
 *   fix: / perf: …     → patch    (0.3.0 → 0.3.1)
 *   feat!: …           → major    (0.3.0 → 1.0.0)
 *   docs: / chore: …   → no release
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // semantic-release writes its own release commit with the full notes in the
    // body, which would trip the default line-length caps.
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    // Scopes are a hint, not a gate — warn on anything unfamiliar.
    'scope-enum': [
      1,
      'always',
      [
        'main',
        'renderer',
        'markdown',
        'mermaid',
        'sidebar',
        'outline',
        'tabs',
        'find',
        'prefs',
        'theme',
        'watcher',
        'config',
        'updates',
        'packaging',
        'deps',
        'release',
      ],
    ],
  },
};
