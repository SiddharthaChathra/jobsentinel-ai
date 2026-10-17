import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { assertTestTarget } from '@jobsentinel/config';

/**
 * Loaded before every e2e suite and by the preflight (F1, D101). Tests read `apps/api/.env.test`
 * and nothing else: `.env` holds production settings and real bot/AI keys, so loading it here
 * once let a test write into production. Without `.env.test` the database suites skip
 * themselves, as before. Any database still configured must be local or the named test project.
 */
const file = resolve(__dirname, '../../.env.test');
if (existsSync(file)) config({ path: file, override: true, quiet: true });
assertTestTarget(process.env);
