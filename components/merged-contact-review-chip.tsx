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

function normalizeContactTextV17_90L175(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBrokenMergedSiteLabelV17_90L176(value: unknown): boolean {
  const key = normalizeContactTextV17_90L175(value);
  if (!key) return true;
  const labels = [
    "ausfuhrungsadresse",
    "ausfuhrungsort",
    "ausfuhrung",
    "arbeitsadresse",
    "arbeitsort",
    "einsatzort",
    "objekt",
    "baustelle",
    "work site",
    "job site",
  ];
  return labels.some(
    (label) => key === label || (key.length >= 3 && key.length < label.length && label.endsWith(key)),
  );
}

function mergedSectionSiteLabelV17_90L176(text: string): string {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const marker =
    /^(?:ausführung|ausfuehrung|ausführungsort|ausfuehrungsort|ausführungsadresse|ausfuehrungsadresse|arbeitsort|einsatzort|objekt|baustelle|work\s*site|job\s*site)\s*:?\s*(.*)$/i;
  const address = /\b(?:strasse|straße|weg|gasse|platz|allee|ring|rue|route|via|street|road)\b.*\d|\b\d{4,5}\b/i;
  const stop = /^(?:termin|leistung|leistungen|rechnung|kontakt|telefon|sms|whatsapp|e-?mail)\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(marker);
    if (!match) continue;
    const inline = String(match[1] || "").trim();
    if (inline && !isBrokenMergedSiteLabelV17_90L176(inline) && !address.test(inline))
      return inline;
    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate || stop.test(candidate)) break;
      if (address.test(candidate)) continue;
      if (!isBrokenMergedSiteLabelV17_90L176(candidate)) return candidate;
    }
  }
  return "";
}

function communicationRecordSiteLabelV17_90L175(
  record: any,
  index: number,
): string {
  return String(
    record?.workSites?.[0]?.siteName ||
      record?.siteName ||
      record?.executionSiteName ||
      record?.customer?.name ||
      `Arbeitsort ${index + 1}`,
  )
    .replace(/\s+/g, " ")
    .trim();
}

function communicationRecordTextV17_90L175(record: any): string {
  return [
    record?.notes,
    record?.specialNotes,
    record?.description,
    record?.audioTranscript,
    record?.customerMessage,
    record?.sourceText,
  ]
    .filter(Boolean)
    .join("\n");
}

type ExplicitMergedContactV17_90L175 = {
  siteLabel: string;
  contactName: string;
  contactValue: string;
  channelLabel: string;
  detail: string;
};

function explicitMergedContactsV17_90L175(
  records: CommunicationData[] | null | undefined,
): ExplicitMergedContactV17_90L175[] {
  const result: ExplicitMergedContactV17_90L175[] = [];
  (Array.isArray(records) ? records : []).forEach((record: any, recordIndex) => {
    const companyLabel = String(record?.customer?.name || "Firma / Rechnungsadresse")
      .replace(/\s+/g, " ")
      .trim();
    const companyPhone = String(record?.customer?.phone || "").trim();
    const companyEmail = String(record?.customer?.email || "").trim();
    if (companyPhone) {
      result.push({
        siteLabel: companyLabel,
        contactName: "Firmenkontakt",
        contactValue: companyPhone,
        channelLabel: "Telefon",
        detail: "Telefon der Rechnungsadresse",
      });
    }
    if (companyEmail) {
      result.push({
        siteLabel: companyLabel,
        contactName: "Firmenkontakt",
        contactValue: companyEmail,
        channelLabel: "E-Mail",
        detail: "E-Mail der Rechnungsadresse",
      });
    }
    const workSites = Array.isArray(record?.workSites) ? record.workSites : [];
    const fullText = communicationRecordTextV17_90L175(record)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const rawMergedText = String(record?.notes || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const sectionSource = /(?:Hauptauftrag:|Zusammengeführt mit:)/i.test(rawMergedText)
      ? rawMergedText
      : fullText;
    const mergedParts = sectionSource
      .split(/\n?\s*(?:[-─]{3,}\s*)?(?:Zusammengeführt mit:|Hauptauftrag:)\s*\n?/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const sections =
      workSites.length > 1 && mergedParts.length > 1
        ? mergedParts.map((text, index) => {
            const storedLabel = String(
              workSites[index]?.siteName || workSites[index]?.name || "",
            )
              .replace(/\s+/g, " ")
              .trim();
            const inferredLabel = mergedSectionSiteLabelV17_90L176(text);
            const addressLabel = [
              workSites[index]?.siteAddress,
              [workSites[index]?.sitePlz, workSites[index]?.siteCity]
                .filter(Boolean)
                .join(" "),
            ]
              .filter(Boolean)
              .join(" · ");
            return {
              text,
              siteLabel:
                storedLabel && !isBrokenMergedSiteLabelV17_90L176(storedLabel)
                  ? storedLabel
                  : inferredLabel || addressLabel || `Arbeitsort ${index + 1}`,
            };
          })
        : [
            {
              text: fullText,
              siteLabel: communicationRecordSiteLabelV17_90L175(
                record,
                recordIndex,
              ),
            },
          ];

    for (const section of sections) {
      const segments = section.text
        .split(/\n+|(?<=[.!?])\s+/g)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      for (const line of segments) {
        // A polluted dog/contact sentence must stay in the red dog chip and may
        // never become a selectable contact entry.
        if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(line)) continue;

        const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
        const phone = line.match(/\+?\d[\d\s()./-]{6,}\d/)?.[0]?.trim();
        if (!email && !phone) continue;

        const normalized = normalizeContactTextV17_90L175(line);
        const channel = /\bwhatsapp\b/.test(normalized)
          ? "WhatsApp"
          : /\bsms\b/.test(normalized)
            ? "SMS"
            : /\b(?:e mail|email|mail)\b/.test(normalized) || email
              ? "E-Mail"
              : /\b(?:anruf|anrufen|telefon|rueckruf|ruckruf|call)\b/.test(
                    normalized,
                  )
                ? "Telefon"
                : "";

        // Plain customer/master-data phone or e-mail lines are not worksite
        // contacts. A selectable merged contact needs an explicit operational
        // instruction such as SMS, WhatsApp, call-back or contact on site.
        if (!channel) continue;
        const hasOperationalContactSignal =
          /\b(?:vorher|nur\s+sms|sms\s+an|whatsapp|anrufen|anruf|rueckruf|rückruf|kontakt\s+vor\s+ort|vor\s+arbeitsbeginn|vor\s+ausfuehrung|vor\s+ausführung|erreichbar|melden)\b/i.test(
            line,
          );
        if (!hasOperationalContactSignal) continue;

        const value = email || phone || "";
        let contactName = channel;
        if (phone) {
          const before = line.slice(0, line.indexOf(phone));
          const nameMatch =
            before.match(
              /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’-]+){1,2})\s+(?:unter|an)\s*$/,
            ) ||
            before.match(
              /(?:kontakt(?:\s+vor\s+ort)?\s*:?|bei)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’-]+){0,2})\s*$/,
            );
          if (nameMatch?.[1]) contactName = nameMatch[1].trim();
        }

        result.push({
          siteLabel: section.siteLabel,
          contactName,
          contactValue: value,
          channelLabel: channel,
          detail: line,
        });
      }
    }
  });

  return result.filter(
    (entry, index, all) =>
      all.findIndex(
        (candidate) =>
          normalizeContactTextV17_90L175(candidate.siteLabel) ===
            normalizeContactTextV17_90L175(entry.siteLabel) &&
          normalizePhoneForAction(candidate.contactValue) ===
            normalizePhoneForAction(entry.contactValue) &&
          normalizeContactTextV17_90L175(candidate.channelLabel) ===
            normalizeContactTextV17_90L175(entry.channelLabel),
      ) === index,
  );
}

function sanitizeMergedContactReviewEntriesV17_90L175(
  records: CommunicationData[] | null | undefined,
  fallbackEntries: MergedContactReviewEntry[],
): MergedContactReviewEntry[] {
  const explicit = explicitMergedContactsV17_90L175(records);
  if (explicit.length > 0) {
    return explicit.map((entry, index) => {
      const template =
        fallbackEntries.find(
          (candidate) =>
            normalizeContactTextV17_90L175(candidate.siteLabel) ===
            normalizeContactTextV17_90L175(entry.siteLabel),
        ) || fallbackEntries[index] || ({} as MergedContactReviewEntry);
      return {
        ...template,
        siteLabel: entry.siteLabel,
        contactName: entry.contactName,
        contactValue: entry.contactValue,
        channelLabel: entry.channelLabel,
        detail: entry.detail,
        href: undefined,
      } as MergedContactReviewEntry;
    });
  }

  // Fail closed for old/partial data: remove dog rows and exact duplicate
  // fallback contacts rather than assigning a company master number to every
  // worksite.
  return fallbackEntries.filter((entry, index, all) => {
    const joined = `${entry.contactName || ""} ${entry.detail || ""}`;
    if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(joined)) return false;
    const siteKey = normalizeContactTextV17_90L175(entry.siteLabel);
    const valueKey = normalizePhoneForAction(entry.contactValue);
    const channelKey = normalizeContactTextV17_90L175(entry.channelLabel);
    return (
      all.findIndex(
        (candidate) =>
          normalizeContactTextV17_90L175(candidate.siteLabel) === siteKey &&
          normalizePhoneForAction(candidate.contactValue) === valueKey &&
          normalizeContactTextV17_90L175(candidate.channelLabel) === channelKey,
      ) === index
    );
  });
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
  const entries = useMemo(() => {
    const fallback = buildMergedContactReviewEntries(records);
    return sanitizeMergedContactReviewEntriesV17_90L175(records, fallback);
  }, [records]);
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
