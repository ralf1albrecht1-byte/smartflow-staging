'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ChevronsUpDown, Plus, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

const normalizeServiceName = (name: string) =>
name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface ServiceOption {
id: string;
name: string;
defaultPrice: number;
unit: string;
}

interface ServiceComboboxProps {
value: string;
services: ServiceOption[];
onChange: (name: string, service?: ServiceOption) => void;
onServiceCreated?: (service: ServiceOption) => void;
currentPrice?: string;
currentUnit?: string;
contextLabel?: string;
placeholder?: string;
}

export function ServiceCombobox({
value,
services,
onChange,
onServiceCreated,
currentPrice,
currentUnit,
contextLabel = 'Auftrag',
placeholder = 'Leistung suchen oder eingeben...',
}: ServiceComboboxProps) {
const [open, setOpen] = useState(false);
const [query, setQuery] = useState('');
const [saving, setSaving] = useState(false);
const [justSaved, setJustSaved] = useState(false);
const inputRef = useRef<HTMLInputElement>(null);
const containerRef = useRef<HTMLDivElement>(null);

const isManual =
value.trim() !== '' &&
!services.some(s => normalizeServiceName(s.name) === normalizeServiceName(value));

useEffect(() => {
if (isManual) setJustSaved(false);
}, [isManual]);

const filtered = services.filter(s =>
s.name.toLowerCase().includes((query || value).toLowerCase())
);

useEffect(() => {
const handler = (e: MouseEvent) => {
if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
setOpen(false);
}
};
document.addEventListener('mousedown', handler);
return () => document.removeEventListener('mousedown', handler);
}, []);

const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
const val = e.target.value;
setQuery(val);
onChange(val);
if (!open) setOpen(true);
};

const handleSelect = (svc: ServiceOption) => {
onChange(svc.name, svc);
setQuery('');
setOpen(false);
};

const handleClear = () => {
onChange('');
setQuery('');
setOpen(false);
};

const handleInputFocus = () => {
setOpen(true);
setQuery('');
};

const handleSaveAsService = useCallback(async () => {
if (!value.trim() || saving) return;


const normalizedName = value.trim().replace(/\s+/g, ' ');

const existing = services.find(
  s => normalizeServiceName(s.name) === normalizeServiceName(normalizedName)
);

if (existing) {
  toast.info(`Leistung "${existing.name}" existiert bereits`);
  setJustSaved(true);
  setQuery('');
  setOpen(false);
  onChange(existing.name);
  return;
}

setSaving(true);

try {
  const res = await fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: normalizedName,
      defaultPrice: currentPrice ? Number(currentPrice) || 0 : 0,
      unit: currentUnit || 'Stunde',
    }),
  });

  if (!res.ok) throw new Error('Fehler beim Speichern');

  const newService: ServiceOption = await res.json();

  toast.success('Leistung wurde in \'Leistungen\' übernommen ✓');
  setJustSaved(true);
  setQuery('');
  setOpen(false);

  onServiceCreated?.(newService);
  onChange(newService.name);
} catch (err) {
  toast.error('Leistung konnte nicht gespeichert werden');
} finally {
  setSaving(false);
}


}, [value, saving, services, onChange, onServiceCreated, currentPrice, currentUnit]);

const isExistingService = value.trim() !== '' && !isManual;

return ( <div ref={containerRef} className="relative w-full"> <div className="flex items-center gap-1.5"> <div className="relative flex-1 min-w-0">
<input
ref={inputRef}
type="text"
className="flex w-full rounded-md border border-input bg-background px-2 sm:px-3 py-2 text-sm pr-8 truncate"
placeholder={placeholder}
value={query || value}
onChange={handleInputChange}
onFocus={handleInputFocus}
autoComplete="off"
/>
<button
type="button"
className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
onClick={() => {
setOpen(!open);
inputRef.current?.focus();
}}
tabIndex={-1}
> <ChevronsUpDown className="w-3.5 h-3.5" /> </button> </div>

    {isManual && (
      <button
        type="button"
        onClick={handleSaveAsService}
        disabled={saving}
        className="shrink-0 flex items-center gap-1 text-xs text-primary hover:text-primary/80 border border-primary/30 rounded-md px-2 py-1.5 hover:bg-primary/5 transition-colors disabled:opacity-50"
        title="Als wiederverwendbare Leistung speichern"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        <span className="hidden sm:inline whitespace-nowrap">Als Leistung speichern</span>
        <span className="sm:hidden">Speichern</span>
      </button>
    )}
  </div>

  {isManual && !open && (
    <div className="mt-1 space-y-0.5">
      <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>Manuell eingegebene Leistung – Preis und Einheit bitte selbst festlegen.</span>
      </p>
      <p className="text-[11px] text-muted-foreground italic">
        Nur für {contextLabel === 'Auftrag' ? 'diesen' : contextLabel === 'Angebot' ? 'dieses' : 'diese'} {contextLabel} verwendet
      </p>
    </div>
  )}

  {justSaved && isExistingService && !open && (
    <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
      <Check className="w-3 h-3" />
      <span>Leistung gespeichert ✓</span>
    </p>
  )}

  {open && (
    <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
      {value && (
        <button
          type="button"
          className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 border-b"
          onClick={handleClear}
        >
          ✕ Leistung entfernen
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {(query || value) ? 'Keine passende Leistung gefunden — manuell eintragen' : 'Keine Leistungen vorhanden'}
        </div>
      ) : (
        filtered.map(svc => (
          <button
            key={svc.id}
            type="button"
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between gap-2 ${
              svc.name.toLowerCase() === value.toLowerCase() ? 'bg-accent/50 font-medium' : ''
            }`}
            onClick={() => handleSelect(svc)}
          >
            <span className="truncate">{svc.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              CHF {Number(svc.defaultPrice ?? 0).toFixed(2)}/{svc.unit}
              {svc.name.toLowerCase() === value.toLowerCase() && (
                <Check className="w-3 h-3 inline ml-1 text-primary" />
              )}
            </span>
          </button>
        ))
      )}
    </div>
  )}
</div>


);
}
