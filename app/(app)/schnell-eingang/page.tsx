'use client';
import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { MessageSquarePlus, Loader2, CheckCircle2, ArrowRight, Sparkles, ClipboardPaste, User, Wrench, AlertTriangle, RotateCcw, Mic, ImagePlus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface Analysis {
  customerName: string;
  customerPhone: string | null;
  customerStreet: string | null;
  customerPlz: string | null;
  customerCity: string | null;
  customerEmail: string | null;
  customerAddress?: string | null;
  serviceName: string;
  description: string;
  estimatedQuantity: number;
  unit: string;
  unitPrice: number;
  totalEstimate: number;
  specialNotes: string;
  existingCustomerId: string | null;
  // Hardened matching v2
  matchVerdict?: string; // 'auto_assign' | 'bestaetigungs_treffer' | 'moeglicher_treffer' | 'kein_treffer'
  matchReason?: string;
  suggestedCustomerId?: string | null;
}

type Step = 'input' | 'preview' | 'done';

const unitLabels: Record<string, string> = {
  'Stunde': 'Stunden', 'Meter': 'Meter', 'Stück': 'Stück', 'Pauschal': 'Menge',
};

export default function SchnellEingangPage() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [editableAnalysis, setEditableAnalysis] = useState<Analysis | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ orderId: string } | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>('image/jpeg');
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [uploadedMediaUrl, setUploadedMediaUrl] = useState<string | null>(null);
  const [uploadedMediaType, setUploadedMediaType] = useState<string | null>(null);

  // Match confirmation state (hardened v2)
  const [userConfirmedMatch, setUserConfirmedMatch] = useState(false);
  const [userRejectedMatch, setUserRejectedMatch] = useState(false);

  const uploadMediaToS3 = async (file: File): Promise<string | null> => {
    try {
      const res = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, isPublic: false }),
      });
      const { uploadUrl, cloud_storage_path } = await res.json();
      const headers: Record<string, string> = { 'Content-Type': file.type };
      if (uploadUrl.includes('content-disposition')) {
        headers['Content-Disposition'] = 'attachment';
      }
      await fetch(uploadUrl, { method: 'PUT', headers, body: file });
      return cloud_storage_path;
    } catch (e) {
      console.error('Upload error:', e);
      return null;
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setTranscribing(true);
    toast.info('Sprachnachricht wird transkribiert...');
    try {
      const mediaPath = await uploadMediaToS3(file);
      if (mediaPath) { setUploadedMediaUrl(mediaPath); setUploadedMediaType('audio'); }
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Transkription fehlgeschlagen'); return; }
      setMessage(prev => prev ? `${prev}\n\n[Sprachnachricht]: ${data.text}` : `[Sprachnachricht]: ${data.text}`);
      toast.success('Sprachnachricht transkribiert!');
    } catch { toast.error('Fehler bei der Transkription'); } finally { setTranscribing(false); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImageMimeType(file.type);
    const mediaPath = await uploadMediaToS3(file);
    if (mediaPath) { setUploadedMediaUrl(mediaPath); setUploadedMediaType('image'); }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setImagePreview(result);
      setImageBase64(result.split(',')[1]);
    };
    reader.readAsDataURL(file);
    toast.success('Bild hinzugefügt');
  };

  const analyzeMessage = useCallback(async (text: string) => {
    if (!text.trim() && !imageBase64) return;
    setLoading(true);
    try {
      const body: any = { message: text, action: 'analyze' };
      if (imageBase64) { body.imageBase64 = imageBase64; body.imageMimeType = imageMimeType; }
      const res = await fetch('/api/quick-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Fehler'); return; }
      setAnalysis(data.analysis);
      setEditableAnalysis({ ...data.analysis });
      setStep('preview');
      toast.success('Nachricht analysiert!');
    } catch { toast.error('Verbindungsfehler'); } finally { setLoading(false); }
  }, [imageBase64, imageMimeType]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setMessage(text); toast.success('Text eingefügt -- wird analysiert...'); analyzeMessage(text); }
    } catch { toast.error('Einfügen fehlgeschlagen -- bitte manuell (Ctrl+V)'); }
  };

  const handleManualSubmit = () => {
    if (!message.trim() && !imageBase64) { toast.error('Bitte Nachricht oder Bild einfügen'); return; }
    analyzeMessage(message);
  };

  const handleCreate = async () => {
    if (!editableAnalysis) return;
    setCreating(true);
    try {
      // Build the analysis to send — handle match confirmation
      const analysisToSend = { ...editableAnalysis };
      const needsConfirmation = editableAnalysis.matchVerdict === 'bestaetigungs_treffer' || editableAnalysis.matchVerdict === 'moeglicher_treffer';

      if (userRejectedMatch || (needsConfirmation && !userConfirmedMatch)) {
        // User rejected or didn't confirm → force new customer creation
        analysisToSend.existingCustomerId = null;
      } else if (userConfirmedMatch && editableAnalysis.suggestedCustomerId) {
        // User explicitly confirmed → send the suggested ID
        analysisToSend.existingCustomerId = editableAnalysis.suggestedCustomerId;
      }

      const res = await fetch('/api/quick-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          analysis: analysisToSend,
          originalMessage: message,
          mediaUrl: uploadedMediaUrl,
          mediaType: uploadedMediaType,
          userConfirmedMatch: userConfirmedMatch && !userRejectedMatch,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Fehler'); return; }
      setResult({ orderId: data.order.id });
      setStep('done');
      toast.success('Auftrag erstellt!');
    } catch { toast.error('Verbindungsfehler'); } finally { setCreating(false); }
  };

  const handleReset = () => {
    setMessage(''); setAnalysis(null); setEditableAnalysis(null); setResult(null);
    setAudioFile(null); setImageFile(null); setImagePreview(null); setImageBase64(null);
    setUploadedMediaUrl(null); setUploadedMediaType(null);
    setUserConfirmedMatch(false); setUserRejectedMatch(false);
    setStep('input');
  };

  const updateField = (field: keyof Analysis, value: string | number) => {
    if (!editableAnalysis) return;
    const updated = { ...editableAnalysis, [field]: value };
    if (field === 'estimatedQuantity' || field === 'unitPrice') {
      updated.totalEstimate = Number(updated.unitPrice) * Number(updated.estimatedQuantity);
    }
    setEditableAnalysis(updated);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold tracking-tight">Schnell-Eingang</h2>
        <p className="text-muted-foreground mt-1">WhatsApp-Nachricht, Sprachnachricht oder Bild &rarr; Auftrag erstellen</p>
      </div>

      <AnimatePresence mode="wait">
        {step === 'input' && (
          <motion.div key="input" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-display">
                  <MessageSquarePlus className="w-5 h-5 text-primary" /> Nachricht einf&uuml;gen
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-accent/50 rounded-lg p-4">
                  <p className="text-sm font-medium mb-2">So funktioniert es:</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>WhatsApp-Nachricht <strong>kopieren &amp; einf&uuml;gen</strong></li>
                    <li>Optional: <strong>Sprachnachricht</strong> oder <strong>Bild</strong> hochladen</li>
                    <li>KI analysiert alles automatisch</li>
                  </ol>
                </div>

                <Button variant="outline" className="w-full gap-2 h-12 text-base" onClick={handlePaste} disabled={loading || transcribing}>
                  <ClipboardPaste className="w-5 h-5" /> Aus Zwischenablage einf&uuml;gen &amp; analysieren
                </Button>

                <Textarea
                  placeholder={'WhatsApp-Nachricht hier einfügen...'}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="resize-none text-base"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
                    <Button variant="outline" className="w-full gap-2" onClick={() => audioInputRef.current?.click()} disabled={transcribing || loading}>
                      {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                      {transcribing ? 'Transkribiert...' : 'Sprachnachricht'}
                    </Button>
                    {audioFile && <p className="text-xs text-muted-foreground mt-1 truncate">{audioFile.name}</p>}
                  </div>
                  <div>
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    <Button variant="outline" className="w-full gap-2" onClick={() => imageInputRef.current?.click()} disabled={loading}>
                      <ImagePlus className="w-4 h-4" /> Bild hochladen
                    </Button>
                  </div>
                </div>

                {imagePreview && (
                  <div className="relative w-full max-h-48 overflow-hidden rounded-lg border">
                    <img src={imagePreview} alt="Vorschau" className="w-full h-48 object-cover" />
                    <button className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1" onClick={() => { setImageFile(null); setImagePreview(null); setImageBase64(null); }}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <Button className="w-full gap-2 h-12 text-base" onClick={handleManualSubmit} disabled={loading || transcribing || (!message.trim() && !imageBase64)}>
                  {loading ? (<><Loader2 className="w-5 h-5 animate-spin" /> KI analysiert...</>) : (<><Sparkles className="w-5 h-5" /> Analysieren &amp; Auftrag vorbereiten</>)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'preview' && editableAnalysis && (
          <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-primary" />
                  <div>
                    <h3 className="font-display font-bold text-lg">KI-Analyse abgeschlossen</h3>
                    <p className="text-sm text-muted-foreground">Pr&uuml;fen und bei Bedarf anpassen.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-display flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Kunde</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-xs text-muted-foreground">Name</Label><Input value={editableAnalysis.customerName} onChange={(e) => updateField('customerName', e.target.value)} /></div>
                  <div><Label className="text-xs text-muted-foreground">Telefon</Label><Input value={editableAnalysis.customerPhone ?? ''} onChange={(e) => updateField('customerPhone', e.target.value)} /></div>
                </div>
                <div><Label className="text-xs text-muted-foreground">Strasse + Hausnr.</Label><Input value={editableAnalysis.customerStreet ?? ''} onChange={(e) => updateField('customerStreet', e.target.value)} /></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><Label className="text-xs text-muted-foreground">PLZ</Label><Input value={editableAnalysis.customerPlz ?? ''} onChange={(e) => updateField('customerPlz', e.target.value)} /></div>
                  <div><Label className="text-xs text-muted-foreground">Ort</Label><Input value={editableAnalysis.customerCity ?? ''} onChange={(e) => updateField('customerCity', e.target.value)} /></div>
                  <div><Label className="text-xs text-muted-foreground">E-Mail</Label><Input value={editableAnalysis.customerEmail ?? ''} onChange={(e) => updateField('customerEmail', e.target.value)} /></div>
                </div>
              </CardContent>
            </Card>

            {/* ═══ MATCH CONFIRMATION BANNER (hardened v2) ═══ */}
            {editableAnalysis.suggestedCustomerId && (editableAnalysis.matchVerdict === 'bestaetigungs_treffer' || editableAnalysis.matchVerdict === 'moeglicher_treffer') && !userRejectedMatch && (
              <Card className={`border-amber-300 dark:border-amber-700 ${userConfirmedMatch ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${userConfirmedMatch ? 'text-green-600' : 'text-amber-600'}`} />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-display font-bold text-sm">
                        {userConfirmedMatch ? '✅ Kundenzuordnung bestätigt' : 'Möglicher bestehender Kunde erkannt'}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {editableAnalysis.matchVerdict === 'bestaetigungs_treffer'
                          ? 'Name und Adresse stimmen überein, aber kein eindeutiges Signal (Telefon/E-Mail). Bitte bestätigen oder als neuen Kunden anlegen.'
                          : 'Mögliche Übereinstimmung gefunden. Bitte prüfen und bestätigen oder als neuen Kunden anlegen.'}
                      </p>
                      {!userConfirmedMatch && (
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="default" className="h-8 text-xs gap-1" onClick={() => { setUserConfirmedMatch(true); toast.success('Kundenzuordnung bestätigt'); }}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Ja, gleicher Kunde
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => { setUserRejectedMatch(true); toast.info('Neuer Kunde wird angelegt'); }}>
                            <X className="w-3.5 h-3.5" /> Nein, neuer Kunde
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {userRejectedMatch && editableAnalysis.suggestedCustomerId && (
              <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-600" />
                    <span>Ein <strong>neuer Kunde</strong> wird angelegt.</span>
                    <button className="text-blue-600 underline ml-auto text-xs" onClick={() => { setUserRejectedMatch(false); setUserConfirmedMatch(false); }}>Rückgängig</button>
                  </p>
                </CardContent>
              </Card>
            )}
            {editableAnalysis.existingCustomerId && editableAnalysis.matchVerdict === 'auto_assign' && (
              <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Bestehender Kunde erkannt ({editableAnalysis.matchReason === 'phone_match' ? 'Telefonnummer' : editableAnalysis.matchReason === 'email_match' ? 'E-Mail' : 'Signal'} stimmt überein).</span>
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-display flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" /> Leistung &amp; Preis</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-xs text-muted-foreground">Leistung</Label><Input value={editableAnalysis.serviceName} onChange={(e) => updateField('serviceName', e.target.value)} /></div>
                  <div><Label className="text-xs text-muted-foreground">Beschreibung</Label><Input value={editableAnalysis.description} onChange={(e) => updateField('description', e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs text-muted-foreground">Preis/Einheit (CHF)</Label><Input type="number" step="0.05" value={editableAnalysis.unitPrice} onChange={(e) => updateField('unitPrice', Number(e.target.value))} /></div>
                  <div><Label className="text-xs text-muted-foreground">{unitLabels[editableAnalysis.unit] ?? editableAnalysis.unit}</Label><Input type="number" step="0.25" value={editableAnalysis.estimatedQuantity} onChange={(e) => updateField('estimatedQuantity', Number(e.target.value))} /></div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Einheit</Label>
                    <select className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-10" value={editableAnalysis.unit} onChange={(e) => updateField('unit', e.target.value)}>
                      <option value="Stunde">Stunde</option><option value="Meter">Meter</option><option value="Stück">Stück</option><option value="Pauschal">Pauschal</option>
                    </select>
                  </div>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg flex items-center justify-between">
                  <span className="font-medium">Gesch&auml;tzter Total</span>
                  <span className="font-mono font-bold text-xl text-primary">CHF {(Number(editableAnalysis.unitPrice) * Number(editableAnalysis.estimatedQuantity)).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-display flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> Besonderheiten</CardTitle></CardHeader>
              <CardContent>
                <textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y" rows={2} placeholder="z.B. Hanglage, Hund, schwierige Zufahrt..." value={editableAnalysis.specialNotes} onChange={(e) => updateField('specialNotes', e.target.value)} />
              </CardContent>
            </Card>

            <Button className="w-full gap-2 h-14 text-base" onClick={handleCreate} disabled={creating}>
              {creating ? (<><Loader2 className="w-5 h-5 animate-spin" /> Wird erstellt...</>) : (<><CheckCircle2 className="w-5 h-5" /> Auftrag erstellen</>)}
            </Button>
            <Button variant="ghost" className="w-full gap-2" onClick={() => setStep('input')} disabled={creating}>
              <RotateCcw className="w-4 h-4" /> Zur&uuml;ck
            </Button>
          </motion.div>
        )}

        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                  <div>
                    <h3 className="font-display font-bold text-lg text-green-800 dark:text-green-200">Auftrag erstellt!</h3>
                    <p className="text-sm text-green-600 dark:text-green-400">Der Auftrag wurde erfolgreich angelegt.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/auftraege"><Button className="w-full gap-2"><ArrowRight className="w-4 h-4" /> Zu den Auftr&auml;gen</Button></Link>
              <Button variant="outline" className="gap-2" onClick={handleReset}><MessageSquarePlus className="w-4 h-4" /> N&auml;chste Nachricht</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
