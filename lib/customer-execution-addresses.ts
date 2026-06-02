export type CustomerExecutionAddressInput = {
  customerId?: string | null;
  userId?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  country?: string | null;
};

const compact = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKeyPart = (value?: string | null) =>
  compact(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/strasse|straße|str\./g, "str")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function normalizeExecutionAddress(input: CustomerExecutionAddressInput) {
  const customerId = compact(input.customerId);
  const siteAddress = compact(input.siteAddress);
  const sitePlz = compact(input.sitePlz);
  const siteCity = compact(input.siteCity);

  if (!customerId || !siteAddress || !sitePlz || !siteCity) return null;

  return {
    customerId,
    userId: compact(input.userId) || null,
    siteName: compact(input.siteName) || null,
    siteAddress,
    sitePlz,
    siteCity,
    siteNote: compact(input.siteNote) || null,
    country: compact(input.country) || "CH",
  };
}

export function executionAddressIdentityKey(input: CustomerExecutionAddressInput): string {
  const normalized = normalizeExecutionAddress(input);
  if (!normalized) return "";
  return [
    normalizeKeyPart(normalized.siteAddress),
    normalizeKeyPart(normalized.sitePlz),
    normalizeKeyPart(normalized.siteCity),
  ].join("|");
}

export async function rememberCustomerExecutionAddress(
  prisma: any,
  input: CustomerExecutionAddressInput,
): Promise<any | null> {
  const normalized = normalizeExecutionAddress(input);
  if (!normalized) return null;

  const table = prisma?.customerExecutionAddress;
  if (!table) return null;

  const existingRows = await table.findMany({
    where: {
      customerId: normalized.customerId,
      deletedAt: null,
    },
    orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });

  const key = executionAddressIdentityKey(normalized);
  const existing = existingRows.find(
    (row: any) => executionAddressIdentityKey(row) === key,
  );

  if (existing) {
    return table.update({
      where: { id: existing.id },
      data: {
        siteName: existing.siteName || normalized.siteName,
        siteNote: normalized.siteNote || existing.siteNote,
        country: normalized.country || existing.country || "CH",
        userId: existing.userId || normalized.userId,
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  return table.create({
    data: {
      customerId: normalized.customerId,
      userId: normalized.userId,
      siteName: normalized.siteName,
      siteAddress: normalized.siteAddress,
      sitePlz: normalized.sitePlz,
      siteCity: normalized.siteCity,
      siteNote: normalized.siteNote,
      country: normalized.country,
      usageCount: 1,
      lastUsedAt: new Date(),
    },
  });
}

export async function rememberExecutionAddressesFromOrder(
  prisma: any,
  params: {
    userId?: string | null;
    order: any;
  },
): Promise<number> {
  const order = params.order;
  const customerId = compact(order?.customerId);
  if (!customerId) return 0;

  const seen = new Set<string>();
  let saved = 0;

  const remember = async (input: CustomerExecutionAddressInput) => {
    const key = executionAddressIdentityKey({ ...input, customerId });
    if (!key || seen.has(key)) return;
    seen.add(key);
    const row = await rememberCustomerExecutionAddress(prisma, {
      ...input,
      customerId,
      userId: params.userId || order?.userId || null,
    });
    if (row) saved += 1;
  };

  if (order?.siteAddressDifferent) {
    await remember({
      siteName: order?.siteName,
      siteAddress: order?.siteAddress,
      sitePlz: order?.sitePlz,
      siteCity: order?.siteCity,
      siteNote: order?.siteNote,
    });
  }

  const workSites = Array.isArray(order?.workSites) ? order.workSites : [];
  for (const site of workSites) {
    await remember({
      siteName: site?.siteName,
      siteAddress: site?.siteAddress,
      sitePlz: site?.sitePlz,
      siteCity: site?.siteCity,
      siteNote: site?.siteNote,
    });
  }

  return saved;
}
