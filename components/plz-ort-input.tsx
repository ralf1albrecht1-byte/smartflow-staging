'use client';
/**
 * Paket N + O: Unified Land/PLZ/Ort input with live autocomplete.
 *
 * Used in all customer-address edit flows so the behavior is identical
 * everywhere:
 *   - app/(app)/kunden/page.tsx           (Kunde bearbeiten / Neuer Kunde)
 *   - app/(app)/auftraege/page.tsx        (Neuer/Bearbeiten Kunde Dialog im Auftrag)
 *   - app/(app)/angebote/page.tsx         (Neuer/Bearbeiten Kunde Dialog im Angebot)
 *   - app/(app)/rechnungen/page.tsx       (Neuer/Bearbeiten Kunde Dialog in Rechnung)
 *
 * Data sources:
 *   - CH: `@onebyte/swiss-postal-codes` (bundled into the client, ~3200 Swiss
 *     ZIP -> commune entries). License: MIT.
 *   - DE / AT / FR / IT / LI: pre-built JSON served from `/plz-data/{XX}.json`
 *     (derived from GeoNames CC-BY zip dumps, filtered to real city entries).
 *     Loaded lazily via `fetch` the first time the user picks that country;
 *     cached per-country in module-scope after that.
 *   - OTHER: no autocomplete, pure manual entry.
 *
 * UX behavior:
 *   - Type a PLZ     => dropdown shows matching "PLZ  Ort" rows
 *   - Type an Ort    => dropdown shows matching "Ort  PLZ" rows
 *   - Click / Tap / Enter on a suggestion  => both fields are filled atomically
 *   - ArrowUp/ArrowDown to navigate        => Enter to pick
 *   - Escape / blur to close dropdown
 *   - Tab or free-type                     => never blocked; the user can ALWAYS
 *                                              save whatever they typed, even if
 *                                              it doesn't match any suggestion.
 *   - Country "Andere / manuell"           => no autocomplete, free text
 *
 * This component only updates parent state via callbacks. It never calls the
 * backend save endpoints — the parent's existing save flow is untouched.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import swissPostalCodes from '@onebyte/swiss-postal-codes';

// ---------------- Countries ----------------

export type PlzCountry = 'CH' | 'DE' | 'AT' | 'FR' | 'IT' | 'LI' | 'OTHER';

export const PLZ_COUNTRIES: { value: PlzCountry; label: string; flag?: string }[] = [
  { value: 'CH', label: 'Schweiz', flag: '🇨🇭' },
  { value: 'DE', label: 'Deutschland', flag: '🇩🇪' },
  { value: 'AT', label: 'Österreich', flag: '🇦🇹' },
  { value: 'FR', label: 'Frankreich', flag: '🇫🇷' },
  { value: 'IT', label: 'Italien', flag: '🇮🇹' },
  { value: 'LI', label: 'Liechtenstein', flag: '🇱🇮' },
  { value: 'OTHER', label: 'Andere / manuell' },
];

export function normalizeCountry(v: string | null | undefined): PlzCountry {
  if (!v) return 'CH';
  const up = String(v).trim().toUpperCase();
  if (up === 'CH' || up === 'DE' || up === 'AT' || up === 'FR' || up === 'IT' || up === 'LI') return up;
  return 'OTHER';
}

// ---------------- Dataset types ----------------

type RawEntry = { commune: string; canton: string };
export type PlzOrtEntry = { plz: string; ort: string };

// Shape of the pre-built JSON files at /plz-data/XX.json
// value is either a single string (one city) or an array (alternate names).
type PublicPlzMap = Record<string, string | string[]>;

// ---------------- CH data (bundled) ----------------

const CH_ENTRIES: PlzOrtEntry[] = (() => {
  const out: PlzOrtEntry[] = [];
  const obj = swissPostalCodes as unknown as Record<string, RawEntry>;
  for (const plz of Object.keys(obj)) {
    const raw = obj[plz];
    if (!raw?.commune) continue;
    out.push({ plz, ort: raw.commune });
  }
  out.sort((a, b) => (a.plz < b.plz ? -1 : a.plz > b.plz ? 1 : 0));
  return out;
})();

// ---------------- Lazy loader for other countries ----------------

/** Module-scope cache so each country's JSON is fetched only once per session. */
const COUNTRY_CACHE: Partial<Record<PlzCountry, PlzOrtEntry[]>> = { CH: CH_ENTRIES };
/** In-flight promises so simultaneous callers don't trigger duplicate fetches. */
const COUNTRY_FETCHING: Partial<Record<PlzCountry, Promise<PlzOrtEntry[]>>> = {};

function entriesFromPublicMap(map: PublicPlzMap): PlzOrtEntry[] {
  const out: PlzOrtEntry[] = [];
  for (const plz of Object.keys(map)) {
    const v = map[plz];
    if (Array.isArray(v)) {
      for (const ort of v) {
        if (ort) out.push({ plz, ort });
      }
    } else if (typeof v === 'string' && v) {
      out.push({ plz, ort: v });
    }
  }
  out.sort((a, b) => (a.plz < b.plz ? -1 : a.plz > b.plz ? 1 : 0));
  return out;
}

async function loadCountry(c: PlzCountry): Promise<PlzOrtEntry[]> {
  if (c === 'OTHER') return [];
  if (COUNTRY_CACHE[c]) return COUNTRY_CACHE[c]!;
  if (COUNTRY_FETCHING[c]) return COUNTRY_FETCHING[c]!;
  const p = (async () => {
    try {
      const res = await fetch(`/plz-data/${c}.json`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PublicPlzMap;
      const list = entriesFromPublicMap(json);
      COUNTRY_CACHE[c] = list;
      return list;
    } catch (err) {
      // If the data file is missing we silently fall back to "no suggestions",
      // so manual entry still works. Never block the user.
      console.warn(`[PlzOrtInput] Could not load /plz-data/${c}.json`, err);
      COUNTRY_CACHE[c] = [];
      return [];
    } finally {
      delete COUNTRY_FETCHING[c];
    }
  })();
  COUNTRY_FETCHING[c] = p;
  return p;
}

// ---------------- Filtering ----------------

// Phase 2f: raised from 30 → 100 so big cities (Berlin ~180, München ~80,
// Hamburg ~100) can be fully browsed without the list being silently cut off.
const MAX_SUGGESTIONS = 100;

export interface FilterResult {
  items: PlzOrtEntry[];
  total: number; // total matches before MAX_SUGGESTIONS cap
}

function filterByPlz(list: PlzOrtEntry[], q: string): FilterResult {
  const t = q.trim();
  if (!t) return { items: [], total: 0 };
  // Only exact PLZ-prefix matches. Keep it simple and predictable; sorted by
  // dataset order (which is already PLZ-ascending in our JSON files).
  const all: PlzOrtEntry[] = [];
  for (const e of list) {
    if (e.plz.startsWith(t)) all.push(e);
  }
  return { items: all.slice(0, MAX_SUGGESTIONS), total: all.length };
}

/**
 * Ort autocomplete with combined PLZ+Ort token support.
 *
 *   "berl"      → all PLZ whose Ort matches "berl..." (prefix first, then contains)
 *   "10 berlin" → Ort contains "berlin" AND PLZ starts with "10"
 *   "berlin 10" → same as above (order-independent)
 *   "münch f"   → Ort contains both "münch" and "f" (multi-word AND-filter)
 *
 * Sorted by priority:
 *   1) Ort starts with the primary city token (and matches all filters)
 *   2) Ort contains primary city token (and matches all filters)
 */
function filterByOrt(list: PlzOrtEntry[], q: string): FilterResult {
  const raw = q.trim();
  if (!raw) return { items: [], total: 0 };

  // Split into whitespace tokens and classify each as digit-prefix vs word.
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const digitTokens: string[] = [];
  const wordTokens: string[] = [];
  for (const tk of tokens) {
    if (/^\d+$/.test(tk)) digitTokens.push(tk);
    else wordTokens.push(tk);
  }

  // If no word tokens provided we can't really do an "Ort" search. Fall back
  // to empty (PLZ input handles pure digit queries).
  if (wordTokens.length === 0) return { items: [], total: 0 };

  // Primary city token = longest word (most restrictive on Ort).
  const primary = [...wordTokens].sort((a, b) => b.length - a.length)[0];
  const secondaryWords = wordTokens.filter(w => w !== primary);

  const matches: Array<{ e: PlzOrtEntry; rank: number }> = [];
  for (const e of list) {
    const ortLower = e.ort.toLowerCase();
    const ortStart = ortLower.startsWith(primary);
    const ortHas   = ortStart || ortLower.includes(primary);
    if (!ortHas) continue;
    // Secondary words — must also occur somewhere in Ort (AND-filter).
    let allWordsOk = true;
    for (const w of secondaryWords) {
      if (!ortLower.includes(w)) { allWordsOk = false; break; }
    }
    if (!allWordsOk) continue;
    // Digit tokens — must all be prefix-matches on PLZ.
    let allDigitsOk = true;
    for (const d of digitTokens) {
      if (!e.plz.startsWith(d)) { allDigitsOk = false; break; }
    }
    if (!allDigitsOk) continue;
    matches.push({ e, rank: ortStart ? 0 : 1 });
  }

  matches.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Stable by PLZ ascending so output is deterministic.
    return a.e.plz.localeCompare(b.e.plz);
  });

  return { items: matches.slice(0, MAX_SUGGESTIONS).map(m => m.e), total: matches.length };
}

// ---------------- Props ----------------

export interface PlzOrtInputProps {
  /** Country code (ISO-2) or 'OTHER'. Defaults to 'CH' if not provided. */
  country?: string | null;
  onCountryChange?: (country: PlzCountry) => void;
  plzValue: string;
  ortValue: string;
  onPlzChange: (plz: string) => void;
  onOrtChange: (ort: string) => void;
  /**
   * When user picks a suggestion from EITHER dropdown, both values are set
   * in one go. If not provided, falls back to calling onPlzChange+onOrtChange
   * separately (two state updates). Supplying this is strongly preferred.
   */
  onBothChange?: (plz: string, ort: string) => void;
  landLabel?: string;
  plzLabel?: string;
  ortLabel?: string;
  plzPlaceholder?: string;
  ortPlaceholder?: string;
  required?: boolean;
  compact?: boolean;
  className?: string;
  /** Hide the Land selector row. Autocomplete still uses `country` prop. */
  hideCountrySelector?: boolean;
}

// ---------------- Component ----------------

export function PlzOrtInput({
  country,
  onCountryChange,
  plzValue,
  ortValue,
  onPlzChange,
  onOrtChange,
  onBothChange,
  landLabel = 'Land',
  plzLabel = 'PLZ',
  ortLabel = 'Ort',
  plzPlaceholder,
  ortPlaceholder,
  required = false,
  compact = false,
  className = '',
  hideCountrySelector = false,
}: PlzOrtInputProps) {
  const effectiveCountry: PlzCountry = normalizeCountry(country);

  // Per-country dataset (lazy loaded, cached module-wide)
  const [dataset, setDataset] = useState<PlzOrtEntry[]>(
    () => COUNTRY_CACHE[effectiveCountry] ?? [],
  );
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    const c = effectiveCountry;
    if (c === 'OTHER') {
      setDataset([]);
      setLoading(false);
      return;
    }
    if (COUNTRY_CACHE[c]) {
      setDataset(COUNTRY_CACHE[c]!);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadCountry(c).then((list) => {
      if (!alive) return;
      setDataset(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [effectiveCountry]);

  const [plzOpen, setPlzOpen] = useState(false);
  const [ortOpen, setOrtOpen] = useState(false);
  const [plzIdx, setPlzIdx] = useState(0);
  const [ortIdx, setOrtIdx] = useState(0);

  const plzResult = useMemo(() => filterByPlz(dataset, plzValue ?? ''), [dataset, plzValue]);
  const ortResult = useMemo(() => filterByOrt(dataset, ortValue ?? ''), [dataset, ortValue]);
  const plzSuggestions = plzResult.items;
  const ortSuggestions = ortResult.items;
  const plzOverflow = plzResult.total > plzSuggestions.length;
  const ortOverflow = ortResult.total > ortSuggestions.length;

  useEffect(() => { setPlzIdx(0); }, [plzValue, effectiveCountry]);
  useEffect(() => { setOrtIdx(0); }, [ortValue, effectiveCountry]);

  const plzBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ortBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (e: PlzOrtEntry) => {
    if (onBothChange) onBothChange(e.plz, e.ort);
    else { onPlzChange(e.plz); onOrtChange(e.ort); }
    setPlzOpen(false);
    setOrtOpen(false);
  };

  const labelCls = compact ? 'text-xs' : '';
  const inputMode = effectiveCountry === 'OTHER' || effectiveCountry === 'FR' || effectiveCountry === 'DE' || effectiveCountry === 'IT' || effectiveCountry === 'CH' || effectiveCountry === 'AT' || effectiveCountry === 'LI' ? 'numeric' : 'text';
  // Paket P: neutral placeholders only — no specific example values.
  const plzPh = plzPlaceholder ?? 'PLZ';
  const ortPh = ortPlaceholder ?? 'Ort';

  const suggestionsEnabled = effectiveCountry !== 'OTHER';

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* -------- Land Selector (optional) -------- */}
      {!hideCountrySelector && (
        <div>
          <Label className={labelCls}>{landLabel}{required ? ' *' : ''}</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={effectiveCountry}
            onChange={(e) => onCountryChange?.(e.target.value as PlzCountry)}
          >
            {PLZ_COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>{(c.flag ? c.flag + ' ' : '') + c.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* -------- PLZ + Ort Row -------- */}
      <div className="grid grid-cols-2 gap-2">
        {/* PLZ */}
        <div className="relative">
          <Label className={labelCls}>{plzLabel}{required ? ' *' : ''}</Label>
          <Input
            type="text"
            autoComplete="postal-code"
            inputMode={inputMode as 'numeric' | 'text'}
            placeholder={plzPh}
            value={plzValue ?? ''}
            onChange={(e) => { onPlzChange(e.target.value); if (suggestionsEnabled) setPlzOpen(true); }}
            onFocus={() => { if (suggestionsEnabled && (plzValue ?? '').trim()) setPlzOpen(true); }}
            onBlur={() => {
              if (plzBlurTimer.current) clearTimeout(plzBlurTimer.current);
              plzBlurTimer.current = setTimeout(() => setPlzOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (!plzOpen || plzSuggestions.length === 0) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setPlzIdx(i => Math.min(i + 1, plzSuggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setPlzIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = plzSuggestions[plzIdx] ?? plzSuggestions[0];
                if (pick) apply(pick);
              }
              else if (e.key === 'Escape') { setPlzOpen(false); }
            }}
          />
          {suggestionsEnabled && plzOpen && plzSuggestions.length > 0 && (
            <SuggestionList
              items={plzSuggestions}
              highlight={plzIdx}
              onPick={apply}
              format={(e) => (<><span className="font-mono font-semibold mr-2">{e.plz}</span><span>{e.ort}</span></>)}
              overflow={plzOverflow}
              totalCount={plzResult.total}
            />
          )}
          {suggestionsEnabled && loading && plzOpen && plzSuggestions.length === 0 && (plzValue ?? '').trim() && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-input bg-popover text-popover-foreground shadow-lg px-3 py-2 text-xs text-muted-foreground">
              Lade {effectiveCountry}-Daten …
            </div>
          )}
        </div>

        {/* Ort */}
        <div className="relative">
          <Label className={labelCls}>{ortLabel}{required ? ' *' : ''}</Label>
          <Input
            type="text"
            autoComplete="address-level2"
            placeholder={ortPh}
            value={ortValue ?? ''}
            onChange={(e) => { onOrtChange(e.target.value); if (suggestionsEnabled) setOrtOpen(true); }}
            onFocus={() => { if (suggestionsEnabled && (ortValue ?? '').trim()) setOrtOpen(true); }}
            onBlur={() => {
              if (ortBlurTimer.current) clearTimeout(ortBlurTimer.current);
              ortBlurTimer.current = setTimeout(() => setOrtOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (!ortOpen || ortSuggestions.length === 0) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setOrtIdx(i => Math.min(i + 1, ortSuggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setOrtIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = ortSuggestions[ortIdx] ?? ortSuggestions[0];
                if (pick) apply(pick);
              }
              else if (e.key === 'Escape') { setOrtOpen(false); }
            }}
          />
          {suggestionsEnabled && ortOpen && ortSuggestions.length > 0 && (
            <SuggestionList
              items={ortSuggestions}
              highlight={ortIdx}
              onPick={apply}
              format={(e) => (<><span>{e.ort}</span><span className="font-mono text-muted-foreground ml-2">{e.plz}</span></>)}
              overflow={ortOverflow}
              totalCount={ortResult.total}
            />
          )}
          {suggestionsEnabled && loading && ortOpen && ortSuggestions.length === 0 && (ortValue ?? '').trim() && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-input bg-popover text-popover-foreground shadow-lg px-3 py-2 text-xs text-muted-foreground">
              Lade {effectiveCountry}-Daten …
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionList({
  items, highlight, onPick, format, overflow, totalCount,
}: {
  items: PlzOrtEntry[];
  highlight: number;
  onPick: (e: PlzOrtEntry) => void;
  format: (e: PlzOrtEntry) => React.ReactNode;
  overflow?: boolean;
  totalCount?: number;
}) {
  return (
    <ul
      className="absolute left-0 right-0 top-full mt-1 z-50 max-h-64 overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-lg"
      role="listbox"
    >
      {items.map((e, idx) => (
        <li
          key={e.plz + '|' + e.ort + '|' + idx}
          role="option"
          aria-selected={idx === highlight}
          onMouseDown={(ev) => { ev.preventDefault(); onPick(e); }}
          onTouchStart={(ev) => { ev.preventDefault(); onPick(e); }}
          className={`cursor-pointer select-none px-3 py-2 text-sm flex items-center ${idx === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
        >
          {format(e)}
        </li>
      ))}
      {overflow && (
        <li
          aria-disabled="true"
          className="select-none px-3 py-2 text-xs italic text-muted-foreground border-t border-input bg-muted/40"
        >
          … {typeof totalCount === 'number' ? `${totalCount - items.length} ` : ''}weitere Treffer — Suche verfeinern
        </li>
      )}
    </ul>
  );
}
