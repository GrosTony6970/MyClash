/**
 * The path a checked-in ESLint baseline is keyed by: `apps/<app>/app/...` or
 * `apps/<app>/src/...`, from the repo root.
 *
 * Neither of the paths ESLint hands a rule is that. Each app lints itself
 * (`"lint": "eslint app src"` in all three package.json files), so the cwd is
 * the APP directory, and `context.filename` arrives either absolute or relative
 * to it. A baseline living in eslint-rules/ is shared by all three apps, so it
 * has to be keyed by a path that names the app — otherwise
 * `app/admin/page.tsx` means three different files.
 *
 * `cwd` is a parameter only so the tests can drive it; production callers pass
 * nothing and get `process.cwd()`.
 */
export function repoRelativeFilename(filename, cwd = process.cwd()) {
  const normalized = filename.replace(/\\/g, '/');
  const cleaned = normalized.replace(/^\.\//, '');
  if (cleaned.startsWith('app/') || cleaned.startsWith('src/')) {
    const normalizedCwd = cwd.replace(/\\/g, '/');
    const appsIndex = normalizedCwd.indexOf('/apps/');
    if (appsIndex >= 0) {
      return `${normalizedCwd.slice(appsIndex + 1)}/${cleaned}`;
    }
  }
  const appsIndex = normalized.indexOf('/apps/');
  return appsIndex >= 0 ? normalized.slice(appsIndex + 1) : normalized;
}
