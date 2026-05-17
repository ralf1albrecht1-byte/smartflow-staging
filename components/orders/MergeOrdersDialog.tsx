'use client';

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

const shortText = (value?: string | null, max = 180) => {
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
  return shortText(order.notes || order.audioTranscript || null, 260);
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
  if (!open) return null;

  const selectedCustomer = selectedCustomerId
    ? customers.find((c) => c.id === selectedCustomerId)
    : undefined;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl border shadow-2xl w-full max-w-7xl h-[90vh] overflow-hidden">
        <div className="grid grid-cols-[300px_1fr] h-full">

          <aside className="border-r bg-slate-50 dark:bg-slate-900/40 p-4 overflow-y-auto text-sm">
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold">
                  So funktioniert es:
                </h2>
              </div>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    1
                  </div>
                  <div>
                    <div className="font-bold">
                      Hauptauftrag = Text bleibt erhalten
                    </div>
                    <p className="text-xs leading-5 mt-1">
                      Der Hauptauftrag ist der Auftrag, der einen Text enthält.
                      Diesen Text übernehmen wir in den verbundenen Auftrag.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    2
                  </div>
                  <div>
                    <div className="font-bold">
                      Andere Aufträge = Bilder + KI-Hinweise
                    </div>
                    <p className="text-xs leading-5 mt-1">
                      Aufträge ohne Text ergänzen den Hauptauftrag um zusätzliche
                      Leistungen, Bilder oder Audio-Hinweise.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    3
                  </div>
                  <div>
                    <div className="font-bold">
                      Im verbundenen Auftrag
                    </div>
                    <p className="text-xs leading-5 mt-1">
                      Nach dem Zusammenführen bleibt der Text des Hauptauftrags
                      erhalten. Alle erkannten Leistungen werden zusammengeführt.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
                <div className="font-bold mb-2">
                  Wichtig:
                </div>
                <p className="text-sm leading-6">
                  Nur der Hauptauftrag enthält einen Originaltext. Dieser Text
                  bleibt im verbundenen Auftrag erhalten.
                </p>
              </div>

              <div className="border-t pt-5 space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-xs font-semibold">
                    Hauptauftrag
                  </span>
                  <span>Enthält Text und wird übernommen</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                    Text vorhanden
                  </span>
                  <span>Originaltext ist enthalten</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
                    Nur KI-Hinweis
                  </span>
                  <span>Kein Originaltext, nur KI-Vorschlag</span>
                </div>
              </div>
            </div>
          </aside>

          <main className="p-6 overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold">
                  Schritt 2: Hauptauftrag + Kunde festlegen
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Wähle den Hauptauftrag. Bilder, Textvorschau und Audio-Hinweise
                  helfen dir beim Abgleich.
                </p>
              </div>

              <button
                onClick={() => onOpenChange(false)}
                className="border rounded-lg px-3 py-2 text-sm hover:bg-muted"
              >
                Schließen
              </button>
            </div>

            <div className="space-y-3">
              {selectedOrders.map((order) => {
                const isMain = selectedMainOrderId === order.id;
                const text = getOrderText(order);
                const orderHasText = hasOriginalText(order);
                const images = previewUrls[order.id] || [];
                const audioUrl = audioUrls[order.id];
                const items = getOrderItems(order);
                const total = getOrderTotal(order);

                return (
                  <div
                    key={order.id}
                    className={[
                      'rounded-xl border px-4 py-3 transition',
                      isMain
                        ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-400'
                        : 'border-slate-200 bg-background',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="radio"
                        checked={isMain}
                        onChange={() => onSelectMainOrder(order.id)}
                        className="mt-1 h-5 w-5"
                        aria-label="Als Hauptauftrag auswählen"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="font-bold text-lg">
                                {order.customer?.name || 'Kunde nicht zugeordnet'}
                              </div>

                              <div className="text-sm text-muted-foreground">
                                {formatDate(order.date || order.createdAt)}
                              </div>

                              {isMain && (
                                <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-xs font-semibold">
                                  Hauptauftrag
                                </span>
                              )}

                              {orderHasText ? (
                                <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                                  Text vorhanden
                                </span>
                              ) : (
                                <span className="px-2 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
                                  Nur KI-Hinweis
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => onRemoveOrder(order.id)}
                            className="text-red-600 text-sm font-semibold hover:underline"
                          >
                            Entfernen
                          </button>
                        </div>

                        {isMain && text && (
                          <div className="mt-3 rounded-lg border bg-background px-3 py-2 text-sm leading-5">
                            <div className="font-medium mb-1">
                              Originaltext wird übernommen:
                            </div>
                            <div>{text}</div>
                          </div>
                        )}

                        {!isMain && text && (
                          <div className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-sm leading-5">
                            <div className="font-medium mb-1">
                              Textvorschau:
                            </div>
                            <div>{text}</div>
                          </div>
                        )}

                        <div className="mt-3 space-y-1">
                          {items.map((item, index) => (
                            <div
                              key={`${order.id}-${index}`}
                              className="grid grid-cols-[1fr_140px_120px] gap-3 text-sm"
                            >
                              <div className="font-medium truncate">
                                {item.serviceName || 'Leistung prüfen'}
                              </div>
                              <div className="text-muted-foreground">
                                {Number(item.quantity || 0) || '–'} {item.unit || ''}
                              </div>
                              <div className="text-right text-muted-foreground">
                                {Number(item.unitPrice || 0) > 0
                                  ? formatMoney(Number(item.unitPrice || 0), currency)
                                  : 'Preis prüfen'}
                              </div>
                            </div>
                          ))}
                        </div>

                        {images.length > 0 && (
                          <div className="mt-4 flex gap-2 flex-wrap">
                            {images.map((url, index) => (
                              <img
                                key={url}
                                src={url}
                                alt={`Bild ${index + 1}`}
                                className="w-14 h-14 rounded-lg object-cover border"
                              />
                            ))}
                          </div>
                        )}

                        {audioUrl && (
                          <div className="mt-4">
                            <audio controls src={audioUrl} className="w-full" />
                          </div>
                        )}
                      </div>

                      <div className="w-32 text-right font-bold text-lg self-end">
                        {formatMoney(total, currency)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-xl bg-slate-50 border p-4">
              <label className="block text-sm font-semibold mb-2">
                Kunde für den verbundenen Auftrag:
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

            <div className="mt-6 flex justify-between">
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