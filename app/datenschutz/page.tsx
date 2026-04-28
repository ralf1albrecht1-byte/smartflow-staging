import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Datenschutz – Business Manager',
  description: 'Datenschutzerklärung',
};

export default function DatenschutzPage() {
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
            <span className="font-medium text-foreground">Datenschutz</span>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
          Datenschutzerklärung
        </h1>
        <p className="text-muted-foreground mb-10">Informationen zum Umgang mit Ihren Daten</p>

        <div className="space-y-10 text-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Verantwortlicher</h2>
            <p>Verantwortlich für die Datenverarbeitung ist der Betreiber dieses Tools.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Erhobene Daten</h2>
            <p className="mb-3">Im Tool werden folgende Daten verarbeitet:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Kundendaten (Name, Adresse, Telefonnummer, E-Mail)</li>
              <li>Auftragsdaten</li>
              <li>Angebote und Rechnungen</li>
              <li>Medien (Bilder, Audio)</li>
              <li>automatisch erkannte Inhalte (z.&nbsp;B. Transkripte)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Zweck der Verarbeitung</h2>
            <p className="mb-3">Die Daten werden verarbeitet zur:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Verwaltung von Kunden</li>
              <li>Erstellung von Angeboten und Rechnungen</li>
              <li>Organisation von Aufträgen</li>
              <li>Verbesserung der Funktionalität</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Speicherung</h2>
            <p>Die Daten werden digital gespeichert und können auf Servern von Drittanbietern liegen.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Weitergabe an Dritte</h2>
            <p className="mb-3">Daten können an Drittanbieter weitergegeben werden, wenn dies technisch notwendig ist, z.&nbsp;B.:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Hosting-Anbieter</li>
              <li>Zahlungsanbieter</li>
              <li>Kommunikationsdienste</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Sicherheit</h2>
            <p>Es werden technische und organisatorische Massnahmen getroffen, um Daten zu schützen.</p>
            <p className="mt-2">Ein vollständiger Schutz kann jedoch nicht garantiert werden.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Rechte der Nutzer</h2>
            <p className="mb-3">Nutzer haben das Recht auf:</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Auskunft</li>
              <li>Berichtigung</li>
              <li>Löschung ihrer Daten</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Aufbewahrung</h2>
            <p>Daten werden so lange gespeichert, wie es für die Nutzung des Tools notwendig ist.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Änderungen</h2>
            <p>Diese Datenschutzerklärung kann jederzeit angepasst werden.</p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Business Manager</span>
          <div className="flex items-center gap-4">
            <Link href="/agb" className="hover:text-foreground transition-colors">AGB</Link>
            <span className="font-medium text-foreground">Datenschutz</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
