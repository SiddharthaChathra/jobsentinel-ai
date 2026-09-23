#!/usr/bin/env node
/**
 * Guards against OneDrive "Files On-Demand" silently shrinking the test suite (D71).
 *
 * A dehydrated (cloud-only) file keeps FILE_ATTRIBUTE_REPARSE_POINT set even after it is read back,
 * and Node's `readdir` reports such an entry as a symlink. jest-haste-map skips symlinks, so those
 * files are never collected: `pnpm test` reports all green while whole suites are missing. This was
 * found live — 69 validation tests and the notification formatter suite had stopped running.
 *
 * Linux and macOS have no such thing, so this is a no-op off Windows.
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.turbo']);

if (process.platform !== 'win32') process.exit(0);

const tracked = new Set(
  execSync('git ls-files', { cwd: root, maxBuffer: 1e8 })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((p) => join(root, p.replaceAll('/', sep))),
);

/** @type {string[]} */
const hidden = [];

/** @param {string} dir */
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isSymbolicLink() && tracked.has(full)) hidden.push(full);
  }
}
walk(root);

if (hidden.length === 0) process.exit(0);

console.error(
  `\n${hidden.length} tracked file(s) are OneDrive placeholders and are INVISIBLE to Jest:\n` +
    hidden.map((f) => '  ' + relative(root, f)).join('\n') +
    '\n\nThe test run would pass while skipping them. To fix, open each in an editor and save it,' +
    '\nor right-click the folder in Explorer and choose "Always keep on this device", then re-run.\n',
);
process.exit(1);
