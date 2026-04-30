import Link from 'next/link';
import LegalPageLayout from '@/components/legal-page-layout';

export const metadata = {
  title: 'Unterauftragnehmer – Smartflow AI Business Manager',
  description: 'Unterauftragsverarbeiter und Drittanbieter',
};

const SUBPROCESSORS = [
  {
    name: 'Abacus.AI / Hosting-Anbieter',
    purpose: 'Anwendungs-Hosting, Datenbank, Cloud-Infrastruktur',
    dataCategories: 'Alle App-Daten, Kontodaten, Endkundendaten, Medien, Audit-Logs',
    region: 'USA / EU',
    status: 'Aktiv' as const,
  },
  {
    name: 'AWS S3 / Objektspeicher',
    purpose: 'Speicherung von Medien (Bilder, Audio, PDFs)',
    dataCategories: 'Mediendaten, erzeugte PDFs, Briefkopf-Dateien',
    region: 'EU (eu-central-1)',
    status: 'Aktiv' as const,
  },
  {
    name: 'Twilio',
    purpose: 'WhatsApp Business API – Empfang und Zustellung von Nachrichten',
    dataCategories: 'Telefonnummer, Nachrichteninhalte (Text, Bilder, Audio), Zeitstempel, Metadaten',
    region: 'USA / EU',
    status: 'Aktiv' as const,
  },
  {
    name: 'Meta / WhatsApp',
    purpose: 'Kommunikationsinfrastruktur für WhatsApp-Nachrichten',
    dataCategories: 'Telefonnummer, Nachrichtenmetadaten, Zustellstatus',
    region: 'USA / EU / Global',
    status: 'Aktiv' as const,
  },
  {
    name: 'KI-Dienstleister (Abacus.AI RouteLLM)',
    purpose: 'Audiotranskription, Bildanalyse, Textextraktion und Klassifikation für Auftragserfassung',
    dataCategories: 'Audiodateien, Bilder, Texte, extrahierte Auftragsdaten',
    region: 'USA',
    status: 'Aktiv' as const,
  },
  {
    name: 'Abacus.AI Notification API',
    purpose: 'Transaktionale E-Mail-Benachrichtigungen (Registrierung, Passwort-Reset, Systemhinweise)',
    dataCategories: 'E-Mail-Adresse, Name, Betreff, Nachrichteninhalt',
    region: 'USA',
    status: 'Aktiv' as const,
  },
  {
    name: 'Zahlungsdienstleister',
    purpose: 'Zahlungsabwicklung (für zukünftige Abrechnungsfunktionen)',
    dataCategories: 'Noch nicht definiert',
    region: 'Noch nicht definiert',
    status: 'Geplant' as const,
  },
];

const STATUS_STYLES: Record<string, string> = {
  'Aktiv': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'Geplant': 'bg-blue-50 text-blue-800 border-blue-200',
  'Zu bestätigen': 'bg-amber-50 text-amber-800 border-amber-200',
};

export default function UnterauftragnehmerPage() {
  return (
    <LegalPageLayout
      activePath="/unterauftragnehmer"
      version="legal-2026-04-29"
      effectiveDate="29. April 2026"
      status="Kontrollierte Testphase – rechtliche Prüfung vor kommerziellem Betrieb ausstehend"
    >
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
        Unterauftragnehmer und Drittanbieter
      </h1>
      <p className="text-muted-foreground mb-4">
        Übersicht der eingesetzten Unterauftragsverarbeiter (Sub-Processors)
      </p>

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-10">
        <strong>Hinweis:</strong> Diese Liste wird laufend aktualisiert. Anbieter mit Status «Geplant» oder «Zu bestätigen»
        sind noch nicht final festgelegt. Konkrete Verträge mit den Anbietern sind separat zu schliessen
        und zu dokumentieren.
      </div>

      <div className="space-y-10 text-foreground leading-relaxed">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-3 px-3 font-semibold">Anbieter</th>
                <th className="text-left py-3 px-3 font-semibold">Zweck</th>
                <th className="text-left py-3 px-3 font-semibold">Datenkategorien</th>
                <th className="text-left py-3 px-3 font-semibold">Standort / Datenübermittlung</th>
                <th className="text-left py-3 px-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SUBPROCESSORS.map((sp) => (
                <tr key={sp.name} className="hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-3 font-medium">{sp.name}</td>
                  <td className="py-3 px-3 text-muted-foreground">{sp.purpose}</td>
                  <td className="py-3 px-3 text-muted-foreground text-xs">{sp.dataCategories}</td>
                  <td className="py-3 px-3 text-muted-foreground text-xs">{sp.region}</td>
                  <td className="py-3 px-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[sp.status] || ''}`}>
                      {sp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden space-y-4">
          {SUBPROCESSORS.map((sp) => (
            <div key={sp.name} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-sm">{sp.name}</h3>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium flex-shrink-0 ${STATUS_STYLES[sp.status] || ''}`}>
                  {sp.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{sp.purpose}</p>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><span className="font-medium text-foreground">Daten:</span> {sp.dataCategories}</div>
                <div><span className="font-medium text-foreground">Standort:</span> {sp.region}</div>
              </div>
            </div>
          ))}
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-3">Hinweise zur Datenübermittlung</h2>
          <p>
            Einige der oben genannten Anbieter verarbeiten Daten in den USA oder anderen Drittländern.
            Es kann zu internationaler Datenübermittlung kommen. Der Auftragsverarbeiter stellt sicher,
            dass geeignete Garantien bestehen (z. B. Standardvertragsklauseln, angemessene technische
            Massnahmen).
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Der konkrete vertragliche Rahmen mit jedem Unterauftragsverarbeiter wird vor dem kommerziellen
            Vollbetrieb finalisiert und dokumentiert.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Verwandte Dokumente</h2>
          <ul className="space-y-2">
            <li>
              <Link href="/agb" className="text-primary hover:underline">AGB / Nutzungsbedingungen</Link>
              {' '}– Allgemeine Geschäftsbedingungen
            </li>
            <li>
              <Link href="/datenschutz" className="text-primary hover:underline">App-Datenschutzhinweise</Link>
              {' '}– Datenschutzerklärung für das Tool
            </li>
            <li>
              <Link href="/avv" className="text-primary hover:underline">AVV / Auftragsverarbeitung</Link>
              {' '}– Auftragsverarbeitungs-Vereinbarung
            </li>
          </ul>
        </section>
      </div>
    </LegalPageLayout>
  );
}
