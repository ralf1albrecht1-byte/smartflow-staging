"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { formatMergedContactReviewTooltip } from "@/components/communication-block";

type MergedContactReviewChipProps = {
  records: any[];
  compact?: boolean;
};

type PopoverPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const VIEWPORT_PADDING = 12;
const POPOVER_GAP = 8;
const DEFAULT_POPOVER_HEIGHT = 320;
const MAX_POPOVER_HEIGHT = 560;
const HIDE_DELAY_MS = 220;

function normalizePhoneHref(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 9) return "";
  return `${hasPlus ? "+" : ""}${digits}`;
}

function renderLinkedLine(line: string, lineKey: string): ReactNode {
  const tokenPattern = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d(?:[\s()./-]*\d){8,})/gi;
  const parts = line.split(tokenPattern);

  return parts.map((part, index) => {
    if (!part) return null;

    if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(part)) {
      return (
        <a
          key={`${lineKey}-mail-${index}`}
          href={`mailto:${part}`}
          className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </a>
      );
    }

    const phoneHref = normalizePhoneHref(part);
    if (phoneHref) {
      return (
        <a
          key={`${lineKey}-phone-${index}`}
          href={`tel:${phoneHref}`}
          className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </a>
      );
    }

    return <span key={`${lineKey}-text-${index}`}>{part}</span>;
  });
}

function StructuredContactText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  return (
    <div className="space-y-1.5 text-left text-[12px] leading-relaxed text-slate-800 dark:text-slate-100">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        const key = `merged-contact-line-${index}`;

        if (!line) return <div key={key} className="h-1" aria-hidden="true" />;

        if (/^[\-–—─_]{3,}$/.test(line)) {
          return (
            <div
              key={key}
              className="my-2 border-t border-slate-200 dark:border-slate-700"
              aria-hidden="true"
            />
          );
        }

        const isHeading =
          index === 0 ||
          /^(?:arbeitsort|ausführungsort|ausfuehrungsort|objekt|kontakt|kontakte|mehrere daten)/i.test(
            line,
          ) ||
          /:$/.test(line);

        return (
          <div
            key={key}
            className={
              isHeading
                ? "break-words font-bold text-slate-950 dark:text-white"
                : "break-words"
            }
          >
            {renderLinkedLine(line, key)}
          </div>
        );
      })}
    </div>
  );
}

export function MergedContactReviewChip({
  records,
  compact = false,
}: MergedContactReviewChipProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const tooltipText = useMemo(
    () =>
      String(formatMergedContactReviewTooltip(records || []) || "").trim() ||
      "Mehrere Kontaktdaten vorhanden. Bitte prüfen.",
    [records],
  );

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const calculatePosition = useCallback((): PopoverPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return null;

    const rect = trigger.getBoundingClientRect();
    const width = Math.max(
      280,
      Math.min(420, window.innerWidth - VIEWPORT_PADDING * 2),
    );
    const desiredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, desiredLeft),
      Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
    );

    const availableAbove = Math.max(
      0,
      rect.top - POPOVER_GAP - VIEWPORT_PADDING,
    );
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - POPOVER_GAP - VIEWPORT_PADDING,
    );
    const measuredHeight = popoverRef.current?.scrollHeight || DEFAULT_POPOVER_HEIGHT;
    const desiredHeight = Math.min(MAX_POPOVER_HEIGHT, measuredHeight);

    // Bevorzugt nach oben. Nur wenn dort der Inhalt nicht sinnvoll Platz hat
    // und unten deutlich mehr Raum vorhanden ist, wird nach unten geöffnet.
    const openBelow =
      availableAbove < Math.min(desiredHeight, 220) &&
      availableBelow > availableAbove;
    const available = openBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(1, Math.min(MAX_POPOVER_HEIGHT, available));

    if (openBelow) {
      return {
        left,
        width,
        maxHeight,
        top: rect.bottom + POPOVER_GAP,
      };
    }

    return {
      left,
      width,
      maxHeight,
      bottom: window.innerHeight - rect.top + POPOVER_GAP,
    };
  }, []);

  const updatePosition = useCallback(() => {
    const nextPosition = calculatePosition();
    if (nextPosition) setPosition(nextPosition);
  }, [calculatePosition]);

  const showPopover = useCallback(() => {
    clearHideTimer();
    updatePosition();
    setOpen(true);
  }, [clearHideTimer, updatePosition]);

  const hidePopoverSoon = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setOpen(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(updatePosition);
    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePosition]);

  useEffect(
    () => () => {
      clearHideTimer();
    },
    [clearHideTimer],
  );

  const popoverStyle: CSSProperties | undefined = position
    ? {
        position: "fixed",
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        ...(position.top !== undefined ? { top: position.top } : {}),
        ...(position.bottom !== undefined ? { bottom: position.bottom } : {}),
      }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={
          compact
            ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-100 text-amber-800 shadow-sm outline-none hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100"
            : "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-2.5 text-xs font-semibold text-amber-900 shadow-sm outline-none hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100"
        }
        aria-label="Mehrere Kontaktdaten prüfen"
        aria-expanded={open}
        aria-haspopup="dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={showPopover}
        onPointerLeave={hidePopoverSoon}
        onFocus={showPopover}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !popoverRef.current?.contains(nextTarget)) {
            hidePopoverSoon();
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearHideTimer();
          if (open) {
            setOpen(false);
          } else {
            updatePosition();
            setOpen(true);
          }
        }}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {!compact && <span>Kontakte prüfen</span>}
      </button>

      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Mehrere Kontaktdaten"
            tabIndex={-1}
            style={popoverStyle}
            className="isolate z-[2147483000] overflow-y-auto overscroll-contain rounded-xl border border-slate-300 bg-white p-3 text-left opacity-100 shadow-2xl ring-1 ring-black/10 dark:border-slate-600 dark:bg-slate-950 dark:ring-white/10"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={clearHideTimer}
            onPointerLeave={hidePopoverSoon}
            onFocus={clearHideTimer}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget as Node | null;
              if (
                !nextTarget ||
                (!popoverRef.current?.contains(nextTarget) &&
                  !triggerRef.current?.contains(nextTarget))
              ) {
                hidePopoverSoon();
              }
            }}
          >
            <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <div className="text-sm font-bold text-slate-950 dark:text-white">
                  Mehrere Kontaktdaten
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  Nach Auftrag und Arbeitsort zusammengefasst
                </div>
              </div>
            </div>
            <StructuredContactText text={tooltipText} />
          </div>,
          document.body,
        )}
    </>
  );
}
