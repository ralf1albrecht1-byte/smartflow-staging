'use client';
import { useEffect, useState } from 'react';
import { Trash2, RotateCcw, Loader2, ClipboardList, FileCheck, FileText, Users, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface TrashItem {
  id: string;
  type: 'order' | 'offer' | 'invoice' | 'customer';
  title: string;
  subtitle: string;
  deletedAt: string;
}

export default function PapierkorbPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/papierkorb');
      const data = await res.json();
      const all: TrashItem[] = [];

      (data.orders ?? []).forEach((o: any) => {
        all.push({
          id: o.id,
          type: 'order',
          title: `Auftrag: ${o.description || o.serviceName || 'Ohne Titel'}`,
          subtitle: o.customer?.name || 'Unbekannter Kunde',
          deletedAt: o.deletedAt,
        });
      });

      (data.offers ?? []).forEach((o: any) => {
        const desc = o.items?.map((i: any) => i.description).filter(Boolean).join(', ') || 'Ohne Titel';
        all.push({
          id: o.id,
          type: 'offer',
          title: `Angebot ${o.offerNumber}: ${desc}`,
          subtitle: o.customer?.name || 'Unbekannter Kunde',
          deletedAt: o.deletedAt,
        });
      });

      (data.invoices ?? []).forEach((o: any) => {
        const desc = o.items?.map((i: any) => i.description).filter(Boolean).join(', ') || 'Ohne Titel';
        all.push({
          id: o.id,
          type: 'invoice',
          title: `Rechnung ${o.invoiceNumber}: ${desc}`,
          subtitle: o.customer?.name || 'Unbekannter Kunde',
          deletedAt: o.deletedAt,
        });
      });

      (data.customers ?? []).forEach((c: any) => {
        all.push({
          id: c.id,
          type: 'customer',
          title: `Kunde: ${c.name}`,
          subtitle: [c.address, c.city].filter(Boolean).join(', ') || c.phone || 'Keine Details',
          deletedAt: c.deletedAt,
        });
      });

      // Sort by deletedAt desc
      all.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
      setItems(all);
    } catch { toast.error('Fehler beim Laden'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const restore = async (item: TrashItem) => {
    setActionId(item.id);
    try {
      const res = await fetch('/api/papierkorb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', type: item.type, id: item.id }),
      });
      if (res.ok) { toast.success('Wiederhergestellt!'); load(); }
      else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Fehler beim Wiederherstellen');
        // Reload so stale list (item no longer in trash) self-corrects
        load();
      }
    } catch { toast.error('Fehler beim Wiederherstellen'); } finally { setActionId(null); }
  };

  const deletePermanently = async (item: TrashItem) => {
    // Show type + title so user sees what they are about to hard-delete and
    // cannot confuse this with "Wiederherstellen"
    const label = `${typeLabel(item.type)}: ${item.title}`;
    if (!confirm(`Endgültig löschen?\n\n${label}\n\nDies kann nicht rückgängig gemacht werden!`)) return;
    setActionId(item.id);
    try {
      const res = await fetch('/api/papierkorb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', type: item.type, id: item.id }),
      });
      if (res.ok) { toast.success('Endgültig gelöscht'); load(); }
      else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Fehler beim Löschen');
        // Reload so stale list (item no longer in trash / or blocked) self-corrects
        load();
      }
    } catch { toast.error('Fehler beim Löschen'); } finally { setActionId(null); }
  };

  const emptyTrash = async () => {
    if (!confirm('Gesamten Papierkorb leeren? Dies kann nicht rückgängig gemacht werden!')) return;
    setActionId('empty');
    try {
      const res = await fetch('/api/papierkorb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'empty' }),
      });
      if (res.ok) { toast.success('Papierkorb geleert'); load(); }
      else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Fehler beim Leeren');
      }
    } catch { toast.error('Fehler beim Leeren'); } finally { setActionId(null); }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'order': return <ClipboardList className="w-4 h-4 text-orange-600" />;
      case 'offer': return <FileCheck className="w-4 h-4 text-blue-600" />;
      case 'invoice': return <FileText className="w-4 h-4 text-green-600" />;
      case 'customer': return <Users className="w-4 h-4 text-purple-600" />;
      default: return null;
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case 'order': return 'Auftrag';
      case 'offer': return 'Angebot';
      case 'invoice': return 'Rechnung';
      case 'customer': return 'Kunde';
      default: return type;
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trash2 className="w-7 h-7 text-muted-foreground" /> Papierkorb
          </h1>
          <p className="text-muted-foreground mt-1">
            {items.length} Elemente &middot; Automatische Leerung nach 6 Monaten
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="destructive" size="sm" onClick={emptyTrash} disabled={actionId === 'empty'}>
            {actionId === 'empty' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
            Papierkorb leeren
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <Trash2 className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-lg">Papierkorb ist leer</p>
          <p className="text-muted-foreground text-sm mt-1">Gelöschte Elemente werden hier angezeigt</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div key={`${item.type}-${item.id}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
              <Card>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs flex items-center gap-1">
                          {typeIcon(item.type)}{typeLabel(item.type)}
                        </Badge>
                        <h3 className="font-semibold text-sm truncate">{item.title}</h3>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-muted-foreground">{item.subtitle}</span>
                        <span className="text-muted-foreground">{"Gelöscht: "}{new Date(item.deletedAt).toLocaleDateString('de-CH')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => restore(item)} disabled={actionId === item.id} title="Wiederherstellen">
                        {actionId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                        <span className="hidden sm:inline ml-1">Wiederherstellen</span>
                      </Button>
                      {/* Distinct destructive style so "Endgültig löschen" is never confused with Wiederherstellen, especially on mobile */}
                      <Button variant="destructive" size="sm" onClick={() => deletePermanently(item)} disabled={actionId === item.id} title="Endgültig löschen">
                        <Trash2 className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1">Endgültig löschen</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}