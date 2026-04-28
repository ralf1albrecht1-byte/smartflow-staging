'use client';
import { useEffect, useState } from 'react';
import { Wrench, Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface Service { id: string; name: string; defaultPrice: number; unit: string; }
const emptyForm = { name: '', defaultPrice: '', unit: 'Stunde' };

export default function LeistungenPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => fetch('/api/services').then(r => r.json()).then(d => { setServices(d ?? []); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditId(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (s: Service) => { setEditId(s?.id); setForm({ name: s?.name ?? '', defaultPrice: String(s?.defaultPrice ?? 0), unit: s?.unit ?? 'Stunde' }); setDialogOpen(true); };

  const save = async () => {
    if (!form?.name?.trim()) { toast.error('Bezeichnung ist erforderlich'); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/services/${editId}` : '/api/services';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, defaultPrice: Number(form?.defaultPrice ?? 0) }) });
      if (res.ok) { toast.success(editId ? 'Leistung aktualisiert' : 'Leistung erstellt'); setDialogOpen(false); load(); }
      else toast.error('Fehler');
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Leistung wirklich löschen?')) return;
    await fetch(`/api/services/${id}`, { method: 'DELETE' });
    toast.success('Leistung gelöscht'); load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Wrench className="w-7 h-7 text-primary" /> Leistungskatalog</h1>
          <p className="text-muted-foreground mt-1">Vordefinierte Leistungen und Preise</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Neue Leistung</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services?.length === 0 ? <p className="col-span-full text-center text-muted-foreground py-8">Keine Leistungen vorhanden</p> :
          services.map((s: Service, i: number) => (
            <motion.div key={s?.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{s?.name ?? ''}</h3>
                      <p className="font-mono text-lg font-bold text-primary mt-1">CHF {Number(s?.defaultPrice ?? 0).toFixed(2)}</p>
                      <Badge variant="secondary" className="mt-2">{s?.unit ?? ''}</Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(s?.id)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Leistung bearbeiten' : 'Neue Leistung'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Bezeichnung *</Label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e?.target?.value ?? '' })} /></div>
            <div><Label>Standardpreis (CHF)</Label><Input type="number" step="0.05" value={form.defaultPrice} onChange={(e: any) => setForm({ ...form, defaultPrice: e?.target?.value ?? '' })} /></div>
            <div>
              <Label>Einheit</Label>
              <select className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.unit} onChange={(e: any) => setForm({ ...form, unit: e?.target?.value ?? 'Stunde' })}>
                <option value="Stunde">Stunde</option>
                <option value="Pauschal">Pauschal</option>
                <option value="Meter">Meter</option>
                <option value="Stück">Stück</option>
                
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Speichern...' : 'Speichern'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
