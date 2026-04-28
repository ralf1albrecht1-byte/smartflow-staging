'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import { rankCustomers, type CustomerSearchable } from '@/lib/customer-search-match';

/**
 * PHASE 2a (Read-Path Härtung):
 *   Customer-ranking logic is now delegated to @/lib/customer-search-match
 *   (shared with the Kundenliste page). The phone-bucket uses strict E.164
 *   matching when the query itself parses to E.164; otherwise the legacy
 *   digit-substring text fallback is used. See that module for the policy.
 */

export type CustomerOption = CustomerSearchable;

interface CustomerSearchComboboxProps {
  customers: CustomerOption[];
  value: string; // customerId
  onChange: (customerId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CustomerSearchCombobox({ customers, value, onChange, placeholder, disabled }: CustomerSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get the selected customer label for display
  const selectedCustomer = useMemo(() => customers.find(c => c.id === value), [customers, value]);

  const filtered = useMemo(() => rankCustomers(customers, query), [customers, query]);

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlightIdx(0); }, [filtered.length, query]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  const handleSelect = useCallback((customerId: string) => {
    onChange(customerId);
    setQuery('');
    setOpen(false);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIdx]) handleSelect(filtered[highlightIdx].id);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  }, [open, filtered, highlightIdx, handleSelect]);

  const handleFocus = () => {
    if (!disabled) setOpen(true);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  const displayValue = open ? query : (selectedCustomer ? `${selectedCustomer.customerNumber ? selectedCustomer.customerNumber + ' – ' : ''}${selectedCustomer.name || ''}` : '');

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          className="flex w-full rounded-md border border-input bg-background pl-8 pr-16 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 truncate"
          placeholder={placeholder || 'Kunde suchen (Name, Nr., Tel.)...'}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && (
            <button type="button" className="p-0.5 rounded hover:bg-muted" onClick={handleClear} tabIndex={-1} aria-label="Auswahl löschen">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover shadow-lg"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {query ? 'Kein Kunde gefunden' : 'Keine Kunden vorhanden'}
            </div>
          ) : (
            filtered.map((c, idx) => (
              <div
                key={c.id}
                role="option"
                aria-selected={c.id === value}
                className={`flex flex-col gap-0.5 px-3 py-2 cursor-pointer text-sm transition-colors
                  ${idx === highlightIdx ? 'bg-accent text-accent-foreground' : ''}
                  ${c.id === value ? 'font-medium bg-accent/50' : ''}
                  hover:bg-accent hover:text-accent-foreground`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(c.id); }}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {c.customerNumber && (
                    <span className="shrink-0 text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{c.customerNumber}</span>
                  )}
                  <span className="truncate font-medium">{c.name || '(kein Name)'}</span>
                </div>
                {(c.phone || c.email) && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {c.phone && <span>📞 {c.phone}</span>}
                    {c.email && <span className="truncate">✉ {c.email}</span>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
