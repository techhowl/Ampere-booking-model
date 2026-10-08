import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client per process. Next.js dev reloads modules on every edit, so
 * without the global cache each reload opens a fresh connection pool and
 * Postgres runs out of connections within a few minutes of editing.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
