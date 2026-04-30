import Link from 'next/link';
import LegalPageLayout from '@/components/legal-page-layout';

export const metadata = {
  title: 'AGB – Smartflow AI Business Manager',
  description: 'Allgemeine Geschäftsbedingungen (Nutzungsbedingungen)',
};

export default function AGBPage() {
  return (
    <LegalPageLayout
      activePath="/agb"
      version="legal-2026-04-29"
      effectiveDate="29. April 2026"
      status="Kontrollierte Testphase – rechtliche Prüfung vor kommerziellem Betrieb ausstehend"
    >
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
        AGB – Smartflow AI Business Manager
      </h1>
      <p className="text-muted-foreground mb-4">Allgemeine Geschäftsbedingungen (Nutzungsbedingungen)</p>

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-10">
        <strong>Hinweis:</strong> Diese AGB gelten für die kontrollierte Testphase von Smartflow AI – Business Manager.
        Eine abschliessende rechtliche Prüfung erfolgt vor dem kommerziellen Vollbetrieb.
      </div>

      <div className="space-y-10 text-foreground leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Geltungsbereich</h2>
          <p>
            Diese Allgemeinen Geschäftsbedingungen gelten für die Nutzung des SaaS-Tools
            «Smartflow AI – Business Manager» (nachfolgend «Tool»). Das Tool richtet sich
            an Handwerks- und Dienstleistungsbetriebe in der Schweiz und ermöglicht die digitale
            Verwaltung von Kunden, Aufträgen, Angeboten, Rechnungen und zugehöriger Kommunikation.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Leistungsbeschreibung</h2>
          <p className="mb-3">Das Tool stellt insbesondere folgende Funktionen bereit:</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Kunden-, Auftrags-, Angebots- und Rechnungsverwaltung</li>
            <li>Automatischer Eingang und Verarbeitung von WhatsApp-Nachrichten (Text, Bilder, Sprachnachrichten) über Twilio</li>
            <li>KI-gestützte Textanalyse, Bildverarbeitung und Audiotranskription zur automatisierten Auftragserfassung</li>
            <li>PDF-Erzeugung für Angebote und Rechnungen</li>
            <li>Datenexport, Löschung und Anonymisierung auf Anfrage</li>
            <li>Audit-Protokollierung sicherheitsrelevanter Vorgänge</li>
          </ul>
          <p className="mt-3">
            Ein Anspruch auf bestimmte Funktionen, Erweiterungen oder dauerhafte Verfügbarkeit besteht nicht.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Testphase / Soft-Launch</h2>
          <p>
            Das Tool befindet sich derzeit in einer <strong>kontrollierten Testphase</strong>.
            Funktionen können sich jederzeit ändern, eingeschränkt oder entfernt werden.
            Fehler, Ausfälle und unvorhergesehenes Verhalten sind möglich.
          </p>
          <p className="mt-2">
            Einzelheiten zu den eingesetzten Drittanbietern finden sich unter{' '}
            <Link href="/unterauftragnehmer" className="text-primary hover:underline">Unterauftragnehmer</Link>,
            zum Datenschutz in der{' '}
            <Link href="/datenschutz" className="text-primary hover:underline">App-Datenschutzerklärung</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Pflichten des Nutzers</h2>
          <p className="mb-3">Der Nutzer ist verantwortlich für:</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Die Richtigkeit und Rechtmässigkeit der eingegebenen Daten (insbesondere Kundendaten)</li>
            <li>Hochgeladene Inhalte (Bilder, Audio, Dokumente)</li>
            <li>Die Überprüfung aller KI-generierten Ergebnisse (Transkripte, extrahierte Auftragsdaten, Berechnungen)</li>
            <li>Die Einhaltung geltender Datenschutz- und Geschäftsvorschriften gegenüber seinen eigenen Endkunden</li>
            <li>Die Geheimhaltung seiner Zugangsdaten</li>
          </ul>
          <p className="mt-3">
            <strong>Wichtig:</strong> KI-Ergebnisse können fehlerhaft, unvollständig oder irreführend sein.
            Der Nutzer muss alle automatisch erzeugten Aufträge, Angebote, Rechnungen, Kundendaten,
            Transkripte, Bildinterpretationen und berechnete Werte eigenständig prüfen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Drittanbieter und Datenverarbeitung</h2>
          <p className="mb-3">
            Zur Erbringung der Leistung werden Drittanbieter eingesetzt, darunter:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Twilio / Meta (WhatsApp) für den Nachrichtenempfang</li>
            <li>KI-Dienstleister für Transkription, Bildanalyse und Textextraktion</li>
            <li>Hosting- und Speicher-Anbieter für Anwendung, Datenbank und Medien</li>
            <li>E-Mail-Dienst für Systembenachrichtigungen</li>
          </ul>
          <p className="mt-3">
            Eine aktuelle Übersicht ist unter{' '}
            <Link href="/unterauftragnehmer" className="text-primary hover:underline">Unterauftragnehmer</Link>{' '}
            einsehbar. Es kann zu internationaler Datenübermittlung kommen (insbesondere USA).
          </p>
          <p className="mt-2">
            Details zum Datenschutz finden sich in der{' '}
            <Link href="/datenschutz" className="text-primary hover:underline">App-Datenschutzerklärung</Link> sowie in der{' '}
            <Link href="/avv" className="text-primary hover:underline">AVV / Auftragsverarbeitung</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Haftungsbeschränkung</h2>
          <p>
            Soweit gesetzlich zulässig, wird die Haftung für Datenverlust, Systemausfälle,
            Unterbrechungen, fehlerhafte KI-Ergebnisse (Transkripte, extrahierte Daten, Berechnungen),
            Folgeschäden sowie Handlungen oder Unterlassungen der eingesetzten Drittanbieter beschränkt.
          </p>
          <p className="mt-3">
            Die Nutzung des Tools erfolgt in der kontrollierten Testphase auf eigenes Risiko.
            Das Tool ersetzt keine rechtliche, steuerliche, buchhalterische oder sonstige fachliche Prüfung.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Verfügbarkeit</h2>
          <p>Es besteht kein Anspruch auf ununterbrochene Verfügbarkeit. Wartungsarbeiten und Updates können jederzeit erfolgen.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Änderungen</h2>
          <p>
            Funktionen, Inhalte und diese AGB können jederzeit geändert werden. Bei wesentlichen
            Änderungen werden die Nutzer informiert und müssen die aktualisierten Bedingungen erneut
            akzeptieren, bevor sie das Tool weiter nutzen können.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Kündigung</h2>
          <p>
            Beide Parteien können den Zugang jederzeit ohne Angabe von Gründen beenden.
            Details zum Vorgehen bei Kündigung, Datenexport und Löschung finden sich
            in den Einstellungen des Tools unter «Daten &amp; Kündigung».
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Aufbewahrungsfristen</h2>
          <p>
            Rechnungen und buchhalterische Unterlagen unterliegen typischerweise einer gesetzlichen
            Aufbewahrungspflicht von 10 Jahren (Schweiz). Bei einer Kündigung oder Löschanfrage
            werden nicht-pflichtige Daten gelöscht; aufbewahrungspflichtige Daten werden gesperrt
            und nach Fristablauf entfernt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. Schlussbestimmungen</h2>
          <p>Es gilt Schweizer Recht. Gerichtsstand ist, soweit gesetzlich zulässig, der Sitz des Betreibers.</p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
