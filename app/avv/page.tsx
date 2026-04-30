import Link from 'next/link';
import LegalPageLayout from '@/components/legal-page-layout';

export const metadata = {
  title: 'AVV / Auftragsverarbeitung – Smartflow AI Business Manager',
  description: 'Auftragsverarbeitungs-Vereinbarung (AVV)',
};

export default function AvvPage() {
  return (
    <LegalPageLayout
      activePath="/avv"
      version="legal-2026-04-29"
      effectiveDate="29. April 2026"
      status="Kontrollierte Testphase – rechtliche Prüfung vor kommerziellem Betrieb ausstehend"
    >
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2">
        AVV – Auftragsverarbeitung
      </h1>
      <p className="text-muted-foreground mb-4">Auftragsverarbeitungs-Vereinbarung (Zusatzvereinbarung zu den AGB)</p>

      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-10">
        <strong>Hinweis:</strong> Diese AVV gilt für die kontrollierte Testphase von Smartflow AI – Business Manager.
        Eine abschliessende rechtliche Prüfung erfolgt vor dem kommerziellen Vollbetrieb.
      </div>

      <div className="space-y-10 text-foreground leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Gegenstand und Rollenverteilung</h2>
          <p>
            Diese Auftragsverarbeitungs-Vereinbarung (AVV) regelt die Verarbeitung personenbezogener
            Daten durch den Betreiber des Tools «Smartflow AI – Business Manager» (nachfolgend
            «Auftragsverarbeiter») im Auftrag des Nutzers (nachfolgend «Verantwortlicher»).
          </p>
          <p className="mt-3">
            <strong>Smartflow AI agiert als Auftragsverarbeiter</strong> für die Endkundendaten, die der Nutzer
            in das Tool eingibt oder die über WhatsApp empfangen werden. Der <strong>Nutzer bleibt verantwortlich</strong> dafür,
            eine gültige Rechtsgrundlage für die Verarbeitung seiner Endkundendaten zu besitzen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Art und Zweck der Verarbeitung</h2>
          <p className="mb-3">
            Die Verarbeitung erfolgt ausschliesslich zum Zweck der Bereitstellung der vereinbarten
            Tool-Funktionen, insbesondere:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Verwaltung von Kunden- und Auftragsdaten</li>
            <li>Erstellung und Speicherung von Angeboten und Rechnungen</li>
            <li>Empfang und Verarbeitung von WhatsApp-Nachrichten (Text, Bilder, Sprachnachrichten) über Twilio</li>
            <li>KI-gestützte Transkription von Sprachnachrichten</li>
            <li>KI-gestützte Bildanalyse und Textextraktion zur Auftragserfassung</li>
            <li>PDF-Erzeugung und -Versand von Angeboten und Rechnungen</li>
            <li>Speicherung von Medien (Bilder, Audio, PDFs)</li>
            <li>E-Mail-Versand für Systembenachrichtigungen (Bestätigung, Passwort-Reset)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Kategorien betroffener Personen und Daten</h2>
          <p className="mb-3">Verarbeitet werden insbesondere Daten der folgenden Kategorien:</p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Kontakt- und Stammdaten der Endkunden des Verantwortlichen (Name, Adresse, PLZ, Ort, Telefon, E-Mail)</li>
            <li>Auftrags-, Angebots- und Rechnungsdaten (Positionen, Beträge, MwSt.)</li>
            <li>Kommunikationsinhalte (WhatsApp-Texte, -Bilder, -Sprachnachrichten)</li>
            <li>Mediendaten (Bilder, Audioaufnahmen, Transkripte, Bildanalyse-Ergebnisse)</li>
            <li>Metadaten (Absender-Telefonnummer, Zeitstempel)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Unterauftragsverarbeiter (Sub-Processors)</h2>
          <p className="mb-3">
            Zur Erbringung der Leistungen werden Unterauftragsverarbeiter eingesetzt für:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li><strong>Hosting und Datenbank</strong> – Anwendungs- und Datenbankbetrieb</li>
            <li><strong>Objektspeicher</strong> – Speicherung von Medien und PDFs</li>
            <li><strong>E-Mail-Versand</strong> – Transaktionale Systembenachrichtigungen</li>
            <li><strong>Twilio / Meta (WhatsApp)</strong> – WhatsApp-Nachrichtenempfang und -Zustellung</li>
            <li><strong>KI-Dienstleister</strong> – Transkription, Bildanalyse, Textextraktion</li>
          </ul>
          <p className="mt-3">
            Eine aktuelle Übersicht mit Angaben zu Anbietern, Zweck, Datenkategorien und Verarbeitungsstandort
            ist unter{' '}
            <Link href="/unterauftragnehmer" className="text-primary hover:underline">Unterauftragnehmer</Link>{' '}
            einsehbar.
          </p>
          <p className="mt-2">
            Der Auftragsverarbeiter stellt sicher, dass jeder Unterauftragsverarbeiter vergleichbaren
            Datenschutzpflichten unterliegt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Pflichten des Auftragsverarbeiters</h2>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li>Verarbeitung ausschliesslich auf dokumentierte Weisung des Verantwortlichen (d.h. zur Tool-Bereitstellung)</li>
            <li>Vertraulichkeit und Verpflichtung der eingesetzten Personen</li>
            <li>Geeignete technische und organisatorische Massnahmen zum Schutz der Daten (siehe Abschnitt 6)</li>
            <li>Unterstützung des Verantwortlichen bei Anfragen betroffener Personen (Auskunft, Berichtigung, Löschung)</li>
            <li>Meldung von Datenschutzverletzungen in angemessener Frist</li>
            <li>Löschung oder Rückgabe der Daten nach Vertragsende (soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Technische und organisatorische Massnahmen (TOM)</h2>
          <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
            <li><strong>Zugangs- und Zugriffskontrolle:</strong> Login mit E-Mail und Passwort (gehasht), Rollenkonzept (User/Admin), eingeschränkter Admin-Zugriff</li>
            <li><strong>Übertragungskontrolle:</strong> Verschlüsselte Verbindungen (TLS) zwischen Browser und Anwendung</li>
            <li><strong>Mandantentrennung:</strong> Strikte Tenant Isolation auf Datenbank- und Speicherebene pro Benutzer-ID</li>
            <li><strong>Audit-Protokollierung:</strong> Umfassender Audit-Log mit Zeitstempel, Aktion, Benutzer-ID, Quelle und IP</li>
            <li><strong>Eingabekontrolle:</strong> Nachvollziehbarkeit von Änderungen über Audit-Log</li>
            <li><strong>Verfügbarkeit:</strong> Backups durch Hosting-Provider; Wiederherstellungsfähigkeit zu dokumentieren</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Mitwirkungspflichten des Verantwortlichen</h2>
          <p>
            Der Verantwortliche bleibt im Sinne des Datenschutzrechts verantwortlich für die
            Rechtmässigkeit der Datenverarbeitung und stellt sicher, dass er die erforderlichen
            Rechtsgrundlagen für die Verarbeitung der Daten seiner Endkunden besitzt.
          </p>
          <p className="mt-2">
            Der Verantwortliche muss alle KI-generierten Ergebnisse eigenständig prüfen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Rückgabe und Löschung</h2>
          <p>
            Nach Beendigung des Hauptvertrags werden die im Auftrag verarbeiteten Daten nach Wahl des
            Verantwortlichen zurückgegeben (Datenexport) oder gelöscht/anonymisiert, sofern keine
            gesetzlichen Aufbewahrungspflichten entgegenstehen.
          </p>
          <p className="mt-2">
            Rechnungen und buchhalterische Unterlagen unterliegen typischerweise einer
            Aufbewahrungspflicht von <strong>10 Jahren</strong> (Schweiz) und können erst nach Ablauf
            dieser Frist gelöscht werden.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Meldung von Datenschutzverletzungen</h2>
          <p>
            Der Auftragsverarbeiter meldet dem Verantwortlichen eine festgestellte Datenschutzverletzung
            in angemessener Frist. Die Meldung enthält Art der Verletzung, betroffene Datenkategorien,
            wahrscheinliche Folgen und ergriffene Massnahmen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Haftung und anwendbares Recht</h2>
          <p>
            Die Haftungs- und Schlussbestimmungen des Hauptvertrags (siehe{' '}
            <Link href="/agb" className="text-primary hover:underline">AGB</Link>) gelten entsprechend.
            Es gilt Schweizer Recht. Gerichtsstand ist, soweit gesetzlich zulässig, der Sitz des Betreibers.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. Änderungen</h2>
          <p>
            Diese AVV kann angepasst werden, wenn dies zur Einhaltung gesetzlicher oder regulatorischer
            Vorgaben erforderlich ist. Wesentliche Änderungen werden den Nutzern angezeigt und müssen
            erneut akzeptiert werden.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
