export type DocumentCustomerSnapshot = {
  id?: string | null;
  customerNumber?: string | null;
  name: string;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type SnapshotDocumentKind = "offer" | "invoice";

const OFFER_SNAPSHOT_STATUSES = new Set(["Gesendet", "Abgelehnt"]);
const INVOICE_SNAPSHOT_STATUSES = new Set([
  "Gesendet",
  "Überfällig",
  "Bezahlt",
  "Erledigt",
]);

const clean = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

export function isCustomerSnapshotStatus(
  kind: SnapshotDocumentKind,
  status: unknown,
): boolean {
  const value = String(status ?? "").trim();
  return kind === "offer"
    ? OFFER_SNAPSHOT_STATUSES.has(value)
    : INVOICE_SNAPSHOT_STATUSES.has(value);
}

export function buildDocumentCustomerSnapshot(
  customer: any,
): DocumentCustomerSnapshot {
  return {
    id: clean(customer?.id),
    customerNumber: clean(customer?.customerNumber),
    name: clean(customer?.name) || "",
    address: clean(customer?.address),
    plz: clean(customer?.plz),
    city: clean(customer?.city),
    country: clean(customer?.country),
    phone: clean(customer?.phone),
    email: clean(customer?.email),
  };
}

export function parseDocumentCustomerSnapshot(
  value: unknown,
): DocumentCustomerSnapshot | null {
  if (!value) return null;

  let source: any = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const name = clean(source.name);
  if (!name) return null;

  return {
    id: clean(source.id),
    customerNumber: clean(source.customerNumber),
    name,
    address: clean(source.address),
    plz: clean(source.plz),
    city: clean(source.city),
    country: clean(source.country),
    phone: clean(source.phone),
    email: clean(source.email),
  };
}

export function resolveDocumentCustomer(
  document: any,
  kind: SnapshotDocumentKind,
): any {
  if (!isCustomerSnapshotStatus(kind, document?.status)) {
    return document?.customer ?? null;
  }

  return (
    parseDocumentCustomerSnapshot(document?.customerSnapshot) ??
    document?.customer ??
    null
  );
}

export function withDocumentCustomerSnapshot<T extends Record<string, any>>(
  document: T,
  kind: SnapshotDocumentKind,
): T {
  return {
    ...document,
    customer: resolveDocumentCustomer(document, kind),
  };
}

export const DOCUMENT_CUSTOMER_SELECT = {
  id: true,
  customerNumber: true,
  name: true,
  address: true,
  plz: true,
  city: true,
  country: true,
  phone: true,
  email: true,
} as const;
