'use client';

interface MergeOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MergeOrdersDialog({
  open,
  onOpenChange,
}: MergeOrdersDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl border shadow-2xl w-full max-w-7xl h-[90vh] overflow-hidden">
        <div className="grid grid-cols-[420px_1fr] h-full">
          
          {/* LINKE SEITE */}
          <div className="border-r bg-slate-50 dark:bg-slate-900/40 p-6 overflow-y-auto">
            <div className="space-y-6">
              
              <div>
                <h2 className="text-2xl font-bold">
                  Aufträge zusammenführen
                </h2>

                <p className="text-sm text-muted-foreground mt-2">
                  Mehrere WhatsApp-, Bild- oder Audio-Aufträge zu einem
                  Hauptauftrag verbinden.
                </p>
              </div>

              <div className="space-y-4">
                
                <div className="rounded-xl border bg-background p-4">
                  <div className="font-semibold mb-2">
                    Schritt 1
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Aufträge auswählen.
                  </p>
                </div>

                <div className="rounded-xl border bg-primary/5 border-primary p-4">
                  <div className="font-semibold mb-2">
                    Schritt 2
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Hauptauftrag bestimmen und Kunden festlegen.
                  </p>
                </div>

                <div className="rounded-xl border bg-background p-4">
                  <div className="font-semibold mb-2">
                    Schritt 3
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Prüfen und endgültig verbinden.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4">
                <div className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
                  Wichtig
                </div>

                <ul className="text-sm space-y-2 text-amber-800 dark:text-amber-300">
                  <li>
                    • Der Hauptauftrag übernimmt den Originaltext.
                  </li>

                  <li>
                    • Alle Leistungen werden zusammengeführt.
                  </li>

                  <li>
                    • Bilder und Audios bleiben erhalten.
                  </li>

                  <li>
                    • Kein Auftrag geht verloren.
                  </li>
                </ul>
              </div>

            </div>
          </div>

          {/* RECHTE SEITE */}
          <div className="p-6 overflow-y-auto">
            
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">
                  Schritt 2: Hauptauftrag festlegen
                </h2>

                <p className="text-sm text-muted-foreground mt-1">
                  Diese Vorschau wird im nächsten Schritt mit echten Daten verbunden.
                </p>
              </div>

              <button
                onClick={() => onOpenChange(false)}
                className="border rounded-lg px-3 py-2 text-sm hover:bg-muted"
              >
                Schließen
              </button>
            </div>

            <div className="space-y-4">

              <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5">
                <div className="flex items-center justify-between">
                  
                  <div>
                    <div className="font-bold text-lg">
                      Hauptauftrag
                    </div>

                    <div className="text-sm text-muted-foreground mt-1">
                      Dieser Auftrag übernimmt den Haupttext.
                    </div>
                  </div>

                  <div className="text-xs px-3 py-1 rounded-full bg-primary text-primary-foreground font-medium">
                    AKTIV
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-background border p-4">
                  Originalnachricht-Vorschau
                </div>
              </div>

              <div className="rounded-2xl border p-5">
                Weiterer Auftrag
              </div>

              <div className="rounded-2xl border p-5">
                Weiterer Auftrag
              </div>

            </div>

          </div>

        </div>
      </div>
    </div>
  );
}