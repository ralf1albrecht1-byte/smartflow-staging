'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { ShieldCheck, LogOut, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

type DocType = 'terms' | 'privacy' | 'avv';
type ConsentStatus = 'ok' | 'missing' | 'outdated';
type StatusMap = Record<DocType, ConsentStatus>;
type VersionMap = Record<DocType, string>;

export default function ComplianceOnboardingForm({
  status,
  isReAcceptance,
  currentVersions,
}: {
  status: StatusMap;
  isReAcceptance: boolean;
  currentVersions: VersionMap;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Phase 4: a doc that is 'ok' is treated as already accepted (no checkbox
  // toggle required). For 'missing' or 'outdated' the user must tick the box.
  const [acceptedAgb, setAcceptedAgb] = useState<boolean>(status.terms === 'ok');
  const [acceptedDatenschutz, setAcceptedDatenschutz] = useState<boolean>(status.privacy === 'ok');
  const [acceptedAvv, setAcceptedAvv] = useState<boolean>(status.avv === 'ok');

  async function postConsent(documentType: DocType, documentVersion: string): Promise<boolean> {
    try {
      const res = await fetch('/api/compliance/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, documentVersion }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `Fehler beim Akzeptieren von ${documentType}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('postConsent error', err);
      toast.error('Netzwerkfehler beim Speichern der Akzeptanz');
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acceptedAgb) {
      toast.error('Bitte akzeptieren Sie die AGB / Nutzungsbedingungen');
      return;
    }
    if (!acceptedDatenschutz) {
      toast.error('Bitte akzeptieren Sie die Datenschutzerklärung');
      return;
    }
    if (!acceptedAvv) {
      toast.error('Bitte akzeptieren Sie die AVV / Auftragsverarbeitung');
      return;
    }
    setLoading(true);
    try {
      // Only POST documents whose status is NOT 'ok'. Each successful POST
      // creates a new ConsentRecord row; we want exactly one row per
      // re-acceptance per outdated/missing document, never duplicates for
      // already-current ones.
      const tasks: Array<Promise<boolean>> = [];
      if (status.terms !== 'ok') tasks.push(postConsent('terms', currentVersions.terms));
      if (status.privacy !== 'ok') tasks.push(postConsent('privacy', currentVersions.privacy));
      if (status.avv !== 'ok') tasks.push(postConsent('avv', currentVersions.avv));
      const results = await Promise.all(tasks);
      const allOk = results.every(Boolean);
      if (!allOk) {
        setLoading(false);
        return;
      }
      toast.success(
        isReAcceptance
          ? 'Vielen Dank — die aktualisierten Bedingungen wurden gespeichert.'
          : 'Vielen Dank — Akzeptanzen gespeichert.'
      );
      // Use full reload to re-evaluate the server-side compliance gate.
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error('Ein Fehler ist aufgetreten');
      setLoading(false);
    }
  }

  // Header text adapts to the situation:
  //  - Pure first-time onboarding (all three 'missing') → keep original text.
  //  - Any 'outdated' present ("version was bumped") → show update notice.
  const headerTitle = isReAcceptance
    ? 'AGB / Datenschutz aktualisiert'
    : 'Compliance-Akzeptanz erforderlich';
  const headerSubtitle = isReAcceptance
    ? 'Bitte akzeptieren Sie die aktualisierten Bedingungen, um fortzufahren.'
    : 'AGB, Datenschutzerklärung und AVV / Auftragsverarbeitung akzeptieren';
  const introCopy = isReAcceptance
    ? 'Wir haben unsere rechtlichen Dokumente aktualisiert. Bitte öffnen Sie die markierten Dokumente und bestätigen Sie sie erneut, bevor Sie fortfahren können.'
    : 'Bevor Sie das Tool weiter nutzen können, müssen Sie die folgenden drei Dokumente akzeptieren. Bitte öffnen Sie jedes Dokument und bestätigen Sie anschliessend mit den Checkboxen.';
  const HeaderIcon = isReAcceptance ? RefreshCw : ShieldCheck;

  // Per-row helper text (e.g. "Bereits akzeptiert" vs. "Aktualisiert — bitte erneut akzeptieren").
  function rowHint(s: ConsentStatus): { text: string; className: string } | null {
    if (s === 'ok') return { text: '(bereits akzeptiert)', className: 'ml-2 text-xs text-emerald-700' };
    if (s === 'outdated')
      return { text: '(aktualisiert — bitte erneut akzeptieren)', className: 'ml-2 text-xs text-amber-700' };
    return null;
  }

  const termsHint = rowHint(status.terms);
  const privacyHint = rowHint(status.privacy);
  const avvHint = rowHint(status.avv);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4 py-12">
      <Card className="w-full max-w-xl" style={{ boxShadow: 'var(--shadow-lg)' }}>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-primary rounded-xl flex items-center justify-center mb-2">
            <HeaderIcon className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="font-display text-2xl tracking-tight">{headerTitle}</CardTitle>
          <CardDescription>{headerSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{introCopy}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* AGB / Nutzungsbedingungen */}
            <div className="flex items-start gap-3 p-3 rounded-md border border-border/60 bg-muted/40">
              <input
                type="checkbox"
                id="acceptedAgb"
                checked={acceptedAgb}
                disabled={status.terms === 'ok'}
                onChange={(e) => setAcceptedAgb(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="acceptedAgb" className="flex-1 text-sm text-foreground">
                Ich akzeptiere die{' '}
                <Link
                  href="/agb"
                  target="_blank"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  AGB / Nutzungsbedingungen
                  <ExternalLink className="h-3 w-3" />
                </Link>
                {termsHint && <span className={termsHint.className}>{termsHint.text}</span>}
              </label>
            </div>

            {/* Datenschutzerklärung */}
            <div className="flex items-start gap-3 p-3 rounded-md border border-border/60 bg-muted/40">
              <input
                type="checkbox"
                id="acceptedDatenschutz"
                checked={acceptedDatenschutz}
                disabled={status.privacy === 'ok'}
                onChange={(e) => setAcceptedDatenschutz(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="acceptedDatenschutz" className="flex-1 text-sm text-foreground">
                Ich akzeptiere die{' '}
                <Link
                  href="/datenschutz"
                  target="_blank"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Datenschutzerklärung
                  <ExternalLink className="h-3 w-3" />
                </Link>
                {privacyHint && <span className={privacyHint.className}>{privacyHint.text}</span>}
              </label>
            </div>

            {/* AVV / Auftragsverarbeitung */}
            <div className="flex items-start gap-3 p-3 rounded-md border border-border/60 bg-muted/40">
              <input
                type="checkbox"
                id="acceptedAvv"
                checked={acceptedAvv}
                disabled={status.avv === 'ok'}
                onChange={(e) => setAcceptedAvv(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="acceptedAvv" className="flex-1 text-sm text-foreground">
                Ich akzeptiere die{' '}
                <Link
                  href="/avv"
                  target="_blank"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  AVV / Auftragsverarbeitung
                  <ExternalLink className="h-3 w-3" />
                </Link>
                {avvHint && <span className={avvHint.className}>{avvHint.text}</span>}
              </label>
            </div>

            <div className="pt-2 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={async () => { await signOut({ callbackUrl: '/login', redirect: true }); }}
                className="text-muted-foreground"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Abmelden
              </Button>
              <Button
                type="submit"
                disabled={loading || !acceptedAgb || !acceptedDatenschutz || !acceptedAvv}
                className="sm:min-w-[180px]"
              >
                {loading ? 'Bitte warten...' : isReAcceptance ? 'Weiter' : 'Akzeptieren und fortfahren'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
