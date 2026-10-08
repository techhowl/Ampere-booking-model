import path from 'node:path';
import { defineConfig } from 'prisma/config';

// A config file switches OFF Prisma's automatic .env loading, so we do it here.
// Without this, every prisma command sees an empty DATABASE_URL.
import 'dotenv/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
