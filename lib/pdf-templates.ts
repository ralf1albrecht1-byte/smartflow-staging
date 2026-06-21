// SMARTFLOW_V17_90L371I_PDF_POSITION_GROUPS_FIX
// SMARTFLOW_V17_90L339_INVOICE_PDF_META_AND_CONTACT_CHANNEL_FIX
import { getPositionTypeLabel, normalizePositionType } from "@/lib/position-types";

export type DocumentTemplate = "classic" | "modern" | "minimal" | "elegant";

export interface CompanyInfo {
  firmenname: string;
  firmaRechtlich?: string | null;
  ansprechpartner?: string | null;
  telefon?: string | null;
  telefon2?: string | null;
  email?: string | null;
  supportEmail?: string | null;
  webseite?: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  ort?: string | null;
  iban?: string | null;
  bank?: string | null;
  mwstAktiv?: boolean;
  mwstNummer?: string | null;
  mwstSatz?: number | null;
  mwstHinweis?: string | null;
  documentTemplate?: string | null;
  letterheadUrl?: string | null;
  letterheadName?: string | null;
  letterheadVisible?: boolean | null;
  // Legacy aliases from older clients/settings payloads.
  logoUrl?: string | null;
  companyLogo?: string | null;
  companyLogoUrl?: string | null;
  logoVisible?: boolean | null;
  showLogo?: boolean | null;
  currency?: string | null;
}

const DEFAULT_COMPANY: CompanyInfo = {
  firmenname: "Mein Unternehmen",
  ansprechpartner: "Ralf Albrecht",
  strasse: "Schartenstrasse",
  hausnummer: "127",
  plz: "5430",
  ort: "Wettingen",
  email: "smiley.albi@web.de",
};
const getCurrency = (c?: CompanyInfo | null): "CHF" | "EUR" =>
  c?.currency === "EUR" ? "EUR" : "CHF";

const roundMoneyForPdf = (amount: number): number =>
  Math.round((Number(amount ?? 0) + Number.EPSILON) * 100) / 100;

const formatMoney = (amount: number, c?: CompanyInfo | null) =>
  `${getCurrency(c)} ${roundMoneyForPdf(amount).toFixed(2)}`;
const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const OFFER_PDF_META_PREFIX = "[[SMARTFLOW_OFFER_PDF_V1]]";

type OfferPdfMeta = {
  title: string;
  text: string;
};

function decodeOfferPdfMeta(value: unknown): OfferPdfMeta {
  const raw = String(value ?? "").trim();
  if (!raw) return { title: "", text: "" };
  if (!raw.startsWith(OFFER_PDF_META_PREFIX)) {
    return { title: "", text: raw };
  }
  try {
    const parsed = JSON.parse(raw.slice(OFFER_PDF_META_PREFIX.length));
    return {
      title: String(parsed?.title ?? "").trim(),
      text: String(parsed?.text ?? "").trim(),
    };
  } catch {
    return { title: "", text: raw };
  }
}

function renderOfferPdfTextBlock(offer: any): string {
  const raw = String(offer?.notes ?? "").trim();
  // V17.90L61: Only text explicitly entered in the dedicated offer-PDF fields
  // may appear in the customer PDF. Legacy/plain notes can contain generated
  // service summaries or internal order text and must not become a Bemerkungen
  // block automatically.
  if (!raw.startsWith(OFFER_PDF_META_PREFIX)) return "";
  const meta = decodeOfferPdfMeta(raw);
  if (!meta.title && !meta.text) return "";
  const body = meta.text ? meta.text.replace(/\n/g, "<br/>") : "";
  if (meta.title) {
    return `<div class="notes"><strong>${meta.title}</strong>${body ? `<br/>${body}` : ""}</div>`;
  }
  return `<div class="notes">${body}</div>`;
}

type InvoicePdfMeta = {
  title: string;
  text: string;
};

const INVOICE_PDF_META_PREFIX = "[[SMARTFLOW_INVOICE_PDF_V1]]";

function decodeInvoicePdfMeta(value: unknown): InvoicePdfMeta {
  const raw = String(value ?? "").trim();
  if (!raw) return { title: "", text: "" };

  // SMARTFLOW_V17_90L339: Rechnungs-Besonderheiten sind intern. Das
  // technische Meta-JSON darf nie im Kunden-PDF erscheinen. Nur explizite
  // PDF-Felder (pdfTitle/notes bzw. title/text) werden gerendert.
  if (raw.startsWith(INVOICE_PDF_META_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(INVOICE_PDF_META_PREFIX.length));
      return {
        title: String(parsed?.pdfTitle ?? parsed?.title ?? "").trim(),
        text: String(parsed?.notes ?? parsed?.text ?? "").trim(),
      };
    } catch {
      return { title: "", text: "" };
    }
  }

  const marker = "Titel: ";
  if (!raw.startsWith(marker)) return { title: "", text: raw };
  const [firstLine, ...rest] = raw.split(/\r?\n/);
  return {
    title: firstLine.slice(marker.length).trim(),
    text: rest.join("\n").trim(),
  };
}

function renderInvoicePdfTextBlock(invoice: any): string {
  const meta = decodeInvoicePdfMeta(invoice?.notes);
  if (!meta.title && !meta.text) return "";
  const body = meta.text ? meta.text.replace(/\n/g, "<br/>") : "";
  if (meta.title) {
    return `<div class="notes"><strong>${meta.title}</strong>${body ? `<br/>${body}` : ""}</div>`;
  }
  return `<div class="notes">${body}</div>`;
}

const offerDocumentStyles = `
  body.offer-document { box-sizing: border-box; padding-bottom: 34px !important; }
  body.offer-document .container,
  body.offer-document .wrap { padding-bottom: 34px !important; }
  body.offer-document .footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0 !important;
    padding-top: 8px !important;
    background: white;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  body.offer-document .notes,
  body.offer-document .execution-address {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  body.offer-document .execution-address {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(100, 116, 139, 0.24);
  }
  body.offer-document .execution-address-title {
    margin: 0 0 5px 0;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  body.offer-document .execution-address p { margin: 2px 0; }

  /* Offer pages are intentionally slightly tighter so a footer never becomes
     the only content on a second page. Invoice layouts remain unchanged. */
  body.offer-document .brand { padding-bottom: 10px; margin-bottom: 14px; }
  body.offer-document .brand .logo { margin-bottom: 6px; }
  body.offer-document .center-title { margin: 6px 0 18px 0; }
  body.offer-document .two-col { margin-bottom: 18px; }
  body.offer-document table { margin-bottom: 14px; }
  body.offer-document th { padding-top: 8px; padding-bottom: 8px; }
  body.offer-document td { padding-top: 7px; padding-bottom: 7px; }
  body.offer-document .totals-row { padding-top: 5px; padding-bottom: 5px; }
  body.offer-document .notes { margin-top: 18px; padding-top: 11px; padding-bottom: 11px; }
  body.offer-document .offer-page-break {
    break-before: page;
    page-break-before: always;
  }
  body.offer-document .offer-continuation-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 0 0 10px 0;
    margin-bottom: 12px;
    border-bottom: 1px solid rgba(100, 116, 139, 0.32);
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  body.offer-document .offer-continuation-brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }
  body.offer-document .offer-continuation-logo {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }
  body.offer-document .offer-continuation-logo img {
    max-height: 40px !important;
    max-width: 110px !important;
  }
  body.offer-document .offer-continuation-company {
    min-width: 0;
    font-size: 8.5px;
    line-height: 1.35;
    color: #64748b;
  }
  body.offer-document .offer-continuation-company strong {
    display: block;
    color: #1f2937;
    font-size: 10px;
  }
  body.offer-document .offer-continuation-meta {
    flex: 0 0 auto;
    text-align: right;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 8.5px;
    line-height: 1.45;
    color: #64748b;
  }
  body.offer-document .offer-continuation-meta strong {
    display: block;
    color: #1f2937;
    font-size: 10px;
  }
  body.offer-document .offer-continuation-title {
    margin: 0 0 9px 0;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #64748b;
  }
  body.offer-document .offer-summary-clear { clear: both; }
  body.offer-document .offer-summary-clear::after {
    content: '';
    display: block;
    clear: both;
  }
  @media print {
    body.offer-document thead { display: table-header-group; }
    body.offer-document tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

function pickTemplate(company?: CompanyInfo | null): DocumentTemplate {
  const raw = (company?.documentTemplate || "").toLowerCase();
  if (raw === "modern" || raw === "minimal" || raw === "elegant")
    return raw as DocumentTemplate;
  return "classic";
}

// ──────────────────────────────────────────────────────────────────────────────
// CLASSIC TEMPLATE — BYTE-IDENTICAL to the previous single-template implementation.
// Any change here must be mirrored in the visual identity of existing documents.
// Do NOT refactor the HTML below without explicit approval.
// ──────────────────────────────────────────────────────────────────────────────

const classicStyles = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.5; margin: 0; padding: 0; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .company { text-align: right; color: #555; font-size: 10px; line-height: 1.8; }
  .company-name { font-size: 16px; font-weight: bold; color: #059669; }
  .doc-title { font-size: 22px; font-weight: bold; color: #059669; margin-bottom: 5px; }
  .doc-number { font-size: 13px; color: #555; margin-bottom: 20px; }
  .customer-box { background: #f8faf9; padding: 15px; border-radius: 6px; margin-bottom: 30px; }
  .customer-box p { margin: 2px 0; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 25px; }
  .meta-item { font-size: 10px; }
  .meta-label { color: #888; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
  th { background: #059669; color: white; padding: 10px 8px; text-align: left; font-size: 10px; font-weight: 600; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 10px; }
  tr:nth-child(even) td { background: #fafafa; }
  .totals { float: right; width: 250px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 11px; }
  .totals-row.total { border-top: 2px solid #059669; font-weight: bold; font-size: 13px; margin-top: 5px; padding-top: 10px; color: #059669; }
  .notes { clear: both; margin-top: 40px; padding: 15px; background: #f8faf9; border-radius: 6px; font-size: 10px; }
  .footer { margin-top: 50px; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 15px; }
  .bank-info { clear: both; margin-top: 20px; font-size: 10px; color: #555; }
`;

function buildClassicCompanyBlock(c: CompanyInfo): string {
  const addrLine = [c.strasse, c.hausnummer].filter(Boolean).join(" ");
  const plzLine = [c.plz, c.ort].filter(Boolean).join(" ");
  const showLogo = letterheadVisible(c);
  return `
  <div class="company">
    ${
      showLogo
        ? `<div style="margin-bottom:6px;">${letterheadImg(c, "lg")}</div>`
        : `<div class="company-name">${c.firmenname || ""}</div>`
    }
    ${c.ansprechpartner ? `<div>${c.ansprechpartner}</div>` : ""}
    ${addrLine ? `<div>${addrLine}</div>` : ""}
    ${plzLine ? `<div>${plzLine}, Schweiz</div>` : ""}
    ${c.email ? `<div>${c.email}</div>` : ""}
    ${c.telefon ? `<div>Tel. ${c.telefon}${c.telefon2 ? ` / ${c.telefon2}` : ""}</div>` : ""}
    ${c.mwstAktiv && c.mwstNummer ? `<div>${c.mwstNummer}</div>` : ""}
  </div>`;
}

function buildClassicFooterBlock(c: CompanyInfo): string {
  const addrLine = [c.strasse, c.hausnummer].filter(Boolean).join(" ");
  const plzLine = [c.plz, c.ort].filter(Boolean).join(" ");
  const parts = [
    c.firmenname,
    c.ansprechpartner,
    [addrLine, plzLine].filter(Boolean).join(", "),
    c.email,
  ].filter(Boolean);
  return `<div class="footer">${parts.join(" &middot; ")}</div>`;
}

function buildClassicBankBlock(c: CompanyInfo): string {
  if (!c.iban && !c.bank) return "";
  const parts: string[] = [];
  if (c.iban) parts.push(`IBAN: ${c.iban}`);
  if (c.bank) parts.push(`Bank: ${c.bank}`);
  return `<div class="bank-info"><strong>Bankverbindung:</strong> ${parts.join(" &middot; ")}</div>`;
}

function buildClassicMwstNote(c: CompanyInfo): string {
  if (c.mwstAktiv) return "";
  const hint = c.mwstHinweis || "Nicht MWST-pflichtig";
  return `<div style="font-size:9px;color:#888;margin-top:5px;">${hint}</div>`;
}

function renderClassicInvoice(invoice: any, c: CompanyInfo): string {
  const items = invoice?.items ?? [];
  const itemsHtml = buildItemsRows(items, c);
  const customer = invoice?.customer ?? {};
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;

  return `<!DOCTYPE html><html><head><style>${classicStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    <div class="header">
      <div>
        <div class="doc-title">Rechnung</div>
        <div class="doc-number">${invoice?.invoiceNumber ?? ""}</div>
      </div>
      ${buildClassicCompanyBlock(c)}
    </div>
    <div class="customer-box">
      <p><strong>${customer?.name ?? ""}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ""}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
      ${renderInvoiceExecutionAddress(invoice)}
    </div>
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Rechnungsdatum:</span> ${formatDate(invoice?.invoiceDate)}</div>
      <div class="meta-item"><span class="meta-label">Zahlungsziel:</span> ${formatDate(invoice?.dueDate)}</div>
    </div>
    <table>
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Netto</span><span>${formatMoney(Number(invoice?.subtotal ?? 0), c)}</span></div>

 ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatMoney(Number(invoice?.vatAmount ?? 0), c)}</span></div>` : ""}

      <div class="totals-row total"><span>Total</span><span>${formatMoney(Number(invoice?.total ?? 0), c)}</span></div>
    </div>
    ${buildClassicBankBlock(c)}
    ${buildClassicMwstNote(c)}
    ${renderInvoicePdfTextBlock(invoice)}
    ${buildClassicFooterBlock(c)}
  </body></html>`;
}

function renderClassicOffer(offer: any, c: CompanyInfo): string {
  const customer = offer?.customer ?? {};

  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;

  const priceNote = c.mwstAktiv
    ? "Die Preise verstehen sich inkl. MwSt."
    : (c.mwstHinweis || "Nicht MWST-pflichtig") + ".";

  return `<!DOCTYPE html><html><head><style>${classicStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    <div class="header">
      <div>
        <div class="doc-title">Angebot</div>
        <div class="doc-number">${offer?.offerNumber ?? ""}</div>
      </div>
      ${buildClassicCompanyBlock(c)}
    </div>
    <div class="customer-box">
      <p><strong>${customer?.name ?? ""}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ""}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
      ${renderOfferExecutionAddress(offer)}
    </div>
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Angebotsdatum:</span> ${formatDate(offer?.offerDate)}</div>
      <div class="meta-item"><span class="meta-label">Gültig bis:</span> ${formatDate(offer?.validUntil)}</div>
    </div>
    ${renderOfferItemsAndSummary(offer, c, vatLabel, priceNote)}
    ${buildClassicFooterBlock(c)}
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS for new templates (modern/minimal/elegant)
// ──────────────────────────────────────────────────────────────────────────────

function addrLineHelper(c: CompanyInfo) {
  return [c.strasse, c.hausnummer].filter(Boolean).join(" ");
}
function plzLineHelper(c: CompanyInfo) {
  return [c.plz, c.ort].filter(Boolean).join(" ");
}
function buildCompanyLines(c: CompanyInfo): string[] {
  const lines: string[] = [];
  if (c.ansprechpartner) lines.push(c.ansprechpartner);
  const addrLine = addrLineHelper(c);
  if (addrLine) lines.push(addrLine);
  const plzLine = plzLineHelper(c);
  if (plzLine) lines.push(plzLine);
  if (c.telefon)
    lines.push(`Tel. ${c.telefon}${c.telefon2 ? ` / ${c.telefon2}` : ""}`);
  if (c.email) lines.push(c.email);
  if (c.webseite) lines.push(c.webseite);
  if (c.mwstAktiv && c.mwstNummer) lines.push(c.mwstNummer);
  return lines;
}
function cleanWorkSiteValue(value?: string | null): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getItemWorkSiteKey(item: any): string {
  return [item?.siteName, item?.siteAddress, item?.sitePlz, item?.siteCity]
    .map(cleanWorkSiteValue)
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function getItemWorkSiteLabel(item: any): string {
  const title = [item?.siteName, item?.siteAddress]
    .map(cleanWorkSiteValue)
    .filter(Boolean)
    .join(" · ");
  const cityLine = [item?.sitePlz, item?.siteCity]
    .map(cleanWorkSiteValue)
    .filter(Boolean)
    .join(" ");
  const note = cleanWorkSiteValue(item?.siteNote);
  return [title || "Ausführungsort", cityLine, note]
    .filter(Boolean)
    .join("<br/>");
}

function hasMultipleItemWorkSites(items: any[]): boolean {
  const keys = new Set((items || []).map(getItemWorkSiteKey).filter(Boolean));
  return keys.size > 1;
}

function normalizeAddressCompare(value: unknown): string {
  return cleanWorkSiteValue(String(value ?? ""))
    .toLocaleLowerCase("de-CH")
    .replace(/[^a-z0-9äöüß]+/g, "");
}

function getUniqueOfferWorkSites(offer: any): any[] {
  const unique = new Map<string, any>();
  for (const item of offer?.items ?? []) {
    const key = getItemWorkSiteKey(item);
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }
  return Array.from(unique.values());
}

function offerWorkSiteDiffersFromBilling(item: any, customer: any): boolean {
  const hasNameOrNote = Boolean(
    cleanWorkSiteValue(item?.siteName) || cleanWorkSiteValue(item?.siteNote),
  );
  const siteStreet = normalizeAddressCompare(item?.siteAddress);
  const billingStreet = normalizeAddressCompare(customer?.address);
  const sitePlace = normalizeAddressCompare(
    [item?.sitePlz, item?.siteCity].filter(Boolean).join(" "),
  );
  const billingPlace = normalizeAddressCompare(
    [customer?.plz, customer?.city].filter(Boolean).join(" "),
  );
  return (
    hasNameOrNote ||
    (siteStreet.length > 0 && siteStreet !== billingStreet) ||
    (sitePlace.length > 0 && sitePlace !== billingPlace)
  );
}

function getUniqueInvoiceWorkSites(invoice: any): any[] {
  const unique = new Map<string, any>();
  const candidates = [
    ...(Array.isArray(invoice?.items) ? invoice.items : []),
    ...(Array.isArray(invoice?.orders) ? invoice.orders : []),
  ];
  for (const candidate of candidates) {
    const key = getItemWorkSiteKey(candidate);
    if (!key || unique.has(key)) continue;
    unique.set(key, candidate);
  }
  return Array.from(unique.values());
}

function renderInvoiceExecutionAddress(invoice: any): string {
  const customer = invoice?.customer ?? {};
  const sites = getUniqueInvoiceWorkSites(invoice).filter((item) =>
    offerWorkSiteDiffersFromBilling(item, customer),
  );
  if (sites.length === 0) return "";

  const rows = sites
    .map((item, index) => {
      const name = cleanWorkSiteValue(item?.siteName);
      const street = cleanWorkSiteValue(item?.siteAddress);
      const place = [item?.sitePlz, item?.siteCity]
        .map(cleanWorkSiteValue)
        .filter(Boolean)
        .join(" ");
      const note = cleanWorkSiteValue(item?.siteNote);
      const title =
        name || (sites.length > 1 ? `Ausführungsort ${index + 1}` : "");
      return `
        <div${index > 0 ? ' style="margin-top:7px;"' : ""}>
          ${title ? `<p><strong>${title}</strong></p>` : ""}
          ${street ? `<p>${street}</p>` : ""}
          ${place ? `<p>${place}</p>` : ""}
          ${note && note !== name ? `<p>${note}</p>` : ""}
        </div>
      `;
    })
    .join("");

  return `<div class="execution-address"><div class="execution-address-title">Ausführungsadresse</div>${rows}</div>`;
}

function renderOfferExecutionAddress(offer: any): string {
  const customer = offer?.customer ?? {};
  const sites = getUniqueOfferWorkSites(offer).filter((item) =>
    offerWorkSiteDiffersFromBilling(item, customer),
  );
  if (sites.length === 0) return "";

  const rows = sites
    .map((item, index) => {
      const name = cleanWorkSiteValue(item?.siteName);
      const street = cleanWorkSiteValue(item?.siteAddress);
      const place = [item?.sitePlz, item?.siteCity]
        .map(cleanWorkSiteValue)
        .filter(Boolean)
        .join(" ");
      const note = cleanWorkSiteValue(item?.siteNote);
      const title = name || (sites.length > 1 ? `Ausführungsort ${index + 1}` : "");
      return `
        <div${index > 0 ? ' style="margin-top:7px;"' : ""}>
          ${title ? `<p><strong>${title}</strong></p>` : ""}
          ${street ? `<p>${street}</p>` : ""}
          ${place ? `<p>${place}</p>` : ""}
          ${note && note !== name ? `<p>${note}</p>` : ""}
        </div>
      `;
    })
    .join("");

  return `<div class="execution-address"><div class="execution-address-title">Ausführungsadresse</div>${rows}</div>`;
}

function buildPlainItemRow(item: any, c: CompanyInfo): string {
  return `
    <tr>
      <td>${item?.description ?? ""}</td>
      <td>${Number(item?.quantity ?? 0).toFixed(2)}</td>
      <td>${item?.unit ?? ""}</td>
      <td>${formatMoney(Number(item?.unitPrice ?? 0), c)}</td>
      <td>${formatMoney(Number(item?.totalPrice ?? 0), c)}</td>
    </tr>
  `;
}

function normalizePdfGroupText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPdfPositionGroupType(item: any): string {
  const rawType = normalizePositionType(item?.positionType);
  const label = normalizePdfGroupText(
    [item?.description, item?.serviceName].filter(Boolean).join(" "),
  );

  if (/\b(?:anfahrt|fahrtkosten|reisekosten|deplacement|travel|transport)\b/.test(label)) {
    return "expense";
  }

  if (rawType === "flat_fee") return "expense";
  return rawType;
}

function getPdfPositionGroupLabel(type: string): string {
  if (type === "expense") return "Anfahrt / Zusatzkosten";
  return getPositionTypeLabel(type);
}

function buildItemsRows(items: any[], c: CompanyInfo): string {
  const source = items || [];
  const renderTypeGroupedRows = (entries: any[]) => {
    const order = ["service", "expense", "material", "equipment", "disposal", "other"];
    const groups = new Map<string, any[]>();
    for (const item of entries) {
      const type = getPdfPositionGroupType(item);
      const bucket = groups.get(type) || [];
      bucket.push(item);
      groups.set(type, bucket);
    }
    return order
      .filter((type) => groups.has(type))
      .map((type) => {
        const label = getPdfPositionGroupLabel(type);
        const header = type === "service" && groups.size === 1
          ? ""
          : `<tr><td colspan="5" style="background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.45px;color:#475569;"><strong>${label}</strong></td></tr>`;
        return header + (groups.get(type) || []).map((item) => buildPlainItemRow(item, c)).join("");
      })
      .join("");
  };

  if (!hasMultipleItemWorkSites(source)) {
    return renderTypeGroupedRows(source);
  }

  const groups = new Map<string, { label: string; items: any[] }>();
  for (const item of source) {
    const key = getItemWorkSiteKey(item) || "without-site";
    if (!groups.has(key)) {
      groups.set(key, {
        label: getItemWorkSiteLabel(item),
        items: [],
      });
    }
    groups.get(key)!.items.push(item);
  }

  return Array.from(groups.values())
    .map((group, index) => {
      const siteTotal = group.items.reduce(
        (sum, item) => sum + Number(item?.totalPrice ?? 0),
        0,
      );
      const header = `
        <tr>
          <td colspan="5" style="background:#eefbf6;border-top:1px solid #b7e4cf;border-bottom:1px solid #b7e4cf;padding:9px 8px;text-align:left;">
            <strong>Ausführungsort ${index + 1}</strong><br/>
            <span style="font-size:9px;color:#475569;">${group.label}</span>
            <span style="float:right;font-size:9px;color:#475569;">${formatMoney(siteTotal, c)}</span>
          </td>
        </tr>
      `;
      return header + renderTypeGroupedRows(group.items);
    })
    .join("");
}

function resolveLetterheadUrl(c: CompanyInfo): string | null {
  return (
    c.letterheadUrl || c.logoUrl || c.companyLogo || c.companyLogoUrl || null
  );
}

function resolveLetterheadVisible(c: CompanyInfo): boolean {
  if (c.letterheadVisible !== undefined && c.letterheadVisible !== null) {
    return c.letterheadVisible !== false;
  }
  if (c.logoVisible !== undefined && c.logoVisible !== null) {
    return c.logoVisible !== false;
  }
  if (c.showLogo !== undefined && c.showLogo !== null) {
    return c.showLogo !== false;
  }
  return true;
}

function letterheadVisible(c: CompanyInfo): boolean {
  const resolvedUrl = resolveLetterheadUrl(c);
  const resolvedVisible = resolveLetterheadVisible(c);
  return !!resolvedUrl && resolvedVisible;
}
function letterheadImg(
  c: CompanyInfo,
  size: "sm" | "md" | "lg" = "md",
): string {
  const url = resolveLetterheadUrl(c);
  const show = letterheadVisible(c);
  if (!url || !show) {
    return "";
  }
  const h = size === "sm" ? "65px" : size === "lg" ? "145px" : "105px";
  return `<img src="${url}" alt="${c.firmenname || "Logo"}" style="max-height:${h};max-width:260px;object-fit:contain;" />`;
}


function renderOfferTableHead(): string {
  return `<thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>`;
}

function renderOfferContinuationHeader(
  offer: any,
  c: CompanyInfo,
  pageNumber: number,
  totalPages: number,
): string {
  const customerName = cleanWorkSiteValue(offer?.customer?.name) || "–";
  const companyAddress = [addrLineHelper(c), plzLineHelper(c)]
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="offer-continuation-header">
      <div class="offer-continuation-brand">
        ${letterheadVisible(c) ? `<div class="offer-continuation-logo">${letterheadImg(c, "sm")}</div>` : ""}
        <div class="offer-continuation-company">
          <strong>${c.firmenname || ""}</strong>
          ${companyAddress ? `<div>${companyAddress}</div>` : ""}
          ${c.telefon ? `<div>Tel. ${c.telefon}</div>` : ""}
        </div>
      </div>
      <div class="offer-continuation-meta">
        <strong>Angebot ${offer?.offerNumber ?? ""}</strong>
        <div>Kunde: ${customerName}</div>
        <div>Seite ${pageNumber} von ${totalPages}</div>
      </div>
    </div>
    <div class="offer-continuation-title">Leistungen – Fortsetzung</div>
  `;
}

function renderOfferTotalsAndNotes(
  offer: any,
  c: CompanyInfo,
  vatLabel: string,
  priceNote: string,
): string {
  return `
    <div class="offer-summary-clear">
      <div class="totals">
        <div class="totals-row"><span>Netto</span><span>${formatMoney(Number(offer?.subtotal ?? 0), c)}</span></div>
        ${Number(offer?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatMoney(Number(offer?.vatAmount ?? 0), c)}</span></div>` : ""}
        <div class="totals-row total"><span>Total</span><span>${formatMoney(Number(offer?.total ?? 0), c)}</span></div>
      </div>
    </div>
    ${renderOfferPdfTextBlock(offer)}
    <div class="notes"><strong>Hinweis:</strong> Dieses Angebot ist gültig bis ${formatDate(offer?.validUntil)}. ${priceNote}</div>
  `;
}

function renderOfferItemsAndSummary(
  offer: any,
  c: CompanyInfo,
  vatLabel: string,
  priceNote: string,
): string {
  const items = Array.isArray(offer?.items) ? offer.items : [];

  // A normal offer stays on one page. For long offers we deliberately reserve
  // enough content for the continuation page instead of leaving only one line
  // plus totals on page two.
  if (items.length <= 14) {
    return `
      <table>
        ${renderOfferTableHead()}
        <tbody>${buildItemsRows(items, c)}</tbody>
      </table>
      ${renderOfferTotalsAndNotes(offer, c, vatLabel, priceNote)}
    `;
  }

  const pageSize = 12;
  const chunks: any[][] = [];
  for (let index = 0; index < items.length; index += pageSize) {
    chunks.push(items.slice(index, index + pageSize));
  }
  const totalPages = chunks.length;

  return chunks
    .map((chunk, index) => {
      const pageNumber = index + 1;
      const isFirstPage = index === 0;
      const isLastPage = index === chunks.length - 1;
      return `
        ${isFirstPage ? "" : `<div class="offer-page-break"></div>${renderOfferContinuationHeader(offer, c, pageNumber, totalPages)}`}
        <table>
          ${renderOfferTableHead()}
          <tbody>${buildItemsRows(chunk, c)}</tbody>
        </table>
        ${isLastPage ? renderOfferTotalsAndNotes(offer, c, vatLabel, priceNote) : ""}
      `;
    })
    .join("");
}

// ──────────────────────────────────────────────────────────────────────────────
// MODERN TEMPLATE — slate header bar, full-width, modern sans
// ──────────────────────────────────────────────────────────────────────────────

const modernStyles = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #0f172a; line-height: 1.5; margin: 0; padding: 0; }
  .band { background: #0f172a; color: white; padding: 22px 30px; display: flex; justify-content: space-between; align-items: center; }
  .band .title { font-size: 26px; font-weight: 700; letter-spacing: 0.5px; }
  .band .subtitle { font-size: 12px; opacity: 0.7; margin-top: 2px; }
  .band .logo { background: white; padding: 6px 10px; border-radius: 4px; }
  .container { padding: 30px; }
  .top-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 28px; }
  .block h4 { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin: 0 0 8px 0; font-weight: 600; }
  .block p { margin: 2px 0; font-size: 11px; color: #1e293b; }
  .block strong { color: #0f172a; }
  .meta-row { display: flex; gap: 30px; padding: 14px 16px; background: #f1f5f9; border-radius: 6px; margin-bottom: 22px; font-size: 11px; }
  .meta-row .label { color: #64748b; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  th { text-align: left; padding: 10px 8px; background: #f8fafc; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #0f172a; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
  .totals { margin-left: auto; width: 260px; margin-top: 10px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; }
  .totals-row.total { background: #0f172a; color: white; border-radius: 4px; margin-top: 6px; padding: 10px; font-size: 13px; font-weight: 700; }
  .notes { margin-top: 28px; padding: 14px 16px; border-left: 3px solid #0f172a; background: #f8fafc; font-size: 11px; color: #334155; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9px; color: #94a3b8; }
  .vat-note { margin-top: 8px; font-size: 9px; color: #94a3b8; }
  .clearfix::after { content: ''; display: block; clear: both; }
`;

function renderModernHeader(
  title: string,
  docNumber: string,
  c: CompanyInfo,
): string {
  return `
  <div class="band">
    <div>
      <div class="title">${title}</div>
      <div class="subtitle">${docNumber}</div>
    </div>
    ${letterheadVisible(c) ? `<div class="logo">${letterheadImg(c, "md")}</div>` : `<div style="font-size:15px;font-weight:700;">${c.firmenname || ""}</div>`}
  </div>`;
}

function renderModernCompanyBlock(c: CompanyInfo): string {
  const lines = buildCompanyLines(c);
  return `
    <div class="block">
      <h4>Absender</h4>
      <p><strong>${c.firmenname || ""}</strong></p>
      ${lines.map((l) => `<p>${l}</p>`).join("")}
    </div>`;
}

function renderModernCustomerBlock(customer: any): string {
  return `
    <div class="block">
      <h4>Rechnungsempfänger</h4>
      <p><strong>${customer?.name ?? ""}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ""}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
    </div>`;
}

function renderModernInvoice(invoice: any, c: CompanyInfo): string {
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`]
    .filter(Boolean)
    .join(" · ");
  return `<!DOCTYPE html><html><head><style>${modernStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    ${renderModernHeader("RECHNUNG", invoice?.invoiceNumber ?? "", c)}
    <div class="container">
      <div class="top-grid">
        ${renderModernCompanyBlock(c)}
        <div>${renderModernCustomerBlock(invoice?.customer ?? {})}${renderInvoiceExecutionAddress(invoice)}</div>
      </div>
      <div class="meta-row">
        <div><span class="label">Rechnungsdatum:</span>${formatDate(invoice?.invoiceDate)}</div>
        <div><span class="label">Zahlungsziel:</span>${formatDate(invoice?.dueDate)}</div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(invoice?.items ?? [], c)}</tbody>
      </table>
      <div class="clearfix">
        <div class="totals">
          <div class="totals-row"><span>Netto</span><span>${formatMoney(Number(invoice?.subtotal ?? 0), c)}</span></div>
          ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatMoney(Number(invoice?.vatAmount ?? 0), c)}</span></div>` : ""}
          <div class="totals-row total"><span>Total</span><span>${formatMoney(Number(invoice?.total ?? 0), c)}</span></div>
        </div>
      </div>
      ${bankLine ? `<div style="clear:both;margin-top:22px;font-size:10px;color:#475569;"><strong>Bankverbindung:</strong> ${bankLine}</div>` : ""}
      ${!c.mwstAktiv ? `<div class="vat-note">${c.mwstHinweis || "Nicht MWST-pflichtig"}</div>` : ""}
      ${renderInvoicePdfTextBlock(invoice)}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
    </div>
  </body></html>`;
}

function renderModernOffer(offer: any, c: CompanyInfo): string {
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? "Die Preise verstehen sich inkl. MwSt."
    : (c.mwstHinweis || "Nicht MWST-pflichtig") + ".";
  return `<!DOCTYPE html><html><head><style>${modernStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    ${renderModernHeader("ANGEBOT", offer?.offerNumber ?? "", c)}
    <div class="container">
      <div class="top-grid">
        ${renderModernCompanyBlock(c)}
        <div>${renderModernCustomerBlock(offer?.customer ?? {})}${renderOfferExecutionAddress(offer)}</div>
      </div>
      <div class="meta-row">
        <div><span class="label">Angebotsdatum:</span>${formatDate(offer?.offerDate)}</div>
        <div><span class="label">Gültig bis:</span>${formatDate(offer?.validUntil)}</div>
      </div>
      ${renderOfferItemsAndSummary(offer, c, vatLabel, priceNote)}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
    </div>
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// MINIMAL TEMPLATE — pure black & white, minimal borders, airy
// ──────────────────────────────────────────────────────────────────────────────

const minimalStyles = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #111; line-height: 1.6; margin: 0; padding: 36px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 42px; }
  .head .title { font-size: 28px; font-weight: 300; letter-spacing: 2px; text-transform: uppercase; }
  .head .num { font-size: 11px; color: #666; margin-top: 4px; letter-spacing: 1px; }
  .head .company-name { font-size: 13px; font-weight: 600; text-align: right; }
  .head .company-lines { font-size: 10px; color: #555; text-align: right; line-height: 1.7; margin-top: 2px; }
  .divider { border-top: 1px solid #111; margin: 0 0 30px 0; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-bottom: 30px; }
  .columns h5 { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin: 0 0 8px 0; font-weight: 500; }
  .columns p { margin: 2px 0; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; padding: 8px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; border-bottom: 1px solid #111; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 10px 0; font-size: 11px; border-bottom: 1px solid #eee; }
  .totals { width: 240px; margin-left: auto; margin-top: 14px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 11px; }
  .totals-row.total { border-top: 2px solid #111; font-weight: 600; font-size: 13px; padding-top: 10px; margin-top: 4px; }
  .notes { clear: both; margin-top: 36px; font-size: 11px; color: #444; line-height: 1.7; }
  .footer { clear: both; margin-top: 46px; padding-top: 14px; border-top: 1px solid #eee; text-align: center; font-size: 9px; color: #999; letter-spacing: 0.5px; }
`;

function renderMinimalHeader(
  title: string,
  docNumber: string,
  c: CompanyInfo,
): string {
  const lines = buildCompanyLines(c);
  return `
    <div class="head">
      <div>
        <div class="title">${title}</div>
        <div class="num">${docNumber}</div>
      </div>
      <div>
        ${letterheadVisible(c) ? `<div style="text-align:right;margin-bottom:6px;">${letterheadImg(c, "sm")}</div>` : ""}
        <div class="company-name">${c.firmenname || ""}</div>
        <div class="company-lines">${lines.join("<br/>")}</div>
      </div>
    </div>
    <div class="divider"></div>`;
}

function renderMinimalInvoice(invoice: any, c: CompanyInfo): string {
  const customer = invoice?.customer ?? {};
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`]
    .filter(Boolean)
    .join(" · ");
  return `<!DOCTYPE html><html><head><style>${minimalStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    ${renderMinimalHeader("Rechnung", invoice?.invoiceNumber ?? "", c)}
    <div class="columns">
      <div>
        <h5>Rechnungsempfänger</h5>
        <p><strong>${customer?.name ?? ""}</strong></p>
        ${customer?.address ? `<p>${customer.address}</p>` : ""}
        ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
        ${renderInvoiceExecutionAddress(invoice)}
      </div>
      <div>
        <h5>Details</h5>
        <p><strong>Rechnungsdatum</strong> ${formatDate(invoice?.invoiceDate)}</p>
        <p><strong>Zahlungsziel</strong> ${formatDate(invoice?.dueDate)}</p>
      </div>
    </div>
    <table>
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
      <tbody>${buildItemsRows(invoice?.items ?? [], c)}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Netto</span><span>${formatMoney(Number(invoice?.subtotal ?? 0), c)}</span></div>
      ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatMoney(Number(invoice?.vatAmount ?? 0), c)}</span></div>` : ""}
      <div class="totals-row total"><span>Total</span><span>${formatMoney(Number(invoice?.total ?? 0), c)}</span></div>
    </div>
    ${bankLine ? `<div class="notes"><strong>Bankverbindung</strong><br/>${bankLine}</div>` : ""}
    ${!c.mwstAktiv ? `<div style="margin-top:8px;font-size:9px;color:#999;">${c.mwstHinweis || "Nicht MWST-pflichtig"}</div>` : ""}
    ${renderInvoicePdfTextBlock(invoice)}
    <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
  </body></html>`;
}
function renderMinimalOffer(offer: any, c: CompanyInfo): string {
  const customer = offer?.customer ?? {};
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? "Die Preise verstehen sich inkl. MwSt."
    : (c.mwstHinweis || "Nicht MWST-pflichtig") + ".";
  return `<!DOCTYPE html><html><head><style>${minimalStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    ${renderMinimalHeader("Angebot", offer?.offerNumber ?? "", c)}
    <div class="columns">
      <div>
        <h5>Angebotsempfänger</h5>
        <p><strong>${customer?.name ?? ""}</strong></p>
        ${customer?.address ? `<p>${customer.address}</p>` : ""}
        ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
        ${renderOfferExecutionAddress(offer)}
      </div>
      <div>
        <h5>Details</h5>
        <p><strong>Angebotsdatum</strong> ${formatDate(offer?.offerDate)}</p>
        <p><strong>Gültig bis</strong> ${formatDate(offer?.validUntil)}</p>
      </div>
    </div>
    ${renderOfferItemsAndSummary(offer, c, vatLabel, priceNote)}
    <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// ELEGANT TEMPLATE — serif + warm brown accent, centered title
// ──────────────────────────────────────────────────────────────────────────────

const elegantStyles = `
  body { font-family: 'Georgia', 'Cambria', 'Times New Roman', serif; font-size: 11px; color: #1a1a1a; line-height: 1.55; margin: 0; padding: 0; }
  .wrap { padding: 36px 40px; }
  .brand { text-align: center; border-bottom: 2px solid #78350f; padding-bottom: 16px; margin-bottom: 22px; }
  .brand .logo { margin-bottom: 10px; }
  .brand .firm { font-size: 20px; font-weight: 700; color: #78350f; letter-spacing: 0.5px; }
  .brand .addr { font-size: 10px; color: #6b5a44; margin-top: 4px; }
  .center-title { text-align: center; margin: 10px 0 30px 0; }
  .center-title h1 { margin: 0; font-size: 26px; color: #78350f; letter-spacing: 4px; font-weight: 400; text-transform: uppercase; }
  .center-title .num { font-size: 12px; color: #6b5a44; margin-top: 6px; font-style: italic; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 28px; font-size: 11px; }
  .two-col h4 { font-size: 10px; color: #78350f; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px 0; font-weight: 600; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .two-col p { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
  th { background: #fdf6ed; color: #78350f; padding: 11px 10px; text-align: left; font-size: 10px; font-weight: 700; border-bottom: 2px solid #78350f; text-transform: uppercase; letter-spacing: 1px; font-family: 'Helvetica Neue', Arial, sans-serif; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 10px; font-size: 11px; border-bottom: 1px solid #f0e6d5; }
  .totals { float: right; width: 260px; margin-top: 6px; }
  .totals-row { display: flex; justify-content: space-between; padding: 7px 10px; font-size: 11px; }
  .totals-row.total { border-top: 2px double #78350f; margin-top: 5px; padding-top: 12px; font-size: 14px; font-weight: 700; color: #78350f; }
  .notes { clear: both; margin-top: 32px; padding: 16px 18px; background: #fdf6ed; border-left: 3px solid #78350f; font-size: 11px; color: #4a3d2c; }
  .footer { margin-top: 44px; text-align: center; font-size: 9px; color: #a08864; font-style: italic; border-top: 1px solid #f0e6d5; padding-top: 14px; }
`;

function renderElegantHead(c: CompanyInfo): string {
  const addrLine = addrLineHelper(c);
  const plzLine = plzLineHelper(c);
  const addr = [
    addrLine,
    plzLine,
    c.email,
    c.telefon ? `Tel. ${c.telefon}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <div class="brand">
      ${letterheadVisible(c) ? `<div class="logo">${letterheadImg(c, "md")}</div>` : ""}
      <div class="firm">${c.firmenname || ""}</div>
      ${addr ? `<div class="addr">${addr}</div>` : ""}
    </div>`;
}

function renderElegantInvoice(invoice: any, c: CompanyInfo): string {
  const customer = invoice?.customer ?? {};
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`]
    .filter(Boolean)
    .join(" · ");
  return `<!DOCTYPE html><html><head><style>${elegantStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    <div class="wrap">
      ${renderElegantHead(c)}
      <div class="center-title">
        <h1>Rechnung</h1>
        <div class="num">${invoice?.invoiceNumber ?? ""}</div>
      </div>
      <div class="two-col">
        <div>
          <h4>Rechnungsempfänger</h4>
          <p><strong>${customer?.name ?? ""}</strong></p>
          ${customer?.address ? `<p>${customer.address}</p>` : ""}
          ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
          ${renderInvoiceExecutionAddress(invoice)}
        </div>
        <div>
          <h4>Details</h4>
          <p><em>Rechnungsdatum:</em> ${formatDate(invoice?.invoiceDate)}</p>
          <p><em>Zahlungsziel:</em> ${formatDate(invoice?.dueDate)}</p>
          ${c.mwstAktiv && c.mwstNummer ? `<p><em>MwSt-Nr.:</em> ${c.mwstNummer}</p>` : ""}
        </div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(invoice?.items ?? [], c)}</tbody>
      </table>
      <div class="totals">
        <div class="totals-row"><span>Netto</span><span>${formatMoney(Number(invoice?.subtotal ?? 0), c)}</span></div>
        ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatMoney(Number(invoice?.vatAmount ?? 0), c)}</span></div>` : ""}
        <div class="totals-row total"><span>Total</span><span>${formatMoney(Number(invoice?.total ?? 0), c)}</span></div>
      </div>
      ${bankLine ? `<div class="notes"><strong>Bankverbindung:</strong> ${bankLine}</div>` : ""}
      ${!c.mwstAktiv ? `<div style="clear:both;margin-top:8px;font-size:9px;color:#a08864;font-style:italic;">${c.mwstHinweis || "Nicht MWST-pflichtig"}</div>` : ""}
      ${renderInvoicePdfTextBlock(invoice)}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
    </div>
  </body></html>`;
}

function renderElegantOffer(offer: any, c: CompanyInfo): string {
  const customer = offer?.customer ?? {};
  const vatLabel =
    c.mwstAktiv === false
      ? c.mwstHinweis || "Nicht MWST-pflichtig"
      : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? "Die Preise verstehen sich inkl. MwSt."
    : (c.mwstHinweis || "Nicht MWST-pflichtig") + ".";
  return `<!DOCTYPE html><html><head><style>${elegantStyles}${offerDocumentStyles}</style></head><body class="offer-document">
    <div class="wrap">
      ${renderElegantHead(c)}
      <div class="center-title">
        <h1>Angebot</h1>
        <div class="num">${offer?.offerNumber ?? ""}</div>
      </div>
      <div class="two-col">
        <div>
          <h4>Angebotsempfänger</h4>
          <p><strong>${customer?.name ?? ""}</strong></p>
          ${customer?.address ? `<p>${customer.address}</p>` : ""}
          ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ""} ${customer?.city ?? ""}</p>` : ""}
          ${renderOfferExecutionAddress(offer)}
        </div>
        <div>
          <h4>Details</h4>
          <p><em>Angebotsdatum:</em> ${formatDate(offer?.offerDate)}</p>
          <p><em>Gültig bis:</em> ${formatDate(offer?.validUntil)}</p>
        </div>
      </div>
      ${renderOfferItemsAndSummary(offer, c, vatLabel, priceNote)}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(" · ")}</div>
    </div>
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC API — dispatcher (signatures unchanged)
// ──────────────────────────────────────────────────────────────────────────────

export function generateInvoiceHtml(
  invoice: any,
  company?: CompanyInfo | null,
): string {
  const c = company ?? DEFAULT_COMPANY;
  const tpl = pickTemplate(c);
  switch (tpl) {
    case "modern":
      return renderModernInvoice(invoice, c);
    case "minimal":
      return renderMinimalInvoice(invoice, c);
    case "elegant":
      return renderElegantInvoice(invoice, c);
    case "classic":
    default:
      return renderClassicInvoice(invoice, c);
  }
}

export function generateOfferHtml(
  offer: any,
  company?: CompanyInfo | null,
): string {
  const c = company ?? DEFAULT_COMPANY;
  const tpl = pickTemplate(c);
  switch (tpl) {
    case "modern":
      return renderModernOffer(offer, c);
    case "minimal":
      return renderMinimalOffer(offer, c);
    case "elegant":
      return renderElegantOffer(offer, c);
    case "classic":
    default:
      return renderClassicOffer(offer, c);
  }
}
