import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testTimeout: 30_000,
  // These suites share one live Supabase project, so they must not run in parallel workers.
  maxWorkers: 1,
};

export default config;
