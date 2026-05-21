'use client';

import { useState } from 'react';

type Currency = 'CHF' | 'EUR';
type ContentKind = 'original' | 'ai' | 'none';

interface MergeOrderItem {
  id?: string;
  serviceName: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice?: number;
}

interface MergeOrder {
currency?: Currency | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  total?: number | null;
  id: string;
  customerId: string;
  description?: string | null;
  serviceName?: string | null;
  date?: string;
  createdAt?: string;
  notes?: string | null;
  specialNotes?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  imageUrls?: string[];
  audioTranscript?: string | null;
  audioDurationSec?: number | null;
  totalPrice?: number;
  quantity?: number;
  unitPrice?: number;
  priceType?: string;
 customer?: {
    name?: string;
    customerNumber?: string | null;
   address?: string | null;
plz?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
};
  items?: MergeOrderItem[];
}

interface MergeCustomer {
  id: string;
  name: string;
  customerNumber?: string | null;
}

interface MergeOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: MergeOrder[];
  selectedMainOrderId: string | null;
  onSelectMainOrder: (orderId: string) => void;
  selectedCustomerId: string | null;
  onSelectCustomerId: (customerId: string) => void;
  customers: MergeCustomer[];
  previewUrls: Record<string, string[]>;
  audioUrls: Record<string, string>;
  onRemoveOrder: (orderId: string) => void;
  onBack: () => void;
  onNext: () => void;
  currency: Currency;
}

const shortText = (value?: string | null, max = 340) => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
};

const cleanOriginalMessageText = (value?: string | null) => {
  return (value || '')
    .replace(/\[Verbunden von Auftrag [^\]]+\]/g, '')
    .replace(/^WhatsApp:\s*/im, '')
    .trim();
};

const limitOriginalText = (value?: string | null, max = 420) => {
  const text = cleanOriginalMessageText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
};

const formatDate = (date?: string) => {
  if (!date) return '–';
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return '–';

  return dt.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
};

const formatMoney = (amount: number, currency: Currency) => {
  return `${currency} ${amount.toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
const getOrderCurrency = (order: MergeOrder): Currency => {
  return order.currency === 'EUR' ? 'EUR' : 'CHF';
};

const normalizeVatRate = (value?: number | string | null) => {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100) / 100;
};

const getVatRateKey = (order: MergeOrder) =>
  normalizeVatRate(order.vatRate).toFixed(2);

const formatVatPercent = (rate: number) => {
  return rate.toLocaleString('de-CH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const getVatRateLabel = (order: MergeOrder) => {
  const rate = normalizeVatRate(order.vatRate);
  if (rate <= 0) return 'keine MwSt';
  return `${formatVatPercent(rate)} % MwSt`;
};

const isRealCustomerName = (name?: string | null) => {
  const value = (name || '').trim();
  if (!value) return false;

  const lower = value.toLowerCase();

  if (lower.includes('nicht zugeordnet')) return false;
  if (lower.includes('ohne kundenzuordnung')) return false;
  if (lower.startsWith('#k-')) return false;
  if (lower.startsWith('k-')) return false;

  return true;
};
const normalizeCompareValue = (value?: string | null) => {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
};

const normalizePhone = (value?: string | null) => {
  return (value || '')
    .replace(/[^\d+]/g, '')
    .trim();
};

const getCustomerIdentityCompareValue = (order: MergeOrder) => {
  const name = (order.customer?.name || '').trim();
  const customerNumber = (order.customer?.customerNumber || '').trim();

  if (isRealCustomerName(name)) return normalizeCompareValue(name);
  if (customerNumber) return normalizeCompareValue(customerNumber.replace(/^#/, ''));
  if (order.customerId) return normalizeCompareValue(order.customerId.replace(/^#/, ''));

  return '';
};

const hasDifferentProvidedValues = (values: string[]) => {
  return new Set(values.filter(Boolean)).size > 1;
};

const getCustomerFieldConflicts = (orders: MergeOrder[]) => {
  const identityValues = orders.map(getCustomerIdentityCompareValue).filter(Boolean);

  const conflicts: Record<string, boolean> = {
    name: new Set(identityValues).size > 1,
    address: false,
    plz: false,
    city: false,
    phone: false,
    email: false,
  };

  conflicts.address = hasDifferentProvidedValues(
    orders.map((order) => normalizeCompareValue(order.customer?.address)),
  );

  conflicts.plz = hasDifferentProvidedValues(
    orders.map((order) => normalizeCompareValue(order.customer?.plz)),
  );

  conflicts.city = hasDifferentProvidedValues(
    orders.map((order) => normalizeCompareValue(order.customer?.city)),
  );

  conflicts.phone = hasDifferentProvidedValues(
    orders.map((order) => normalizePhone(order.customer?.phone)),
  );

  conflicts.email = hasDifferentProvidedValues(
    orders.map((order) => normalizeCompareValue(order.customer?.email)),
  );

  return conflicts;
};

const hasCustomerIdentityConflictFromFields = (conflicts: Record<string, boolean>) => {
  return Boolean(conflicts.name || conflicts.address || conflicts.plz || conflicts.city);
};

const getContactMergeFields = (orders: MergeOrder[]) => {
  const phones = orders
    .map((order) => normalizePhone(order.customer?.phone))
    .filter(Boolean);

  const emails = orders
    .map((order) => normalizeCompareValue(order.customer?.email))
    .filter(Boolean);

  return {
    phone: new Set(phones).size > 1,
    email: new Set(emails).size > 1,
  };
};

const getReviewCustomerLines = (order?: MergeOrder | null) => {
  if (!order) return ['—'];

  const customer = order.customer;
  const lines = [
    getCustomerLabel(order),
    customer?.address,
    [customer?.plz, customer?.city].filter(Boolean).join(' '),
    customer?.phone ? `Tel. ${customer.phone}` : '',
    customer?.email || '',
  ]
    .map((line) => (line || '').trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : ['—'];
};

const findIdentityConflictSourceOrder = (
  orders: MergeOrder[],
  mainOrder?: MergeOrder,
  conflicts?: Record<string, boolean>,
) => {
  if (!mainOrder || !conflicts) return orders.find((order) => order.id !== mainOrder?.id) || orders[0];

  const fields = ['name', 'address', 'plz', 'city'] as const;

  return (
    orders.find((order) => {
      if (order.id === mainOrder.id) return false;

      return fields.some((field) => {
        if (!conflicts[field]) return false;

        const mainValue = normalizeCompareValue(mainOrder.customer?.[field]);
        const orderValue = normalizeCompareValue(order.customer?.[field]);

        return Boolean(mainValue || orderValue) && mainValue !== orderValue;
      });
    }) ||
    orders.find((order) => order.id !== mainOrder.id) ||
    orders[0]
  );
};

const getReviewServiceExcerpt = (order: MergeOrder) => {
  const items = getOrderItems(order);

  return items
    .slice(0, 2)
    .map((item) => {
      const service = item.serviceName || 'Leistung prüfen';
      const quantity = formatQuantity(item);

      if (!quantity || quantity === '—') return service;
      return `${service} ${quantity}`;
    })
    .join(' + ');
};

const getCustomerLabel = (order: MergeOrder) => {
  const name = (order.customer?.name || '').trim();
  const customerNumber = (order.customer?.customerNumber || '').trim();

  if (isRealCustomerName(name)) return name;
  if (customerNumber) return `#${customerNumber.replace(/^#/, '')}`;
  if (order.customerId) return `#${order.customerId.replace(/^#/, '')}`;

  return 'Ohne Kundenzuordnung';
};

const looksLikeProblemAiHint = (text?: string | null) => {
  const lower = (text || '').toLowerCase();

  return (
    lower.includes('[review-hinweis]') ||
    lower.includes('review-hinweis') ||
    lower.includes('bild ohne beschreibung') ||
    lower.includes('bitte auftrag manuell prüfen') ||
    lower.includes('unbekannte leistung') ||
    lower.includes('leistung prüfen') ||
    lower.includes('manuell prüfen') ||
    lower.includes('ki-hinweis')
  );
};

const getContentInfo = (order: MergeOrder): {
  kind: ContentKind;
  label: string;
  buttonTitle: string;
  buttonLabel: string;
  text: string;
} => {
  const audioText = limitOriginalText(order.audioTranscript, 420);
  if (audioText) {
    return {
      kind: 'original',
      label: 'Text vorhanden',
      buttonTitle: 'Originaltext',
      buttonLabel: 'Inhalt anzeigen',
      text: audioText,
    };
  }

  const noteText = limitOriginalText(order.notes, 420);
  if (noteText) {
    if (looksLikeProblemAiHint(noteText)) {
      return {
        kind: 'ai',
        label: 'KI-Hinweis',
        buttonTitle: 'KI-Hinweis',
        buttonLabel: 'Inhalt anzeigen',
        text: noteText,
      };
    }

    return {
      kind: 'original',
      label: 'Text vorhanden',
      buttonTitle: 'Originaltext',
      buttonLabel: 'Inhalt anzeigen',
      text: noteText,
    };
  }

  const fallbackText = limitOriginalText(order.description || order.specialNotes || null, 420);
  if (fallbackText && looksLikeProblemAiHint(fallbackText)) {
    return {
      kind: 'ai',
      label: 'KI-Hinweis',
      buttonTitle: 'KI-Hinweis',
      buttonLabel: 'Inhalt anzeigen',
      text: fallbackText,
    };
  }

  return {
    kind: 'none',
    label: '',
    buttonTitle: 'Inhalt',
    buttonLabel: 'Kein Inhalt',
    text: '',
  };
};

const getOrderTotal = (order: MergeOrder) => {
  if (order.items && order.items.length > 0) {
    return order.items.reduce((sum, item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unitPrice || 0);
      if (qty <= 0 || price <= 0) return sum;
      return sum + qty * price;
    }, 0);
  }

  const qty = Number(order.quantity || 0);
  const price = Number(order.unitPrice || 0);

  if (qty > 0 && price > 0) return qty * price;

  return Number(order.totalPrice || 0);
};

const getOrderItems = (order: MergeOrder): MergeOrderItem[] => {
  if (order.items && order.items.length > 0) return order.items;

  return [
    {
      serviceName: order.serviceName || order.description || 'Leistung prüfen',
      quantity: Number(order.quantity || 0),
      unit: order.priceType || '',
      unitPrice: Number(order.unitPrice || 0),
    },
  ];
};

const formatQuantity = (item: MergeOrderItem) => {
  const qty = Number(item.quantity || 0);
  const unit = (item.unit || '').trim();

  if (qty <= 0 && !unit) return '—';
  if (qty <= 0) return unit;
  return `${qty} ${unit}`.trim();
};

export default function MergeOrdersDialog({
  open,
  onOpenChange,
  selectedOrders,
  selectedMainOrderId,
  onSelectMainOrder,
  selectedCustomerId,
  onSelectCustomerId,
  previewUrls,
  audioUrls,
  onRemoveOrder,
  onBack,
  onNext,
  currency,
}: MergeOrdersDialogProps) {
  const [expandedInfo, setExpandedInfo] = useState(false);
  const [expandedContent, setExpandedContent] = useState<Record<string, boolean>>({});
  const [largeImageUrl, setLargeImageUrl] = useState<string | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewDetailsOpen, setReviewDetailsOpen] = useState(false);
  const [reviewAccepted, setReviewAccepted] = useState(false);

  if (!open) return null;
const customerFieldConflicts = getCustomerFieldConflicts(selectedOrders);
const hasCustomerConflict = hasCustomerIdentityConflictFromFields(customerFieldConflicts);
const contactMergeFields = getContactMergeFields(selectedOrders);
const hasMergedContactData = Boolean(contactMergeFields.phone || contactMergeFields.email);

 
const selectedCurrencies = Array.from(
  new Set(
    selectedOrders.map((order) => (order.currency || 'CHF').trim()),
  ),
);

const hasCurrencyConflict = selectedCurrencies.length > 1;

  const selectedMainOrder = selectedOrders.find((order) => order.id === selectedMainOrderId);
  const selectedVatRateKeys = Array.from(new Set(selectedOrders.map(getVatRateKey)));
  const hasVatConflict = selectedVatRateKeys.length > 1;
  const referenceVatRateKey = selectedMainOrder
    ? getVatRateKey(selectedMainOrder)
    : selectedOrders[0]
      ? getVatRateKey(selectedOrders[0])
      : '0.00';
  const selectedMainVatLabel = selectedMainOrder
    ? getVatRateLabel(selectedMainOrder)
    : 'keine MwSt';
  const vatSummary = selectedOrders
    .map((order) => `${getCustomerLabel(order)}: ${getVatRateLabel(order)}`)
    .join(' · ');
  const additionalOrders = selectedOrders.filter((order) => order.id !== selectedMainOrderId);
  const reviewOrders = selectedMainOrder
    ? [selectedMainOrder, ...additionalOrders]
    : selectedOrders;
  const reviewSourceOrder = findIdentityConflictSourceOrder(
    selectedOrders,
    selectedMainOrder,
    customerFieldConflicts,
  );
  const reviewCurrency = selectedMainOrder ? getOrderCurrency(selectedMainOrder) : currency;
  const reviewOrdersTotal = reviewOrders.reduce((sum, order) => sum + getOrderTotal(order), 0);
  const additionalOrdersSentence =
    additionalOrders.length === 1
      ? '1 weiterer Auftrag wird mit diesem Hauptauftrag verbunden.'
      : `${additionalOrders.length} weitere Aufträge werden mit diesem Hauptauftrag verbunden.`;
  const reviewOrderCountLabel = `${reviewOrders.length} ${reviewOrders.length === 1 ? 'Auftrag' : 'Aufträge'}`;

  const openReviewDialog = () => {
    setReviewAccepted(false);
    setReviewDetailsOpen(hasCustomerConflict || hasVatConflict);
    setShowReviewDialog(true);
  };

  const confirmMerge = () => {
    if (!reviewAccepted || hasCurrencyConflict || !selectedMainOrderId || !selectedCustomerId) return;

    setShowReviewDialog(false);
    onNext();
  };

  const selectMainOrder = (order: MergeOrder) => {
    onSelectMainOrder(order.id);
    if (order.customerId) onSelectCustomerId(order.customerId);
  };

  const toggleContent = (orderId: string) => {
    setExpandedContent((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-background rounded-2xl border shadow-2xl w-full max-w-[1500px] h-[94vh] overflow-hidden">
        <div className="flex h-full flex-col lg:grid lg:grid-cols-[230px_1fr]">
          <aside
            className={[
              'border-b lg:border-b-0 lg:border-r bg-slate-50 dark:bg-slate-900/40 p-3 lg:p-4 overflow-y-auto',
              expandedInfo ? 'max-h-[38vh]' : 'max-h-[64px]',
              'lg:max-h-none',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => setExpandedInfo((v) => !v)}
              className="lg:hidden w-full flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm font-semibold"
            >
              <span>So funktioniert es</span>
              <span>{expandedInfo ? '▲' : '▼'}</span>
            </button>

            <div className={`${expandedInfo ? 'block' : 'hidden'} lg:block mt-3 lg:mt-0`}>
              <h2 className="hidden lg:block text-base font-bold mb-4">
                So funktioniert es
              </h2>

              <div className="space-y-4 text-xs">
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    1
                  </div>
                  <div>
                    <div className="font-bold leading-4">
                      Hauptauftrag = Text bleibt
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">
                      Dieser Text wird übernommen.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    2
                  </div>
                  <div>
                    <div className="font-bold leading-4">
                      Andere Aufträge
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">
                      Bilder, Audio und Leistungen ergänzen.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    3
                  </div>
                  <div>
                    <div className="font-bold leading-4">
                      Verbundener Auftrag
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">
                      Alle Leistungen werden zusammengeführt.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900 text-xs leading-5">
                <div className="font-bold mb-1">Wichtig</div>
                Nur der Hauptauftrag übernimmt den Originaltext.
              </div>

              <div className="mt-4 border-t pt-3 space-y-2 text-[11px]">
                <div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold">
                    Hauptauftrag
                  </span>
                </div>

                <div>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                    Text vorhanden
                  </span>
                </div>

                <div>
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">
                    KI-Hinweis
                  </span>
                </div>

                <div>
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                    Kunde abweichend
                  </span>
                </div>

                <div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
                    MwSt abweichend
                  </span>
                </div>
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-2 border-b">
                <div className="grid grid-cols-[1fr_auto] lg:grid-cols-[1fr_330px_auto] gap-3 items-start">
                  <div>
                    <h2 className="text-base sm:text-xl font-bold leading-tight">
                      Schritt 2: Hauptauftrag + Kunde festlegen
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                      Hauptauftrag wählen, Kunde prüfen, Leistungen kontrollieren.
                    </p>
                  </div>

{hasCustomerConflict && (
  <div className="col-span-2 lg:col-span-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
    ⚠ Kundendaten abweichend. Name oder Adresse bitte prüfen.
  </div>
)}

{hasCurrencyConflict && (
  <div className="col-span-2 lg:col-span-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
    ⚠ Aufträge mit unterschiedlichen Währungen können nicht verbunden werden.
  </div>
)}

{hasVatConflict && (
  <div className="col-span-2 lg:col-span-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    ⚠ MwSt abweichend. Der verbundene Auftrag nutzt: {selectedMainVatLabel}.
  </div>
)}

                  <button
                    onClick={() => onOpenChange(false)}
                    className="border rounded-lg px-2.5 py-1.5 text-xs sm:text-sm hover:bg-muted shrink-0"
                  >
                    Schließen
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 space-y-2">
                {selectedOrders.map((order) => {
                  const isMain = selectedMainOrderId === order.id;
                  const contentInfo = getContentInfo(order);
                  const images = previewUrls[order.id] || [];
                  const audioUrl = audioUrls[order.id];
                  const items = getOrderItems(order);
                  const total = getOrderTotal(order);
const orderCurrency = getOrderCurrency(order);
const hasDifferentCurrency =
  hasCurrencyConflict && orderCurrency !== getOrderCurrency(selectedMainOrder || order);
const hasDifferentVat =
  hasVatConflict && getVatRateKey(order) !== referenceVatRateKey;

const customer = order.customer;
const showCustomerDetails = hasCustomerConflict;

const fieldMismatch = {
  name: customerFieldConflicts.name,
  address: customerFieldConflicts.address,
  plz: customerFieldConflicts.plz,
  city: customerFieldConflicts.city,
  phone: customerFieldConflicts.phone,
  email: customerFieldConflicts.email,
};

                
                  return (
                    <div
                      key={order.id}
                      onClick={() => selectMainOrder(order)}
                      className={[
                        'rounded-xl border px-3 py-3 transition cursor-pointer',
                        isMain
                          ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-400 shadow-sm'
                          : 'border-slate-200 bg-background hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className="grid grid-cols-[24px_1fr] gap-3">
                        <input
                          type="radio"
                          checked={isMain}
                          onChange={() => selectMainOrder(order)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-5 w-5"
                          aria-label="Als Hauptauftrag auswählen"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <div className="font-bold text-base truncate">
                                {getCustomerLabel(order)}
                              </div>

                              <div className="text-xs text-muted-foreground">
                                {formatDate(order.date || order.createdAt)}
                              </div>

                              {isMain && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold">
                                  Hauptauftrag
                                </span>
                              )}

                              {contentInfo.kind === 'original' && (
                                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold">
                                  Text vorhanden
                                </span>
                              )}

                              {contentInfo.kind === 'ai' && (
                                <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold">
                                  KI-Hinweis
                                </span>
                              )}

{hasCustomerConflict && (
  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
    ⚠️ Kundendaten abweichend
  </span>
)}
{hasDifferentCurrency && (
  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
    Unterschiedliche Währung: {orderCurrency}
  </span>
)}
{hasDifferentVat && (
  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
    MwSt abweichend: {getVatRateLabel(order)}
  </span>
)}
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveOrder(order.id);
                              }}
                              className="text-red-600 text-xs font-semibold hover:underline shrink-0"
                            >
                              Entfernen
                            </button>
                          </div>
{showCustomerDetails && (
  <div className="mt-3 mb-2 text-xs space-y-1">
    {customer?.name && fieldMismatch.name && (
      <div className="flex flex-wrap items-center gap-2">
        <span>{customer.name}</span>
        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
          Name abweichend
        </span>
      </div>
    )}
    
    {customer?.address && (
      <div className="flex flex-wrap items-center gap-2">
        <span>{customer.address}</span>

        {fieldMismatch.address && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
            Straße abweichend
          </span>
        )}
      </div>
    )}

    {(customer?.plz || customer?.city) && (
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {[customer?.plz, customer?.city].filter(Boolean).join(' ')}
        </span>

        {(fieldMismatch.plz || fieldMismatch.city) && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
            Ort/PLZ abweichend
          </span>
        )}
      </div>
    )}

    {customer?.phone && (
      <div className="flex flex-wrap items-center gap-2">
        <span>{customer.phone}</span>

        {fieldMismatch.phone && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
            Telefon abweichend
          </span>
        )}
      </div>
    )}

    {customer?.email && (
      <div className="flex flex-wrap items-center gap-2">
        <span>{customer.email}</span>

        {fieldMismatch.email && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
            E-Mail abweichend
          </span>
        )}
      </div>
    )}
  </div>
)}

                          <div className="mt-3 grid grid-cols-1 xl:grid-cols-[145px_1fr_145px_170px_130px] gap-3 items-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (contentInfo.kind !== 'none') toggleContent(order.id);
                              }}
                              disabled={contentInfo.kind === 'none'}
                              className="rounded-lg border bg-slate-50 hover:bg-slate-100 disabled:opacity-50 px-3 py-2 text-left text-xs"
                            >
                              <div className="font-semibold">
                                {contentInfo.kind === 'ai'
                                  ? 'KI-Hinweis'
                                  : contentInfo.kind === 'original'
                                    ? 'Originaltext'
                                    : 'Kein Inhalt'}
                              </div>
                              <div className="text-muted-foreground">
                                {expandedContent[order.id] ? 'Inhalt ausblenden' : 'Inhalt anzeigen'}
                              </div>
                            </button>

                            <div className="min-w-0">
                              <div className="grid grid-cols-[1fr_110px] xl:grid-cols-[1fr_110px_110px] gap-2 text-xs text-muted-foreground mb-1">
                                <div>Leistungen</div>
                                <div>Menge</div>
                                <div className="hidden xl:block">Einzelpreis</div>
                              </div>

                              <div className="space-y-1">
                                {items.map((item, index) => (
                                  <div
                                    key={`${order.id}-${index}`}
                                    className="grid grid-cols-[1fr_110px] xl:grid-cols-[1fr_110px_110px] gap-2 text-sm"
                                  >
                                    <div className="font-medium truncate">
                                      {item.serviceName || 'Leistung prüfen'}
                                    </div>

                                    <div className="text-muted-foreground">
                                      {formatQuantity(item)}
                                    </div>

                                    <div className="hidden xl:block text-muted-foreground">
                                      {Number(item.unitPrice || 0) > 0
                                        ? formatMoney(Number(item.unitPrice || 0), orderCurrency)
                                        : '—'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 min-w-0">
                              {images.slice(0, 3).map((url, index) => (
                                <button
                                  key={url}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLargeImageUrl(url);
                                  }}
                                  className="shrink-0"
                                >
                                  <img
                                    src={url}
                                    alt={`Bild ${index + 1}`}
                                    className="w-11 h-11 rounded-md object-cover border"
                                  />
                                </button>
                              ))}

                              {audioUrl && (
                                <audio
                                  controls
                                  src={audioUrl}
                                  className="h-8 w-28"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                            </div>

                            <div className="text-right">
                              <div className="font-bold text-base sm:text-lg">
                                {formatMoney(total, orderCurrency)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {getVatRateLabel(order)}
                              </div>
                            </div>
                          </div>

                          {expandedContent[order.id] && (
                            <div
                              className={[
                                'mt-3 rounded-lg border px-3 py-2 text-sm leading-5 whitespace-pre-line',
                                contentInfo.kind === 'ai'
                                  ? 'bg-purple-50 border-purple-100'
                                  : 'bg-slate-50',
                              ].join(' ')}
                            >
                              {contentInfo.text || 'Kein Inhalt vorhanden.'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t px-4 py-3 flex justify-between gap-3 bg-background">
              <button
                onClick={onBack}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                Zurück
              </button>

             <button
  onClick={openReviewDialog}
  disabled={
    !selectedMainOrderId ||
    !selectedCustomerId ||
    hasCurrencyConflict
  }
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Weiter zur Prüfung
              </button>
            </div>
          </main>
        </div>
      </div>

      {showReviewDialog && (
        <div className="fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center p-3 sm:p-6">
          <div className="w-full max-w-[760px] max-h-[92vh] overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 px-4 sm:px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-bold">Aufträge verbinden</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {additionalOrdersSentence}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowReviewDialog(false)}
                className="rounded-lg px-2 py-1 text-xl leading-none hover:bg-muted"
                aria-label="Prüfung schließen"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(92vh-150px)] overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
              {hasVatConflict && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <div className="font-bold">MwSt abweichend</div>
                  <div className="mt-1">
                    Der verbundene Auftrag verwendet den MwSt-Satz des Hauptauftrags: {selectedMainVatLabel}.
                  </div>
                  <div className="mt-2 text-xs leading-5">
                    {vatSummary}
                  </div>
                  <div className="mt-2 text-xs font-semibold">
                    Beim Verbinden wird automatisch eine Prüfnotiz gespeichert.
                  </div>
                </div>
              )}

              {hasCustomerConflict && (
                <div className="rounded-lg border border-red-200 bg-red-50 text-red-900 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setReviewDetailsOpen((value) => !value)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex gap-3">
                      <span className="text-lg leading-none">⚠</span>
                      <div>
                        <div className="font-bold text-sm">Kunden zusammengeführt</div>
                        <div className="mt-1 text-sm text-red-950">
                          Die Kundendaten unterscheiden sich. Bitte prüfen.
                        </div>
                      </div>
                    </div>

                    <span className="text-lg leading-none">
                      {reviewDetailsOpen ? '⌃' : '⌄'}
                    </span>
                  </button>

                  {reviewDetailsOpen && (
                    <div className="mx-4 mb-4 rounded-lg border border-red-100 bg-background/70 p-3">
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-xs text-slate-600 mb-2">
                        <div>Quelle (abweichend)</div>
                        <div>→</div>
                        <div>Hauptkunde (Ziel)</div>
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
                        <div className="rounded-md border border-red-100 bg-red-50/70 p-3 text-sm leading-6">
                          {getReviewCustomerLines(reviewSourceOrder).map((line) => (
                            <div key={`source-${line}`}>{line}</div>
                          ))}
                        </div>

                        <div className="flex items-center text-lg text-slate-500">→</div>

                        <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-3 text-sm leading-6">
                          {getReviewCustomerLines(selectedMainOrder).map((line) => (
                            <div key={`target-${line}`}>{line}</div>
                          ))}
                        </div>
                      </div>

                      {hasMergedContactData && (
                        <div className="mt-3 text-sm">
                          <div className="mb-2 text-slate-700">
                            Folgende Daten wurden zusammengeführt:
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {contactMergeFields.phone && (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                                Telefonnummer
                              </span>
                            )}

                            {contactMergeFields.email && (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                                E-Mail
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!hasCustomerConflict && hasMergedContactData && (
                <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm">
                  <div className="font-semibold">Kontaktdaten werden ergänzt</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {contactMergeFields.phone && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        Telefonnummer
                      </span>
                    )}

                    {contactMergeFields.email && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        E-Mail
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 border-b text-sm">
                  <div className="text-muted-foreground">Kunde</div>
                  <div className="font-semibold leading-6">
                    {getReviewCustomerLines(selectedMainOrder).map((line) => (
                      <div key={`selected-${line}`}>{line}</div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 border-b text-sm">
                  <div className="text-muted-foreground">Hauptauftrag (Ziel)</div>
                  <div className="font-semibold">
                    {selectedMainOrder?.serviceName ||
                      selectedMainOrder?.description ||
                      'Leistung prüfen'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setReviewDetailsOpen((value) => !value)}
                  className="w-full grid grid-cols-[120px_1fr_auto] gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40"
                >
                  <div className="text-muted-foreground">Details anzeigen</div>
                  <div className="font-semibold">{reviewOrderCountLabel}</div>
                  <div>{reviewDetailsOpen ? '⌃' : '⌄'}</div>
                </button>
              </div>

              {reviewDetailsOpen && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-[70px_1fr_130px] gap-3 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                    <div>Auftrag</div>
                    <div>Leistungen (Auszug)</div>
                    <div className="text-right">Betrag</div>
                  </div>

                  {reviewOrders.map((order, index) => {
                    const orderCurrency = getOrderCurrency(order);

                    return (
                      <div
                        key={`review-${order.id}`}
                        className="grid grid-cols-[70px_1fr_130px] gap-3 border-t px-3 py-2 text-sm"
                      >
                        <div className="font-semibold">
                          {index + 1}
                          {order.id === selectedMainOrderId && (
                            <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              Haupt
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 truncate">{getReviewServiceExcerpt(order)}</div>
                        <div className="text-right">
                          <div>{formatMoney(getOrderTotal(order), orderCurrency)}</div>
                          <div className="text-[11px] font-normal text-muted-foreground">
                            {getVatRateLabel(order)}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-[1fr_160px] gap-3 border-t bg-slate-50 px-3 py-3 text-sm font-bold">
                    <div>
                      <div className="text-blue-700">Gesamtsumme (netto)</div>
                      <div className="mt-1 text-[11px] font-normal text-muted-foreground">
                        MwSt-Ziel: {selectedMainVatLabel}
                      </div>
                    </div>
                    <div className="text-right">{formatMoney(reviewOrdersTotal, reviewCurrency)}</div>
                  </div>
                </div>
              )}

              {hasCustomerConflict && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  ⚠ Bitte überprüfe Kunde und Hauptauftrag.
                </div>
              )}

              {hasCurrencyConflict && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  ⚠ Aufträge mit unterschiedlichen Währungen können nicht verbunden werden.
                </div>
              )}

              {hasVatConflict && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                  ⚠ MwSt abweichend. Verbinden ist erlaubt, aber die Prüfnotiz wird gespeichert.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-4 sm:px-6 py-4 bg-background">
              <button
                type="button"
                onClick={() => setShowReviewDialog(false)}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                Abbrechen
              </button>

              <label className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={reviewAccepted}
                  onChange={(event) => setReviewAccepted(event.target.checked)}
                  className="h-4 w-4"
                />
                <span>Ich habe die Auswirkungen geprüft</span>
              </label>

              <button
                type="button"
                onClick={confirmMerge}
                disabled={
                  !reviewAccepted ||
                  hasCurrencyConflict ||
                  !selectedMainOrderId ||
                  !selectedCustomerId
                }
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Verbinden
              </button>
            </div>
          </div>
        </div>
      )}

      {largeImageUrl && (
        <div
          className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLargeImageUrl(null)}
        >
          <img
            src={largeImageUrl}
            alt="Großansicht"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}