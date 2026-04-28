'use client';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Search, ArrowLeft, Check, AlertTriangle, CheckCircle2, HelpCircle, Info, X, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

// === Types ===
type MatchClass = 'EXAKT' | 'WAHRSCHEINLICH' | 'UNSICHER';
type FieldKey = 'name' | 'address' | 'plz' | 'city' | 'phone' | 'email';

export interface DuplicateMatch {
  id: string;
  customerNumber?: string | null;
  name: string;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  createdAt?: string;
  classification: MatchClass;
  score: number;
  _count?: { orders: number; invoices: number; offers: number };
  isManualResult?: boolean;
}

interface CustomerData {
  id: string;
  customerNumber?: string | null;
  name: string;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  country?: string | null;
}

export type MergeCompleteResult = {
  survivingCustomerId: string;
  survivingCustomerNumber: string;
  /**
   * Stage F: the freshly-merged customer record, fetched from the backend
   * AFTER the merge transaction committed. The backend persists the user's
   * resolvedValues to the surviving record; we re-read it here so consumers
   * can replace their LOCAL form state (newCust / editForm) with the source
   * of truth — without each consumer having to fetch separately.
   *
   * If the post-merge fetch fails (network error, etc.) this is undefined,
   * and consumers should fall back to refreshing their list to pick up the
   * change indirectly.
   */
  mergedCustomer?: CustomerData;
};

interface CustomerDuplicateCheckProps {
  customer: CustomerData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: (result: MergeCompleteResult) => void;
  /**
   * Active form values — may differ from the saved `customer.*` while the
   * user is editing. The conservative PLZ-suggestion banner requires:
   *   • activeFormName        — non-empty
   *   • activeFormAddress     — non-empty (street + house number)
   *   • activeFormCity        — non-empty
   *   • activeFormPlz         — empty / missing
   *
   * The banner falls back to the saved `customer.*` value when a prop is
   * not supplied (undefined). Pass empty string explicitly to mark a field
   * as "user cleared".
   */
  activeFormName?: string | null;
  activeFormAddress?: string | null;
  activeFormCity?: string | null;
  activeFormPlz?: string | null;
  /**
   * Optional callback used by the conservative PLZ-suggestion banner.
   * Called with the new PLZ value when the user clicks "PLZ übernehmen",
   * or with the previous PLZ value (possibly empty `''`) when the user
   * clicks "Rückgängig" inside the success-state banner.
   *
   * The banner renders only when:
   *  - all activeForm fields name/address/city are non-empty,
   *  - the active form's PLZ is empty,
   *  - ≥1 EXAKT duplicate has a non-empty PLZ,
   *  - all EXAKT duplicates with a PLZ agree on a single value.
   * If not provided, no banner is shown (feature opt-in).
   */
  onApplyPlzSuggestion?: (plz: string) => void;
}

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'address', label: 'Strasse' },
  { key: 'plz', label: 'PLZ' },
  { key: 'city', label: 'Ort' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-Mail' },
];

const CLASS_CONFIG: Record<MatchClass, { label: string; badgeColor: string; cardBg: string; cardBorder: string; icon: typeof CheckCircle2 }> = {
  EXAKT: { label: 'Exakt', badgeColor: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', cardBg: 'bg-green-50/70 dark:bg-green-950/20', cardBorder: 'border-green-300 dark:border-green-700', icon: CheckCircle2 },
  WAHRSCHEINLICH: { label: 'Annähernd', badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', cardBg: 'bg-orange-50/70 dark:bg-orange-950/20', cardBorder: 'border-orange-300 dark:border-orange-700', icon: AlertTriangle },
  UNSICHER: { label: 'Unsicher', badgeColor: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', cardBg: 'bg-white dark:bg-muted/30', cardBorder: 'border-gray-200 dark:border-gray-700', icon: HelpCircle },
};

// === Inline Panel (used inside edit dialogs) ===
export function DuplicateCheckPanel({
  customer,
  onClose,
  onMergeComplete,
  activeFormName,
  activeFormAddress,
  activeFormCity,
  activeFormPlz,
  onApplyPlzSuggestion,
  onTakeoverCustomer,
}: {
  customer: CustomerData;
  onClose: () => void;
  onMergeComplete: (result: MergeCompleteResult) => void;
  activeFormName?: string | null;
  activeFormAddress?: string | null;
  activeFormCity?: string | null;
  activeFormPlz?: string | null;
  onApplyPlzSuggestion?: (plz: string) => void;
  /** Called when user clicks "Diesen Kunden übernehmen" on a duplicate card.
   *  Receives the full duplicate match record. The host page is responsible for
   *  persisting the document customerId change and updating local state. */
  onTakeoverCustomer?: (match: DuplicateMatch) => void;
}) {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<DuplicateMatch | null>(null);
  const [fieldSelection, setFieldSelection] = useState<Record<FieldKey, 'primary' | 'secondary'>>({
    name: 'primary', address: 'primary', plz: 'primary', city: 'primary', phone: 'primary', email: 'primary'
  });
  const [merging, setMerging] = useState(false);

  // === Phase 2g – Block C: Merge Undo state ===
  // preMergeSnapshot = a copy of the customer prop taken BEFORE the merge fetch.
  // This is used by undoMerge() to restore the surviving customer's fields.
  // We only snapshot customer-identity fields (name/address/plz/city/country/
  // phone/email); order/offer/invoice business data is NOT touched.
  const [preMergeSnapshot, setPreMergeSnapshot] = useState<CustomerData | null>(null);
  const [postMergeResult, setPostMergeResult] = useState<MergeCompleteResult | null>(null);
  const [undoing, setUndoing] = useState(false);

  // === Conservative PLZ suggestion (banner) ===
  // Two-state banner UI:
  //   • Suggestion mode (default): shows "PLZ übernehmen" + "Ignorieren".
  //   • Success mode: rendered after the user clicks "PLZ übernehmen" —
  //     shows confirmation + "Rückgängig" + "Schliessen".
  // Dismissal automatically resets when the suggested PLZ changes so a new
  // EXAKT match with a different PLZ can re-surface the banner.
  const [plzSuggestionDismissed, setPlzSuggestionDismissed] = useState(false);
  // Tracks the last-applied suggestion so the user can undo it back to the
  // exact previous form value (which may have been an empty string). Lives
  // ONLY in the panel — closing the duplicate dialog discards this state.
  const [lastAppliedPlz, setLastAppliedPlz] = useState<{
    previousPlz: string;
    appliedPlz: string;
  } | null>(null);

  // State for "Diesen Kunden übernehmen" — tracks which card is currently being taken over (loading indicator)
  const [takeoverLoadingId, setTakeoverLoadingId] = useState<string | null>(null);

  // Manual search state
  const [manualQuery, setManualQuery] = useState('');
  const [isManualMode, setIsManualMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live suggestions state
  const [suggestions, setSuggestions] = useState<DuplicateMatch[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dropUp, setDropUp] = useState(false); // adaptive placement: open upward when space below is tight
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fetchIdRef = useRef(0); // Track latest fetch to avoid stale results

  // Measure available space below the search input to decide dropdown placement
  const recomputeDropPlacement = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const DROPDOWN_H = 240; // must match max-h-[240px]
    // Prefer below; flip to above when there's not enough room below AND above has more room
    setDropUp(spaceBelow < DROPDOWN_H + 24 && spaceAbove > spaceBelow);
  }, []);

  const searchDuplicates = useCallback(async (manual?: string) => {
    setLoading(true);
    setSearched(false);
    setSelectedMatch(null);
    try {
      const body: Record<string, any> = {
        name: customer.name, address: customer.address, plz: customer.plz,
        city: customer.city, phone: customer.phone, email: customer.email,
        excludeId: customer.id,
      };
      if (manual?.trim()) body.manualQuery = manual.trim();
      const res = await fetch('/api/customers/find-duplicates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setMatches(await res.json());
      else toast.error('Fehler bei der Duplikat-Suche');
    } catch {
      toast.error('Netzwerkfehler');
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [customer]);

  // Root-cause fix: previously this used `useState(() => searchDuplicates())`
  // which fires only once per component lifetime. That kept stale matches
  // (including merged-away / soft-deleted secondaries) visible after merges
  // or other customer-list mutations. We now re-run the search whenever the
  // context customer's identity or its relevant matching fields change, and
  // we clear stale local state up front so no obsolete entries flash.
  useEffect(() => {
    setMatches([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedMatch(null);
    setSearched(false);
    searchDuplicates();
    // We intentionally depend on identity + matching fields; `searchDuplicates`
    // is wrapped in useCallback and also depends on `customer`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, customer.name, customer.plz, customer.city, customer.phone, customer.email]);

  // Live suggestions: debounced fetch while typing
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const thisId = ++fetchIdRef.current;
    setSuggestionsLoading(true);
    try {
      const res = await fetch('/api/customers/find-duplicates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customer.name, address: customer.address, plz: customer.plz,
          city: customer.city, phone: customer.phone, email: customer.email,
          excludeId: customer.id, manualQuery: query.trim(),
        }),
      });
      if (res.ok && thisId === fetchIdRef.current) {
        const data = await res.json();
        setSuggestions(data);
        if (data.length > 0) {
          recomputeDropPlacement();
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
      }
    } catch { /* silent */ } finally {
      if (thisId === fetchIdRef.current) setSuggestionsLoading(false);
    }
  }, [customer, recomputeDropPlacement]);

  // Debounce input changes for live suggestions
  const handleQueryChange = (val: string) => {
    setManualQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      if (isManualMode) {
        setIsManualMode(false);
        setMatches([]);
        setSearched(false);
        searchDuplicates();
      }
      return;
    }
    // Faster debounce for short queries (immediate feel), slightly longer for typing
    const delay = val.trim().length <= 2 ? 150 : 250;
    debounceRef.current = setTimeout(() => fetchSuggestions(val), delay);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keep dropdown placement correct when the user scrolls the dialog or the viewport resizes
  useEffect(() => {
    if (!showSuggestions) return;
    const onUpdate = () => recomputeDropPlacement();
    window.addEventListener('resize', onUpdate, { passive: true });
    window.addEventListener('scroll', onUpdate, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', onUpdate);
      window.removeEventListener('scroll', onUpdate, true);
    };
  }, [showSuggestions, recomputeDropPlacement]);

  const handleManualSearch = () => {
    if (!manualQuery.trim()) {
      toast.error('Suchbegriff eingeben');
      return;
    }
    setIsManualMode(true);
    setShowSuggestions(false);
    searchDuplicates(manualQuery);
  };

  const clearManualSearch = () => {
    setManualQuery('');
    setIsManualMode(false);
    setSuggestions([]);
    setShowSuggestions(false);
    searchDuplicates();
  };

  const selectSuggestion = (s: DuplicateMatch) => {
    setShowSuggestions(false);
    setManualQuery(s.name);
    setIsManualMode(true);
    setMatches([s]);
    setSearched(true);
    setLoading(false);
  };

  const selectMatch = (match: DuplicateMatch) => {
    setSelectedMatch(match);
    const sel: Record<FieldKey, 'primary' | 'secondary'> = {
      name: 'primary', address: 'primary', plz: 'primary',
      city: 'primary', phone: 'primary', email: 'primary',
    };
    for (const f of FIELDS) {
      const pVal = ((customer as any)[f.key] || '').trim();
      const sVal = ((match as any)[f.key] || '').trim();
      if (!pVal && sVal) sel[f.key] = 'secondary';
      else if (f.key === 'name' && pVal && sVal && sVal.length > pVal.length) sel[f.key] = 'secondary';
    }
    setFieldSelection(sel);
  };

  /**
   * Helper: parse "K-007" → 7, null if unparseable.
   * Used to determine which customerNumber is lower (= original).
   */
  const parseNum = (cn: string | null | undefined): number | null => {
    if (!cn) return null;
    const m = cn.match(/K-(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  };

  /**
   * Determine if the match has a lower customerNumber than the current customer.
   * If so, the backend will auto-swap direction to keep the lower number.
   * We mirror this in the UI for transparency.
   */
  const matchHasLowerNumber = selectedMatch
    ? (() => {
        const curNum = parseNum(customer.customerNumber);
        const matchNum = parseNum(selectedMatch.customerNumber);
        if (curNum !== null && matchNum !== null) return matchNum < curNum;
        if (curNum === null && matchNum !== null) return true;
        return false;
      })()
    : false;

  const executeMerge = async () => {
    if (!selectedMatch) return;
    setMerging(true);

    // === Phase 2g – Block C: snapshot BEFORE the merge fetch ===
    // We copy the customer prop (the one the user sees in the current edit
    // context). After merge, the backend may keep EITHER side depending on
    // customerNumber; but the undo always restores the surviving record's
    // identity fields to mirror what the user originally saw as "current".
    const snapshot: CustomerData = {
      id: customer.id,
      customerNumber: customer.customerNumber ?? null,
      name: customer.name,
      address: customer.address ?? null,
      plz: customer.plz ?? null,
      city: customer.city ?? null,
      phone: customer.phone ?? null,
      email: customer.email ?? null,
      country: customer.country ?? null,
    };

    try {
      const resolvedValues: Record<string, string | null> = {};
      for (const f of FIELDS) {
        const currentVal = ((customer as any)[f.key] || '').trim() || null;
        const duplicateVal = ((selectedMatch as any)[f.key] || '').trim() || null;
        resolvedValues[f.key] = fieldSelection[f.key] === 'primary' ? currentVal : duplicateVal;
      }
      // The backend enforces direction: the customer with the LOWER customerNumber
      // always survives. We send keepId/mergeId as-is — the backend will auto-correct.
      const res = await fetch('/api/customers/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId: customer.id, mergeId: selectedMatch.id, resolvedValues, contextCustomerId: customer.id }),
      });
      if (res.ok) {
        const result = await res.json();
        const kept = result.primaryCustomer?.customerNumber || '';
        const keptId = result.primaryCustomer?.id || '';
        toast.success(`Kunden zusammengeführt (${kept} bleibt) – ${result.counts?.orders || 0} Aufträge, ${result.counts?.offers || 0} Angebote, ${result.counts?.invoices || 0} Rechnungen übertragen`);
        // Phase 2g – Block C: keep the panel OPEN and show a post-merge
        // success/undo screen. We still propagate the surviving customer
        // back to the parent so its form rebinds correctly.
        if (keptId) {
          // Stage F – Critical bug fix:
          // The merge backend persists `resolvedValues` to the surviving
          // record but only returns {id, name, customerNumber} in the
          // response. Consumers (Auftrag/Angebot/Rechnung edit dialogs and
          // the Kunden detail edit form) need the full merged record to
          // immediately repopulate their LOCAL form state — otherwise the
          // form keeps showing stale values and a subsequent
          // "Kunde aktualisieren" overwrites the merge with stale data.
          //
          // We fetch /api/customers/{keptId} once here (single source of
          // truth) and pass the result via MergeCompleteResult.mergedCustomer
          // so each consumer can synchronously replace its form state.
          let mergedCustomer: CustomerData | undefined = undefined;
          try {
            const cres = await fetch(`/api/customers/${keptId}`);
            if (cres.ok) {
              const c = await cres.json();
              mergedCustomer = {
                id: c.id,
                customerNumber: c.customerNumber ?? null,
                name: c.name ?? '',
                address: c.address ?? null,
                plz: c.plz ?? null,
                city: c.city ?? null,
                phone: c.phone ?? null,
                email: c.email ?? null,
                country: c.country ?? null,
              };
            }
          } catch { /* silent — consumer has list-reload fallback */ }
          const mergeResult: MergeCompleteResult = {
            survivingCustomerId: keptId,
            survivingCustomerNumber: kept,
            mergedCustomer,
          };
          setPreMergeSnapshot(snapshot);
          setPostMergeResult(mergeResult);
          onMergeComplete(mergeResult);
        } else {
          // Defensive: without a survivor id we can't offer undo, so close.
          onClose();
        }
      } else {
        const err = await res.json();
        toast.error(err.error || 'Zusammenführen fehlgeschlagen');
      }
    } catch {
      toast.error('Netzwerkfehler beim Zusammenführen');
    } finally {
      setMerging(false);
    }
  };

  /**
   * Phase 2g – Block C: Undo the merge.
   *
   * Restores the surviving customer's identity fields to the pre-merge
   * snapshot of the context (`customer` prop).
   *
   * Scope: ONLY customer-identity fields (name/address/plz/city/country/
   *        phone/email). Order/offer/invoice business data is NOT touched.
   *
   * Note: the customer record that was merged AWAY is already hard-deleted
   * by the backend merge endpoint — that row cannot be restored. This undo
   * is a data-quality safeguard that reverts overwritten field values so
   * the user doesn't silently lose good data. If the user actually wanted
   * to keep both records separate, they can create a new customer.
   *
   * We rely on the PUT /api/customers/[id] guard (`fieldsToClear`) so empty
   * snapshot values that would wipe current DB values require opt-in.
   */
  const undoMerge = async () => {
    if (!preMergeSnapshot || !postMergeResult) return;
    setUndoing(true);
    try {
      // Map snapshot fields to the PUT payload. Only include fields we want
      // to restore. Compute fieldsToClear: a snapshot field that is empty
      // but the surviving customer currently has a value for.
      const fieldsToClear: string[] = [];
      const payload: Record<string, any> = {
        name:    (preMergeSnapshot.name || '').trim(),
        address: (preMergeSnapshot.address || '').trim(),
        plz:     (preMergeSnapshot.plz || '').trim(),
        city:    (preMergeSnapshot.city || '').trim(),
        phone:   (preMergeSnapshot.phone || '').trim(),
        email:   (preMergeSnapshot.email || '').trim(),
      };
      if (preMergeSnapshot.country && preMergeSnapshot.country.trim()) {
        payload.country = preMergeSnapshot.country.trim();
      }

      // Any field in the snapshot that is empty → opt-in to clear if needed.
      // The backend only actually clears when the surviving record's current
      // value is non-empty; empty-to-empty is a no-op there.
      for (const k of ['name','address','plz','city','phone','email'] as const) {
        if (!payload[k]) fieldsToClear.push(k);
      }
      payload.fieldsToClear = fieldsToClear;

      const res = await fetch(`/api/customers/${postMergeResult.survivingCustomerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success('Zusammenführung rückgängig – Kundendaten wiederhergestellt');
        // Re-fire onMergeComplete so the parent page reloads its customers
        // list / rebinds its form from the freshly-PUT record.
        onMergeComplete(postMergeResult);
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Rückgängig machen fehlgeschlagen');
      }
    } catch {
      toast.error('Netzwerkfehler beim Rückgängig machen');
    } finally {
      setUndoing(false);
    }
  };


  // === Conservative PLZ suggestion (banner) ===
  // Derived from current matches. Surfaces a "PLZ übernehmen?" banner *only*
  // when ALL of the following hold:
  //   • Apply callback was provided (feature opt-in).
  //   • Active form has name, street AND city all non-empty.
  //   • Active form's PLZ is empty / whitespace.
  //   • ≥1 match has classification === 'EXAKT' AND a non-empty PLZ.
  //   • All EXAKT matches with a PLZ agree on a single value (case-insens).
  // Never auto-applies — user must click. No suggestion from weak/unsicher
  // matches. No PLZ guessing from city alone. Reads only from `matches[]`
  // (server-side duplicate-detection result), never from Order.notes —
  // this keeps the L1/L2/L3 anti-pollution defense fully intact.
  const plzSuggestion = useMemo(() => {
    if (!onApplyPlzSuggestion) return null;
    // The active form must have name + street + city present. Each prop
    // falls back to the saved record when not supplied so the same logic
    // works for callers that pre-fill from `customer`.
    const formName    = (activeFormName    ?? customer.name    ?? '').trim();
    const formAddress = (activeFormAddress ?? customer.address ?? '').trim();
    const formCity    = (activeFormCity    ?? customer.city    ?? '').trim();
    const formPlz     = (activeFormPlz     ?? customer.plz     ?? '').trim();
    if (!formName || !formAddress || !formCity) return null;
    if (formPlz) return null; // form already has a PLZ — never overwrite
    const exaktWithPlz = matches.filter(
      (m) => m.classification === 'EXAKT' && (m.plz || '').trim().length > 0,
    );
    if (exaktWithPlz.length === 0) return null;
    const uniquePlz = Array.from(
      new Set(exaktWithPlz.map((m) => (m.plz || '').trim().toLowerCase())),
    );
    if (uniquePlz.length !== 1) return null; // ambiguous → no suggestion
    const winning = exaktWithPlz[0];
    return {
      plz: (winning.plz || '').trim(),
      sourceName: winning.name,
      sourceCustomerNumber: winning.customerNumber || null,
      totalSources: exaktWithPlz.length,
    };
  }, [
    matches,
    activeFormName,
    activeFormAddress,
    activeFormCity,
    activeFormPlz,
    customer.name,
    customer.address,
    customer.city,
    customer.plz,
    onApplyPlzSuggestion,
  ]);

  // Reset dismissal AND last-applied-snapshot whenever the suggested PLZ
  // value changes so a freshly computed suggestion can re-surface cleanly.
  useEffect(() => {
    setPlzSuggestionDismissed(false);
    setLastAppliedPlz(null);
  }, [plzSuggestion?.plz]);

  // === DISPLAY FIELDS for cards: PLZ and city shown as one combined row ===
  const CARD_DISPLAY_FIELDS: { keys: FieldKey[]; label: string }[] = [
    { keys: ['name'], label: 'Name' },
    { keys: ['address'], label: 'Strasse' },
    { keys: ['plz', 'city'], label: 'PLZ / Ort' },
    { keys: ['phone'], label: 'Telefon' },
    { keys: ['email'], label: 'E-Mail' },
  ];

  // Handle "Diesen Kunden übernehmen" click
  const handleTakeover = async (m: DuplicateMatch) => {
    if (!onTakeoverCustomer) return;
    setTakeoverLoadingId(m.id);
    try {
      await onTakeoverCustomer(m);
    } finally {
      setTakeoverLoadingId(null);
    }
  };

  // === Match list renderer — card design with "Diesen Kunden übernehmen" button ===
  const renderMatchList = () => (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        {matches.length} {isManualMode ? 'Suchergebnis' : 'Treffer'}{matches.length !== 1 ? 'se' : ''}:
      </p>
      <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-0.5">
        {matches.map((m) => {
          const cfg = CLASS_CONFIG[m.classification];
          const Icon = cfg.icon;
          const docCount = (m._count?.orders || 0) + (m._count?.offers || 0) + (m._count?.invoices || 0);
          const isTakingOver = takeoverLoadingId === m.id;

          return (
            <div
              key={m.id}
              className={`rounded-lg border ${cfg.cardBorder} ${cfg.cardBg} p-2.5 space-y-2 transition-all`}
            >
              {/* Card header: name + badge */}
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-semibold truncate min-w-0">
                  {m.customerNumber ? `${m.customerNumber} · ` : ''}{m.name}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isManualMode && (
                    <Badge className={`text-[9px] px-1.5 py-0 ${cfg.badgeColor}`}>
                      <Icon className="w-2.5 h-2.5 mr-0.5" />{cfg.label}
                    </Badge>
                  )}
                  {docCount > 0 && <span className="text-[9px] text-muted-foreground bg-white/60 dark:bg-black/20 px-1 py-0.5 rounded">{docCount} Dok.</span>}
                </div>
              </div>

              {/* Customer data display (read-only) */}
              <div className="space-y-0.5 text-[11px]">
                {CARD_DISPLAY_FIELDS.map(({ keys, label }) => {
                  const displayValue = keys.length > 1
                    ? keys.map(k => ((m as any)[k] || '').trim()).filter(Boolean).join(' ')
                    : ((m as any)[keys[0]] || '').trim();
                  if (!displayValue) return null;
                  return (
                    <div key={keys.join('-')} className="flex items-center gap-2 px-2 py-0.5">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">{label}</span>
                      <span className="text-xs truncate min-w-0">{displayValue}</span>
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-1 pt-1">
                {onTakeoverCustomer && (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => handleTakeover(m)}
                    disabled={isTakingOver || (takeoverLoadingId !== null && takeoverLoadingId !== m.id)}
                  >
                    {isTakingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                    Diesen Kunden übernehmen
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => selectMatch(m)}
                  className="w-full text-center text-[11px] text-muted-foreground hover:text-primary hover:underline py-0.5"
                >
                  Vergleichen & zusammenführen →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // === Field comparison row ===
  // Mobile: label above, 2-col buttons below — avoids cramping on 320px screens
  // Desktop (sm+): 3-col grid with label column
  const renderFieldRow = (key: FieldKey, label: string) => {
    const pVal = ((customer as any)[key] || '').trim();
    const sVal = ((selectedMatch as any)[key] || '').trim();
    const isEqual = pVal.toLowerCase() === sVal.toLowerCase();
    const isDifferent = !isEqual && pVal && sVal;
    const selected = fieldSelection[key];
    const pBtnCls = `text-left px-1.5 py-1.5 rounded border text-[11px] transition-all break-words min-w-0 leading-snug ${
      selected === 'primary'
        ? 'border-green-500 bg-green-50 dark:bg-green-900/20 font-medium shadow-sm'
        : 'border-transparent bg-muted/30 hover:border-gray-300'
    } ${!pVal ? 'italic text-muted-foreground' : ''}`;
    const sBtnCls = `text-left px-1.5 py-1.5 rounded border text-[11px] transition-all break-words min-w-0 leading-snug ${
      selected === 'secondary'
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 font-medium shadow-sm'
        : 'border-transparent bg-muted/30 hover:border-gray-300'
    } ${!sVal ? 'italic text-muted-foreground' : ''}`;
    const labelEl = (
      <span className="text-[10px] font-semibold text-muted-foreground leading-tight">
        {label}
        {isDifferent && <span className="text-amber-500 ml-0.5">≠</span>}
        {isEqual && pVal && <span className="text-green-500 ml-0.5">✓</span>}
      </span>
    );

    return (
      <div key={key} className={`rounded ${isDifferent ? 'bg-amber-50/80 dark:bg-amber-900/10' : ''}`}>
        {/* Mobile: label row + 2-col buttons */}
        <div className="sm:hidden px-1 py-0.5">
          <div className="mb-0.5">{labelEl}</div>
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setFieldSelection(s => ({ ...s, [key]: 'primary' }))} className={pBtnCls}>
              {pVal || '–'}{selected === 'primary' && <Check className="w-2.5 h-2.5 text-green-600 inline ml-0.5" />}
            </button>
            <button type="button" onClick={() => setFieldSelection(s => ({ ...s, [key]: 'secondary' }))} className={sBtnCls}>
              {sVal || '–'}{selected === 'secondary' && <Check className="w-2.5 h-2.5 text-blue-600 inline ml-0.5" />}
            </button>
          </div>
        </div>
        {/* Desktop (sm+): 3-col grid */}
        <div className="hidden sm:grid grid-cols-[3.5rem_1fr_1fr] gap-x-1.5 items-center px-1 py-1">
          <span className="truncate">{labelEl}</span>
          <button type="button" onClick={() => setFieldSelection(s => ({ ...s, [key]: 'primary' }))} className={pBtnCls}>
            {pVal || '–'}{selected === 'primary' && <Check className="w-2.5 h-2.5 text-green-600 inline ml-0.5" />}
          </button>
          <button type="button" onClick={() => setFieldSelection(s => ({ ...s, [key]: 'secondary' }))} className={sBtnCls}>
            {sVal || '–'}{selected === 'secondary' && <Check className="w-2.5 h-2.5 text-blue-600 inline ml-0.5" />}
          </button>
        </div>
      </div>
    );
  };

  // === Phase 2g – Block C: post-merge success / undo view ===
  // When postMergeResult is set, we replace the regular body with an
  // "it was merged, do you want to undo?" banner. This lets the user
  // recover instantly without leaving the context.
  if (postMergeResult && preMergeSnapshot) {
    return (
      <div className="sm:border-l sm:pl-4 space-y-3 min-h-[180px] overflow-x-hidden overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Zusammengeführt
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-7 px-2">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            Kunde {postMergeResult.survivingCustomerNumber || ''} bleibt erhalten.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Falls ungewollt, können die zuvor angezeigten Kundendaten (Name,
            Adresse, Telefon, E-Mail) wiederhergestellt werden. Aufträge,
            Angebote und Rechnungen bleiben in jedem Fall verbunden.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/40 p-2.5 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ursprüngliche Daten (werden bei Rückgängig wiederhergestellt)
          </p>
          <div className="text-[11px] leading-snug">
            <div className="font-medium">
              {preMergeSnapshot.customerNumber ? `${preMergeSnapshot.customerNumber} · ` : ''}
              {preMergeSnapshot.name || '–'}
            </div>
            <div className="text-muted-foreground truncate">
              {[preMergeSnapshot.address, [preMergeSnapshot.plz, preMergeSnapshot.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Keine Adresse'}
            </div>
            {(preMergeSnapshot.phone || preMergeSnapshot.email) && (
              <div className="text-muted-foreground truncate">
                {preMergeSnapshot.phone ? preMergeSnapshot.phone : ''}
                {preMergeSnapshot.phone && preMergeSnapshot.email ? ' · ' : ''}
                {preMergeSnapshot.email || ''}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9 text-xs"
            onClick={onClose}
            disabled={undoing}
          >
            Schließen
          </Button>
          <Button
            size="sm"
            className="flex-1 h-9 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            onClick={undoMerge}
            disabled={undoing}
          >
            {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}
            Rückgängig machen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="sm:border-l sm:pl-4 space-y-2 min-h-[180px] overflow-x-hidden overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Search className="w-3.5 h-3.5" /> Duplikate</h3>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-7 px-2">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {!selectedMatch ? (
        /* === TREFFER-LISTE === */
        <>
          {/* Compact current customer summary */}
          <div className="bg-muted/50 rounded p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-semibold truncate">
                {customer.customerNumber ? `${customer.customerNumber} · ` : ''}{customer.name}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate pl-3.5">
              {[customer.address, [customer.plz, customer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Keine Adresse'}
              {customer.phone ? ` · ${customer.phone}` : ''}
              {customer.email ? ` · ${customer.email}` : ''}
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground">
                {isManualMode ? 'Suche…' : 'Duplikate werden gesucht…'}
              </span>
            </div>
          )}

          {searched && !loading && matches.length === 0 && !isManualMode && (
            <div className="text-center py-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto mb-1" />
              <p className="text-xs font-medium">Keine Duplikate gefunden</p>
            </div>
          )}

          {searched && !loading && matches.length === 0 && isManualMode && (
            <div className="text-center py-3">
              <p className="text-xs text-muted-foreground">Keine Kunden für «{manualQuery}»</p>
            </div>
          )}

          {/* === Conservative PLZ suggestion banner — Suggestion mode === */}
          {/* Visible while: search done + suggestion derived + no apply yet
              + not dismissed. Reads only from match list (never from notes). */}
          {searched && !loading && plzSuggestion && !lastAppliedPlz && !plzSuggestionDismissed && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30 px-2.5 py-2 flex items-start gap-2"
              role="status"
              aria-label="PLZ-Vorschlag aus exaktem Duplikat"
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-[11.5px] leading-snug text-amber-900 dark:text-amber-100">
                  PLZ{' '}
                  <span className="font-mono font-semibold">
                    {plzSuggestion.plz}
                  </span>{' '}
                  aus bestehendem Kunden{' '}
                  <span className="font-medium">
                    «{plzSuggestion.sourceCustomerNumber
                      ? `${plzSuggestion.sourceCustomerNumber} · `
                      : ''}
                    {plzSuggestion.sourceName}»
                  </span>{' '}
                  übernehmen?
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2.5 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      // Capture current form value BEFORE apply so undo can
                      // restore the exact previous state (may be empty ''.).
                      const previousPlz = (activeFormPlz ?? customer.plz ?? '').toString();
                      onApplyPlzSuggestion?.(plzSuggestion.plz);
                      setLastAppliedPlz({ previousPlz, appliedPlz: plzSuggestion.plz });
                    }}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    PLZ übernehmen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    onClick={() => setPlzSuggestionDismissed(true)}
                  >
                    Ignorieren
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* === Conservative PLZ suggestion banner — Success / Undo mode === */}
          {/* Visible while: an apply happened, until user clicks "Schliessen"
              or selects "Rückgängig". Robust on mobile (sticky banner instead
              of disappearing toast). */}
          {searched && !loading && lastAppliedPlz && (
            <div
              className="rounded-lg border border-green-300 bg-green-50 dark:border-green-700/60 dark:bg-green-950/30 px-2.5 py-2 flex items-start gap-2"
              role="status"
              aria-label="PLZ erfolgreich übernommen"
            >
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-700 dark:text-green-300" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-[11.5px] leading-snug text-green-900 dark:text-green-100">
                  PLZ{' '}
                  <span className="font-mono font-semibold">
                    {lastAppliedPlz.appliedPlz}
                  </span>{' '}
                  ins Formular übernommen. Die Quelle bleibt unverändert.
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] border-green-400 text-green-900 dark:text-green-100 hover:bg-green-100 dark:hover:bg-green-900/40"
                    onClick={() => {
                      onApplyPlzSuggestion?.(lastAppliedPlz.previousPlz);
                      toast.message('PLZ-Übernahme rückgängig gemacht');
                      setLastAppliedPlz(null);
                    }}
                  >
                    <Undo2 className="w-3 h-3 mr-1" />
                    Rückgängig
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-green-900 dark:text-green-100 hover:bg-green-100 dark:hover:bg-green-900/40"
                    onClick={() => {
                      // Confirm the apply and dismiss this banner instance.
                      // The suggestion derivation will re-evaluate against
                      // the freshly-applied form state on next match update.
                      setLastAppliedPlz(null);
                      setPlzSuggestionDismissed(true);
                    }}
                  >
                    Schliessen
                  </Button>
                </div>
              </div>
            </div>
          )}

          {searched && !loading && matches.length > 0 && renderMatchList()}

          {/* === Search input with live suggestions === */}
          {searched && !loading && (
            <div className="space-y-1.5 pt-1 border-t">
              <form onSubmit={(e) => { e.preventDefault(); handleManualSearch(); }} className="flex gap-1">
                <div className="relative flex-1">
                  <Input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Kunde suchen…"
                    value={manualQuery}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    onFocus={() => { if (suggestions.length > 0) { recomputeDropPlacement(); setShowSuggestions(true); } }}
                    className="h-10 text-sm pr-8"
                    autoComplete="off"
                  />
                  {manualQuery && (
                    <button type="button" onClick={clearManualSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 tap-safe">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  {/* Live suggestions dropdown — adaptive placement (up/down based on available space) */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div ref={suggestionsRef}
                      className={`absolute left-0 right-0 z-50 bg-background border rounded-md shadow-lg max-h-[240px] overflow-y-auto ${dropUp ? 'bottom-full mb-0.5' : 'top-full mt-0.5'}`}>
                      {suggestions.map((s) => (
                        <button key={s.id} type="button" onClick={() => selectSuggestion(s)}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-muted/60 transition-colors border-b last:border-b-0">
                          <span className="text-xs font-medium">{s.customerNumber ? `${s.customerNumber} · ` : ''}{s.name}</span>
                          <span className="text-[10px] text-muted-foreground block truncate">
                            {[s.address, s.plz, s.city].filter(Boolean).join(', ')}
                            {s.phone ? ` · ${s.phone}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {suggestionsLoading && manualQuery.trim().length >= 1 && (
                    <div className="absolute right-8 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                <Button type="submit" size="sm" className="h-10 px-3 shrink-0 tap-safe" disabled={loading || !manualQuery.trim()}>
                  <Search className="w-4 h-4" />
                </Button>
              </form>
              {isManualMode && (
                <button onClick={clearManualSearch}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-0.5">
                  ← Auto-Erkennung
                </button>
              )}
            </div>
          )}

          {/* Removed: old checkbox-based "Ausgewählte Daten übernehmen" button.
              Now each card has its own "Diesen Kunden übernehmen" button. */}
        </>
      ) : (
        /* === VERGLEICHSANSICHT — unified compact layout for all screen sizes === */
        <>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setSelectedMatch(null)} className="-ml-2 gap-1 text-muted-foreground text-xs h-7">
              <ArrowLeft className="w-3 h-3" /> Zurück
            </Button>
            <Badge className={CLASS_CONFIG[selectedMatch.classification].badgeColor + ' text-[9px] px-1.5'}>
              {CLASS_CONFIG[selectedMatch.classification].label}
            </Badge>
          </div>

          {/* Column headers — mobile: 2-col, desktop: 3-col */}
          <div className="sm:hidden flex gap-3 text-[10px] font-semibold text-muted-foreground px-1 pb-1 border-b">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Aktuell</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Duplikat</span>
          </div>
          <div className="hidden sm:grid grid-cols-[3.5rem_1fr_1fr] gap-x-1.5 text-[10px] font-semibold text-muted-foreground px-1 pb-1 border-b">
            <span />
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Aktuell</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Duplikat</span>
          </div>

          {/* CustomerNumber identity row — non-selectable, shows which number survives */}
          {(customer.customerNumber || selectedMatch.customerNumber) && (
            <div className="rounded bg-emerald-50/80 dark:bg-emerald-900/10 px-2 py-1.5 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">Kundennr. bleibt:</span>
                <span className="font-bold text-emerald-800 dark:text-emerald-300">
                  {matchHasLowerNumber ? selectedMatch.customerNumber : customer.customerNumber || '–'}
                </span>
                {matchHasLowerNumber && (
                  <span className="text-[9px] text-amber-600 dark:text-amber-400 ml-auto">
                    ↑ niedrigere Nr. wird behalten
                  </span>
                )}
              </div>
              {matchHasLowerNumber && (
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  {selectedMatch.customerNumber} ist die ältere Kundennummer und wird automatisch als Identität beibehalten.
                </p>
              )}
            </div>
          )}

          {/* Field-by-field comparison — same layout on mobile and desktop */}
          <div className="space-y-0">
            {FIELDS.map(({ key, label }) => renderFieldRow(key, label))}
          </div>

          {/* Merge info — compact */}
          <p className="text-[10px] text-muted-foreground flex items-start gap-1 px-1">
            <Info className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
            <span>
              {matchHasLowerNumber
                ? `${selectedMatch.customerNumber} (ältere Nr.) bleibt. Alle Dokumente werden zusammengeführt, ${customer.customerNumber || 'aktueller Kunde'} wird gelöscht.`
                : 'Aktueller Kunde bleibt. Dokumente des Duplikats werden übertragen, Duplikat gelöscht.'}
            </span>
          </p>

          {/* Action buttons */}
          <div className="flex gap-2 pt-0.5">
            <Button variant="outline" size="sm" className="flex-1 h-9 text-xs" onClick={() => setSelectedMatch(null)} disabled={merging}>
              Abbrechen
            </Button>
            <Button size="sm" className="flex-1 h-9 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={executeMerge} disabled={merging}>
              {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              Zusammenführen
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// === Dialog version (used in Kunden-Detail page) ===
// Mirrors the Orders/Offers/Invoices layout: current customer summary on left,
// duplicate matches/comparison panel on right — side-by-side on sm+ screens.
export default function CustomerDuplicateCheck({
  customer,
  open,
  onOpenChange,
  onMergeComplete,
  activeFormName,
  activeFormAddress,
  activeFormCity,
  activeFormPlz,
  onApplyPlzSuggestion,
}: CustomerDuplicateCheckProps) {
  const missing = (v: any) => !v || !String(v).trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Search className="w-4 h-4" /> Duplikate prüfen
          </DialogTitle>
        </DialogHeader>
        {open && (
          <div className="grid grid-cols-1 min-[520px]:grid-cols-2 gap-4 dupcheck-split">
            {/* Current customer summary (left column on sm+) */}
            <div className="space-y-3 max-h-[35vh] sm:max-h-none overflow-y-auto dupcheck-form-col">
              <div className="border rounded-lg p-3 bg-muted/30 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-sm font-semibold">👤 Aktueller Kunde</span>
                </div>
                <div className="text-sm font-medium pl-3.5">
                  {customer.customerNumber ? <span className="text-muted-foreground">{customer.customerNumber} · </span> : null}
                  {customer.name}
                </div>
                <div className="grid grid-cols-1 gap-1 text-xs pl-3.5">
                  <div className={`flex items-start gap-1 ${missing(customer.address) ? 'text-red-500' : 'text-foreground/70'}`}>
                    <span className="font-medium w-16 shrink-0">Strasse:</span>
                    <span className={missing(customer.address) ? 'border-b border-red-400 border-dashed italic' : ''}>{customer.address || 'fehlt'}</span>
                  </div>
                  <div className="flex gap-3">
                    <div className={`flex items-start gap-1 ${missing(customer.plz) ? 'text-red-500' : 'text-foreground/70'}`}>
                      <span className="font-medium w-16 shrink-0">PLZ:</span>
                      <span className={missing(customer.plz) ? 'border-b border-red-400 border-dashed italic' : ''}>{customer.plz || 'fehlt'}</span>
                    </div>
                    <div className={`flex items-start gap-1 ${missing(customer.city) ? 'text-red-500' : 'text-foreground/70'}`}>
                      <span className="font-medium shrink-0">Ort:</span>
                      <span className={missing(customer.city) ? 'border-b border-red-400 border-dashed italic' : ''}>{customer.city || 'fehlt'}</span>
                    </div>
                  </div>
                  <div className={`flex items-start gap-1 ${missing(customer.phone) ? 'text-red-500' : 'text-foreground/70'}`}>
                    <span className="font-medium w-16 shrink-0">Tel:</span>
                    <span className={missing(customer.phone) ? 'border-b border-red-400 border-dashed italic' : ''}>{customer.phone || 'fehlt'}</span>
                  </div>
                  <div className={`flex items-start gap-1 ${missing(customer.email) ? 'text-red-500' : 'text-foreground/70'}`}>
                    <span className="font-medium w-16 shrink-0">E-Mail:</span>
                    <span className={`break-all ${missing(customer.email) ? 'border-b border-red-400 border-dashed italic' : ''}`}>{customer.email || 'fehlt'}</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground px-1">
                Die rechte Spalte zeigt mögliche Duplikate. Klicken Sie «Diesen Kunden übernehmen», um den Kunden zu wechseln.
              </p>
            </div>

            {/* Duplicate panel (right column on sm+) */}
            <DuplicateCheckPanel
              customer={customer}
              onClose={() => onOpenChange(false)}
              onMergeComplete={onMergeComplete}
              activeFormName={activeFormName}
              activeFormAddress={activeFormAddress}
              activeFormCity={activeFormCity}
              activeFormPlz={activeFormPlz}
              onApplyPlzSuggestion={onApplyPlzSuggestion}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}