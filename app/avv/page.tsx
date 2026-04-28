import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'AVV / Auftragsverarbeitung – Business Manager',
  description: 'Auftragsverarbeitungs-Vereinbarung (AVV)',
};

export default function AvvPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 to-background">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/agb" className="text-muted-foreground hover:text-foreground transition-colors">
              AGB
            </Link>
            <Link href="/datenschutz" className="text-muted-foreground hover:text-foreground transition-colors">
              Datenschutz
            </Link>
            <span className="font-medium text-foreground">AVV</span>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
          Auftragsverarbeitungs-Vereinbarung (AVV)
        </h1>
        <p className="text-muted-foreground mb-2">Zusatzvereinbarung zum Hauptvertrag</p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-10">
          Vorlage / Entwurf — der finale Wortlaut wird vor produktiver Nutzung durch den Betreiber bestätigt.
        </p>

        <div className="space-y-10 text-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Gegenstand</h2>
            <p>
              Diese Auftragsverarbeitungs-Vereinbarung (AVV) regelt die Verarbeitung personenbezogener
              Daten durch den Betreiber des Tools ("Auftragsverarbeiter") im Auftrag des Nutzers
              ("Verantwortlicher") gemäss den geltenden Datenschutzbestimmungen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Art und Zweck der Verarbeitung</h2>
            <p className="mb-3">Die Verarbeitung erfolgt zum Zweck der Bereitstellung der vereinbarten Tool-Funktionen, insbesondere:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Verwaltung von Kunden- und Auftragsdaten</li>
              <li>Erstellung und Speicherung von Angeboten und Rechnungen</li>
              <li>Speicherung von Medien (Bilder, Audio) und automatisch erkannten Inhalten</li>
              <li>Kommunikationsdienste (z.&nbsp;B. Versand von E-Mails, WhatsApp-Verarbeitung)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Kategorien betroffener Personen und Daten</h2>
            <p className="mb-3">Verarbeitet werden insbesondere Daten der folgenden Kategorien:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Kontakt- und Stammdaten (Name, Adresse, Telefon, E-Mail) der Endkunden des Verantwortlichen</li>
              <li>Auftrags-, Angebots- und Rechnungsdaten</li>
              <li>Mediendaten (Bilder, Audioaufnahmen, Transkripte)</li>
              <li>Kommunikationsinhalte zwischen dem Verantwortlichen und seinen Endkunden</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Pflichten des Auftragsverarbeiters</h2>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Verarbeitung ausschliesslich auf dokumentierte Weisung des Verantwortlichen</li>
              <li>Vertraulichkeit und Verpflichtung der eingesetzten Personen</li>
              <li>Geeignete technische und organisatorische Massnahmen zum Schutz der Daten</li>
              <li>Unterstützung des Verantwortlichen bei Anfragen betroffener Personen (Auskunft, Berichtigung, Löschung)</li>
              <li>Meldung von Datenschutzverletzungen ohne unangemessene Verzögerung</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Unterauftragsverarbeiter</h2>
            <p className="mb-3">
              Zur Erbringung der Leistungen werden Unterauftragsverarbeiter eingesetzt, insbesondere für
              Hosting, E-Mail-Versand, Kommunikationsdienste und KI-gestützte Verarbeitung. Eine aktuelle
              Liste wird auf Anfrage zur Verfügung gestellt.
            </p>
            <p className="text-muted-foreground">
              Der Auftragsverarbeiter stellt sicher, dass jeder Unterauftragsverarbeiter vergleichbaren
              Datenschutzpflichten unterliegt.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Technische und organisatorische Massnahmen</h2>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Zugangs-, Zugriffs- und Übertragungskontrolle</li>
              <li>Verschlüsselung von Datenübertragungen (TLS)</li>
              <li>Trennung der Daten verschiedener Verantwortlicher (Mandantentrennung)</li>
              <li>Protokollierung sicherheitsrelevanter Ereignisse (Audit-Log)</li>
              <li>Regelmässige Sicherheits- und Verfügbarkeits-Updates der eingesetzten Systeme</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Mitwirkungspflichten des Verantwortlichen</h2>
            <p>
              Der Verantwortliche bleibt im Sinne des Datenschutzrechts verantwortlich für die
              Rechtmässigkeit der Datenverarbeitung und stellt sicher, dass er die erforderlichen
              Rechtsgrundlagen für die Verarbeitung der Daten seiner Endkunden besitzt.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Rückgabe und Löschung</h2>
            <p>
              Nach Beendigung des Hauptvertrags werden die im Auftrag verarbeiteten Daten nach Wahl des
              Verantwortlichen zurückgegeben oder gelöscht, sofern keine gesetzlichen Aufbewahrungspflichten
              entgegenstehen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Haftung und anwendbares Recht</h2>
            <p>
              Die Haftungs- und Schlussbestimmungen des Hauptvertrags (siehe AGB) gelten entsprechend. Es
              gilt das Recht der Schweiz.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Änderungen</h2>
            <p>
              Diese AVV kann angepasst werden, wenn dies zur Einhaltung gesetzlicher oder regulatorischer
              Vorgaben erforderlich ist. Wesentliche Änderungen werden den Nutzern angezeigt und müssen
              erneut akzeptiert werden.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Business Manager</span>
          <div className="flex items-center gap-4">
            <Link href="/agb" className="hover:text-foreground transition-colors">AGB</Link>
            <Link href="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
            <span className="font-medium text-foreground">AVV</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
