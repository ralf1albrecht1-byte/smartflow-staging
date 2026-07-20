import { prisma } from '@/lib/prisma';

export const DATA_SCOPE_TEST = 'TEST' as const;
export const DATA_SCOPE_LIVE = 'LIVE' as const;
export type DataScope = typeof DATA_SCOPE_TEST | typeof DATA_SCOPE_LIVE;

export function dataScopeFromTestMode(testModus: boolean | null | undefined): DataScope {
  return testModus === false ? DATA_SCOPE_LIVE : DATA_SCOPE_TEST;
}

export async function getActiveDataScope(userId: string, db: any = prisma): Promise<DataScope> {
  const settings = await db.companySettings.findFirst({
    where: { userId },
    select: { testModus: true },
  });
  return dataScopeFromTestMode(settings?.testModus);
}

export function isDataScope(value: unknown): value is DataScope {
  return value === DATA_SCOPE_TEST || value === DATA_SCOPE_LIVE;
}

export function scopeLabel(scope: DataScope): string {
  return scope === DATA_SCOPE_LIVE ? 'LIVE' : 'TEST';
}
