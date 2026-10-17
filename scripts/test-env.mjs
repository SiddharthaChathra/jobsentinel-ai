// Starts the local Supabase test stack and writes apps/api/.env.test from it (F1, D101).
//
//   node scripts/test-env.mjs            start the stack (if needed) and write .env.test
//   node scripts/test-env.mjs --no-start only write .env.test from a running stack
//
// The local stack's keys are generated per machine and only work against 127.0.0.1, but they
// are still credentials: .env.test is git-ignored (.env.*) and never printed here.
import { execFileSync, execSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Windows resolves `npx` to npx.cmd, which Node runs only through a shell. Every argument here
// is a constant from this file, so the command line is built from known-safe tokens only.
const supabase = (...args) => {
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  if (process.platform !== 'win32') {
    return execFileSync('npx', ['--yes', 'supabase', ...args], options);
  }
  if (!args.every((a) => /^[\w.,=-]+$/.test(a))) throw new Error(`unsafe argument in ${args}`);
  return execSync(['npx', '--yes', 'supabase', ...args].join(' '), options);
};

if (!process.argv.includes('--no-start')) {
  // The API verifies tokens against the JWKS with ES256, as in production, so the stack must
  // sign with an asymmetric key. Generated once per checkout; git-ignored.
  const keyFile = resolve(root, 'supabase/signing_keys.json');
  if (!existsSync(keyFile)) {
    // Generated here rather than with `supabase gen signing-key`: that command reads config.toml,
    // which already points at this file, and fails while it does not exist yet.
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = {
      ...privateKey.export({ format: 'jwk' }),
      kid: randomUUID(),
      use: 'sig',
      key_ops: ['sign', 'verify'],
      alg: 'ES256',
      ext: true,
    };
    writeFileSync(keyFile, JSON.stringify([jwk], null, 2));
  }
  supabase(
    'start',
    // Not needed by the API or the tests; skipping them keeps a CI run fast and small.
    '-x',
    'realtime,studio,imgproxy,edge-runtime,logflare,vector,postgres-meta,mailpit,supavisor',
  );
}

const status = {};
for (const line of supabase('status', '-o', 'env').split(/\r?\n/)) {
  const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) status[m[1]] = m[2];
}
const need = (key, ...alts) => {
  for (const k of [key, ...alts]) if (status[k]) return status[k];
  throw new Error(`supabase status did not report ${key}; is the stack running?`);
};

// The production project's ref, so the guard can name it when refusing it. Read from the root
// .env (whose SUPABASE_URL is production) or the environment; it is an identifier, not a secret.
const rootEnv = existsSync(resolve(root, '.env'))
  ? readFileSync(resolve(root, '.env'), 'utf8')
  : '';
const prodUrl = process.env.PRODUCTION_SUPABASE_URL ?? /^SUPABASE_URL=(.*)$/m.exec(rootEnv)?.[1];
const prodRef =
  process.env.PRODUCTION_SUPABASE_REF ??
  /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(prodUrl ?? '')?.[1] ??
  '';

const api = need('API_URL');
const db = need('DB_URL');
const lines = [
  '# Written by scripts/test-env.mjs for the LOCAL Supabase test stack (D101). Do not edit by hand.',
  'NODE_ENV=test',
  `DATABASE_URL=${db}`,
  `DATABASE_DIRECT_URL=${db}`,
  `SUPABASE_URL=${api}`,
  `SUPABASE_ANON_KEY=${need('ANON_KEY', 'PUBLISHABLE_KEY')}`,
  `SUPABASE_SERVICE_ROLE_KEY=${need('SERVICE_ROLE_KEY', 'SECRET_KEY')}`,
  `SUPABASE_JWT_ISSUER=${api}/auth/v1`,
  `PRODUCTION_SUPABASE_REF=${prodRef}`,
  'RESUME_BUCKET=resumes',
  'ALLOWED_SIGNUP_EMAILS=*',
  // No real outbound services from tests: no bot token, no AI key, no polling.
  'TELEGRAM_POLLING=false',
  'LOG_LEVEL=warn',
  '',
];
writeFileSync(resolve(root, 'apps/api/.env.test'), lines.join('\n'));
console.warn(
  `apps/api/.env.test written for ${api}${prodRef ? ` (production ${prodRef} refused)` : ''}`,
);
