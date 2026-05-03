export type DocumentTemplate = 'classic' | 'modern' | 'minimal' | 'elegant';

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
}

const DEFAULT_COMPANY: CompanyInfo = {
  firmenname: 'Mein Unternehmen',
  ansprechpartner: 'Ralf Albrecht',
  strasse: 'Schartenstrasse',
  hausnummer: '127',
  plz: '5430',
  ort: 'Wettingen',
  email: 'smiley.albi@web.de',
};

const formatCHF = (amount: number) => `CHF ${(amount ?? 0).toFixed(2)}`;
const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

function pickTemplate(company?: CompanyInfo | null): DocumentTemplate {
  const raw = (company?.documentTemplate || '').toLowerCase();
  if (raw === 'modern' || raw === 'minimal' || raw === 'elegant') return raw as DocumentTemplate;
  return 'classic';
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
  const addrLine = [c.strasse, c.hausnummer].filter(Boolean).join(' ');
  const plzLine = [c.plz, c.ort].filter(Boolean).join(' ');
  const showLogo = letterheadVisible(c);
  return `
  <div class="company">
    ${showLogo
      ? `<div style="margin-bottom:6px;">${letterheadImg(c, 'md')}</div>`
      : `<div class="company-name">${c.firmenname || ''}</div>`
    }
    ${c.ansprechpartner ? `<div>${c.ansprechpartner}</div>` : ''}
    ${addrLine ? `<div>${addrLine}</div>` : ''}
    ${plzLine ? `<div>${plzLine}, Schweiz</div>` : ''}
    ${c.email ? `<div>${c.email}</div>` : ''}
    ${c.telefon ? `<div>Tel. ${c.telefon}${c.telefon2 ? ` / ${c.telefon2}` : ''}</div>` : ''}
    ${c.mwstAktiv && c.mwstNummer ? `<div>${c.mwstNummer}</div>` : ''}
  </div>`;
}

function buildClassicFooterBlock(c: CompanyInfo): string {
  const addrLine = [c.strasse, c.hausnummer].filter(Boolean).join(' ');
  const plzLine = [c.plz, c.ort].filter(Boolean).join(' ');
  const parts = [c.firmenname, c.ansprechpartner, [addrLine, plzLine].filter(Boolean).join(', '), c.email].filter(Boolean);
  return `<div class="footer">${parts.join(' &middot; ')}</div>`;
}

function buildClassicBankBlock(c: CompanyInfo): string {
  if (!c.iban && !c.bank) return '';
  const parts: string[] = [];
  if (c.iban) parts.push(`IBAN: ${c.iban}`);
  if (c.bank) parts.push(`Bank: ${c.bank}`);
  return `<div class="bank-info"><strong>Bankverbindung:</strong> ${parts.join(' &middot; ')}</div>`;
}

function buildClassicMwstNote(c: CompanyInfo): string {
  if (c.mwstAktiv) return '';
  const hint = c.mwstHinweis || 'Nicht MWST-pflichtig';
  return `<div style="font-size:9px;color:#888;margin-top:5px;">${hint}</div>`;
}

function renderClassicInvoice(invoice: any, c: CompanyInfo): string {
  const items = invoice?.items ?? [];
  const customer = invoice?.customer ?? {};
  const itemsHtml = items.map((item: any) => `
    <tr>
      <td>${item?.description ?? ''}</td>
      <td>${Number(item?.quantity ?? 0).toFixed(2)}</td>
      <td>${item?.unit ?? ''}</td>
      <td>${formatCHF(Number(item?.unitPrice ?? 0))}</td>
      <td>${formatCHF(Number(item?.totalPrice ?? 0))}</td>
    </tr>
  `).join('');

  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;

  return `<!DOCTYPE html><html><head><style>${classicStyles}</style></head><body>
    <div class="header">
      <div>
        <div class="doc-title">Rechnung</div>
        <div class="doc-number">${invoice?.invoiceNumber ?? ''}</div>
      </div>
      ${buildClassicCompanyBlock(c)}
    </div>
    <div class="customer-box">
      <p><strong>${customer?.name ?? ''}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ''}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
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
      <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(invoice?.subtotal ?? 0))}</span></div>
      ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(invoice?.vatAmount ?? 0))}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(invoice?.total ?? 0))}</span></div>
    </div>
    ${buildClassicBankBlock(c)}
    ${buildClassicMwstNote(c)}
    ${invoice?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${invoice.notes}</div>` : ''}
    ${buildClassicFooterBlock(c)}
  </body></html>`;
}

function renderClassicOffer(offer: any, c: CompanyInfo): string {
  const items = offer?.items ?? [];
  const customer = offer?.customer ?? {};
  const itemsHtml = items.map((item: any) => `
    <tr>
      <td>${item?.description ?? ''}</td>
      <td>${Number(item?.quantity ?? 0).toFixed(2)}</td>
      <td>${item?.unit ?? ''}</td>
      <td>${formatCHF(Number(item?.unitPrice ?? 0))}</td>
      <td>${formatCHF(Number(item?.totalPrice ?? 0))}</td>
    </tr>
  `).join('');

  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;

  const priceNote = c.mwstAktiv
    ? 'Die Preise verstehen sich inkl. MwSt.'
    : (c.mwstHinweis || 'Nicht MWST-pflichtig') + '.';

  return `<!DOCTYPE html><html><head><style>${classicStyles}</style></head><body>
    <div class="header">
      <div>
        <div class="doc-title">Angebot</div>
        <div class="doc-number">${offer?.offerNumber ?? ''}</div>
      </div>
      ${buildClassicCompanyBlock(c)}
    </div>
    <div class="customer-box">
      <p><strong>${customer?.name ?? ''}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ''}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
    </div>
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Angebotsdatum:</span> ${formatDate(offer?.offerDate)}</div>
      <div class="meta-item"><span class="meta-label">Gültig bis:</span> ${formatDate(offer?.validUntil)}</div>
    </div>
    <table>
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(offer?.subtotal ?? 0))}</span></div>
      ${Number(offer?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(offer?.vatAmount ?? 0))}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(offer?.total ?? 0))}</span></div>
    </div>
    ${offer?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${offer.notes}</div>` : ''}
    <div class="notes"><strong>Hinweis:</strong> Dieses Angebot ist gültig bis ${formatDate(offer?.validUntil)}. ${priceNote}</div>
    ${buildClassicFooterBlock(c)}
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS for new templates (modern/minimal/elegant)
// ──────────────────────────────────────────────────────────────────────────────

function addrLineHelper(c: CompanyInfo) {
  return [c.strasse, c.hausnummer].filter(Boolean).join(' ');
}
function plzLineHelper(c: CompanyInfo) {
  return [c.plz, c.ort].filter(Boolean).join(' ');
}
function buildCompanyLines(c: CompanyInfo): string[] {
  const lines: string[] = [];
  if (c.ansprechpartner) lines.push(c.ansprechpartner);
  const addrLine = addrLineHelper(c);
  if (addrLine) lines.push(addrLine);
  const plzLine = plzLineHelper(c);
  if (plzLine) lines.push(plzLine);
  if (c.telefon) lines.push(`Tel. ${c.telefon}${c.telefon2 ? ` / ${c.telefon2}` : ''}`);
  if (c.email) lines.push(c.email);
  if (c.webseite) lines.push(c.webseite);
  if (c.mwstAktiv && c.mwstNummer) lines.push(c.mwstNummer);
  return lines;
}
function buildItemsRows(items: any[]): string {
  return items.map((item: any) => `
    <tr>
      <td>${item?.description ?? ''}</td>
      <td>${Number(item?.quantity ?? 0).toFixed(2)}</td>
      <td>${item?.unit ?? ''}</td>
      <td>${formatCHF(Number(item?.unitPrice ?? 0))}</td>
      <td>${formatCHF(Number(item?.totalPrice ?? 0))}</td>
    </tr>
  `).join('');
}
function resolveLetterheadUrl(c: CompanyInfo): string | null {
  return c.letterheadUrl || c.logoUrl || c.companyLogo || c.companyLogoUrl || null;
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
function letterheadImg(c: CompanyInfo, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const url = resolveLetterheadUrl(c);
  const show = letterheadVisible(c);
  if (!url || !show) {
    return '';
  }
  const h = size === 'sm' ? '42px' : size === 'lg' ? '80px' : '60px';
  return `<img src="${url}" alt="${c.firmenname || 'Logo'}" style="max-height:${h};max-width:220px;object-fit:contain;" />`;
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

function renderModernHeader(title: string, docNumber: string, c: CompanyInfo): string {
  return `
  <div class="band">
    <div>
      <div class="title">${title}</div>
      <div class="subtitle">${docNumber}</div>
    </div>
    ${letterheadVisible(c) ? `<div class="logo">${letterheadImg(c, 'md')}</div>` : `<div style="font-size:15px;font-weight:700;">${c.firmenname || ''}</div>`}
  </div>`;
}

function renderModernCompanyBlock(c: CompanyInfo): string {
  const lines = buildCompanyLines(c);
  return `
    <div class="block">
      <h4>Absender</h4>
      <p><strong>${c.firmenname || ''}</strong></p>
      ${lines.map(l => `<p>${l}</p>`).join('')}
    </div>`;
}

function renderModernCustomerBlock(customer: any): string {
  return `
    <div class="block">
      <h4>Rechnungsempfänger</h4>
      <p><strong>${customer?.name ?? ''}</strong></p>
      ${customer?.address ? `<p>${customer.address}</p>` : ''}
      ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
    </div>`;
}

function renderModernInvoice(invoice: any, c: CompanyInfo): string {
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html><head><style>${modernStyles}</style></head><body>
    ${renderModernHeader('RECHNUNG', invoice?.invoiceNumber ?? '', c)}
    <div class="container">
      <div class="top-grid">
        ${renderModernCompanyBlock(c)}
        ${renderModernCustomerBlock(invoice?.customer ?? {})}
      </div>
      <div class="meta-row">
        <div><span class="label">Rechnungsdatum:</span>${formatDate(invoice?.invoiceDate)}</div>
        <div><span class="label">Zahlungsziel:</span>${formatDate(invoice?.dueDate)}</div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(invoice?.items ?? [])}</tbody>
      </table>
      <div class="clearfix">
        <div class="totals">
          <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(invoice?.subtotal ?? 0))}</span></div>
          ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(invoice?.vatAmount ?? 0))}</span></div>` : ''}
          <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(invoice?.total ?? 0))}</span></div>
        </div>
      </div>
      ${bankLine ? `<div style="clear:both;margin-top:22px;font-size:10px;color:#475569;"><strong>Bankverbindung:</strong> ${bankLine}</div>` : ''}
      ${!c.mwstAktiv ? `<div class="vat-note">${c.mwstHinweis || 'Nicht MWST-pflichtig'}</div>` : ''}
      ${invoice?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${invoice.notes}</div>` : ''}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
    </div>
  </body></html>`;
}

function renderModernOffer(offer: any, c: CompanyInfo): string {
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? 'Die Preise verstehen sich inkl. MwSt.'
    : (c.mwstHinweis || 'Nicht MWST-pflichtig') + '.';
  return `<!DOCTYPE html><html><head><style>${modernStyles}</style></head><body>
    ${renderModernHeader('ANGEBOT', offer?.offerNumber ?? '', c)}
    <div class="container">
      <div class="top-grid">
        ${renderModernCompanyBlock(c)}
        ${renderModernCustomerBlock(offer?.customer ?? {})}
      </div>
      <div class="meta-row">
        <div><span class="label">Angebotsdatum:</span>${formatDate(offer?.offerDate)}</div>
        <div><span class="label">Gültig bis:</span>${formatDate(offer?.validUntil)}</div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(offer?.items ?? [])}</tbody>
      </table>
      <div class="clearfix">
        <div class="totals">
          <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(offer?.subtotal ?? 0))}</span></div>
          ${Number(offer?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(offer?.vatAmount ?? 0))}</span></div>` : ''}
          <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(offer?.total ?? 0))}</span></div>
        </div>
      </div>
      ${offer?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${offer.notes}</div>` : ''}
      <div class="notes"><strong>Hinweis:</strong> Dieses Angebot ist gültig bis ${formatDate(offer?.validUntil)}. ${priceNote}</div>
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
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

function renderMinimalHeader(title: string, docNumber: string, c: CompanyInfo): string {
  const lines = buildCompanyLines(c);
  return `
    <div class="head">
      <div>
        <div class="title">${title}</div>
        <div class="num">${docNumber}</div>
      </div>
      <div>
        ${letterheadVisible(c) ? `<div style="text-align:right;margin-bottom:6px;">${letterheadImg(c, 'sm')}</div>` : ''}
        <div class="company-name">${c.firmenname || ''}</div>
        <div class="company-lines">${lines.join('<br/>')}</div>
      </div>
    </div>
    <div class="divider"></div>`;
}

function renderMinimalInvoice(invoice: any, c: CompanyInfo): string {
  const customer = invoice?.customer ?? {};
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html><head><style>${minimalStyles}</style></head><body>
    ${renderMinimalHeader('Rechnung', invoice?.invoiceNumber ?? '', c)}
    <div class="columns">
      <div>
        <h5>Rechnungsempfänger</h5>
        <p><strong>${customer?.name ?? ''}</strong></p>
        ${customer?.address ? `<p>${customer.address}</p>` : ''}
        ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
      </div>
      <div>
        <h5>Details</h5>
        <p><strong>Rechnungsdatum</strong> ${formatDate(invoice?.invoiceDate)}</p>
        <p><strong>Zahlungsziel</strong> ${formatDate(invoice?.dueDate)}</p>
      </div>
    </div>
    <table>
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
      <tbody>${buildItemsRows(invoice?.items ?? [])}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(invoice?.subtotal ?? 0))}</span></div>
      ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(invoice?.vatAmount ?? 0))}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(invoice?.total ?? 0))}</span></div>
    </div>
    ${bankLine ? `<div class="notes"><strong>Bankverbindung</strong><br/>${bankLine}</div>` : ''}
    ${!c.mwstAktiv ? `<div style="margin-top:8px;font-size:9px;color:#999;">${c.mwstHinweis || 'Nicht MWST-pflichtig'}</div>` : ''}
    ${invoice?.notes ? `<div class="notes"><strong>Bemerkungen</strong><br/>${invoice.notes}</div>` : ''}
    <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
  </body></html>`;
}

function renderMinimalOffer(offer: any, c: CompanyInfo): string {
  const customer = offer?.customer ?? {};
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? 'Die Preise verstehen sich inkl. MwSt.'
    : (c.mwstHinweis || 'Nicht MWST-pflichtig') + '.';
  return `<!DOCTYPE html><html><head><style>${minimalStyles}</style></head><body>
    ${renderMinimalHeader('Angebot', offer?.offerNumber ?? '', c)}
    <div class="columns">
      <div>
        <h5>Angebotsempfänger</h5>
        <p><strong>${customer?.name ?? ''}</strong></p>
        ${customer?.address ? `<p>${customer.address}</p>` : ''}
        ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
      </div>
      <div>
        <h5>Details</h5>
        <p><strong>Angebotsdatum</strong> ${formatDate(offer?.offerDate)}</p>
        <p><strong>Gültig bis</strong> ${formatDate(offer?.validUntil)}</p>
      </div>
    </div>
    <table>
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
      <tbody>${buildItemsRows(offer?.items ?? [])}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(offer?.subtotal ?? 0))}</span></div>
      ${Number(offer?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(offer?.vatAmount ?? 0))}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(offer?.total ?? 0))}</span></div>
    </div>
    ${offer?.notes ? `<div class="notes"><strong>Bemerkungen</strong><br/>${offer.notes}</div>` : ''}
    <div class="notes"><strong>Hinweis</strong><br/>Dieses Angebot ist gültig bis ${formatDate(offer?.validUntil)}. ${priceNote}</div>
    <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
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
  const addr = [addrLine, plzLine, c.email, c.telefon ? `Tel. ${c.telefon}` : ''].filter(Boolean).join(' · ');
  return `
    <div class="brand">
      ${letterheadVisible(c) ? `<div class="logo">${letterheadImg(c, 'md')}</div>` : ''}
      <div class="firm">${c.firmenname || ''}</div>
      ${addr ? `<div class="addr">${addr}</div>` : ''}
    </div>`;
}

function renderElegantInvoice(invoice: any, c: CompanyInfo): string {
  const customer = invoice?.customer ?? {};
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(invoice?.vatRate ?? 7.7)}%`;
  const bankLine = [c.iban && `IBAN ${c.iban}`, c.bank && `Bank ${c.bank}`].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html><head><style>${elegantStyles}</style></head><body>
    <div class="wrap">
      ${renderElegantHead(c)}
      <div class="center-title">
        <h1>Rechnung</h1>
        <div class="num">${invoice?.invoiceNumber ?? ''}</div>
      </div>
      <div class="two-col">
        <div>
          <h4>Rechnungsempfänger</h4>
          <p><strong>${customer?.name ?? ''}</strong></p>
          ${customer?.address ? `<p>${customer.address}</p>` : ''}
          ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
        </div>
        <div>
          <h4>Details</h4>
          <p><em>Rechnungsdatum:</em> ${formatDate(invoice?.invoiceDate)}</p>
          <p><em>Zahlungsziel:</em> ${formatDate(invoice?.dueDate)}</p>
          ${c.mwstAktiv && c.mwstNummer ? `<p><em>MwSt-Nr.:</em> ${c.mwstNummer}</p>` : ''}
        </div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(invoice?.items ?? [])}</tbody>
      </table>
      <div class="totals">
        <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(invoice?.subtotal ?? 0))}</span></div>
        ${Number(invoice?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(invoice?.vatAmount ?? 0))}</span></div>` : ''}
        <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(invoice?.total ?? 0))}</span></div>
      </div>
      ${bankLine ? `<div class="notes"><strong>Bankverbindung:</strong> ${bankLine}</div>` : ''}
      ${!c.mwstAktiv ? `<div style="clear:both;margin-top:8px;font-size:9px;color:#a08864;font-style:italic;">${c.mwstHinweis || 'Nicht MWST-pflichtig'}</div>` : ''}
      ${invoice?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${invoice.notes}</div>` : ''}
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
    </div>
  </body></html>`;
}

function renderElegantOffer(offer: any, c: CompanyInfo): string {
  const customer = offer?.customer ?? {};
  const vatLabel = c.mwstAktiv === false
    ? (c.mwstHinweis || 'Nicht MWST-pflichtig')
    : `MwSt. ${Number(offer?.vatRate ?? 7.7)}%`;
  const priceNote = c.mwstAktiv
    ? 'Die Preise verstehen sich inkl. MwSt.'
    : (c.mwstHinweis || 'Nicht MWST-pflichtig') + '.';
  return `<!DOCTYPE html><html><head><style>${elegantStyles}</style></head><body>
    <div class="wrap">
      ${renderElegantHead(c)}
      <div class="center-title">
        <h1>Angebot</h1>
        <div class="num">${offer?.offerNumber ?? ''}</div>
      </div>
      <div class="two-col">
        <div>
          <h4>Angebotsempfänger</h4>
          <p><strong>${customer?.name ?? ''}</strong></p>
          ${customer?.address ? `<p>${customer.address}</p>` : ''}
          ${customer?.plz || customer?.city ? `<p>${customer?.plz ?? ''} ${customer?.city ?? ''}</p>` : ''}
        </div>
        <div>
          <h4>Details</h4>
          <p><em>Angebotsdatum:</em> ${formatDate(offer?.offerDate)}</p>
          <p><em>Gültig bis:</em> ${formatDate(offer?.validUntil)}</p>
        </div>
      </div>
      <table>
        <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th></tr></thead>
        <tbody>${buildItemsRows(offer?.items ?? [])}</tbody>
      </table>
      <div class="totals">
        <div class="totals-row"><span>Netto</span><span>${formatCHF(Number(offer?.subtotal ?? 0))}</span></div>
        ${Number(offer?.vatRate ?? 0) > 0 ? `<div class="totals-row"><span>${vatLabel}</span><span>${formatCHF(Number(offer?.vatAmount ?? 0))}</span></div>` : ''}
        <div class="totals-row total"><span>Total</span><span>${formatCHF(Number(offer?.total ?? 0))}</span></div>
      </div>
      ${offer?.notes ? `<div class="notes"><strong>Bemerkungen:</strong><br/>${offer.notes}</div>` : ''}
      <div class="notes"><strong>Hinweis:</strong> Dieses Angebot ist gültig bis ${formatDate(offer?.validUntil)}. ${priceNote}</div>
      <div class="footer">${[c.firmenname, addrLineHelper(c), plzLineHelper(c), c.email].filter(Boolean).join(' · ')}</div>
    </div>
  </body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC API — dispatcher (signatures unchanged)
// ──────────────────────────────────────────────────────────────────────────────

export function generateInvoiceHtml(invoice: any, company?: CompanyInfo | null): string {
  const c = company ?? DEFAULT_COMPANY;
  const tpl = pickTemplate(c);
  switch (tpl) {
    case 'modern':  return renderModernInvoice(invoice, c);
    case 'minimal': return renderMinimalInvoice(invoice, c);
    case 'elegant': return renderElegantInvoice(invoice, c);
    case 'classic':
    default:        return renderClassicInvoice(invoice, c);
  }
}

export function generateOfferHtml(offer: any, company?: CompanyInfo | null): string {
  const c = company ?? DEFAULT_COMPANY;
  const tpl = pickTemplate(c);
  switch (tpl) {
    case 'modern':  return renderModernOffer(offer, c);
    case 'minimal': return renderMinimalOffer(offer, c);
    case 'elegant': return renderElegantOffer(offer, c);
    case 'classic':
    default:        return renderClassicOffer(offer, c);
  }
}
