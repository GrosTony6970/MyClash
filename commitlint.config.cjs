/**
 * Conventional Commits enforcement for MyClash.
 * Wired into the `commit-msg` git hook via `simple-git-hooks` (see package.json).
 * Adopted standard — see _bmad-output/project-context.md ("Adopted Standards").
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow detailed multi-line bodies and long trailers (e.g. Co-Authored-By, URLs).
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
  },
};
