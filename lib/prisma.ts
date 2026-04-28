import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasourceUrl: process.env.DATABASE_URL,
  });

  // Middleware: retry once on connection errors (idle-session-timeout, pool exhaustion)
  client.$use(async (params: any, next: any) => {
    try {
      return await next(params);
    } catch (error: any) {
      const retryableCodes = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'];
      if (retryableCodes.includes(error?.code)) {
        console.warn(`[Prisma] Retrying ${params.model}.${params.action} after ${error.code}`);
        // Small delay before retry to let pool recover
        await new Promise(r => setTimeout(r, 500));
        try {
          return await next(params);
        } catch (retryError) {
          throw retryError;
        }
      }
      throw error;
    }
  });

  return client;
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

// Always cache — critical for production standalone builds to avoid pool exhaustion
globalForPrisma.prisma = prisma;
