import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'AGB – Business Manager',
  description: 'Allgemeine Geschäftsbedingungen',
};

export default function AGBPage() {
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
            <span className="font-medium text-foreground">AGB</span>
            <Link href="/datenschutz" className="text-muted-foreground hover:text-foreground transition-colors">
              Datenschutz
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
          Allgemeine Geschäftsbedingungen (AGB)
        </h1>
        <p className="text-muted-foreground mb-10">Gültig für die Nutzung des Tools</p>

        <div className="space-y-10 text-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Geltungsbereich</h2>
            <p>Diese AGB gelten für die Nutzung des SaaS-Tools zur Verwaltung von Kunden, Aufträgen, Angeboten und Rechnungen.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Leistung</h2>
            <p>Das Tool stellt Funktionen zur digitalen Organisation von Geschäftsprozessen bereit.</p>
            <p className="mt-2">Ein Anspruch auf bestimmte Funktionen oder permanente Verfügbarkeit besteht nicht.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Nutzung</h2>
            <p className="mb-3">Der Nutzer ist verantwortlich für:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>eingegebene Daten</li>
              <li>hochgeladene Inhalte (z.&nbsp;B. Bilder, Audio)</li>
              <li>Einhaltung gesetzlicher Vorschriften</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Testphase / Beta</h2>
            <p>Das Tool befindet sich ganz oder teilweise in einer Testphase.</p>
            <p className="mt-2">Fehler, Ausfälle oder Datenverluste können auftreten.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Haftung</h2>
            <p className="mb-3">Es wird keine Haftung übernommen für:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Datenverlust</li>
              <li>Systemausfälle</li>
              <li>fehlerhafte Berechnungen</li>
            </ul>
            <p className="mt-3">Die Nutzung erfolgt auf eigenes Risiko.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Verfügbarkeit</h2>
            <p>Es besteht kein Anspruch auf durchgehende Verfügbarkeit des Systems.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Änderungen</h2>
            <p>Funktionen und Inhalte des Tools können jederzeit geändert oder entfernt werden.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Kündigung</h2>
            <p>Beide Parteien können den Zugang jederzeit ohne Angabe von Gründen beenden.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Schlussbestimmungen</h2>
            <p>Es gilt das Recht der Schweiz.</p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Business Manager</span>
          <div className="flex items-center gap-4">
            <span className="font-medium text-foreground">AGB</span>
            <Link href="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
