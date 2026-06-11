"use client";

import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMergedContactReviewEntries,
  type CommunicationData,
  type MergedContactReviewEntry,
} from "@/components/communication-block";

function isTouchPointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function normalizePhoneForAction(value: string): string {
  const raw = String(value || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function whatsappNumber(value: string): string {
  const normalized = normalizePhoneForAction(value).replace(/^\+/, "");
  if (!normalized) return "";
  if (normalized.startsWith("0")) return `41${normalized.slice(1)}`;
  return normalized;
}

function actionHref(entry: MergedContactReviewEntry): string | undefined {
  const channel =
    `${entry.channelLabel || ""} ${entry.detail || ""}`.toLowerCase();
  const value = String(entry.contactValue || "").trim();
  if (!value) return entry.href;
  if (
    channel.includes("e-mail") ||
    channel.includes("email") ||
    value.includes("@")
  ) {
    return `mailto:${value}`;
  }
  const phone = normalizePhoneForAction(value);
  if (!phone) return entry.href;
  if (channel.includes("whatsapp")) {
    const waNumber = whatsappNumber(value);
    return waNumber ? `https://wa.me/${waNumber}` : entry.href;
  }
  if (channel.includes("sms")) return `sms:${phone}`;
  return `tel:${phone}`;
}

function ContactEntries({
  entries,
  onAction,
}: {
  entries: MergedContactReviewEntry[];
  onAction?: () => void;
}) {
  return (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const href = actionHref(entry);
        return (
          <div
            key={`${entry.siteLabel}-${entry.contactValue}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {entry.siteLabel}
            </div>
            <div className="mt-0.5 text-slate-700 dark:text-slate-200">
              {entry.contactName}
            </div>
            {href ? (
              <a
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noreferrer" : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  onAction?.();
                }}
                className="mt-1 block break-all rounded-md border border-blue-200 bg-white px-2 py-1.5 font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-950 dark:text-blue-300"
              >
                {entry.contactValue}
              </a>
            ) : (
              <div className="mt-1 break-all font-semibold">
                {entry.contactValue}
              </div>
            )}
            <div className="mt-0.5 text-muted-foreground">
              {entry.detail || entry.channelLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MergedContactReviewChip({
  records,
  compact = true,
  className = "",
}: {
  records: CommunicationData[] | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const entries = useMemo(
    () => buildMergedContactReviewEntries(records),
    [records],
  );
  const [open, setOpen] = useState(false);
  const [touchMode, setTouchMode] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 12, width: 360 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setTouchMode(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!open || !touchMode || typeof window === "undefined") return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      const width = Math.min(420, Math.max(280, window.innerWidth - 24));
      const left = Math.min(
        Math.max(12, (rect?.left ?? 12) - width / 2 + (rect?.width ?? 0) / 2),
        window.innerWidth - width - 12,
      );
      const estimatedHeight = Math.min(420, 95 + entries.length * 110);
      const spaceBelow = window.innerHeight - (rect?.bottom ?? 0) - 12;
      const top =
        spaceBelow >= estimatedHeight
          ? (rect?.bottom ?? 12) + 8
          : Math.max(
              12,
              (rect?.top ?? window.innerHeight) - estimatedHeight - 8,
            );
      setPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("orientationchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [entries.length, open, touchMode]);

  useEffect(() => {
    if (!open || !touchMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, touchMode]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  if (entries.length <= 1) return null;

  const openDesktop = () => {
    if (touchMode) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpen(true);
  };
  const closeDesktop = () => {
    if (touchMode) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 180);
  };

  const mobilePopover =
    open && touchMode && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Kontaktliste schließen"
              className="fixed inset-0 z-[9998] cursor-default bg-black/20"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              className="fixed z-[9999] max-h-[min(420px,calc(100vh-24px))] overflow-y-auto rounded-xl border border-emerald-300 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-800 shadow-2xl dark:bg-slate-950 dark:text-slate-100"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-bold text-emerald-800 dark:text-emerald-200">
                  Kontakte auswählen
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  aria-label="Schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ContactEntries
                entries={entries}
                onAction={() => setOpen(false)}
              />
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      onMouseEnter={openDesktop}
      onMouseLeave={closeDesktop}
      onFocusCapture={openDesktop}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          closeDesktop();
      }}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="Kontakte prüfen"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isTouchPointer()) {
            setTouchMode(true);
            setOpen((current) => !current);
          } else {
            setOpen(true);
          }
        }}
        className={
          compact
            ? "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 outline-none hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-300"
            : "inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 outline-none hover:bg-emerald-100 focus:ring-2 focus:ring-emerald-300"
        }
      >
        <AlertTriangle className="h-4 w-4" />
        {!compact && <span>Kontakte prüfen</span>}
      </button>

      {open && !touchMode && (
        <span
          className="absolute bottom-full left-0 z-[120] mb-2 block w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-emerald-300 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-800 shadow-2xl dark:bg-slate-950 dark:text-slate-100"
          onMouseEnter={openDesktop}
          onMouseLeave={closeDesktop}
        >
          <span className="mb-2 block font-bold text-emerald-800 dark:text-emerald-200">
            Kontakte prüfen
          </span>
          <ContactEntries entries={entries} />
        </span>
      )}
      {mobilePopover}
    </span>
  );
}
