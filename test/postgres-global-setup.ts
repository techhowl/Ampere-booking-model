import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

/**
 * A throwaway Postgres for the tests that touch transactions and row locks.
 *
 * These cannot be mocked and be worth anything: the behaviour under test IS
 * Postgres' behaviour — SELECT ... FOR UPDATE blocking a second transaction,
 * and a UNIQUE constraint rejecting a duplicate order_id. A fake would pass
 * while production oversold.
 *
 * The container is separate from the docker-compose database on purpose, so a
 * test run never touches a developer's local data.
 */

let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: TestProject) {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ampere_buy_test')
    .withUsername('ampere')
    .withPassword('test')
    .start();

  const databaseUrl = `${container.getConnectionUri()}?schema=public`;

  // Apply the real migrations, not `db push`. The tests should run against the
  // same SQL that production will.
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
