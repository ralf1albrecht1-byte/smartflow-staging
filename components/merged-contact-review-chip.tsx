"use client";
// SMARTFLOW_V17_90L371X_CONTACT_CHIPS_DATE_SAFE

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

function isMergedContactDateLikeValueV17_90L371X(value?: string | null): boolean {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  if (/^\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?\.?$/.test(raw)) return true;
  if (/^\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}(?:[T\s].*)?$/.test(raw)) return true;
  const digits = raw.replace(/\D/g, "");
  const validDate = (day: number, month: number, year?: number) => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return false;
    if (year != null && (year < 2000 || year > 2099)) return false;
    return true;
  };
  if (/^\d{8}$/.test(digits)) {
    const dd = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const yyyy = Number(digits.slice(4, 8));
    const yFirst = Number(digits.slice(0, 4));
    const ym = Number(digits.slice(4, 6));
    const yd = Number(digits.slice(6, 8));
    if (validDate(dd, mm, yyyy) || validDate(yd, ym, yFirst)) return true;
  }
  if (/^\d{6}$/.test(digits)) {
    const dd = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    if (validDate(dd, mm)) return true;
  }
  return false;
}

function normalizePhoneForAction(value: string): string {
  const raw = String(value || "").trim();
  if (isMergedContactDateLikeValueV17_90L371X(raw)) return "";
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
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

function matchMergedContactWorkSiteV17_90L178(
  sectionText: string,
  workSites: any[],
  fallbackIndex: number,
): any | null {
  const sectionKey = normalizeContactTextV17_90L175(sectionText);
  const byIdentity = workSites.find((site) => {
    const nameKey = normalizeContactTextV17_90L175(site?.siteName);
    const addressKey = normalizeContactTextV17_90L175(site?.siteAddress);
    return Boolean(
      (nameKey && sectionKey.includes(nameKey)) ||
        (addressKey && sectionKey.includes(addressKey)),
    );
  });
  const byPlace = workSites.filter((site) => {
    const placeKey = normalizeContactTextV17_90L175(
      [site?.sitePlz, site?.siteCity].filter(Boolean).join(" "),
    );
    return Boolean(placeKey && sectionKey.includes(placeKey));
  });
  return (
    byIdentity ||
    (byPlace.length === 1 ? byPlace[0] : null) ||
    workSites[fallbackIndex] ||
    null
  );
}

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
    if (companyPhone && normalizePhoneForAction(companyPhone)) {
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
            const matchedSite = matchMergedContactWorkSiteV17_90L178(
              text,
              workSites,
              index,
            );
            const storedLabel = String(
              matchedSite?.siteName || matchedSite?.name || "",
            )
              .replace(/\s+/g, " ")
              .trim();
            const inferredLabel = mergedSectionSiteLabelV17_90L176(text);
            const addressLabel = [
              matchedSite?.siteAddress,
              [matchedSite?.sitePlz, matchedSite?.siteCity]
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
        const rawPhone = line.match(/\+?\d[\d\s()./-]{6,}\d/)?.[0]?.trim();
        const phone = rawPhone && normalizePhoneForAction(rawPhone) ? rawPhone : "";
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
    (entry, index, all) => {
      if (!String(entry.contactValue || "").includes("@") && !normalizePhoneForAction(entry.contactValue)) return false;
      return all.findIndex(
        (candidate) =>
          normalizeContactTextV17_90L175(candidate.siteLabel) ===
            normalizeContactTextV17_90L175(entry.siteLabel) &&
          normalizePhoneForAction(candidate.contactValue) ===
            normalizePhoneForAction(entry.contactValue) &&
          normalizeContactTextV17_90L175(candidate.channelLabel) ===
            normalizeContactTextV17_90L175(entry.channelLabel),
      ) === index;
    },
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
    if (!String(entry.contactValue || "").includes("@") && !normalizePhoneForAction(entry.contactValue)) return false;
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

type ContactEntryGroupV17_90L177 = {
  key: string;
  title: string;
  subtitle: string;
  entries: MergedContactReviewEntry[];
};

function mergedContactValueKeyV17_90L177(value: string): string {
  const raw = String(value || "").trim();
  if (raw.includes("@")) return normalizeContactTextV17_90L175(raw);
  return normalizePhoneForAction(raw);
}

function mergedContactChannelPriorityV17_90L178(value?: string | null): number {
  const key = normalizeContactTextV17_90L175(value);
  if (key.includes("whatsapp")) return 4;
  if (key.includes("sms")) return 3;
  if (key.includes("telefon") || key.includes("anruf")) return 2;
  if (key.includes("mail")) return 1;
  return 0;
}

function isGenericMergedContactNameV17_90L178(value?: string | null): boolean {
  const key = normalizeContactTextV17_90L175(value);
  return [
    "kontakt",
    "firmenkontakt",
    "telefon",
    "anruf",
    "sms",
    "whatsapp",
    "e mail",
    "email",
  ].includes(key);
}

function uniqueMergedContactDetailsV17_90L178(values: string[]): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const line = String(raw || "").replace(/\s+/g, " ").trim();
    const key = normalizeContactTextV17_90L175(line);
    if (!key) continue;
    const duplicate = result.some((existing) => {
      const existingKey = normalizeContactTextV17_90L175(existing);
      return (
        existingKey === key ||
        existingKey.includes(key) ||
        key.includes(existingKey)
      );
    });
    if (!duplicate) result.push(line);
  }
  return result;
}

function groupMergedContactEntriesV17_90L177(
  entries: MergedContactReviewEntry[],
): ContactEntryGroupV17_90L177[] {
  const groups = new Map<string, ContactEntryGroupV17_90L177>();

  entries.forEach((entry) => {
    const isBillingContact =
      normalizeContactTextV17_90L175(entry.contactName) === "firmenkontakt" ||
      /rechnungsadresse|rechnungskontakt/i.test(String(entry.detail || ""));
    const rawSite = String(entry.siteLabel || "").replace(/\s+/g, " ").trim();
    const key = isBillingContact
      ? "billing_contact"
      : `site_${normalizeContactTextV17_90L175(rawSite) || "unknown"}`;
    const title = isBillingContact
      ? "Rechnungskontakt"
      : `Arbeitsort: ${rawSite || "Nicht angegeben"}`;
    const subtitle = isBillingContact ? rawSite : "";
    const current = groups.get(key);
    if (current) current.entries.push(entry);
    else groups.set(key, { key, title, subtitle, entries: [entry] });
  });

  return Array.from(groups.values()).map((group) => {
    const byValue = new Map<string, MergedContactReviewEntry>();
    for (const entry of group.entries) {
      const valueKey = mergedContactValueKeyV17_90L177(entry.contactValue);
      const existing = byValue.get(valueKey);
      if (!existing) {
        byValue.set(valueKey, { ...entry });
        continue;
      }

      const existingPriority = mergedContactChannelPriorityV17_90L178(
        existing.channelLabel,
      );
      const incomingPriority = mergedContactChannelPriorityV17_90L178(
        entry.channelLabel,
      );
      let merged: MergedContactReviewEntry = { ...existing };
      if (incomingPriority > existingPriority) {
        merged = {
          ...merged,
          channelLabel: entry.channelLabel,
          href: entry.href,
        };
      }
      if (
        isGenericMergedContactNameV17_90L178(merged.contactName) &&
        !isGenericMergedContactNameV17_90L178(entry.contactName)
      ) {
        merged = { ...merged, contactName: entry.contactName };
      }
      merged = {
        ...merged,
        detail: uniqueMergedContactDetailsV17_90L178([
          String(merged.detail || ""),
          String(entry.detail || ""),
        ]).join("\n"),
      };
      byValue.set(valueKey, merged);
    }
    return { ...group, entries: Array.from(byValue.values()) };
  });
}

function escapeMergedContactRegExpV17_90L178(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanMergedContactDetailV17_90L178(
  entry: MergedContactReviewEntry,
): string[] {
  const rawLines = String(entry.detail || "")
    .split(/\n+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const value = String(entry.contactValue || "").trim();
  const valueDigits = normalizePhoneForAction(value).replace(/^\+/, "");
  const name = String(entry.contactName || "").trim();
  const titleKey = normalizeContactTextV17_90L175(name);
  const channelKey = normalizeContactTextV17_90L175(entry.channelLabel);

  const cleaned = rawLines.map((line) => {
    let next = line;
    if (value.includes("@")) {
      next = next.replace(
        new RegExp(escapeMergedContactRegExpV17_90L178(value), "ig"),
        " ",
      );
    } else if (valueDigits.length >= 7) {
      next = next.replace(/\+?\d[\d\s()./-]{6,}\d/g, (match) => {
        const digits = normalizePhoneForAction(match).replace(/^\+/, "");
        return digits === valueDigits ? " " : match;
      });
    }
    next = next
      .replace(/\b(?:unter|an)\s*(?=(?:anrufen|melden|kontaktieren|schreiben|senden|\.|,|$))/gi, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/[,;:–—-]+\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return next;
  });

  return uniqueMergedContactDetailsV17_90L178(cleaned).filter((line) => {
    const key = normalizeContactTextV17_90L175(line);
    return Boolean(key && key !== titleKey && key !== channelKey);
  });
}

function ContactEntries({
  groups,
  onAction,
}: {
  groups: ContactEntryGroupV17_90L177[];
  onAction?: () => void;
}) {
  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isBillingContact = group.key === "billing_contact";
        return (
          <section
            key={group.key}
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="border-b border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950">
              <div className="break-words font-bold text-slate-950 dark:text-slate-50">
                {group.title}
              </div>
              {!isBillingContact && group.subtitle && (
                <div className="mt-0.5 break-words text-[10px] text-slate-500 dark:text-slate-400">
                  {group.subtitle}
                </div>
              )}
            </div>

            {isBillingContact ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2">
                {group.entries.map((entry, index) => {
                  const href = actionHref(entry);
                  return (
                    <span
                      key={`${group.key}-${entry.contactValue}-${index}`}
                      className="inline-flex min-w-0 items-center gap-2"
                    >
                      {index > 0 && (
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                      )}
                      {href ? (
                        <a
                          href={href}
                          target={href.startsWith("http") ? "_blank" : undefined}
                          rel={href.startsWith("http") ? "noreferrer" : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAction?.();
                          }}
                          className="min-w-0 break-all font-semibold text-blue-700 hover:underline dark:text-blue-300"
                        >
                          {entry.contactValue}
                        </a>
                      ) : (
                        <span className="min-w-0 break-all font-semibold">
                          {entry.contactValue}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {group.entries.map((entry, index) => {
                  const href = actionHref(entry);
                  const entryTitle =
                    String(entry.contactName || "").trim() ||
                    String(entry.channelLabel || "Kontakt").trim();
                  const detailLines = cleanMergedContactDetailV17_90L178(entry);

                  return (
                    <div
                      key={`${group.key}-${entry.contactValue}-${index}`}
                      className="px-2.5 py-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                        <div className="min-w-0 font-semibold text-slate-800 dark:text-slate-100">
                          {entryTitle}
                        </div>
                        <div className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {entry.channelLabel}
                        </div>
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
                          className="mt-0.5 block break-all font-semibold text-blue-700 hover:underline dark:text-blue-300"
                        >
                          {entry.contactValue}
                        </a>
                      ) : (
                        <div className="mt-0.5 break-all font-semibold">
                          {entry.contactValue}
                        </div>
                      )}

                      {detailLines.length > 0 && (
                        <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                          {detailLines.map((detailLine, detailIndex) => (
                            <div
                              key={`${group.key}-${entry.contactValue}-detail-${detailIndex}`}
                              className="break-words"
                            >
                              {detailLine}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
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
  const groups = useMemo(
    () => groupMergedContactEntriesV17_90L177(entries),
    [entries],
  );
  const [open, setOpen] = useState(false);
  const [touchMode, setTouchMode] = useState(false);
  const [position, setPosition] = useState({
    top: 12,
    left: 12,
    width: 360,
    maxHeight: 420,
    placement: "above" as "above" | "below",
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
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
    if (!open || typeof window === "undefined") return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const margin = 12;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = touchMode
        ? Math.min(430, Math.max(280, viewportWidth - margin * 2))
        : Math.min(480, Math.max(320, viewportWidth - margin * 2));
      const left = Math.min(
        Math.max(margin, rect.left + rect.width / 2 - width / 2),
        viewportWidth - width - margin,
      );
      const estimatedHeight = Math.min(
        560,
        74 + groups.length * 58 + entries.length * 82,
      );
      const measuredHeight = popoverRef.current?.scrollHeight || estimatedHeight;
      const desiredHeight = Math.min(measuredHeight, viewportHeight - margin * 2);
      const spaceAbove = Math.max(0, rect.top - gap - margin);
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin);
      const placement: "above" | "below" =
        spaceAbove >= Math.min(desiredHeight, 260) || spaceAbove >= spaceBelow
          ? "above"
          : "below";
      const availableHeight = placement === "above" ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(150, Math.min(desiredHeight, availableHeight));
      const top =
        placement === "above"
          ? Math.max(margin, rect.top - gap - maxHeight)
          : Math.min(viewportHeight - margin - maxHeight, rect.bottom + gap);

      setPosition({ top, left, width, maxHeight, placement });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const observer =
      typeof ResizeObserver !== "undefined" && popoverRef.current
        ? new ResizeObserver(updatePosition)
        : null;
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("orientationchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [entries.length, groups.length, open, touchMode]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !buttonRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

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
    closeTimerRef.current = setTimeout(() => setOpen(false), 220);
  };

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <>
            {touchMode && (
              <button
                type="button"
                aria-label="Kontaktliste schließen"
                className="fixed inset-0 z-[9998] cursor-default bg-black/20"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                }}
              />
            )}
            <div
              ref={popoverRef}
              className="fixed z-[9999] overflow-y-auto overscroll-contain rounded-xl border border-emerald-300 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-800 shadow-2xl dark:bg-slate-950 dark:text-slate-100"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
              onMouseEnter={openDesktop}
              onMouseLeave={closeDesktop}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
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
                groups={groups}
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
      {popover}
    </span>
  );
}
