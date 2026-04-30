import Link from 'next/link';
import LegalPageLayout from '@/components/legal-page-layout';

export const metadata = {
  title: 'App-Datenschutzhinweise – Smartflow AI Business Manager',
  description: 'Datenschutzerklärung für die App',
};

export default function DatenschutzPage() {
  return (
    <LegalPageLayout
      activePath="/datenschutz"
      version="legal-2026-04-29"
      effectiveDate="29. April 2026"
      status="Kontrollierte Testphase – rechtliche Prüfung vor kommerziellem Betrieb ausstehend"
    >
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
        App-Datenschutzhinweise – Smartflow AI Business Manager
      </h1>
      <p className="text-muted-foreground mb-4">Datenschutzerklärung für das Tool (nicht für die öffentliche Website)</p>

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-10">
        <strong>Hinweis:</strong> Diese Datenschutzerklärung bezieht sich ausschliesslich auf die Datenverarbeitung
        innerhalb des Tools «Smartflow AI – Business Manager».
        Eine abschliessende rechtliche Prüfung erfolgt vor dem kommerziellen Vollbetrieb.
      </div>

      <div className="space-y-10 text-foreground leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Verantwortlicher</h2>
          <p>
            Verantwortlich für die Datenverarbeitung im Rahmen des Tools ist
            Ralf Albrecht, Betreiber von Smartflow AI – Business Manager.
            Kontaktdaten werden im Impressum bzw. in den Tool-Einstellungen bereitgestellt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Welche Daten werden verarbeitet?</h2>
          <p className="mb-3">Im Tool werden insbesondere folgende Datenkategorien verarbeitet:</p>

          <h3 className="font-medium mt-4 mb-2">2.1 Kontodaten des Nutzers</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>E-Mail-Adresse, Name, Passwort (gehasht)</li>
            <li>Geschäftsdaten: Firmenname, Adresse, Telefon, WhatsApp-Nummer</li>
            <li>Rollen- und Berechtigungsinformationen</li>
          </ul>

          <h3 className="font-medium mt-4 mb-2">2.2 Endkundendaten (vom Nutzer eingegeben/hochgeladen)</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Name, Adresse, PLZ, Ort, Telefon, E-Mail der Endkunden des Nutzers</li>
            <li>Auftrags-, Angebots- und Rechnungsdaten inkl. Positionen, Beträge, MwSt.</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            <strong>Wichtig:</strong> Der Nutzer lädt Daten seiner eigenen Endkunden in das Tool hoch und
            ist dafür verantwortlich, eine gültige Rechtsgrundlage für diese Verarbeitung zu besitzen.
          </p>

          <h3 className="font-medium mt-4 mb-2">2.3 Kommunikationsdaten (WhatsApp über Twilio)</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Eingehende WhatsApp-Textnachrichten</li>
            <li>Eingehende WhatsApp-Bilder</li>
            <li>Eingehende WhatsApp-Sprachnachrichten (Audiodateien)</li>
            <li>Absender-Telefonnummer, Zeitstempel, Medien-Metadaten</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Diese Daten werden über den Dienstleister <strong>Twilio</strong> (WhatsApp Business API) empfangen.
            Twilio und Meta (WhatsApp) verarbeiten dabei Nachrichtenmetadaten und -inhalte gemäss ihren eigenen
            Datenschutzbestimmungen.
          </p>

          <h3 className="font-medium mt-4 mb-2">2.4 KI-verarbeitete Daten</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Audio-Transkripte (Sprachnachrichten werden in Text umgewandelt)</li>
            <li>Bildanalyse-Ergebnisse (automatische Beschreibung/Interpretation hochgeladener Bilder)</li>
            <li>Aus Texten, Bildern und Audio extrahierte Auftragsdaten (Name, Adresse, Leistungen, Mengen)</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Für diese Verarbeitungen werden <strong>KI-Dienstleister</strong> eingesetzt. Details siehe{' '}
            <Link href="/unterauftragnehmer" className="text-primary hover:underline">Unterauftragnehmer</Link>.
          </p>

          <h3 className="font-medium mt-4 mb-2">2.5 Dokumente und Medien</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Erzeugte PDFs (Angebote, Rechnungen)</li>
            <li>Hochgeladene und empfangene Bilder und Audiodateien</li>
            <li>Briefkopf-/Logodateien des Nutzers</li>
          </ul>

          <h3 className="font-medium mt-4 mb-2">2.6 Technische und Sicherheitsdaten</h3>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Audit-Log-Einträge (Aktionen, Zeitstempel, Benutzer-ID, Quelle, IP-Adresse)</li>
            <li>Sicherheitsprotokolle (fehlgeschlagene Logins, Zugriffsverweigerungen)</li>
            <li>Consent-Einwilligungen (Dokumenttyp, Version, Zeitstempel, IP, User-Agent)</li>
            <li>Compliance-Anfragen (Datenexport, Löschung, Kündigung)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Zweck der Verarbeitung</h2>
          <p className="mb-3">Die Daten werden verarbeitet für folgende Zwecke:</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Bereitstellung und Betrieb des Tools (Kunden-, Auftrags-, Angebots- und Rechnungsverwaltung)</li>
            <li>Automatisierte Auftragserfassung aus WhatsApp-Nachrichten</li>
            <li>KI-gestützte Transkription, Bildanalyse und Datenextraktion</li>
            <li>PDF-Erzeugung und -Versand</li>
            <li>Authentifizierung und Zugriffskontrolle</li>
            <li>Audit-Protokollierung zur Nachvollziehbarkeit und Sicherheit</li>
            <li>Bearbeitung von Compliance-Anfragen (Export, Löschung, Kündigung)</li>
            <li>Systembenachrichtigungen (E-Mail-Bestätigung, Passwort-Zurücksetzung)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Rechtsgrundlage</h2>
          <p>
            Die Verarbeitung erfolgt auf Grundlage der Vertragserbringung (Nutzung des Tools)
            sowie berechtigter Interessen (Sicherheit, Audit, Betrieb). Für die Endkundendaten,
            die der Nutzer in das Tool hochlädt, ist der Nutzer selbst verantwortlich
            und muss sicherstellen, dass eine gültige Rechtsgrundlage vorliegt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Drittanbieter und Datenübermittlung</h2>
          <p className="mb-3">
            Zur Bereitstellung des Tools werden Unterauftragsverarbeiter eingesetzt. Es kann zu
            Datenübermittlungen in Drittländer kommen, insbesondere in die USA (Twilio, KI-Dienste).
          </p>
          <p>
            Eine vollständige Übersicht ist unter{' '}
            <Link href="/unterauftragnehmer" className="text-primary hover:underline">Unterauftragnehmer</Link>{' '}
            verfügbar. Die Details zur Auftragsverarbeitung regelt die{' '}
            <Link href="/avv" className="text-primary hover:underline">AVV</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Speicherung und Aufbewahrung</h2>
          <p>
            Daten werden digital gespeichert und können auf Servern von Drittanbietern liegen.
            Rechnungen und buchhalterische Unterlagen unterliegen einer gesetzlichen Aufbewahrungspflicht
            von typischerweise <strong>10 Jahren</strong> (Schweiz).
          </p>
          <p className="mt-2">
            Andere personenbezogene Daten werden nur so lange gespeichert, wie für den Zweck erforderlich
            oder gesetzlich vorgeschrieben. Bei einer Löschanfrage wird geprüft, welche Daten unter
            Aufbewahrungspflichten fallen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Sicherheitsmassnahmen</h2>
          <p className="mb-3">
            Es werden technische und organisatorische Massnahmen getroffen, um die Daten zu schützen:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Verschlüsselte Verbindungen (TLS) zwischen Browser und Anwendung</li>
            <li>Passwort-Hashing (bcrypt)</li>
            <li>Mandantentrennung (Tenant Isolation) auf Datenbank- und Speicherebene</li>
            <li>Zugangskontrolle über Login mit E-Mail/Passwort und Rollenkonzept</li>
            <li>Audit-Log mit Zeitstempel, Aktion, Benutzer-ID und Quelle</li>
            <li>Eingeschränkter Admin-Zugriff</li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Trotz sorgfältiger Schutzmassnahmen kann ein absoluter Schutz vor Sicherheitsrisiken
            nicht garantiert werden. Detaillierte technische und organisatorische Massnahmen (TOM)
            finden sich in den Einstellungen unter «Rechtliches &amp; Datenschutz».
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Rechte der Nutzer</h2>
          <p className="mb-3">Nutzer haben das Recht auf:</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li><strong>Auskunft</strong> über die gespeicherten Daten</li>
            <li><strong>Berichtigung</strong> unrichtiger Daten</li>
            <li><strong>Datenexport</strong> in maschinenlesbarem Format</li>
            <li><strong>Löschung / Anonymisierung</strong> (soweit keine Aufbewahrungspflicht entgegensteht)</li>
            <li><strong>Kündigung</strong> des Zugangs</li>
          </ul>
          <p className="mt-3">
            Anfragen können direkt im Tool unter «Einstellungen → Daten &amp; Kündigung» gestellt werden.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Consent-Tracking</h2>
          <p>
            Bei der Registrierung und bei aktualisierten Bedingungen wird die Zustimmung zu den
            rechtlichen Dokumenten (AGB, Datenschutz, AVV) protokolliert. Gespeichert werden:
            Dokumenttyp, Dokumentversion, Zeitstempel, IP-Adresse (falls verfügbar) und User-Agent.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Änderungen</h2>
          <p>
            Diese Datenschutzerklärung kann jederzeit angepasst werden. Bei wesentlichen Änderungen
            werden die Nutzer informiert und müssen die aktualisierten Bedingungen erneut akzeptieren.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
