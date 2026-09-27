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
import { readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
    hidden.map((f) => '  ' + relative(root, f)).join('\n'),
);

if (!process.argv.includes('--fix')) {
  console.error(
    '\nThe test run would pass while skipping them.' +
      '\nRun `pnpm fix:files` to rewrite them as ordinary local files, then re-run.\n',
  );
  process.exit(1);
}

// Reading the file hydrates it but leaves the reparse-point attribute set, and that attribute is
// what `readdir` reports as a symlink. Writing the bytes to a temp name and renaming over the
// original replaces the directory entry itself, which is the only thing that clears it.
let fixed = 0;
for (const file of hidden) {
  const bytes = readFileSync(file);
  if (bytes.length === 0) {
    console.error(`  skipped (empty, refusing to rewrite): ${relative(root, file)}`);
    continue;
  }
  const tmp = `${file}.onedrive-fix`;
  writeFileSync(tmp, bytes);
  if (readFileSync(tmp).length !== bytes.length) {
    unlinkSync(tmp);
    console.error(`  skipped (copy mismatch): ${relative(root, file)}`);
    continue;
  }
  renameSync(tmp, file);
  fixed++;
}
console.error(`\nrewrote ${fixed} file(s) in place, byte for byte. Re-run the tests.\n`);
process.exit(fixed === hidden.length ? 0 : 1);
