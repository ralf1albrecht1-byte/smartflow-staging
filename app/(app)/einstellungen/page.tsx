'use client';
import { useEffect, useState, useRef } from 'react';
import {
  Settings, Save, Loader2, Sparkles, Building2, CreditCard, ChevronDown, ChevronUp,
  FlaskConical, RotateCcw, AlertTriangle, Phone, LifeBuoy, Trash2, LogOut, KeyRound,
  Eye, EyeOff, FileText, Languages, User2, ShieldCheck, UploadCloud, Image as ImageIcon,
  CheckCircle2, XCircle, Palette, ScrollText, Database, Send, FileX, Lock, Globe, Info,
  Download, Clock, AlertCircle, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { signOut, useSession } from 'next-auth/react';
import { normalizePhoneE164 } from '@/lib/normalize';

interface CompanyData {
  firmenname: string;
  firmaRechtlich: string | null;
  ansprechpartner: string | null;
  telefon: string | null;
  telefon2: string | null;
  email: string | null;
  supportEmail: string | null;
  webseite: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  iban: string | null;
  bank: string | null;
  mwstAktiv: boolean;
  mwstNummer: string | null;
  mwstSatz: number | null;
  mwstHinweis: string | null;
  testModus: boolean;
  branche: string;
  hauptsprache: string;
  // Settings/Templates/Import paket additions
  documentTemplate: string;
  letterheadUrl: string | null;
  letterheadName: string | null;
  letterheadVisible: boolean;
  // WhatsApp intake
  whatsappIntakeNumber: string | null;
}

const emptyData: CompanyData = {
  firmenname: '',
  firmaRechtlich: null,
  ansprechpartner: null,
  telefon: null,
  telefon2: null,
  email: null,
  supportEmail: null,
  webseite: null,
  strasse: null,
  hausnummer: null,
  plz: null,
  ort: null,
  iban: null,
  bank: null,
  mwstAktiv: false,
  mwstNummer: null,
  mwstSatz: null,
  mwstHinweis: null,
  testModus: true,
  branche: 'Gartenbau',
  hauptsprache: 'Deutsch',
  documentTemplate: 'classic',
  whatsappIntakeNumber: null,
  letterheadUrl: null,
  letterheadName: null,
  letterheadVisible: true,
};

const branchenOptionen = ['Gartenbau', 'Maler', 'Elektriker', 'Bau', 'Reinigung', 'Sonstiges'];
const sprachOptionen = ['Deutsch', 'Englisch', 'Französisch', 'Italienisch', 'Türkisch', 'Russisch', 'Spanisch', 'Portugiesisch', 'Arabisch'];

const TEMPLATES: Array<{ key: string; label: string; tagline: string; swatch: string }> = [
  { key: 'classic', label: 'Klassisch', tagline: 'Grüner Akzent · aktuelles Standard-Layout', swatch: '#059669' },
  { key: 'modern',  label: 'Modern',    tagline: 'Dunkler Kopfbalken · sachlich',              swatch: '#0f172a' },
  { key: 'minimal', label: 'Minimal',   tagline: 'Schwarz / Weiß · grosse Leeren',             swatch: '#111111' },
  { key: 'elegant', label: 'Elegant',   tagline: 'Serifen · warmer Braunton',                  swatch: '#78350f' },
];

const SECTIONS = [
  { key: 'daten',           label: 'Meine Daten',                icon: User2 },
  { key: 'telefon',         label: 'WhatsApp Eingang',           icon: Phone },
  { key: 'dokumente',       label: 'Dokumente & Rechnungen',     icon: FileText },
  { key: 'sprache',         label: 'Sprache & Kommunikation',    icon: Languages },
  { key: 'support',         label: 'Tool-Support',               icon: LifeBuoy },
  { key: 'nummern',         label: 'Nummern & Testmodus',        icon: FlaskConical },
  { key: 'konto',           label: 'Konto & Sicherheit',         icon: ShieldCheck },
  { key: 'datenschutz',     label: 'Rechtliches & Datenschutz',  icon: ScrollText },
  { key: 'daten_kuendigung', label: 'Daten & Kündigung',         icon: Database },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

/**
 * Paket A: UI-side normalization is a THIN wrapper around the shared
 * `normalizePhoneE164` (single source of truth in `lib/normalize.ts`).
 */
function normalizePhone(val: string): string {
  const canonical = normalizePhoneE164(val);
  if (canonical) return canonical;
  return val.replace(/[\s\-\(\)]/g, '');
}

export default function EinstellungenPage() {
  const { data: session } = useSession() || {};
  const [form, setForm] = useState<CompanyData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [hasChanges, setHasChanges] = useState(false);
  const [savedData, setSavedData] = useState<CompanyData>(emptyData);
  const [resetting, setResetting] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteSection, setShowDeleteSection] = useState(false);

  // Paket A: per-field validation errors for phone numbers (and extensible)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Password change
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // Section navigation (desktop: side-nav; mobile: accordion)
  const [activeSection, setActiveSection] = useState<SectionKey>('daten');
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    daten: true, telefon: false, dokumente: false, nummern: false, sprache: false, support: false, konto: false,
    datenschutz: false, daten_kuendigung: false,
  });
// Letterhead upload state
  const letterheadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLetterhead, setUploadingLetterhead] = useState(false);

  // Block N: Datenschutz / Daten & Kündigung state
  const [consentRecords, setConsentRecords] = useState<Array<any>>([]);
  const [complianceRequests, setComplianceRequests] = useState<Array<any>>([]);
  const [acceptingType, setAcceptingType] = useState<string | null>(null);
  const [requestingType, setRequestingType] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [confirmCancel, setConfirmCancel] = useState('');
  // Block T-auto — UI-State für den Datenexport-Download.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadCompliance();
  }, []);

  async function loadCompliance() {
    try {
      const [c1, c2] = await Promise.all([
        fetch('/api/compliance/consent').then(r => r.ok ? r.json() : { records: [] }),
        fetch('/api/compliance/requests').then(r => r.ok ? r.json() : { requests: [] }),
      ]);
      setConsentRecords(c1.records || []);
      setComplianceRequests(c2.requests || []);
    } catch {
      /* ignore — compliance is best-effort */
    }
  }

  async function acceptDocument(documentType: 'privacy' | 'terms' | 'avv') {
    setAcceptingType(documentType);
    try {
      const res = await fetch('/api/compliance/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, documentVersion: 'v1-Vorlage' }),
      });
      if (res.ok) {
        toast({ title: 'Akzeptanz gespeichert.' });
        loadCompliance();
      } else {
        const data = await res.json().catch(() => null);
        toast({ title: data?.error || 'Fehler beim Speichern', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', variant: 'destructive' });
    } finally {
      setAcceptingType(null);
    }
  }

  async function fileComplianceRequest(type: 'data_export' | 'data_deletion' | 'account_cancellation') {
    setRequestingType(type);
    try {
      const res = await fetch('/api/compliance/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        // Block T-fix / T-auto — sichtbare, eindeutige Erfolgsbestätigung je Typ.
        // Beim Datenexport prüfen wir zusätzlich, ob die Pipeline ZIP+Mail
        // synchron erfolgreich war, um den Toast präziser zu formulieren.
        let successMsg: string;
        try {
          const j = await res.clone().json();
          const r = j?.request || {};
          if (type === 'data_export') {
            if (r.exportFileKey && r.exportReadyAt) {
              successMsg =
                'Datenexport ist bereit. Du findest den Download unter "Meine Anfragen". Eine Bestätigung wurde an deine E-Mail gesendet.';
            } else if (r.exportGenerationError) {
              successMsg =
                'Datenexport-Anfrage wurde gesendet. Die Vorbereitung läuft noch oder wird vom Support bearbeitet.';
            } else {
              successMsg =
                'Datenexport-Anfrage wurde gesendet. Wir bereiten deinen Export vor.';
            }
          } else if (type === 'data_deletion') {
            successMsg = 'Löschanfrage wurde gesendet. Wir prüfen sie manuell.';
          } else {
            successMsg = 'Kündigungsanfrage wurde gesendet. Wir prüfen sie und melden uns.';
          }
        } catch {
          successMsg =
            type === 'data_export'
              ? 'Datenexport-Anfrage wurde gesendet. Wir bereiten deinen Export vor.'
              : type === 'data_deletion'
              ? 'Löschanfrage wurde gesendet. Wir prüfen sie manuell.'
              : 'Kündigungsanfrage wurde gesendet. Wir prüfen sie und melden uns.';
        }
        toast({ title: successMsg });
        setConfirmDelete('');
        setConfirmCancel('');
        loadCompliance();
      } else if (res.status === 409) {
        // Block T-fix2 — Typ- und Status-spezifische Hinweise. Für data_export
        // unterscheiden wir zusätzlich nach exportFileKey/exportReadyAt /
        // exportGenerationError, damit der Nutzer weiss, ob er einfach unten
        // herunterladen kann oder noch warten muss.
        const dupBody = await res.clone().json().catch(() => null);
        const exportState = dupBody?.existingExportState as
          | {
              exportFileKey: string | null;
              exportReadyAt: string | null;
              exportExpiresAt: string | null;
              downloadedAt: string | null;
              exportGenerationError: string | null;
            }
          | null
          | undefined;

        if (type === 'data_export') {
          const ready = !!exportState?.exportFileKey && !!exportState?.exportReadyAt;
          const expired =
            !!exportState?.exportExpiresAt &&
            new Date(exportState.exportExpiresAt).getTime() < Date.now();
          if (exportState?.exportGenerationError) {
            toast({
              title: 'Datenexport-Vorbereitung läuft',
              description:
                'Die Vorbereitung deines Datenexports konnte noch nicht abgeschlossen werden. Bitte versuche es später erneut oder kontaktiere den Support.',
              variant: 'destructive',
            });
          } else if (ready && !expired) {
            toast({
              title: 'Dein Datenexport ist bereits bereit',
              description:
                'Du findest den Download unten unter „Meine Anfragen".',
            });
          } else {
            toast({
              title: 'Dein Datenexport wird bereits vorbereitet',
              description:
                'Wir bereiten deinen Datenexport gerade vor. Sobald er bereit ist, kannst du ihn unten herunterladen und du erhältst zusätzlich eine E-Mail.',
            });
          }
        } else if (type === 'data_deletion') {
          toast({
            title: 'Bereits offene Löschanfrage',
            description:
              'Du hast bereits eine offene oder laufende Löschanfrage. Du musst keine neue Anfrage senden.',
          });
        } else if (type === 'account_cancellation') {
          toast({
            title: 'Bereits offene Kündigungsanfrage',
            description:
              'Du hast bereits eine offene oder laufende Kündigungsanfrage. Du musst keine neue Anfrage senden.',
          });
        } else {
          toast({
            title: 'Bereits offene oder laufende Anfrage',
            description:
              'Es gibt bereits eine offene oder laufende Anfrage dieses Typs. Du musst keine neue Anfrage senden.',
          });
        }
        loadCompliance();
      } else {
        const data = await res.json().catch(() => null);
        toast({ title: data?.error || 'Fehler beim Senden der Anfrage', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', variant: 'destructive' });
    } finally {
      setRequestingType(null);
    }
  }

  /**
   * Block T-auto — Datenexport herunterladen.
   *
   * Streamt die ZIP-Datei (privates S3) hinter Auth aus dem Server-Endpoint.
   * Wir verwenden bewusst einen <a download>-Klick und KEIN fetch+blob, um
   * Iframe-/CORS-Probleme im Preview zu vermeiden.
   * Bei 410 (abgelaufen) oder anderen Fehlern wird die Liste aktualisiert.
   */
  async function downloadDataExport(req: any) {
    if (!req?.id) return;
    setDownloadingId(req.id);
    try {
      // HEAD-ähnlicher Vorab-Check über GET (Server liefert sonst die Bytes
      // direkt). Wir öffnen den Download über ein <a>-Element, das einen
      // sauberen Browser-Download triggert.
      const a = document.createElement('a');
      a.href = `/api/compliance/requests/${encodeURIComponent(req.id)}/download`;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Liste nach kurzem Delay neu laden, um downloadedAt anzuzeigen.
      setTimeout(() => {
        loadCompliance();
        setDownloadingId(null);
      }, 1500);
    } catch (e) {
      toast({ title: 'Download fehlgeschlagen', variant: 'destructive' });
      setDownloadingId(null);
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const mapped: CompanyData = mapSettingsData(data);
        setForm(mapped);
        setSavedData(mapped);
      }
    } catch (e) {
      console.error('Fehler beim Laden:', e);
    } finally {
      setLoading(false);
    }
  }

  function updateField(field: keyof CompanyData, value: any) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      setHasChanges(JSON.stringify(next) !== JSON.stringify(savedData));
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setFieldErrors({});
    try {
      // Client-side pre-check — catch the "same number twice" case
      // before hitting the API, so we give instant feedback without a round-trip.
      const t1 = form.whatsappIntakeNumber ? normalizePhoneE164(form.whatsappIntakeNumber) : null;
      const t2 = form.telefon2 ? normalizePhoneE164(form.telefon2) : null;
      if (t1 && t2 && t1 === t2) {
        setFieldErrors({ telefon2: 'Hauptnummer und Zweitnummer dürfen nicht identisch sein.' });
        toast({ title: 'Fehler', description: 'Hauptnummer und Zweitnummer dürfen nicht identisch sein.', variant: 'destructive' });
        setSaving(false);
        return;
      }

      // Send raw values — server is the source of truth for normalization & validation.
      const payload = { ...form };

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const mapped: CompanyData = mapSettingsData(data);
        setForm(mapped);
        setSavedData(mapped);
        setHasChanges(false);
        toast({ title: '✅ Gespeichert', description: 'Einstellungen wurden aktualisiert.' });
      } else {
        let errorJson: any = null;
        try { errorJson = await res.json(); } catch { /* ignore non-JSON */ }
        const msg: string = errorJson?.error || 'Speichern fehlgeschlagen.';
        const field: string | undefined = errorJson?.field;
        if (field) {
          setFieldErrors({ [field]: msg });
        }
        toast({ title: res.status === 409 ? 'Konflikt' : 'Fehler', description: msg, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', description: 'Netzwerkfehler.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function mapSettingsData(data: any): CompanyData {
    const mapped: CompanyData = {
      firmenname: data.firmenname || '',
      firmaRechtlich: data.firmaRechtlich || null,
      ansprechpartner: data.ansprechpartner || null,
      telefon: data.telefon || null,
      telefon2: data.telefon2 || null,
      email: data.email || null,
      supportEmail: data.supportEmail || null,
      webseite: data.webseite || null,
      strasse: data.strasse || null,
      hausnummer: data.hausnummer || null,
      plz: data.plz || null,
      ort: data.ort || null,
      iban: data.iban || null,
      bank: data.bank || null,
      mwstAktiv: data.mwstAktiv ?? false,
      mwstNummer: data.mwstNummer || null,
      mwstSatz: data.mwstSatz ?? null,
      mwstHinweis: data.mwstHinweis || null,
      testModus: data.testModus ?? true,
      branche: data.branche || 'Gartenbau',
      hauptsprache: data.hauptsprache || 'Deutsch',
      documentTemplate: data.documentTemplate || 'classic',
      whatsappIntakeNumber: data.whatsappIntakeNumber || null,
      letterheadUrl: data.letterheadUrl || data.logoUrl || data.companyLogo || data.companyLogoUrl || null,
      letterheadName: data.letterheadName || null,
      letterheadVisible:
        data.letterheadVisible !== undefined
          ? data.letterheadVisible !== false
          : data.logoVisible !== undefined
            ? data.logoVisible !== false
            : data.showLogo !== false,
    };

    return mapped;
  }

  // ─── Letterhead upload ───
  // HOTFIX 2026-04-18: The visible letterhead is rendered by the PDF engine
  // via a plain <img src="…"> tag (see lib/pdf-templates.ts → letterheadImg).
  // Only public image URLs (PNG / JPEG / WebP) render. PDFs CANNOT be embedded
  // as an <img> and therefore never appeared on generated documents even when
  // "uploaded" here — this was misleading. Letterhead upload is now strictly
  // image-only; PDF upload is available separately under "Daten aus Dokument
  // erkennen" for extraction (and does NOT become the visible letterhead).
  async function handleLetterheadUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Datei zu groß', description: 'Max. 10 MB erlaubt.', variant: 'destructive' });
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast({
        title: 'Format nicht unterstützt',
        description: 'Nur Bilder (PNG, JPEG, WebP) können als sichtbares Briefpapier / Logo eingebunden werden.',
        variant: 'destructive',
      });
      return;
    }
    setUploadingLetterhead(true);
    try {
      const signRes = await fetch('/api/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Letterhead images must be publicly accessible so the PDF engine can embed them.
        body: JSON.stringify({ fileName: file.name, contentType: file.type, isPublic: true }),
      });
      if (!signRes.ok) throw new Error('presign failed');
      const { uploadUrl, publicUrl } = await signRes.json();

      const putHeaders: Record<string, string> = { 'Content-Type': file.type };
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: putHeaders, body: file });
      if (!putRes.ok) throw new Error(`upload failed (${putRes.status})`);

      // Must be a public URL so the PDF engine's <img src=…> can resolve it.
      if (!publicUrl) throw new Error('public URL missing for letterhead upload');
      const storedValue = publicUrl;

      updateField('letterheadUrl', storedValue);
      updateField('letterheadName', file.name);
      toast({ title: '✅ Hochgeladen', description: 'Briefpapier wurde hinterlegt. Jetzt speichern, um zu übernehmen.' });
    } catch (e) {
      console.error('letterhead upload failed', e);
      toast({ title: 'Fehler', description: 'Upload fehlgeschlagen.', variant: 'destructive' });
    } finally {
      setUploadingLetterhead(false);
    }
  }

  function handleLetterheadRemove() {
    updateField('letterheadUrl', null);
    updateField('letterheadName', null);
    toast({ title: 'Entfernt', description: 'Briefpapier wurde entfernt. Speichern nicht vergessen.' });
  }

  // ─── KI data-import paths ───
  // Both "Daten aus Dokument erkennen" (file upload) and "KI-Import aus Text"
  // (freitext) UI blocks have been removed from the settings page. The related
  // API routes (/api/settings/extract-document and /api/settings/parse) are kept
  // on the server for potential future use, but are no longer wired to any UI.


  async function handlePasswordChange() {
    if (!currentPassword || !newPassword) {
      toast({ title: 'Hinweis', description: 'Bitte alle Felder ausfüllen.', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: 'Fehler', description: 'Neues Passwort muss mindestens 8 Zeichen lang sein.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: 'Fehler', description: 'Neue Passwörter stimmen nicht überein.', variant: 'destructive' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast({ title: '✅ Passwort geändert', description: 'Dein Passwort wurde erfolgreich aktualisiert.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setShowPasswordSection(false);
      } else {
        const err = await res.json();
        toast({ title: 'Fehler', description: err.error || 'Passwort ändern fehlgeschlagen.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', description: 'Netzwerkfehler.', variant: 'destructive' });
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deleteConfirmEmail) {
      toast({ title: 'Hinweis', description: 'Bitte E-Mail zur Bestätigung eingeben.', variant: 'destructive' });
      return;
    }
    if (deleteConfirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase()) {
      toast({ title: 'Fehler', description: 'E-Mail stimmt nicht überein.', variant: 'destructive' });
      return;
    }
    if (!confirm('⚠️ ACHTUNG: Dein gesamtes Konto und alle Daten (Aufträge, Kunden, Rechnungen, Angebote) werden unwiderruflich gelöscht.\n\nBist du sicher?')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: deleteConfirmEmail }),
      });
      if (res.ok) {
        toast({ title: 'Konto gelöscht', description: 'Dein Konto wurde gelöscht. Du wirst abgemeldet.' });
        setTimeout(() => signOut({ callbackUrl: '/login' }), 1500);
      } else {
        const err = await res.json();
        toast({ title: 'Fehler', description: err.error || 'Löschen fehlgeschlagen.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', description: 'Netzwerkfehler.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Navigation handler used by the desktop side-nav AND the mobile accordion.
   *
   * Desktop (`lg:`): SectionShell hides all but the active section, so clicking
   * a nav item makes it the sole visible section. A gentle smooth scroll to top
   * avoids awkward mid-page scroll positions when switching to a short section.
   *
   * Mobile (`<lg`): all sections stay in the DOM (accordion). We also open the
   * clicked section so tapping a nav item reveals its content immediately.
   */
  function gotoSection(key: SectionKey) {
    setActiveSection(key);
    setOpenSections(prev => ({ ...prev, [key]: true }));
    // Scroll the page to the top so the active section is fully in view.
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Block T-fix2 — Hilfsvariablen für aktive Compliance-Anfragen, damit wir
  // sowohl Buttons disablen als auch verständliche Inline-Hinweise anzeigen
  // können. „Aktiv blockierend" bedeutet open ODER in_progress.
  // Sonderfall data_export: ein abgelaufener Export blockiert NICHT (siehe
  // Backend, das in diesem Fall eine neue Anfrage erlaubt).
  const _now = Date.now();
  const activeExportRequest = (complianceRequests || []).find((r: any) => {
    if (r.type !== 'data_export') return false;
    if (r.status !== 'open' && r.status !== 'in_progress') return false;
    const exp = r.exportExpiresAt ? new Date(r.exportExpiresAt).getTime() : null;
    // Wenn schon abgelaufen, gilt sie nicht mehr als blockierend.
    if (exp !== null && exp < _now) return false;
    return true;
  });
  const activeDeletionRequest = (complianceRequests || []).find(
    (r: any) =>
      r.type === 'data_deletion' &&
      (r.status === 'open' || r.status === 'in_progress'),
  );
  const activeCancellationRequest = (complianceRequests || []).find(
    (r: any) =>
      r.type === 'account_cancellation' &&
      (r.status === 'open' || r.status === 'in_progress'),
  );

  // Datums-Formatter (de-CH, dd.MM.yyyy, HH:mm).
  const fmtDate = (d: string | Date | null | undefined): string => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleString('de-CH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Einstellungen</h2>
            <p className="text-sm text-muted-foreground">Firmendaten, Dokumente &amp; Konto verwalten</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Side nav (desktop only) */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-1 border rounded-lg bg-card p-2">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const active = activeSection === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => gotoSection(s.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                    active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main content — min-w-0 prevents 1fr grid column from expanding
             beyond its available width when child content (template cards,
             logo row, notices) has large intrinsic width. */}
        <main className="space-y-5 min-w-0">
          {/* SECTION: MEINE DATEN */}
          <SectionShell id="daten" sectionKey="daten" activeSection={activeSection} open={openSections.daten} toggle={() => setOpenSections(p => ({ ...p, daten: !p.daten }))} title="Meine Daten / Geschäft" icon={User2}>
            <div className="space-y-4">
              {/* Firmendaten */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Firmenname *</Label>
                  <Input value={form.firmenname} onChange={e => updateField('firmenname', e.target.value)} placeholder="Firmenname" />
                </div>
                <div>
                  <Label>Rechtlicher Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input value={form.firmaRechtlich || ''} onChange={e => updateField('firmaRechtlich', e.target.value || null)} placeholder="Rechtlicher Name" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Ansprechpartner</Label>
                  <Input value={form.ansprechpartner || ''} onChange={e => updateField('ansprechpartner', e.target.value || null)} placeholder="Vor- und Nachname" />
                </div>
                <div>
                  <Label>Webseite</Label>
                  <Input value={form.webseite || ''} onChange={e => updateField('webseite', e.target.value || null)} placeholder="https://www.beispiel.ch" />
                </div>
              </div>

              {/* Branche — gently emphasised container: this field changes how the KI
                  interprets incoming messages, so we want it visually distinct
                  from plain input fields without being loud. */}
              <div className="border-l-4 border-primary/40 bg-primary/5 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <Label className="mb-0">Branche</Label>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary">Wirkt auf KI</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Wird von der KI verwendet, um Aufträge, Preise und Fachbegriffe korrekt zu interpretieren. Nach einem Wechsel bitte speichern.
                </p>
                <select
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.branche}
                  onChange={(e) => updateField('branche', e.target.value)}
                >
                  {branchenOptionen.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Adresse */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <Label>Strasse</Label>
                  <Input value={form.strasse || ''} onChange={e => updateField('strasse', e.target.value || null)} placeholder="Strasse" />
                </div>
                <div>
                  <Label>Hausnummer</Label>
                  <Input value={form.hausnummer || ''} onChange={e => updateField('hausnummer', e.target.value || null)} placeholder="Nr." />
                </div>
                <div />
                <div>
                  <Label>PLZ</Label>
                  <Input value={form.plz || ''} onChange={e => updateField('plz', e.target.value || null)} placeholder="PLZ" />
                </div>
                <div className="md:col-span-2">
                  <Label>Ort</Label>
                  <Input value={form.ort || ''} onChange={e => updateField('ort', e.target.value || null)} placeholder="Ort" />
                </div>
              </div>

              {/* Kundenkontakt-Mail */}
              <div>
                <Label>Kontakt-E-Mail (erscheint auf Angeboten &amp; Rechnungen)</Label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Diese E-Mail-Adresse wird auf Dokumenten als Kontaktadresse für Kunden-Rückfragen angezeigt.
                </p>
                <Input type="email" value={form.email || ''} onChange={e => updateField('email', e.target.value || null)} placeholder="E-Mail-Adresse" />
              </div>

              {/* Geschäftliche Telefonnummer */}
              <div>
                <Label>Geschäftliche Telefonnummer <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Diese Nummer erscheint auf Angeboten und Rechnungen.
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="telefon-same-as-whatsapp"
                    checked={!!form.whatsappIntakeNumber && form.telefon === form.whatsappIntakeNumber}
                    onChange={e => {
                      if (e.target.checked && form.whatsappIntakeNumber) {
                        updateField('telefon', form.whatsappIntakeNumber);
                      } else {
                        updateField('telefon', null);
                      }
                    }}
                    className="rounded border-input"
                  />
                  <label htmlFor="telefon-same-as-whatsapp" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Gleiche Nummer wie WhatsApp-Hauptnummer verwenden
                  </label>
                </div>
                <Input
                  value={form.telefon || ''}
                  onChange={e => updateField('telefon', e.target.value || null)}
                  placeholder="+41 76 123 45 67"
                  disabled={!!form.whatsappIntakeNumber && form.telefon === form.whatsappIntakeNumber}
                  onBlur={e => {
                    if (e.target.value) updateField('telefon', normalizePhone(e.target.value));
                  }}
                />
              </div>
            </div>
          </SectionShell>

          {/* SECTION: WHATSAPP EINGANG */}
          <SectionShell id="telefon" sectionKey="telefon" activeSection={activeSection} open={openSections.telefon} toggle={() => setOpenSections(p => ({ ...p, telefon: !p.telefon }))} title="WhatsApp Eingang" icon={Phone}>
            <p className="text-xs text-muted-foreground">
              Sende WhatsApp-Nachrichten an diese Nummer. Daraus erstellt Smartflow automatisch Aufträge. Bitte im internationalen Format angeben (z.B. +41 76 123 45 67).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>
                  Hauptnummer <span className="text-destructive text-xs font-normal">*</span>
                </Label>
                <Input
                  value={form.whatsappIntakeNumber || ''}
                  onChange={e => {
                    updateField('whatsappIntakeNumber', e.target.value || null);
                    if (fieldErrors.whatsappIntakeNumber) setFieldErrors(prev => ({ ...prev, whatsappIntakeNumber: '' }));
                  }}
                  placeholder="+41 76 123 45 67"
                  aria-invalid={!!fieldErrors.whatsappIntakeNumber}
                  className={fieldErrors.whatsappIntakeNumber ? 'border-destructive focus-visible:ring-destructive' : ''}
                  onBlur={e => {
                    if (e.target.value) updateField('whatsappIntakeNumber', normalizePhone(e.target.value));
                  }}
                />
                {fieldErrors.whatsappIntakeNumber && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.whatsappIntakeNumber}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sende WhatsApp-Nachrichten an diese Nummer. Daraus erstellt Smartflow automatisch Aufträge.
                </p>
              </div>
              <div>
                <Label>
                  Zweitnummer <span className="text-muted-foreground text-xs font-normal">(optional)</span>
                </Label>
                <Input
                  value={form.telefon2 || ''}
                  onChange={e => {
                    updateField('telefon2', e.target.value || null);
                    if (fieldErrors.telefon2) setFieldErrors(prev => ({ ...prev, telefon2: '' }));
                  }}
                  placeholder="Zweite Nummer (Fallback)"
                  aria-invalid={!!fieldErrors.telefon2}
                  className={fieldErrors.telefon2 ? 'border-destructive focus-visible:ring-destructive' : ''}
                  onBlur={e => {
                    if (e.target.value) updateField('telefon2', normalizePhone(e.target.value));
                  }}
                />
                {fieldErrors.telefon2 && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.telefon2}</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Optional — wird zusätzlich zur Hauptnummer für die Zuordnung herangezogen.
                </p>
              </div>
            </div>

            {/* Smartflow-System-Info — read-only, nicht editierbar */}
            <div className="mt-5 pt-4 border-t border-border/50">
              <div className="rounded-md border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <Info className="w-4 h-4 text-blue-700 dark:text-blue-300" aria-hidden />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">WhatsApp-Auftragseingang</p>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-0.5 border border-amber-200 dark:border-amber-800/50">
                        Vorbereitung läuft
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-blue-900/90 dark:text-blue-100/90 space-y-1.5">
                      <p>
                        <span className="font-medium">Geplante Eingangsnummer:</span>{' '}
                        <span className="font-mono font-semibold tracking-wide select-all">+1 814 292 9741</span>
                      </p>
                      <p>
                        Diese Nummer wird aktuell für WhatsApp Business eingerichtet. Sobald die Freigabe abgeschlossen ist, können Kundenanfragen, Bilder und Sprachnachrichten an diese Nummer weitergeleitet werden.
                      </p>
                      <p className="text-[11px] text-blue-800/80 dark:text-blue-200/80 pt-1">
                        Hinweis: Diese Information wird zentral von Smartflow gepflegt und kann nicht im Account geändert werden.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionShell>

          {/* SECTION: DOKUMENTE & RECHNUNGEN (IBAN + MWST + Template + Letterhead + Extract) */}
          <SectionShell id="dokumente" sectionKey="dokumente" activeSection={activeSection} open={openSections.dokumente} toggle={() => setOpenSections(p => ({ ...p, dokumente: !p.dokumente }))} title="Dokumente &amp; Rechnungen" icon={FileText}>
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 mb-4">
              ℹ️ <span className="font-medium">Hinweis:</span> Änderungen an MwSt- und Rechnungsdaten gelten nur für zukünftige Dokumente. Bestehende Angebote und Rechnungen bleiben unverändert und müssen bei Bedarf manuell angepasst werden.
            </div>

            {/* IBAN + Bank */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>IBAN</Label>
                <Input value={form.iban || ''} onChange={e => updateField('iban', e.target.value || null)} placeholder="IBAN" />
              </div>
              <div>
                <Label>Bank</Label>
                <Input value={form.bank || ''} onChange={e => updateField('bank', e.target.value || null)} placeholder="Name der Bank" />
              </div>
            </div>

            {/* MWST Toggle */}
            <div className="border rounded-lg p-4 space-y-3 mt-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !form.mwstAktiv;
                    updateField('mwstAktiv', newVal);
                    if (!newVal) {
                      updateField('mwstNummer', null);
                      updateField('mwstSatz', null);
                      updateField('mwstHinweis', 'Nicht MWST-pflichtig');
                    } else {
                      updateField('mwstHinweis', null);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.mwstAktiv ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.mwstAktiv ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium">MWST-pflichtig</p>
                  <p className="text-xs text-muted-foreground">
                    {form.mwstAktiv ? 'MWST wird auf Rechnungen ausgewiesen' : 'Nicht MWST-pflichtig'}
                  </p>
                </div>
              </div>

              {form.mwstAktiv && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <Label>MWST-Nummer / UID</Label>
                    <Input value={form.mwstNummer || ''} onChange={e => updateField('mwstNummer', e.target.value || null)} placeholder="MWST-Nr. / UID" />
                  </div>
                  <div>
                    <Label>MWST-Satz (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={form.mwstSatz ?? ''}
                      onChange={e => updateField('mwstSatz', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="Satz in Prozent"
                    />
                  </div>
                </div>
              )}

              {!form.mwstAktiv && (
                <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
                  Hinweis auf Rechnungen: &quot;{form.mwstHinweis || 'Nicht MWST-pflichtig'}&quot;
                </p>
              )}
            </div>

            {/* Dokument-Vorlage (Template picker) */}
            <div className="border rounded-lg p-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <Palette className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Dokument-Vorlage</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Wird für alle neu generierten Angebote und Rechnungen verwendet. Wechsel wirkt ab dem nächsten PDF.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {TEMPLATES.map(t => {
                  const selected = form.documentTemplate === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => updateField('documentTemplate', t.key)}
                      className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                        selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-5 h-5 rounded-full border" style={{ background: t.swatch }} />
                        <span className="text-sm font-semibold">{t.label}</span>
                        {selected && <CheckCircle2 className="w-4 h-4 text-primary ml-auto" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t.tagline}</p>
                      {t.key === 'classic' && (
                        <span className="inline-block mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Standard</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Briefpapier / Logo upload (images only — this is the VISIBLE letterhead) */}
            <div className="border rounded-lg p-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <ImageIcon className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Sichtbares Briefpapier / Logo</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Bild hochladen (PNG, JPEG oder WebP). Erscheint auf erzeugten Angeboten und Rechnungen als Kopf-Logo.
              </p>

              {form.letterheadUrl ? (
                <div className="flex items-start gap-3 bg-muted/40 rounded-md p-3">
                  <img
                    src={form.letterheadUrl}
                    alt="Briefpapier Vorschau"
                    className="h-16 w-auto object-contain bg-white rounded border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{form.letterheadName || 'Aktuelles Briefpapier'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{form.letterheadUrl}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleLetterheadRemove} className="gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Entfernen
                  </Button>
                </div>
              ) : (
                <div className="border border-dashed rounded-lg p-4 text-center">
                  <UploadCloud className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground mb-2">Noch kein Briefpapier hinterlegt</p>
                </div>
              )}

              <div className="mt-3">
                <input
                  ref={letterheadInputRef}
                  type="file"
                  /* Image formats only — see handleLetterheadUpload comment for rationale. */
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleLetterheadUpload(f);
                    if (letterheadInputRef.current) letterheadInputRef.current.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingLetterhead}
                  onClick={() => letterheadInputRef.current?.click()}
                  className="gap-2"
                >
                  {uploadingLetterhead ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {form.letterheadUrl ? 'Ersetzen' : 'Bild hochladen'}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-2">Erlaubt: PNG, JPEG, WebP · max. 10 MB</p>
              </div>

              {/* Sichtbarkeits-Toggle — unabhängig vom Upload, damit Nutzer das
                  Briefpapier temporär ausblenden können, ohne es zu löschen. */}
              <div className="mt-4 pt-4 border-t flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateField('letterheadVisible', !form.letterheadVisible)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.letterheadVisible ? 'bg-primary' : 'bg-muted'}`}
                  aria-label="Logo / Kopfbild auf Dokumenten anzeigen"
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.letterheadVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium">Logo / Kopfbild auf Dokumenten anzeigen</p>
                  <p className="text-xs text-muted-foreground">
                    {form.letterheadVisible
                      ? (form.letterheadUrl ? 'Das Bild erscheint auf neu erzeugten Angeboten und Rechnungen.' : 'Aktiv — es ist aktuell kein Bild hinterlegt. Lade oben eines hoch.')
                      : 'Aus — Angebote und Rechnungen werden ohne Kopf-Logo erzeugt.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Dokument-Vorschau (A4 Mockup) — rein visuell, kein echtes PDF.
                Spiegelt Template-Farbe, Logo (sofern hochgeladen & sichtbar)
                und Firmennamen wider, damit Nutzer den Effekt vor dem Speichern
                einschätzen können. */}
            <div className="border rounded-lg p-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Dokument-Vorschau</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Visuelle Vorschau des Briefkopfs. Aktualisiert sich live bei Änderungen an Vorlage, Logo und Sichtbarkeit.
              </p>
              {(() => {
                const selectedTemplate = TEMPLATES.find(t => t.key === form.documentTemplate) || TEMPLATES[0];
                const showLogo = !!form.letterheadUrl && form.letterheadVisible;
                const addrLine = [form.strasse, form.hausnummer].filter(Boolean).join(' ');
                const plzLine = [form.plz, form.ort].filter(Boolean).join(' ');

                return (
                  <div className="flex justify-center bg-muted/30 rounded-md p-4">
                    <div
                      className="relative bg-white shadow-md rounded-sm overflow-hidden"
                      style={{ width: '260px', aspectRatio: '210 / 297' }}
                    >
                      {/* Template accent bar */}
                      <div
                        className="absolute top-0 left-0 right-0"
                        style={{ height: '6px', background: selectedTemplate.swatch }}
                      />
                      {/* Header area */}
                      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: selectedTemplate.swatch }}>Angebot</p>
                          <p className="text-[7px] text-gray-500">ANG-2026-001</p>
                        </div>
                        {showLogo ? (
                          <img
                            src={form.letterheadUrl!}
                            alt="Logo Vorschau"
                            className="max-h-8 max-w-[70px] object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <p className="text-[9px] font-bold text-gray-800 text-right truncate max-w-[100px]">
                            {form.firmenname || 'Firmenname'}
                          </p>
                        )}
                      </div>
                      {/* Company address block */}
                      <div className="px-4 text-[6px] leading-tight text-gray-600">
                        {!showLogo && (form.firmenname || addrLine || plzLine) && (
                          <p className="font-semibold text-gray-800">{form.firmenname}</p>
                        )}
                        {addrLine && <p>{addrLine}</p>}
                        {plzLine && <p>{plzLine}</p>}
                      </div>
                      {/* Fake customer block */}
                      <div className="mt-4 mx-4 space-y-1">
                        <div className="h-1 w-16 bg-gray-200 rounded" />
                        <div className="h-1 w-24 bg-gray-200 rounded" />
                        <div className="h-1 w-20 bg-gray-200 rounded" />
                      </div>
                      {/* Fake line items */}
                      <div className="mt-4 mx-4 space-y-1.5">
                        {[0.9, 0.7, 0.8, 0.6].map((w, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <div className="h-1 bg-gray-200 rounded flex-1" style={{ maxWidth: `${w * 100}%` }} />
                            <div className="h-1 w-6 bg-gray-300 rounded" />
                          </div>
                        ))}
                      </div>
                      {/* Total */}
                      <div className="mt-4 mx-4 pt-2 border-t flex items-center justify-between">
                        <div className="h-1 w-10 bg-gray-300 rounded" />
                        <div className="h-1.5 w-10 rounded" style={{ background: selectedTemplate.swatch }} />
                      </div>
                      {/* Footer accent */}
                      <div
                        className="absolute bottom-0 left-0 right-0"
                        style={{ height: '3px', background: selectedTemplate.swatch, opacity: 0.5 }}
                      />
                    </div>
                  </div>
                );
              })()}
              <p className="text-[11px] text-muted-foreground mt-2 text-center">
                Aktuell ausgewählt: <span className="font-medium">{(TEMPLATES.find(t => t.key === form.documentTemplate) || TEMPLATES[0]).label}</span>
                {form.letterheadUrl && (
                  <> · Logo {form.letterheadVisible ? <span className="text-primary font-medium">sichtbar</span> : <span className="text-muted-foreground">ausgeblendet</span>}</>
                )}
              </p>
            </div>
          </SectionShell>

          {/* SECTION: SPRACHE & KOMMUNIKATION */}
          <SectionShell id="sprache" sectionKey="sprache" activeSection={activeSection} open={openSections.sprache} toggle={() => setOpenSections(p => ({ ...p, sprache: !p.sprache }))} title="Sprache &amp; Kommunikation" icon={Languages}>
            <div>
              <Label>Hauptsprache</Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                Eingehende Nachrichten in anderen Sprachen werden automatisch in diese Sprache übersetzt.
              </p>
              <select
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.hauptsprache}
                onChange={(e) => updateField('hauptsprache', e.target.value)}
              >
                {sprachOptionen.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="mt-4 text-[11px] text-muted-foreground bg-muted/40 rounded p-3">
              Weitere Sprach-Einstellungen (mehrsprachige Dokumente, automatische Übersetzungen pro Kunde) folgen in einem späteren Update.
            </div>
          </SectionShell>

          {/* SECTION: SUPPORT */}
          <SectionShell id="support" sectionKey="support" activeSection={activeSection} open={openSections.support} toggle={() => setOpenSections(p => ({ ...p, support: !p.support }))} title="Tool-Support" icon={LifeBuoy}>
            <p className="text-xs text-muted-foreground">
              Bei Problemen oder Fragen zum Business Manager wende dich an:
            </p>
            <div className="bg-muted/50 rounded-lg px-4 py-3 mt-2 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <span aria-hidden>📧</span>
                <a href="mailto:kontakt@smartflowai.ch" className="text-primary hover:underline">kontakt@smartflowai.ch</a>
              </p>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-muted-foreground" aria-hidden />
                <a href="https://www.smartflowai.ch" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.smartflowai.ch</a>
              </p>
              <p className="text-xs text-muted-foreground pt-0.5">Smartflow AI — Plattform-Support</p>
            </div>
            {session?.user?.email && (
              <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 mt-3">
                Angemeldet als: <span className="font-medium">{session.user.email}</span>
              </div>
            )}
          </SectionShell>

          {/* SECTION: NUMMERN & TESTMODUS */}
          <SectionShell id="nummern" sectionKey="nummern" activeSection={activeSection} open={openSections.nummern} toggle={() => setOpenSections(p => ({ ...p, nummern: !p.nummern }))} title="Nummern-System &amp; Testmodus" icon={FlaskConical}>
            <div className={form.testModus ? 'border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg p-4' : 'border rounded-lg p-4'}>
              <div className="text-xs text-muted-foreground space-y-1 mb-3">
                <p>Angebote: <span className="font-mono">{form.testModus ? 'TEST-' : ''}ANG-JJJJ-001</span></p>
                <p>Rechnungen: <span className="font-mono">{form.testModus ? 'TEST-' : ''}RE-JJJJ-001</span></p>
                <p className="pt-1">Jedes Jahr startet die Nummerierung automatisch neu bei 001.</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (form.testModus) {
                      if (!confirm('⚠️ Wirklich auf Live-Betrieb umstellen?\n\nNeue Dokumente erhalten dann echte Nummern ohne TEST-Prefix.\n\nBestehende TEST-Dokumente bleiben erhalten.')) return;
                    }
                    updateField('testModus', !form.testModus);
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.testModus ? 'bg-amber-500' : 'bg-green-600'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${form.testModus ? 'translate-x-1' : 'translate-x-6'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium">
                    {form.testModus ? (
                      <span className="text-amber-700 dark:text-amber-400">🧪 Testmodus aktiv</span>
                    ) : (
                      <span className="text-green-700 dark:text-green-400">✅ Live-Betrieb</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {form.testModus
                      ? 'Neue Dokumente erhalten das Prefix TEST- (z.B. TEST-ANG-2026-001)'
                      : 'Neue Dokumente erhalten echte Nummern (z.B. ANG-2026-001)'}
                  </p>
                </div>
              </div>

              {form.testModus && (
                <div className="pt-3 mt-3 border-t">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />Test-Daten zurücksetzen
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Verschiebt alle TEST-Angebote und TEST-Rechnungen in den Papierkorb.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-700 border-amber-300 hover:bg-amber-100 shrink-0"
                      disabled={resetting}
                      onClick={async () => {
                        if (!confirm('Alle TEST-Dokumente in den Papierkorb verschieben?')) return;
                        setResetting(true);
                        try {
                          const res = await fetch('/api/settings/reset-test', { method: 'POST' });
                          if (res.ok) {
                            const data = await res.json();
                            toast({ title: '🔄 Zurückgesetzt', description: data.message });
                          } else {
                            const err = await res.json();
                            toast({ title: 'Fehler', description: err.error || 'Fehler', variant: 'destructive' });
                          }
                        } catch {
                          toast({ title: 'Fehler', description: 'Netzwerkfehler', variant: 'destructive' });
                        } finally {
                          setResetting(false);
                        }
                      }}
                    >
                      {resetting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                      Zurücksetzen
                    </Button>
                  </div>
                </div>
              )}

              {!form.testModus && (
                <div className="flex items-start gap-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-xs mt-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-green-700 dark:text-green-400">
                    Im Live-Betrieb werden echte Dokumentnummern vergeben. Ein Zurücksetzen ist nicht möglich.
                  </p>
                </div>
              )}
            </div>
          </SectionShell>

          {/* Save button (primary CTA)
              • Mobile: always visible (accordion mode — stacks below all sections).
              • Desktop: hidden when "Konto & Sicherheit" is active — that section has
                its own CTAs (password / logout / delete) and doesn't share the
                common settings form. For all other active sections the button sits
                immediately below the (only) visible section. */}
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            className={activeSection === 'konto' ? 'lg:hidden' : ''}
          >
            <Button onClick={handleSave} disabled={saving || !hasChanges} className="w-full gap-2" size="lg">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Einstellungen speichern
            </Button>
            {!hasChanges && (
              <p className="text-[11px] text-center text-muted-foreground mt-2">Keine ungespeicherten Änderungen.</p>
            )}
          </motion.div>

          {/* SECTION: KONTO & SICHERHEIT */}
          <SectionShell id="konto" sectionKey="konto" activeSection={activeSection} open={openSections.konto} toggle={() => setOpenSections(p => ({ ...p, konto: !p.konto }))} title="Konto &amp; Sicherheit" icon={ShieldCheck}>
            {/* Password change */}
            <div className="border rounded-lg">
              <button
                onClick={() => setShowPasswordSection(!showPasswordSection)}
                className="w-full flex items-center justify-between text-left p-4"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Passwort ändern</span>
                </div>
                {showPasswordSection ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {showPasswordSection && (
                <div className="px-4 pb-4 space-y-3">
                  <div>
                    <Label>Aktuelles Passwort</Label>
                    <div className="relative">
                      <Input
                        type={showCurrentPw ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        placeholder="Aktuelles Passwort"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label>Neues Passwort</Label>
                    <div className="relative">
                      <Input
                        type={showNewPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="Neues Passwort (mind. 8 Zeichen)"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label>Neues Passwort bestätigen</Label>
                    <Input
                      type="password"
                      value={confirmNewPassword}
                      onChange={e => setConfirmNewPassword(e.target.value)}
                      placeholder="Neues Passwort wiederholen"
                    />
                    {confirmNewPassword && newPassword !== confirmNewPassword && (
                      <p className="text-xs text-destructive mt-1">Passwörter stimmen nicht überein</p>
                    )}
                  </div>
                  <Button
                    onClick={handlePasswordChange}
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                    className="gap-2"
                  >
                    {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    Passwort ändern
                  </Button>
                </div>
              )}
            </div>

            {/* Logout */}
            <div className="border rounded-lg p-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LogOut className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Abmelden</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await signOut({ callbackUrl: '/login', redirect: true });
                  }}
                  className="gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Abmelden
                </Button>
              </div>
            </div>

            {/* Delete account */}
            <div className="border border-red-200 dark:border-red-900/50 rounded-lg mt-4">
              <button
                onClick={() => setShowDeleteSection(!showDeleteSection)}
                className="w-full flex items-center justify-between text-left p-4"
              >
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <Trash2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Konto löschen</span>
                </div>
                {showDeleteSection ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {showDeleteSection && (
                <div className="px-4 pb-4 space-y-4">
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="text-sm text-red-700 dark:text-red-400">
                        <p className="font-medium">Achtung — nicht rückgängig!</p>
                        <p className="text-xs mt-1">Alle deine Daten werden unwiderruflich gelöscht: Aufträge, Kunden, Rechnungen, Angebote und Einstellungen.</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm">Zur Bestätigung deine E-Mail-Adresse eingeben:</Label>
                    <Input
                      type="email"
                      value={deleteConfirmEmail}
                      onChange={e => setDeleteConfirmEmail(e.target.value)}
                      placeholder={session?.user?.email || 'E-Mail-Adresse'}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    disabled={deleting || !deleteConfirmEmail}
                    onClick={handleDeleteAccount}
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Konto endgültig löschen
                  </Button>
                </div>
              )}
            </div>
          </SectionShell>

          {/* ─── Block N: Rechtliches & Datenschutz ─── */}
          <SectionShell id="datenschutz" sectionKey="datenschutz" activeSection={activeSection} open={openSections.datenschutz} toggle={() => setOpenSections(p => ({ ...p, datenschutz: !p.datenschutz }))} title="Rechtliches &amp; Datenschutz" icon={ScrollText}>
            <div className="space-y-4">
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Entwurf – wird vor dem regulären Verkauf professionell geprüft.</strong> Alle hier verlinkten Dokumente müssen vor dem kommerziellen Vollbetrieb durch eine Fachperson für Datenschutz (Schweiz / EU) finalisiert werden. Vollständige DSGVO/DSG-Konformität wird nicht beansprucht.
                </div>
              </div>

              {/* Rechtliche Dokumente — Links */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><ExternalLink className="w-4 h-4 text-blue-600" /> Rechtliche Dokumente</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { href: '/agb', label: 'AGB / Nutzungsbedingungen', desc: 'Allgemeine Geschäftsbedingungen' },
                    { href: '/datenschutz', label: 'App-Datenschutzhinweise', desc: 'Datenschutzerklärung für das Tool' },
                    { href: '/avv', label: 'AVV / Auftragsverarbeitung', desc: 'Auftragsverarbeitungs-Vereinbarung' },
                    { href: '/unterauftragnehmer', label: 'Unterauftragnehmer', desc: 'Eingesetzte Drittanbieter' },
                  ].map((doc) => (
                    <a key={doc.href} href={doc.href} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2.5 rounded-md border p-3 hover:bg-muted/40 transition-colors group">
                      <ExternalLink className="w-3.5 h-3.5 mt-0.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium group-hover:text-primary transition-colors">{doc.label}</div>
                        <div className="text-xs text-muted-foreground">{doc.desc}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>

              {/* Datenschutzerklärung / AGB / AVV — Akzeptanz */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Lock className="w-4 h-4 text-violet-600" /> Akzeptanz von Dokumenten</h4>
                {(['privacy','terms','avv'] as const).map((type) => {
                  const label = type === 'privacy' ? 'Datenschutzerklärung' : type === 'terms' ? 'AGB / Nutzungsbedingungen' : 'AVV (Auftragsverarbeitung)';
                  const accepted = consentRecords.find((c: any) => c.documentType === type);
                  return (
                    <div key={type} className="flex items-center justify-between border rounded-md p-3 gap-2 flex-wrap">
                      <div>
                        <div className="text-sm font-medium">{label} <span className="ml-1 text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">Vorlage / Entwurf</span></div>
                        {accepted ? (
                          <div className="text-xs text-green-700 mt-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Akzeptiert am {new Date(accepted.acceptedAt).toLocaleDateString('de-CH')} (Version {accepted.documentVersion})</div>
                        ) : (
                          <div className="text-xs text-muted-foreground mt-0.5">Noch nicht akzeptiert.</div>
                        )}
                      </div>
                      <Button size="sm" variant={accepted ? 'outline' : 'default'} disabled={acceptingType === type} onClick={() => acceptDocument(type)} className="gap-2">
                        {acceptingType === type ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {accepted ? 'Erneut bestätigen' : 'Akzeptieren'}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Subunternehmer / Auftragsverarbeiter (Vorlage) */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-blue-600" /> Subunternehmer / Auftragsverarbeiter</h4>
                <div className="text-xs text-muted-foreground mb-2">Übersicht eingesetzter Dienstleister (<strong>Vorlage / Entwurf</strong> – konkrete Verträge sind separat zu schliessen).</div>
                <div className="border rounded-md divide-y text-sm">
                  {[
                    { name: 'Hosting / Datenbank', purpose: 'Anwendungs-Hosting, Datenbank, Cloud-Storage', region: 'EU/CH (Platzhalter)' },
                    { name: 'KI-Dienstleister', purpose: 'Sprache-zu-Text, Texterkennung, Datenextraktion', region: 'Platzhalter' },
                    { name: 'Twilio / WhatsApp', purpose: 'Messaging-Eingangskanal (WhatsApp-Webhook)', region: 'EU/USA (Platzhalter)' },
                    { name: 'E-Mail-Versand', purpose: 'Transaktionale Benachrichtigungen', region: 'EU (Platzhalter)' },
                    { name: 'Zahlungsdienstleister (zukünftig)', purpose: 'Aktuell <em>nicht</em> aktiv', region: '—' },
                  ].map((s) => (
                    <div key={s.name} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <div className="font-medium min-w-[180px]">{s.name}</div>
                      <div className="flex-1 text-muted-foreground" dangerouslySetInnerHTML={{ __html: s.purpose }} />
                      <div className="text-xs text-muted-foreground">{s.region}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* TOM */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Technische und organisatorische Massnahmen (TOM)</h4>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p><strong>Vorlage / Entwurf.</strong> Massnahmen zur Sicherstellung von Vertraulichkeit, Integrität, Verfügbarkeit und Belastbarkeit der Verarbeitungssysteme:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>Zugangs- und Zugriffskontrolle: Login mit E-Mail und Passwort, Rollen (User / Admin), Auditprotokollierung.</li>
                    <li>Übertragung: Verschlüsselte Verbindungen (TLS) zwischen Browser und Anwendung.</li>
                    <li>Datentrennung: Multi-Tenant-Trennung pro Benutzer-ID auf Datenbank- und Storage-Ebene.</li>
                    <li>Auftragskontrolle: Schriftliche Verträge mit Subunternehmern (siehe Liste oben – aktuell als Vorlage).</li>
                    <li>Verfügbarkeit: Backups durch Hosting-Provider; Wiederherstellungsfähigkeit zu prüfen / dokumentieren.</li>
                    <li>Eingaben- und Übertragungskontrolle: Audit-Log mit Zeitstempel, Aktion, Benutzer und Quelle.</li>
                  </ul>
                </div>
              </div>

              {/* Aufbewahrungsfristen */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-amber-600" /> Aufbewahrungsfristen (Vorlage)</h4>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Rechnungen und buchhalterische Nachweise unterliegen typischerweise einer Aufbewahrungsfrist von <strong>10 Jahren</strong> (Schweiz / EU – konkrete Frist nach lokalem Recht zu bestätigen).</p>
                  <p>Andere personenbezogene Daten werden nur so lange gespeichert, wie sie für den vereinbarten Zweck erforderlich sind, oder solange gesetzliche Aufbewahrungspflichten bestehen.</p>
                  <p>Bei einer Löschanfrage wird zuerst geprüft, welche Datensätze unter eine Aufbewahrungspflicht fallen. Nicht-pflichtige Daten werden gelöscht; pflichtige Daten werden gesperrt und nach Ablauf der Frist entfernt.</p>
                </div>
              </div>

              {/* Sicherheits- / Incident-Prozess */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-red-600" /> Sicherheits- / Incident-Prozess (Vorlage)</h4>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Bei Verdacht auf eine Datenschutzverletzung (z. B. unbefugter Zugriff, Datenverlust) gilt:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>Sofortige Meldung an die im Folgeabschnitt genannte Kontaktstelle.</li>
                    <li>Dokumentation des Vorfalls inkl. Zeitpunkt, betroffener Datenkategorien und Massnahmen.</li>
                    <li>Bewertung, ob eine Meldung an die zuständige Aufsichtsbehörde innerhalb der gesetzlichen Frist erforderlich ist.</li>
                    <li>Information betroffener Personen, sofern ein hohes Risiko vorliegt.</li>
                  </ul>
                  <p>Konkrete Eskalations- und Meldewege sind im finalen Dokument zu spezifizieren.</p>
                </div>
              </div>

              {/* Kontakt */}
              <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                <div className="font-semibold flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Kontakt für Datenschutzanfragen (Vorlage)</div>
                <div className="mt-0.5">
                  Anfragen, Einsichts- und Auskunftsbegehren bitte an die in den Einstellungen unter <em>Meine Daten</em> hinterlegte Geschäfts-E-Mail bzw. Support-E-Mail richten. Eine spezifische Datenschutz-Mailadresse sowie eine ausgewiesene zuständige Person sind im finalen Dokument zu ergänzen.
                </div>
              </div>
            </div>
          </SectionShell>

          {/* ─── Block N: Daten & Kündigung ─── */}
          <SectionShell id="daten_kuendigung" sectionKey="daten_kuendigung" activeSection={activeSection} open={openSections.daten_kuendigung} toggle={() => setOpenSections(p => ({ ...p, daten_kuendigung: !p.daten_kuendigung }))} title="Daten &amp; Kündigung" icon={Database}>
            <div className="space-y-4">
              <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
                Sie können hier eine <strong>Anfrage</strong> auf Datenexport, Löschung oder Kündigung stellen. Die Bearbeitung erfolgt nicht automatisch – wir bestätigen alle drei Vorgänge schriftlich und prüfen vor jeder Löschung gesetzliche Aufbewahrungspflichten (z. B. Rechnungen).
              </div>

              {/* 1. Datenexport */}
              <div className="border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><Database className="w-4 h-4 text-indigo-600" /> Datenexport anfordern</div>
                <div className="text-xs text-muted-foreground">Wir stellen Ihnen Ihre Daten (Kunden, Aufträge, Angebote, Rechnungen) in einem maschinenlesbaren Format bereit. Der Export wird automatisch vorbereitet und steht für 72 Stunden zum Download bereit.</div>
                {/* Block T-fix2 — Inline-Hinweis bei aktiver Anfrage. */}
                {activeExportRequest ? (
                  (() => {
                    const ready = !!activeExportRequest.exportFileKey && !!activeExportRequest.exportReadyAt;
                    if (activeExportRequest.exportGenerationError) {
                      return (
                        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>Die Vorbereitung deines Datenexports läuft noch oder wird vom Support geprüft. Du musst keine neue Anfrage senden.</span>
                        </div>
                      );
                    }
                    if (ready) {
                      return (
                        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>Dein Datenexport ist bereits bereit. Du kannst ihn unten unter „Meine Anfragen" herunterladen.</span>
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900 flex items-start gap-2">
                        <Loader2 className="w-3.5 h-3.5 shrink-0 mt-0.5 animate-spin" />
                        <span>Dein Datenexport wird bereits vorbereitet. Sobald er bereit ist, kannst du ihn unten herunterladen und du erhältst zusätzlich eine E-Mail.</span>
                      </div>
                    );
                  })()
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={requestingType === 'data_export' || !!activeExportRequest}
                  onClick={() => fileComplianceRequest('data_export')}
                  className="gap-2"
                >
                  {requestingType === 'data_export' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {requestingType === 'data_export' ? 'Datenexport wird vorbereitet…' : 'Datenexport anfordern'}
                </Button>
              </div>

              {/* 2. Löschung anfragen */}
              <div className="border rounded-md p-3 space-y-2 border-rose-200 bg-rose-50/30">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-900"><FileX className="w-4 h-4" /> Löschung anfragen</div>
                <div className="text-xs text-muted-foreground">Diese Anfrage wird manuell geprüft. Daten mit gesetzlicher Aufbewahrungspflicht (z. B. Rechnungen) bleiben gesperrt erhalten und werden nach Fristablauf entfernt. <strong>Es erfolgt keine automatische Sofort-Löschung.</strong></div>
                {/* Block T-fix2 — Inline-Hinweis bei aktiver Löschanfrage. */}
                {activeDeletionRequest ? (
                  <div className="rounded-md bg-rose-100 border border-rose-300 px-3 py-2 text-xs text-rose-900 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Du hast bereits eine offene oder laufende Löschanfrage. Du musst keine neue Anfrage senden. Wir bearbeiten sie manuell.</span>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="confirmDelete" className="text-xs">Bestätigung – tippen Sie <code className="text-[11px] bg-muted px-1 rounded">LÖSCHEN</code> ein:</Label>
                    <Input id="confirmDelete" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder="LÖSCHEN" className="h-9 mt-1" />
                  </div>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    requestingType === 'data_deletion' ||
                    !!activeDeletionRequest ||
                    confirmDelete !== 'LÖSCHEN'
                  }
                  onClick={() => fileComplianceRequest('data_deletion')}
                  className="gap-2"
                >
                  {requestingType === 'data_deletion' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileX className="w-3.5 h-3.5" />}
                  Löschung anfragen
                </Button>
              </div>

              {/* 3. Kündigung */}
              <div className="border rounded-md p-3 space-y-2 border-amber-200 bg-amber-50/30">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><LogOut className="w-4 h-4" /> Kündigung des Tools</div>
                <div className="text-xs text-muted-foreground">Wir bestätigen die Kündigung schriftlich und vereinbaren die Übergabe Ihrer Daten sowie das weitere Vorgehen (z. B. Schluss-Export).</div>
                {/* Block T-fix2 — Inline-Hinweis bei aktiver Kündigungsanfrage. */}
                {activeCancellationRequest ? (
                  <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Du hast bereits eine offene oder laufende Kündigungsanfrage. Du musst keine neue Anfrage senden. Wir melden uns schriftlich.</span>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="confirmCancel" className="text-xs">Bestätigung – tippen Sie <code className="text-[11px] bg-muted px-1 rounded">KÜNDIGEN</code> ein:</Label>
                    <Input id="confirmCancel" value={confirmCancel} onChange={(e) => setConfirmCancel(e.target.value)} placeholder="KÜNDIGEN" className="h-9 mt-1" />
                  </div>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    requestingType === 'account_cancellation' ||
                    !!activeCancellationRequest ||
                    confirmCancel !== 'KÜNDIGEN'
                  }
                  onClick={() => fileComplianceRequest('account_cancellation')}
                  className="gap-2"
                >
                  {requestingType === 'account_cancellation' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                  Kündigung anfragen
                </Button>
              </div>

              {/* Eigene Anfragen-Historie */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Meine Anfragen</h4>
                {complianceRequests.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Noch keine Anfragen gestellt.</div>
                ) : (
                  <div className="border rounded-md divide-y">
                    {complianceRequests.map((req: any) => {
                      const typeLabel =
                        req.type === 'data_export' ? 'Datenexport' :
                        req.type === 'data_deletion' ? 'Löschung' :
                        req.type === 'account_cancellation' ? 'Kündigung' : req.type;
                      // Block T-fix2 — Für data_export ersetzen wir das Status-Badge
                      // durch nutzerfreundliche Sub-States: „Wird vorbereitet…",
                      // „Bereit zum Download", „Heruntergeladen", „Download abgelaufen",
                      // „Vorbereitung fehlgeschlagen". Andere Typen behalten das
                      // ursprüngliche Status-Badge ("Offen", "In Bearbeitung",
                      // "Abgeschlossen", "Abgelehnt").
                      let badgeLabel = '';
                      let badgeCls = '';
                      let downloadEl: React.ReactNode = null;
                      let secondaryNote: React.ReactNode = null;
                      let availableUntil: React.ReactNode = null;

                      if (req.type === 'data_export') {
                        const now = Date.now();
                        const expiresAt = req.exportExpiresAt ? new Date(req.exportExpiresAt).getTime() : null;
                        const ready = !!req.exportFileKey && !!req.exportReadyAt;
                        const expired = !!expiresAt && expiresAt < now;
                        const downloaded = !!req.downloadedAt;
                        const hasError = !!req.exportGenerationError;
                        const isClosed = req.status === 'completed' || req.status === 'rejected';

                        // Sub-State Reihenfolge:
                        //   1. completed/rejected → reguläres Backend-Status-Label
                        //   2. exportGenerationError → Fehler
                        //   3. expired → "Download abgelaufen"
                        //   4. downloaded (ready & nicht expired) → "Heruntergeladen"
                        //   5. ready & nicht expired → "Bereit zum Download"
                        //   6. sonst (in_progress/open ohne Datei) → "Wird vorbereitet…"
                        if (isClosed) {
                          badgeLabel = req.status === 'completed' ? 'Abgeschlossen' : 'Abgelehnt';
                          badgeCls = req.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800';
                        } else if (hasError) {
                          badgeLabel = 'Vorbereitung fehlgeschlagen';
                          badgeCls = 'bg-red-100 text-red-800';
                          secondaryNote = (
                            <div className="rounded-md bg-red-50 border border-red-200 px-2 py-1.5 text-[11px] text-red-900 flex items-start gap-1.5">
                              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>Der Export konnte nicht vorbereitet werden. Bitte kontaktiere den Support oder versuche es später erneut.</span>
                            </div>
                          );
                        } else if (expired) {
                          badgeLabel = 'Download abgelaufen';
                          badgeCls = 'bg-gray-100 text-gray-700';
                          secondaryNote = (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="w-3 h-3" /> Der Download-Link ist nicht mehr gültig. Du kannst eine neue Anfrage stellen.
                            </span>
                          );
                        } else if (ready && downloaded) {
                          badgeLabel = 'Heruntergeladen';
                          badgeCls = 'bg-emerald-100 text-emerald-800';
                          downloadEl = (
                            <a
                              href={`/api/compliance/requests/${req.id}/download`}
                              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                              onClick={() => {
                                setTimeout(() => loadCompliance(), 1500);
                              }}
                            >
                              <Download className="w-3.5 h-3.5" /> Erneut herunterladen
                            </a>
                          );
                          secondaryNote = (
                            <span className="text-[11px] text-muted-foreground">
                              Heruntergeladen am {fmtDate(req.downloadedAt)}
                            </span>
                          );
                          if (req.exportExpiresAt) {
                            availableUntil = (
                              <span className="text-[11px] text-muted-foreground">
                                Verfügbar bis {fmtDate(req.exportExpiresAt)}
                              </span>
                            );
                          }
                        } else if (ready) {
                          badgeLabel = 'Bereit zum Download';
                          badgeCls = 'bg-indigo-100 text-indigo-800';
                          downloadEl = (
                            <a
                              href={`/api/compliance/requests/${req.id}/download`}
                              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
                              onClick={() => {
                                setTimeout(() => loadCompliance(), 1500);
                              }}
                            >
                              <Download className="w-3.5 h-3.5" /> Datenexport herunterladen
                            </a>
                          );
                          if (req.exportExpiresAt) {
                            availableUntil = (
                              <span className="text-[11px] text-muted-foreground">
                                Verfügbar bis {fmtDate(req.exportExpiresAt)}
                              </span>
                            );
                          }
                        } else {
                          badgeLabel = 'Wird vorbereitet…';
                          badgeCls = 'bg-blue-100 text-blue-800';
                          downloadEl = (
                            <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Datenexport wird vorbereitet…
                            </span>
                          );
                        }
                      } else {
                        // Andere Typen (data_deletion / account_cancellation): unverändertes Status-Badge.
                        badgeLabel =
                          req.status === 'open' ? 'Offen' :
                          req.status === 'in_progress' ? 'In Bearbeitung' :
                          req.status === 'completed' ? 'Abgeschlossen' :
                          req.status === 'rejected' ? 'Abgelehnt' : req.status;
                        badgeCls =
                          req.status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                          req.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                          req.status === 'completed' ? 'bg-green-100 text-green-800' :
                          req.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
                      }

                      return (
                        <div key={req.id} className="px-3 py-2 flex flex-col gap-1.5 text-sm">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{typeLabel}</span>
                              <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${badgeCls}`}>{badgeLabel}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              angefordert am {fmtDate(req.requestedAt)}
                            </span>
                          </div>
                          {/* Download-Bereich + Verfügbarkeit nur bei data_export sichtbar. */}
                          {(downloadEl || availableUntil) ? (
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div>{downloadEl}</div>
                              {availableUntil}
                            </div>
                          ) : null}
                          {secondaryNote ? <div>{secondaryNote}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </SectionShell>

          <div className="pb-8" />
        </main>
      </div>
    </div>
  );
}

// ─── UI helpers ───

/**
 * SectionShell — wraps a settings section.
 *
 * Behaviour:
 *   • Mobile (`<lg`): classic accordion. The whole Card is visible; only the
 *     body is collapsible, driven by `open` / `toggle`. This is unchanged.
 *   • Desktop (`lg:`): acts as a REAL tab switcher. Only the section whose
 *     `sectionKey === activeSection` is rendered; all others are
 *     `hidden lg:hidden`. No more "all sections stacked into one long page".
 */
function SectionShell({
  id, sectionKey, activeSection, open, toggle, title, icon: Icon, children,
}: {
  id: string;
  sectionKey: SectionKey;
  activeSection: SectionKey;
  open: boolean;
  toggle: () => void;
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  const isActiveDesktop = sectionKey === activeSection;
  // On desktop: show only the active section. On mobile: always keep in DOM (accordion).
  const outerClass = isActiveDesktop
    ? 'block' // desktop: visible (mobile: always visible anyway, since `block` is default)
    : 'block lg:hidden'; // desktop: hide non-active; mobile: still visible as accordion
  return (
    <section id={`sec-${id}`} className={outerClass}>
      <Card>
        <CardHeader className="pb-3">
          {/* Desktop: always visible heading. Mobile: clickable accordion trigger. */}
          <button
            type="button"
            onClick={toggle}
            className="w-full flex items-center justify-between lg:cursor-default lg:pointer-events-none"
            aria-expanded={open}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="w-4 h-4 text-primary" />
              <span dangerouslySetInnerHTML={{ __html: title }} />
            </CardTitle>
            <span className="lg:hidden">
              {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </span>
          </button>
        </CardHeader>
        <CardContent className={`space-y-4 ${open ? 'block' : 'hidden'} lg:block`}>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}