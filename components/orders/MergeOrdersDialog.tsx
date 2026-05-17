'use client';

import { useState } from 'react';

type Currency = 'CHF' | 'EUR';

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

const shortText = (value?: string | null, max = 260) => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
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

const getOrderText = (order: MergeOrder) => {
  return shortText(order.notes || order.audioTranscript || null, 320);
};

const hasOriginalText = (order: MergeOrder) => {
  return Boolean(getOrderText(order));
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
      unit: order.priceType || 'Einheit',
      unitPrice: Number(order.unitPrice || 0),
    },
  ];
};

export default function MergeOrdersDialog({
  open,
  onOpenChange,
  selectedOrders,
  selectedMainOrderId,
  onSelectMainOrder,
  selectedCustomerId,
  onSelectCustomerId,
  customers,
  previewUrls,
  audioUrls,
  onRemoveOrder,
  onBack,
  onNext,
  currency,
}: MergeOrdersDialogProps) {
  const [expandedInfo, setExpandedInfo] = useState(false);
  const [expandedContent, setExpandedContent] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const uniqueCustomerIds = Array.from(
    new Set(selectedOrders.map((order) => order.customerId).filter(Boolean)),
  );

  const hasCustomerConflict = uniqueCustomerIds.length > 1;

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

          <aside className="border-b lg:border-b-0 lg:border-r bg-slate-50 dark:bg-slate-900/40 p-3 lg:p-4 overflow-y-auto max-h-[110px] lg:max-h-none">
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
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold">
                    Hauptauftrag
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                    Text vorhanden
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                    Kunde abweichend
                  </span>
                </div>
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold">
                    Schritt 2: Hauptauftrag + Kunde festlegen
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Hauptauftrag wählen, Kunde prüfen, Leistungen kontrollieren.
                  </p>
                </div>

                <button
                  onClick={() => onOpenChange(false)}
                  className="border rounded-lg px-3 py-2 text-sm hover:bg-muted shrink-0"
                >
                  Schließen
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-3">
                {hasCustomerConflict && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    ⚠ Verschiedene Kunden erkannt: Bitte prüfen, ob diese Aufträge wirklich zusammengehören.
                  </div>
                )}

                <div className="rounded-lg border bg-slate-50 px-3 py-2">
                  <label className="block text-xs font-semibold mb-1">
                    Kunde für den verbundenen Auftrag
                  </label>

                  <select
                    value={selectedCustomerId || ''}
                    onChange={(e) => onSelectCustomerId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Kunde auswählen</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                        {customer.customerNumber ? ` (#${customer.customerNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {selectedOrders.map((order) => {
                const isMain = selectedMainOrderId === order.id;
                const text = getOrderText(order);
                const orderHasText = hasOriginalText(order);
                const images = previewUrls[order.id] || [];
                const audioUrl = audioUrls[order.id];
                const items = getOrderItems(order);
                const total = getOrderTotal(order);
                const customerMismatch =
                  hasCustomerConflict &&
                  Boolean(selectedCustomerId) &&
                  order.customerId !== selectedCustomerId;

                return (
                  <div
                    key={order.id}
                    className={[
                      'rounded-xl border px-3 py-3 transition',
                      isMain
                        ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-400'
                        : 'border-slate-200 bg-background',
                    ].join(' ')}
                  >
                    <div className="grid grid-cols-[24px_1fr] gap-3">
                      <input
                        type="radio"
                        checked={isMain}
                        onChange={() => onSelectMainOrder(order.id)}
                        className="mt-1 h-5 w-5"
                        aria-label="Als Hauptauftrag auswählen"
                      />

                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <div className="font-bold text-base truncate">
                              {order.customer?.name || 'Kunde nicht zugeordnet'}
                            </div>

                            <div className="text-xs text-muted-foreground">
                              {formatDate(order.date || order.createdAt)}
                            </div>

                            {isMain && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-semibold">
                                Hauptauftrag
                              </span>
                            )}

                            {orderHasText ? (
                              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold">
                                Text vorhanden
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-semibold">
                                Nur KI-Hinweis
                              </span>
                            )}

                            {customerMismatch && (
                              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">
                                Kunde abweichend
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => onRemoveOrder(order.id)}
                            className="text-red-600 text-xs font-semibold hover:underline shrink-0"
                          >
                            Entfernen
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 xl:grid-cols-[170px_1fr_220px_120px] gap-3 items-center">
                          <button
                            type="button"
                            onClick={() => toggleContent(order.id)}
                            className="rounded-lg border bg-slate-50 hover:bg-slate-100 px-3 py-2 text-left text-xs"
                          >
                            <div className="font-semibold">
                              {orderHasText ? 'Originaltext' : 'KI-Hinweis'}
                            </div>
                            <div className="text-muted-foreground">
                              {expandedContent[order.id] ? 'Inhalt ausblenden' : 'Inhalt anzeigen'}
                            </div>
                          </button>

                          <div className="min-w-0">
                            <div className="grid grid-cols-[1fr_90px_90px] gap-2 text-xs text-muted-foreground mb-1">
                              <div>Leistung</div>
                              <div>Menge</div>
                              <div>Preis</div>
                            </div>

                            <div className="space-y-1">
                              {items.map((item, index) => (
                                <div
                                  key={`${order.id}-${index}`}
                                  className="grid grid-cols-[1fr_90px_90px] gap-2 text-sm"
                                >
                                  <div className="font-medium truncate">
                                    {item.serviceName || 'Leistung prüfen'}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {Number(item.quantity || 0) || '–'} {item.unit || ''}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {Number(item.unitPrice || 0) > 0
                                      ? formatMoney(Number(item.unitPrice || 0), currency)
                                      : 'Prüfen'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 min-w-0">
                            {images.slice(0, 3).map((url, index) => (
                              <img
                                key={url}
                                src={url}
                                alt={`Bild ${index + 1}`}
                                className="w-12 h-12 rounded-md object-cover border"
                              />
                            ))}

                            {audioUrl && (
                              <audio controls src={audioUrl} className="h-8 w-28" />
                            )}
                          </div>

                          <div className="text-right font-bold text-base sm:text-lg">
                            {formatMoney(total, currency)}
                          </div>
                        </div>

                        {expandedContent[order.id] && (
                          <div className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-sm leading-5">
                            {text || 'Kein Text vorhanden.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t px-4 py-3 flex justify-between gap-3">
              <button
                onClick={onBack}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                Zurück
              </button>

              <button
                onClick={onNext}
                disabled={!selectedMainOrderId || !selectedCustomerId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Weiter zur Prüfung
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}