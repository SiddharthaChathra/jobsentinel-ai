#!/usr/bin/env node
// Checks every URL in the curated learning-links map (F7, D120): each must answer 200 after
// redirects and stay on the same site. Manual (`pnpm links:check`) — CI makes no network calls.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../packages/config/src/taxonomy/learning-links.json');
const map = JSON.parse(readFileSync(file, 'utf8'));

const site = (u) => new URL(u).hostname.split('.').slice(-2).join('.');
let failed = 0;
for (const [skill, entry] of Object.entries(map.skills)) {
  for (const link of entry.links) {
    let line;
    try {
      const res = await fetch(link.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'JobSentinel link check (manual)' },
      });
      const sameSite = site(res.url) === site(link.url);
      const ok = res.status === 200 && sameSite;
      if (!ok) failed++;
      line = `${ok ? 'OK  ' : 'FAIL'} ${res.status} ${skill}: ${link.url}${res.url !== link.url ? ` -> ${res.url}` : ''}${sameSite ? '' : ' (left the site)'}`;
    } catch (err) {
      failed++;
      line = `FAIL --- ${skill}: ${link.url} (${err instanceof Error ? err.message : String(err)})`;
    }
    console.warn(line);
  }
}
console.warn(failed === 0 ? '\nAll links answer 200.' : `\n${failed} link(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
