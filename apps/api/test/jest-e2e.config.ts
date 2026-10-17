import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testTimeout: 30_000,
  // These suites share one database, so they must not run in parallel workers.
  maxWorkers: 1,
  // Proves the project is reachable before any suite runs, so a paused or removed Supabase
  // project reports itself once instead of as dozens of unrelated timeouts (D78).
  globalSetup: '<rootDir>/test/helpers/preflight.ts',
  // Test settings only, and a refusal to run against production (F1, D101).
  setupFiles: ['<rootDir>/test/helpers/test-env.ts'],
};

export default config;
