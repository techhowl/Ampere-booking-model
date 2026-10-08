import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Two projects:
 *
 *   unit — pure logic, no I/O. Milliseconds. This is where the Juspay status
 *          resolution lives.
 *   db   — anything touching transactions or row locking, against a real
 *          Postgres in a throwaway container. Named *.db.test.ts.
 *
 * `pnpm test` runs both.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.db.test.ts'],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'db',
          environment: 'node',
          include: ['src/**/*.db.test.ts'],
          globalSetup: ['./test/postgres-global-setup.ts'],
          // Pulling an image and applying migrations takes a moment.
          testTimeout: 60_000,
          hookTimeout: 180_000,
          // Concurrency tests deliberately contend for the same rows. Let them
          // contend with each other only inside a file, never across files —
          // one fork, files in sequence, all sharing the one container.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
