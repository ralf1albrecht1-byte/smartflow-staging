/**
 * Intelligente Auftragserfassung mit KI-gestütztem Kundenabgleich
 * Wird von Telegram- und WhatsApp-Webhooks verwendet.
 */
// SMARTFLOW_V17_90L371AQ_UNIT_CLEAN_EQUIPMENT_HOUR_GUARD
import { prisma } from "@/lib/prisma";
import { ensureAddressSplit } from "@/lib/address-parser";
import { logAuditAsync } from "@/lib/audit";
import {
  verifyCustomerMatch,
  type MatchVerdict,
} from "@/lib/customer-matching";
import { sanitizeNewCustomerFields } from "@/lib/intake-sanitize";
import {
  findExactDeterministicMatch,
  findNearExactDeterministicMatch,
} from "@/lib/exact-customer-match";
import { maskPhoneForLog } from "@/lib/phone";
import {
  buildSpecialNotes,
  splitSpecialNotes,
  classifySpecialNoteRoleV17_90L93,
} from "@/lib/special-notes-utils";
import { repairZeroQuantityHourItemsFromText } from "@/lib/order-hour-line-repair";
import { getActiveDataScope } from "@/lib/data-scope";
import {
  applyUnitlessQuantityPriceLineGuard,
  detectReadOnlyPriceContradictionsV17_90L234,
  extractExecutionAddressFromText,
  extractExplicitUnresolvedWorkRecognitionCandidatesV17_90L99,
  runReadOnlyIntakeRiskValidator,
  validateAndRepairParsedOrderItems,
} from "@/lib/order-intake-validation";
import { sealCanonicalIntakeV2, verifyCanonicalIntakeV2 } from "@/lib/intake-v2/server";
import { INTAKE_V2_SCHEMA_VERSION } from "@/lib/intake-v2/schema";
import { assembleCanonicalFactsV2 } from "@/lib/intake-v2/facts";
import { normalizePositionType } from "@/lib/position-types";

// SMARTFLOW_V17_90L361_POST_AI_FIREWALL_CUSTOMER_SERVICE_ADDRESS


// V17.90L74 — TEST-only diagnostic trace for intake language/service flow.
// No business rule is changed here. The trace only records how service names,
// own evidence, amounts and review states evolve through the existing pipeline.
type IntakeDiagnosticTraceItem = {
  index: number;
  serviceName: string;
  positionType?: string | null;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string;
  confidence: string;
  needsReview: boolean | null;
  reviewReason: string;
  sourceText: string;
};

function createIntakeDiagnosticTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function redactIntakeDiagnosticText(value: unknown, maxLength = 1800): string {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, "[PHONE]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// V17.90L194: Stable, non-secret fingerprint for line-local intake evidence.
// This is used for dedupe/audit only; it is not a cryptographic identifier.
function createCanonicalSourceFingerprintV17_90L194(value: unknown): string | null {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v194_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function summarizeIntakeDiagnosticItems(
  values: unknown,
): IntakeDiagnosticTraceItem[] {
  if (!Array.isArray(values)) return [];

  return values.slice(0, 30).map((rawItem: any, index) => {
    const quantityValue = Number(rawItem?.quantity ?? rawItem?.menge);
    const priceValue = Number(
      rawItem?.unitPrice ?? rawItem?.unit_price ?? rawItem?.price,
    );
    const totalValue = Number(rawItem?.totalPrice ?? rawItem?.total_price);
    const sourceText =
      rawItem?.sourceText ??
      rawItem?.source_text ??
      rawItem?.evidence ??
      rawItem?.raw ??
      rawItem?.description ??
      "";

    return {
      index: index + 1,
      positionType: normalizePositionType(rawItem?.positionType ?? rawItem?.position_type ?? rawItem?.type),
      serviceName: redactIntakeDiagnosticText(
        rawItem?.serviceName ??
          rawItem?.name ??
          rawItem?.service_name ??
          rawItem?.matched_service_name ??
          "",
        180,
      ),
      quantity: Number.isFinite(quantityValue) ? quantityValue : null,
      unit: redactIntakeDiagnosticText(
        rawItem?.unit ?? rawItem?.einheit ?? "",
        80,
      ),
      unitPrice: Number.isFinite(priceValue) ? priceValue : null,
      totalPrice: Number.isFinite(totalValue) ? totalValue : null,
      currency: redactIntakeDiagnosticText(
        rawItem?.detectedCurrency ?? rawItem?.currency ?? "",
        20,
      ),
      confidence: redactIntakeDiagnosticText(
        rawItem?.confidence ?? rawItem?.service_confidence ?? "",
        30,
      ),
      needsReview:
        typeof rawItem?.needsReview === "boolean"
          ? rawItem.needsReview
          : null,
      reviewReason: redactIntakeDiagnosticText(
        rawItem?.reviewReason ?? rawItem?.review_reason ?? "",
        220,
      ),
      sourceText: redactIntakeDiagnosticText(sourceText, 420),
    };
  });
}

function logIntakeDiagnosticTrace(
  enabled: boolean,
  traceId: string,
  stage: string,
  payload: Record<string, unknown>,
): void {
  if (!enabled) return;

  try {
    console.log(
      `[INTAKE_TRACE:${traceId}] ${stage} ${JSON.stringify(payload)}`,
    );
  } catch (error: any) {
    console.warn(
      `[INTAKE_TRACE:${traceId}] ${stage} serialization_failed`,
      error?.message || error,
    );
  }
}


type OpenAiUsageSummaryV17_90L337 = {
  promptTokens: number | null;
  cachedInputTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
};

function readOpenAiUsageNumberV17_90L337(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function estimateOpenAiCostUsdV17_90L337(
  model: string,
  usage: any,
): number | null {
  const promptTokens = readOpenAiUsageNumberV17_90L337(
    usage?.prompt_tokens,
  );
  const completionTokens = readOpenAiUsageNumberV17_90L337(
    usage?.completion_tokens,
  );
  if (promptTokens === null && completionTokens === null) return null;

  const cachedInputTokens =
    readOpenAiUsageNumberV17_90L337(
      usage?.prompt_tokens_details?.cached_tokens,
    ) || 0;
  const uncachedInputTokens = Math.max((promptTokens || 0) - cachedInputTokens, 0);
  const normalizedModel = String(model || "").toLowerCase();
  const rates =
    normalizedModel.includes("gpt-4.1-mini")
      ? { inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 }
      : normalizedModel.includes("gpt-4.1")
        ? { inputPerMillion: 2.0, cachedInputPerMillion: 0.5, outputPerMillion: 8.0 }
        : { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 };

  if (!rates.inputPerMillion && !rates.outputPerMillion) return null;

  return (
    (uncachedInputTokens * rates.inputPerMillion +
      cachedInputTokens * rates.cachedInputPerMillion +
      (completionTokens || 0) * rates.outputPerMillion) /
    1_000_000
  );
}

function summarizeOpenAiUsageV17_90L337(
  model: string,
  usage: any,
): OpenAiUsageSummaryV17_90L337 {
  return {
    promptTokens: readOpenAiUsageNumberV17_90L337(usage?.prompt_tokens),
    cachedInputTokens: readOpenAiUsageNumberV17_90L337(
      usage?.prompt_tokens_details?.cached_tokens,
    ),
    completionTokens: readOpenAiUsageNumberV17_90L337(
      usage?.completion_tokens,
    ),
    totalTokens: readOpenAiUsageNumberV17_90L337(usage?.total_tokens),
    estimatedUsd: estimateOpenAiCostUsdV17_90L337(model, usage),
  };
}

function logIntakePerfV17_90L337(
  enabled: boolean,
  traceId: string,
  stage: string,
  payload: Record<string, unknown>,
): void {
  if (!enabled) return;

  try {
    console.log(
      `[INTAKE_PERF:${traceId}] ${stage} ${JSON.stringify(payload)}`,
    );
  } catch (error: any) {
    console.warn(
      `[INTAKE_PERF:${traceId}] ${stage} serialization_failed`,
      error?.message || error,
    );
  }
}


type FinalAiStructuredRoleV17_90L215 =
  | "safety"
  | "access"
  | "parking"
  | "other"
  | "ordinary";

type ReadOnlySpecialNoteRoleFindingV17_90L106 = {
  text: string;
  currentRole: FinalAiStructuredRoleV17_90L215;
  expectedRole: FinalAiStructuredRoleV17_90L215;
  reason: string;
};

type ReadOnlySpecialNoteSuppressionV17_90L216 = {
  text: string;
  currentRole: FinalAiStructuredRoleV17_90L215;
  reason: string;
};

type ReadOnlySpecialNoteAdditionV17_90L216 = {
  text: string;
  expectedRole: FinalAiStructuredRoleV17_90L215;
  source: "original" | "translation";
  reason: string;
};

type FinalAiRoleReviewResultV17_90L216 = {
  findings: ReadOnlySpecialNoteRoleFindingV17_90L106[];
  suppressions: ReadOnlySpecialNoteSuppressionV17_90L216[];
  additions: ReadOnlySpecialNoteAdditionV17_90L216[];
};

const emptyFinalAiRoleReviewResultV17_90L216 = (): FinalAiRoleReviewResultV17_90L216 => ({
  findings: [],
  suppressions: [],
  additions: [],
});

type ReadOnlyWorkCoverageMissingFindingV17_90L251 = {
  semanticId: string;
  source: "original" | "translation";
  quote: string;
  relatedRoleText: string | null;
  reason: string;
};

const RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L252 =
  "intake_risk:recognition_review:";

type ReadOnlyWorkCoverageInvalidItemV17_90L251 = {
  itemIndex: number;
  reason: string;
};

type FinalAiWorkCoverageResultV17_90L251 = {
  missingWork: ReadOnlyWorkCoverageMissingFindingV17_90L251[];
  invalidItems: ReadOnlyWorkCoverageInvalidItemV17_90L251[];
};

const emptyFinalAiWorkCoverageResultV17_90L251 =
  (): FinalAiWorkCoverageResultV17_90L251 => ({
    missingWork: [],
    invalidItems: [],
  });

function compactExactSourceTextV17_90L251(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function deterministicReviewFindingIdV17_90L252(value: unknown): string {
  const normalized = compactExactSourceTextV17_90L251(value)
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `work_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function exactQuoteExistsInSourceV17_90L251(
  sourceText: unknown,
  quote: unknown,
): boolean {
  const source = compactExactSourceTextV17_90L251(sourceText);
  const candidate = compactExactSourceTextV17_90L251(quote);
  return Boolean(
    source &&
      candidate &&
      source.toLocaleLowerCase("de-CH").includes(
        candidate.toLocaleLowerCase("de-CH"),
      ),
  );
}

type WorkCoverageSentenceCandidateV17_90L266 = {
  id: string;
  source: "original" | "translation";
  text: string;
};

function splitWorkCoverageSentenceCandidatesV17_90L266(
  value: unknown,
  source: "original" | "translation",
): WorkCoverageSentenceCandidateV17_90L266[] {
  const prefix = source === "original" ? "O" : "T";
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 8 && line.length <= 700)
    .slice(0, 80)
    .map((text, index) => ({
      id: `${prefix}${index + 1}`,
      source,
      text,
    }));
}

function matchRoleEntryForSentenceV17_90L266(
  sentence: string,
  roleEntries: Array<{ role: string; text: string }>,
): { role: string; text: string } | null {
  const sentenceKey = compactExactSourceTextV17_90L251(sentence)
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!sentenceKey) return null;
  return (
    roleEntries.find((entry) => {
      const roleKey = compactExactSourceTextV17_90L251(entry.text)
        .toLocaleLowerCase("de-CH")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return Boolean(
        roleKey &&
          (roleKey === sentenceKey ||
            (roleKey.length >= 18 && sentenceKey.includes(roleKey)) ||
            (sentenceKey.length >= 18 && roleKey.includes(sentenceKey))),
      );
    }) || null
  );
}

async function runReadOnlyWorkCoverageCheckerV17_90L251(args: {
  originalText: string;
  translatedText?: string | null;
  customerName?: string | null;
  executionSiteName?: string | null;
  workItems: Array<{
    index: number;
    serviceName: string;
    sourceText: string;
    quantity: number | null;
    unit: string;
    unitPrice: number | null;
  }>;
  roleEntries: Array<{ role: string; text: string }>;
  structuredNonWorkEvidence?: Array<{ role: string; text: string }>;
}): Promise<FinalAiWorkCoverageResultV17_90L251> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return emptyFinalAiWorkCoverageResultV17_90L251();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Du bist der letzte sprachunabhängige KI-Prüfer vor dem unveränderbaren Canonical Lock einer Auftragserfassung.",
              "Arbeite rein semantisch. Verwende keine festen Wortlisten, keine sprachspezifischen Zuordnungen und keine firmenspezifischen Regeln.",
              "Prüfe zwei Dinge:",
              "1. Prüfe Original und Übersetzung Satz für Satz: Fehlt eine ausdrücklich erwähnte mögliche, zusätzliche, noch zu klärende oder verlangte Kundenarbeit, die in workItems nicht vertreten ist? Das Fehlen von Menge, Einheit, Preis oder genauer Tätigkeitsart ist gerade der Grund für einen roten Kontrollbefund und darf nicht zum Weglassen führen. Auch Formulierungen wie eine noch nicht entschiedene Arbeit in einem Raum müssen als missingWork gemeldet werden, sofern eindeutig gesagt wird, dass dort möglicherweise Arbeit ausgeführt werden soll. Aussagen, die ausdrücklich nicht zum Auftrag gehören oder nicht ausgeführt werden sollen, sind keine Arbeit.",
              "2. Ist ein serviceName keine sauber belegte Tätigkeit, weil Kundenname, Firmenname, Objektname, Adresse oder ein anderer fremder Entitätsteil angehängt wurde oder weil der Name semantisch nicht zur eigenen Quellzeile passt? Dann melde den betroffenen workItem-Index als invalidItem. Gib keinen reparierten Leistungsnamen zurück.",
              "Prüfe JEDEN workItem genau einmal und gib dafür zusätzlich itemAssessments zurück. Vergleiche serviceName strikt mit der eigenen sourceText-Zeile sowie mit customerName und executionSiteName.",
              "Wenn customerName oder executionSiteName ganz oder teilweise im serviceName auftaucht, aber in der eigenen sourceText-Zeile nicht als konkreter Arbeitsbereich genannt ist, ist das invalid_entity_contamination. Beispielprinzip: Steht in sourceText nur 'Boden reinigen, 38 Quadratmeter ...', darf ein separat angegebener Objektname nicht zu 'Boden [Objektname] reinigen' ergänzt werden.",
              "Ein tatsächlich in derselben sourceText-Zeile genannter lokaler Teilbereich darf im Leistungsnamen bleiben. Verwechsle einen line-lokalen Arbeitsbereich niemals mit einem separat angegebenen Kunden-, Firmen-, Gebäude-, Objekt- oder Adressnamen.",
              "Wenn serviceName zusätzliche fachliche Inhalte enthält, die die eigene sourceText-Zeile nicht belegt, ist das invalid_evidence_mismatch.",
              "WICHTIG: Du bist ausschließlich Prüfer. Deine Befunde dürfen niemals workItems verändern oder neue workItems erzeugen.",
              "Bewerte jeden roleEntries-Eintrag ausdrücklich darauf, ob er semantisch eine mögliche/verlangte Arbeit beschreibt. Die bereits von der ersten KI vergebenen Rollen sind verbindliche Evidenz: safety, access und parking sind Nicht-Leistungsrollen und dürfen niemals allein wegen eines Tätigkeitsverbs als missingWork gemeldet werden. Zugang beschaffen, Schlüssel/Badge organisieren, sich melden, parken oder Sicherheitsanweisungen befolgen sind organisatorische Bedingungen und keine Kundenleistung. Nur wenn derselbe Satz zusätzlich eindeutig eine eigenständige auszuführende Kundenarbeit verlangt, darf ein Befund entstehen. Wenn ja und kein workItem dieselbe Arbeit abdeckt, muss genau ein missingWork-Befund entstehen.",
              "Original und Übersetzung derselben Aussage sind nur zwei Belege derselben Arbeit. Gib pro zugrunde liegender Arbeit genau einen Befund zurück, bevorzuge dafür das Originalzitat und verwende für beide Sprachvarianten dieselbe semanticId.",
              "relatedRoleText muss, falls die Aussage bereits in roleEntries steht, exakt den vollständigen roleEntries.text-Wert enthalten. Sonst null.",
              "Gib zusätzlich roleAssessments zurück und bewerte jeden übergebenen roleEntries-Eintrag genau einmal. classification ist possible_work_missing, possible_work_covered, not_work oder uncertain. Eine mögliche Arbeit mit unklaren Details ist possible_work_missing, wenn kein workItem sie abdeckt. uncertain ist ebenfalls ein Kontrollbefund, niemals eine automatische Leistung.",
              "Vergleiche Bedeutung und line-lokale Evidenz. Mengen, Einheiten, Preise und Währungen dürfen nicht auf andere Positionen übertragen werden.",
              "missingWork.quote muss ein kurzes, exakt zusammenhängendes Zitat aus originalText oder translatedText sein. Nicht umformulieren, nicht übersetzen und nichts erfinden.",
              "semanticId ist eine kurze, sprachunabhängige Identität derselben Arbeit, z. B. work_1. Sie dient nur zur Gruppierung und darf keine fachlichen Werte enthalten.",
              "Melde nur Befunde mit confidence=high. classification=uncertain bedeutet: Du bist sicher, dass der Eintrag eine mögliche Arbeit beschreibt, aber seine fachlichen Details oder die Abdeckung sind unklar. Bei Unsicherheit darüber, ob überhaupt eine Arbeit gemeint ist, melde keinen Befund.",
              "Gib ausschließlich JSON zurück: {\"missingWork\":[{\"semanticId\":\"work_1\",\"source\":\"original|translation\",\"quote\":\"exaktes Zitat\",\"relatedRoleText\":\"exakter roleEntries.text-Wert oder null\",\"confidence\":\"high|medium|low\",\"reason\":\"kurz\"}],\"roleAssessments\":[{\"roleText\":\"exakter roleEntries.text-Wert\",\"classification\":\"possible_work_missing|possible_work_covered|not_work|uncertain\",\"semanticId\":\"work_1 oder leer\",\"source\":\"original|translation oder leer\",\"quote\":\"exaktes Zitat oder leer\",\"confidence\":\"high|medium|low\",\"reason\":\"kurz\"}],\"itemAssessments\":[{\"index\":1,\"classification\":\"valid|invalid_entity_contamination|invalid_evidence_mismatch|uncertain\",\"confidence\":\"high|medium|low\",\"reason\":\"kurz\"}],\"invalidItems\":[{\"index\":1,\"confidence\":\"high|medium|low\",\"reason\":\"kurz\"}]}",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              originalText: String(args.originalText || "").slice(0, 6500),
              translatedText: String(args.translatedText || "").slice(0, 6500),
              customerName: String(args.customerName || "").slice(0, 220),
              executionSiteName: String(args.executionSiteName || "").slice(0, 220),
              workItems: args.workItems.slice(0, 40),
              roleEntries: args.roleEntries.slice(0, 40),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[WorkCoverageCheckerV17_90L251] API error ${response.status}; first AI result kept`,
      );
      return emptyFinalAiWorkCoverageResultV17_90L251();
    }

    const payload = await response.json();
    const rawContent = String(
      payload?.choices?.[0]?.message?.content || "",
    ).trim();
    let parsed = rawContent ? JSON.parse(rawContent) : null;

    // V17.90L265: A narrow second pass of the same read-only checker runs only
    // when the broad coverage pass reported no missing work. It scans every
    // sentence for explicitly possible customer work whose exact task is still
    // undecided. This does not touch the first AI or canonical workItems and it
    // cannot create a service row; it may only contribute an exact-quote red
    // control finding. No service vocabulary or language-specific word list is
    // used.
    const broadMissingCount =
      (Array.isArray(parsed?.missingWork) ? parsed.missingWork.length : 0) +
      (Array.isArray(parsed?.roleAssessments)
        ? parsed.roleAssessments.filter((entry: any) => {
            if (
              !["possible_work_missing", "uncertain"].includes(
                String(entry?.classification || "").toLowerCase(),
              )
            ) {
              return false;
            }
            const roleText = compactExactSourceTextV17_90L251(
              entry?.roleText,
            );
            const matchedRole = args.roleEntries.find(
              (candidate) =>
                compactExactSourceTextV17_90L251(candidate.text) === roleText,
            );
            return !["safety", "access", "parking"].includes(
              String(matchedRole?.role || "").toLowerCase(),
            );
          }).length
        : 0);
    if (broadMissingCount === 0) {
      try {
        const retryResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              temperature: 0,
              max_tokens: 700,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: [
                    "Du bist der enge zweite Durchgang eines rein lesenden Auftragsprüfers.",
                    "Die erste KI und workItems sind unveränderbar. Du darfst ausschließlich fehlende rote Kontrollbefunde melden.",
                    "Prüfe Original und Übersetzung Satz für Satz auf ausdrücklich erwähnte mögliche oder zusätzliche Kundenarbeit, deren genaue Tätigkeit noch offen, unentschieden oder nicht bekannt ist und die von keinem workItem abgedeckt wird.",
                    "Eine solche Aussage muss auch ohne Menge, Einheit oder Preis gemeldet werden. Die Unklarheit ist der Prüfgrund, nicht ein Ausschlussgrund.",
                    "Nicht melden: Verbote oder negative Anweisungen, Termin, Kommunikation, Zugang/Schlüssel, Parkplatz, Sicherheit sowie rein organisatorische Bedingungen. Die übergebenen roleEntries mit safety, access oder parking sind verbindlich keine Leistung.",
                    "Melde nur, wenn du mit hoher Sicherheit erkennst, dass an einem Ort möglicherweise eine auszuführende Kundenarbeit gemeint ist. Erfinde niemals die konkrete Tätigkeit.",
                    "quote muss ein kurzes exakt zusammenhängendes Zitat aus originalText oder translatedText sein. Bevorzuge das Original. Pro zugrunde liegender Aussage genau ein Befund.",
                    "Gib ausschließlich JSON zurück: {\"missingWork\":[{\"semanticId\":\"work_1\",\"source\":\"original|translation\",\"quote\":\"exaktes Zitat\",\"relatedRoleText\":null,\"confidence\":\"high\",\"reason\":\"mögliche Arbeit fachlich noch unklar\"}]}",
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    originalText: String(args.originalText || "").slice(0, 6500),
                    translatedText: String(args.translatedText || "").slice(0, 6500),
                    workItems: args.workItems.slice(0, 40),
                    roleEntries: args.roleEntries.slice(0, 40),
                  }),
                },
              ],
            }),
          },
        );
        if (retryResponse.ok) {
          const retryPayload = await retryResponse.json();
          const retryContent = String(
            retryPayload?.choices?.[0]?.message?.content || "",
          ).trim();
          const retryParsed = retryContent ? JSON.parse(retryContent) : null;
          if (Array.isArray(retryParsed?.missingWork)) {
            parsed = {
              ...(parsed || {}),
              missingWork: [
                ...(Array.isArray(parsed?.missingWork) ? parsed.missingWork : []),
                ...retryParsed.missingWork.slice(0, 6),
              ],
            };
          }
        }
      } catch (retryError: any) {
        console.warn(
          "[WorkCoverageCheckerV17_90L265] narrow retry failed; broad result kept",
          retryError?.message || retryError,
        );
      }
    }

    // V17.90L266: If both previous read-only passes still found no missing
    // work, run one final sentence-accountability audit inside the same second
    // checker. Every sentence must be classified. This prevents mixed-language
    // or deliberately vague work statements from being silently skipped while
    // remaining conservative: only high-confidence possible work creates a red
    // finding, never a service row.
    const missingAfterRetryCountV17_90L266 = Array.isArray(parsed?.missingWork)
      ? parsed.missingWork.length
      : 0;
    if (missingAfterRetryCountV17_90L266 === 0) {
      const sentenceCandidatesV17_90L266 = [
        ...splitWorkCoverageSentenceCandidatesV17_90L266(
          args.originalText,
          "original",
        ),
        ...splitWorkCoverageSentenceCandidatesV17_90L266(
          args.translatedText,
          "translation",
        ),
      ];
      if (sentenceCandidatesV17_90L266.length > 0) {
        try {
          const sentenceAuditResponse = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "gpt-4.1-mini",
                temperature: 0,
                max_tokens: 1200,
                response_format: { type: "json_object" },
                messages: [
                  {
                    role: "system",
                    content: [
                      "Du bist der verpflichtende Satz-für-Satz-Schlussaudit des zweiten, rein lesenden Auftragsprüfers.",
                      "Die erste KI, workItems und alle kanonischen Werte sind unveränderbar. Du darfst nur rote Kontrollbefunde melden.",
                      "Bewerte JEDEN übergebenen Satz genau einmal.",
                      "possible_work_missing bedeutet: Der Satz sagt ausdrücklich, dass an einem Ort möglicherweise, zusätzlich oder noch ungeklärt eine Kundenarbeit ausgeführt werden soll, aber kein workItem deckt diese Arbeit ab.",
                      "possible_work_covered bedeutet: Die Arbeit ist bereits durch ein workItem abgedeckt.",
                      "not_work bedeutet insbesondere: Verbot/Nicht-Ausführen, Termin, Kommunikation, Zugang/Schlüssel, Parkplatz, Sicherheit oder rein organisatorische Bedingung.",
                      "uncertain nur verwenden, wenn unklar ist, ob überhaupt eine Arbeit gemeint ist. uncertain erzeugt keinen Befund.",
                      "Fehlende Tätigkeit, Menge, Einheit oder Preis sind kein Ausschlussgrund, wenn der Satz eindeutig mögliche Arbeit ankündigt.",
                      "Original und Übersetzung derselben Aussage erhalten dieselbe semanticId. Erfinde keine Tätigkeit und gib keinen Reparaturvorschlag aus.",
                      `Gib ausschließlich JSON zurück: {"sentenceAssessments":[{"id":"O1","classification":"possible_work_missing|possible_work_covered|not_work|uncertain","semanticId":"work_1 oder leer","confidence":"high|medium|low","reason":"kurz"}]}.`,
                    ].join("\n"),
                  },
                  {
                    role: "user",
                    content: JSON.stringify({
                      sentences: sentenceCandidatesV17_90L266,
                      workItems: args.workItems.slice(0, 40),
                      roleEntries: args.roleEntries.slice(0, 40),
                    }),
                  },
                ],
              }),
            },
          );
          if (sentenceAuditResponse.ok) {
            const sentenceAuditPayload = await sentenceAuditResponse.json();
            const sentenceAuditContent = String(
              sentenceAuditPayload?.choices?.[0]?.message?.content || "",
            ).trim();
            const sentenceAuditParsed = sentenceAuditContent
              ? JSON.parse(sentenceAuditContent)
              : null;
            const candidateById = new Map(
              sentenceCandidatesV17_90L266.map((entry) => [entry.id, entry]),
            );
            const strictFindings = (
              Array.isArray(sentenceAuditParsed?.sentenceAssessments)
                ? sentenceAuditParsed.sentenceAssessments
                : []
            )
              .map((assessment: any) => {
                if (
                  String(assessment?.classification || "").toLowerCase() !==
                    "possible_work_missing" ||
                  String(assessment?.confidence || "").toLowerCase() !== "high"
                ) {
                  return null;
                }
                const candidate = candidateById.get(String(assessment?.id || ""));
                if (!candidate) return null;
                const matchedRole = matchRoleEntryForSentenceV17_90L266(
                  candidate.text,
                  args.roleEntries,
                );
                if (
                  ["safety", "access", "parking"].includes(
                    String(matchedRole?.role || "").toLowerCase(),
                  )
                ) {
                  return null;
                }
                return {
                  semanticId:
                    compactExactSourceTextV17_90L251(assessment?.semanticId)
                      .replace(/[^a-zA-Z0-9_-]+/g, "_")
                      .slice(0, 120) ||
                    deterministicReviewFindingIdV17_90L252(candidate.text),
                  source: candidate.source,
                  quote: candidate.text,
                  relatedRoleText: matchedRole?.text || null,
                  confidence: "high",
                  reason:
                    compactExactSourceTextV17_90L251(assessment?.reason).slice(
                      0,
                      240,
                    ) || "mögliche Arbeit fachlich noch unklar",
                };
              })
              .filter(Boolean);
            if (strictFindings.length > 0) {
              parsed = {
                ...(parsed || {}),
                missingWork: [
                  ...(Array.isArray(parsed?.missingWork)
                    ? parsed.missingWork
                    : []),
                  ...strictFindings,
                ],
              };
            }
          }
        } catch (sentenceAuditError: any) {
          console.warn(
            "[WorkCoverageCheckerV17_90L266] sentence audit failed; previous result kept",
            sentenceAuditError?.message || sentenceAuditError,
          );
        }
      }
    }

    // V17.90L266: For translated/dialect input, run a separate conservative
    // item-evidence audit when the broad checker found no invalid item. The
    // original line-local sourceText is authoritative; a faulty translation
    // must not legitimize a different object or activity. The audit may only
    // flag the existing row and never rename it.
    const broadInvalidCountV17_90L266 =
      (Array.isArray(parsed?.invalidItems) ? parsed.invalidItems.length : 0) +
      (Array.isArray(parsed?.itemAssessments)
        ? parsed.itemAssessments.filter((entry: any) =>
            ["invalid_entity_contamination", "invalid_evidence_mismatch"].includes(
              String(entry?.classification || "").toLowerCase(),
            ),
          ).length
        : 0);
    if (
      broadInvalidCountV17_90L266 === 0 &&
      compactExactSourceTextV17_90L251(args.translatedText) &&
      args.workItems.length > 0
    ) {
      try {
        const itemAuditResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4.1-mini",
              temperature: 0,
              max_tokens: 1000,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: [
                    "Du bist der line-lokale Schlussaudit des zweiten, rein lesenden Auftragsprüfers.",
                    "Bewerte JEDEN workItem genau einmal gegen seine eigene sourceText-Zeile.",
                    "Die originale sourceText-Zeile ist die höchste Evidenz. Eine automatische Übersetzung kann falsch sein und darf einen Bedeutungswiderspruch nicht überdecken.",
                    "invalid_evidence_mismatch nur bei hoher Sicherheit: serviceName bezeichnet ein anderes Arbeitsobjekt oder eine andere Tätigkeit als sourceText.",
                    "Normale Übersetzung, Flexion, Singular/Plural, Wortstellung und gleichbedeutende Formulierungen sind valid.",
                    "Wenn die Bedeutung des Dialekts oder der Fremdsprache nicht sicher ist, classification=uncertain statt invalid.",
                    "Du darfst keinen neuen Namen vorschlagen, nichts korrigieren und keine Werte verändern.",
                    `Gib ausschließlich JSON zurück: {"itemAssessments":[{"index":1,"classification":"valid|invalid_evidence_mismatch|uncertain","confidence":"high|medium|low","reason":"kurz"}]}.`,
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    originalText: String(args.originalText || "").slice(0, 6500),
                    translatedText: String(args.translatedText || "").slice(
                      0,
                      6500,
                    ),
                    workItems: args.workItems.slice(0, 40),
                  }),
                },
              ],
            }),
          },
        );
        if (itemAuditResponse.ok) {
          const itemAuditPayload = await itemAuditResponse.json();
          const itemAuditContent = String(
            itemAuditPayload?.choices?.[0]?.message?.content || "",
          ).trim();
          const itemAuditParsed = itemAuditContent
            ? JSON.parse(itemAuditContent)
            : null;
          if (Array.isArray(itemAuditParsed?.itemAssessments)) {
            parsed = {
              ...(parsed || {}),
              itemAssessments: [
                ...(Array.isArray(parsed?.itemAssessments)
                  ? parsed.itemAssessments
                  : []),
                ...itemAuditParsed.itemAssessments.slice(
                  0,
                  args.workItems.length + 4,
                ),
              ],
            };
          }
        }
      } catch (itemAuditError: any) {
        console.warn(
          "[WorkCoverageCheckerV17_90L266] item evidence audit failed; broad result kept",
          itemAuditError?.message || itemAuditError,
        );
      }
    }

    // V17.90L268: Balanced two-stage missing-work review.
    // Earlier reviewers are intentionally used only as broad candidate finders.
    // Every candidate, including findings from L251/L265/L266/L267-style passes,
    // must now pass deterministic structured-role exclusion and an independent
    // high-precision confirmer before it can become a red review finding.
    // The first AI, translation, canonical workItems and all business values stay
    // immutable. No service vocabulary or customer-specific rule is used.
    const normalizeCoverageEvidenceV17_90L268 = (value: unknown): string =>
      compactExactSourceTextV17_90L251(value)
        .toLocaleLowerCase("de-CH")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const coverageTokensV17_90L268 = (value: unknown): string[] =>
      normalizeCoverageEvidenceV17_90L268(value)
        .split(/\s+/g)
        .filter((token) => token.length >= 2);

    const stronglyCoveredByStructuredEvidenceV17_90L268 = (
      candidateText: string,
      evidenceText: string,
    ): boolean => {
      const candidateKey = normalizeCoverageEvidenceV17_90L268(candidateText);
      const evidenceKey = normalizeCoverageEvidenceV17_90L268(evidenceText);
      if (!candidateKey || !evidenceKey) return false;
      if (candidateKey === evidenceKey) return true;

      if (
        candidateKey.includes(evidenceKey) &&
        evidenceKey.length / Math.max(candidateKey.length, 1) >= 0.62
      ) {
        return true;
      }
      if (
        evidenceKey.includes(candidateKey) &&
        candidateKey.length / Math.max(evidenceKey.length, 1) >= 0.48
      ) {
        return true;
      }

      const candidateTokens = coverageTokensV17_90L268(candidateText);
      const evidenceTokens = coverageTokensV17_90L268(evidenceText);
      if (candidateTokens.length < 3 || evidenceTokens.length < 3) return false;
      const candidateSet = new Set(candidateTokens);
      const evidenceSet = new Set(evidenceTokens);
      const candidateCovered = candidateTokens.filter((token) =>
        evidenceSet.has(token),
      ).length;
      const evidenceCovered = evidenceTokens.filter((token) =>
        candidateSet.has(token),
      ).length;
      return (
        candidateCovered / candidateTokens.length >= 0.86 ||
        evidenceCovered / evidenceTokens.length >= 0.86
      );
    };

    const structuredNonWorkEvidenceV17_90L268 = [
      ...(Array.isArray(args.structuredNonWorkEvidence)
        ? args.structuredNonWorkEvidence
        : []),
      ...args.roleEntries
        .filter((entry) =>
          ["safety", "access", "parking"].includes(
            String(entry.role || "").toLowerCase(),
          ),
        )
        .map((entry) => ({ role: entry.role, text: entry.text })),
    ]
      .map((entry) => ({
        role: compactExactSourceTextV17_90L251(entry?.role).toLowerCase(),
        text: compactExactSourceTextV17_90L251(entry?.text),
      }))
      .filter((entry) => entry.role && entry.text.length >= 4)
      .slice(0, 80);

    type MissingWorkCandidateV17_90L268 = {
      candidateId: string;
      source: "original" | "translation";
      quote: string;
      reason: string;
      origins: string[];
    };

    const missingCandidateMapV17_90L268 = new Map<
      string,
      MissingWorkCandidateV17_90L268
    >();
    const addMissingCandidateV17_90L268 = (raw: any, origin: string): void => {
      const source = String(raw?.source || "").toLowerCase() as
        | "original"
        | "translation"
        | "";
      const quote = compactExactSourceTextV17_90L251(raw?.quote).slice(0, 620);
      if (!(["original", "translation"] as string[]).includes(source)) return;
      if (quote.length < 8) return;
      const sourceText =
        source === "translation" ? args.translatedText : args.originalText;
      if (!exactQuoteExistsInSourceV17_90L251(sourceText, quote)) return;
      const key = `${source}|${normalizeCoverageEvidenceV17_90L268(quote)}`;
      if (!key) return;
      const existing = missingCandidateMapV17_90L268.get(key);
      if (existing) {
        if (!existing.origins.includes(origin)) existing.origins.push(origin);
        return;
      }
      missingCandidateMapV17_90L268.set(key, {
        candidateId: deterministicReviewFindingIdV17_90L252(
          `${source}|${quote}`,
        ),
        source: source as "original" | "translation",
        quote,
        reason:
          compactExactSourceTextV17_90L251(raw?.reason).slice(0, 240) ||
          "mögliche Arbeit fachlich noch unklar",
        origins: [origin],
      });
    };

    for (const finding of Array.isArray(parsed?.missingWork)
      ? parsed.missingWork.slice(0, 20)
      : []) {
      addMissingCandidateV17_90L268(finding, "previous_missing_work");
    }
    for (const assessment of Array.isArray(parsed?.roleAssessments)
      ? parsed.roleAssessments.slice(0, args.roleEntries.length + 12)
      : []) {
      const classification = String(
        assessment?.classification || "",
      ).toLowerCase();
      const confidence = String(assessment?.confidence || "").toLowerCase();
      if (
        ["possible_work_missing", "uncertain"].includes(classification) &&
        ["high", "medium"].includes(confidence)
      ) {
        addMissingCandidateV17_90L268(assessment, "previous_role_assessment");
      }
    }

    // High-recall discovery: it may nominate candidates, but it cannot create a
    // finding. The independent confirmation below is mandatory.
    try {
      const discoveryResponseV17_90L268 = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4.1",
            temperature: 0,
            max_tokens: 1800,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: [
                  "Du bist ausschließlich der breit suchende Kandidatenfinder eines read-only Auftragsprüfers.",
                  "Die erste KI und workItems sind unveränderbar. Du darfst keine Leistung erzeugen, korrigieren oder umbenennen.",
                  "Zerlege Original und Übersetzung intern in atomare Aussagen, auch bei Einzeilern, Dialekt und Mischsprache.",
                  "Nominiere jede Aussage, die möglicherweise eine zusätzliche, verlangte oder noch unklare Kundenarbeit beschreibt und nicht offensichtlich durch ein workItem abgedeckt ist.",
                  "Die genaue Tätigkeit, Menge, Einheit oder der Preis dürfen unbekannt sein; das ist kein Ausschlussgrund.",
                  "Nominiere keine ausdrückliche Nicht-Arbeit, kein Verbot, keinen Termin, keine Kommunikation, keinen Zugang/Schlüssel, keinen Parkplatz, keine Sicherheit und keine reine Kunden-/Adress-/Objektangabe.",
                  "Sei bei der Suche eher vollständig als streng. Ein separater Prüfer bestätigt später. Erfinde niemals eine Tätigkeit.",
                  "quote muss ein kurzes, exakt zusammenhängendes Zitat aus Original oder Übersetzung sein. Bevorzuge Original.",
                  'Gib ausschließlich JSON zurück: {"candidates":[{"candidateId":"c1","source":"original|translation","quote":"exaktes Zitat","confidence":"high|medium|low","reason":"kurz"}]}.',
                ].join("\n"),
              },
              {
                role: "user",
                content: JSON.stringify({
                  originalText: String(args.originalText || "").slice(0, 8500),
                  translatedText: String(args.translatedText || "").slice(
                    0,
                    8500,
                  ),
                  workItems: args.workItems.slice(0, 40),
                  structuredNonWorkEvidence:
                    structuredNonWorkEvidenceV17_90L268,
                }),
              },
            ],
          }),
        },
      );
      if (discoveryResponseV17_90L268.ok) {
        const discoveryPayloadV17_90L268 =
          await discoveryResponseV17_90L268.json();
        const discoveryContentV17_90L268 = String(
          discoveryPayloadV17_90L268?.choices?.[0]?.message?.content || "",
        ).trim();
        const discoveryParsedV17_90L268 = discoveryContentV17_90L268
          ? JSON.parse(discoveryContentV17_90L268)
          : null;
        for (const candidate of Array.isArray(
          discoveryParsedV17_90L268?.candidates,
        )
          ? discoveryParsedV17_90L268.candidates.slice(0, 20)
          : []) {
          const confidence = String(candidate?.confidence || "").toLowerCase();
          if (!["high", "medium"].includes(confidence)) continue;
          addMissingCandidateV17_90L268(candidate, "broad_discovery");
        }
      } else {
        console.warn(
          `[WorkCoverageCheckerV17_90L268] discovery API error ${discoveryResponseV17_90L268.status}`,
        );
      }
    } catch (discoveryErrorV17_90L268: any) {
      console.warn(
        "[WorkCoverageCheckerV17_90L268] discovery failed",
        discoveryErrorV17_90L268?.message || discoveryErrorV17_90L268,
      );
    }

    const prefilteredCandidatesV17_90L268 = [
      ...missingCandidateMapV17_90L268.values(),
    ].filter((candidate) => {
      const coveredByCanonicalItem = args.workItems.some((item) =>
        stronglyCoveredByStructuredEvidenceV17_90L268(
          candidate.quote,
          item.sourceText,
        ),
      );
      if (coveredByCanonicalItem) return false;

      const coveredByStructuredNonWork =
        structuredNonWorkEvidenceV17_90L268.some((entry) =>
          stronglyCoveredByStructuredEvidenceV17_90L268(
            candidate.quote,
            entry.text,
          ),
        );
      return !coveredByStructuredNonWork;
    });

    let confirmedMissingWorkV17_90L268: any[] = [];
    if (prefilteredCandidatesV17_90L268.length > 0) {
      try {
        const confirmResponseV17_90L268 = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4.1",
              temperature: 0,
              max_tokens: 1800,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: [
                    "Du bist der unabhängige, hochpräzise Bestätiger eines read-only Auftragsprüfers.",
                    "Bewerte jeden Kandidaten genau einmal. Ein roter Befund ist nur bei classification=confirmed_missing_work und confidence=high erlaubt.",
                    "confirmed_missing_work: Das exakte Zitat sagt eindeutig, dass eine zusätzliche oder mögliche Kundenarbeit ausgeführt werden soll, und kein workItem deckt sie ab. Die konkrete Tätigkeit darf noch unbekannt sein.",
                    "covered: Ein workItem deckt dieselbe Arbeit bereits ab.",
                    "non_work: Kunden-/Adress-/Objektangabe, Termin, Kommunikation, Zugang/Schlüssel, Parkplatz, Sicherheit, organisatorische Bedingung, ausdrückliche Nicht-Arbeit oder Verbot.",
                    "abstain: Es ist nicht sicher, ob überhaupt eine Arbeit gemeint ist.",
                    "Die structuredNonWorkEvidence stammt aus bereits kanonisch erkannten Nicht-Leistungsrollen und ist verbindliche Gegen-Evidenz. Ein Satz darf nur dann trotzdem bestätigt werden, wenn das Zitat zusätzlich eindeutig eine eigenständige Kundenarbeit enthält.",
                    "Arbeite sprachunabhängig, ohne Service-Wortlisten und ohne Reparaturvorschläge. Erfinde keine Tätigkeit.",
                    'Gib ausschließlich JSON zurück: {"decisions":[{"candidateId":"c1","classification":"confirmed_missing_work|covered|non_work|abstain","confidence":"high|medium|low","reason":"kurz"}]}.',
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    candidates: prefilteredCandidatesV17_90L268,
                    workItems: args.workItems.slice(0, 40),
                    customerName: String(args.customerName || "").slice(0, 220),
                    executionSiteName: String(args.executionSiteName || "").slice(
                      0,
                      220,
                    ),
                    structuredNonWorkEvidence:
                      structuredNonWorkEvidenceV17_90L268,
                  }),
                },
              ],
            }),
          },
        );
        if (confirmResponseV17_90L268.ok) {
          const confirmPayloadV17_90L268 =
            await confirmResponseV17_90L268.json();
          const confirmContentV17_90L268 = String(
            confirmPayloadV17_90L268?.choices?.[0]?.message?.content || "",
          ).trim();
          const confirmParsedV17_90L268 = confirmContentV17_90L268
            ? JSON.parse(confirmContentV17_90L268)
            : null;
          const decisionByIdV17_90L268 = new Map<string, any>(
            (Array.isArray(confirmParsedV17_90L268?.decisions)
              ? confirmParsedV17_90L268.decisions
              : []
            ).map((decision: any) => [
              compactExactSourceTextV17_90L251(decision?.candidateId),
              decision,
            ]),
          );
          confirmedMissingWorkV17_90L268 =
            prefilteredCandidatesV17_90L268.flatMap((candidate) => {
              const decision = decisionByIdV17_90L268.get(
                candidate.candidateId,
              );
              if (
                String(decision?.classification || "").toLowerCase() !==
                  "confirmed_missing_work" ||
                String(decision?.confidence || "").toLowerCase() !== "high"
              ) {
                return [];
              }
              return [
                {
                  semanticId: deterministicReviewFindingIdV17_90L252(
                    candidate.quote,
                  ),
                  source: candidate.source,
                  quote: candidate.quote,
                  relatedRoleText: null,
                  confidence: "high",
                  reason:
                    compactExactSourceTextV17_90L251(
                      decision?.reason || candidate.reason,
                    ).slice(0, 240) ||
                    "mögliche Arbeit fachlich noch unklar",
                },
              ];
            });
        } else {
          console.warn(
            `[WorkCoverageCheckerV17_90L268] confirmation API error ${confirmResponseV17_90L268.status}; no unconfirmed missing-work finding kept`,
          );
        }
      } catch (confirmErrorV17_90L268: any) {
        console.warn(
          "[WorkCoverageCheckerV17_90L268] confirmation failed; no unconfirmed missing-work finding kept",
          confirmErrorV17_90L268?.message || confirmErrorV17_90L268,
        );
      }
    }

    parsed = {
      ...(parsed || {}),
      missingWork: confirmedMissingWorkV17_90L268,
      // All candidate-like role assessments were already included in the
      // two-stage confirmation. Clearing them prevents a rejected candidate
      // from being re-added below without confirmation.
      roleAssessments: [],
    };

    console.log(
      `[WorkCoverageCheckerV17_90L268] candidates=${missingCandidateMapV17_90L268.size} prefiltered=${prefilteredCandidatesV17_90L268.length} confirmed=${confirmedMissingWorkV17_90L268.length}`,
    );

    // V17.90L268: Item-evidence mismatches remain a separate read-only audit.
    // This avoids coupling missing-work recall with service-name contradiction
    // detection. The original sourceText is authoritative; no correction is
    // returned or applied.
    const existingInvalidCountV17_90L268 =
      (Array.isArray(parsed?.invalidItems) ? parsed.invalidItems.length : 0) +
      (Array.isArray(parsed?.itemAssessments)
        ? parsed.itemAssessments.filter((entry: any) =>
            ["invalid_entity_contamination", "invalid_evidence_mismatch"].includes(
              String(entry?.classification || "").toLowerCase(),
            ),
          ).length
        : 0);
    if (
      existingInvalidCountV17_90L268 === 0 &&
      Boolean(compactExactSourceTextV17_90L251(args.translatedText)) &&
      args.workItems.length > 0
    ) {
      try {
        const itemAuditResponseV17_90L268 = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4.1",
              temperature: 0,
              max_tokens: 1300,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: [
                    "Du bist ausschließlich der unabhängige line-lokale Belegprüfer vorhandener workItems.",
                    "Prüfe jeden serviceName gegen seine eigene ORIGINAL-sourceText-Zeile. Vertraue der Übersetzung nicht blind.",
                    "invalid_evidence_mismatch nur bei hoher Sicherheit, wenn Arbeitsobjekt oder Tätigkeit semantisch anders sind.",
                    "invalid_entity_contamination nur bei hoher Sicherheit, wenn Kunden-/Objekt-/Adressinhalt ohne line-lokalen Beleg in den serviceName übernommen wurde.",
                    "Normale Übersetzung, Flexion, Wortstellung, Singular/Plural und echte Synonyme sind valid. Bei Unsicherheit uncertain.",
                    "Du darfst nichts korrigieren, umbenennen oder ergänzen.",
                    'Gib ausschließlich JSON zurück: {"itemAssessments":[{"index":1,"classification":"valid|invalid_entity_contamination|invalid_evidence_mismatch|uncertain","confidence":"high|medium|low","reason":"kurz"}]}.',
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    originalText: String(args.originalText || "").slice(0, 8500),
                    translatedText: String(args.translatedText || "").slice(
                      0,
                      8500,
                    ),
                    customerName: String(args.customerName || "").slice(0, 220),
                    executionSiteName: String(args.executionSiteName || "").slice(
                      0,
                      220,
                    ),
                    workItems: args.workItems.slice(0, 40),
                  }),
                },
              ],
            }),
          },
        );
        if (itemAuditResponseV17_90L268.ok) {
          const itemAuditPayloadV17_90L268 =
            await itemAuditResponseV17_90L268.json();
          const itemAuditContentV17_90L268 = String(
            itemAuditPayloadV17_90L268?.choices?.[0]?.message?.content || "",
          ).trim();
          const itemAuditParsedV17_90L268 = itemAuditContentV17_90L268
            ? JSON.parse(itemAuditContentV17_90L268)
            : null;
          if (Array.isArray(itemAuditParsedV17_90L268?.itemAssessments)) {
            parsed = {
              ...(parsed || {}),
              itemAssessments: [
                ...(Array.isArray(parsed?.itemAssessments)
                  ? parsed.itemAssessments
                  : []),
                ...itemAuditParsedV17_90L268.itemAssessments.slice(
                  0,
                  args.workItems.length + 4,
                ),
              ],
            };
          }
        }
      } catch (itemAuditErrorV17_90L268: any) {
        console.warn(
          "[WorkCoverageCheckerV17_90L268] item audit failed; previous item review kept",
          itemAuditErrorV17_90L268?.message || itemAuditErrorV17_90L268,
        );
      }
    }

    const rawRoleAssessmentMissingWork = (
      Array.isArray(parsed?.roleAssessments)
        ? parsed.roleAssessments.slice(0, args.roleEntries.length + 8)
        : []
    ).flatMap((raw: any) => {
      const confidence = String(raw?.confidence || "").toLowerCase();
      const classification = String(raw?.classification || "").toLowerCase();
      const roleText = compactExactSourceTextV17_90L251(raw?.roleText).slice(
        0,
        520,
      );
      const matchedRoleEntry = args.roleEntries.find(
        (entry) =>
          compactExactSourceTextV17_90L251(entry.text) === roleText,
      );
      const roleExists = Boolean(matchedRoleEntry);
      const authoritativeNonServiceRole = ["safety", "access", "parking"].includes(
        String(matchedRoleEntry?.role || "").toLowerCase(),
      );
      if (
        confidence !== "high" ||
        !roleExists ||
        authoritativeNonServiceRole ||
        !["possible_work_missing", "uncertain"].includes(classification)
      ) {
        return [];
      }
      return [
        {
          ...raw,
          relatedRoleText: roleText,
          reason:
            compactExactSourceTextV17_90L251(raw?.reason) ||
            (classification === "uncertain"
              ? "mögliche Arbeit semantisch unklar"
              : "mögliche Arbeit nicht in workItems vertreten"),
        },
      ];
    });

    const rawMissingWork = [
      ...(Array.isArray(parsed?.missingWork)
        ? parsed.missingWork.slice(0, 12)
        : []),
      ...rawRoleAssessmentMissingWork,
    ]
      .map((raw: any) => {
        const confidence = String(raw?.confidence || "").toLowerCase();
        const source = String(raw?.source || "").toLowerCase() as
          | "original"
          | "translation"
          | "";
        const quote = compactExactSourceTextV17_90L251(raw?.quote).slice(0, 520);
        const providedSemanticId = compactExactSourceTextV17_90L251(
          raw?.semanticId,
        )
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .slice(0, 120);
        const relatedRoleTextCandidate =
          compactExactSourceTextV17_90L251(raw?.relatedRoleText).slice(0, 520);
        const relatedRoleEntry = relatedRoleTextCandidate
          ? args.roleEntries.find(
              (entry) =>
                compactExactSourceTextV17_90L251(entry.text) ===
                relatedRoleTextCandidate,
            )
          : null;
        const relatedRoleText = relatedRoleEntry
          ? relatedRoleTextCandidate
          : null;
        const authoritativeNonServiceRole = ["safety", "access", "parking"].includes(
          String(relatedRoleEntry?.role || "").toLowerCase(),
        );
        const normalizedQuoteKey = compactExactSourceTextV17_90L251(quote)
          .toLocaleLowerCase("de-CH")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const quoteCoveredByAuthoritativeNonServiceRole = args.roleEntries.some(
          (entry) => {
            if (
              !["safety", "access", "parking"].includes(
                String(entry.role || "").toLowerCase(),
              )
            ) {
              return false;
            }
            const roleKey = compactExactSourceTextV17_90L251(entry.text)
              .toLocaleLowerCase("de-CH")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            return Boolean(
              roleKey &&
                normalizedQuoteKey &&
                (roleKey === normalizedQuoteKey ||
                  roleKey.includes(normalizedQuoteKey) ||
                  normalizedQuoteKey.includes(roleKey)),
            );
          },
        );
        if (
          authoritativeNonServiceRole ||
          quoteCoveredByAuthoritativeNonServiceRole
        ) {
          return null;
        }
        const semanticId =
          providedSemanticId ||
          deterministicReviewFindingIdV17_90L252(
            relatedRoleText || quote,
          );
        if (
          confidence !== "high" ||
          !["original", "translation"].includes(source) ||
          quote.length < 8
        ) {
          return null;
        }
        const selectedSource =
          source === "translation" ? args.translatedText : args.originalText;
        if (!exactQuoteExistsInSourceV17_90L251(selectedSource, quote)) {
          return null;
        }

        const evidenceAlreadyRepresented = args.workItems.some((item) => {
          const existing = compactExactSourceTextV17_90L251(item.sourceText);
          return Boolean(
            existing &&
              (existing.toLocaleLowerCase("de-CH").includes(
                quote.toLocaleLowerCase("de-CH"),
              ) ||
                quote.toLocaleLowerCase("de-CH").includes(
                  existing.toLocaleLowerCase("de-CH"),
                )),
          );
        });
        if (evidenceAlreadyRepresented) return null;

        return {
          semanticId,
          source: source as "original" | "translation",
          quote,
          relatedRoleText,
          reason: compactExactSourceTextV17_90L251(raw?.reason).slice(0, 240),
        } satisfies ReadOnlyWorkCoverageMissingFindingV17_90L251;
      })
      .filter(
        (
          finding: ReadOnlyWorkCoverageMissingFindingV17_90L251 | null,
        ): finding is ReadOnlyWorkCoverageMissingFindingV17_90L251 =>
          Boolean(finding),
      )
      .sort((left, right) =>
        left.source === right.source ? 0 : left.source === "original" ? -1 : 1,
      );

    const missingWork: ReadOnlyWorkCoverageMissingFindingV17_90L251[] = [];
    const semanticRoleById = new Map<string, string>();
    const seenRoleTexts = new Set<string>();
    for (const finding of rawMissingWork) {
      const roleKey = finding.relatedRoleText
        ? finding.relatedRoleText.toLocaleLowerCase("de-CH")
        : "";
      if (roleKey && seenRoleTexts.has(roleKey)) continue;

      const priorRoleKey = semanticRoleById.get(finding.semanticId);
      if (priorRoleKey !== undefined) {
        // Same semantic id + same role (or no role on either side) is the same
        // underlying work from original/translation. If the checker
        // accidentally reused an id for two different role entries, preserve
        // both findings with a deterministic suffix instead of losing work.
        if (!roleKey || !priorRoleKey || roleKey === priorRoleKey) continue;
        finding.semanticId = `${finding.semanticId}_${missingWork.length + 1}`;
      }

      semanticRoleById.set(finding.semanticId, roleKey);
      if (roleKey) seenRoleTexts.add(roleKey);
      missingWork.push(finding);
    }

    const rawItemAssessmentInvalid = (
      Array.isArray(parsed?.itemAssessments)
        ? parsed.itemAssessments.slice(0, args.workItems.length + 6)
        : []
    ).flatMap((raw: any) => {
      const confidence = String(raw?.confidence || "").toLowerCase();
      const classification = String(raw?.classification || "").toLowerCase();
      const itemIndex = Number(raw?.index);
      if (
        confidence !== "high" ||
        !["invalid_entity_contamination", "invalid_evidence_mismatch"].includes(
          classification,
        ) ||
        !Number.isInteger(itemIndex) ||
        itemIndex < 1 ||
        itemIndex > args.workItems.length
      ) {
        return [];
      }
      return [
        {
          index: itemIndex,
          confidence: "high",
          reason:
            compactExactSourceTextV17_90L251(raw?.reason) ||
            (classification === "invalid_entity_contamination"
              ? "Leistungsname enthält eine nicht line-lokal belegte Entität"
              : "Leistungsname ist durch die eigene Quellzeile nicht belegt"),
        },
      ];
    });

    const invalidItems: ReadOnlyWorkCoverageInvalidItemV17_90L251[] = [];
    const seenInvalid = new Set<number>();
    const rawInvalidItems = [
      ...(Array.isArray(parsed?.invalidItems)
        ? parsed.invalidItems.slice(0, args.workItems.length + 6)
        : []),
      ...rawItemAssessmentInvalid,
    ];
    for (const raw of rawInvalidItems) {
      const confidence = String(raw?.confidence || "").toLowerCase();
      const itemIndex = Number(raw?.index);
      if (
        confidence !== "high" ||
        !Number.isInteger(itemIndex) ||
        itemIndex < 1 ||
        itemIndex > args.workItems.length ||
        seenInvalid.has(itemIndex)
      ) {
        continue;
      }
      seenInvalid.add(itemIndex);
      invalidItems.push({
        itemIndex,
        reason: compactExactSourceTextV17_90L251(raw?.reason).slice(0, 240),
      });
    }

    return { missingWork, invalidItems };
  } catch (error: any) {
    console.warn(
      "[WorkCoverageCheckerV17_90L251] failed; first AI result kept",
      error?.message || error,
    );
    return emptyFinalAiWorkCoverageResultV17_90L251();
  }
}

const normalizeRoleReviewTextV17_90L106 = (value: unknown): string =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ROLE_COVERAGE_STOPWORDS_V17_90L217 = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer",
  "einem", "einen", "ist", "sind", "war", "wird", "und", "oder", "bei",
  "beim", "im", "in", "am", "an", "auf", "zur", "zum", "von", "vom",
  "mit", "nur", "bitte", "per", "via", "the", "a", "an", "at", "to",
  "and", "or", "with", "please", "le", "la", "les", "un", "une", "de",
  "du", "des", "et", "ou", "avec", "dans", "au", "aux",
]);

function roleCoverageTokensV17_90L217(value: unknown): string[] {
  return normalizeRoleReviewTextV17_90L106(value)
    .split(/\s+/g)
    .filter(
      (token) =>
        token.length >= 2 && !ROLE_COVERAGE_STOPWORDS_V17_90L217.has(token),
    );
}

function roleStatementCoveredByPeersV17_90L217(args: {
  sourceText: string;
  targetRole: FinalAiStructuredRoleV17_90L215;
  roleEntries: Array<{
    id: string;
    text: string;
    currentRole: FinalAiStructuredRoleV17_90L215;
  }>;
  preferredTargetId?: string | null;
}): boolean {
  const sourceTokens = roleCoverageTokensV17_90L217(args.sourceText);
  if (sourceTokens.length === 0) return false;

  const peers = args.roleEntries.filter(
    (entry) =>
      entry.currentRole === args.targetRole &&
      normalizeRoleReviewTextV17_90L106(entry.text) !==
        normalizeRoleReviewTextV17_90L106(args.sourceText),
  );
  if (peers.length === 0) return false;

  const peerUnion = new Set(peers.flatMap((entry) => roleCoverageTokensV17_90L217(entry.text)));
  const unionCoversSource = sourceTokens.every((token) => peerUnion.has(token));
  if (unionCoversSource) return true;

  const preferredTarget = args.preferredTargetId
    ? peers.find((entry) => entry.id === args.preferredTargetId)
    : null;
  if (!preferredTarget) return false;

  const sourceInvariants = canonicalRoleInvariantTokensV17_90L201(
    args.sourceText,
  ).join("|");
  const targetInvariants = canonicalRoleInvariantTokensV17_90L201(
    preferredTarget.text,
  ).join("|");
  if (sourceInvariants !== targetInvariants) return false;

  const sourceTokenCount = new Set(sourceTokens).size;
  const targetTokenCount = new Set(
    roleCoverageTokensV17_90L217(preferredTarget.text),
  ).size;
  return sourceTokenCount <= targetTokenCount + 1;
}

function ordinaryHintCoveredByAppointmentV17_90L217(
  hint: unknown,
  appointment: unknown,
): boolean {
  const hintText = String(hint || "").replace(/\s+/g, " ").trim();
  const appointmentText = String(appointment || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!hintText || !appointmentText) return false;

  const hintMinute = hintText.match(/\b(\d{1,3})\s*(?:min(?:ute)?n?|minutes?)\b/i)?.[1] || "";
  const appointmentMinute = appointmentText.match(/\b(\d{1,3})\s*(?:min(?:ute)?n?|minutes?)\b/i)?.[1] || "";
  if (!hintMinute || hintMinute !== appointmentMinute) return false;

  const hintTokens = new Set(roleCoverageTokensV17_90L217(hintText));
  const appointmentTokens = new Set(
    roleCoverageTokensV17_90L217(appointmentText),
  );
  if (hintTokens.size < 2) return false;

  const hintNegated = hasCanonicalRoleNegationV17_90L201(hintText);
  const appointmentNegated = hasCanonicalRoleNegationV17_90L201(
    appointmentText,
  );
  if (hintNegated !== appointmentNegated) return false;

  const covered = [...hintTokens].every((token) => appointmentTokens.has(token));
  if (covered) return true;

  // V17.90L230: Equivalent pre-announcement wording is often normalized from
  // "vor der Ankunft benachrichtigen" to "vorher per SMS melden". The exact
  // minute value and compatible communication channel are stronger evidence
  // than wording-token overlap. Do not suppress a genuinely different channel.
  const isArrivalNotice = (value: string) =>
    /\b(?:vorher|vor\s+(?:der\s+)?ankunft|vor\s+dem\s+eintreffen|before(?:\s+arrival)?|prior\s+to(?:\s+arrival)?|avant(?:\s+l['’]?arriv[ée]e)?|prima(?:\s+dell['’]?arrivo)?|antes(?:\s+de\s+la\s+llegada)?)\b/iu.test(
      value,
    );
  if (!isArrivalNotice(hintText) || !isArrivalNotice(appointmentText)) {
    return false;
  }
  const hintChannel = normalizeAiContactChannelV17_90L86(hintText);
  const appointmentChannel = normalizeAiContactChannelV17_90L86(appointmentText);
  if (hintChannel && appointmentChannel && hintChannel !== appointmentChannel) {
    return false;
  }
  return true;
}

function accessEvidenceKindsV17_90L217(value: unknown): Set<string> {
  const text = normalizeRoleReviewTextV17_90L106(value);
  const kinds = new Set<string>();
  // V17.90L229: A bare word such as "Eingang" inside a safety sentence is
  // not an access route. Route evidence needs a concrete route/entrance form
  // or a directional construction. This prevents fragments such as
  // "Eingang. Für die Leuchten ist eine" from becoming access facts.
  if (
    /\b(?:seiteneingang|hintereingang|haupteingang|zugangsweg|zufahrt|entrance|entree|acceso|ingresso)\b/i.test(
      text,
    ) ||
    /\b(?:uber|ueber|via|durch|bei|am)\s+(?:den\s+|die\s+|das\s+)?eingang\b/i.test(
      text,
    ) ||
    /\beingang\s+(?:hinten|vorne|links|rechts|bei|beim|am|durch|uber|ueber|via)\b/i.test(
      text,
    )
  ) {
    kinds.add("route");
  }
  if (
    /\b(?:[a-z]*schlussel[a-z]*|[a-z]*schluessel[a-z]*|key|cle|chiave|llave)\b/i.test(
      text,
    )
  ) {
    kinds.add("key");
  }
  if (/\b(?:code|pin|passcode|kennzahl)\b/i.test(text)) {
    kinds.add("code");
  }
  if (
    /\b(?:badge|[a-z]*ausweis|zugangskarte|zutrittskarte|access card)\b/i.test(
      text,
    )
  ) {
    kinds.add("badge");
  }
  return kinds;
}

function isCompleteAccessCandidateV17_90L229(
  value: unknown,
  kinds: Set<string>,
): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || kinds.size === 0 || text.length > 220) return false;
  if (
    /\b(?:eine|einer|einem|einen|der|die|das|den|dem|des|für|fuer|und|oder|mit|bei|beim|am|an|im|in|zum|zur)\s*$/iu.test(
      text,
    )
  ) {
    return false;
  }
  if (/^[,.;:\-–—\s]+|[,;:\-–—\s]+$/u.test(text)) return false;

  // A route-only candidate must describe how/where to enter. Merely mentioning
  // that something is near an entrance is not sufficient access evidence.
  if (
    kinds.size === 1 &&
    kinds.has("route") &&
    !/\b(?:zugang|zugangsweg|zufahrt|seiteneingang|hintereingang|haupteingang|uber|ueber|via|durch|benutzen|nehmen|betreten|eingang\s+(?:hinten|vorne|links|rechts))\b/i.test(
      normalizeRoleReviewTextV17_90L106(text),
    )
  ) {
    return false;
  }
  return true;
}

const extractRoleReviewLinesV17_90L106 = (
  value: unknown,
  depth = 0,
): string[] => {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string") {
    return value
      .split(/\n+/g)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => Boolean(line) && line !== "[object Object]");
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      extractRoleReviewLinesV17_90L106(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "text",
      "hinweis",
      "note",
      "beschreibung",
      "description",
      "value",
      "label",
      "evidence",
    ];
    const preferred = preferredKeys.flatMap((key) =>
      extractRoleReviewLinesV17_90L106(record[key], depth + 1),
    );
    return preferred.length > 0
      ? preferred
      : Object.values(record).flatMap((entry) =>
          extractRoleReviewLinesV17_90L106(entry, depth + 1),
        );
  }
  return [];
};

async function runReadOnlySpecialNoteRoleCheckerV17_90L106(args: {
  originalText: string;
  translatedText?: string | null;
  appointments?: string[];
  roles: Record<FinalAiStructuredRoleV17_90L215, string[]>;
}): Promise<FinalAiRoleReviewResultV17_90L216> {
  const apiKey = process.env.OPENAI_API_KEY;
  const rolePrefixes: Record<FinalAiStructuredRoleV17_90L215, string> = {
    safety: "s",
    access: "a",
    parking: "p",
    other: "o",
    ordinary: "h",
  };
  const roleEntries = (
    Object.entries(args.roles) as Array<[FinalAiStructuredRoleV17_90L215, string[]]>
  ).flatMap(([currentRole, lines]) =>
    lines.map((text, index) => ({
      id: `${rolePrefixes[currentRole]}${index + 1}`,
      text,
      currentRole,
    })),
  );
  if (!apiKey) {
    return emptyFinalAiRoleReviewResultV17_90L216();
  }

  const sourceById = new Map(
    roleEntries.map((entry) => [entry.id, entry] as const),
  );
  const allowedRoles = new Set<FinalAiStructuredRoleV17_90L215>([
    "safety",
    "access",
    "parking",
    "other",
    "ordinary",
  ]);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Du bist der letzte KI-Konsistenzprüfer vor dem unveränderbaren Canonical Lock.",
              "Nach deinem Ergebnis werden Rollen, Hinweise und Zugangsinformationen vollständig versiegelt. Danach darf kein Parser mehr fachliche Inhalte ändern.",
              "Du darfst ausschließlich drei streng begrenzte Aktionen ausführen: (1) die Rolle eines vorhandenen Eintrags korrigieren, (2) einen vorhandenen Eintrag unterdrücken, wenn derselbe Sachverhalt bereits vollständig in einem anderen Eintrag oder Termin enthalten ist, (3) einen im Original oder in der Übersetzung ausdrücklich vorhandenen, aber in entries fehlenden atomaren Rollenhinweis als wörtliches Zitat ergänzen.",
              "Du darfst niemals frei formulieren, zusammenfassen, Werte ändern oder neue Tatsachen erfinden.",
              "Rollen: safety = konkrete Gefahr; access = Zugang, Eingang, Schlüssel, Badge, Tür-/Tor-/Schlüsselbox-/Zutrittscode, PIN oder anderer Zugangsnachweis; parking = Parken, Fahrzeugposition, Rampe oder Anlieferung; other = sonstiger betrieblicher Hinweis; ordinary = allgemeiner organisatorischer Hinweis.",
              "Jeder Zugangscode oder PIN gehört immer zu access. Mehrere unterschiedliche Zugangsfakten wie Eingang, Schlüssel und Code bleiben getrennt erhalten und dürfen nicht gegeneinander unterdrückt werden.",
              "Eine Vorankündigung, die bereits vollständig in appointments enthalten ist, darf als ordinary-Dublette unterdrückt werden.",
              "Original und Übersetzung desselben Sachverhalts sind eine Dublette. Behalte bevorzugt die klare deutsche Fassung aus translatedText, sofern vorhanden.",
              "Eine Leistung mit Menge oder Preis ist keine Rolleninformation und darf weder ergänzt noch als Hinweis erhalten werden.",
              "Produktregel: Jede tatsächlich erwähnte Hundaussage bleibt safety und darf nicht unterdrückt werden.",
              "Ergänzungen müssen ein kurzes, exaktes, zusammenhängendes Zitat aus originalText oder translatedText sein. Nutze additions nur, wenn ein klarer Rollenhinweis vollständig in entries fehlt.",
              "Melde nur eindeutige Aktionen mit confidence high. Bei Unsicherheit nichts ändern.",
              "Gib ausschließlich JSON zurück: {\"verdicts\":[{\"id\":\"a1\",\"expectedRole\":\"safety|access|parking|other|ordinary\",\"confidence\":\"high|medium|low\",\"reason\":\"kurze Begründung\"}],\"suppressions\":[{\"id\":\"h1\",\"duplicateOfId\":\"a1|null\",\"duplicateOfAppointmentIndex\":0,\"confidence\":\"high|medium|low\",\"reason\":\"kurze Begründung\"}],\"additions\":[{\"source\":\"original|translation\",\"quote\":\"exaktes Zitat\",\"expectedRole\":\"safety|access|parking|other|ordinary\",\"confidence\":\"high|medium|low\",\"reason\":\"kurze Begründung\"}]}",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              originalText: String(args.originalText || "").slice(0, 5000),
              translatedText: String(args.translatedText || "").slice(0, 5000),
              appointments: (args.appointments || []).slice(0, 12),
              entries: roleEntries,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[RoleCheckerV17_90L215] API error ${response.status}; original AI roles kept`,
      );
      return emptyFinalAiRoleReviewResultV17_90L216();
    }

    const payload = await response.json();
    const rawContent = String(payload?.choices?.[0]?.message?.content || "").trim();
    const parsed = rawContent ? JSON.parse(rawContent) : null;
    const rawVerdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
    const findings: ReadOnlySpecialNoteRoleFindingV17_90L106[] = [];
    const seen = new Set<string>();

    for (const raw of rawVerdicts.slice(0, roleEntries.length + 6)) {
      const source = sourceById.get(String(raw?.id || ""));
      const expectedRole = String(raw?.expectedRole || "").toLowerCase() as
        | FinalAiStructuredRoleV17_90L215
        | "";
      const confidence = String(raw?.confidence || "").toLowerCase();
      if (!source || !allowedRoles.has(expectedRole as FinalAiStructuredRoleV17_90L215)) {
        continue;
      }
      if (confidence !== "high" || expectedRole === source.currentRole) continue;
      if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(source.text) && expectedRole !== "safety") {
        continue;
      }

      const key = `${source.id}|${expectedRole}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        text: source.text,
        currentRole: source.currentRole,
        expectedRole: expectedRole as FinalAiStructuredRoleV17_90L215,
        reason: String(raw?.reason || "Rolle semantisch prüfen")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220),
      });
      if (findings.length >= 10) break;
    }

    const suppressions: ReadOnlySpecialNoteSuppressionV17_90L216[] = [];
    const seenSuppressions = new Set<string>();
    const appointmentCount = Array.isArray(args.appointments)
      ? args.appointments.length
      : 0;
    const rawSuppressions = Array.isArray(parsed?.suppressions)
      ? parsed.suppressions
      : [];
    for (const raw of rawSuppressions.slice(0, roleEntries.length + 8)) {
      const source = sourceById.get(String(raw?.id || ""));
      const confidence = String(raw?.confidence || "").toLowerCase();
      if (!source || confidence !== "high") continue;
      if (/\b(?:hund|dog|chien|cane|perro)\b/i.test(source.text)) continue;

      const duplicateTarget = sourceById.get(
        String(raw?.duplicateOfId || ""),
      );
      const rawAppointmentIndex = raw?.duplicateOfAppointmentIndex;
      const appointmentIndex = Number(rawAppointmentIndex);
      const hasAppointmentTarget =
        rawAppointmentIndex !== null &&
        rawAppointmentIndex !== undefined &&
        Number.isInteger(appointmentIndex) &&
        appointmentIndex >= 0 &&
        appointmentIndex < appointmentCount;
      if (!duplicateTarget && !hasAppointmentTarget) continue;
      if (hasAppointmentTarget && source.currentRole !== "ordinary") continue;
      if (duplicateTarget?.id === source.id) continue;

      const appointmentCovered = hasAppointmentTarget
        ? ordinaryHintCoveredByAppointmentV17_90L217(
            source.text,
            args.appointments?.[appointmentIndex],
          )
        : false;
      const peerCovered = duplicateTarget
        ? roleStatementCoveredByPeersV17_90L217({
            sourceText: source.text,
            targetRole: duplicateTarget.currentRole,
            roleEntries,
            preferredTargetId: duplicateTarget.id,
          })
        : false;

      if (!appointmentCovered && !peerCovered) {
        // V17.90L217: A shorter duplicate target must never erase additional
        // business evidence. Preserve the full original statement by moving it
        // to the target role when the reviewer clearly identified that role.
        if (
          duplicateTarget &&
          duplicateTarget.currentRole !== source.currentRole &&
          !findings.some(
            (finding) =>
              finding.currentRole === source.currentRole &&
              finding.expectedRole === duplicateTarget.currentRole &&
              normalizeRoleReviewTextV17_90L106(finding.text) ===
                normalizeRoleReviewTextV17_90L106(source.text),
          )
        ) {
          findings.push({
            text: source.text,
            currentRole: source.currentRole,
            expectedRole: duplicateTarget.currentRole,
            reason:
              "Vollständige Quellangabe enthält zusätzliche fachliche Details und wird deshalb ungekürzt in die Zielrolle verschoben.",
          });
        }
        continue;
      }

      const key = `${source.currentRole}|${normalizeRoleReviewTextV17_90L106(source.text)}`;
      if (!key || seenSuppressions.has(key)) continue;
      seenSuppressions.add(key);
      suppressions.push({
        text: source.text,
        currentRole: source.currentRole,
        reason: String(raw?.reason || "Semantische Dublette")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220),
      });
    }

    const additions: ReadOnlySpecialNoteAdditionV17_90L216[] = [];
    const seenAdditions = new Set<string>();
    const rawAdditions = Array.isArray(parsed?.additions)
      ? parsed.additions
      : [];
    for (const raw of rawAdditions.slice(0, 12)) {
      const confidence = String(raw?.confidence || "").toLowerCase();
      const expectedRole = String(raw?.expectedRole || "").toLowerCase() as
        | FinalAiStructuredRoleV17_90L215
        | "";
      const sourceKind = String(raw?.source || "").toLowerCase() as
        | "original"
        | "translation"
        | "";
      const quote = String(raw?.quote || "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        confidence !== "high" ||
        !allowedRoles.has(expectedRole as FinalAiStructuredRoleV17_90L215) ||
        !["original", "translation"].includes(sourceKind) ||
        quote.length < 4 ||
        quote.length > 220
      ) {
        continue;
      }
      const sourceText =
        sourceKind === "translation"
          ? String(args.translatedText || "")
          : String(args.originalText || "");
      const sourceCompact = sourceText.replace(/\s+/g, " ").toLowerCase();
      if (!sourceCompact.includes(quote.toLowerCase())) continue;
      if (/\b(?:chf|eur|usd|gbp)\b/i.test(quote)) continue;

      const key = `${expectedRole}|${normalizeRoleReviewTextV17_90L106(quote)}`;
      if (!key || seenAdditions.has(key)) continue;
      seenAdditions.add(key);
      additions.push({
        text: quote,
        expectedRole: expectedRole as FinalAiStructuredRoleV17_90L215,
        source: sourceKind as "original" | "translation",
        reason: String(raw?.reason || "Fehlender Rollenhinweis aus Quelle")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220),
      });
    }

    return { findings, suppressions, additions };
  } catch (error: any) {
    console.warn(
      "[RoleCheckerV17_90L216] failed; original AI roles kept",
      error?.message || error,
    );
    return emptyFinalAiRoleReviewResultV17_90L216();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Block R — Self-introduction safety-net for voice/text intake.
//
// When the LLM returns kunde.name = null/empty AND the raw incoming text
// contains a clear self-introduction pattern ("mein Name ist X" /
// "Ich heisse X" / "Ich bin X"), extract the name from the text as a
// post-LLM fallback.
//
// Greift NUR wenn:
//   - kunde.name leer/null ist (überschreibt NIE eine LLM-Extraktion)
//   - eine eindeutige Selbstvorstellung im Text steht (Regex)
//
// Dies löst den Fall, in dem der WhatsApp-ProfileName mit dem im Audio
// genannten Endkunden-Namen identisch ist und der Prompt deshalb die
// Name-Extraktion unterdrückt.
// ─────────────────────────────────────────────────────────────────────────
function extractSelfIntroductionName(
  rawText: string | null | undefined,
): string | null {
  if (!rawText || typeof rawText !== "string") return null;
  const text = rawText.trim();
  if (!text) return null;

  // Tolerant gegen Transkript-Quirks: "Mein Name ist", "Ich heisse/heiße", "Ich bin",
  // "Hier spricht", "Hier ist", "Mein Vorname ist", "Mein Nachname ist".
  // Erlaubt 1-2 Namensteile (Vor- und/oder Nachname), 2-30 Zeichen pro Teil.
  // Buchstaben/Umlaute/Bindestriche, optional Apostroph für O'Brien etc.
  const pattern =
    /(?:mein\s+(?:name|vorname|nachname)\s+(?:ist|lautet)|ich\s+hei[sß]+e|ich\s+bin|hier\s+spricht|hier\s+ist)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30}(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'\-]{1,30})?)/iu;
  const m = text.match(pattern);
  if (!m || !m[1]) return null;

  const candidate = m[1].trim();
  // Ausschliessen: triviale Wörter die häufig nach "Ich bin" stehen aber kein Name sind
  const blocklist = new Set([
    "der",
    "die",
    "das",
    "ein",
    "eine",
    "einer",
    "sehr",
    "gut",
    "schon",
    "noch",
    "auch",
    "hier",
    "dort",
    "jetzt",
    "heute",
    "morgen",
    "gestern",
    "froh",
    "gerade",
    "nicht",
    "kein",
    "keine",
    "okay",
    "super",
  ]);
  const firstToken = candidate.split(/\s+/)[0]?.toLowerCase() || "";
  if (blocklist.has(firstToken)) return null;
  // Mindestens 2 Zeichen, max 60 Zeichen Gesamtname
  if (candidate.length < 2 || candidate.length > 60) return null;
  return candidate;
}

// INTAKE_SEMANTIC_ENGINE_V12
// V16.38: Shared billing-marker vocabulary for messy WhatsApp texts.
// Covers German, English, French, Spanish/Portuguese and Italian invoice labels
// without accepting execution-site labels as billing customer names.
const BILLING_MARKER_PATTERN =
  "kunde\\s*,?\\s*der\\s+die\\s+rechnung\\s+bekommt\\s+und\\s+bezahlt|" +
  "kunde\\s*/\\s*rechnungsadresse|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|" +
  "rechnungsempfängerin|rechnungsempfaengerin|rechnungsadresse|" +
  "bitte\\s+(?:die\\s+)?rechnung\\s+(?:schicken|senden|mailen)\\s+an|" +
  "rechnung\\s+bitte\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+bitte\\s+an|" +
  "rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+per\\s+(?:mail|email)\\s+an|" +
  "rechnung\\s+(?:geht\\s+)?an|rechnung\\s+bekommt|rechnung\\s+ist\\s+(?:für|fuer)|rechnung\\s+(?:für|fuer)|" +
  "auftraggeber(?:in)?|besteller(?:in)?|zahler|zahlende\\s+stelle|chef(?:\\s+zahlt)?|" +
  "firma|company|client\\s*/\\s*facturation|client|billing\\s+customer|billing\\s+address|invoice\\s+customer|invoice\\s+address|bill\\s+to|" +
  "facturation|facture\\s*(?:à|a)|(?:la\\s+)?facture\\s+(?:va\\s+)?(?:à|a|pour)|" +
  "factura\\s+(?:para|a|à)|fatura\\s+(?:para|a|à)|facturacion|facturación|" +
  "fattura\\s+(?:a|per)|fatturazione|cliente|pagador|payer";

const BILLING_LABEL_PREFIX_REGEX = new RegExp(
  `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|geht\\s+an|geht\\s+auf|va\\s+(?:à|a)|para|per|pour|a|à|=|:)?\\s*`,
  "i",
);

// V16.32: harte Vorbereinigung für Namen aus KI/Transkript.
// Ziel: keine Satzreste wie "ist Meier Renovationen AG", "Mail reicht"
// oder "Es geht um kleine Bauarbeiten" als Rechnungskunde speichern.
function stripNonNameLeadIn(value: string): string {
  let candidate = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)[0]
    .replace(/^\s*(?:TEXT\s*\d+\s*)$/i, "")
    .replace(/^\s*(?:TEXT\s*\d+\s*)/i, "")
    .replace(/^\s*(?:der\s+|die\s+|das\s+)?/i, "")
    .replace(/^\s*[:\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  const leadInPatterns = [
    BILLING_LABEL_PREFIX_REGEX,
    /^\s*(?:das\s+ist|dies\s+ist|es\s+ist|c['’]?est|it\s+is|ist|isch|is)\s+/i,
    /^\s*(?:für|fuer|an|bei)\s+(?:den|die|das|der|dem)?\s*/i,
    /^\s*(?:la\s+)?facture\s+(?:va\s+)?(?:à|a|pour)\s*:?\s*/i,
    /^\s*(?:factura|fatura)\s+(?:para|a|à)\s*:?\s*/i,
    /^\s*fattura\s+(?:a|per)\s*:?\s*/i,
    /^\s*(?:auftraggeber(?:in)?|besteller(?:in)?|zahler|zahlende\s+stelle|chef(?:\s+zahlt)?|pagador|payer)\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\s*/i,
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const before = candidate;
    for (const pattern of leadInPatterns) {
      candidate = candidate.replace(pattern, "");
    }
    candidate = candidate
      .replace(/^\s*[:\-–—]+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (candidate === before) break;
  }

  return candidate;
}
function isForbiddenBillingNameSentence(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  const exact = new Set([
    "mail",
    "email",
    "e mail",
    "mail reicht",
    "email reicht",
    "e mail reicht",
    "sms",
    "whatsapp",
    "morgen",
    "heute",
    "adresse",
    "adresse wie letztes mal",
    "wie letztes mal",
    "unbekannt",
    "auftraggeber",
    "auftraggeber ist",
    "besteller",
    "zahler",
    "chef",
    "chef zahlt",
    "zahlt",
    "bezahlt",
    "factura para",
    "fatura para",
    "fattura a",
    "fattura per",
    "la facture va a",
    "la facture va à",
    "facture a",
    "facture à",
    "facture pour",
    "pagador",
    "payer",
  ]);
  if (exact.has(normalized)) return true;

  const forbiddenStarts =
    /^(?:mail\s+reicht|e\s*mail\s+reicht|email\s+reicht|per\s+mail|bitte\s+per\s+mail|bitte\s+mail|sms\s+reicht|whatsapp\s+reicht|telefon\s+reicht|kein\s+anruf|nicht\s+anrufen|adresse\s+wie|wie\s+letztes\s+mal|es\s+(?:geht|goht|handelt)\s+(?:um|sich)|kleine\s+bauarbeiten|neuer\s+auftrag|auftrag\b|auftraggeber\b|besteller\b|zahler\b|chef\b|zahlt\b|bezahlt\b|factura\s+(?:para|a)|fatura\s+(?:para|a)|fattura\s+(?:a|per)|(?:la\s+)?facture\s+(?:va\s+)?(?:a|à|pour)|pagador\b|payer\b|termin\b|morgen\b|heute\b)/i;
  if (forbiddenStarts.test(normalized)) return true;

  return false;
}

function cleanBillingCustomerNameCandidate(
  value: string | null | undefined,
): string | null {
  let candidate =
    String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/)[0] || "";

  candidate = candidate
    .replace(/^["'“”‘’\s:,\-–—]+/g, "")
    .replace(/["'“”‘’\s:,\-–—.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = stripNonNameLeadIn(candidate);

  if (!candidate) return null;
  if (isForbiddenBillingNameSentence(candidate)) return null;

  // Bei "Name, Strasse 12, 8000 Ort" nur den Namen behalten.
  candidate = candidate.split(/[,;]/)[0]?.trim() || candidate;

  // Bei gesprochenen Einzeilern ohne Komma: "Name Strasse 12 in 8000 Ort"
  // ab der Strasse abschneiden, damit keine Adressdaten als Name gespeichert werden.
  candidate = candidate
    .replace(
      /\s+[A-ZÄÖÜa-zäöüß' .\-]*?(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-zA-Z]?.*$/i,
      "",
    )
    .replace(/\s+\bin\s+\d{4,5}\b.*$/i, "")
    .replace(/\s+\d{4,5}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  candidate = stripNonNameLeadIn(candidate);
  if (!candidate) return null;
  if (isForbiddenBillingNameSentence(candidate)) return null;

  const normalized = normalizeUnitText(candidate);
  const hasStrongCompanySuffix =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i.test(
      candidate,
    );

  if (candidate.length < 2 || candidate.length > 80) return null;
  if (!/[A-Za-zÄÖÜäöüß]/.test(candidate)) return null;
  // V17.90L361: Company names can legitimately contain digits (e.g.
  // "Test 4 GmbH", "3M Schweiz AG"). Digits remain blocked for
  // non-company name candidates so address lines are still rejected.
  if (/\d/.test(candidate) && !hasStrongCompanySuffix) return null;

  // INTAKE_CUSTOMER_NAME_SAFE_EMPTY_V12
  // Lieber leer lassen als Füllwörter oder Satzreste als Kundenname speichern.
  const blockedExact = new Set([
    "ist",
    "isch",
    "is",
    "sind",
    "geht",
    "gehe",
    "an",
    "bei",
    "für",
    "fuer",
    "von",
    "mit",
    "und",
    "oder",
    "bitte",
    "kunde",
    "rechnungsadresse",
    "rechnung",
    "mail",
    "email",
    "mail reicht",
    "email reicht",
    "sms",
    "whatsapp",
    "morgen",
    "heute",
    "rechnungskunde",
    "rechnungsempfänger",
    "rechnungsempfaenger",
    "facturation",
    "billing",
    "invoice",
    "name",
    "unbekannt",
    "auftraggeber",
    "besteller",
    "zahler",
    "chef",
    "zahlt",
    "bezahlt",
    "factura",
    "fatura",
    "fattura",
    "facture",
    "pagador",
    "payer",
    "weiss",
    "weiß",
    "weis",
    "nicht",
  ]);
  if (blockedExact.has(normalized)) return null;

  // Keine Arbeitssätze / Hinweis-Sätze als Namen speichern.
  const blockedStarts = [
    "hat",
    "haben",
    "will",
    "wollen",
    "möchte",
    "moechte",
    "soll",
    "sollen",
    "braucht",
    "bitte",
    "dort",
    "hier",
    "die arbeit",
    "arbeit",
    "leistung",
    "leistungen",
    "es geht",
    "es handelt",
    "zugang",
    "zufahrt",
    "termin",
    "schlüssel",
    "schluessel",
    "parkplatz",
    "garage",
    "lagerhalle",
    "eingang",
    "mail",
    "email",
    "sms",
    "whatsapp",
    "adresse wie",
    "wie letztes",
    "neuer auftrag",
    "auftraggeber",
    "besteller",
    "zahler",
    "chef",
    "zahlt",
    "bezahlt",
    "factura",
    "fatura",
    "fattura",
    "facture",
    "pagador",
    "payer",
  ];
  if (
    !hasStrongCompanySuffix &&
    blockedStarts.some((start) => normalized.startsWith(start))
  )
    return null;

  const blockedContained =
    /\b(reinigen|reinigung|schneiden|entfernen|streichen|malen|montieren|prüfen|pruefen|ersetzen|entsorgen|auftrag|leistung|leistungen|preis|preise|währung|waehrung|fenster|treppenhaus|garage|tiefgarage|baustelle|arbeitsort|ausführungsadresse|ausfuehrungsadresse|kundentext|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|mail|email|whatsapp|sms|zugang|zufahrt|seitentor|schlüssel|schluessel|parkplatz|termin|bauarbeiten)\b/i;
  if (!hasStrongCompanySuffix && blockedContained.test(normalized)) return null;

  // Reine Adresszeilen sind kein Name.
  const addressLike =
    /\b(strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\b/i;
  if (addressLike.test(normalized)) return null;

  return candidate;
}

function extractBillingCustomerNameFallback(
  rawText: string | null | undefined,
): string | null {
  const source = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!source) return null;

  const marker =
    "(?:kunde\\s*/\\s*rechnungsadresse|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|rechnungsadresse|bitte\\s+rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+bitte\\s+an|rechnung\\s+(?:schicken|senden|mailen)\\s+an|rechnung\\s+per\\s+(?:mail|email)\\s+an|rechnung\\s+geht\\s+an|rechnung\\s+an|rechnung\\s+bekommt|rechnung\\s+(?:für|fuer)|kunde\\s+ist|kunde|invoice\\s+customer\\s+is|invoice\\s+customer|billing\\s+customer\\s+is|billing\\s+customer|billing\\s+address|bill\\s+to)";

  // 1) Einzeiler: "Rechnung geht an Swiss Facility Service AG, Badenerstrasse 90 in 8004 Zürich."
  const inlinePattern = new RegExp(
    `(?:^|[\\n.!?]\\s*)${marker}\\s*:?\\s+([^\\n]+)`,
    "gi",
  );
  for (const match of source.matchAll(inlinePattern)) {
    const candidate = cleanBillingCustomerNameCandidate(match[1]);
    if (candidate) return candidate;
  }

  // 2) Blockform:
  //    Kunde / Rechnungsadresse:
  //    Swiss Facility Service AG
  //    Badenerstrasse 90
  //    8004 Zürich
  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerLinePattern = new RegExp(`^\\s*${marker}\\s*:?\\s*$`, "i");
  const markerWithValuePattern = new RegExp(
    `^\\s*${marker}\\s*:?\\s+(.+)$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const sameLine = line.match(markerWithValuePattern);
    if (sameLine?.[1]) {
      const candidate = cleanBillingCustomerNameCandidate(sameLine[1]);
      if (candidate) return candidate;
    }

    if (markerLinePattern.test(line)) {
      const nextLine = lines[index + 1] || "";
      const candidate = cleanBillingCustomerNameCandidate(nextLine);
      if (candidate) return candidate;
    }
  }

  // 3) Unlabelled fallback: first plausible billing/customer block before
  // Arbeitsort/Kontakt/Besonderheiten/Leistungen. This keeps flexible messages
  // working without assuming that the customer is always line 1.
  const sectionStopPattern =
    /^(?:arbeitsort|objekt|ausführungsadresse|ausfuehrungsadresse|kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|person\s+vor\s+ort|hauswart|hausmeister|concierge|caretaker|gardien|besonderheiten|leistungsübersicht|leistungsuebersicht|leistungen|titel)\s*:?/i;
  const addressPattern =
    /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\b/i;
  const zipCityPattern = /\b\d{4,5}\s+[A-Za-zÄÖÜäöüß' .\-]+\b/i;
  const companySuffixPattern =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i;
  const greetingOrIntroPattern =
    /^(?:hallo|guten\s+tag|grüezi|gruezi|salut|bonjour|bitte|neuer\s+auftrag|auftrag|anbei|hier|ich\s+brauche|wir\s+brauchen)\b/i;

  const upperCandidateLines: string[] = [];
  for (const line of lines) {
    if (sectionStopPattern.test(line) && !companySuffixPattern.test(line))
      break;
    upperCandidateLines.push(line);
  }

  for (let index = 0; index < upperCandidateLines.length; index += 1) {
    const line = upperCandidateLines[index];
    if (!line || greetingOrIntroPattern.test(line)) continue;
    if (
      /^(?:tel\.?|telefon|phone|mobile|handy|natel|e-?mail)\b/i.test(line) &&
      !companySuffixPattern.test(line)
    )
      continue;
    if (addressPattern.test(line) || zipCityPattern.test(line)) continue;

    const candidate = cleanBillingCustomerNameCandidate(line);
    if (!candidate) continue;

    const next1 = upperCandidateLines[index + 1] || "";
    const next2 = upperCandidateLines[index + 2] || "";
    const hasAddressAfter =
      addressPattern.test(next1) || addressPattern.test(next2);
    const hasZipAfter =
      zipCityPattern.test(next1) || zipCityPattern.test(next2);
    const hasCompanySuffix = companySuffixPattern.test(candidate);

    if (hasCompanySuffix || (hasAddressAfter && hasZipAfter)) {
      return candidate;
    }
  }

  return null;
}

type SafeBillingCustomerEvidence = {
  source: "ai" | "labeled" | "inline" | "top" | "none";
  hasReliableCustomerBlock: boolean;
  name: string | null;
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
};

function normalizeIntakeSourceText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntakeLines(value: string | null | undefined): string[] {
  return normalizeIntakeSourceText(value)
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBillingLabelPrefix(line: string): string {
  return String(line || "")
    .replace(BILLING_LABEL_PREFIX_REGEX, "")
    .trim();
}
function hasBillingCompanySuffix(value: string | null | undefined): boolean {
  return /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|gmbh\s*&\s*co|verein|stiftung)\b/i.test(
    String(value || ""),
  );
}

function isBillingStopLine(line: string): boolean {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  // Firmen können zufällig mit einem Stop-Wort beginnen:
  // "Arbeitsort Reihenfolge Test GmbH", "Objekt Service AG" usw.
  // Solche Zeilen sind echte Rechnungskunden und dürfen den Billing-Block
  // nicht abbrechen.
  if (hasBillingCompanySuffix(trimmed)) return false;

  return getBillingBlockStopRegex().test(trimmed);
}

function isBillingPhoneOrMailLine(line: string): boolean {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  // Firmennamen wie "Telefon Trennung AG" oder "Mobile Clean GmbH"
  // sind keine Telefon-/Mail-Zeilen.
  if (
    hasBillingCompanySuffix(trimmed) &&
    !extractPhoneFromText(trimmed) &&
    !/@/.test(trimmed)
  ) {
    return false;
  }

  return (
    /^\s*(?:tel\.?|telefon|phone|mobile|handy|natel)\b\s*[:.]?\s*(?:$|\+?\d|\()/i.test(
      trimmed,
    ) || /^\s*(?:e-?mail|email)\b\s*[:.]?\s*(?:$|[^\s]+@)/i.test(trimmed)
  );
}

function parseBillingStreetLine(line: string): string | null {
  const raw = String(line || "")
    .replace(
      /^\s*(?:adresse|anschrift|strasse|straße|street\s+address|address)\s*:?\s*/i,
      "",
    )
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;

  const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
  const word = "[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*";
  const germanSuffix =
    "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";

  const patterns = [
    // Bahnhofstrasse 44, Badenerstrasse 90, Zentralstrasse 5
    new RegExp(
      `\\b((?:${word}\\s+){0,3}${word}${germanSuffix}\\s+${houseNumber})\\b`,
      "i",
    ),
    // Untere Gasse 4, Alte Gasse 7, Im Weg 2
    new RegExp(
      `\\b((?:${word}\\s+){1,4}${germanSuffix}\\s+${houseNumber})\\b`,
      "i",
    ),
    // Rütistrasse 9 / Rue de Lausanne 10 / Via Roma 3
    new RegExp(
      `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const street = match[1]
      .replace(
        /^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();

    if (street && !/^[-–—]+$/.test(street)) return street;
  }

  return null;
}

function parseBillingStreetFromBlock(
  value: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(value);

  // Strict first pass: street must be on its own line or in a real address line.
  // This prevents "Fixcheck AG Bahnhofstrasse 18" from becoming the street.
  for (const line of lines) {
    const cleaned = stripBillingLabelPrefix(line);
    if (
      !cleaned ||
      isBillingStopLine(cleaned) ||
      isBillingPhoneOrMailLine(cleaned)
    )
      continue;
    const street = parseBillingStreetLine(cleaned);
    if (street) return street;
  }

  // Last fallback for spoken one-liners only. Remove the parsed customer name
  // before looking for the street, otherwise company names can be swallowed.
  const source = normalizeIntakeSourceText(value);
  const name = parseBillingNameFromBlock(source);
  const withoutName = name
    ? source.replace(
        new RegExp(`^\\s*${escapeRegExpLocal(name)}\\s*[,;]?\\s*`, "i"),
        "",
      )
    : source;
  return parseBillingStreetLine(withoutName);
}

function parseBillingPlzCityFromLine(line: string): {
  plz: string | null;
  city: string | null;
} {
  const cleaned = String(line || "")
    .replace(
      /^\s*(?:plz\s*\/\s*ort|plz|ort|postleitzahl|zip|postal\s+code|ville|city)\s*:?\s*/i,
      "",
    )
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}?)(?=\s*(?:$|\b(?:tel\.?|telefon|phone|mobile|handy|natel|e-?mail|email|arbeitsort|objekt|kontakt|besonderheiten|leistungen|leistungsübersicht|leistungsuebersicht)\b|[,;.]))/i,
  );
  if (!match) return { plz: null, city: null };

  const city = String(match[2] || "")
    .replace(
      /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
      "",
    )
    .replace(/[,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { plz: match[1] || null, city: city || null };
}

function parseBillingPlzCityFromBlock(value: string | null | undefined): {
  plz: string | null;
  city: string | null;
} {
  const lines = splitIntakeLines(value);

  for (const line of lines) {
    const result = parseBillingPlzCityFromLine(stripBillingLabelPrefix(line));
    if (result.plz && result.city) return result;
  }

  return parseBillingPlzCityFromLine(normalizeIntakeSourceText(value));
}

function parseBillingNameFromBlock(
  value: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(value);
  for (const line of lines) {
    const stripped = stripBillingLabelPrefix(line)
      .replace(/^\s*(?:name|firma|company|société|societe)\s*:?\s*/i, "")
      .trim();

    const cleaned = isBillingPhoneOrMailLine(stripped) ? "" : stripped;

    if (!cleaned) continue;
    if (isBillingStopLine(cleaned)) continue;
    if (parseBillingStreetLine(cleaned)) continue;
    if (parseBillingPlzCityFromLine(cleaned).plz) continue;
    if (
      /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|street|road|lane)\b/i.test(
        cleaned,
      )
    )
      continue;

    const candidate = cleanBillingCustomerNameCandidate(cleaned);
    if (candidate) return candidate;
  }

  return null;
}

function getBillingBlockStopRegex(): RegExp {
  return /^(?:arbeitsort|objekt|ausführungsadresse|ausfuehrungsadresse|arbeitsadresse|einsatzort|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|contact\s+sur\s+place|concierge|hauswart|hausmeister|besonderheiten|bemerkungen|remarques|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|service|services|titel)\b/i;
}

function hasNamelessBillingAddressEvidence(
  block: string | null | undefined,
): boolean {
  const source = normalizeIntakeSourceText(block);
  if (!source) return false;

  const street = parseBillingStreetFromBlock(source);
  const { plz, city } = parseBillingPlzCityFromBlock(source);
  const phone = extractPhoneFromText(source);
  const email = extractEmailFromText(source);

  const hasFullAddress = Boolean(street && plz && city);
  const hasPartialAddressWithPhone = Boolean(
    (street || (plz && city)) && phone,
  );
  const hasPartialAddressWithEmail = Boolean(
    (street || (plz && city)) && email,
  );

  // Nur für explizit gelabelte Rechnungs-/Billing-Blöcke:
  // Wenn der Name fehlt, dürfen echte Adress-/Telefon-/E-Mail-Daten trotzdem nicht
  // verworfen werden. Der Auftrag bleibt prüfpflichtig, aber die Daten bleiben
  // in der Kundenkarte sichtbar.
  return (
    hasFullAddress || hasPartialAddressWithPhone || hasPartialAddressWithEmail
  );
}

function extractLabeledBillingBlock(lines: string[]): string | null {
  const billingMarker = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(billingMarker);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 7; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (isBillingStopLine(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (
      block &&
      (parseBillingNameFromBlock(block) ||
        hasNamelessBillingAddressEvidence(block))
    ) {
      return block;
    }
  }

  return null;
}

function extractInlineBillingBlock(source: string): string | null {
  const patterns = [
    new RegExp(
      `(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s+([\\s\\S]{4,260}?)(?=\\s*[.!?]?\\s*\\b(?:gearbeitet\\s+wird|arbeitsort|ausführungsadresse|ausfuehrungsadresse|arbeiten\\s+(?:bitte\\s+)?(?:bei|beim|in|im)|arbeit\\s+(?:bitte\\s+)?(?:bei|beim|in|im)|adresse\\s+de\\s+travail|lieu\\s+d['’]?intervention|indirizzo\\s+(?:di\\s+lavoro|cantiere)|lugar\\s+de\\s+trabajo|kontakt\\s+vor\\s+ort|vor\\s+ort|besonderheiten|termin|rendez-vous|appuntamento|leistungsübersicht|leistungsuebersicht|leistungen|services?)\\b|$)`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const block = match[1]
      .replace(/[,;]\s*/g, "\n")
      .replace(
        /\b(?:adresse|anschrift|telefonnummer|telefon|tel\.?|phone|mobile|handy|natel)\s*:?/gi,
        "\n$& ",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (
      block &&
      (parseBillingNameFromBlock(block) ||
        hasNamelessBillingAddressEvidence(block))
    ) {
      return block;
    }
  }

  return null;
}

function extractTopBillingBlock(lines: string[]): string | null {
  const blockLines: string[] = [];

  for (const line of lines) {
    if (isBillingStopLine(line)) break;
    if (
      /^(?:hallo|guten\s+tag|grüezi|gruezi|salut|bonjour|bitte\b|neuer\s+auftrag|auftrag\s+erfassen|anbei|hier\s+ist|es\s+geht\s+um|es\s+handelt\s+sich|zugang\s+über|zugang\s+ueber|termin|schlüssel|schluessel)/i.test(
        line,
      )
    )
      continue;
    if (
      /^(?:whats\s*app|whatsapp|sms|mail|e-?mail|telegram)\s*:?\s*$/i.test(line)
    )
      continue;
    if (/^\[Titel\s*:/i.test(line)) continue;
    blockLines.push(line);
    if (blockLines.length >= 5) break;
  }

  const block = blockLines.join("\n").trim();
  if (!block) return null;

  const name = parseBillingNameFromBlock(block);
  const street = parseBillingStreetFromBlock(block);
  const { plz, city } = parseBillingPlzCityFromBlock(block);
  const hasZipCity = !!plz && !!city;
  const hasCompany =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|verein|stiftung)\b/i.test(
      name || "",
    );

  // Unlabelled customer data is accepted only when it is a real top customer
  // block. A later Arbeitsort/Kontakt block must never become customer data.
  if (name && (hasCompany || (street && hasZipCity))) return block;
  return null;
}

function escapeRegExpLocal(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// V16.36: Final hard guard for explicit nameless billing-address blocks.
// This is intentionally stricter and simpler than the general customer parser:
// labels like "Rechnung an:" / "Rechnungsadresse:" are trusted as billing
// section markers, even when no customer name exists. If street + ZIP/city are
// present, persist those fields and keep the order/customer in review state.
function extractHardLabeledBillingAddressEvidenceV1634(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const markerRegex = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (/^\[Titel\s*:/i.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;

    const name = parseBillingNameFromBlock(block);
    const street = parseBillingStreetFromBlock(block);
    const { plz, city } = parseBillingPlzCityFromBlock(block);
    const phone = extractPhoneFromText(block);
    const email = extractEmailFromText(block);

    const hasFullAddress = Boolean(street && plz && city);
    const hasPartialAddressWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );

    if (!name && !hasFullAddress && !hasPartialAddressWithContact) continue;

    return {
      source: "labeled",
      hasReliableCustomerBlock: true,
      name: name || null,
      street: street || null,
      plz: plz || null,
      city: city || null,
      phone: phone || null,
      email: email || null,
    };
  }

  return null;
}

// V16.37: Ultra-direct fallback for explicit nameless billing blocks.
// Grund: Der allgemeine Parser darf weiterhin streng bleiben, aber ein klarer
// Block "Rechnung an:" mit Strasse + PLZ/Ort darf nicht verloren gehen, nur
// weil kein Name vorhanden ist. Diese Funktion liest nur den explizit gelabelten
// Rechnungsblock bis zum nächsten Arbeitsort-/Leistungs-/Termin-Marker.
function extractDirectNamelessBillingAddressV1637(
  rawText: string | null | undefined,
): {
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
} | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const markerRegex = new RegExp(
    `^\\s*(?:${BILLING_MARKER_PATTERN})\\s*(?:ist|isch|is|lautet|heisst|heißt|=|:)?\\s*(.*)$`,
    "i",
  );
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|ausführen\s+in\b.*|ausfuehren\s+in\b.*|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im)\b.*|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 10; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (/^\[Titel\s*:/i.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;

    let street: string | null = null;
    let plz: string | null = null;
    let city: string | null = null;

    for (const rawLine of blockLines) {
      const line = rawLine.trim();
      if (!line || isBillingPhoneOrMailLine(line)) continue;

      const parsedStreet = parseBillingStreetLine(line);
      if (!street && parsedStreet) {
        street = parsedStreet;
      }

      const parsedPlzCity = parseBillingPlzCityFromLine(line);
      if (!plz && parsedPlzCity.plz) plz = parsedPlzCity.plz;
      if (!city && parsedPlzCity.city) city = parsedPlzCity.city;
    }

    // Fallback: parse the whole block in case the user wrote it as one line.
    if (!street) street = parseBillingStreetLine(block);
    if (!plz || !city) {
      const parsedWholePlzCity = parseBillingPlzCityFromLine(block);
      if (!plz && parsedWholePlzCity.plz) plz = parsedWholePlzCity.plz;
      if (!city && parsedWholePlzCity.city) city = parsedWholePlzCity.city;
    }

    const phone = extractPhoneFromText(block);
    const email = extractEmailFromText(block);

    const hasSafeAddress = Boolean(street && plz && city);
    const hasSafePartialWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );

    if (!hasSafeAddress && !hasSafePartialWithContact) continue;

    return {
      street,
      plz,
      city,
      phone,
      email,
    };
  }

  return null;
}

// V16.39: AI-first address intake.
// The LLM must sort billing customer and execution site up front. The code below
// only validates already structured fields and deliberately does NOT infer
// billing/execution roles from multilingual marker vocabularies.
function normalizeStructuredTextField(value: any): string | null {
  const cleaned = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)[0]
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^[-–—]+$/.test(cleaned)) return null;
  if (
    /^(?:null|undefined|none|keine|kein|fehlt|missing|unknown|unbekannt)$/i.test(
      cleaned,
    )
  )
    return null;
  return cleaned;
}

function normalizeStructuredTextBlock(value: any): string | null {
  const cleaned = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .trim();

  if (!cleaned || /^[-–—]+$/.test(cleaned)) return null;
  if (
    /^(?:null|undefined|none|keine|kein|fehlt|missing|unknown|unbekannt)$/i.test(
      cleaned,
    )
  )
    return null;
  return cleaned;
}

function normalizeStructuredConfidenceLevel(
  value: any,
): "hoch" | "mittel" | "niedrig" | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.85) return "hoch";
    if (value >= 0.65) return "mittel";
    return "niedrig";
  }

  const normalized = normalizeUnitText(value || "");
  if (!normalized) return null;
  if (
    ["hoch", "high", "sicher", "certain", "eindeutig", "clear"].includes(
      normalized,
    )
  )
    return "hoch";
  if (
    ["mittel", "medium", "wahrscheinlich", "probably", "plausibel"].includes(
      normalized,
    )
  )
    return "mittel";
  if (
    ["niedrig", "low", "unsicher", "uncertain", "unklar"].includes(normalized)
  )
    return "niedrig";
  return null;
}

function normalizedEvidenceKey(value: string | null | undefined): string {
  return normalizeUnitText(value || "")
    .replace(/[^a-z0-9@.+\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function structuredEvidenceMatchesOriginalText(
  evidence: string | null,
  originalText: string | null | undefined,
): boolean {
  const evidenceKey = normalizedEvidenceKey(evidence);
  if (!evidenceKey || evidenceKey.length < 3) return false;

  const originalKey = normalizedEvidenceKey(originalText || "");

  // Bei Bild-only-Nachrichten gibt es keinen vollständigen Rohtext, aber die KI
  // kann sichtbare Daten aus dem Bild extrahieren. Dann reicht vorhandene
  // Evidence, weil sie nicht gegen messageText gegengeprüft werden kann.
  if (!originalKey) return true;

  if (originalKey.includes(evidenceKey)) return true;

  const evidenceTokens = evidenceKey
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 4 || /@/.test(token) || /^\d{4,5}$/.test(token),
    );

  if (evidenceTokens.length === 0) return false;

  const matchingTokens = evidenceTokens.filter((token) =>
    originalKey.includes(token),
  );
  return matchingTokens.length >= Math.min(3, evidenceTokens.length);
}

function hasUsableStructuredBillingEvidence(args: {
  kundeData: any;
  originalText: string | null | undefined;
  hasAnyExtractedBillingData: boolean;
}): boolean {
  if (!args.hasAnyExtractedBillingData) return false;

  const confidence = normalizeStructuredConfidenceLevel(
    args.kundeData?.confidence ??
      args.kundeData?.confidence_level ??
      args.kundeData?.kunde_confidence ??
      args.kundeData?.billingConfidence,
  );

  const evidence = normalizeStructuredTextBlock(
    args.kundeData?.evidence ??
      args.kundeData?.sourceText ??
      args.kundeData?.source_text ??
      args.kundeData?.quelle,
  );

  // Fail closed: Ohne Confidence + Evidence wird der Kundenblock nicht als
  // sicherer Rechnungskunde behandelt. Dann bleibt der Auftrag prüfpflichtig,
  // statt falsche Kundendaten in den Kundenstamm zu schreiben.
  if (!confidence || confidence === "niedrig") return false;
  if (!evidence) return false;
  if (!structuredEvidenceMatchesOriginalText(evidence, args.originalText))
    return false;

  return true;
}

function normalizeStructuredPlz(value: any): string | null {
  const match = String(value ?? "").match(/\b(\d{4,5})\b/);
  return match?.[1] || null;
}

function cleanAiStructuredBillingName(value: any): string | null {
  let candidate = normalizeStructuredTextField(value);
  if (!candidate) return null;

  if (/@/.test(candidate)) return null;
  const hasStructuredCompanySuffixV17_90L361 =
    /\b(?:AG|GmbH|Sàrl|SARL|SA|S\.?A\.?|Ltd\.?|Limited|Inc\.?|KG|KGaA|Verein|Stiftung)\b/i.test(
      candidate,
    );
  if (/\d/.test(candidate) && !hasStructuredCompanySuffixV17_90L361) return null;
  if (
    /\b(?:kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht|kommt)|öffnet\s+|oeffnet\s+|hausdienst|hauswart|hausmeister|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (parseBillingStreetLine(candidate)) return null;
  if (parseBillingPlzCityFromLine(candidate).plz) return null;

  candidate = candidate
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // If the model returns a phrase with a company suffix plus trailing words,
  // keep only the company name up to the legal suffix. This is structural, not a
  // billing-marker lookup.
  const company = candidate.match(
    /^(.+?\b(?:AG|GmbH|Sàrl|SARL|SA|S\.?A\.?|Ltd\.?|Limited|Inc\.?|KG|KGaA|Verein|Stiftung)\b)/i,
  )?.[1];
  if (company) {
    const cleanedCompany = company.replace(/\s+/g, " ").trim();
    return cleanedCompany.length >= 2 && cleanedCompany.length <= 80
      ? cleanedCompany
      : null;
  }

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;

  const looksLikePersonName = tokens.every((token) =>
    /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]{1,40}$/.test(token),
  );
  if (!looksLikePersonName) return null;

  return candidate.length <= 80 ? candidate : null;
}

function extractAiStructuredBillingEvidence(
  kundeData: any,
  originalText?: string | null,
): SafeBillingCustomerEvidence {
  const rawStreet = [
    normalizeStructuredTextField(kundeData?.strasse),
    normalizeStructuredTextField(kundeData?.hausnummer),
  ]
    .filter(Boolean)
    .join(" ");

  const candidateStreet = rawStreet
    ? parseBillingStreetLine(rawStreet) ||
      cleanExecutionStreetCandidate(rawStreet)
    : null;
  const candidatePlz = normalizeStructuredPlz(kundeData?.plz);
  const candidateCity = cleanIntakeCityCandidate(
    normalizeStructuredTextField(kundeData?.ort),
  );
  const evidence = normalizeStructuredTextBlock(
    kundeData?.evidence ??
      kundeData?.sourceText ??
      kundeData?.source_text ??
      kundeData?.quelle,
  );
  const candidateName = cleanAiStructuredBillingName(kundeData?.name);
  const evidenceKey = normalizedEvidenceKey(evidence || "");
  const evidenceSupports = (value?: string | null): boolean => {
    const key = normalizedEvidenceKey(value || "");
    if (!key || !evidenceKey) return false;
    return ` ${evidenceKey} `.includes(` ${key} `);
  };

  // V17.90L194: Every customer-master field must be backed by the same local
  // billing evidence block. No field may be rescued from another message area.
  const name = evidenceSupports(candidateName) ? candidateName : null;
  const street = evidenceSupports(candidateStreet) ? candidateStreet : null;
  const plz = evidenceSupports(candidatePlz) ? candidatePlz : null;
  const city = evidenceSupports(candidateCity) ? candidateCity : null;

  const structuredPhone = extractPhoneFromText(
    normalizeStructuredTextField(kundeData?.telefon),
  );
  const phone =
    structuredPhone && evidence && sourceContainsPhoneV17_90L86(evidence, structuredPhone)
      ? structuredPhone
      : null;

  const structuredEmail = extractEmailFromText(
    normalizeStructuredTextField(kundeData?.email),
  );
  const email =
    structuredEmail &&
    evidence &&
    evidence.toLowerCase().includes(structuredEmail.toLowerCase())
      ? structuredEmail
      : null;

  const hasFullAddress = Boolean(street && plz && city);
  const hasPartialAddressWithContact = Boolean(
    (street || (plz && city)) && (phone || email),
  );
  const hasAnyExtractedBillingData = Boolean(
    name || hasFullAddress || hasPartialAddressWithContact,
  );

  const hasReliableCustomerBlock = hasUsableStructuredBillingEvidence({
    kundeData,
    originalText,
    hasAnyExtractedBillingData,
  });

  return {
    source: "ai",
    hasReliableCustomerBlock,
    name: hasReliableCustomerBlock ? name : null,
    street: hasReliableCustomerBlock ? street : null,
    plz: hasReliableCustomerBlock ? plz : null,
    city: hasReliableCustomerBlock ? city : null,
    phone: hasReliableCustomerBlock ? phone : null,
    email: hasReliableCustomerBlock ? email : null,
  };
}

function sameStructuredAddress(args: {
  aStreet?: string | null;
  aPlz?: string | null;
  aCity?: string | null;
  bStreet?: string | null;
  bPlz?: string | null;
  bCity?: string | null;
}): boolean {
  const a = normalizeUnitText(
    [args.aStreet, args.aPlz, args.aCity].filter(Boolean).join(" "),
  );
  const b = normalizeUnitText(
    [args.bStreet, args.bPlz, args.bCity].filter(Boolean).join(" "),
  );
  return Boolean(a && b && a === b);
}

function hasExplicitExecutionNotBillingAddressDirectiveV17_51(
  rawText: string | null | undefined,
): boolean {
  const text = normalizeUnitText(rawText || "");
  if (!text) return false;

  return (
    /nicht\s+an\s+(?:die\s+)?rechnungsadresse/.test(text) ||
    /nicht\s+zur\s+rechnungsadresse/.test(text) ||
    /rechnung(?:sadresse)?\s+.*(?:sondern|aber)\s+(?:in|im|bei|zur|zum)/.test(
      text,
    ) ||
    /(?:sondern|aber)\s+(?:in|im|bei|zur|zum)\s+(?:die\s+)?(?:werkstatt|arbeitsort|objekt|baustelle|filiale|lager|innenhof|spielplatz)/.test(
      text,
    )
  );
}

function isBrokenExecutionSiteRoleFragmentV17_90L176(
  value?: string | null,
): boolean {
  const key = normalizeUnitText(value || "").replace(/\s+/g, " ").trim();
  if (!key) return true;
  const labels = [
    "ausfuehrungsadresse",
    "ausfuehrungsort",
    "ausfuehrung",
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

// V17.90L199: When the deterministic original-text extractor and the first AI
// identify the same execution address, prefer the fuller original object name.
// This preserves proper names ("Bâtiment Les Cèdres") and complete site scopes
// ("Sonnenhof Haus C und D") without changing the address role.
function preferOriginalExecutionSiteNameV17_90L199(args: {
  aiAddress: {
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
  };
  originalAddress: {
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
  };
}): string | null {
  const aiName = cleanExecutionSiteNameCandidate(args.aiAddress.siteName);
  const originalName = cleanExecutionSiteNameCandidate(
    args.originalAddress.siteName,
  );
  if (!originalName) return aiName;
  if (!aiName) return originalName;

  const fieldsCompatible = (
    left?: string | null,
    right?: string | null,
  ) => {
    const a = normalizeUnitText(left || "");
    const b = normalizeUnitText(right || "");
    return !a || !b || a === b;
  };
  const sameAddress =
    fieldsCompatible(args.aiAddress.siteAddress, args.originalAddress.siteAddress) &&
    fieldsCompatible(args.aiAddress.sitePlz, args.originalAddress.sitePlz) &&
    fieldsCompatible(args.aiAddress.siteCity, args.originalAddress.siteCity) &&
    Boolean(
      args.aiAddress.siteAddress ||
        args.originalAddress.siteAddress ||
        args.aiAddress.siteCity ||
        args.originalAddress.siteCity,
    );
  if (!sameAddress) return aiName;

  const aiKey = normalizeUnitText(aiName);
  const originalKey = normalizeUnitText(originalName);
  if (!aiKey || !originalKey) return aiName;
  if (aiKey === originalKey) return originalName;
  if (
    originalKey.startsWith(`${aiKey} `) ||
    originalKey.includes(` ${aiKey} `)
  ) {
    return originalName;
  }

  const aiTokens = aiKey.split(/\s+/g).filter(Boolean);
  const originalTokens = originalKey.split(/\s+/g).filter(Boolean);
  let sharedTail = 0;
  while (
    sharedTail < aiTokens.length &&
    sharedTail < originalTokens.length &&
    aiTokens[aiTokens.length - 1 - sharedTail] ===
      originalTokens[originalTokens.length - 1 - sharedTail]
  ) {
    sharedTail += 1;
  }
  return sharedTail >= 2 ? originalName : aiName;
}


// V17.90L203: Preserve a fuller object/scope label when the same address line
// contains a longer non-contradictory name. This is structural: the current
// site name anchors the start and the verified street anchors the end.
function enrichExecutionSiteNameFromEvidenceV17_90L203(args: {
  currentName?: string | null;
  siteAddress?: string | null;
  originalText?: string | null;
  translatedText?: string | null;
}): string | null {
  const currentName = cleanExecutionSiteNameCandidate(args.currentName);
  const siteAddress = String(args.siteAddress || "").replace(/\s+/g, " ").trim();
  if (!currentName || !siteAddress) return currentName;

  const currentKey = normalizeUnitText(currentName);
  let best = currentName;
  for (const rawSource of [args.originalText, args.translatedText]) {
    const source = String(rawSource || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
    if (!source) continue;

    const pattern = new RegExp(
      `${escapeRegExpLocal(currentName)}\\s*[,;:\\-–—]?\\s*([\\s\\S]{0,100}?)\\s*[,;]?\\s*${escapeRegExpLocal(siteAddress)}`,
      "i",
    );
    const match = source.match(pattern);
    if (!match) continue;

    const suffix = String(match[1] || "")
      .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "")
      .trim();
    const candidate = cleanExecutionSiteNameCandidate(
      [currentName, suffix].filter(Boolean).join(", "),
    );
    if (!candidate || candidate.length > 140) continue;
    if (/\b(?:chf|eur|usd|gbp)\b|@|\+?\d[\d\s().\/-]{6,}\d/i.test(candidate)) continue;
    if (/\b(?:kontakt|termin|schlüssel|schluessel|code|whatsapp|sms|anrufen|telefon|parken|parkieren)\b/i.test(suffix)) continue;

    const candidateKey = normalizeUnitText(candidate);
    if (!candidateKey.includes(currentKey) || candidateKey.length <= normalizeUnitText(best).length) {
      continue;
    }
    best = candidate;
  }
  return best;
}

// V17.90L208: Remove only a dangling grammatical connector from an already
// verified object label when the actual street is stored separately. Example:
// "Lagergebäude, an der" + "Seestrasse 58" becomes "Lagergebäude". This is
// structural cleanup, not a translation or service-word rewrite.
function trimDanglingExecutionSiteConnectorV17_90L208(args: {
  siteName?: string | null;
  siteAddress?: string | null;
}): string | null {
  const siteName = cleanExecutionSiteNameCandidate(args.siteName);
  const siteAddress = cleanExecutionStreetCandidate(args.siteAddress);
  if (!siteName || !siteAddress) return siteName;

  const trimmed = siteName
    .replace(
      /(?:[,;:]\s*)?\b(?:an|bei|in|auf|vor|hinter|neben|gegenüber|gegenueber)\s+(?:der|dem|den|die|das)\s*$/iu,
      "",
    )
    .replace(/[,;:\s]+$/g, "")
    .trim();

  return cleanExecutionSiteNameCandidate(trimmed) || siteName;
}

function extractAiStructuredExecutionAddress(
  aiExecutionAddress: any,
  customer?: {
    customerAddress?: string | null;
    customerPlz?: string | null;
    customerCity?: string | null;
  },
  originalText?: string | null,
): {
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
} | null {
  if (!aiExecutionAddress || aiExecutionAddress.ist_abweichend !== true)
    return null;

  const confidence = normalizeStructuredConfidenceLevel(
    aiExecutionAddress.confidence ??
      aiExecutionAddress.confidence_level ??
      aiExecutionAddress.address_confidence ??
      aiExecutionAddress.executionConfidence,
  );
  if (confidence === "niedrig") return null;

  const rawSiteName = cleanExecutionSiteNameCandidate(
    normalizeStructuredTextField(aiExecutionAddress.name),
  );
  const siteName = isBrokenExecutionSiteRoleFragmentV17_90L176(rawSiteName)
    ? null
    : rawSiteName;
  const rawExecutionStreet = normalizeStructuredTextField(
    aiExecutionAddress.strasse,
  );
  const rawExecutionHouseNumber = normalizeStructuredTextField(
    aiExecutionAddress.hausnummer,
  );
  const rawExecutionAddress = rawExecutionStreet
    ? [
        rawExecutionStreet,
        rawExecutionHouseNumber &&
        !new RegExp(`\b${escapeRegExpLocal(rawExecutionHouseNumber)}\b`).test(
          rawExecutionStreet,
        )
          ? rawExecutionHouseNumber
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const siteAddress = cleanExecutionStreetCandidate(rawExecutionAddress);
  const sitePlz = normalizeStructuredPlz(aiExecutionAddress.plz);
  const siteCity = cleanIntakeCityCandidate(
    normalizeStructuredTextField(aiExecutionAddress.ort),
  );

  // V17.90L194: Keep an evidence-backed partial AI address as a review
  // candidate. Missing ZIP/city must remain visibly unresolved instead of
  // forcing a second whole-message parser to recreate the address.
  const hasUsableAddress = Boolean(siteName || siteAddress || sitePlz || siteCity);
  if (!hasUsableAddress) return null;

  const evidence = normalizeStructuredTextBlock(
    aiExecutionAddress.evidence ??
      aiExecutionAddress.sourceText ??
      aiExecutionAddress.source_text ??
      aiExecutionAddress.quelle,
  );
  const originalKey = normalizedEvidenceKey(originalText || "");
  if (originalKey) {
    const addressParts = [siteName, siteAddress, sitePlz, siteCity].filter(
      Boolean,
    ) as string[];
    const everyAddressPartInOriginal = addressParts.every((part) => {
      const partKey = normalizedEvidenceKey(part);
      return partKey.length >= 2 && originalKey.includes(partKey);
    });

    // Fail closed: Wenn die KI eine Ausführungsadresse liefert, müssen die
    // Kerndaten der Adresse tatsächlich im Eingangstext stehen. Sonst lieber
    // keine Ausführungsadresse speichern als eine erfundene oder vermischte.
    if (!everyAddressPartInOriginal) return null;

    if (
      evidence &&
      !structuredEvidenceMatchesOriginalText(evidence, originalText)
    ) {
      return null;
    }
  }

  if (
    sameStructuredAddress({
      aStreet: siteAddress,
      aPlz: sitePlz,
      aCity: siteCity,
      bStreet: customer?.customerAddress,
      bPlz: customer?.customerPlz,
      bCity: customer?.customerCity,
    }) &&
    !siteName
  ) {
    // Gleiche Strasse/PLZ/Ort ohne eigenen Arbeitsbereich ist keine separate
    // Ausführungsadresse. Ein echter Arbeitsbereich wie Innenhof, Werkstatt
    // oder Seiteneingang darf dagegen als kompakter Ort erhalten bleiben.
    return null;
  }

  return {
    siteName,
    siteAddress,
    sitePlz,
    siteCity,
    siteNote: null,
  };
}

// V17.61_PHASE1_ADDRESS_ROLE_SAFETY
// Phase 1 of the address-assignment workflow: do not let a single/ambiguous
// address silently become the billing customer address. This is intentionally
// conservative and uses only existing fields (needsReview/reviewReasons) so no
// schema migration and no customer-merge code change is required.
function hasExplicitBillingAddressDirectiveV17_61(
  rawText: string | null | undefined,
): boolean {
  const text = normalizeUnitText(rawText || "");
  if (!text) return false;

  if (
    /\b(?:rechnungsadresse|rechnungskunde|rechnungsempfaenger|rechnungsempfänger|rechnung\s+(?:geht\s+)?an|rechnung\s+(?:fuer|für)|rechnung\s+bekommt|auftraggeber|besteller|zahler|facturation|billing\s+address|billing\s+customer|invoice\s+address|invoice\s+customer|invoice|bill\s+to)\b/.test(
      text,
    )
  ) {
    return true;
  }

  // V17.90L80: Messages often omit "an" and put the complete billing
  // address directly after "Rechnung". Accept only a bounded, complete
  // street + Swiss PLZ/city block; a bare company name is not enough.
  return /\b(?:rechnung|facture|fattura|factura)\s*:?\s+[^\n.]{0,150}\b[\p{L}][\p{L}'’\- ]{1,55}(?:strasse|straße|weg|gasse|platz|allee|rain|quai)\s+\d+[a-z]?\b[^\n.]{0,70}\b\d{4}\s+[\p{L}][\p{L}'’\-]{1,40}\b/iu.test(
    String(rawText || ""),
  );
}

function hasExecutionAddressDirectiveV17_61(
  rawText: string | null | undefined,
): boolean {
  const text = normalizeUnitText(rawText || "");
  if (!text) return false;

  return /\b(?:ausfuehrungsadresse|ausführungsadresse|ausfuehrungsort|ausführungsort|arbeitsort|arbeitsadresse|einsatzort|baustelle|objektadresse|objekt|leistungsadresse|serviceadresse|job\s+site|work\s+site|work\s+address|service\s+address|adresse\s+de\s+travail|lieu\s+d\s+intervention|lieu\s+d['’]?intervention)\b/.test(
    text,
  );
}

function hasSameAddressInstructionV17_90L28(
  rawText: string | null | undefined,
): boolean {
  const text = normalizeUnitText(rawText || "");
  if (!text) return false;

  return /\b(?:gleiche[nrms]?\s+adresse|(?:an\s+)?(?:der\s+)?(?:selben|selber|selbe|derselben|dieselben|dieselbe)\s+adresse|adresse\s+(?:ist\s+)?gleich|rechnungs(?:adresse)?\s*(?:(?:-|\/)\s*)*(?:und\s+)?ausfuehrungsadresse|rechnungs(?:adresse)?\s*(?:(?:-|\/)\s*)*(?:und\s+)?ausführungsadresse|billing(?:\s+address)?\s*(?:(?:-|\/)\s*)*(?:and\s+)?execution\s+address|same\s+address|stessa\s+indirizzo|meme\s+adresse|même\s+adresse|gleicher\s+ort|same\s+place)\b/.test(text);
}

function sameAddressWorkAreaDescriptorV17_66(
  rawText: string | null | undefined,
): string | null {
  const source = String(rawText || "");
  if (!source.trim()) return null;
  const original = source.split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i)[0] || "";
  const translated = source
    .split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  const candidates = [translated, original].filter(Boolean);
  const sameAddressTail =
    String.raw`(?:gleiche[nrms]?\s+adresse|(?:an\s+)?(?:der\s+)?(?:selben|selber|selbe|derselben|dieselben|dieselbe)\s+adresse|adresse\s+(?:ist\s+)?gleich|same\s+(?:street\s+)?address|m[eê]me\s+adresse|stesso\s+indirizzo)`;
  const workMarker =
    String.raw`(?:arbeitsbereich|work\s+area|zone\s+de\s+travail|area\s+di\s+lavoro|die\s+arbeit(?:en)?|ausf(?:ü|ue)hrung|arbeitsort|einsatzort)`;
  const stopMarker =
    /^(?:kontakt|contact|vor[-\s]?ort|onsite|leistungen?|services?|termin|appointment|zugang|access|schl[uü]ssel|key|park|gefahr|achtung|invoice|rechnung|rechnungsadresse)\b/i;
  const stripSameAddressRoleTextV17_90L194 = (value: string): string =>
    String(value || "")
      .replace(
        new RegExp(
          String.raw`(?:^|[,;])\s*${sameAddressTail}\s*(?:,|aber|jedoch|und)?\s*`,
          "i",
        ),
        " ",
      )
      .replace(
        new RegExp(
          String.raw`^.*?${sameAddressTail}\s*(?:,|aber|jedoch|und)?\s*`,
          "i",
        ),
        "",
      )
      .replace(/[\s,;:\-–—]+$/g, "")
      .replace(/^\s*(?:im|in|am|an|bei|beim)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();

  for (const candidateSource of candidates) {
    const lines = String(candidateSource)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/g)
      .map((line) => compactText(line))
      .filter(Boolean);
    const normalizedCandidate = normalizeUnitText(candidateSource);
    if (!new RegExp(sameAddressTail, "i").test(normalizedCandidate)) continue;

    // Labelled multi-line block, e.g. "Work area:" followed by rooms.
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const markerMatch = line.match(new RegExp(`^${workMarker}\\s*(?:ist|:|-)?\\s*(.*)$`, "i"));
      if (!markerMatch) continue;
      const descriptors: string[] = [];
      if (markerMatch[1]) {
        const descriptor = stripSameAddressRoleTextV17_90L194(markerMatch[1]);
        if (descriptor) descriptors.push(descriptor);
      }
      for (let offset = 1; offset <= 6; offset += 1) {
        const next = lines[index + offset];
        if (!next || stopMarker.test(next)) break;
        if (parseBillingStreetLine(next) || parseBillingPlzCityFromLine(next).plz) break;
        descriptors.push(next);
      }
      const cleaned = compactRepeatedExecutionSiteDescriptorsV17_48(
        descriptors
          .map((value) => cleanExecutionSiteNameCandidate(value))
          .filter((value): value is string => Boolean(value)),
      ).slice(0, 5);
      if (cleaned.length > 0) return cleaned.join(", ");
    }

    // Inline sentence, e.g. "Arbeitsbereich ist das 2. Obergeschoss, ...".
    const sentenceLines = String(candidateSource)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+|(?<=[.!?])\s+/g)
      .map((line) => compactText(line))
      .filter(Boolean);
    for (const line of sentenceLines) {
      const inlineWork = line.match(new RegExp(`${workMarker}\\s*(?:ist|sind|:|-)?\\s*(.+)$`, "i"));
      if (inlineWork?.[1]) {
        const inlineSource = String(inlineWork[1] || "");
        const descriptor = cleanExecutionSiteNameCandidate(
          stripSameAddressRoleTextV17_90L194(inlineSource),
        );
        if (descriptor) return descriptor;
      }
      if (!new RegExp(sameAddressTail, "i").test(normalizeUnitText(line))) continue;
      const afterSameAddress = line.match(
        new RegExp(
          String.raw`${sameAddressTail}\s*(?:,|aber|jedoch|und)?\s*(.+?)(?=\b(?:kontakt|leistungen?|schluessel|schlüssel|termin|sms|whatsapp|telefon|anfahrt|fahrt|$))`,
          "i",
        ),
      );
      const descriptor = cleanExecutionSiteNameCandidate(
        String(afterSameAddress?.[1] || "")
          .replace(/[,:;\-–—]+\s*$/g, "")
          .trim(),
      );
      if (descriptor) return descriptor;
    }
  }
  return null;
}

function hasAddressEvidenceInTextV17_61(
  rawText: string | null | undefined,
): boolean {
  const source = normalizeIntakeSourceText(rawText);
  if (!source) return false;

  const lines = splitIntakeLines(source);
  const windows: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    windows.push(lines[index]);
    if (lines[index + 1]) windows.push(`${lines[index]}\n${lines[index + 1]}`);
    if (lines[index + 2])
      windows.push(`${lines[index]}\n${lines[index + 1]}\n${lines[index + 2]}`);
  }

  return windows.some((candidate) => {
    const street = parseBillingStreetLine(candidate);
    const city = parseBillingPlzCityFromBlock(candidate);
    return Boolean(street || (city.plz && city.city));
  });
}

function shouldQuarantineBillingAddressRoleV17_61(args: {
  rawText: string | null | undefined;
  billingEvidence: SafeBillingCustomerEvidence;
  billingName?: string | null;
  billingStreet?: string | null;
  billingPlz?: string | null;
  billingCity?: string | null;
}): { quarantine: boolean; reviewReasons: string[] } {
  const hasPersistedAddressCandidate = Boolean(
    args.billingStreet || args.billingPlz || args.billingCity,
  );
  const hasFullAddressCandidate = Boolean(
    args.billingStreet && args.billingPlz && args.billingCity,
  );
  const hasAddressEvidence = hasAddressEvidenceInTextV17_61(args.rawText);

  if (!hasPersistedAddressCandidate && !hasAddressEvidence) {
    return { quarantine: false, reviewReasons: [] };
  }

  const hasExplicitBillingMarker = hasExplicitBillingAddressDirectiveV17_61(
    args.rawText,
  );
  const hasExecutionMarker = hasExecutionAddressDirectiveV17_61(args.rawText);
  const hasSameAddressInstruction = hasSameAddressInstructionV17_90L28(
    args.rawText,
  );
  const hasUsableBillingName = Boolean(
    cleanAiStructuredBillingName(args.billingName || null),
  );

  // V17.90L28: "gleiche Adresse / same address" is not an ambiguous second
  // address. Keep the billing address and allow room/site labels such as
  // "Trainingsraum hinten" without opening Adresse prüfen.
  if (hasSameAddressInstruction && hasFullAddressCandidate && hasUsableBillingName) {
    return { quarantine: false, reviewReasons: [] };
  }

  // V17.90L198: A complete, line-local and confidence-backed AI billing block
  // is already the canonical customer result. A later execution-address marker
  // may not erase it. Genuine uncertainty still remains fail-closed below.
  if (
    args.billingEvidence.hasReliableCustomerBlock &&
    hasFullAddressCandidate &&
    hasUsableBillingName
  ) {
    return { quarantine: false, reviewReasons: [] };
  }

  const reviewReasons: string[] = [];

  if (
    hasAddressEvidence &&
    !args.billingEvidence.hasReliableCustomerBlock &&
    !hasExplicitBillingMarker
  ) {
    reviewReasons.push("address_role_uncertain");
  }

  if (hasExecutionMarker && !hasExplicitBillingMarker) {
    reviewReasons.push("address_role_uncertain");
  }

  const onlyAddressWithoutSafeName =
    hasFullAddressCandidate &&
    !hasUsableBillingName &&
    !hasExplicitBillingMarker;
  if (onlyAddressWithoutSafeName) {
    reviewReasons.push("address_role_uncertain");
  }

  const clearBillingAddress = Boolean(
    hasPersistedAddressCandidate &&
    !hasExplicitBillingMarker &&
    (hasExecutionMarker || onlyAddressWithoutSafeName),
  );

  if (clearBillingAddress) {
    reviewReasons.push("customer_address_quarantined_ambiguous_role_v17_61");
  }

  return {
    quarantine: clearBillingAddress,
    reviewReasons: Array.from(new Set(reviewReasons)),
  };
}

function extractSafeBillingCustomerEvidence(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence {
  const source = normalizeIntakeSourceText(rawText);
  const empty: SafeBillingCustomerEvidence = {
    source: "none",
    hasReliableCustomerBlock: false,
    name: null,
    street: null,
    plz: null,
    city: null,
    phone: null,
    email: null,
  };
  if (!source) return empty;

  const lines = splitIntakeLines(source);
  const labeledBlock = extractLabeledBillingBlock(lines);
  const inlineBlock = extractInlineBillingBlock(source);
  const topBlock = extractTopBillingBlock(lines);

  const block = labeledBlock || inlineBlock || topBlock;
  if (!block) return empty;

  const name = parseBillingNameFromBlock(block);
  const street = parseBillingStreetFromBlock(block);
  const { plz, city } = parseBillingPlzCityFromBlock(block);
  const phone = extractPhoneFromText(block);
  const email = extractEmailFromText(block);
  const hasCompany =
    /\b(?:ag|gmbh|sarl|sa|s\.?a\.?|ltd\.?|limited|inc\.?|kg|kgaa|verein|stiftung)\b/i.test(
      name || "",
    );
  const hasAddress = Boolean(street || (plz && city));
  const hasFullAddress = Boolean(street && plz && city);
  const hasPartialAddressWithPhone = Boolean(
    (street || (plz && city)) && phone,
  );
  const hasPartialAddressWithEmail = Boolean(
    (street || (plz && city)) && email,
  );

  const sourceKind: SafeBillingCustomerEvidence["source"] = labeledBlock
    ? "labeled"
    : inlineBlock
      ? "inline"
      : "top";
  const hasReliableCustomerBlock = Boolean(
    (name &&
      ((sourceKind === "top" && (hasCompany || hasAddress)) ||
        (sourceKind !== "top" && (hasCompany || hasAddress || phone)))) ||
    // Explizit gelabelte Rechnungsadresse ohne Name:
    // Adresse/Telefon übernehmen, aber weiterhin Kunde prüfen erzwingen.
    (sourceKind !== "top" &&
      !name &&
      (hasFullAddress ||
        hasPartialAddressWithPhone ||
        hasPartialAddressWithEmail)),
  );

  return {
    source: sourceKind,
    hasReliableCustomerBlock,
    name: hasReliableCustomerBlock ? name : null,
    street: hasReliableCustomerBlock ? street : null,
    plz: hasReliableCustomerBlock ? plz : null,
    city: hasReliableCustomerBlock ? city : null,
    phone: hasReliableCustomerBlock ? phone : null,
    email: hasReliableCustomerBlock ? email : null,
  };
}

function directNamelessBillingAddressToEvidence(
  value: ReturnType<typeof extractDirectNamelessBillingAddressV1637>,
): SafeBillingCustomerEvidence | null {
  if (!value) return null;
  const hasAnyBillingData = Boolean(
    value.street || value.plz || value.city || value.phone || value.email,
  );
  if (!hasAnyBillingData) return null;

  return {
    source: "labeled",
    hasReliableCustomerBlock: true,
    name: null,
    street: value.street || null,
    plz: value.plz || null,
    city: value.city || null,
    phone: value.phone || null,
    email: value.email || null,
  };
}

function billingEvidenceValuesCompatible(
  primary?: string | null,
  fallback?: string | null,
): boolean {
  const a = normalizeUnitText(primary || "");
  const b = normalizeUnitText(fallback || "");
  return !a || !b || a === b;
}

function billingEvidenceAddressCompatible(
  primary: SafeBillingCustomerEvidence,
  fallback: SafeBillingCustomerEvidence,
): boolean {
  return (
    billingEvidenceValuesCompatible(primary.street, fallback.street) &&
    billingEvidenceValuesCompatible(primary.plz, fallback.plz) &&
    billingEvidenceValuesCompatible(primary.city, fallback.city)
  );
}

function extractDeterministicBillingEvidence(
  rawText: string | null | undefined,
): SafeBillingCustomerEvidence | null {
  const hardEvidence = extractHardLabeledBillingAddressEvidenceV1634(rawText);
  if (hardEvidence?.hasReliableCustomerBlock) return hardEvidence;

  const directEvidence = directNamelessBillingAddressToEvidence(
    extractDirectNamelessBillingAddressV1637(rawText),
  );
  if (directEvidence?.hasReliableCustomerBlock) return directEvidence;

  const safeEvidence = extractSafeBillingCustomerEvidence(rawText);
  return safeEvidence.hasReliableCustomerBlock ? safeEvidence : null;
}

function supplementAiBillingEvidence(
  aiEvidence: SafeBillingCustomerEvidence,
  fallbackEvidence: SafeBillingCustomerEvidence | null,
): SafeBillingCustomerEvidence {
  if (!fallbackEvidence?.hasReliableCustomerBlock) return aiEvidence;
  if (!aiEvidence.hasReliableCustomerBlock) return fallbackEvidence;
  if (!billingEvidenceAddressCompatible(aiEvidence, fallbackEvidence))
    return aiEvidence;

  return {
    ...aiEvidence,
    hasReliableCustomerBlock: true,
    name: aiEvidence.name || fallbackEvidence.name || null,
    street: aiEvidence.street || fallbackEvidence.street || null,
    plz: aiEvidence.plz || fallbackEvidence.plz || null,
    city: aiEvidence.city || fallbackEvidence.city || null,
    phone: aiEvidence.phone || fallbackEvidence.phone || null,
    email: aiEvidence.email || fallbackEvidence.email || null,
  };
}

function cleanIntakeCityCandidate(
  value: string | null | undefined,
): string | null {
  const city = String(value || "")
    .replace(/^\s*(?:in|im|bei|am)\s+/i, "")
    .replace(
      /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
      "",
    )
    // V17.90L41: Operative Satzfortsetzungen wie
    // "Zürich bitte zuerst beim Empfang melden" dürfen nicht als Ort
    // gespeichert werden. Nur der Ortsanteil vor der Anweisung bleibt.
    .replace(
      /\s+\b(?:bitte|zuerst|vorher|danach|anschliessend|anschließend|nachher|erst\s+noch)\b.*$/i,
      "",
    )
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!city || /^[-–—]+$/.test(city)) return null;
  if (/\b(?:beim|bei|am|an|im|in|zum|zur)\s*$/i.test(city)) return null;
  return city;
}

function cleanExecutionStreetCandidate(
  value: string | null | undefined,
): string | null {
  const raw = String(value || "")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(/^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i, "")
    .replace(
      /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!raw || /^[-–—]+$/.test(raw)) return null;

  const parsedStreet = parseBillingStreetLine(raw);
  return parsedStreet || raw;
}

function cleanExecutionSiteNameCandidate(
  value: string | null | undefined,
): string | null {
  let candidate = String(value || "")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .replace(
      /^\s*(?:ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|arbeitsort|auftragsort|uftragsort|objektadresse|einsatzort|ausführung|ausfuehrung|objekt)\s*:?\s*/i,
      "",
    )
    .replace(/^\s*(?:bei|beim|am|an|im|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i, "")
    // V17.90L206: A work-area phrase may arrive without its leading
    // preposition ("der Werkstatt und im Treppenhaus"). Remove only the
    // orphaned grammatical wrapper; the actual place nouns stay unchanged.
    .replace(
      /^\s*(?:der|die|das|dem|den)\s+(?=[\p{L}-]+(?:\s+[\p{L}-]+){0,5}\s+(?:und|sowie)\s+(?:im|in\s+der|in\s+den|am|auf\s+dem)\s+)/iu,
      "",
    )
    .replace(
      /\b(und|sowie)\s+(?:im|in\s+der|in\s+den|am|auf\s+dem)\s+/giu,
      "$1 ",
    )
    .replace(
      /^\s*um\s*\d{1,2}[:.]\d{2}\s+(?:uhr\s*)?(?:beim|bei|am|an|in)?\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;

  candidate = candidate
    .replace(/[,;]\s*(?:torcode|zugangscode|code)\b.*$/i, "")
    // V17.90L14: do not let communication fragments become part of the
    // execution-site name. Example: "Veloraum und Kellerflur, Nur" from
    // the following line "Nur SMS ..." must become "Veloraum und Kellerflur".
    .replace(
      /[,;]\s*(?:nur|bitte\s+nur|kein(?:e|en|em)?\s+(?:whats\s*app|whatsapp)|sms|whats\s*app|whatsapp|e[-\s]*mail|mail|telefon|tel\.?|anruf|rueckruf|ruckruf|kontakt)\b.*$/i,
      "",
    )
    .split(
      /[,;]\s*(?=(?:nur|bitte\s+nur|hund|dog|chien|perro|cane|torcode|zugangscode|code|tor\s+(?:bitte|geschlossen|schliessen|schließen|zu)|achtung|warnung|gefahr|schlüssel|schluessel|sms|whatsapp|telefon|nicht\s+einfach)\b)/i,
    )[0]
    .split(
      /\b(?:hinweise?|notes?|bemerkungen?|besonderheiten|bitte|please|nur|kein(?:e|en|em)?|keine|keinen|no|not|pas|sans|hund|dog|chien|perro|cane|kontakt|contact|contatto|contacter|melden|anrufen|whatsapp|sms|telefon|phone|kommen\s+sie|komm(?:en)?\s+erst|come\s+after|only\s+after|nur\s+nach|erst\s+nach|nicht\s+vor|guests?|gäste|auschecken|checkout)\b/i,
    )[0]
    .replace(/[,;:.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;
  // Telefonnummern sind Kontakt-Evidence und niemals Teil eines Objekt-/Ortsnamens.
  if (extractPhoneFromText(candidate)) return null;

  // Titel-Zeilen sind reine Auftrags-/Karten-Titel und niemals Objekt-/Ortsnamen.
  // Beispiel: "[Titel: Fenster Kontakt vor Ort]" darf nicht als Ausführungsadresse-Label gespeichert werden.
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return null;

  candidate = candidate
    .replace(
      /^\s*(?:um\s*)?\d{1,2}[:.]\d{2}\s*(?:uhr)?\s*(?:beim|bei|am|an|im|in)?\s*$/i,
      "",
    )
    .replace(/^\s*(?:beim|bei|am|an|im|in|um|uhr|m)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || /^[-–—]+$/.test(candidate)) return null;
  if (/^\s*\[?\s*(?:titel|title)\s*[:：].*\]?\s*$/i.test(candidate))
    return null;
  if (candidate.length < 3 || candidate.length > 80) return null;

  const normalized = normalizeUnitText(candidate);
  const blockedExact = new Set([
    "rechnungskunde",
    "rechnungsempfaenger",
    "rechnungsadresse",
    "kunde",
    "termin",
    "morgen",
    "heute",
    "bitte",
    "nadresse",
    "n adresse",
    "strasse",
    "straße",
    "street",
    "str",
  ]);
  if (blockedExact.has(normalized)) return null;

  const looksLikeOperationalOrSafetyInstruction =
    /\b(?:kein(?:e|en|em)?\s+(?:hund|tiere?|tier)|keine\s+tiere|hund\s+(?:vor\s+ort|befindet|ist|laeuft|läuft|frei|im)|dog\s+(?:is|runs|free)|chien|perro|cane|tor\s+(?:bitte|geschlossen|schliessen|schließen|zu)|tiere?\s+(?:im\s+gebaeude|im\s+gebäude|erlaubt|verboten)|ankunft|(?:beim|am|zum)\s+empfang|empfang\s+(?:schluessel|schlussel|schlüssel|key|code|kontakt|telefon)|anmelden|melden|nicht\s+einfach|vorher|zuerst|kontakt|whatsapp|sms|telefon|phone|schluessel|schlussel|schlüssel|code|zugang|hinweis|achtung|warnung|gefahr)\b/i.test(
      normalized,
    );

  if (looksLikeOperationalOrSafetyInstruction) return null;

  if (
    /^(?:um\s*\d|am\s*\d|es\s+geht\s+um|es\s+handelt\s+sich|zugang\s+(?:über|ueber)|bitte\b)/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (
    /\b(?:kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|vor\s+ort\s+(?:öffnet|oeffnet|ist|macht|kommt)|öffnet\s+|oeffnet\s+|hausdienst|hauswart|hausmeister|concierge|tel\.?|telefon|handy|natel)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }

  if (parseBillingStreetLine(candidate)) return null;
  if (parseBillingPlzCityFromLine(candidate).plz) return null;

  const looksLikeServiceOrPriceLine =
    /\b\d+(?:[.,]\d+)?\s*(?:stueck|stück|stk|quadratmeter|qm|m2|m²|meter|laufmeter|lfm|stunde|stunden|std\.?|h|tag|tage)\b/i.test(
      normalized,
    ) ||
    /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|preis|pauschal|pro|per|je)\b/i.test(
      normalized,
    );

  const hasServiceVerb =
    /\b(reinigen|reinigung|putzen|schneiden|entfernen|streichen|malen|montieren|demontieren|reparieren|liefern|entsorgen|spachteln|abdecken|anfahrt|fahrtkosten|fahrpauschale|wegpauschale)\b/i.test(
      normalized,
    );

  // Eine Leistungs-/Preiszeile oder reine Leistungszusammenfassung ist niemals
  // ein Objektname der Ausführungsadresse.
  // Beispiele: "Anfahrt CHF 45", "10 Fenster reinigen CHF 7 pro Stück",
  // "Fenster reinigen und Anfahrt".
  if (looksLikeServiceOrPriceLine) return null;
  if (hasServiceVerb) return null;

  return candidate;
}

function extractExecutionBlockFromText(
  rawText: string | null | undefined,
): string | null {
  const lines = splitIntakeLines(rawText);
  if (lines.length === 0) return null;

  const startRegex =
    /^\s*(?:(?:die\s+)?arbeiten\s+(?:werden\s+)?(?:an\s+einer\s+anderen\s+adresse\s+)?ausgef(?:ü|ue)hrt|(?:die\s+)?arbeit(?:en)?\s+(?:findet|finden|ist|sind)\s+(?:statt\s+)?(?:bei|beim|am|an|in|im)|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|arbeitsort|auftragsort|uftragsort|objektadresse|einsatzort|adresse\s+vor\s+ort|ausführung|ausfuehrung|objekt|ex[eé]cution|execution|esecuzione|usfuehrig|usfüehrig|arbeiten\s+(?:bitte\s+)?(?:bei|beim|in|im)|arbeit\s+(?:bitte\s+)?(?:bei|beim|in|im))\b\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:rechnung\s+an|rechnungskunde|rechnungsempfänger|rechnungsempfaenger|rechnungsadresse|kunde|auftraggeber|besteller|zahler|kontakt\s+vor\s+ort|person\s+vor\s+ort|vor\s+ort\b|zugang|besonderheiten|bemerkungen|leistungen|leistungsübersicht|leistungsuebersicht|termin|titel|title)\s*:?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(startRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 6; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (block) return block;
  }

  return null;
}

function repairExecutionStreetFromText(args: {
  rawText: string | null | undefined;
  currentStreet: string | null;
  siteName: string | null;
  sitePlz: string | null;
  siteCity: string | null;
}): string | null {
  if (args.currentStreet) return args.currentStreet;

  const executionBlock = extractExecutionBlockFromText(args.rawText);
  const blockStreet = executionBlock
    ? parseBillingStreetFromBlock(executionBlock)
    : null;
  if (blockStreet) return blockStreet;

  const source = normalizeIntakeSourceText(args.rawText);
  if (!source) return null;

  const name = args.siteName ? escapeRegExpLocal(args.siteName) : null;
  const city = args.siteCity ? escapeRegExpLocal(args.siteCity) : null;
  const plz = args.sitePlz ? escapeRegExpLocal(args.sitePlz) : null;

  const windows: string[] = [];
  if (name) {
    const match = source.match(new RegExp(`.{0,120}${name}.{0,180}`, "i"));
    if (match?.[0]) windows.push(match[0]);
  }
  if (plz || city) {
    const marker = [plz, city].filter(Boolean).join("\\s+");
    const match = source.match(new RegExp(`.{0,180}${marker}.{0,80}`, "i"));
    if (match?.[0]) windows.push(match[0]);
  }

  for (const windowText of windows) {
    const street = parseBillingStreetLine(windowText);
    if (street) return street;
  }

  return null;
}

function restoreExecutionStreetLeadingCharacterV17_90L229(args: {
  currentStreet?: string | null;
  originalText?: string | null;
  translatedText?: string | null;
}): string | null {
  const currentStreet = cleanExecutionStreetCandidate(args.currentStreet);
  if (!currentStreet) return currentStreet;
  const currentKey = normalizeUnitText(currentStreet).replace(/\s+/g, " ").trim();
  const currentHouseNumber = currentStreet.match(/\b\d+[a-z]?\b/i)?.[0] || "";
  if (!currentKey || !currentHouseNumber) return currentStreet;

  // V17.90L231: WhatsApp normalization may flatten the complete message into
  // one line. In that case parseBillingStreetLine can return the first billing
  // street and never expose the later execution street. Search first for the
  // exact current street with precisely one Unicode letter directly in front.
  // This is a one-character evidence repair only; it cannot replace the street
  // with a different address or change the house number.
  const directMatches = [args.originalText, args.translatedText]
    .flatMap((source) => {
      const rawSource = String(source || "");
      if (!rawSource) return [] as string[];
      const pattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])([\\p{L}]${escapeRegExpLocal(currentStreet)})(?=$|[^\\p{L}\\p{N}])`,
        "giu",
      );
      return Array.from(rawSource.matchAll(pattern))
        .map((match) =>
          String(match[1] || "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter((line): line is string => Boolean(line));
    })
    .filter((candidate) => {
      const candidateHouseNumber = candidate.match(/\b\d+[a-z]?\b/i)?.[0] || "";
      return candidateHouseNumber.toLowerCase() === currentHouseNumber.toLowerCase();
    });
  const uniqueDirectMatches = Array.from(
    new Map(
      directMatches.map((candidate) => [normalizeUnitText(candidate), candidate]),
    ).values(),
  );
  if (uniqueDirectMatches.length === 1) return uniqueDirectMatches[0];

  const candidates = [args.originalText, args.translatedText]
    .flatMap((source) =>
      String(source || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+|(?<=[.!?])\s+/g),
    )
    .map((line) => parseBillingStreetLine(line) || cleanExecutionStreetCandidate(line))
    .filter((line): line is string => Boolean(line));

  const matches = candidates.filter((candidate) => {
    const candidateKey = normalizeUnitText(candidate).replace(/\s+/g, " ").trim();
    const candidateHouseNumber = candidate.match(/\b\d+[a-z]?\b/i)?.[0] || "";
    return Boolean(
      candidateKey &&
        candidateHouseNumber.toLowerCase() === currentHouseNumber.toLowerCase() &&
        candidateKey.length === currentKey.length + 1 &&
        candidateKey.endsWith(currentKey),
    );
  });
  const unique = Array.from(
    new Map(matches.map((candidate) => [normalizeUnitText(candidate), candidate])).values(),
  );
  return unique.length === 1 ? unique[0] : currentStreet;
}

function compactRepeatedExecutionSiteDescriptorsV17_48(
  descriptors: string[],
): string[] {
  const uniqueDescriptors = Array.from(
    new Map(
      descriptors.map((line) => [normalizeUnitText(line), line]),
    ).values(),
  ).slice(0, 3);

  if (uniqueDescriptors.length < 2) return uniqueDescriptors;

  const splitDescriptors = uniqueDescriptors.map((line) => {
    const parts = line
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      original: line,
      head: parts[0] || "",
      tail: parts.slice(1).join(", "),
    };
  });

  const firstHeadKey = normalizeUnitText(splitDescriptors[0]?.head || "");
  const allSameHead = Boolean(
    firstHeadKey &&
    splitDescriptors.every(
      (entry) =>
        normalizeUnitText(entry.head) === firstHeadKey && Boolean(entry.tail),
    ),
  );

  if (!allSameHead) return uniqueDescriptors;

  const tails = Array.from(
    new Map(
      splitDescriptors.map((entry) => [
        normalizeUnitText(entry.tail),
        entry.tail,
      ]),
    ).values(),
  );

  if (tails.length < 2) return uniqueDescriptors;

  const joinedTails =
    tails.length === 2
      ? `${tails[0]} und ${tails[1]}`
      : `${tails.slice(0, -1).join(", ")} und ${tails[tails.length - 1]}`;

  return [`${splitDescriptors[0].head}, ${joinedTails}`];
}

function extractLikelyOriginalProperSitePhrasesV17_49(
  value: string | null | undefined,
): string[] {
  const text = String(value || "");
  if (!text.trim()) return [];

  const phrases = new Set<string>();
  const phrasePattern =
    /\b[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*(?:\s+[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*){1,4}\b/gu;
  for (const match of text.matchAll(phrasePattern)) {
    const phrase = match[0].replace(/\s+/g, " ").trim();
    if (phrase.length < 5) continue;
    // Pure all-caps short tokens are usually IDs, not object names.
    if (/^[A-Z0-9\s.-]{2,8}$/.test(phrase)) continue;
    phrases.add(phrase);
  }

  return Array.from(phrases);
}

function escapeRegExpV17_50(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function originalExecutionSiteDescriptorFromTextV17_50(
  rawText: string | null | undefined,
): string | null {
  const originalPart =
    String(rawText || "").split(
      /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
    )[0] || "";
  const executionBlock = extractExecutionBlockFromText(originalPart);
  if (!executionBlock) return null;

  for (const rawLine of splitIntakeLines(executionBlock)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (parseBillingStreetLine(line)) break;
    if (parseBillingPlzCityFromLine(line).plz) break;
    const candidate = cleanExecutionSiteNameCandidate(line);
    if (candidate) return candidate;
  }

  return null;
}

function preserveOriginalProperSitePhraseV17_50(args: {
  translatedSiteName: string | null | undefined;
  rawText: string | null | undefined;
}): string | null {
  const translated = compactText(args.translatedSiteName);
  if (!translated) return null;

  const originalDescriptor = originalExecutionSiteDescriptorFromTextV17_50(
    args.rawText,
  );
  if (!originalDescriptor) return translated;

  const translatedKey = normalizeUnitText(translated);
  const properPhrases =
    extractLikelyOriginalProperSitePhrasesV17_49(originalDescriptor);

  for (const phrase of properPhrases) {
    const phraseClean = compactText(phrase);
    const phraseKey = normalizeUnitText(phraseClean);
    if (!phraseClean || phraseKey.length < 5) continue;
    if (translatedKey.includes(phraseKey)) return translated;

    const phraseParts = phraseClean.split(/\s+/g).filter(Boolean);
    const tail = phraseParts.slice(1).join(" ").trim();
    if (tail.length < 4) continue;

    const tailRe = new RegExp(
      `(^|,\\s*)[^,]{0,60}\\b${escapeRegExpV17_50(tail)}\\b`,
      "i",
    );
    if (tailRe.test(translated)) {
      return translated
        .replace(tailRe, (_match, prefix) => `${prefix || ""}${phraseClean}`)
        .replace(/\s+/g, " ")
        .replace(/\s+,/g, ",")
        .trim();
    }
  }

  return translated;
}

function trimExecutionSiteNameToExplicitDescriptorV17_90L16(args: {
  siteName: string | null | undefined;
  rawText: string | null | undefined;
}): string | null {
  const current = cleanExecutionSiteNameCandidate(args.siteName);
  if (!current) return null;

  // AI-first guard: The execution-site name must be supported by the explicit
  // execution-address block itself. If the AI appended the next note line to
  // the site name, replace the name with the descriptor line directly before
  // the street/postcode in the original/translated execution block. This is a
  // block/evidence-boundary check, not a service or hazard word list.
  const descriptors = [
    originalExecutionSiteDescriptorFromTextV17_50(args.rawText),
    translatedExecutionSiteNameCandidateFromTextV17_45(args.rawText),
  ]
    .map((value) => cleanExecutionSiteNameCandidate(value))
    .filter((value): value is string => Boolean(value));

  const currentKey = normalizeUnitText(current);
  for (const descriptor of descriptors) {
    const descriptorKey = normalizeUnitText(descriptor);
    if (!descriptorKey) continue;
    if (
      currentKey === descriptorKey ||
      currentKey.startsWith(`${descriptorKey} `) ||
      currentKey.includes(descriptorKey) ||
      (descriptorKey.includes(currentKey) &&
        descriptorKey.length >= currentKey.length + 4)
    ) {
      return descriptor;
    }
  }

  return current;
}

function translatedSiteNameWouldDropOriginalProperNameV17_49(args: {
  currentSiteName: string | null | undefined;
  translatedSiteName: string | null | undefined;
  rawText: string | null | undefined;
}): boolean {
  const current = compactText(args.currentSiteName);
  const translated = compactText(args.translatedSiteName);
  if (!current || !translated) return false;

  const originalPart =
    String(args.rawText || "").split(
      /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
    )[0] || "";
  const originalBlock =
    extractExecutionBlockFromText(originalPart) || originalPart;
  const originalBlockKey = normalizeUnitText(originalBlock);
  const translatedKey = normalizeUnitText(translated);

  for (const phrase of extractLikelyOriginalProperSitePhrasesV17_49(current)) {
    const phraseKey = normalizeUnitText(phrase);
    if (!phraseKey || phraseKey.length < 5) continue;
    if (!originalBlockKey.includes(phraseKey)) continue;
    if (!translatedKey.includes(phraseKey)) return true;
  }

  return false;
}

function translatedExecutionSiteNameCandidateFromTextV17_45(
  rawText: string | null | undefined,
): string | null {
  const translated = String(rawText || "")
    .split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  const executionBlock = extractExecutionBlockFromText(translated || rawText);
  if (!executionBlock) return null;

  const descriptors: string[] = [];
  for (const rawLine of splitIntakeLines(executionBlock)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (parseBillingStreetLine(line)) break;
    if (parseBillingPlzCityFromLine(line).plz) break;
    const candidate = cleanExecutionSiteNameCandidate(line);
    if (candidate) descriptors.push(candidate);
  }

  const uniqueDescriptors = compactRepeatedExecutionSiteDescriptorsV17_48(
    descriptors,
  ).slice(0, 2);

  if (uniqueDescriptors.length === 0) return null;
  return preserveOriginalProperSitePhraseV17_50({
    translatedSiteName: uniqueDescriptors.join(", "),
    rawText,
  });
}

function shouldReplaceExecutionSiteNameWithTranslatedV17_45(args: {
  currentSiteName: string | null;
  translatedSiteName: string | null;
  rawText: string | null | undefined;
}): boolean {
  const current = normalizeUnitText(args.currentSiteName || "");
  const translated = normalizeUnitText(args.translatedSiteName || "");
  if (!current || !translated || current === translated) return false;

  const translatedBlock = String(args.rawText || "")
    .split(/---\s*Übersetzung\s*\(automatisch\)\s*---/i)
    .slice(1)
    .join("\n");
  if (!translatedBlock) return false;
  if (!normalizeUnitText(translatedBlock).includes(translated)) return false;

  if (
    translatedSiteNameWouldDropOriginalProperNameV17_49({
      currentSiteName: args.currentSiteName,
      translatedSiteName: args.translatedSiteName,
      rawText: args.rawText,
    })
  ) {
    return false;
  }

  // Replace raw-language site labels with the clean translated object label.
  // This is not a room-word mapping; the translated execution block itself is
  // used as evidence.
  const translatedIsMoreSpecific =
    translated.length >= current.length + 4 &&
    (translated.includes(current) ||
      current
        .split(/\s+/g)
        .filter((token) => token.length >= 2)
        .every((token) => translated.includes(token)));

  return (
    !normalizeUnitText(translatedBlock).includes(current) ||
    translatedIsMoreSpecific ||
    /\b(?:locale|ufficio|sala|room|staff|laundry|stairwell|work\s*site)\b/i.test(
      current,
    )
  );
}

function repairExecutionSiteNameFromText(args: {
  rawText: string | null | undefined;
  currentSiteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
}): string | null {
  const executionBlock = extractExecutionBlockFromText(args.rawText);
  if (!executionBlock) return args.currentSiteName;

  const siteAddressKey = normalizeUnitText(args.siteAddress || "");
  const sitePlz = String(args.sitePlz || "").trim();
  const descriptors: string[] = [];

  for (const rawLine of splitIntakeLines(executionBlock)) {
    const cleanedLine = rawLine.replace(/\s+/g, " ").trim();
    if (!cleanedLine) continue;

    const parsedStreet = parseBillingStreetLine(cleanedLine);
    if (parsedStreet) {
      const beforeStreet = cleanedLine
        .replace(new RegExp(`${escapeRegExpLocal(parsedStreet)}.*$`, "i"), "")
        .replace(/[,:;\-–—]+$/g, "")
        .trim();
      const safePrefix = cleanExecutionSiteNameCandidate(beforeStreet);
      if (safePrefix) descriptors.push(safePrefix);
      continue;
    }

    const candidate = cleanExecutionSiteNameCandidate(cleanedLine);
    if (!candidate) continue;
    if (parseBillingPlzCityFromLine(candidate).plz) continue;
    if (sitePlz && candidate.includes(sitePlz)) continue;
    if (siteAddressKey && normalizeUnitText(candidate) === siteAddressKey)
      continue;
    descriptors.push(candidate);
  }

  const uniqueDescriptors = Array.from(
    new Map(
      descriptors.map((line) => [normalizeUnitText(line), line]),
    ).values(),
  ).slice(0, 2);

  const explicitDescriptor =
    uniqueDescriptors.length > 0 ? uniqueDescriptors.join(", ") : null;
  if (!args.currentSiteName) return explicitDescriptor;
  if (!explicitDescriptor) return args.currentSiteName;

  const currentKey = normalizeUnitText(args.currentSiteName);
  const explicitKey = normalizeUnitText(explicitDescriptor);
  if (
    currentKey &&
    explicitKey.includes(currentKey) &&
    explicitKey.length >= currentKey.length + 4
  ) {
    return explicitDescriptor;
  }

  return args.currentSiteName;
}


// V17.90L84: "Empfang" kann ein echter Teil des Objekt-/Bereichsnamens sein
// (z. B. "Konferenzraum und Empfang"). Nur ein klarer Zugangskontext am
// Empfang beendet den Adress-/Objektblock.
const EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39 =
  /\b(?:schlüssel|schluessel|schlussel|key|zugang|zutritt|eingang|vor\s+ort|rezeption|reception|(?:beim|am|zum)\s+empfang|empfang\s+(?:schlüssel|schluessel|schlussel|key|code|kontakt|telefon)|concierge|hauswart|hausmeister|code|torcode|zugangscode|schlüsselbox|schluesselbox|briefkasten|parkieren|parken|parkplatz|parking|termin|datum|uhrzeit|kontakt(?:person)?|ansprechperson|telefon|tel\.?|handy|natel|whatsapp|sms|e-?mail)\b/i;

function stripExecutionOperationalTailV17_90L39(
  value?: string | null,
): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match = text.match(EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39);
  if (!match || match.index == null) return text;
  const cleaned = text
    .slice(0, match.index)
    .replace(/[,;:\-–—\s]+$/g, "")
    .trim();
  return cleaned || null;
}

function isExecutionOperationalHintV17_90L39(
  value?: string | null,
): boolean {
  return EXECUTION_ADDRESS_OPERATIONAL_BOUNDARY_V17_90L39.test(
    String(value || ""),
  );
}


function cleanExecutionSiteNoteV17_90L70(
  value?: string | null,
): string | null {
  const note = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "")
    .trim();
  if (!note || note.length > 120) return null;
  if (/\b(?:CHF|EUR|Fr\.?|Franken|Euro)\b/i.test(note)) return null;
  if (/\b(?:eingang|zugang|zutritt|empfang|rezeption|reception|tor|tuer|tür)\b/i.test(note)) {
    return note;
  }
  return stripExecutionOperationalTailV17_90L39(note);
}

function sanitizeExtractedExecutionAddress<
  T extends {
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    siteNote?: string | null;
  },
>(
  address: T | null | undefined,
  rawText: string | null | undefined,
  options?: { preservePopulatedAiFields?: boolean },
): T | null {
  if (!address) return null;

  const preservePopulatedAiFields = Boolean(options?.preservePopulatedAiFields);
  let siteName = cleanExecutionSiteNameCandidate(
    stripExecutionOperationalTailV17_90L39(address.siteName || null),
  );
  const siteCity = cleanIntakeCityCandidate(
    stripExecutionOperationalTailV17_90L39(address.siteCity || null),
  );
  let siteAddress = cleanExecutionStreetCandidate(
    stripExecutionOperationalTailV17_90L39(address.siteAddress || null),
  );

  if (!preservePopulatedAiFields) {
    siteAddress = repairExecutionStreetFromText({
      rawText,
      currentStreet: siteAddress,
      siteName,
      sitePlz: address.sitePlz || null,
      siteCity,
    });

    siteName = repairExecutionSiteNameFromText({
      rawText,
      currentSiteName: siteName,
      siteAddress,
      sitePlz: address.sitePlz || null,
      siteCity,
    });

    const translatedSiteName =
      translatedExecutionSiteNameCandidateFromTextV17_45(rawText);
    if (
      shouldReplaceExecutionSiteNameWithTranslatedV17_45({
        currentSiteName: siteName,
        translatedSiteName,
        rawText,
      })
    ) {
      siteName = translatedSiteName;
    }

    siteName = preserveOriginalProperSitePhraseV17_50({
      translatedSiteName: siteName,
      rawText,
    });

    siteName = trimExecutionSiteNameToExplicitDescriptorV17_90L16({
      siteName,
      rawText,
    });
  }

  // V17.90L6: after all repair/preserve passes, remove access/contact/safety
  // fragments again. They belong to Besonderheiten/chips, never to the
  // execution-address title.
  siteName = cleanExecutionSiteNameCandidate(siteName);

  const cleaned = {
    ...address,
    siteName,
    siteAddress,
    siteCity,
    // Ein kurzer Zugangshinweis bleibt separat erhalten, darf aber niemals
    // Strasse/PLZ/Ort verschmutzen.
    siteNote: cleanExecutionSiteNoteV17_90L70(address.siteNote),
  };

  if (
    !cleaned.siteName &&
    !cleaned.siteAddress &&
    !cleaned.sitePlz &&
    !cleaned.siteCity
  ) {
    return null;
  }

  return cleaned as T;
}

function applySafeBillingCustomerGuard(args: {
  kundeData: any;
  evidence: SafeBillingCustomerEvidence;
  allowSelfIntroName: boolean;
}): { changed: boolean; reviewReason: string | null } {
  const { kundeData, evidence, allowSelfIntroName } = args;
  const before = JSON.stringify({
    name: kundeData.name || null,
    strasse: kundeData.strasse || null,
    hausnummer: kundeData.hausnummer || null,
    plz: kundeData.plz || null,
    ort: kundeData.ort || null,
    telefon: kundeData.telefon || null,
    email: kundeData.email || null,
  });

  // V17.90L211 — PREPARED CANONICAL BOUNDARY
  // The structured AI object remains the source of truth. Deterministic billing
  // evidence may only hydrate a missing field (for example a masked phone/e-mail
  // or a split street), never clear or overwrite an already populated AI value.
  // Uncertainty is persisted separately as review metadata.
  const aiName = cleanBillingCustomerNameCandidate(kundeData.name || null);
  const evidenceName = cleanBillingCustomerNameCandidate(evidence.name || null);
  if (!aiName && allowSelfIntroName && evidenceName) kundeData.name = evidenceName;
  else if (!aiName && evidenceName) kundeData.name = evidenceName;

  if (!String(kundeData.strasse || "").trim() && evidence.street) {
    kundeData.strasse = evidence.street;
    kundeData.hausnummer = null;
  }
  if (!String(kundeData.plz || "").trim() && evidence.plz) {
    kundeData.plz = evidence.plz;
  }
  if (!String(kundeData.ort || "").trim() && evidence.city) {
    kundeData.ort = evidence.city;
  }
  if (!String(kundeData.telefon || "").trim() && evidence.phone) {
    kundeData.telefon = evidence.phone;
  }
  if (!String(kundeData.email || "").trim() && evidence.email) {
    kundeData.email = evidence.email;
  }

  const after = JSON.stringify({
    name: kundeData.name || null,
    strasse: kundeData.strasse || null,
    hausnummer: kundeData.hausnummer || null,
    plz: kundeData.plz || null,
    ort: kundeData.ort || null,
    telefon: kundeData.telefon || null,
    email: kundeData.email || null,
  });

  const hasCompletePreparedBilling = Boolean(
    cleanBillingCustomerNameCandidate(kundeData.name || null) &&
      String(kundeData.strasse || "").trim() &&
      String(kundeData.plz || "").trim() &&
      String(kundeData.ort || "").trim(),
  );

  return {
    changed: before !== after,
    reviewReason:
      !evidence.hasReliableCustomerBlock && !hasCompletePreparedBilling
        ? "customer_data_uncertain_no_billing_block"
        : null,
  };
}

type OnsiteContactChannel = "sms" | "whatsapp" | "call" | null;

type OnsiteContactHint = {
  hint: string | null;
  phone: string | null;
  phoneBelongsToSiteContact: boolean;
  contactName: string | null;
  preferredChannel: OnsiteContactChannel;
  noPhoneCall: boolean;
};

type AiOnsiteContactV17_90L86 = {
  vorhanden?: boolean | null;
  name?: string | null;
  telefon?: string | null;
  phone?: string | null;
  kanal?: string | null;
  channel?: string | null;
  nicht_anrufen?: boolean | null;
  no_phone_call?: boolean | null;
  evidence?: string | null;
};

type AiAppointmentV17_90L86 = {
  art?: string | null;
  type?: string | null;
  datum?: string | null;
  date?: string | null;
  von?: string | null;
  start?: string | null;
  bis?: string | null;
  end?: string | null;
  ankuendigung_minuten?: number | string | null;
  announcement_minutes?: number | string | null;
  ankuendigung_kanal?: string | null;
  announcement_channel?: string | null;
  tageszeit?: string | null;
  daypart?: string | null;
  // V17.90L271: The first AI stores the compact appointment phrase in the
  // configured working language. Evidence retains the exact original wording.
  zeitangabe_text?: string | null;
  time_phrase?: string | null;
  zeitangabe_status?: string | null;
  time_phrase_status?: string | null;
  evidence?: string | null;
};

function normalizePhoneDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

type PhoneMatchV17_90L85 = {
  phone: string;
  index: number;
  end: number;
};

function extractPhoneMatchFromTextV17_90L85(
  value: string | null | undefined,
): PhoneMatchV17_90L85 | null {
  const source = String(value || "");
  const pattern = /\+?\d[\d\s()./-]{6,}\d/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    const candidate = String(match[0] || "").replace(/\s+/g, " ").trim();
    if (!candidate) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(candidate)) continue;

    const digits = normalizePhoneDigits(candidate);
    // V17.90L194: Dates and address fragments must never become contact data.
    // A real auto-persisted phone requires at least nine digits.
    if (digits.length < 9 || digits.length > 15) continue;
    if (/^\d{1,2}[.:]\d{2}(?:\s*[-–]\s*\d{1,2}[.:]\d{2})?$/.test(candidate)) continue;

    return {
      phone: candidate,
      index: match.index || 0,
      end: (match.index || 0) + match[0].length,
    };
  }

  return null;
}

// V17.90L195: Customer and on-site phones are separate canonical roles.
// The billing phone is read only from the customer/billing prefix before the
// first execution-site, on-site-contact or appointment boundary. The whole
// message is never scanned for a fallback customer phone.
function extractCanonicalBillingPhoneV17_90L195(args: {
  rawText: string | null | undefined;
  aiBillingPhone?: string | null;
  onsitePhone?: string | null;
  onsiteContactName?: string | null;
}): string | null {
  const source = String(args.rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!source) return null;

  const boundaryPatterns = [
    /\b(?:ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsadresse|arbeitsort|einsatzadresse|einsatzort|baustelle|job\s*site|work\s*site|service\s*address|lieu\s+d[’']?intervention|luogo\s+d[’']?intervento|lugar\s+de\s+intervenci[oó]n)\b/i,
    /\b(?:kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner(?:in)?\s+vor\s+ort|vor\s+ort\s+(?:ist|kontakt|ansprech)|contact\s+sur\s+place|on[-\s]?site\s+contact|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i,
    /\b(?:putze\s+mues\s+mer|gereinigt\s+werden\s+muss|arbeit(?:en)?\s+(?:findet|finden)\s+.*?\bstatt)\b/i,
    /(?:^|\n)\s*(?:termin|zeitfenster|appointment|rendez[-\s]?vous|fecha|data)\s*[:\-–—]?/im,
  ];

  let boundary = source.length;
  for (const pattern of boundaryPatterns) {
    const match = pattern.exec(source);
    if (match && match.index >= 0) boundary = Math.min(boundary, match.index);
  }
  const billingPrefix = source.slice(0, boundary).trim();
  if (!billingPrefix) return null;

  const onsiteDigits = args.onsiteContactName
    ? normalizePhoneDigits(args.onsitePhone)
    : "";
  const candidates: Array<{ phone: string; index: number }> = [];
  const phonePattern = /\+?\d[\d\s()./-]{6,}\d/g;
  let match: RegExpExecArray | null;
  while ((match = phonePattern.exec(billingPrefix))) {
    const candidate = String(match[0] || "").replace(/\s+/g, " ").trim();
    const digits = normalizePhoneDigits(candidate);
    if (digits.length < 9 || digits.length > 15) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s|$)/.test(candidate)) continue;
    if (/\d{1,2}[.:]\d{2}/.test(candidate)) continue;
    if (onsiteDigits && digits === onsiteDigits) continue;
    candidates.push({ phone: candidate, index: match.index || 0 });
  }
  if (candidates.length === 0) return null;

  const aiDigits = normalizePhoneDigits(args.aiBillingPhone);
  if (aiDigits) {
    const supported = candidates.find(
      (candidate) => normalizePhoneDigits(candidate.phone) === aiDigits,
    );
    if (supported) return supported.phone;
  }

  // Billing blocks conventionally place the office phone after address data.
  // Pick the first valid phone in that bounded block; never the last number in
  // the full message.
  return candidates.sort((a, b) => a.index - b.index)[0]?.phone || null;
}

// V17.90L196: Billing e-mail follows the same strict role boundary as the
// billing phone. Operational/on-site text after the first role boundary is
// never used as a customer-master fallback.
function extractCanonicalBillingEmailV17_90L196(args: {
  rawText: string | null | undefined;
  aiBillingEmail?: string | null;
}): string | null {
  const source = String(args.rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!source) return null;

  const boundaryPatterns = [
    /\b(?:ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|arbeitsadresse|arbeitsort|einsatzadresse|einsatzort|baustelle|job\s*site|work\s*site|service\s*address|lieu\s+d[’']?intervention|luogo\s+d[’']?intervento|lugar\s+de\s+intervenci[oó]n)\b/i,
    /\b(?:kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner(?:in)?\s+vor\s+ort|vor\s+ort\s+(?:ist|kontakt|ansprech)|contact\s+sur\s+place|on[-\s]?site\s+contact|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i,
    /(?:^|\n)\s*(?:termin|zeitfenster|appointment|rendez[-\s]?vous|fecha|data)\s*[:\-–—]?/im,
  ];

  let boundary = source.length;
  for (const pattern of boundaryPatterns) {
    const match = pattern.exec(source);
    if (match && match.index >= 0) boundary = Math.min(boundary, match.index);
  }
  const billingPrefix = source.slice(0, boundary).trim();
  if (!billingPrefix) return null;

  const candidates = Array.from(
    billingPrefix.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
  )
    .map((match) => String(match[0] || "").trim())
    .filter(Boolean);
  if (candidates.length === 0) return null;

  const aiEmail = String(args.aiBillingEmail || "").trim().toLowerCase();
  if (aiEmail) {
    const supported = candidates.find(
      (candidate) => candidate.toLowerCase() === aiEmail,
    );
    if (supported) return supported;
  }

  return candidates[0] || null;
}

function canonicalizeStructuredRoleLinesV17_90L195(
  value: unknown,
  role: "access" | "parking" | "other",
): string[] {
  const sourceLines = extractProtectedStructuredRoleValuesV17_90L103(value)
    .flatMap((line) =>
      String(line || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+|[;]\s+|\s+[·|]\s+|(?=\b(?:Termin|Kontakt|Zugang|Zutritt|Eingang|Seiteneingang|Zufahrt|Schlüssel|Schluessel|Code|Parkieren|Parkplatz|Besucherplatz|Leiter)\b)/gi),
    )
    .map((line) =>
      line
        .replace(/^\s*\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*/i, "")
        .replace(/^\s*(?:Zugang|Parken|Parkierung|Hinweis)\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  const rolePattern =
    role === "access"
      ? /\b(?:schlüssel|schluessel|code|zutritt|zugang|eingang|empfang|schlüsselbox|schluesselbox|badge|tor)\b/i
      : role === "parking"
        ? /\b(?:parkieren|parken|parkplatz|besucherplatz|stellplatz|rampe)\b/i
        : /\b(?:leiter|stapler|maschine|material|mitbringen|vor\s+ort|flüssigkeiten|fluessigkeiten|ruhig|schlafen)\b/i;

  const rejectCrossRole = (line: string) => {
    if (role === "access") {
      return /^(?:termin|kontakt)\s*:/i.test(line) ||
        (/\b(?:anrufen|whatsapp|sms)\b/i.test(line) && !rolePattern.test(line));
    }
    if (role === "parking") return /^(?:termin|kontakt|zugang)\s*:/i.test(line);
    return /^(?:termin|kontakt|zugang|park(?:en|ierung))\s*:/i.test(line);
  };

  const selected = sourceLines
    .filter((line) => rolePattern.test(line) && !rejectCrossRole(line))
    .map((line) => line.replace(/^[,.:\-–—\s]+|[,.:\-–—\s]+$/g, "").trim())
    .filter(Boolean);

  if (role === "access") {
    const keyLineIndex = selected.findIndex((line) => /\b(?:schlüssel|schluessel)\b/i.test(line));
    const standaloneCodeIndex = selected.findIndex(
      (line) => /^code\s*[:#-]?\s*[A-Za-z0-9-]+$/i.test(line),
    );
    if (
      keyLineIndex >= 0 &&
      standaloneCodeIndex >= 0 &&
      keyLineIndex !== standaloneCodeIndex &&
      !/\bcode\b/i.test(selected[keyLineIndex])
    ) {
      selected[keyLineIndex] = `${selected[keyLineIndex]} · ${selected[standaloneCodeIndex]}`;
      selected.splice(standaloneCodeIndex, 1);
    }
  }

  // V17.90L196: Deduplicate role-local paraphrases, not only byte-identical
  // lines. Generic role words are removed from the comparison key while
  // location/number evidence remains, so e.g. "Besucherparkplatz B" and
  // "Parkplatz B reserviert" collapse, but parking places 5 and 6 stay
  // separate.
  const semanticRoleKeyV17_90L196 = (line: string) => {
    const normalized = normalizeSemanticText(line);
    if (!normalized) return "";

    const ignored =
      role === "parking"
        ? new Set([
            "parkieren",
            "parken",
            "parkplatz",
            "parkierung",
            "besucherplatz",
            "besucherparkplatz",
            "stellplatz",
            "lieferwagen",
            "fahrzeug",
            "reserviert",
            "reservation",
            "bitte",
            "ist",
            "der",
            "die",
            "das",
            "ein",
            "eine",
            "fuer",
            "für",
            "fur",
            "auf",
            "am",
            "an",
            "bei",
            "beim",
            "in",
            "zum",
            "zur",
          ])
        : role === "access"
          ? new Set([
              "zugang",
              "zutritt",
              "schluessel",
              "schlüssel",
              "code",
              "bitte",
              "ist",
              "der",
              "die",
              "das",
            ])
          : new Set(["hinweis", "bitte", "ist", "der", "die", "das"]);

    const tokens = normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => !ignored.has(token));
    return tokens.join(" ") || normalized;
  };

  const seenExact = new Set<string>();
  const seenSemantic: string[] = [];
  return selected.filter((line) => {
    const exactKey = normalizeSemanticText(line);
    const semanticKey = semanticRoleKeyV17_90L196(line);
    if (!exactKey || seenExact.has(exactKey)) return false;

    const duplicateSemantic = seenSemantic.some(
      (seenKey) =>
        seenKey === semanticKey ||
        (semanticKey.length >= 3 &&
          seenKey.length >= 3 &&
          (seenKey.includes(semanticKey) || semanticKey.includes(seenKey))),
    );
    if (duplicateSemantic) return false;

    seenExact.add(exactKey);
    seenSemantic.push(semanticKey);
    return true;
  });
}


function extractPhoneFromText(value: string | null | undefined): string | null {
  return extractPhoneMatchFromTextV17_90L85(value)?.phone || null;
}

function extractEmailFromText(value: string | null | undefined): string | null {
  const source = String(value || "");
  const match = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() || null;
}

function normalizeContactEvidenceV17_90L86(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeCustomerIdentityV17_90L87(value: unknown): string {
  return normalizeContactEvidenceV17_90L86(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitStoredCustomerReuseIntentV17_90L87(
  source: string,
  aiRequested?: boolean | null,
): boolean {
  if (aiRequested === true) return true;
  const text = normalizeCustomerIdentityV17_90L87(source);
  if (!text) return false;

  // Structural identity intent only. This is not a service vocabulary list.
  // It covers the supported intake languages and is used only as a fail-safe
  // when the model omits the dedicated reuse_requested field.
  return (
    /\b(?:kunde|kundendaten|rechnungsadresse|customer|client|cliente|azienda|societe|société)\b.{0,90}\b(?:bereits|schon|already|existing|stored|gespeichert|vorhanden|deja|déjà|gia|già|existente)\b/.test(text) &&
    /\b(?:verwenden|wiederverwenden|reuse|use|utiliser|riutilizzare|usar|reutilizar)\b/.test(text)
  );
}

function findUniqueMentionedCustomerV17_90L87(
  source: string,
  customers: Array<{ id: string; name: string | null }>,
): { id: string; name: string } | null {
  const messageKey = ` ${normalizeCustomerIdentityV17_90L87(source)} `;
  if (!messageKey.trim()) return null;

  const matches = customers
    .map((customer) => ({
      id: String(customer.id || ""),
      name: String(customer.name || "").trim(),
      key: normalizeCustomerIdentityV17_90L87(customer.name),
    }))
    .filter(
      (customer) =>
        customer.id &&
        customer.name &&
        customer.key.split(/\s+/g).filter(Boolean).length >= 2 &&
        messageKey.includes(` ${customer.key} `),
    );

  return matches.length === 1
    ? { id: matches[0].id, name: matches[0].name }
    : null;
}

function findPreferredStoredCustomerByExactNameV17_90L88B(
  requestedName: unknown,
  customers: Array<{
    id: string;
    name: string | null;
    customerNumber?: string | null;
    address?: string | null;
    plz?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  }>,
): { id: string; name: string; customerNumber?: string | null } | null {
  const requestedKey = normalizeCustomerIdentityV17_90L87(requestedName);
  if (!requestedKey) return null;

  const exact = customers
    .map((customer, sourceOrder) => ({ customer, sourceOrder }))
    .filter(
      ({ customer }) =>
        normalizeCustomerIdentityV17_90L87(customer.name) === requestedKey,
    )
    .map(({ customer, sourceOrder }) => {
      const addressComplete = Boolean(
        String(customer.address || "").trim() &&
          String(customer.plz || "").trim() &&
          String(customer.city || "").trim(),
      );
      const masterComplete = Boolean(
        String(customer.customerNumber || "").trim() && addressComplete,
      );
      const score =
        (masterComplete ? 200 : 0) +
        (String(customer.customerNumber || "").trim() ? 100 : 0) +
        (addressComplete ? 40 : 0) +
        (String(customer.email || "").trim() ? 10 : 0) +
        (String(customer.phone || "").trim() ? 8 : 0) -
        (/entwurf|draft|prüfen|pruefen/i.test(String(customer.notes || ""))
          ? 60
          : 0);

      return { customer, score, sourceOrder };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.sourceOrder - right.sourceOrder ||
        String(left.customer.customerNumber || "").localeCompare(
          String(right.customer.customerNumber || ""),
        ),
    );

  if (exact.length === 0) return null;

  // V17.90L91: If two exact-name records have the same quality, the identity is
  // genuinely ambiguous and must remain review-only. A complete numbered
  // customer may, however, deterministically outrank an incomplete draft.
  if (exact.length > 1 && exact[0].score === exact[1].score) return null;

  const selected = exact[0].customer;
  return {
    id: selected.id,
    name: String(selected.name || "").trim(),
    customerNumber: selected.customerNumber || null,
  };
}

function semanticRoleOverlapV17_90L87(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeContactEvidenceV17_90L86(left);
  const b = normalizeContactEvidenceV17_90L86(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const stop = new Set([
    "der", "die", "das", "den", "dem", "ein", "eine", "einer", "und",
    "oder", "mit", "bei", "im", "in", "am", "an", "auf", "zu", "zur",
    "zum", "von", "vor", "ort", "bitte", "nur", "ist", "sind", "wird",
  ]);
  const tokens = (value: string) =>
    Array.from(
      new Set(
        value
          .split(/\s+/g)
          .filter((token) => token.length >= 3 && !stop.has(token)),
      ),
    );
  const leftTokens = tokens(a);
  const rightTokens = tokens(b);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  const smaller = Math.min(leftTokens.length, rightTokens.length);
  return overlap >= 3 && overlap / smaller >= 0.6;
}

function lineMatchesOnsiteContactIdentityV17_90L87(
  line: string | null | undefined,
  contact: OnsiteContactHint | null | undefined,
): boolean {
  const normalizedLine = normalizeContactEvidenceV17_90L86(line);
  if (!normalizedLine || !contact) return false;

  const lineDigits = normalizePhoneDigits(line);
  const contactDigits = normalizePhoneDigits(contact.phone);
  if (
    lineDigits &&
    contactDigits &&
    (lineDigits === contactDigits ||
      lineDigits.endsWith(contactDigits) ||
      contactDigits.endsWith(lineDigits))
  ) {
    return true;
  }

  const nameTokens = normalizeContactEvidenceV17_90L86(contact.contactName)
    .split(/\s+/g)
    .filter(
      (token) =>
        token.length >= 2 &&
        !/^(?:herr|frau|mr|mrs|ms|mme|m)$/.test(token),
    );
  return nameTokens.length >= 1 && nameTokens.every((token) => normalizedLine.includes(token));
}

function normalizeAiContactChannelV17_90L86(
  value?: string | null,
): OnsiteContactChannel {
  const key = normalizeContactEvidenceV17_90L86(value);
  if (!key) return null;
  if (/\b(?:sms|text message|kurznachricht)\b/.test(key)) return "sms";
  if (/\b(?:whatsapp|whats app)\b/.test(key)) return "whatsapp";
  if (/\b(?:call|phone|telefon|anruf|anrufen)\b/.test(key)) return "call";
  return null;
}

function sourceContainsPhoneV17_90L86(
  source: string,
  phone?: string | null,
): boolean {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  return Array.from(source.matchAll(/\+?\d[\d\s()./-]{6,}\d/g)).some(
    (match) => {
      const candidate = normalizePhoneDigits(match[0]);
      return Boolean(
        candidate &&
          (candidate === digits ||
            candidate.endsWith(digits) ||
            digits.endsWith(candidate)),
      );
    },
  );
}

type SourceCommunicationResolutionV17_90L272 = {
  preferredChannel: OnsiteContactChannel;
  noSms: boolean;
  noWhatsapp: boolean;
  noCall: boolean;
  hasExplicitRule: boolean;
};

function resolveSourceCommunicationV17_90L272(
  value: unknown,
  fallbackChannel: OnsiteContactChannel = null,
): SourceCommunicationResolutionV17_90L272 {
  const text = normalizeContactEvidenceV17_90L86(String(value || ""));
  if (!text) {
    return {
      preferredChannel: fallbackChannel,
      noSms: false,
      noWhatsapp: false,
      noCall: false,
      hasExplicitRule: false,
    };
  }

  const noSms = /\b(?:kein(?:e)?|keine|kei|ohne|no|without|sans|pas de|niente|senza|sin|sem) sms\b/.test(
    text,
  );
  const noWhatsapp = /\b(?:kein(?:e)?|keine|kei|ohne|no|without|sans|pas de|niente|senza|sin|sem) whats ?app\b/.test(
    text,
  );
  const noCall = /\b(?:nicht|kein(?:e)?|keine|ohne|no|do not|dont|without|ne pas|non|sin|nao|sem|nod|ned|nid)\b.{0,24}\b(?:anrufen|telefonieren|anruf|calls?|call|phone|appeler|chiamare|llamar|ligar|aalute|anlute)\b/.test(
    text,
  );

  const exclusiveSms = /\b(?:nur|only|uniquement|solo|solamente|apenas)\b.{0,18}\bsms\b/.test(
    text,
  );
  const exclusiveWhatsapp = /\b(?:nur|only|uniquement|solo|solamente|apenas)\b.{0,18}\bwhats ?app\b/.test(
    text,
  );
  const exclusiveCall = /\b(?:nur|only|uniquement|solo|solamente|apenas)\b.{0,24}\b(?:anrufen|telefonieren|anruf|call|phone|appeler|chiamare|llamar|ligar|aalute|anlute)\b/.test(
    text,
  );

  const positiveSms =
    !noSms &&
    (exclusiveSms ||
      /\b(?:per|via|mit|durch|bitte|please|par|por|tramite)?\s*sms\b/.test(
        text,
      ));
  const positiveWhatsapp =
    !noWhatsapp &&
    (exclusiveWhatsapp ||
      /\b(?:per|via|mit|durch|bitte|please|par|por|tramite)?\s*whats ?app\b/.test(
        text,
      ));
  const positiveCall =
    !noCall &&
    (exclusiveCall ||
      /\b(?:bitte|please|vorher|telefonisch|per telefon|par telephone|por telefone)?\s*(?:anrufen|telefonieren|call|phone|appeler|chiamare|llamar|ligar|aalute|anlute)\b/.test(
        text,
      ));

  let preferredChannel: OnsiteContactChannel = null;
  if (exclusiveSms && !noSms) preferredChannel = "sms";
  else if (exclusiveWhatsapp && !noWhatsapp) preferredChannel = "whatsapp";
  else if (exclusiveCall && !noCall) preferredChannel = "call";
  else {
    const positives: OnsiteContactChannel[] = [];
    if (positiveSms) positives.push("sms");
    if (positiveWhatsapp) positives.push("whatsapp");
    if (positiveCall) positives.push("call");
    if (positives.length === 1) preferredChannel = positives[0];
    else if (
      fallbackChannel &&
      ((fallbackChannel === "sms" && !noSms) ||
        (fallbackChannel === "whatsapp" && !noWhatsapp) ||
        (fallbackChannel === "call" && !noCall))
    ) {
      preferredChannel = fallbackChannel;
    }
  }

  return {
    preferredChannel,
    noSms,
    noWhatsapp,
    noCall,
    hasExplicitRule:
      noSms ||
      noWhatsapp ||
      noCall ||
      positiveSms ||
      positiveWhatsapp ||
      positiveCall,
  };
}

function sourceExplicitlyRejectsContactNameV17_90L272(
  source: string,
  name?: string | null,
): boolean {
  const normalizedSource = normalizeContactEvidenceV17_90L86(source);
  const normalizedName = normalizeContactEvidenceV17_90L86(name);
  if (!normalizedSource || !normalizedName) return false;

  const nameIndex = normalizedSource.indexOf(normalizedName);
  if (nameIndex < 0) return false;
  const local = normalizedSource.slice(
    Math.max(0, nameIndex - 100),
    Math.min(normalizedSource.length, nameIndex + normalizedName.length + 140),
  );
  const contactRole =
    "(?:kontaktperson|kontakt vor ort|ansprechperson|ansprechpartner|on site contact|onsite contact|contact person|contact sur place|contatto sul posto|contacto en sitio)";
  return (
    new RegExp(
      `${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,90}(?:nicht|kein(?:e)?|keine|not|no|pas|non|nao).{0,30}${contactRole}`,
    ).test(local) ||
    new RegExp(
      `(?:nicht|kein(?:e)?|keine|not|no|pas|non|nao).{0,30}${contactRole}.{0,90}${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ).test(local)
  );
}

function sourceSupportsContactNameV17_90L86(
  source: string,
  name?: string | null,
): boolean {
  const normalizedName = normalizeContactEvidenceV17_90L86(name);
  if (!normalizedName) return false;
  const normalizedSource = normalizeContactEvidenceV17_90L86(source);
  if (!normalizedSource || sourceExplicitlyRejectsContactNameV17_90L272(source, name)) {
    return false;
  }

  const tokens = normalizedName
    .split(/\s+/g)
    .filter((token) => token.length >= 2 && !/^(?:herr|frau|mr|mrs|ms|mme|m)$/.test(token));
  const namePresent =
    normalizedSource.includes(normalizedName) ||
    (tokens.length >= 1 && tokens.every((token) => normalizedSource.includes(token)));
  if (!namePresent) return false;

  const clauses = String(source || "")
    .split(/[.!?;\n]+/g)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => {
      const normalizedClause = normalizeContactEvidenceV17_90L86(clause);
      return (
        normalizedClause.includes(normalizedName) ||
        (tokens.length >= 1 && tokens.every((token) => normalizedClause.includes(token)))
      );
    });

  return clauses.some((clause) => {
    const normalizedClause = normalizeContactEvidenceV17_90L86(clause);
    if (
      /\b(?:kontaktperson|kontakt vor ort|ansprechperson|ansprechpartner|on site contact|onsite contact|contact person|contact sur place|contatto sul posto|contacto en sitio)\b/.test(
        normalizedClause,
      )
    ) {
      return true;
    }
    if (/\+?\d[\d\s()./-]{6,}\d/.test(clause)) return true;

    const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const communication =
      "(?:anrufen|telefonieren|melden|kontaktieren|sms|whats ?app|call|phone|appeler|chiamare|llamar|ligar|erreichbar|reachable)";
    return (
      new RegExp(`${escapedName}.{0,55}${communication}`).test(normalizedClause) ||
      new RegExp(`${communication}.{0,55}${escapedName}`).test(normalizedClause)
    );
  });
}

function cleanLikelyContactNameV17_90L86(value?: string | null): string | null {
  let cleaned = String(value || "")
    .replace(/^[\s:.,;\-–—]+|[\s:.,;\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  // Structural fallback: discard leading filler until the first proper-name-like
  // token. The semantic AI field remains the primary source; this only handles
  // one-line variants such as "this time Frau Laura Graf" without a phrase list.
  const parts = cleaned.split(/\s+/g);
  const properIndex = parts.findIndex((part) =>
    /^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(part),
  );
  if (properIndex > 0) cleaned = parts.slice(properIndex).join(" ");

  cleaned = cleaned
    .replace(/\b(?:erreichbar|available|reachable)\s*(?:unter|at|via)?\s*$/i, "")
    .replace(/\b(?:tel\.?|telefon|phone|mobile|handy|natel|unter)\s*[:.]?\s*$/i, "")
    .replace(/^[\s:.,;\-–—]+|[\s:.,;\-–—]+$/g, "")
    .trim();

  if (!cleaned || cleaned.length > 100) return null;

  // V17.90L194: Access labels are roles, not people.
  const roleOnly = normalizeContactEvidenceV17_90L86(cleaned);
  if (
    /^(?:code|zugangscode|torcode|schluessel|schlussel|schlüssel|key|termin|datum|telefon|tel|handy|natel|sms|whatsapp)$/.test(
      roleOnly,
    )
  ) {
    return null;
  }
  if (/^(?:code|zugangscode|torcode)\s+\d+/i.test(roleOnly)) return null;

  return cleaned;
}

function buildOnsiteContactHintV17_90L86(args: {
  source: string;
  candidateCustomerPhone?: string | null;
  phone?: string | null;
  contactName?: string | null;
  preferredChannel?: OnsiteContactChannel;
  noPhoneCall?: boolean;
}): OnsiteContactHint {
  const phone = args.phone || null;
  const phoneDigits = normalizePhoneDigits(phone);
  const candidateDigits = normalizePhoneDigits(args.candidateCustomerPhone);
  const contactName = cleanLikelyContactNameV17_90L86(args.contactName);
  const preferredChannel = args.preferredChannel || null;
  const noPhoneCall = Boolean(args.noPhoneCall);
  const channelLabel =
    preferredChannel === "sms"
      ? "nur SMS"
      : preferredChannel === "whatsapp"
        ? "nur WhatsApp"
        : preferredChannel === "call"
          ? "anrufen"
          : null;
  const hasContactIdentity = Boolean(phone || contactName);
  const parts = hasContactIdentity
    ? [
        contactName ? `Kontakt vor Ort: ${contactName}` : "Kontakt vor Ort",
        phone ? `Tel. ${phone}` : null,
        channelLabel,
        noPhoneCall && preferredChannel !== "call" ? "nicht telefonisch" : null,
      ].filter(Boolean)
    : [];

  return {
    // V17.90L104: Stable structured separators. Later UI code reads this
    // canonical line directly and must not reconstruct a contact from nearby
    // appointment or customer text.
    hint: hasContactIdentity ? parts.join(" · ") : null,
    phone,
    phoneBelongsToSiteContact: Boolean(
      candidateDigits &&
        phoneDigits &&
        (phoneDigits === candidateDigits ||
          phoneDigits.endsWith(candidateDigits) ||
          candidateDigits.endsWith(phoneDigits)),
    ),
    contactName,
    preferredChannel,
    noPhoneCall,
  };
}

function normalizeAiOnsiteContactValueV17_90L229(
  value: unknown,
): AiOnsiteContactV17_90L86 | null {
  let current: unknown = value;
  for (let depth = 0; depth < 2; depth += 1) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return current as AiOnsiteContactV17_90L86;
    }
    if (typeof current !== "string" || !current.trim()) return null;
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as AiOnsiteContactV17_90L86)
    : null;
}

function extractAiOnsiteContactHintV17_90L86(
  rawText: string,
  candidateCustomerPhone: string | null | undefined,
  aiContact?: AiOnsiteContactV17_90L86 | null,
): OnsiteContactHint | null {
  if (!aiContact || aiContact.vorhanden === false) return null;

  const evidence = normalizeStructuredTextBlock(aiContact.evidence);
  const evidenceIsSourceBacked = Boolean(
    evidence && structuredEvidenceMatchesOriginalText(evidence, rawText),
  );
  const evidenceScope = evidenceIsSourceBacked ? evidence || "" : "";

  const rawPhone = aiContact.telefon || aiContact.phone || null;
  const phone =
    evidenceScope && sourceContainsPhoneV17_90L86(evidenceScope, rawPhone)
      ? String(rawPhone || "").replace(/\s+/g, " ").trim()
      : null;
  const rawName = cleanLikelyContactNameV17_90L86(aiContact.name);
  const contactName =
    evidenceScope && sourceSupportsContactNameV17_90L86(evidenceScope, rawName)
      ? rawName
      : null;
  const aiPreferredChannel = normalizeAiContactChannelV17_90L86(
    aiContact.kanal || aiContact.channel,
  );
  const sourceCommunicationV17_90L272 = resolveSourceCommunicationV17_90L272(
    evidenceScope,
    aiPreferredChannel,
  );
  const preferredChannel = sourceCommunicationV17_90L272.preferredChannel;
  const noPhoneCall = sourceCommunicationV17_90L272.hasExplicitRule
    ? sourceCommunicationV17_90L272.noCall
    : Boolean(aiContact.nicht_anrufen ?? aiContact.no_phone_call ?? false);

  // A channel instruction without a local person/phone belongs to the
  // appointment/communication hints, not to an invented on-site contact.
  if (!phone && !contactName) return null;
  return buildOnsiteContactHintV17_90L86({
    source: rawText,
    candidateCustomerPhone,
    phone,
    contactName,
    preferredChannel,
    noPhoneCall,
  });
}

// V17.90L265/L271: A source-backed channel instruction is a canonical
// operational hint even when no new person or phone is named. Persist only a
// concise German restriction summary; the original evidence remains in the
// customer message/audit. This does not create an on-site contact identity.
function extractAiCommunicationInstructionHintV17_90L265(
  rawText: string,
  aiContact?: AiOnsiteContactV17_90L86 | null,
): string | null {
  const normalizedContact = normalizeAiOnsiteContactValueV17_90L229(aiContact);
  if (!normalizedContact || normalizedContact.vorhanden === false) return null;

  const evidence = normalizeStructuredTextBlock(normalizedContact.evidence);
  if (
    !evidence ||
    !structuredEvidenceMatchesOriginalText(evidence, rawText)
  ) {
    return null;
  }

  const aiPreferredChannel = normalizeAiContactChannelV17_90L86(
    normalizedContact.kanal || normalizedContact.channel,
  );
  const sourceCommunicationV17_90L272 = resolveSourceCommunicationV17_90L272(
    evidence,
    aiPreferredChannel,
  );
  const preferredChannel = sourceCommunicationV17_90L272.preferredChannel;
  const noPhoneCall = sourceCommunicationV17_90L272.hasExplicitRule
    ? sourceCommunicationV17_90L272.noCall
    : Boolean(
        normalizedContact.nicht_anrufen ??
          normalizedContact.no_phone_call ??
          false,
      );
  if (!sourceCommunicationV17_90L272.hasExplicitRule && !noPhoneCall) return null;

  const normalizedEvidence = normalizeAppointmentResolverTextV17_90L271(
    evidence,
  );
  const noSms = sourceCommunicationV17_90L272.noSms;
  const noWhatsapp = sourceCommunicationV17_90L272.noWhatsapp;
  const explicitNoCall = noPhoneCall;
  const hasTimedArrivalNotice =
    /\b\d{1,3}\s*(?:min|minute|minuten|minutes|minuti|minutos)\b/.test(
      normalizedEvidence,
    );

  const parts: string[] = [];
  if (!hasTimedArrivalNotice && preferredChannel === "sms") {
    parts.push("Kontakt per SMS");
  } else if (!hasTimedArrivalNotice && preferredChannel === "whatsapp") {
    parts.push("Kontakt per WhatsApp");
  } else if (!hasTimedArrivalNotice && preferredChannel === "call") {
    parts.push("Telefonisch melden");
  }
  if (noSms && preferredChannel !== "sms") parts.push("Keine SMS");
  if (noWhatsapp && preferredChannel !== "whatsapp") {
    parts.push("Kein WhatsApp");
  }
  if (explicitNoCall && preferredChannel !== "call") {
    parts.push("Nicht anrufen");
  }

  return Array.from(new Set(parts)).join(" · ") || null;
}

function extractOnsiteContactHint(
  rawText: string | null | undefined,
  candidateCustomerPhone: string | null | undefined,
  aiContact?: AiOnsiteContactV17_90L86 | null,
): OnsiteContactHint {
  const source = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const emptyResult = buildOnsiteContactHintV17_90L86({
    source,
    candidateCustomerPhone,
  });
  if (!source) return emptyResult;

  const aiResult = extractAiOnsiteContactHintV17_90L86(
    source,
    candidateCustomerPhone,
    aiContact,
  );
  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitMarkerRe =
    /\b(kontakt\s+vor\s+ort|kontaktperson\s+vor\s+ort|ansprechperson\s+vor\s+ort|ansprechpartner(?:in)?\s+vor\s+ort|vor\s+ort\s+ansprechpartner(?:in)?|person\s+vor\s+ort|on[-\s]?site\s+contact|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i;
  const genericLocalMarkerRe =
    /\b(vor\s+ort|on[-\s]?site|sur\s+place|sul\s+posto|en\s+sitio)\b/i;
  const roleMarkerRe =
    /\b(hauswart|hausmeister|hausdienst|concierge|caretaker|gardien|facility\s+manager)\b/i;
  const anyMarkerRe = new RegExp(
    `${explicitMarkerRe.source}|${genericLocalMarkerRe.source}|${roleMarkerRe.source}`,
    "i",
  );
  const stopRe =
    /^(besonderheiten|leistungsübersicht|leistungsuebersicht|leistungen|titel|rechnung|rechnungsadresse|kunde|arbeitsort|objekt|termin|datum|fecha|date|data\s+lavoro|date\s+souhaitée|date\s+souhaitee)\s*:?/i;

  // V17.90L194: A contact is an atomic canonical object. Never combine a
  // name from one text region with a phone/channel from another region.
  if (aiResult) return aiResult;

  for (let index = 0; index < lines.length; index += 1) {
    const markerMatch = lines[index].match(anyMarkerRe);
    if (!markerMatch || markerMatch.index == null) continue;

    const scopedFirstLine = lines[index].slice(markerMatch.index);
    const blockLines: string[] = [scopedFirstLine];
    for (let offset = 1; offset <= 3; offset += 1) {
      const line = lines[index + offset];
      if (!line || stopRe.test(line)) break;
      blockLines.push(line);
    }

    const scopedBlock = blockLines
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);
    const phoneMatch = extractPhoneMatchFromTextV17_90L85(scopedBlock);

    // A generic location phrase such as "vor Ort" is a contact marker only
    // when a local phone is actually attached. This prevents worksite text from
    // being reclassified as a person.
    const isGenericMarker = genericLocalMarkerRe.test(markerMatch[0]);
    const isExplicitContactMarker = explicitMarkerRe.test(markerMatch[0]);
    const isRoleMarker = roleMarkerRe.test(markerMatch[0]);
    if (isGenericMarker && !phoneMatch) continue;
    // Role words such as Hauswart/Concierge are not a person identity by
    // themselves. Without a local phone, only an explicit contact marker may
    // create a deterministic fallback contact.
    if (isRoleMarker && !isExplicitContactMarker && !phoneMatch) continue;
    // A bare location phrase must not capture a later, unrelated telephone
    // from another section.
    if (isGenericMarker && phoneMatch && phoneMatch.index > 240) {
      continue;
    }

    const phone = phoneMatch?.phone || null;
    const localNameSource = phoneMatch
      ? scopedBlock.slice(markerMatch[0].length, phoneMatch.index)
      : scopedFirstLine.slice(markerMatch[0].length);
    const contactName = cleanLikelyContactNameV17_90L86(localNameSource);
    const properNameTokenCount = String(contactName || "")
      .split(/\s+/g)
      .filter((part) => /^[A-ZÀ-ÖØ-ÞÄÖÜ][\p{L}'’.-]*$/u.test(part))
      .length;
    // For a bare location phrase, the deterministic fallback needs a visible
    // person-name structure. Otherwise a later invoice or office phone could
    // be attached to the worksite. Verified AI contact data remains primary.
    if (
      (!phoneMatch || isGenericMarker) &&
      (properNameTokenCount < 2 || /\d/.test(String(contactName || "")))
    ) {
      continue;
    }

    const channelScope = scopedBlock.slice(
      0,
      Math.min(scopedBlock.length, phoneMatch ? phoneMatch.end + 220 : 300),
    );
    const hasSms = /\b(?:sms|text\s+message|kurznachricht)\b/i.test(
      channelScope,
    );
    const hasWhatsapp = /\bwhats\s*app|\bwhatsapp\b/i.test(channelScope);
    const hasCall = /\b(?:anrufen|telefonieren|call|phone\s+call)\b/i.test(
      channelScope,
    );
    const excludesOnlyStoredOfficeNumber =
      /\b(?:nicht|do\s+not|don['’]?t)\b.{0,55}\b(?:normal|gespeichert|firma|firmen|büro|buero|office|customer)\b.{0,45}\b(?:nummer|telefon|phone)\b/i.test(
        channelScope,
      );
    const noPhoneCall =
      !excludesOnlyStoredOfficeNumber &&
      /\b(?:nicht\s+(?:telefonisch\s+)?anrufen|nicht\s+telefonisch|keine?n?\s+anruf|do\s+not\s+call|don['’]?t\s+call|no\s+calls?)\b/i.test(
        channelScope,
      );
    const preferredChannel: OnsiteContactChannel = hasSms
      ? "sms"
      : hasWhatsapp
        ? "whatsapp"
        : hasCall && !noPhoneCall
          ? "call"
          : null;

    return buildOnsiteContactHintV17_90L86({
      source,
      candidateCustomerPhone,
      phone,
      contactName,
      preferredChannel,
      noPhoneCall,
    });
  }

  return aiResult || emptyResult;
}

function normalizeStructuredAppointmentDateV17_90L86(
  value?: string | null,
): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${String(iso[3]).padStart(2, "0")}.${String(iso[2]).padStart(2, "0")}.${iso[1]}`;
  const local = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (!local) return null;
  const year = local[3]
    ? local[3].length === 2
      ? `20${local[3]}`
      : local[3]
    : "";
  return `${String(local[1]).padStart(2, "0")}.${String(local[2]).padStart(2, "0")}${year ? `.${year}` : "."}`;
}


type IntakeAppointmentReferenceV17_90L271 = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  isoDate: string;
  displayDate: string;
  displayDateTime: string;
};

function buildIntakeAppointmentReferenceV17_90L271(
  value: Date,
): IntakeAppointmentReferenceV17_90L271 {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = read("hour").padStart(2, "0");
  const minute = read("minute").padStart(2, "0");
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const displayDate = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${String(year).padStart(4, "0")}`;
  const weekdayName = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "long",
  }).format(value);
  return {
    year,
    month,
    day,
    weekday,
    isoDate,
    displayDate,
    displayDateTime: `${weekdayName}, ${displayDate}, ${hour}:${minute} Uhr`,
  };
}

function normalizeAppointmentResolverTextV17_90L271(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9.\/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const APPOINTMENT_WEEKDAY_ALIASES_V17_90L271: Array<{
  weekday: number;
  aliases: string[];
}> = [
  { weekday: 1, aliases: ["montag", "monday", "lundi", "lunedi", "lunes", "segunda feira"] },
  { weekday: 2, aliases: ["dienstag", "tuesday", "mardi", "martedi", "martes", "terca feira"] },
  { weekday: 3, aliases: ["mittwoch", "wednesday", "mercredi", "mercoledi", "miercoles", "quarta feira"] },
  { weekday: 4, aliases: ["donnerstag", "thursday", "jeudi", "giovedi", "jueves", "quinta feira"] },
  { weekday: 5, aliases: ["freitag", "friday", "vendredi", "venerdi", "viernes", "sexta feira"] },
  { weekday: 6, aliases: ["samstag", "sonnabend", "saturday", "samedi", "sabato", "sabado"] },
  { weekday: 0, aliases: ["sonntag", "sunday", "dimanche", "domenica", "domingo"] },
];

function addReferenceDaysV17_90L271(
  reference: IntakeAppointmentReferenceV17_90L271,
  days: number,
): { isoDate: string; displayDate: string } {
  const date = new Date(
    Date.UTC(reference.year, reference.month - 1, reference.day + days),
  );
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return {
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    displayDate: `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${String(year).padStart(4, "0")}`,
  };
}

function resolveRelativeAppointmentDateV17_90L271(args: {
  appointment: AiAppointmentV17_90L86;
  reference: IntakeAppointmentReferenceV17_90L271;
}): { isoDate: string; displayDate: string } | null {
  const phraseStatus = normalizeAppointmentPhraseStatusV17_90L270(
    args.appointment,
  );
  if (phraseStatus === "unklar") return null;

  const phrase = compactAppointmentPhraseV17_90L270(args.appointment);
  const evidence = String(args.appointment?.evidence || "");
  const text = normalizeAppointmentResolverTextV17_90L271(
    [phrase, evidence].filter(Boolean).join(" "),
  );
  if (!text) return null;

  if (/\b(?:ubermorgen|day after tomorrow|apres demain|dopodomani|pasado manana|depois de amanha)\b/.test(text)) {
    return addReferenceDaysV17_90L271(args.reference, 2);
  }
  if (/\b(?:heute|today|aujourd hui|oggi|hoy|hoje)\b/.test(text)) {
    return addReferenceDaysV17_90L271(args.reference, 0);
  }
  if (/\b(?:morgen|tomorrow|demain|domani|manana|amanha)\b/.test(text)) {
    return addReferenceDaysV17_90L271(args.reference, 1);
  }

  const weekdayMatches = APPOINTMENT_WEEKDAY_ALIASES_V17_90L271.filter(
    (entry) =>
      entry.aliases.some((alias) =>
        new RegExp(`(?:^|\\s)${alias.replace(/\s+/g, "\\s+")}(?:$|\\s)`, "i").test(
          text,
        ),
      ),
  );
  const uniqueWeekdays = Array.from(
    new Set(weekdayMatches.map((entry) => entry.weekday)),
  );
  if (uniqueWeekdays.length !== 1) return null;
  const targetWeekday = uniqueWeekdays[0];

  const explicitlyNextWeek = /\b(?:nachste woche|naechste woche|next week|semaine prochaine|prochaine semaine|settimana prossima|proxima semana)\b/.test(
    text,
  );
  const explicitNextOccurrence = /\b(?:nachsten|naechsten|nachste|naechste|next|prochain|prochaine|prossimo|prossima|proximo|proxima)\b/.test(
    text,
  );

  let delta: number;
  if (explicitlyNextWeek) {
    const daysUntilNextMonday = ((8 - args.reference.weekday) % 7) || 7;
    const mondayBasedOffset = targetWeekday === 0 ? 6 : targetWeekday - 1;
    delta = daysUntilNextMonday + mondayBasedOffset;
  } else {
    delta = (targetWeekday - args.reference.weekday + 7) % 7;
    if (delta === 0) {
      if (!explicitNextOccurrence) return null;
      delta = 7;
    }
    // V17.90L272: In natural German, "nächsten Mittwoch" sent on Tuesday
    // can mean tomorrow or the following week's Wednesday. A one-day jump is
    // therefore not deterministic unless the customer explicitly says
    // "nächste Woche". Fail closed instead of writing a possibly wrong date.
    if (explicitNextOccurrence && delta === 1) return null;
  }
  if (delta <= 0 || delta > 14) return null;
  return addReferenceDaysV17_90L271(args.reference, delta);
}

function normalizeStructuredAppointmentTimeV17_90L86(
  value?: string | null,
): string | null {
  const match = String(value || "").match(/\b([01]?\d|2[0-3])(?::|\.)(\d{2})\b|\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/i);
  if (!match) return null;
  const hour = match[1] || match[3];
  const minute = match[2] || "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

const CANONICAL_APPOINTMENT_DAYPARTS_V17_90L256 = new Map<string, string>([
  ["morgens", "morgens"],
  ["vormittags", "vormittags"],
  ["mittags", "mittags"],
  ["nachmittags", "nachmittags"],
  ["abends", "abends"],
  ["nachts", "nachts"],
  ["ganztagig", "ganztägig"],
]);

function normalizeStructuredAppointmentDaypartV17_90L256(
  appointment: AiAppointmentV17_90L86,
): string | null {
  const record = appointment as AiAppointmentV17_90L86 &
    Record<string, unknown>;
  const raw = String(record.tageszeit ?? record.daypart ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // V17.90L256: Only the first structured AI may write the canonical daypart.
  // No raw-text, translation, evidence or regex fallback is allowed to infer,
  // correct or replace it after the 03_llm_structured boundary. Invalid or
  // uncertain values fail closed as null and must be marked by the first AI.
  return CANONICAL_APPOINTMENT_DAYPARTS_V17_90L256.get(raw) || null;
}

type AppointmentPhraseStatusV17_90L270 =
  | "klar"
  | "vage"
  | "unklar"
  | null;

function normalizeAppointmentPhraseStatusV17_90L270(
  appointment: AiAppointmentV17_90L86,
): AppointmentPhraseStatusV17_90L270 {
  const record = appointment as AiAppointmentV17_90L86 &
    Record<string, unknown>;
  const raw = String(
    record.zeitangabe_status ?? record.time_phrase_status ?? "",
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]+/g, "")
    .trim();
  if (["klar", "explicit", "clear"].includes(raw)) return "klar";
  if (["vage", "vague", "relative", "open"].includes(raw)) return "vage";
  if (["unklar", "unclear", "unknown", "missing"].includes(raw))
    return "unklar";
  return null;
}

function compactAppointmentPhraseV17_90L270(
  appointment: AiAppointmentV17_90L86,
): string {
  const record = appointment as AiAppointmentV17_90L86 &
    Record<string, unknown>;
  return String(record.zeitangabe_text ?? record.time_phrase ?? "")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:termin|appointment|rendez[-\s]?vous)\s*:\s*/i, "")
    .trim()
    .slice(0, 180);
}

function stripResolvedRelativeDatePhraseV17_90L272(value: string): string {
  const weekday =
    "(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|lunes|martes|miercoles|jueves|viernes|sabado|domingo)";
  return String(value || "")
    .replace(/^\s*(?:am|an|auf|fuer|für)?\s*(?:heute|morgen|uebermorgen|übermorgen|today|tomorrow|day after tomorrow|aujourd hui|demain|apres demain)\b[,:;\s-]*/i, "")
    .replace(
      new RegExp(
        `^\\s*(?:am|an|auf|fuer|für)?\\s*(?:(?:naechste|nächste|kommende|next|prochaine|prossima)\\s+woche\\s+)?(?:(?:naechsten|nächsten|naechste|nächste|kommenden|kommende|next|prochain|prochaine|prossimo|prossima)\\s+)?${weekday}\\b[,:;\\s-]*`,
        "i",
      ),
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitVagueAppointmentEvidenceV17_90L270(
  value: unknown,
): boolean {
  const text = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return [
    /\b(?:eher\s+)?spaeter(?:\s+am\s+tag)?\b/,
    /\birgendwann\b|\bim\s+laufe\s+des\s+tages\b|\bgegen\s+spaeter\b/,
    /\bgenaue?\s+(?:uhr)?zeit\b.{0,55}\b(?:nicht|noch\s+nicht|unklar|offen)\b/,
    /\b(?:later|sometime|during\s+the\s+day)\b/,
    /\b(?:exact\s+time|time)\b.{0,55}\b(?:not\s+fixed|unknown|not\s+set)\b/,
    /\b(?:plus\s+tard|dans\s+la\s+journee)\b/,
    /\b(?:heure|horaire)\b.{0,55}\b(?:pas\s+fixe|inconnu|a\s+definir)\b/,
    /\b(?:piu\s+tardi|nel\s+corso\s+della\s+giornata)\b/,
    /\b(?:orario|ora)\b.{0,55}\b(?:non\s+fissat|da\s+definire)\b/,
    /\b(?:mas\s+tarde|durante\s+el\s+dia)\b/,
    /\b(?:hora)\b.{0,55}\b(?:no\s+fijad|por\s+definir)\b/,
    /\b(?:mais\s+tarde|ao\s+longo\s+do\s+dia)\b/,
    /\b(?:horario|hora)\b.{0,55}\b(?:nao\s+definid|por\s+definir)\b/,
  ].some((pattern) => pattern.test(text));
}

const APPOINTMENT_MONTH_ALIASES_V17_90L279: Record<number, string[]> = {
  1: ["januar", "january", "janvier", "gennaio", "enero", "janeiro"],
  2: ["februar", "february", "fevrier", "febbraio", "febrero", "fevereiro"],
  3: ["maerz", "march", "mars", "marzo", "marco"],
  4: ["april", "avril", "aprile", "abril"],
  5: ["mai", "may", "maggio", "mayo", "maio"],
  6: ["juni", "june", "juin", "giugno", "junio", "junho"],
  7: ["juli", "july", "juillet", "luglio", "julio", "julho"],
  8: ["august", "aout", "agosto"],
  9: ["september", "septembre", "settembre", "septiembre"],
  10: ["oktober", "october", "octobre", "ottobre", "octubre", "outubro"],
  11: ["november", "novembre", "noviembre"],
  12: ["dezember", "december", "decembre", "dicembre", "diciembre", "dezembro"],
};

function normalizeNamedAppointmentDateSourceV17_90L279(
  value: unknown,
): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceContainsNamedAppointmentDateV17_90L279(args: {
  source: string;
  day: number;
  month: number;
  year?: string | null;
  requireYear?: boolean;
}): boolean {
  const aliases = APPOINTMENT_MONTH_ALIASES_V17_90L279[args.month] || [];
  const source = normalizeNamedAppointmentDateSourceV17_90L279(args.source);
  const expectedYear = String(args.year || "").trim();
  if (!source || !Number.isFinite(args.day) || aliases.length === 0) return false;

  const aliasPattern = aliases
    .map((alias) => normalizeNamedAppointmentDateSourceV17_90L279(alias))
    .filter(Boolean)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!aliasPattern) return false;

  const dayPattern = `0?${Math.trunc(args.day)}`;
  const patterns = [
    new RegExp(
      `(?:^|\\s)${dayPattern}\\s+(?:de\\s+)?(?:${aliasPattern})(?:\\s+(?:de\\s+)?(\\d{2,4}))?(?:$|\\s)`,
      "g",
    ),
    new RegExp(
      `(?:^|\\s)(?:${aliasPattern})\\s+${dayPattern}(?:\\s+(?:de\\s+)?(\\d{2,4}))?(?:$|\\s)`,
      "g",
    ),
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const matchedYearRaw = String(match[1] || "");
      const matchedYear =
        matchedYearRaw.length === 2 ? `20${matchedYearRaw}` : matchedYearRaw;
      if (args.requireYear) {
        if (expectedYear && matchedYear === expectedYear) return true;
        continue;
      }
      if (expectedYear && matchedYear && matchedYear !== expectedYear) continue;
      return true;
    }
  }

  return false;
}

function sourceSupportsAppointmentPartV17_90L86(
  source: string,
  value?: string | null,
): boolean {
  const rawSource = String(source || "");
  const rawValue = String(value || "").trim();
  if (!rawSource || !rawValue) return false;

  const sourceDigits = rawSource.replace(/\D/g, "");
  const normalized = rawValue.replace(/\D/g, "");
  if (normalized && sourceDigits.includes(normalized)) return true;

  // An AI date may add a year although the customer only wrote day/month.
  // Validate the local day/month pair instead of comparing one long digit blob.
  const isoDate = rawValue.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const localDate = rawValue.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/);
  const day = isoDate?.[3] || localDate?.[1] || "";
  const month = isoDate?.[2] || localDate?.[2] || "";
  const year = isoDate?.[1] || localDate?.[3] || "";
  if (day && month) {
    const dayValue = String(Number(day));
    const monthValue = String(Number(month));
    const datePattern = new RegExp(
      `(?:^|\\D)0?${dayValue}[.\\/-]0?${monthValue}(?:[.\\/-]\\d{2,4})?(?:$|\\D)`,
    );
    if (datePattern.test(rawSource)) return true;
    if (
      sourceContainsNamedAppointmentDateV17_90L279({
        source: rawSource,
        day: Number(dayValue),
        month: Number(monthValue),
        year: year
          ? year.length === 2
            ? `20${year}`
            : year
          : null,
      })
    ) {
      return true;
    }
  }

  const time = rawValue.match(/\b([01]?\d|2[0-3])(?::|\.)(\d{2})\b/);
  if (time) {
    const hourValue = String(Number(time[1]));
    const minuteValue = time[2];
    const timePattern = new RegExp(
      `(?:^|\\D)0?${hourValue}(?::|\\.)${minuteValue}(?:$|\\D)`,
    );
    if (timePattern.test(rawSource)) return true;
  }

  return false;
}


function inferAppointmentNoticeV17_90L203(
  appointment: AiAppointmentV17_90L86,
  rawText: string,
): { minutes: number; channel: OnsiteContactChannel } {
  const source = [appointment?.evidence, rawText]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return { minutes: 0, channel: null };

  const noticePatterns = [
    /\b(\d{1,3})\s*(?:min(?:ute)?n?)?\s*(?:vorher|vor\s+(?:der\s+)?ankunft|vor\s+dem\s+eintreffen)\b[^.!?\n]{0,120}/i,
    /\b(\d{1,3})\s*(?:min(?:ute)?s?)?\s*(?:before(?:\s+arrival)?|prior\s+to(?:\s+arrival)?)\b[^.!?\n]{0,120}/i,
    /\b(\d{1,3})\s*(?:min(?:ute)?s?)?\s*(?:avant(?:\s+l['’]?arriv[ée]e)?|prima(?:\s+dell['’]?arrivo)?|antes(?:\s+de\s+la\s+llegada)?)\b[^.!?\n]{0,120}/iu,
  ];
  let matched = "";
  let minutes = 0;
  for (const pattern of noticePatterns) {
    const match = source.match(pattern);
    const numeric = Number(match?.[1] || 0);
    if (match && Number.isFinite(numeric) && numeric > 0 && numeric <= 240) {
      matched = match[0];
      minutes = Math.round(numeric);
      break;
    }
  }
  if (!minutes) return { minutes: 0, channel: null };

  const sourceCommunicationV17_90L272 = resolveSourceCommunicationV17_90L272(
    matched || source,
    null,
  );
  return {
    minutes,
    channel: sourceCommunicationV17_90L272.preferredChannel,
  };
}

function buildStructuredAppointmentHintsV17_90L86(
  appointments: AiAppointmentV17_90L86[] | null | undefined,
  rawText: string,
  reference: IntakeAppointmentReferenceV17_90L271,
): string[] {
  if (!Array.isArray(appointments)) return [];
  const result: string[] = [];

  for (const appointment of appointments) {
    const kind = normalizeContactEvidenceV17_90L86(
      appointment?.art || appointment?.type,
    );
    if (kind && !/\b(?:ausfuehrung|ausführung|execution|work|auftrag|termin)\b/.test(kind)) {
      continue;
    }

    const rawDate = appointment?.datum || appointment?.date || null;
    const rawStart = appointment?.von || appointment?.start || null;
    const rawEnd = appointment?.bis || appointment?.end || null;
    let date = normalizeStructuredAppointmentDateV17_90L86(rawDate);
    const sourceBackedExplicitDate = Boolean(
      date && sourceSupportsAppointmentPartV17_90L86(rawText, rawDate),
    );
    // V17.90L279: An explicit date backed by the customer message is final.
    // Relative weekday resolution is only allowed when no explicit date exists.
    const resolvedRelativeDateV17_90L271 = sourceBackedExplicitDate
      ? null
      : resolveRelativeAppointmentDateV17_90L271({
          appointment,
          reference,
        });
    if (resolvedRelativeDateV17_90L271) {
      date = resolvedRelativeDateV17_90L271.displayDate;
    } else if (!sourceBackedExplicitDate) {
      // A date that is neither explicitly present nor deterministically
      // resolvable from the message-entry date is unsafe and stays empty.
      date = null;
    } else if (date && /\.\d{4}$/.test(date)) {
      const dayMonth = date.match(/^(\d{2})\.(\d{2})\./);
      const explicitYear = date.match(/\.(\d{4})$/)?.[1] || "";
      const sourceHasYear = dayMonth
        ? new RegExp(
            `(?:^|\D)0?${Number(dayMonth[1])}[.\/-]0?${Number(dayMonth[2])}[.\/-]\d{2,4}(?:$|\D)`,
          ).test(rawText) ||
          sourceContainsNamedAppointmentDateV17_90L279({
            source: rawText,
            day: Number(dayMonth[1]),
            month: Number(dayMonth[2]),
            year: explicitYear,
            requireYear: true,
          })
        : false;
      if (!sourceHasYear) date = date.replace(/\.\d{4}$/, ".");
    }
    const start = normalizeStructuredAppointmentTimeV17_90L86(rawStart);
    const end = normalizeStructuredAppointmentTimeV17_90L86(rawEnd);
    const phrase = compactAppointmentPhraseV17_90L270(appointment);
    const phraseStatus = normalizeAppointmentPhraseStatusV17_90L270(
      appointment,
    );
    const evidenceText = [phrase, appointment?.evidence]
      .filter(Boolean)
      .join(" ");
    const vagueEvidence =
      phraseStatus === "vage" ||
      hasExplicitVagueAppointmentEvidenceV17_90L270(evidenceText);
    const daypart = vagueEvidence
      ? null
      : normalizeStructuredAppointmentDaypartV17_90L256(appointment);

    if (!date && !start && !daypart && !phrase && phraseStatus !== "unklar")
      continue;
    // V17.90L103: The first-AI appointment is preserved. Evidence checks may
    // create a review warning, but must not silently remove the appointment
    // from the order or its Important information section.

    const inferredNoticeV17_90L203 = inferAppointmentNoticeV17_90L203(
      appointment,
      rawText,
    );
    const explicitMinutesRaw = Number(
      appointment?.ankuendigung_minuten ??
        appointment?.announcement_minutes ??
        0,
    );
    const minutesRaw =
      Number.isFinite(explicitMinutesRaw) && explicitMinutesRaw > 0
        ? explicitMinutesRaw
        : inferredNoticeV17_90L203.minutes;
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 && minutesRaw <= 240
      ? Math.round(minutesRaw)
      : 0;
    let announcementChannel = normalizeAiContactChannelV17_90L86(
      appointment?.ankuendigung_kanal || appointment?.announcement_channel,
    );
    const appointmentCommunicationEvidenceV17_90L272 =
      normalizeStructuredTextBlock(appointment?.evidence) || rawText;
    const sourceCommunicationV17_90L272 = resolveSourceCommunicationV17_90L272(
      appointmentCommunicationEvidenceV17_90L272,
      announcementChannel,
    );
    if (sourceCommunicationV17_90L272.hasExplicitRule) {
      announcementChannel = sourceCommunicationV17_90L272.preferredChannel;
    }

    // V17.90L203: Contact and appointment structures are checked together.
    // If the structured appointment omitted an explicit notice that is present
    // in its evidence/raw message, preserve it instead of silently dropping it.
    if (!announcementChannel && minutes) {
      announcementChannel =
        inferredNoticeV17_90L203.channel ||
        normalizeAiContactChannelV17_90L86(appointment?.evidence);
    }

    const notice = minutes
      ? `${minutes} Minuten vorher${
          announcementChannel === "sms"
            ? " per SMS melden"
            : announcementChannel === "whatsapp"
              ? " per WhatsApp melden"
              : announcementChannel === "call"
                ? " anrufen"
                : " melden"
        }`
      : "";
    const effectiveStart = vagueEvidence ? null : start;
    const effectiveEnd = vagueEvidence ? null : end;
    const timeRange =
      effectiveStart && effectiveEnd
        ? `${effectiveStart}–${effectiveEnd}`
        : effectiveStart || "";
    // V17.90L270: Display the first AI's exact customer phrase when the time
    // is vague/unclear or when no normalized clock/daypart exists. Never turn
    // "später am Tag" into "nachmittags" after the first-AI boundary.
    const visiblePhraseV17_90L272 = resolvedRelativeDateV17_90L271
      ? stripResolvedRelativeDatePhraseV17_90L272(phrase)
      : phrase;
    const exactPhraseDescriptor =
      visiblePhraseV17_90L272 &&
      (vagueEvidence || phraseStatus === "unklar" || (!timeRange && !daypart))
        ? visiblePhraseV17_90L272
        : "";
    const timeDescriptor =
      timeRange ||
      daypart ||
      exactPhraseDescriptor ||
      (phraseStatus === "unklar" ? "Termin klären" : "");
    const line = `Termin: ${[date, timeDescriptor, notice].filter(Boolean).join(" · ")}`;
    if (!result.some((existing) => normalizeContactEvidenceV17_90L86(existing) === normalizeContactEvidenceV17_90L86(line))) {
      result.push(line);
    }
  }

  return result;
}

function extractStructuredTextValuesV17_90L88B(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      extractStructuredTextValuesV17_90L88B(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "text",
      "hinweis",
      "note",
      "beschreibung",
      "description",
      "value",
      "label",
      "evidence",
      "raw",
      "sourceText",
      "source_text",
    ];
    const preferred = preferredKeys.flatMap((key) =>
      extractStructuredTextValuesV17_90L88B(record[key], depth + 1),
    );
    if (preferred.length > 0) return preferred;
    return Object.values(record).flatMap((entry) =>
      extractStructuredTextValuesV17_90L88B(entry, depth + 1),
    );
  }
  return [];
}

function collectStructuredRoleHintsV17_90L86(auftrag: any): string[] {
  // V17.90L103: Dedicated first-AI role arrays are already atomic business
  // facts. Do not split sentences, merge codes or reclassify them afterwards.
  return dedupeProtectedStructuredRoleLinesV17_90L103([
    ...extractProtectedStructuredRoleValuesV17_90L103(
      auftrag?.zugangshinweise,
    ),
    ...extractProtectedStructuredRoleValuesV17_90L103(
      auftrag?.parkhinweise,
    ),
    ...extractProtectedStructuredRoleValuesV17_90L103(
      auftrag?.sonstige_hinweise,
    ),
  ]).filter((value) => value.length >= 3 && value.length <= 320);
}

function compactText(value: any): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUnitText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBlockText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSemanticText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9€$£\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNormalizedLines(lines: string[]): string[] {
  const seen = new Set<string>();

  return lines
    .map((line) =>
      String(line || "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => {
      const key = normalizeSemanticText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isTechnicalIntakeMetaLineV17_90L17(
  line: string | null | undefined,
): boolean {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;

  // Smartflow regression/test labels are technical harness metadata. They must
  // never become customer-visible notes, addresses or services. This is not a
  // service vocabulary list; it only removes our own test markers.
  return /^\s*(?:regression|testfall|testlauf)\b/i.test(trimmed);
}

function stripInternalTitleLinesFromText(value?: string | null): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      // Interne Karten-/Auftragstitel sind Metadaten. Sie dürfen nicht als
      // Kundennachricht gespeichert und nicht erneut als Leistung interpretiert
      // werden. Das ist keine Leistungs-Wortliste, sondern nur die Entfernung
      // des technischen Markers, den Smartflow selbst erzeugt hatte.
      return (
        !/^\[\s*(?:titel|title)\s*[:：][^\]]*\]\s*$/i.test(trimmed) &&
        !isTechnicalIntakeMetaLineV17_90L17(trimmed)
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type IntakeNormalizationResultV17_49 = {
  translationText: string;
  detectedLanguage: string;
  showTranslationInCustomerMessage: boolean;
};

const EMPTY_INTAKE_NORMALIZATION_V17_49: IntakeNormalizationResultV17_49 = {
  translationText: "",
  detectedLanguage: "",
  showTranslationInCustomerMessage: false,
};

function looksLikePlainGermanCustomerTextV17_53(
  value?: string | null,
): boolean {
  const key = normalizeSemanticText(value || "");
  if (!key) return false;

  const foreignSentenceSignal =
    /\b(?:facture|ex[eé]cution|fattura|esecuzione|merci|veuillez|venire|senza|avviso|contatto|pulizia|nettoyage|d[eé]placement|trasferta|cl[eé]|račun|racun|izvođenje|izvodenje|molim|prije|dolaska|ključ|kljuc|dvorištu|dvoristu|fatur[eë]|ekzekutim|shkruani|para\s+ardhjes|kujdes|çel[eë]si|celesi|fatura|uygulama|gelmeden|anahtar|dikkat|фактура|извршување)\b/i.test(
      key,
    );
  if (foreignSentenceSignal) return false;

  const germanSignals = [
    /\brechnung\b/i,
    /\bausf(?:u|ue|ü)hrung\b/i,
    /\bbitte\b/i,
    /\bnicht\b/i,
    /\bkommen\b/i,
    /\bkontakt\b/i,
    /\bnur\b/i,
    /\bper\b/i,
    /\breinigen\b/i,
    /\banfahrt\b/i,
  ].filter((pattern) => pattern.test(key)).length;

  // Display-only safety: foreign proper names inside otherwise normal German
  // messages must not create a visible translation block. The internal
  // normalised Arbeitsfassung may still be used for validation.
  return germanSignals >= 4;
}

function shouldShowAutomaticTranslationBlockV17_49(args: {
  originalText: string;
  translationText: string;
  detectedLanguage?: string | null;
  targetLanguage: string;
  modelWantsVisibleTranslation?: boolean;
}): boolean {
  const translationText = stripInternalTitleLinesFromText(
    args.translationText || "",
  ).trim();
  if (!translationText) return false;

  const detected = normalizeSemanticText(args.detectedLanguage || "");
  const target = normalizeSemanticText(args.targetLanguage || "Deutsch");

  const detectedClearlyTarget =
    (target.includes("deutsch") || target.includes("german")) &&
    /(?:^|\b)(?:deutsch|standarddeutsch|german)(?:\b|$)/i.test(detected) &&
    !/(?:schweizerdeutsch|dialekt|mundart|swiss\s*german|french|franzoes|franzos|francais|français|italien|italian|italiano|spanisch|spanish|portugies|portuguese|english|englisch|croatian|kroatisch|bosnian|bosnisch|serbian|serbisch|bks|balkan|albanian|albanisch|shqip|turkish|tuerkisch|türkisch|macedonian|mazedonisch|kyrillisch|mixed|mischsprache)/i.test(
      detected,
    );

  if (
    detectedClearlyTarget ||
    looksLikePlainGermanCustomerTextV17_53(args.originalText)
  )
    return false;

  const detectedClearlyDifferentLanguage =
    /(schweizerdeutsch|dialekt|mundart|swiss\s*german|french|franzoes|franzos|francais|français|italien|italian|italiano|spanisch|spanish|portugies|portuguese|english|englisch|croatian|kroatisch|bosnian|bosnisch|serbian|serbisch|bks|balkan|albanian|albanisch|shqip|turkish|tuerkisch|türkisch|macedonian|mazedonisch|kyrillisch|mixed|mischsprache)/i.test(
      detected,
    );

  if (detectedClearlyDifferentLanguage) return true;

  // Mixed texts often contain German service lines but foreign-language headers
  // and access/safety sentences. In that case the visible customer message must
  // still show the German working translation. This is display gating only, not
  // a service decision list.
  const originalKey = normalizeSemanticText(args.originalText || "");
  const hasNonGermanOperationalSentence =
    /\b(?:račun|racun|izvođenje|izvodenje|molim|prije|dolaska|ključ|kljuc|dvorištu|dvoristu|kapiju|potvrde|fatur[eë]|ekzekutim|shkruani|para\s+ardhjes|kujdes|çel[eë]si|celesi|uygulama|gelmeden|anahtar|dikkat|фактура|извршување|пристигнување|клучот)\b/i.test(
      originalKey,
    );
  if (hasNonGermanOperationalSentence) return true;

  // Fail closed for the UI: if the language detector is unsure, keep the
  // normalised Arbeitsfassung internal. Customer messages should not be filled
  // with a visible translation block unless the source was truly non-German or
  // dialectal. This is a display gate, not a service/address word list.
  return Boolean(args.modelWantsVisibleTranslation) && !detectedClearlyTarget;
}

function shouldSkipPaidNormalizationForCleanStandardGermanV17_90L99(args: {
  text: string;
  targetLanguage: string;
}): boolean {
  if (process.env.SMARTFLOW_FORCE_INTAKE_NORMALIZATION === "1") return false;
  const target = normalizeSemanticText(args.targetLanguage || "Deutsch");
  if (!/deutsch|german/.test(target)) return false;

  const text = normalizeSemanticText(args.text || "");
  if (text.length < 80) return false;
  const foreignOrMixedSignals = [
    /\b(?:invoice|work\s+area|onsite|services|appointment|do\s+not|please|travel\s+flat)\b/,
    /\b(?:facture|chantier|contact\s+sur\s+place|seulement|nettoyage|ne\s+pas)\b/,
    /\b(?:fattura|cantiere|contatto|solamente|non\s+chiamare|nuovo)\b/,
    /\b(?:racun|račun|molim|prije|kljuc|ključ|izvodenje|izvođenje)\b/,
    /\b(?:isch|n[oö]d|kei|gsi|bim|huuswart|chli|öppe|vorhär|nume)\b/,
  ];
  if (foreignOrMixedSignals.some((pattern) => pattern.test(text))) return false;

  const germanFunctionWords = text.match(
    /\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|oder|aber|bitte|nicht|keine|bei|beim|vor|nach|wird|werden|ist|sind|liegt|verwenden|anrufen|reinigen|adresse|termin|leistungen)\b/g,
  ) || [];
  return new Set(germanFunctionWords).size >= 8;
}

async function createStandardGermanValidationTranslation(args: {
  text: string;
  targetLanguage: string;
  source: string;
}): Promise<IntakeNormalizationResultV17_49> {
  const rawText = stripInternalTitleLinesFromText(args.text || "").trim();
  const targetLanguage = (args.targetLanguage || "Deutsch").trim() || "Deutsch";
  if (!rawText || !process.env.OPENAI_API_KEY)
    return EMPTY_INTAKE_NORMALIZATION_V17_49;

  try {
    const transRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Du bist der vorgeschaltete Normalisierungs-Schritt für eine Auftragserfassung.
Ziel: Der nachfolgende Validator muss Leistungen, Ausführungsadresse und Hinweise strukturell korrekt lesen können.

Gib NUR gültiges JSON zurück:
{"detected_language":"...","needs_normalization":true/false,"show_customer_translation":true/false,"translation":"..." oder null}

Regeln:
- needs_normalization=true nur, wenn der Text wirklich fremdsprachig, dialektal, deutlich gemischtsprachig oder fachlich so roh ist, dass der nachfolgende Validator ohne Arbeitsfassung Leistungen/Rollen verlieren würde.
- show_customer_translation=true NUR, wenn der sichtbare Kundentext für einen deutschsprachigen Nutzer wirklich übersetzt werden muss, z.B. Französisch, Italienisch, Englisch, Spanisch, Kroatisch/Bosnisch/Serbisch, Albanisch, Türkisch, Mazedonisch, Schweizerdeutsch/Dialekt oder starke Mischsprache.
- Wenn einzelne Leistungszeilen bereits deutsch sind, aber Kopfzeilen/Hinweise/Zugang/Gefahren in einer anderen Sprache stehen, ist es trotzdem Mischsprache: needs_normalization=true und show_customer_translation=true.
- show_customer_translation=false bei normalem Standard-${targetLanguage}, auch wenn darin echte fremdsprachige Eigennamen, Raum-/Gebäudenamen, Firmennamen, Straßennamen oder Ortsnamen vorkommen. Beispiel: "Rue du Lac", "Bâtiment Lumière", "Sala Verde", "Route de Genève" sind Namen und lösen allein keinen sichtbaren Übersetzungsblock aus.
- Übersetze/normalisiere bei needs_normalization=true den kompletten Text nach professionellem Standard-${targetLanguage}.
- Erhalte Struktur, Zeilenumbrüche, Adressblöcke, Telefonnummern, E-Mail, Mengen, Einheiten, Preise, Währungen, Codes und Reihenfolge exakt sinngemäß.
- Zeitliche Bedeutung ist fachlich kritisch: Datum, Uhrzeit, Zeitfenster, Reihenfolge und ausdrücklich benannte Tageszeit müssen semantisch exakt erhalten bleiben. Eine dialektale, fremdsprachige oder gemischte Zeitangabe darf niemals in eine andere Tageszeit umgedeutet werden.
- Eine bloß relative, unbestimmte oder ungefähre Zeitformulierung ist KEINE benannte Tageszeit. Solche Aussagen nur sinngenau erhalten und niemals zu morgens, vormittags, mittags, nachmittags, abends oder nachts konkretisieren.
- Wenn die Bedeutung einer Zeitangabe nicht sicher verstanden wird, den ursprünglichen Ausdruck in der Arbeitsfassung unverändert stehen lassen statt eine Tageszeit zu raten. Die Arbeitsfassung darf dem Original niemals widersprechen.
- Echte Eigennamen, Firmennamen, Gebäudenamen, Straßennamen, Haus-/Trakt-/Raumnamen und Standortnamen exakt behalten, wenn sie als Namen gemeint sind. Nicht aus "Sala Verde" automatisch "Grüner Saal" machen, nicht aus "Bâtiment Les Cèdres" automatisch "Gebäude Les Cèdres" machen.
- Nur frei beschreibende Funktions-/Raumbegriffe normalisieren, wenn sie keine Eigennamen sind und die Bedeutung eindeutig ist. Im Zweifel Originalnamen behalten.
- Leistungszeilen müssen in der Arbeitsfassung als klare fachliche Standard-${targetLanguage}-Arbeitszeilen erscheinen, mit sauberem Verb, z.B. "... reinigen", "... abstauben", "... entfernen", "... streichen" usw., wenn die Handlung aus dem Text hervorgeht.
- Arbeitsobjekt und Kontext dürfen nicht vertauscht werden: Wenn die Zeile Fenster/Tische/Vitrinen im Gang/Sitzungszimmer nennt, muss der sichtbare Leistungsname das Arbeitsobjekt behalten und darf nicht zu einem allgemeinen Bereich wie "Gangbereich reinigen" oder "Besprechungsbereich reinigen" verflachen.
- Ausführungsort-/Arbeitsort-Zeilen dürfen nur Objekt, Räume und Adresse enthalten. Kontaktwege, WhatsApp/SMS/Telefon, Zeitfenster, Zugang, Gefahren und Sonderhinweise bleiben eigene Hinweiszeilen und dürfen nicht an den Ortsnamen angehängt werden.
- Keine neuen Leistungen erfinden. Keine Mengen/Preise ändern. Keine Zeilen zusammenmischen.
- Wenn der Text bereits vollständig sauberes Standard-${targetLanguage} ist, needs_normalization=false, show_customer_translation=false und translation=null.`,
          },
          { role: "user", content: rawText },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 3600,
      }),
    });

    if (!transRes.ok) return EMPTY_INTAKE_NORMALIZATION_V17_49;
    const transResult = await transRes.json();
    const transContent = transResult?.choices?.[0]?.message?.content;
    if (!transContent) return EMPTY_INTAKE_NORMALIZATION_V17_49;

    const transData = JSON.parse(transContent);
    const translation = String(transData?.translation || "").trim();
    if (!transData?.needs_normalization || !translation) {
      return {
        ...EMPTY_INTAKE_NORMALIZATION_V17_49,
        detectedLanguage: String(transData?.detected_language || ""),
      };
    }

    const cleanTranslation = stripInternalTitleLinesFromText(translation);
    const detectedLanguage = String(transData?.detected_language || "");
    const showTranslationInCustomerMessage =
      shouldShowAutomaticTranslationBlockV17_49({
        originalText: rawText,
        translationText: cleanTranslation,
        detectedLanguage,
        targetLanguage,
        modelWantsVisibleTranslation: Boolean(
          transData?.show_customer_translation,
        ),
      });

    console.log(
      `[${args.source}] Intake text normalized from ${detectedLanguage || "unknown"} to ${targetLanguage} (visibleTranslation=${showTranslationInCustomerMessage ? "yes" : "no"})`,
    );
    return {
      translationText: cleanTranslation,
      detectedLanguage,
      showTranslationInCustomerMessage,
    };
  } catch (error) {
    console.error(`[${args.source}] Intake normalization failed:`, error);
    return EMPTY_INTAKE_NORMALIZATION_V17_49;
  }
}

function isNegatedSpecialNoteLine(value: string): boolean {
  const line = normalizeSemanticText(value);
  if (!line) return false;

  return /\b(kein|keine|keinen|keinem|nicht|nie|ohne|no|not|none|without|pas|sans|sin|ningun|ninguna|nessun|nessuna|sem)\b/i.test(
    line,
  );
}

const COMMUNICATION_NEGATION_TOKEN =
  "(?:nicht|kein|keine|keinen|keinem|ohne|no|not|never|none|without|pas|ne\\s+pas|sans|sin|non|nod|noed|ned|nid|nit|nuet|nued)";

const communicationChannelSource = (channel: "whatsapp" | "sms" | "mail") => {
  if (channel === "whatsapp") return "(?:whats\\s*app|whatsapp)";
  if (channel === "sms") return "(?:sms|text\\s+message|kurznachricht)";
  return "(?:mail|e\\s*mail|e-mail|email|courriel)";
};

function isForbiddenChannelInstructionLine(
  value: string | null | undefined,
  channel: "whatsapp" | "sms" | "mail",
): boolean {
  const text = normalizeSemanticText(value);
  if (!text) return false;

  const channelSource = communicationChannelSource(channel);
  if (!new RegExp(`\\b${channelSource}\\b`, "i").test(text)) return false;

  // Kanal-Verbote dürfen nur greifen, wenn die Verneinung semantisch den
  // Kommunikationskanal betrifft. Beispiel Live-Fehler:
  // "WhatsApp an 079..., nicht einfach kommen" ist WhatsApp POSITIV plus
  // separate Zugangsanweisung. Das "nicht" gehört nicht zu WhatsApp.
  const directBeforeChannel = new RegExp(
    `\\b${COMMUNICATION_NEGATION_TOKEN}\\b(?:\\s+(?:bitte|mehr|mehrmals|nur|mehrfach|per|via|ueber|uber|over|mit|auf|durch|kontakt|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,5}\\s+(?:${channelSource})\\b`,
    "i",
  );
  const channelBeforeDirectNo = new RegExp(
    `\\b(?:${channelSource})\\b(?:\\s+(?:bitte|mehr|mehrmals|verwenden|benutzen|nutzen|use|kontaktieren|schreiben|senden|schicken|message|nachricht)){0,6}\\s+\\b${COMMUNICATION_NEGATION_TOKEN}\\b`,
    "i",
  );
  const explicitNoChannel = new RegExp(
    `\\b(?:${channelSource})\\b\\s*(?:nein|verboten|unerwuenscht|unerwünscht|nicht\\s+(?:verwenden|benutzen|nutzen|kontaktieren|schreiben|senden|schicken)|no|not|never)\\b`,
    "i",
  );

  return (
    directBeforeChannel.test(text) ||
    channelBeforeDirectNo.test(text) ||
    explicitNoChannel.test(text)
  );
}

function isPositiveChannelInstructionLine(
  value: string | null | undefined,
  channel: "whatsapp" | "sms" | "mail",
): boolean {
  const text = normalizeSemanticText(value);
  if (!text || isForbiddenChannelInstructionLine(text, channel)) return false;

  const channelSource = communicationChannelSource(channel);
  if (!new RegExp(`\\b${channelSource}\\b`, "i").test(text)) return false;

  const positiveIntent =
    "(?:reicht|genuegt|genuget|bevorzugt|preferred|preferiert|am\\s+besten|best|only|nur|schreiben|senden|schicken|kontakt|kontaktieren|melden)";

  return (
    new RegExp(
      `\\b(?:${channelSource})\\b(?:[-/\\s]+[a-z0-9]+){0,8}[-/\\s]+${positiveIntent}\\b`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b(?:per|via|mit|nur|only)\\s+(?:${channelSource})\\b`,
      "i",
    ).test(text) ||
    new RegExp(
      `\\b${positiveIntent}\\s+(?:per|via|mit)?\\s*(?:${channelSource})\\b`,
      "i",
    ).test(text)
  );
}

function reconcileCommunicationSpecialNoteLines(lines: string[]): string[] {
  const hasForbiddenWhatsApp = lines.some((line) =>
    isForbiddenChannelInstructionLine(line, "whatsapp"),
  );

  return lines.filter((line) => {
    if (
      hasForbiddenWhatsApp &&
      isPositiveChannelInstructionLine(line, "whatsapp")
    ) {
      return false;
    }

    return true;
  });
}

function dedupeSpecialNoteLines(lines: string[]): string[] {
  const cleaned = uniqueNormalizedLines(lines);
  const result: string[] = [];

  for (const line of cleaned.sort((a, b) => b.length - a.length)) {
    const key = normalizeSemanticText(line);
    if (!key) continue;

    const isSubsumed = result.some((existing) => {
      const existingKey = normalizeSemanticText(existing);
      if (!existingKey) return false;
      return existingKey.includes(key) || key.includes(existingKey);
    });

    if (!isSubsumed) result.push(line);
  }

  return result.reverse();
}

// V17.90L103: First-AI structured roles are immutable business data.
// Downstream code may remove only exact formatting duplicates; it may not
// translate, rewrite, split, merge, promote or demote a role statement.
// V17.90L201: Conservative semantic dedupe for original/translation role
// variants. This uses generic string similarity and invariant evidence only;
// it does not contain dialect-, customer- or service-specific word mappings.
function canonicalRoleVariantKeyV17_90L201(value: unknown): string {
  return normalizeSemanticText(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalRoleInvariantTokensV17_90L201(value: unknown): string[] {
  return Array.from(
    new Set(
      canonicalRoleVariantKeyV17_90L201(value).match(/\b\d+(?:[.,]\d+)?\b/g) || [],
    ),
  ).sort();
}

function hasCanonicalRoleNegationV17_90L201(value: unknown): boolean {
  return /\b(?:nicht|kein|keine|keinen|keinem|keiner|ohne|never|not|no|sans|pas|non|sin|senza)\b/i.test(
    canonicalRoleVariantKeyV17_90L201(value),
  );
}

function canonicalRoleEditSimilarityV17_90L201(
  leftValue: unknown,
  rightValue: unknown,
): number {
  const left = canonicalRoleVariantKeyV17_90L201(leftValue);
  const right = canonicalRoleVariantKeyV17_90L201(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  const distance = previous[right.length] || 0;
  return 1 - distance / Math.max(left.length, right.length);
}

function canonicalRoleLinesEquivalentV17_90L201(
  left: unknown,
  right: unknown,
): boolean {
  const leftKey = canonicalRoleVariantKeyV17_90L201(left);
  const rightKey = canonicalRoleVariantKeyV17_90L201(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;

  // Numbers/codes and logical polarity are invariant evidence. A shorter
  // paraphrase must never suppress a different code, parking number or a
  // negated instruction merely because the surrounding wording is similar.
  const leftInvariants = canonicalRoleInvariantTokensV17_90L201(left);
  const rightInvariants = canonicalRoleInvariantTokensV17_90L201(right);
  if (leftInvariants.join("|") !== rightInvariants.join("|")) return false;
  if (hasCanonicalRoleNegationV17_90L201(left) !== hasCanonicalRoleNegationV17_90L201(right)) {
    return false;
  }

  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;
  return canonicalRoleEditSimilarityV17_90L201(leftKey, rightKey) >= 0.82;
}

function translatedRoleEvidenceScoreV17_90L201(
  line: string,
  translationText?: string | null,
): number {
  const lineKey = canonicalRoleVariantKeyV17_90L201(line);
  const translationKey = canonicalRoleVariantKeyV17_90L201(translationText);
  if (!lineKey || !translationKey) return 0;
  if (translationKey.includes(lineKey)) return 3;

  const lineTokens = lineKey.split(/\s+/g).filter((token) => token.length >= 3);
  if (lineTokens.length === 0) return 0;
  const matched = lineTokens.filter((token) => translationKey.includes(token)).length;
  return matched / lineTokens.length >= 0.8 ? 1 : 0;
}

function originalRoleEvidenceScoreV17_90L231(
  line: string,
  originalText?: string | null,
): number {
  const lineKey = canonicalRoleVariantKeyV17_90L201(line);
  const sourceKey = canonicalRoleVariantKeyV17_90L201(originalText);
  if (!lineKey || !sourceKey) return 0;
  if (sourceKey.includes(lineKey)) return 3;

  const lineTokens = lineKey.split(/\s+/g).filter((token) => token.length >= 3);
  if (lineTokens.length === 0) return 0;
  const matched = lineTokens.filter((token) => sourceKey.includes(token)).length;
  return matched / lineTokens.length >= 0.8 ? 1 : 0;
}

function dedupeTranslatedRoleVariantsV17_90L201(
  lines: string[],
  translationText?: string | null,
): string[] {
  const result: string[] = [];

  for (const rawLine of lines) {
    const line = String(rawLine || "").replace(/\s+/g, " ").trim();
    if (!line || /\[object Object\]/i.test(line)) continue;

    const duplicateIndex = result.findIndex((existing) =>
      canonicalRoleLinesEquivalentV17_90L201(existing, line),
    );
    if (duplicateIndex < 0) {
      result.push(line);
      continue;
    }

    const existingLine = result[duplicateIndex];
    const existingScore = translatedRoleEvidenceScoreV17_90L201(
      existingLine,
      translationText,
    );
    const candidateScore = translatedRoleEvidenceScoreV17_90L201(
      line,
      translationText,
    );

    // V17.90L217: When two equivalent role lines carry the same invariant
    // values, keep the semantically more complete evidence. This prevents a
    // short code fragment from erasing an accompanying key/location detail.
    const existingTokens = new Set(roleCoverageTokensV17_90L217(existingLine));
    const candidateTokens = new Set(roleCoverageTokensV17_90L217(line));
    const sameInvariants =
      canonicalRoleInvariantTokensV17_90L201(existingLine).join("|") ===
      canonicalRoleInvariantTokensV17_90L201(line).join("|");
    const candidateSuperset =
      sameInvariants &&
      candidateTokens.size > existingTokens.size &&
      [...existingTokens].every((token) => candidateTokens.has(token));

    if (candidateSuperset || candidateScore > existingScore) {
      result[duplicateIndex] = line;
    }
  }

  return result;
}

function dedupeTranslatedAccessRoleVariantsV17_90L230(
  lines: string[],
  translationText?: string | null,
  originalText?: string | null,
): string[] {
  const base = dedupeTranslatedRoleVariantsV17_90L201(lines, translationText);
  const result: string[] = [];

  for (const line of base) {
    const candidateKinds = accessEvidenceKindsV17_90L217(line);
    const candidateInvariants = canonicalRoleInvariantTokensV17_90L201(line).join("|");
    const candidateScore = translatedRoleEvidenceScoreV17_90L201(
      line,
      translationText,
    );
    const duplicateIndex = result.findIndex((existing) => {
      if (canonicalRoleLinesEquivalentV17_90L201(existing, line)) return true;
      const existingKinds = accessEvidenceKindsV17_90L217(existing);
      if (
        candidateKinds.size !== 1 ||
        existingKinds.size !== 1 ||
        [...candidateKinds][0] !== [...existingKinds][0]
      ) {
        return false;
      }
      if (
        canonicalRoleInvariantTokensV17_90L201(existing).join("|") !==
        candidateInvariants
      ) {
        return false;
      }
      if (
        hasCanonicalRoleNegationV17_90L201(existing) !==
        hasCanonicalRoleNegationV17_90L201(line)
      ) {
        return false;
      }
      const existingScore = translatedRoleEvidenceScoreV17_90L201(
        existing,
        translationText,
      );
      const existingOriginalScore = originalRoleEvidenceScoreV17_90L231(
        existing,
        originalText,
      );
      const candidateOriginalScore = originalRoleEvidenceScoreV17_90L231(
        line,
        originalText,
      );
      // V17.90L231: Establish a translated/original duplicate by evidence
      // provenance instead of a fixed translation dictionary. Role kind,
      // numbers/codes and polarity must already be identical.
      const crossSourcePair =
        (existingScore > 0 && candidateOriginalScore > 0) ||
        (candidateScore > 0 && existingOriginalScore > 0);
      return crossSourcePair || (existingScore > 0) !== (candidateScore > 0);
    });

    if (duplicateIndex < 0) {
      result.push(line);
      continue;
    }
    const existingScore = translatedRoleEvidenceScoreV17_90L201(
      result[duplicateIndex],
      translationText,
    );
    if (candidateScore > existingScore) result[duplicateIndex] = line;
  }

  return result;
}

function preferTranslatedCanonicalRoleVariantsV17_90L201(
  protectedLines: string[],
  candidateLines: string[],
  translationText?: string | null,
): string[] {
  const preferred = protectedLines.map((protectedLine) => {
    const equivalents = candidateLines.filter((candidate) =>
      canonicalRoleLinesEquivalentV17_90L201(protectedLine, candidate),
    );
    return dedupeTranslatedRoleVariantsV17_90L201(
      [protectedLine, ...equivalents],
      translationText,
    )[0] || protectedLine;
  });
  return dedupeTranslatedRoleVariantsV17_90L201(preferred, translationText);
}

function extractTranslatedRoleCandidatesV17_90L202(
  translationText: string | null | undefined,
  role: "access" | "parking" | "other",
): string[] {
  const sentences = String(translationText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÄÖÜ])/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const pattern =
    role === "access"
      ? /\b(?:schlüssel|schluessel|code|zutritt|zugang|eingang|empfang|schlüsselbox|schluesselbox|badge|tor)\b/i
      : role === "parking"
        ? /\b(?:parkieren|parken|parkplatz|besucherplatz|besucherparkplatz|stellplatz|rampe)\b/i
        : /\b(?:leiter|stapler|maschine|material|mitbringen|vor\s+ort|flüssigkeiten|fluessigkeiten|computer|ausstecken|strom|ruhig|schlafen)\b/i;

  return sentences
    .filter((line) => pattern.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:achtung|hinweis|zugang|parken|parkierung)\s*:\s*/i, "")
        .replace(/^[,.\-–—\s]+|[,.\-–—\s]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
}

function preferCompleteTranslatedRoleVariantsV17_90L202(
  lines: string[],
  translationText?: string | null,
): string[] {
  const deduped = dedupeTranslatedRoleVariantsV17_90L201(lines, translationText);
  const tokenSet = (value: string) =>
    new Set(
      canonicalRoleVariantKeyV17_90L201(value)
        .split(/\s+/g)
        .filter(
          (token) =>
            token.length >= 3 &&
            !/^(?:der|die|das|ein|eine|einer|einem|einen|ist|sind|im|in|am|an|bei|beim|zur|zum|nicht|kein|keine|keinen|sondern)$/.test(
              token,
            ),
        ),
    );

  return deduped.filter((line, index, all) => {
    const lineScore = translatedRoleEvidenceScoreV17_90L201(
      line,
      translationText,
    );
    const lineTokens = tokenSet(line);
    const lineInvariants = canonicalRoleInvariantTokensV17_90L201(line).join("|");

    return !all.some((candidate, candidateIndex) => {
      if (candidateIndex === index) return false;
      const candidateScore = translatedRoleEvidenceScoreV17_90L201(
        candidate,
        translationText,
      );
      if (candidateScore <= lineScore) return false;
      if (
        canonicalRoleInvariantTokensV17_90L201(candidate).join("|") !==
        lineInvariants
      ) {
        return false;
      }
      const candidateTokens = tokenSet(candidate);
      const lineIsSubset = [...lineTokens].every((token) =>
        candidateTokens.has(token),
      );
      return lineIsSubset && candidateTokens.size > lineTokens.size;
    });
  });
}


// V17.90L204: Canonical business-fact assembly lives exclusively in
// lib/intake-v2/facts.ts. No second local assembler may rewrite sealed facts.

function dedupeProtectedStructuredRoleLinesV17_90L103(
  lines: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawLine of lines) {
    const line = String(rawLine || "").replace(/\s+/g, " ").trim();
    const key = normalizeSemanticText(line);
    if (!line || !key || seen.has(key) || /\[object Object\]/i.test(line)) {
      continue;
    }
    seen.add(key);
    result.push(line);
  }

  return result;
}

function extractProtectedStructuredRoleValuesV17_90L103(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      extractProtectedStructuredRoleValuesV17_90L103(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const primaryKeys = [
      "text",
      "hinweis",
      "note",
      "beschreibung",
      "description",
      "value",
      "label",
    ];
    for (const key of primaryKeys) {
      const values = extractProtectedStructuredRoleValuesV17_90L103(
        record[key],
        depth + 1,
      );
      if (values.length > 0) return values;
    }

    const evidenceKeys = ["evidence", "raw", "sourceText", "source_text"];
    for (const key of evidenceKeys) {
      const values = extractProtectedStructuredRoleValuesV17_90L103(
        record[key],
        depth + 1,
      );
      if (values.length > 0) return values;
    }
  }
  return [];
}

function isNonActionableSpecialNoteCandidate(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return true;

  if (!isNegatedSpecialNoteLine(normalized)) return false;

  // Negative parking/access facts are still useful operational hints.
  if (
    /\b(kein\s+parkplatz|keine\s+parkplaetze|kein\s+parken|parkverbot|no\s+parking|sin\s+aparcamiento|sans\s+parking|senza\s+parcheggio|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return /\b(hund|dog|chien|perro|cane|cao|cão|oel|oil|huile|aceite|olio|scherben|glass|strom|kabel|wire|leiter|ladder|termin|appointment|schluessel|schlussel|key|parkplatz|parking|zugang|access)\b/i.test(
    normalized,
  );
}

function isNonActionablePlanningHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return true;

  return (
    /\b(parkplatz\s+kein\s+thema|parkplatz\s+nicht\s+wichtig|direkt\s+halten|genug\s+platz|direkt\s+vor\s+dem\s+haus\s+(?:halten|moeglich|moglich))\b/i.test(
      normalized,
    ) ||
    /\b(zugang\s+(?:frei|offen|unproblematisch)|tuer\s+offen|tur\s+offen|kunde\s+ist\s+vor\s+ort)\b/i.test(
      normalized,
    )
  );
}

function isFalseCallbackHint(line: string): boolean {
  const normalized = normalizeSemanticText(line);
  if (!normalized) return false;

  if (
    !/\b(rueckruf|ruckruf|zurueckrufen|telefonisch|anruf|telefon)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  // INTAKE_CALLBACK_NEGATION_SAFE_V16
  // A callback chip is allowed only for a positive request. These phrases are
  // explicit negative/door instructions and must never become "Rückruf".
  return (
    /\b(nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|anrufen)|kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|rueckruf\s+(?:nicht\s+)?(?:noetig|nötig|erwuenscht|erwünscht)|nicht\s+erwuenscht|nicht\s+erwünscht)\b/i.test(
      normalized,
    ) ||
    /\b(klingeln|warten|haupteingang|kunde\s+ist\s+vor\s+ort|kundin\s+ist\s+vor\s+ort|oeffnet\s+die\s+tuer|offnet\s+die\s+tur|an\s+der\s+tuer|schluessel\s+wird\s+.*tuer)\b/i.test(
      normalized,
    )
  );
}

function canonicalizeSpecialNoteLine(line: string): string {
  const original = String(line || "")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeSemanticText(original);
  if (!original || !normalized) return original;

  // Keep stored special notes visible in German. The LLM may occasionally
  // return a mixed-language note although the translated block is German.
  // This guard is phrase-meaning based for recurring safety/access concepts,
  // not a service-word mapping.
  if (
    /\b(paviment|pavimento|pavimento\s+delicato|detergente\s+neutro|detergenti\s+neutri)\b/i.test(
      normalized,
    ) ||
    (/\b(delicat|delicato|delicata|empfindlich|neutro|neutre|neutral)\b/i.test(
      normalized,
    ) &&
      /\b(boden|floor|sol|suelo|paviment|pavimento|reinigungsmittel|detergente|detergent)\b/i.test(
        normalized,
      ))
  ) {
    return "Empfindlicher Boden, neutrales Reinigungsmittel verwenden";
  }

  if (
    /\b(non\s+toccare|ne\s+pas\s+toucher|do\s+not\s+touch|nicht\s+beruehren|nicht\s+berühren)\b/i.test(
      normalized,
    ) &&
    /\b(kabel|cable|cavi|cables|strom|lichtanlage)\b/i.test(normalized)
  ) {
    return /lichtanlage/i.test(normalized)
      ? "Lichtanlage nicht berühren"
      : "Nicht an den Kabeln arbeiten";
  }

  if (
    /\b(accesso|access|acceso|zugang|eingang|garage|porta|tuercode|türcode|code)\b/i.test(
      normalized,
    ) &&
    /\b(code|garage|porta|tuer|tür|eingang|zugang)\b/i.test(normalized)
  ) {
    return original
      .replace(/\bEntrare\s+dal\s+garage\b/gi, "Zugang über die Garage")
      .replace(/\bcodice\s+porta\b/gi, "Türcode")
      .replace(/\baccesso\b/gi, "Zugang")
      .replace(/\bporta\b/gi, "Tür")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (
    /^kontakt\s+vor\s+ort:/i.test(normalized) &&
    /\b(?:kljuc|ključ|celesi|çelesi|key|schluessel|schlussel)\b/i.test(
      normalized,
    )
  ) {
    return /\bhauswart\b/i.test(normalized)
      ? "Schlüssel beim Hauswart"
      : "Schlüssel/Kontakt vor Ort prüfen";
  }

  if (/^kontakt\s+vor\s+ort:/i.test(normalized)) {
    return original
      .replace(/\bist\s+nur\s+und\b/gi, "ist nur Kontaktperson vor Ort und")
      .replace(
        /\bist\s+nur\s*,\s*nicht\b/gi,
        "ist nur Ansprechpartner vor Ort, nicht",
      )
      .replace(/,\s*Tel\.\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // V16.95: Communication instructions are preserved as a structured
  // channel rule: allowed channel + forbidden phone contact. This prevents
  // "Bitte nur per Mail, nicht telefonisch" from being collapsed to the
  // weaker visible note "Mail reicht".
  const mentionsNoPhone =
    /\b(nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|anrufen)|nicht\s+telefonisch|keine?\s+telefonische\s+(?:rueckfrage|ruckfrage|rueckruf|ruckruf|anfrage|kontaktaufnahme)|kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|ne\s+pas\s+appeler|ne\s+pas\s+rappeler|ne\s+pas\s+telephoner|pas\s+d\s+appel(?:s)?|pas\s+d\s+appel(?:s)?\s+telephonique(?:s)?|pas\s+appeler|pas\s+telephoner|sans\s+appel\s+telephonique|merci\s+de\s+ne\s+pas\s+appeler|do\s+not\s+call|dont\s+call|don't\s+call|no\s+phone\s+call|no\s+calls?)\b/i.test(
      normalized,
    );
  const mentionsWhatsApp = /\b(whatsapp|whats\s*app)\b/i.test(normalized);
  const mentionsSms = /\b(sms|text\s+message|kurznachricht)\b/i.test(
    normalized,
  );
  const mentionsMail = /\b(mail|e-mail|email|courriel)\b/i.test(normalized);

  if (mentionsNoPhone && mentionsWhatsApp)
    return "WhatsApp bevorzugt, bitte nicht telefonisch";
  if (mentionsNoPhone && mentionsSms)
    return "SMS reicht, bitte keine telefonische Rückfrage";
  if (mentionsNoPhone && mentionsMail)
    return "Mail reicht, bitte keine telefonische Rückfrage";
  if (mentionsNoPhone) return "Bitte keine telefonische Rückfrage";

  if (/kontakt\s+vor\s+ort.*\bist\s+nur\s*,\s*nicht/i.test(normalized)) {
    return original.replace(
      /\bist\s+nur\s*,\s*nicht/gi,
      "ist nur Ansprechpartner vor Ort, nicht",
    );
  }

  if (/^kontakt\s+vor\s+ort:/i.test(normalized)) {
    return original
      .replace(/,\s*Tel\.\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi, "")
      .replace(
        /\bist\s+nur\s*,\s*nicht/gi,
        "ist nur Ansprechpartner vor Ort, nicht",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  if (
    /\b(whatsapp\s+(?:suffit|reicht|genuegt|genügt)|par\s+whatsapp|via\s+whatsapp|whatsapp\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "WhatsApp reicht";
  }
  if (
    /\b(sms\s+(?:reicht|genuegt|genügt|suffit)|per\s+sms|via\s+sms|sms\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "SMS reicht";
  }
  if (
    /\b(mail\s+(?:reicht|genuegt|genügt|suffit)|email\s+(?:reicht|genuegt|genügt|suffit)|per\s+(?:mail|email)|via\s+(?:mail|email)|mail\s+only|email\s+only)\b/i.test(
      normalized,
    )
  ) {
    return "Mail reicht";
  }

  let german = original
    .replace(/\blundi\b/gi, "Montag")
    .replace(/\bmardi\b/gi, "Dienstag")
    .replace(/\bmercredi\b/gi, "Mittwoch")
    .replace(/\bjeudi\b/gi, "Donnerstag")
    .replace(/\bvendredi\b/gi, "Freitag")
    .replace(/\bsamedi\b/gi, "Samstag")
    .replace(/\bdimanche\b/gi, "Sonntag")
    .replace(/\bmonday\b/gi, "Montag")
    .replace(/\btuesday\b/gi, "Dienstag")
    .replace(/\bwednesday\b/gi, "Mittwoch")
    .replace(/\bthursday\b/gi, "Donnerstag")
    .replace(/\bfriday\b/gi, "Freitag")
    .replace(/\bsaturday\b/gi, "Samstag")
    .replace(/\bsunday\b/gi, "Sonntag");

  if (
    /\b(place\s+de\s+parking|parking)\b/i.test(normalized) &&
    /\b(devant|entree|entrée|eingang|vor)\b/i.test(normalized)
  ) {
    return "Parkplatz vor dem Eingang vorhanden";
  }

  return german.replace(/\s+/g, " ").trim();
}

/**
 * Semantic fallback for safety notes.
 *
 * Primary detection is done by the LLM prompt below:
 * it understands the whole customer message and writes German `gefahren` /
 * `besonderheiten`.
 *
 * This deterministic fallback only prevents obvious operational risks from
 * disappearing when the LLM mixes them into the description or `besonderheiten`.
 * It deliberately writes German notes into specialNotes, so the UI can stay
 * language-independent and display short German chips.
 */

function hasExplicitMailCommunicationInstructionV17_90L70(
  value?: string | null,
): boolean {
  const source = String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\s+/g, " ");
  return /\b(?:(?:nur|bitte|bevorzugt|preferred|only)\s+(?:per\s+|via\s+)?(?:e-?mail|mail)|(?:per|via)\s+(?:e-?mail|mail)|(?:e-?mail|mail)\s+(?:reicht|genuegt|genügt|bevorzugt|preferred|only))\b/i.test(
    source,
  );
}

function isGeneratedMailOnlyHintV17_90L70(value?: string | null): boolean {
  return /^(?:e[-\s]?mail|mail)\s+(?:reicht|genuegt|genügt)(?:\b|[.,;:])/i.test(
    String(value || "").trim(),
  );
}

function cleanOperationalHintForwarderTailV17_90L70(
  value?: string | null,
): string {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const cutPatterns = [
    /(?:^|\s+)(?:und|i|and)?\s*(?:bitte\s+)?(?:mich|mene|me)\b.{0,100}?\bnicht\s+als\s+kunden?\s+speichern\b/i,
    /(?:^|\s+)(?:und|i|and)?\s*(?:ich|ja|i)\s+(?:bin\b.{0,60}?\b(?:leite|schicke|sende)\b|(?:leite|schicke|sende)\b).{0,80}?\bweiter\b/i,
    /(?:^|\s+)(?:ja\s+)?samo\s+(?:šaljem|saljem)\s+weiter\b/i,
    /(?:^|\s+)(?:i\s+am|i['’]?m)\s+[\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,4}\s+(?:from\s+[^.!?]{1,80}\s+)?(?:just\s+)?(?:forwarding|passing\s+(?:this|it)\s+on)[^.!?]{0,140}(?:do\s+not|don['’]?t)\s+save[^.!?]{0,80}(?:as\s+)?(?:a\s+)?customer\b/iu,
    /(?:^|\s+)(?:this\s+is\s+)?[\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,4}\s+(?:from\s+[^.!?]{1,80}\s+)?(?:just\s+)?(?:forwards?|forwarding|passes?\s+on)[^.!?]{0,140}(?:not\s+the\s+customer|do\s+not\s+save[^.!?]{0,80}customer)\b/iu,
  ];

  for (const pattern of cutPatterns) {
    const match = text.match(pattern);
    if (match?.index != null) text = text.slice(0, match.index).trim();
  }

  return text.replace(/[\s,;:\-–—]+$/g, "").trim();
}

type ParkingTargetV17_90L70 = {
  label: string;
  number: string;
};

function extractParkingTargetV17_90L70(
  value?: string | null,
): ParkingTargetV17_90L70 | null {
  const source = String(value || "").replace(/\s+/g, " ");
  const match = source.match(
    /\b(besucherparkplatz|besucherplatz|besucherfeld|lieferantenfeld|ladezone|parkplatz|parking\s+space|stellplatz|platz|rampe)\s*(?:nr\.?|nummer|number)?\s*([A-Za-z]*\d+[A-Za-z0-9-]*)\b/i,
  );
  if (!match?.[1] || !match?.[2]) return null;
  const rawLabel = match[1].toLowerCase();
  const label = rawLabel.includes("rampe")
    ? "Rampe"
    : rawLabel.includes("besucherfeld")
      ? "Besucherfeld"
      : rawLabel.includes("besucher")
        ? "Besucherparkplatz"
        : rawLabel.includes("lieferantenfeld")
          ? "Lieferantenfeld"
          : rawLabel.includes("ladezone")
            ? "Ladezone"
            : rawLabel.includes("parking space") || rawLabel.includes("stellplatz")
              ? "Parkplatz"
              : rawLabel === "platz"
                ? "Platz"
                : "Parkplatz";
  return { label, number: match[2] };
}

function enrichParkingHintsV17_90L70(
  lines: string[],
  sourceText: string,
): string[] {
  const target = extractParkingTargetV17_90L70(sourceText);
  if (!target) return lines;
  const targetText = `${target.label} ${target.number}`;
  let foundParkingHint = false;
  const enriched = lines.map((line) => {
    if (!/\b(?:parkieren|parken|parkplatz|besucherplatz|besucherparkplatz|besucherfeld|lieferantenfeld|ladezone|parking|stellplatz|rampe)\b/i.test(line)) {
      return line;
    }
    foundParkingHint = true;
    if (new RegExp(`\\b${target.number}\\b`).test(line)) return line;
    if (target.label === "Rampe") return `Lieferwagen neben ${targetText} parken`;
    return `Lieferwagen auf ${targetText} parken`;
  });
  if (!foundParkingHint) {
    enriched.push(
      target.label === "Rampe"
        ? `Lieferwagen neben ${targetText} parken`
        : `Lieferwagen auf ${targetText} parken`,
    );
  }
  return enriched;
}

function extractSemanticSpecialNotesFallback(
  text: string | null | undefined,
  onsiteContact?: OnsiteContactHint | null,
): {
  safetyWarnings: string[];
  jobHints: string[];
} {
  const rawText = String(text || "").trim();
  if (!rawText) return { safetyWarnings: [], jobHints: [] };

  const normalizedLines = rawText
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => normalizeSemanticText(line))
    .filter(Boolean);

  const source = normalizedLines.join("\n");
  if (!source) return { safetyWarnings: [], jobHints: [] };

  const actionableLineHas = (subject: RegExp, positiveContext?: RegExp) =>
    normalizedLines.some((line) => {
      if (!subject.test(line)) return false;
      if (isNegatedSpecialNoteLine(line)) return false;
      return positiveContext ? positiveContext.test(line) : true;
    });

  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  const oilSubject = /\b(oel|oil|huile|aceite|olio|oleo|ol|petroleo)\b/i;
  const oilContext =
    /\b(ausgelaufen|leaking|spill(?:ed)?|verschuttet|derrame|fuoriuscit|renverse|boden|floor|sol|suelo|pavimento)\b/i;
  const slipperySubject =
    /\b(rutschig|glatt|slippery|slick|glissant|resbaladiz|scivolos|escorregad|skluz)\b/i;

  const oil =
    actionableLineHas(oilSubject, oilContext) ||
    actionableLineHas(oilContext, oilSubject);
  const slippery = actionableLineHas(slipperySubject);
  if (oil && slippery) {
    safetyWarnings.push("Rutschiger Boden wegen Öl");
  } else if (oil) {
    safetyWarnings.push("Öl auf dem Boden");
  } else if (slippery) {
    safetyWarnings.push("Rutschiger Boden");
  }

  const dogSubject = /\b(hund|dog|chien|perro|cane|cao|cão)\b/i;
  const rawDogLine = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => dogSubject.test(line) && !isNegatedSpecialNoteLine(line));
  if (rawDogLine) {
    // Product rule: every mentioned dog gets the red dog chip, but the
    // customer's statement is kept verbatim. No inferred severity.
    safetyWarnings.push(rawDogLine);
  }

  const electricSubject =
    /\b(strom|elektr|electric|electrical|electricite|electricidad|corriente|elettric|kabel|cable|cables|draht|wire|wires|stromkabel)\b/i;
  const electricDangerContext =
    /\b(offen|blank|frei|defekt|kaputt|danger|peligro|pericol|perigo|dangereux|exposed|open|loose|sichtbar)\b/i;
  if (actionableLineHas(electricSubject, electricDangerContext)) {
    safetyWarnings.push("Offene Stromkabel / Stromgefahr");
  }

  if (actionableLineHas(/\b(asbest|asbestos|amiante|amianto)\b/i)) {
    safetyWarnings.push("Asbestverdacht");
  }

  if (
    actionableLineHas(/\b(schimmel|mold|mould|moisissure|moho|muffa|bolor)\b/i)
  ) {
    safetyWarnings.push("Schimmel");
  }

  if (
    actionableLineHas(
      /\b(chemie|chemisch|chemical|chemicals|chimique|quimic|chimic|produto\s+quimico)\b/i,
    )
  ) {
    safetyWarnings.push("Chemische Stoffe");
  }

  if (
    actionableLineHas(
      /\b(feuer|brand|fire|feu|fuego|fuoco|incendio|incendie)\b/i,
    )
  ) {
    safetyWarnings.push("Brand-/Feuergefahr");
  }

  if (
    actionableLineHas(
      /\b(glasscherben|scherben|broken\s+glass|verre\s+casse|vidrio\s+roto|vetro\s+rotto)\b/i,
    )
  ) {
    safetyWarnings.push("Glasscherben");
  }

  if (
    actionableLineHas(
      /\b(absturz|sturz|fall\s+risk|fallgefahr|chute|caida|caduta)\b/i,
    ) ||
    normalizedLines.some(
      (line) =>
        !isNegatedSpecialNoteLine(line) &&
        /\b(instabil|unstable|instable|inestable|instabile)\b/i.test(line) &&
        /\b(boden|untergrund|floor|sol|suelo|pavimento)\b/i.test(line),
    )
  ) {
    safetyWarnings.push("Sturzgefahr");
  }

  const ladderSubject = /\b(leiter|ladder|echelle|escalera|scala|escada)\b/i;
  const ladderRisk =
    /\b(absturz|sturz|instabil|gefahr|danger|warning|peligro|pericolo|perigo|hauteur|height|hoehe|höhe)\b/i;
  const ladderMaybe =
    /\b(eventuell|evtl|vielleicht|moeglich|möglich|possibly|maybe|peut\s+etre|peut-être|quizas|forse)\b/i;
  if (actionableLineHas(ladderSubject, ladderRisk)) {
    safetyWarnings.push("Leiterarbeit mit zusätzlichem Risiko");
  } else if (actionableLineHas(ladderSubject, ladderMaybe)) {
    jobHints.push("Leiter eventuell benötigt");
  } else if (
    actionableLineHas(
      ladderSubject,
      /\b(benoetigt|benötigt|noetig|nötig|erforderlich|required|needed|necessaire|necesaria|necessaria)\b/i,
    )
  ) {
    jobHints.push("Leiter benötigt");
  } else if (actionableLineHas(ladderSubject)) {
    jobHints.push("Leiter eventuell benötigt");
  }

  const hasExplicitCallback = normalizedLines.some((line) => {
    if (isNegatedSpecialNoteLine(line)) return false;
    if (
      /\b(klingeln|warten|doorbell|ring\s+the\s+bell|sonner|timbre|campanello|campainha)\b/i.test(
        line,
      )
    )
      return false;
    return /\b(rueckruf|ruckruf|zurueckrufen|zurückrufen|call\s+back|please\s+call\s+back|telefonisch\s+(?:anrufen|melden|kontaktieren)|phone\s+back|rappeler|richiamare|devolver\s+la\s+llamada|ligar\s+de\s+volta)\b/i.test(
      line,
    );
  });
  if (hasExplicitCallback) {
    jobHints.push("Rückruf vor Arbeitsbeginn");
  }

  const hasDifficultAccess = normalizedLines.some((line) =>
    /\b(schwer\s+zugaenglich|schwer\s+zugänglich|schwieriger\s+zugang|kein\s+lift|ohne\s+lift|no\s+elevator|no\s+lift|access\s+difficult|difficult\s+access|acces\s+difficile|sin\s+ascensor|senza\s+ascensore|acesso\s+dificil)\b/i.test(
      line,
    ),
  );
  if (hasDifficultAccess) {
    jobHints.push("Schwieriger Zugang");
  }

  if (
    actionableLineHas(
      /\b(hanglage|hang|steigung|slope|pente|pendiente|pendenza|declive)\b/i,
    )
  ) {
    jobHints.push("Hanglage");
  }

  const isNegativeWhatsAppInstruction = (line: string) =>
    isForbiddenChannelInstructionLine(line, "whatsapp");

  const rawOperationalLines = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const nearestCommunicationPhoneV17_90L85 = (rawLine: string) => {
    if (onsiteContact?.phone && onsiteContact.preferredChannel) {
      return onsiteContact.phone;
    }

    const channelMatch = rawLine.match(
      /\b(?:whats\s*app|whatsapp|sms|text\s+message|kurznachricht|anrufen|telefonieren|call)\b/i,
    );
    const phoneMatches = Array.from(
      rawLine.matchAll(/\+?\d[\d\s()./-]{6,}\d/g),
    )
      .map((match) => ({
        phone: String(match[0] || "").replace(/\s+/g, " ").trim(),
        index: match.index || 0,
      }))
      .filter(({ phone }) => {
        const digits = normalizePhoneDigits(phone);
        return digits.length >= 7 && digits.length <= 15;
      });

    if (phoneMatches.length === 0) return undefined;
    if (!channelMatch || channelMatch.index == null) return phoneMatches[0].phone;

    return phoneMatches.sort(
      (left, right) =>
        Math.abs(left.index - (channelMatch.index || 0)) -
        Math.abs(right.index - (channelMatch.index || 0)),
    )[0]?.phone;
  };

  for (const rawLine of rawOperationalLines) {
    const line = normalizeSemanticText(rawLine);
    if (!line) continue;
    const phone = nearestCommunicationPhoneV17_90L85(rawLine);
    const hasNoPhoneInstruction =
      /bitte\s+nicht\s+anrufen|nicht\s+anrufen|nicht\s+telefonisch|keine\s+telefonische\s+rueckfrage|keine\s+telefonische\s+ruckfrage|ne\s+pas\s+appeler|ne\s+pas\s+telephoner|pas\s+d\s+appel(?:s)?|pas\s+d\s+appel(?:s)?\s+telephonique(?:s)?|pas\s+appeler|pas\s+telephoner|sans\s+appel\s+telephonique|do\s+not\s+call|no\s+calls?/i.test(
        line,
      );
    const hasNegativeWhatsAppInstruction = isNegativeWhatsAppInstruction(line);

    if (hasNegativeWhatsAppInstruction) {
      jobHints.push(
        /telefon|aaluete|anluete|klingeln|anrufen/i.test(line)
          ? "Kein WhatsApp; lieber Telefonkontakt"
          : "Keine WhatsApp",
      );
      continue;
    }

    if (hasNoPhoneInstruction && /whats\s*app/i.test(line)) {
      jobHints.push("Nicht telefonisch zurückrufen, WhatsApp bevorzugt");
    } else if (
      hasNoPhoneInstruction &&
      /(mail|e\s*mail|email|courriel)/i.test(line)
    ) {
      jobHints.push("Mail reicht, bitte keine telefonische Rückfrage");
    } else if (hasNoPhoneInstruction && /\bsms\b/i.test(line)) {
      jobHints.push("Nicht telefonisch zurückrufen, SMS reicht");
    } else if (hasNoPhoneInstruction) {
      jobHints.push("Bitte keine telefonische Rückfrage");
    }

    if (
      /(?:nicht|noed|nöd|ned|nid|nit)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)|(?:nicht|noed|nöd|ned|nid|nit)\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)|vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)/i.test(
        line,
      )
    ) {
      const parts: string[] = [];
      if (
        /(?:nicht|noed|nöd|ned|nid|nit)\s+einfach\s+(?:kommen|vorbeikommen|cho|verbi\s+cho)/i.test(
          line,
        )
      )
        parts.push("Nicht einfach kommen");
      if (
        /(?:nicht|noed|nöd|ned|nid|nit)\s+ohne\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)|erst\s+nach\s+(?:ruecksprache|rucksprache|absprache)\s+(?:kommen|vorbeikommen|cho)/i.test(
          line,
        )
      )
        parts.push("Nicht ohne Rücksprache kommen");
      if (
        /vor\s+(?:start|arbeitsbeginn|ankunft)\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:melden|anrufen|kontaktieren)/i.test(
          line,
        )
      )
        parts.push("Vor Arbeitsbeginn telefonisch melden");
      const timeMatch = rawLine.match(
        /(?:erst\s+)?(?:ab|nach)\s*(\d{1,2})(?:[:.\s]+(\d{2}))?\s*(?:uhr|h)?\b/i,
      );
      if (timeMatch?.[1]) {
        parts.push(
          `erst ab ${timeMatch[1].padStart(2, "0")}:${timeMatch[2] || "00"}`,
        );
      }
      if (isNegativeWhatsAppInstruction(line)) parts.push("keine WhatsApp");
      jobHints.push(parts.length ? parts.join(", ") : "Vorher melden");
    }

    if (
      /nur\s+whats\s*app|whats\s*app.*nicht\s+anrufen|nicht\s+anrufen.*whats\s*app/i.test(
        line,
      )
    ) {
      jobHints.push(
        phone
          ? `Nur WhatsApp, nicht anrufen: ${phone}`
          : "Nur WhatsApp, nicht anrufen",
      );
      continue;
    }

    if (/whats\s*app/i.test(line) && phone) {
      jobHints.push(`WhatsApp bevorzugt: ${phone}`);
    }

    if (isPositiveChannelInstructionLine(rawLine, "sms")) {
      jobHints.push(
        phone ? `SMS bevorzugt: ${phone}` : "SMS bevorzugt",
      );
    }

    if (
      /(mail|e\s*mail|email)/i.test(line) &&
      /keine\s+telefonische|nicht\s+telefonisch|nicht\s+anrufen|no\s+calls?|do\s+not\s+call/i.test(
        line,
      )
    ) {
      jobHints.push("Mail reicht, bitte keine telefonische Rückfrage");
    } else if (
      /(mail|e\s*mail|email)/i.test(line) &&
      /reicht|only|nur|preferred|bevorzugt/i.test(line)
    ) {
      jobHints.push("Mail reicht");
    }

    if (
      hasNoPhoneInstruction &&
      !/(whats\s*app|\bsms\b|mail|e\s*mail|email|courriel)/i.test(line)
    ) {
      jobHints.push(
        /keine\s+telefonische|nicht\s+telefonisch|pas\s+d\s+appel|pas\s+appeler|ne\s+pas|no\s+calls?|do\s+not\s+call/i.test(
          line,
        )
          ? "Bitte keine telefonische Rückfrage"
          : "Bitte nicht anrufen",
      );
    }

    if (
      /no\s+calls?\s+during\s+office\s+hours|keine\s+anrufe\s+waehrend\s+der\s+buerozeiten|keine\s+anrufe\s+waehrend\s+der\s+bürozeiten/i.test(
        line,
      )
    ) {
      jobHints.push("Keine Anrufe während der Bürozeiten");
    }
  }

  const specificParkingLine = normalizedLines.find(
    (line) =>
      /\b(?:parkieren|parken|parking)\b/i.test(line) &&
      /\b(?:platz|besucherplatz|parkplatz|place)\b/i.test(line) &&
      /\b\d+\b/.test(line),
  );
  if (specificParkingLine) {
    const placeMatch = specificParkingLine.match(
      /\b(?:platz|besucherplatz|parkplatz|place)\s*(\d+)\b/i,
    );
    jobHints.push(
      placeMatch
        ? `Parkieren nur auf Platz ${placeMatch[1]}`
        : "Parkhinweis beachten",
    );
  }

  const hasGoodParking = normalizedLines.some(
    (line) =>
      !isNegatedSpecialNoteLine(line) &&
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(vorhanden|reserviert|frei|innenhof|available|reserved|courtyard|disponible|riservato)\b/i.test(
        line,
      ),
  );
  const hasBadParking = normalizedLines.some(
    (line) =>
      !isNonActionablePlanningHint(line) &&
      /\b(parkplatz|parking|aparcamiento|parcheggio)\b/i.test(line) &&
      /\b(schwierig|kein|keine|parkverbot|difficult|no\s+parking|sin|sans|senza)\b/i.test(
        line,
      ),
  );
  if (hasGoodParking) {
    jobHints.push("Parkplatz vorhanden oder reserviert");
  } else if (hasBadParking) {
    jobHints.push("Parkplatz schwierig");
  }

  for (const rawLine of rawOperationalLines) {
    const line = normalizeSemanticText(rawLine);
    if (!line) continue;
    const isAccessOrCodeHint =
      /\b(?:zugang|zufahrt|eingang|seitentor|gartentor|torcode|codebox|code|schluessel|schlüssel|briefkasten|garage)\b/i.test(
        line,
      );
    const isPricingOrServiceLine =
      /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|meter|laufmeter|stunden?|std\.?|stueck|stück|stk)\b/i.test(
        rawLine,
      ) ||
      /\b(?:chf|eur|euro|franken|stutz)\s*\d|\d\s*(?:chf|eur|euro|franken|stutz)\b/i.test(
        rawLine,
      );

    if (isAccessOrCodeHint && !isPricingOrServiceLine) {
      jobHints.push(rawLine.replace(/\s+/g, " ").trim());
    }
  }

  return {
    safetyWarnings: dedupeSpecialNoteLines(safetyWarnings),
    jobHints: dedupeSpecialNoteLines(jobHints),
  };
}

function isLikelySafetyWarning(line: string): boolean {
  return extractSemanticSpecialNotesFallback(line).safetyWarnings.length > 0;
}

function detectQuantityUnitFromText(text: string): {
  value: number | null;
  unit: string | null;
  raw: string | null;
} {
  const source = normalizeUnitText(text);
  if (!source) return { value: null, unit: null, raw: null };

  const patterns = [
    {
      unit: "square_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|qm|quadratmeter|quadrat meter)\b/i,
    },
    {
      unit: "cubic_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m3|m³|kubikmeter|kubik meter|cbm)\b/i,
    },
    { unit: "hour", re: /(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\.?|h)\b/i },
    {
      unit: "day",
      re: /(\d+(?:[.,]\d+)?)\s*(?:tage|tag|arbeitstage|arbeitstag)\b/i,
    },
    { unit: "meter", re: /(\d+(?:[.,]\d+)?)\s*(?:laufmeter|lfm|meter|m)\b/i },
    { unit: "kilogram", re: /(\d+(?:[.,]\d+)?)\s*(?:kilogramm|kg)\b/i },
    { unit: "ton", re: /(\d+(?:[.,]\d+)?)\s*(?:tonnen|tonne|to\.?|t)\b/i },
    { unit: "liter", re: /(\d+(?:[.,]\d+)?)\s*(?:liter|ltr\.?|l)\b/i },
    {
      unit: "piece",
      re: /(\d+(?:[.,]\d+)?)\s*(?:stueck|stück|stuck|stk|anzahl|einheiten|baeume|bäume|baume|baum)\b/i,
    },
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern.re);
    if (match?.[1]) {
      return {
        value: Number(match[1].replace(",", ".")),
        unit: pattern.unit,
        raw: match[0],
      };
    }
  }

  return { value: null, unit: null, raw: null };
}

function validateQuantityAgainstServiceUnit(args: {
  serviceUnit?: string | null;
  detectedValue?: number | null;
  detectedUnit?: string | null;
  serviceName?: string | null;
}) {
  const serviceUnit = normalizeUnitText(args.serviceUnit);
  const detectedValue =
    typeof args.detectedValue === "number" &&
    isFinite(args.detectedValue) &&
    args.detectedValue > 0
      ? args.detectedValue
      : null;
  const detectedUnit = normalizeUnitText(args.detectedUnit);

  const serviceUnitType = getServiceUnitType(args.serviceUnit ?? null);

  if (serviceUnitType === "flat") {
    return {
      quantity: 0,
      needsReview: !!detectedValue,
      reason: detectedValue
        ? "Menge_erkannt_aber_Leistung_ist_pauschal"
        : (null as string | null),
    };
  }

  if (!detectedValue || !detectedUnit) {
    return {
      quantity: 0,
      needsReview: false,
      reason: null as string | null,
    };
  }

  if (serviceUnitType === detectedUnit) {
    return {
      quantity: detectedValue,
      needsReview: false,
      reason: null as string | null,
    };
  }

  const reasonByServiceUnit: Record<string, string> = {
    hour: "Menge_erkannt_aber_Leistung_basiert_auf_Stunden",
    day: "Menge_erkannt_aber_Leistung_basiert_auf_Tagen",
    meter: "Menge_erkannt_aber_Leistung_basiert_auf_Metern",
    square_meter: "Menge_erkannt_aber_Leistung_basiert_auf_Quadratmetern",
    cubic_meter: "Menge_erkannt_aber_Leistung_basiert_auf_Kubikmetern",
    piece: "Menge_erkannt_aber_Leistung_basiert_auf_Stueck",
    kilogram: "Menge_erkannt_aber_Leistung_basiert_auf_Kilogramm",
    ton: "Menge_erkannt_aber_Leistung_basiert_auf_Tonnen",
    liter: "Menge_erkannt_aber_Leistung_basiert_auf_Litern",
    unknown: "Menge_erkannt_aber_Leistungseinheit_unbekannt",
  };

  return {
    quantity: 0,
    needsReview: true,
    reason: reasonByServiceUnit[serviceUnitType] || reasonByServiceUnit.unknown,
  };
}

function getServiceUnitType(serviceUnit?: string | null): string {
  const unit = normalizeUnitText(serviceUnit);

  const unitAliases: Record<string, string[]> = {
    flat: ["pauschal", "fixpreis", "festpreis", "pauschale"],
    square_meter: [
      "quadratmeter",
      "quadradmeter",
      "qm",
      "m2",
      "m²",
      "flaeche",
      "fläche",
    ],
    cubic_meter: ["kubikmeter", "cbm", "m3", "m³", "volumen"],
    kilogram: ["kilogramm", "kg"],
    ton: ["tonne", "tonnen", "to", "t"],
    liter: ["liter", "ltr", "l"],
    hour: ["stunde", "stunden", "std", "h", "stundensatz"],
    day: ["tag", "tage", "arbeitstag", "arbeitstage", "tagessatz"],
    meter: ["meter", "laufmeter", "lfm", "m"],
    piece: [
      "stueck",
      "stück",
      "stuck",
      "stk",
      "piece",
      "pieces",
      "piece",
      "pieces",
      "vitre",
      "vitres",
      "fenetre",
      "fenetres",
      "window",
      "windows",
      "anzahl",
      "einheit",
      "einheiten",
      "raum",
      "raeume",
      "räume",
      "zimmer",
      "room",
      "rooms",
    ],
  };

  for (const [type, aliases] of Object.entries(unitAliases)) {
    if (aliases.some((alias) => unit === alias)) return type;
  }

  for (const [type, aliases] of Object.entries(unitAliases)) {
    if (
      aliases.some((alias) => {
        // SMARTFLOW_V17_90L371AP: Never match short unit aliases such as
        // "t", "l", "h" or "m" as substrings inside free units like
        // "Kanister". Short aliases are already handled by the exact pass
        // above; the loose pass is only safe for longer words.
        if (alias.length < 3) return false;
        return unit.includes(alias);
      })
    ) {
      return type;
    }
  }

  return "unknown";
}

function detectUnitPriceFromText(text: string): number | null {
  const source = normalizeUnitText(text);
  if (!source) return null;

  const unitWords =
    "(?:stueck|stück|stuck|stk|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|stunde|stunden|std|hour|hours|tag|tage|day|days|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";

  const joinWords = "(?:pro|je|per|par|à|a|/)";

  const priceNumber = "(\\d+(?:[.,]\\d{1,2})?)";

  const patterns = [
    // Stundenpreis 110 CHF / Stundensatz von 95 CHF / Satz pro Stunde 80 CHF
    new RegExp(
      `(?:stundenpreis|stundensatz|satz\\s+pro\\s+stunde)\\s*(?:von|=|:)?\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ),

    // Stundensatz von 95 CHF / Tagessatz 700 CHF
    new RegExp(
      `(?:stundensatz|tagessatz|quadratmeterpreis|kubikmeterpreis|meterpreis|stueckpreis|stückpreis|kilopreis|kilogrammpreis|tonnenpreis|literpreis)\\s*(?:von|=|:)?\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ),
    // 14 CHF pro qm
    new RegExp(
      `${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // CHF 14 pro qm
    new RegExp(
      `${currencyWords}\\s*${priceNumber}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // zu 14 CHF pro qm
    new RegExp(
      `(?:preis|kostet|kosten|zu|fuer|für|a|à)\\s*(?:je\\s+)?${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),

    // Preis von 14 CHF pro qm
    new RegExp(
      `(?:preis\\s+von|price\\s+of)\\s*${priceNumber}\\s*${currencyWords}\\s*${joinWords}\\s*${unitWords}`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      const value = Number(match[1].replace(",", "."));

      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }

  return null;
}

// INTAKE_CURRENCY_ONLY_EUR_FIX_V13
function stripNonPricingCurrencyContextForIntake(
  text: string | null | undefined,
): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Titel/Notizen sind Test- oder Metadaten und dürfen keine Währung setzen.
      // Beispiel: "[Titel: CHF gewinnt trotz EUR Einstellung]" darf aus einem
      // sauber bepreisten CHF-Auftrag keinen CHF/EUR-Konflikt machen.
      return !/^\s*\[?\s*(?:titel|title)\s*:/i.test(trimmed);
    })
    .join("\n");
}

function stripNegatedCurrencyMentionsForIntake(
  text: string | null | undefined,
): string {
  let source = normalizeUnitText(stripNonPricingCurrencyContextForIntake(text));
  if (!source) return "";

  // Negative currency instructions are not real order currencies.
  // Example: "Leistung komplett in EUR ... bitte nicht in CHF umrechnen"
  // should be EUR-only, not CHF+EUR conflict.
  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|us-dollar|dollar|us\\$|\\$|gbp|pfund|pound|british\\s+pound|£)";

  const negatedCurrencyPatterns = [
    new RegExp(
      `\\b(?:nicht|kein|keine|keinen|ohne|not|no|dont|don't|do\\s+not|pas|ne\\s+pas)\\s+(?:in|als|auf|zu|nach|to|as|en)?\\s*${currencyWords}\\b`,
      "gi",
    ),
    new RegExp(`\\b(?:not|no|nicht)\\s+${currencyWords}\\b`, "gi"),
    new RegExp(
      `\\b(?:nicht|not|no)\\s+(?:umrechnen|convert|converted|conversion)\\s+(?:in|to)?\\s*${currencyWords}\\b`,
      "gi",
    ),
    new RegExp(
      `\\b${currencyWords}\\s+(?:nicht|not|no)\\s+(?:verwenden|benutzen|use|take|nehmen|umrechnen|convert)\\b`,
      "gi",
    ),
  ];

  for (const pattern of negatedCurrencyPatterns) {
    source = source.replace(pattern, " ");
  }

  return source.replace(/\s+/g, " ").trim();
}

const INTAKE_PRICE_NUMBER_FOR_CURRENCY = "\\d+(?:[.,]\\d{1,2})?";
const INTAKE_CHF_WORDS_FOR_CURRENCY = "(?:chf|franken|fr\\.?|sfr\\.?|stutz)";
const INTAKE_EUR_WORDS_FOR_CURRENCY = "(?:eur|euro|€)";

function hasExplicitCurrencyAmountForIntake(
  source: string,
  currencyWords: string,
): boolean {
  return (
    new RegExp(
      `\\b${currencyWords}\\s*${INTAKE_PRICE_NUMBER_FOR_CURRENCY}\\b`,
      "i",
    ).test(source) ||
    new RegExp(
      `\\b${INTAKE_PRICE_NUMBER_FOR_CURRENCY}\\s*${currencyWords}\\b`,
      "i",
    ).test(source)
  );
}

function detectCurrencyFromText(
  text: string | null | undefined,
): "CHF" | "EUR" | null {
  const source = stripNegatedCurrencyMentionsForIntake(text);

  if (!source) return null;

  const hasExplicitChf = hasExplicitCurrencyAmountForIntake(
    source,
    INTAKE_CHF_WORDS_FOR_CURRENCY,
  );
  const hasExplicitEur = hasExplicitCurrencyAmountForIntake(
    source,
    INTAKE_EUR_WORDS_FOR_CURRENCY,
  );

  // Preisnahe Währungen sind stärker als Währungswörter in Kundennamen/Titeln.
  // So bleibt "CHF Trotz EUR AG" mit "Fenster ... CHF 5" ein CHF-Auftrag.
  if (hasExplicitChf || hasExplicitEur) {
    if (hasExplicitChf && !hasExplicitEur) return "CHF";
    if (hasExplicitEur && !hasExplicitChf) return "EUR";
    return null;
  }

  const hasChf = /\b(chf|franken|fr\.?|sfr\.?|stutz)\b/i.test(source);
  const hasEur = /\b(eur|euro)\b|€/i.test(source);

  if (hasChf && !hasEur) return "CHF";
  if (hasEur && !hasChf) return "EUR";

  return null;
}

function findOriginalSegmentForWorkItem(
  item: {
    raw?: string | null;
    name?: string | null;
    evidence?: string | null;
    source_text?: string | null;
    context?: string | null;
  },
  fullText: string,
): string | null {
  const sourceBlock = normalizeBlockText(fullText);
  if (!sourceBlock) return null;

  const itemName = normalizeUnitText(item.name || "");
  const raw = normalizeUnitText(item.raw || "");
  const evidence = normalizeUnitText(item.evidence || item.source_text || "");
  const context = normalizeUnitText(item.context || "");

  const itemWords = [itemName, raw, evidence, context]
    .join(" ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
    .filter(
      (w) =>
        ![
          "chf",
          "euro",
          "eur",
          "stunde",
          "stunden",
          "std",
          "preis",
          "reinigen",
          "reinigung",
          "bitte",
          "auftrag",
        ].includes(w),
    );

  if (itemWords.length === 0) return null;

  const lineSegments = sourceBlock
    .split(/\n+|;/g)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  const broadSegments = sourceBlock
    .split(
      /\n{2,}|;|\bdanach\b|\bzusaetzlich\b|\bzusätzlich\b|\banschliessend\b|\banschließend\b|\bthen\b|\bafterwards\b|\badditional(?:ly)?\b|\balso\b|\bensuite\b|\bpuis\b|\bsupplémentaire\b|\badditionnel\b|\bpoi\b|\binoltre\b|\baggiuntivo\b/gi,
    )
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  const segments = Array.from(new Set([...lineSegments, ...broadSegments]));

  let best: { segment: string; score: number } | null = null;

  for (const segment of segments) {
    let score = 0;

    for (const word of itemWords) {
      if (segment.includes(word)) score += 10;
    }

    if (itemName && segment.includes(itemName)) score += 40;
    if (raw && segment.includes(raw)) score += 30;
    if (evidence && segment.includes(evidence)) score += 20;
    if (context && segment.includes(context)) score += 10;

    if (detectAllQuantityUnitsFromText(segment).length > 0) score += 12;
    if (detectUnitPriceFromText(segment)) score += 12;

    // Prefer a real service line over a whole-message block. Whole-message
    // matches can contain several quantities and caused explicit hour values
    // such as "3.5 Stunden" to be lost or mixed with neighbouring lines.
    if (segment.length > 280) score -= 30;
    if (countUnitPriceSignals(segment) > 1) score -= 25;

    if (!best || score > best.score) {
      best = { segment, score };
    }
  }

  return best && best.score >= 10 ? best.segment : null;
}

function findColonBlockForWorkItem(
  item: { raw?: string | null; name?: string | null },
  fullText: string,
): string | null {
  const source = normalizeBlockText(fullText);
  if (!source) return null;

  const itemName = normalizeUnitText(item.name || "");
  const raw = normalizeUnitText(item.raw || "");
  const searchText = [itemName, raw].filter(Boolean).join(" ");

  const keywords = searchText
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  if (keywords.length === 0) return null;

  const blocks = source
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter((b) => b.length >= 8);

  let best: { block: string; score: number } | null = null;

  for (const block of blocks) {
    let score = 0;
    const normalizedBlock = normalizeUnitText(block);
    const firstLine = normalizeUnitText(block.split("\n")[0] || "");

    for (const keyword of keywords) {
      if (normalizedBlock.includes(keyword)) score += 10;
      if (firstLine.includes(keyword)) score += 20;
    }

    if (itemName && normalizedBlock.includes(itemName)) score += 60;
    if (itemName && firstLine.includes(itemName)) score += 80;
    if (raw && normalizedBlock.includes(raw)) score += 40;
    if (block.includes(":")) score += 20;

    if (!best || score > best.score) {
      best = { block, score };
    }
  }

  return best && best.score >= 30 ? best.block : null;
}

function countUnitPriceSignals(text: string | null | undefined): number {
  const source = normalizeUnitText(text || "");
  if (!source) return 0;

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";
  const unitJoin = "(?:pro|je|per|par|à|a|/)";
  const unitWords =
    "(?:stueck|stück|stuck|stk|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|qm|m2|m²|meter|laufmeter|lfm|stunde|stunden|std|tag|tage|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const patterns = [
    new RegExp(
      `\\d+(?:[.,]\\d{1,2})?\\s*${currencyWords}\\s*${unitJoin}\\s*${unitWords}`,
      "gi",
    ),
    new RegExp(
      `${currencyWords}\\s*\\d+(?:[.,]\\d{1,2})?\\s*${unitJoin}\\s*${unitWords}`,
      "gi",
    ),
  ];

  return patterns.reduce(
    (sum, pattern) => sum + Array.from(source.matchAll(pattern)).length,
    0,
  );
}

function parseStructuredUnitPrice(value: unknown): number | null {
  const parsed = Number(
    String(value ?? "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectUnitPriceForWorkItem(
  item: {
    raw?: string | null;
    name?: string | null;
    unit_price?: number | string | null;
    currency?: string | null;
    evidence?: string | null;
    source_text?: string | null;
  },
  fullText: string,
): number | null {
  const evidenceText = [item.source_text, item.evidence, item.raw]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const evidencePrice = detectUnitPriceFromText(evidenceText);
  if (evidencePrice) return evidencePrice;

  // Strukturierter KI-Preis ist nur zweite Wahl. Er wird später in
  // lib/order-intake-validation.ts nochmals gegen Evidence/Währung geprüft.
  const structuredPrice = parseStructuredUnitPrice(item.unit_price);
  if (structuredPrice && evidenceText) return structuredPrice;

  const localText = [item.raw, item.name].filter(Boolean).join(" ");
  const localPrice = detectUnitPriceFromText(localText);
  if (localPrice) return localPrice;

  const originalSegment = findOriginalSegmentForWorkItem(item, fullText);
  if (originalSegment && countUnitPriceSignals(originalSegment) <= 1) {
    const segmentPrice = detectUnitPriceFromText(originalSegment);
    if (segmentPrice) return segmentPrice;
  }

  const colonBlock = findColonBlockForWorkItem(item, fullText);
  if (
    colonBlock &&
    colonBlock.length <= 240 &&
    countUnitPriceSignals(colonBlock) <= 1
  ) {
    return detectUnitPriceFromText(colonBlock);
  }

  return null;
}

function hasAmbiguousCompactLinePrice(
  text: string | null | undefined,
): boolean {
  const source = normalizeUnitText(text || "");
  if (!source) return false;

  const hasExplicitUnitPriceSignal =
    /\b(pro|je|per|par|stundensatz|tagessatz|quadratmeterpreis|kubikmeterpreis|meterpreis|stueckpreis|stückpreis|kilopreis|kilogrammpreis|tonnenpreis|literpreis)\b/i.test(
      source,
    );

  if (hasExplicitUnitPriceSignal) return false;

  const unitWords =
    "(?:stueck|stück|stuck|stk|einheit|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|quadratmeter|quadratmetern|qm|m2|m²|sqm|kubikmeter|kubikmetern|cbm|meter|laufmeter|lfm|m|stunde|stunden|std|h|tag|tage|kg|kilogramm|tonne|tonnen|liter|ltr)";

  const currencyWords =
    "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€|usd|dollar|\\$|gbp|pfund|£)";

  const quantityNumber = "\\d+(?:[.,]\\d+)?";
  const priceNumber = "\\d+(?:[.,]\\d{1,2})?";

  return (
    new RegExp(
      `${quantityNumber}\\s*${unitWords}\\s*${currencyWords}\\s*${priceNumber}`,
      "i",
    ).test(source) ||
    new RegExp(
      `${quantityNumber}\\s*${unitWords}\\s*${priceNumber}\\s*${currencyWords}`,
      "i",
    ).test(source)
  );
}

function detectAllQuantityUnitsFromText(
  text: string,
): Array<{ value: number; unit: string; raw: string }> {
  const source = normalizeUnitText(text);
  if (!source) return [];

  const patterns = [
    {
      unit: "square_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m2|m²|qm|quadratmeter|quadrat meter)\b/gi,
    },
    {
      unit: "cubic_meter",
      re: /(\d+(?:[.,]\d+)?)\s*(?:m3|m³|kubikmeter|kubik meter|cbm)\b/gi,
    },
    { unit: "hour", re: /(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\.?|h)\b/gi },
    {
      unit: "day",
      re: /(\d+(?:[.,]\d+)?)\s*(?:tage|tag|arbeitstage|arbeitstag)\b/gi,
    },
    { unit: "meter", re: /(\d+(?:[.,]\d+)?)\s*(?:laufmeter|lfm|meter|m)\b/gi },
    { unit: "kilogram", re: /(\d+(?:[.,]\d+)?)\s*(?:kilogramm|kg)\b/gi },
    { unit: "ton", re: /(\d+(?:[.,]\d+)?)\s*(?:tonnen|tonne|to\.?|t)\b/gi },
    { unit: "liter", re: /(\d+(?:[.,]\d+)?)\s*(?:liter|ltr\.?|l)\b/gi },
    {
      unit: "piece",
      re: /(\d+(?:[.,]\d+)?)\s*(?:stueck|stück|stuck|stk|piece|pieces|pi[eè]ce|pi[eè]ces|vitre|vitres|fenetre|fenetres|window|windows|anzahl|einheiten|baeume|bäume|baume|baum)\b/gi,
    },
  ];

  const matches: Array<{
    value: number;
    unit: string;
    raw: string;
    start: number;
    end: number;
  }> = [];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.re)) {
      if (!match?.[1]) continue;

      const start = match.index ?? -1;
      const end = start >= 0 ? start + match[0].length : -1;
      // Patterns are ordered from specific to generic. Prevent "70 m²" from
      // being detected a second time as "70 m", which previously created the
      // false review Meter → Quadratmeter after an otherwise correct AI result.
      if (
        start >= 0 &&
        matches.some((existing) =>
          Math.max(start, existing.start) < Math.min(end, existing.end),
        )
      ) {
        continue;
      }

      matches.push({
        value: Number(match[1].replace(",", ".")),
        unit: pattern.unit,
        raw: match[0],
        start,
        end,
      });
    }
  }

  return matches
    .filter((m) => Number.isFinite(m.value) && m.value > 0)
    .map(({ start: _start, end: _end, ...match }) => match);
}

type ExplicitQuantityRangeV17_90L121 = {
  min: number;
  max: number;
  unit: string;
  raw: string;
};

// V17.90L121: A quantity range is never a confirmed quantity. The first AI
// may return one boundary, but line-local evidence wins for uncertainty:
// keep quantity at zero and require an explicit user decision.
function detectExplicitQuantityRangeV17_90L121(
  text: string | null | undefined,
): ExplicitQuantityRangeV17_90L121 | null {
  const source = normalizeUnitText(text || "");
  if (!source) return null;

  const unitPatterns: Array<{ unit: string; pattern: string }> = [
    { unit: "square_meter", pattern: "(?:m2|m²|qm|quadratmeter|quadrat meter|sqm)" },
    { unit: "cubic_meter", pattern: "(?:m3|m³|cbm|kubikmeter|kubik meter)" },
    { unit: "hour", pattern: "(?:stunden?|std\.?|h|hours?|heures?|horas?|ore)" },
    { unit: "day", pattern: "(?:tage?|arbeitstage?|days?|jours?|giorni?)" },
    { unit: "meter", pattern: "(?:laufmeter|lfm|meter|metres?|mètres?)" },
    {
      unit: "piece",
      pattern: "(?:stueck|stück|stuck|stk|einheiten?|pieces?|pi[eè]ces?|pezzi|unita|unità|anzahl|raeume|räume|stockwerke|abteile|stellen|garnituren?|sack|säcke|saecke|kartuschen?|eimer|rollen?|gebinde|paletten?)",
    },
    { unit: "kilogram", pattern: "(?:kilogramm|kg)" },
    { unit: "ton", pattern: "(?:tonnen?|to\.?|t)" },
    { unit: "liter", pattern: "(?:liter|ltr\.?|l)" },
  ];

  for (const entry of unitPatterns) {
    const re = new RegExp(
      `\\b(\\d+(?:[.,]\\d+)?)\\s*(?:-|–|—|bis|to|until|a|à)\\s*(\\d+(?:[.,]\\d+)?)\\s*${entry.pattern}(?=$|\\s|[,.;:])`,
      "i",
    );
    const match = source.match(re);
    if (!match) continue;

    const min = Number(String(match[1]).replace(",", "."));
    const max = Number(String(match[2]).replace(",", "."));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || max <= min) {
      continue;
    }

    return { min, max, unit: entry.unit, raw: match[0] };
  }

  return null;
}

// V16.95: Final semantic repair for explicit hour lines from the original customer text.
// This is intentionally line-anchored: a service row is repaired only when the

type IntakeFinalOrderItemForBlocker = {
  serviceName: string;
  positionType?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceText?: string | null;
  evidence?: string | null;
  detectedCurrency?: string | null;
  [key: string]: any;
};

function applyFinalAmountBlockersBeforePersist(
  items: IntakeFinalOrderItemForBlocker[],
  options: {
    detectedCurrencies?: string[] | null;
    finalCurrency?: string | null;
  } = {},
): IntakeFinalOrderItemForBlocker[] {
  const detectedCurrencies = Array.isArray(options.detectedCurrencies)
    ? options.detectedCurrencies.filter(Boolean)
    : [];
  const finalCurrency = String(options.finalCurrency || "").toUpperCase();
  const hasGlobalCurrencyConflict = detectedCurrencies.length > 1;

  return items.map((item) => {
    const next: IntakeFinalOrderItemForBlocker = { ...item };
    next.positionType = normalizePositionType((next as any).positionType);
    const serviceName =
      String(next.serviceName || "Unbekannte Leistung").trim() ||
      "Unbekannte Leistung";
    const unitKey = normalizeUnitText(next.unit || "");
    const reviewKey = normalizeUnitText(
      [
        next.unit,
        next.description,
        next.sourceText,
        next.evidence,
        next.reviewReason,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const detectedCurrency = String(next.detectedCurrency || "").toUpperCase();
    const serviceKeyForBlock = normalizeUnitText(serviceName);
    const serviceBlocked =
      isInternalReviewServiceNameV17_90L(serviceName) ||
      serviceKeyForBlock.includes("leistung suchen") ||
      serviceKeyForBlock.includes("eingeben") ||
      String(next.reviewReason || "").startsWith("service_action_unclear:");

    const unitBlocked =
      unitKey.includes("pruefen") ||
      unitKey.includes("prüfen") ||
      unitKey === "unklar" ||
      unitKey === "unknown" ||
      unitKey === "unbekannt" ||
      reviewKey.includes("einheit fehlt") ||
      reviewKey.includes("unit missing") ||
      String(next.reviewReason || "").startsWith("unit_missing_in_text:") ||
      String(next.reviewReason || "").startsWith("unit_mismatch:");

    const priceBlocked =
      String(next.reviewReason || "").startsWith("price_unclear:") ||
      reviewKey.includes("preis fehlt") ||
      reviewKey.includes("preis unklar") ||
      reviewKey.includes("price missing") ||
      reviewKey.includes("price unclear") ||
      Number(next.unitPrice || 0) <= 0;

    const quantityBlocked =
      getServiceUnitType(next.unit) !== "flat" &&
      Number(next.quantity || 0) <= 0;

    const mixedCurrencyItemBlocked =
      hasGlobalCurrencyConflict &&
      Boolean(
        detectedCurrency && finalCurrency && detectedCurrency !== finalCurrency,
      );
    const genericCurrencyReviewBlocked =
      String(next.reviewReason || "") === "currency_review" &&
      (!detectedCurrency ||
        (finalCurrency && detectedCurrency !== finalCurrency));

    const currencyBlocked =
      mixedCurrencyItemBlocked ||
      Boolean(
        detectedCurrency && finalCurrency && detectedCurrency !== finalCurrency,
      ) ||
      String(next.reviewReason || "").startsWith("item_currency_mismatch:") ||
      String(next.reviewReason || "").startsWith("currency_conflict_item:") ||
      genericCurrencyReviewBlocked;

    if (
      !(
        serviceBlocked ||
        unitBlocked ||
        priceBlocked ||
        quantityBlocked ||
        currencyBlocked
      )
    ) {
      return next;
    }

    next.needsReview = true;
    next.totalPrice = 0;

    if (serviceBlocked) {
      next.serviceName = "Leistung prüfen";
      const evidenceText = [next.description, next.sourceText, next.evidence]
        .filter(Boolean)
        .join(" ");
      const hasExplicitLineUnit =
        /\b(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stueck|stück|stk|pcs?|piece|pieces|stunden?|std\.?|hours?|heures?|horas?|ore|pauschal)\b/i.test(
          evidenceText,
        );
      const hasExplicitUnit = Boolean(
        next.unit && !isReviewUnitV17_90L(next.unit) && hasExplicitLineUnit,
      );
      if (!hasExplicitUnit) next.unit = "Einheit prüfen";
      if (!next.reviewReason)
        next.reviewReason = `service_action_unclear:${serviceName}`;
      return next;
    }

    if (currencyBlocked) {
      // V17.90L225: Preserve the exact foreign-currency amount for the editor.
      // Blocking applies only to totalPrice; the user must still see e.g.
      // EUR 35 before confirming a target-currency price or discarding the row.
      if (!next.reviewReason || next.reviewReason === "currency_review") {
        next.reviewReason =
          detectedCurrency &&
          finalCurrency &&
          detectedCurrency !== finalCurrency
            ? `item_currency_mismatch:${serviceName}:${detectedCurrency}:${finalCurrency}`
            : `currency_conflict_item:${serviceName}:${detectedCurrency || "UNKNOWN"}:${finalCurrency || "UNKNOWN"}`;
      }
      return next;
    }

    if (unitBlocked) {
      if (!unitKey.includes("pruefen") && !unitKey.includes("prüfen")) {
        next.unit = "Einheit prüfen";
      }
      if (!next.reviewReason)
        next.reviewReason = `unit_missing_in_text:${serviceName}`;
      return next;
    }

    if (priceBlocked) {
      next.unitPrice = 0;
      if (!next.reviewReason)
        next.reviewReason = `price_unclear:${serviceName}`;
      return next;
    }

    if (quantityBlocked) {
      next.quantity = 0;
      if (!next.reviewReason) next.reviewReason = "quantity_review";
    }

    return next;
  });
}

// same original line contains service topic + explicit hour quantity + explicit
// unit price. It prevents catalog-unit overwrite without leaking the hour price
// into neighbouring Stück/m² rows.
type IntakeHourLineRepairItem = {
  serviceName: string;
  positionType?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceText?: string | null;
  evidence?: string | null;
  detectedCurrency?: string | null;
};

function roundIntakeMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIntakeDecimalNumber(value?: string | null): number | null {
  const parsed = Number(
    String(value || "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const INTAKE_HOUR_WORD_QUANTITIES: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  eins: 1,
  viertel: 0.25,
  halb: 0.5,
  halbe: 0.5,
  dreiviertel: 0.75,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  zwei: 2,
  zweieinhalb: 2.5,
  drei: 3,
  dreieinhalb: 3.5,
  vier: 4,
  viereinhalb: 4.5,
  fuenf: 5,
  funf: 5,
  fuenfeinhalb: 5.5,
  funfeinhalb: 5.5,
  sechs: 6,
  sechseinhalb: 6.5,
  sieben: 7,
  siebeneinhalb: 7.5,
  acht: 8,
  achteinhalb: 8.5,
  neun: 9,
  neuneinhalb: 9.5,
  zehn: 10,
};

function parseIntakeHourQuantityToken(value?: string | null): number | null {
  const numeric = parseIntakeDecimalNumber(value);
  if (numeric) return numeric;

  const key = normalizeUnitText(value || "").replace(/\s+/g, "");
  return INTAKE_HOUR_WORD_QUANTITIES[key] || null;
}

function normalizeIntakeHourQuantity(
  value: number | null | undefined,
): number | null {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  // Billing precision: always keep time quantities on a 15-minute grid.
  return roundIntakeMoney(Math.round(quantity * 4) / 4);
}

function detectExplicitIntakeHourQuantityInLine(
  line?: string | null,
): number | null {
  const source = normalizeUnitText(line || "");
  if (!source) return null;

  const numberOrWord =
    "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)";
  const hourUnit = "(?:stunden?|std\\.?|h|hours?)";
  const minuteUnit = "(?:min\\.?|minuten?|minutes?)";

  const hourMatch = source.match(
    new RegExp(`\\b(${numberOrWord})\\s*${hourUnit}\\b`, "i"),
  );
  if (hourMatch?.[1]) {
    const base = parseIntakeHourQuantityToken(hourMatch[1]);
    if (base) {
      let total = base;
      const after = source.slice((hourMatch.index || 0) + hourMatch[0].length);
      const minuteAfter = after.match(
        new RegExp(`^\\s*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, "i"),
      );
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeIntakeHourQuantity(total);
      if (normalized) return normalized;
    }
  }

  const hourPlusWordFraction = source.match(
    new RegExp(
      `\\b(${numberOrWord})\\s*${hourUnit}\\s*(?:und|\\+)?\\s*(?:eine?n?\\s+)?(viertel|halb|halbe|dreiviertel)\\s*(?:stunde|stunden|std\\.?|h)?\\b`,
      "i",
    ),
  );
  if (hourPlusWordFraction?.[1] && hourPlusWordFraction?.[2]) {
    const base = parseIntakeHourQuantityToken(hourPlusWordFraction[1]);
    const fraction = parseIntakeHourQuantityToken(hourPlusWordFraction[2]);
    const normalized = normalizeIntakeHourQuantity(
      (base || 0) + (fraction || 0),
    );
    if (normalized) return normalized;
  }

  const compactHourMinute = source.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?)\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`,
      "i",
    ),
  );
  if (compactHourMinute?.[1] && compactHourMinute?.[2]) {
    const normalized = normalizeIntakeHourQuantity(
      Number(compactHourMinute[1]) + Number(compactHourMinute[2]) / 60,
    );
    if (normalized) return normalized;
  }

  const minuteOnly = source.match(
    new RegExp(`\\b(15|30|45)\\s*${minuteUnit}\\b`, "i"),
  );
  if (
    minuteOnly?.[1] &&
    /(?:pro|je|per|par|à|a|\/)\s*(?:stunde|stunden|std\.?|h|hour|hours)\b/i.test(
      source,
    )
  ) {
    const normalized = normalizeIntakeHourQuantity(Number(minuteOnly[1]) / 60);
    if (normalized) return normalized;
  }

  const wordOnlyFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel)\s*(?:stunde|stunden|std\.?|h)\b/i,
  );
  if (wordOnlyFraction?.[1]) {
    const normalized = normalizeIntakeHourQuantity(
      parseIntakeHourQuantityToken(wordOnlyFraction[1]),
    );
    if (normalized) return normalized;
  }

  return null;
}

function detectExplicitIntakeMeasuredPriceInLine(
  line?: string | null,
): number | null {
  const source = normalizeUnitText(line || "");
  if (!source) return null;

  const currencyWords = "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€)";
  const number = "(\\d+(?:[.,]\\d{1,2})?)";
  const anchor = "(?:à|a|pro|je|per|zu|fuer|für|/)";

  const anchoredPatterns = [
    new RegExp(`${anchor}\\s*${currencyWords}\\s*${number}\\b`, "i"),
    new RegExp(`${anchor}\\s*${number}\\s*${currencyWords}\\b`, "i"),
    new RegExp(
      `${currencyWords}\\s*${number}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`,
      "i",
    ),
    new RegExp(
      `${number}\\s*${currencyWords}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`,
      "i",
    ),
  ];

  for (const pattern of anchoredPatterns) {
    const match = source.match(pattern);
    const value = match?.[1] || match?.[2];
    const parsed = parseIntakeDecimalNumber(value);
    if (parsed) return parsed;
  }

  const currencyMatches = Array.from(
    source.matchAll(
      new RegExp(
        `(?:${currencyWords}\\s*${number}|${number}\\s*${currencyWords})`,
        "gi",
      ),
    ),
  );

  for (const match of currencyMatches) {
    const parsed = parseIntakeDecimalNumber(match[1] || match[2]);
    if (parsed) return parsed;
  }

  return null;
}

function intakeSemanticServiceTopicFromText(
  value?: string | null,
): string | null {
  const source = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) return null;

  const canonical = canonicalGermanServiceNameFromText(source);
  const canonicalKey = normalizeUnitText(canonical || "");

  if (/\bboden\b/.test(canonicalKey)) return "boden_reinigen";
  if (/\bfenster\b/.test(canonicalKey)) return "fenster_reinigen";
  if (/\banfahrt\b/.test(canonicalKey)) return "anfahrt";

  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/.test(
      source,
    );

  if (
    (/\bboden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b|\bchao\b|\bhallenboden\b|\bkellerboden\b|\blagerboden\b/.test(
      source,
    ) ||
      /bodenreinigung|floor cleaning|nettoyage du sol|nettoyage sol|limpieza suelo|pulizia pavimento/.test(
        source,
      )) &&
    hasCleaningIntent
  ) {
    return "boden_reinigen";
  }

  if (
    /fenster|fensterli|vitrin|vitre|window|fenetre|finestr|ventan/.test(source)
  ) {
    return "fenster_reinigen";
  }

  if (/\bteppich\b|carpet|moquette/.test(source) && hasCleaningIntent) {
    return "teppich_reinigen";
  }

  if (
    /\banfahrt\b|\bfahrtkosten\b|\bfahrkosten\b|\bfahrpauschale\b|\bwegpauschale\b|\bdeplacement\b|\btravel\b|\btrip\b/.test(
      source,
    )
  ) {
    return "anfahrt";
  }

  return null;
}

function lineMatchesIntakeServiceTopic(
  serviceName?: string | null,
  line?: string | null,
): boolean {
  const service = normalizeUnitText(serviceName || "");
  const source = normalizeUnitText(line || "");
  if (!service || !source) return false;

  const serviceTopic = intakeSemanticServiceTopicFromText(service);
  const sourceTopic = intakeSemanticServiceTopicFromText(source);
  if (serviceTopic && sourceTopic && serviceTopic === sourceTopic) return true;

  const generic = new Set([
    "reinigen",
    "reinigung",
    "putzen",
    "clean",
    "cleaning",
    "machen",
    "arbeit",
    "arbeiten",
    "service",
    "leistung",
    "leistungen",
  ]);

  const tokens = service
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !generic.has(token));

  if (tokens.some((token) => source.includes(token))) return true;
  if (/\bboden\b/.test(service) && /\bboden\b/.test(source)) return true;
  if (
    /\bfenster|fensterli|window|vitrine|vitre/.test(service) &&
    /\bfenster|fensterli|window|vitrine|vitre/.test(source)
  )
    return true;
  if (
    /\bwasserablauf|ablauf|pumpe|pumpenraum/.test(service) &&
    /\bwasserablauf|ablauf|pumpe|pumpenraum/.test(source)
  )
    return true;

  return false;
}

function repairExplicitHourQuantitiesFromOriginalText(
  items: IntakeHourLineRepairItem[],
  originalText: string,
): IntakeHourLineRepairItem[] {
  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    );

  if (lines.length === 0) return items;

  const lineScoreForItem = (
    item: IntakeHourLineRepairItem,
    line: { raw: string; quantity: number | null; price: number | null },
  ) => {
    let score = 0;
    const serviceName = item.serviceName || "";
    const lineText = line.raw;
    const lineKey = normalizeUnitText(lineText);

    const canonicalLineService = canonicalGermanServiceNameFromText(lineText);
    const serviceKey = normalizeUnitText(serviceName);
    const canonicalLineKey = normalizeUnitText(canonicalLineService || "");

    const itemTopic = intakeSemanticServiceTopicFromText(
      [serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const lineTopic = intakeSemanticServiceTopicFromText(lineText);

    if (itemTopic && lineTopic && itemTopic === lineTopic) score += 220;
    if (canonicalLineKey && serviceKey && canonicalLineKey === serviceKey)
      score += 140;
    if (lineMatchesIntakeServiceTopic(serviceName, lineText)) score += 80;
    if (lineMatchesIntakeServiceTopic(item.description, lineText)) score += 40;
    if (lineMatchesIntakeServiceTopic(item.sourceText, lineText)) score += 30;
    if (lineMatchesIntakeServiceTopic(item.evidence, lineText)) score += 20;

    const sourceKey = normalizeUnitText(item.sourceText || "");
    const evidenceKey = normalizeUnitText(item.evidence || "");
    const descriptionKey = normalizeUnitText(item.description || "");

    if (
      sourceKey &&
      (lineKey.includes(sourceKey) || sourceKey.includes(lineKey))
    )
      score += 30;
    if (
      evidenceKey &&
      (lineKey.includes(evidenceKey) || evidenceKey.includes(lineKey))
    )
      score += 20;
    if (descriptionKey && lineKey.includes(descriptionKey)) score += 20;

    // Safety: service-domain anchors are mandatory. A matching price alone is
    // not enough, otherwise an hour price can leak into a neighbouring line.
    const hasStrongTopic = score >= 60;
    if (!hasStrongTopic) return 0;

    const currentPrice = Number(item.unitPrice || 0);
    if (Number.isFinite(currentPrice) && currentPrice > 0 && line.price) {
      if (Math.abs(currentPrice - line.price) < 0.01) score += 60;
      else score -= 90;
    }

    if (getServiceUnitType(item.unit) === "hour") score += 30;
    if (Number(item.quantity || 0) <= 0) score += 20;
    if (/\bstunde|stunden|std\.?|h\b/i.test(lineKey)) score += 10;

    return score;
  };

  return items.map((item) => {
    const currentQuantity = Number(item.quantity || 0);
    const currentPrice = Number(item.unitPrice || 0);
    const currentUnitType = getServiceUnitType(item.unit);

    // Repair is allowed for hour rows and for zero-quantity rows when the
    // original line has a strong service-topic match. This catches cases where
    // the UI already shows "Stunde", but also cases where validation still
    // kept the catalog unit while the customer text is explicitly hourly.
    if (currentUnitType !== "hour" && currentQuantity > 0) return item;

    let best: {
      raw: string;
      quantity: number | null;
      price: number | null;
      score: number;
    } | null = null;

    for (const line of lines) {
      const score = lineScoreForItem(item, line);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { ...line, score };
      }
    }

    if (!best || !best.quantity || !best.price || best.score < 100) return item;

    // Do not override a valid, different current price. This protects adjacent
    // Stück/m² services from a previous hourly price.
    if (
      Number.isFinite(currentPrice) &&
      currentPrice > 0 &&
      Math.abs(currentPrice - best.price) >= 0.01
    ) {
      return item;
    }

    const quantity = normalizeIntakeHourQuantity(best.quantity);
    const price = best.price;
    if (!quantity || quantity <= 0 || !price || price <= 0) return item;

    const shouldRepair =
      currentQuantity <= 0 ||
      currentUnitType !== "hour" ||
      Math.abs(currentQuantity - quantity) >= 0.001 ||
      Math.abs(currentPrice - price) >= 0.01 ||
      !item.sourceText ||
      !normalizeUnitText(item.sourceText).includes(normalizeUnitText(best.raw));

    if (!shouldRepair) return item;

    return {
      ...item,
      quantity,
      unit: "Stunde",
      unitPrice: price,
      totalPrice: roundIntakeMoney(quantity * price),
      sourceText: best.raw,
      evidence: best.raw,
    };
  });
}

function findExplicitHourLineRepairForMappedItem(
  item: IntakeHourLineRepairItem,
  originalText: string,
): { quantity: number; price: number; raw: string; score: number } | null {
  const currentPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    );

  let best: {
    quantity: number;
    price: number;
    raw: string;
    score: number;
  } | null = null;

  for (const line of lines) {
    if (!line.quantity || !line.price) continue;

    // Hard safety: the hourly line must carry the same explicit price as the
    // current mapped item. This prevents the old cross-line leak into window /
    // piece services while still rescuing the lost hour quantity.
    if (Math.abs(currentPrice - line.price) >= 0.01) continue;

    let score = 0;
    const canonicalLineService = canonicalGermanServiceNameFromText(line.raw);
    const canonicalLineKey = normalizeUnitText(canonicalLineService || "");
    const serviceKey = normalizeUnitText(item.serviceName || "");

    const itemTopic = intakeSemanticServiceTopicFromText(
      [item.serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const lineTopic = intakeSemanticServiceTopicFromText(line.raw);

    if (itemTopic && lineTopic && itemTopic === lineTopic) score += 240;
    if (canonicalLineKey && serviceKey && canonicalLineKey === serviceKey)
      score += 160;
    if (lineMatchesIntakeServiceTopic(item.serviceName, line.raw)) score += 120;
    if (lineMatchesIntakeServiceTopic(item.description, line.raw)) score += 60;
    if (lineMatchesIntakeServiceTopic(item.sourceText, line.raw)) score += 40;
    if (lineMatchesIntakeServiceTopic(item.evidence, line.raw)) score += 30;

    const lineKey = normalizeUnitText(line.raw);
    const descriptionKey = normalizeUnitText(item.description || "");
    const sourceKey = normalizeUnitText(item.sourceText || "");

    if (serviceKey && lineKey.includes(serviceKey)) score += 60;
    if (descriptionKey && lineKey.includes(descriptionKey)) score += 30;
    if (
      sourceKey &&
      sourceKey.length >= 8 &&
      (lineKey.includes(sourceKey) || sourceKey.includes(lineKey))
    )
      score += 20;
    if (getServiceUnitType(item.unit) === "hour") score += 40;
    if (Number(item.quantity || 0) <= 0) score += 30;

    // The service topic is mandatory. Price + hour alone is not enough.
    if (score < 120) continue;

    const quantity = normalizeIntakeHourQuantity(line.quantity);
    if (!quantity || quantity <= 0) continue;

    const candidate = {
      quantity,
      price: line.price as number,
      raw: line.raw,
      score,
    };

    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

// V17.00: Persistence-boundary hard repair for explicit hourly customer lines.
// This runs immediately before totals / prisma.order.create and repairs the
// exact failure mode where the mapper kept only "Std. à CHF ..." as item text.
// Safety rules:
// - same explicit unit price is mandatory
// - explicit hour quantity in the same original line is mandatory
// - semantic service topic match is preferred
// - fallback by unique same-price hour line is allowed only for zero-quantity
//   hour rows, so the amount is not leaked to Stück/m² rows
function repairExplicitHourQuantitiesBeforePersist(
  items: IntakeHourLineRepairItem[],
  originalText: string,
): IntakeHourLineRepairItem[] {
  const lines = String(originalText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectExplicitIntakeHourQuantityInLine(line),
      price: detectExplicitIntakeMeasuredPriceInLine(line),
      topic: intakeSemanticServiceTopicFromText(line),
    }))
    .filter(
      (line) =>
        line.quantity && line.quantity > 0 && line.price && line.price > 0,
    ) as Array<{
    raw: string;
    quantity: number;
    price: number;
    topic: string | null;
  }>;

  if (lines.length === 0) return items;

  const repaired = items.map((item) => {
    const currentQuantity = Number(item.quantity || 0);
    const currentPrice = Number(item.unitPrice || 0);
    const currentUnitType = getServiceUnitType(item.unit);

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return item;

    // Never touch valid non-hour rows. This protects following Stück/m² rows.
    if (currentUnitType !== "hour" && currentQuantity > 0) return item;

    const itemText = [
      item.serviceName,
      item.description,
      item.sourceText,
      item.evidence,
    ]
      .filter(Boolean)
      .join(" ");
    const itemTopic = intakeSemanticServiceTopicFromText(itemText);

    const samePriceLines = lines.filter(
      (line) => Math.abs(line.price - currentPrice) < 0.01,
    );
    if (samePriceLines.length === 0) return item;

    const topicMatches = itemTopic
      ? samePriceLines.filter((line) => line.topic && line.topic === itemTopic)
      : [];

    let chosen: (typeof samePriceLines)[number] | null = null;

    if (topicMatches.length === 1) {
      chosen = topicMatches[0];
    } else if (topicMatches.length > 1) {
      chosen = topicMatches.sort((a, b) => b.raw.length - a.raw.length)[0];
    } else if (
      currentUnitType === "hour" &&
      currentQuantity <= 0 &&
      samePriceLines.length === 1
    ) {
      // Last safe fallback for the real failure case:
      // item already says Stunde + price, but quantity is 0 and source/evidence
      // was shortened to "Std. à CHF ...". A unique same-price hour line in the
      // original message is then the only reliable quantity source.
      chosen = samePriceLines[0];
    }

    if (!chosen) return item;

    const quantity = normalizeIntakeHourQuantity(chosen.quantity);
    if (!quantity || quantity <= 0) return item;

    return {
      ...item,
      quantity,
      unit: "Stunde",
      unitPrice: chosen.price,
      totalPrice: roundIntakeMoney(quantity * chosen.price),
      // DB only persists description on OrderItem. Keep the full customer line
      // there so the UI no longer shows the misleading "Std. à CHF ..." hint.
      description: chosen.raw,
      sourceText: chosen.raw,
      evidence: chosen.raw,
    };
  });

  return repaired;
}

function splitWorkSegments(text: string): string[] {
  const source = normalizeUnitText(text);
  if (!source) return [];

  const roughParts = source
    .split(/\n|;|\*|,|\bsowie\b|\bplus\b/gi)
    .map((p) => p.trim())
    .filter(Boolean);

  const segments: string[] = [];

  for (const part of roughParts) {
    const splitByQuantity = part
      .replace(
        /\s+(?=\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|quadrat meter|m3|m³|kubikmeter|kubik meter|cbm|stunden|stunde|std\.?|h|tage|tag|meter|laufmeter|lfm|tonnen|tonne|to\.?|kg|kilogramm|liter|ltr\.?|stück|stueck|stk)\b)/gi,
        "|||",
      )
      .split("|||")
      .map((p) => p.trim())
      .filter(Boolean);

    segments.push(...splitByQuantity);
  }
  const cleanedSegments = segments.filter((segment) => {
    const normalized = normalizeUnitText(segment);

    if (!normalized) return false;
    if (normalized.length < 8) return false;

    const blocked = [
      "zudem",
      "danach",
      "anschliessend",
      "anschließend",
      "sowie",
      "und",
      "plus",
    ];

    if (blocked.includes(normalized)) return false;

    const hasQuantityUnit = detectAllQuantityUnitsFromText(segment).length > 0;

    const hasWorkVerb =
      /\b(reinigen|reinigung|putzen|clean|cleaning|nettoyage|nettoyer|pulizia|pulire|limpieza|limpiar|schneiden|stutzen|pflegen|pflege|mähen|maehen|mähen|streichen|malen|entsorgen|entsorgung|abtransportieren|transportieren|fällen|faellen|montieren|demontieren|reparieren|ersetzen|liefern|räumen|raeumen|ausräumen|ausraeumen|anfahrt|fahrtkosten|fahrpauschale|wegpauschale|deplacement|déplacement|travel|transport|trasferta|transferta)\b/i.test(
        normalized,
      );

    return hasQuantityUnit || hasWorkVerb;
  });
  return cleanedSegments.length > 0 ? cleanedSegments : [source];
}

function unitTypeToDisplayUnit(unitType?: string | null): string {
  switch (unitType) {
    case "square_meter":
      return "Quadratmeter";
    case "cubic_meter":
      return "Kubikmeter";
    case "hour":
      return "Stunde";
    case "day":
      return "Tag";
    case "meter":
      return "Meter";
    case "kilogram":
      return "Kilogramm";
    case "ton":
      return "Tonne";
    case "liter":
      return "Liter";
    case "piece":
      return "Stück";
    case "flat":
      return "Pauschal";
    default:
      return "Pauschal";
  }
}

function cleanDetectedWorkName(segment: string): string {
  return normalizeUnitText(segment)
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|quadrat meter|m3|m³|kubikmeter|kubik meter|cbm|stunden|stunde|std\.?|h|tage|tag|meter|laufmeter|lfm|tonnen|tonne|to\.?|kg|kilogramm|liter|ltr\.?|stück|stueck|stk)\b/gi,
      " ",
    )
    .replace(/\b(ca|circa|ungefähr|ungefaehr|etwa|rund)\b/gi, " ")
    .replace(
      /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\s*\d+(?:[.,]\d{1,2})?\b/gi,
      " ",
    )
    .replace(
      /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|usd|dollar|gbp|pfund)\b/gi,
      " ",
    )
    .replace(
      /\b(?:pro|je|per|par|à|a|\/)\s*(?:stück|stueck|stk|m2|m²|qm|meter|stunde|stunden|pauschal)\b/gi,
      " ",
    )
    .replace(/\b(?:pro|je|per|par|à|a)\s*[.,;:!?]*$/gi, " ")
    .replace(/[+]+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function composeWorkNameSource(item: any, raw: string): string {
  const action = String(item.action_name || "").trim();
  const context = String(item.context || "").trim();
  const name = String(item.name || "").trim();
  const serviceName = String(
    item.service_name || item.matched_service_name || "",
  ).trim();
  const actionKey = normalizeUnitText(action)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const contextKey = normalizeUnitText(context)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nameKey = normalizeUnitText(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    name &&
    action &&
    nameKey.includes(actionKey) &&
    name.length > action.length + 3
  ) {
    return name;
  }

  const actionTooGeneric =
    /^(?:reinigen|reinigung|putzen|montieren|demontieren|streichen|malen|prüfen|pruefen|ersetzen|entsorgen|schneiden|stutzen|regiearbeit)$/i.test(
      actionKey,
    );
  const contextHasWorkObject =
    /\b(?:kabelkanal|kabel|lampe|leuchte|wand|waende|wände|decke|boden|fenster|teppich|abfluss|dichtung|hecke|gruen|grün|steckdose|steckdosen|material)\b/i.test(
      contextKey,
    );
  if (actionTooGeneric && contextKey && contextHasWorkObject) {
    return `${context} ${action}`.trim();
  }

  return action || serviceName || name || raw || "";
}

function canonicalGermanServiceNameFromText(
  value?: string | null,
): string | null {
  const normalized = normalizeUnitText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const hasFloorIntent =
    /\b(boden|bode|floor|sol|paviment|suelo|chao)\b|bodenreinigung|floor cleaning|nettoyage du sol|nettoyage sol|limpieza suelo|pulizia pavimento/i.test(
      normalized,
    );
  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/i.test(
      normalized,
    );

  if (hasFloorIntent && hasCleaningIntent) {
    return "Boden reinigen";
  }

  const hasWindowIntent =
    /fenster|fensterli|vitrin|vitre|window|fenetre|fenêtre|finestr|ventan/i.test(
      normalized,
    );

  if (hasWindowIntent) {
    return "Fenster reinigen";
  }

  if (
    /\b(anfahrt|fahrt|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|déplacement|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)\b/i.test(
      normalized,
    )
  ) {
    return "Anfahrt";
  }

  if (
    /\b(clean floor|floor cleaning|boden reinigen|bodenreinigung|nettoyage du sol|nettoyage sol|nettoyer sol|pulizia pavimento|pulizia del pavimento|limpieza suelo|limpieza de suelo)\b/i.test(
      normalized,
    )
  ) {
    return "Boden reinigen";
  }

  if (
    /\b(clean windows|window cleaning|windows cleaning|fenster reinigen|fensterreinigung|nettoyage des vitres|nettoyage vitres|nettoyage des vitrines|nettoyage vitrines|vitres|vitrines|fenetres|pulizia finestre|pulizia delle finestre|limpieza ventanas|limpieza de ventanas)\b/i.test(
      normalized,
    )
  ) {
    return "Fenster reinigen";
  }

  return null;
}

function formatWorkNameForDisplay(value: string): string {
  const canonical = canonicalGermanServiceNameFromText(value);
  if (canonical) return canonical;

  const text = String(value || "")
    .replace(/ae/g, "ä")
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü")
    .replace(/\b(?:pro|je|per|par|à|a)\s*[.,;:!?]*$/gi, " ")
    .replace(/\s+\.\s*$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!text) return "Unbekannte Leistung";

  const forceUppercaseWords = [
    "glasfläche",
    "fugen",
    "gartentor",
    "kupferornamente",
    "terrasse",
    "fenster",
    "hecke",
    "rasen",
    "baum",
  ];

  return text
    .split(" ")
    .map((word, index) => {
      if (index === 0 || forceUppercaseWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      return word;
    })
    .join(" ");
}


// V17.90L76: Keep the structured AI service label as the visible semantic
// name. This cleanup is structural only: it removes amount/review tails while
// preserving Unicode, wording and specificity from the structured result.
function cleanStructuredAiServiceNameV17_90L76(
  value: string | null | undefined,
): string {
  const countUnit =
    String.raw`(?:garnituren?|sets?|gruppen?|anlagen?|raeume|räume|zimmer|objekte?|einheiten?|stueck|stück|stk\.?|pcs?|pieces?|pi[eè]ces?|pezzi|meter|laufmeter|lfm|m2|m²|qm|quadratmeter|stunden?|std\.?|tage?|pauschalen?)`;

  let cleaned = compactText(value)
    .replace(
      new RegExp(
        String.raw`\s*[,;:\-–—]?\s*\d+(?:[.,]\d+)?\s*${countUnit}\b(?:\s*(?:à|a|je|po|pro|per|x|mal)\s*(?:(?:CHF|EUR|Fr\.?|Franken|Euro)\s*)?\d+(?:[.,]\d{1,2})?)?.*$`,
        "iu",
      ),
      "",
    )
    .replace(
      /\s+(?:à|a|je|po|pro|per|x|mal)\s*(?:(?:CHF|EUR|Fr\.?|Franken|Euro)\s*)?\d+(?:[.,]\d{1,2})?.*$/iu,
      "",
    )
    .replace(
      /\s*[,;:\-–—]\s*(?:bitte\s+)?(?:separat\s+)?(?:prüfen|pruefen|kontrollieren)\s*$/iu,
      "",
    )
    .replace(
      /\s+(?:(?:bitte\s+)?separat|bitte|manuell)\s+(?:prüfen|pruefen|kontrollieren)\s*$/iu,
      "",
    )
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, "")
    .replace(/[\s,;:\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // V17.90L77: Generic German grammar repair for room compounds. This is
  // structural (all nouns ending in "-raum" are masculine), not a service
  // vocabulary list. It repairs both "in Pausenraum" and "in der Pausenraum".
  cleaned = cleaned.replace(
    /\bin(?:\s+der|\s+dem)?\s+([\p{L}-]*raum)\b/giu,
    "im $1",
  );

  if (!cleaned) return "Unbekannte Leistung";
  const firstLetter = cleaned.search(/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]/u);
  if (firstLetter >= 0) {
    cleaned = `${cleaned.slice(0, firstLetter)}${cleaned
      .charAt(firstLetter)
      .toUpperCase()}${cleaned.slice(firstLetter + 1)}`;
  }
  return cleaned;
}


function structuredNameMatchesCatalogServiceV17_90L76(
  structuredName: string,
  catalogName: string,
): boolean {
  const normalize = (value: string) =>
    normalizeServiceLineForMatchV17_90L(value)
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const structured = normalize(structuredName);
  const catalog = normalize(catalogName);
  if (!structured || !catalog) return false;
  if (
    structured === catalog ||
    structured.includes(catalog) ||
    catalog.includes(structured)
  ) {
    return true;
  }

  const generic = new Set([
    "reinigen",
    "reinigung",
    "komplett",
    "gruendlich",
    "innen",
    "aussen",
    "maschinell",
    "vorsichtig",
  ]);
  const tokens = (value: string) =>
    value
      .split(/\s+/g)
      .filter((token) => token.length >= 4 && !generic.has(token));
  const structuredTokens = tokens(structured);
  const catalogTokens = tokens(catalog);
  if (structuredTokens.length === 0 || catalogTokens.length === 0) return false;

  return structuredTokens.some((left) =>
    catalogTokens.some(
      (right) => left === right || left.includes(right) || right.includes(left),
    ),
  );
}


type StructuredOrderItemSnapshotV17_90L76 = {
  serviceName: string;
  positionType?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  needsReview: boolean;
  reviewReason: string | null;
  sourceText?: string | null;
  evidence?: string | null;
  detectedCurrency?: string | null;
};

function structuredOrderItemSignatureV17_90L76(
  item: StructuredOrderItemSnapshotV17_90L76,
  fallbackCurrency: string,
): string {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  return [
    getServiceUnitType(item.unit) || normalizeUnitText(item.unit),
    Number.isFinite(quantity) ? quantity.toFixed(4) : "0.0000",
    Number.isFinite(unitPrice) ? unitPrice.toFixed(4) : "0.0000",
    String(item.detectedCurrency || fallbackCurrency || "").toUpperCase(),
  ].join("|");
}

function safeStructuredOrderItemSnapshotV17_90L76(
  item: StructuredOrderItemSnapshotV17_90L76,
): boolean {
  const name = compactText(item.serviceName);
  const evidence = compactText(
    item.sourceText || item.evidence || item.description || "",
  );
  if (!name || isInternalReviewServiceNameV17_90L(name)) return false;
  if (hasRawForeignServiceLanguageSignalV17_90L(name)) return false;
  if (name.length < 4 || name.length > 90 || /\b(?:CHF|EUR)\b/i.test(name)) {
    return false;
  }
  if (!evidence || evidence.length > 240 || /[\r\n]/.test(evidence)) {
    return false;
  }
  if (isReviewUnitV17_90L(item.unit)) return false;
  return Number(item.quantity || 0) > 0 && Number(item.unitPrice || 0) > 0;
}

function restoreUniqueStructuredOrderItemsV17_90L76(
  snapshots: StructuredOrderItemSnapshotV17_90L76[],
  currentItems: StructuredOrderItemSnapshotV17_90L76[],
  fallbackCurrency: string,
): StructuredOrderItemSnapshotV17_90L76[] {
  const snapshotGroups = new Map<
    string,
    Array<{ item: StructuredOrderItemSnapshotV17_90L76; order: number }>
  >();
  snapshots.forEach((item, order) => {
    if (!safeStructuredOrderItemSnapshotV17_90L76(item)) return;
    const signature = structuredOrderItemSignatureV17_90L76(
      item,
      fallbackCurrency,
    );
    const group = snapshotGroups.get(signature) || [];
    group.push({ item, order });
    snapshotGroups.set(signature, group);
  });

  const uniqueSnapshots = Array.from(snapshotGroups.entries())
    .filter(([, group]) => group.length === 1)
    .map(([signature, group]) => ({ signature, ...group[0] }))
    .sort((left, right) => left.order - right.order);
  if (uniqueSnapshots.length === 0) return currentItems;

  const currentGroups = new Map<string, StructuredOrderItemSnapshotV17_90L76[]>();
  currentItems.forEach((item) => {
    const signature = structuredOrderItemSignatureV17_90L76(
      item,
      fallbackCurrency,
    );
    const group = currentGroups.get(signature) || [];
    group.push(item);
    currentGroups.set(signature, group);
  });

  const consumed = new Set<StructuredOrderItemSnapshotV17_90L76>();
  const restored: StructuredOrderItemSnapshotV17_90L76[] = [];

  uniqueSnapshots.forEach(({ signature, item: snapshot }) => {
    const candidates = currentGroups.get(signature) || [];
    const selected = [...candidates].sort((left, right) => {
      const score = (item: StructuredOrderItemSnapshotV17_90L76) =>
        (isInternalReviewServiceNameV17_90L(item.serviceName) ? 0 : 4) +
        (Number(item.totalPrice || 0) > 0 ? 2 : 0);
      return score(right) - score(left);
    })[0];

    candidates.forEach((item) => consumed.add(item));
    const base = selected || snapshot;
    restored.push({
      ...base,
      serviceName: snapshot.serviceName,
      positionType: normalizePositionType((snapshot as any).positionType || (base as any).positionType),
      sourceText: base.sourceText || snapshot.sourceText || snapshot.evidence,
      evidence: base.evidence || snapshot.evidence || snapshot.sourceText,
    });
  });

  currentItems.forEach((item) => {
    if (!consumed.has(item)) restored.push(item);
  });
  return restored;
}


// V17.90L89: The structured LLM result is the canonical intake source.
// Legacy validators are read-only advisers from this point on. They may create
// review suggestions, but they may not replace a value that the first model
// supplied with line-local evidence.
type CanonicalUnitSourceV17_90L89 =
  | "ai"
  | "evidence"
  | "structural_piece"
  | "structural_flat"
  | "missing";

type CanonicalAiOrderItemV17_90L88 = StructuredOrderItemSnapshotV17_90L76 & {
  canonicalOrder: number;
  confidence: string;
  unitSource: CanonicalUnitSourceV17_90L89;
};

function canonicalEvidenceKeyV17_90L88(value: unknown): string {
  return normalizeServiceLineForMatchV17_90L(compactText(value));
}

function canonicalServiceKeyV17_90L88(value: unknown): string {
  return normalizeUnitText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePositiveCanonicalNumberV17_90L89(value: unknown): number {
  const parsed = Number(
    String(value ?? "")
      .replace(/'/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// V17.90L199/L202: Structured quantity/unit data belongs in its own
// fields, not in the visible service name. Remove only amount phrases whose
// number exactly equals the canonical quantity. Explicit units may occur in
// the middle of a translated label ("Boden 85 m² reinigen"). Floor/room
// identifiers such as "5. Etage" remain untouched because they are not
// canonical quantity-unit phrases.
function stripCanonicalAmountSuffixFromServiceNameV17_90L199(args: {
  serviceName: string;
  quantity: number;
}): string {
  const original = compactText(args.serviceName);
  const quantity = Number(args.quantity || 0);
  if (!original || !Number.isFinite(quantity) || quantity <= 0) return original;

  const quantityLabel = Number.isInteger(quantity)
    ? String(quantity)
    : String(Number(quantity.toFixed(4)));
  const quantityPattern = quantityLabel
    .split(".")
    .map((part) => escapeRegExpLocal(part))
    .join("[.,]");

  const explicitUnitPattern =
    String.raw`m(?:²|2|³|3)|qm|quadratmeter(?:n)?|kubikmeter(?:n)?|meter(?:n)?|laufmeter(?:n)?|stück(?:e|en)?|stueck(?:e|en)?|stk\.?|stunden?|std\.?|tage?n?|pauschale?n?`;
  const explicitQuantityUnitAnywhere = new RegExp(
    `\\b${quantityPattern}\\s*(?:${explicitUnitPattern})(?=\\s|$|[,;:.])`,
    "giu",
  );
  const explicitUnitSuffix = new RegExp(
    `\\s+${quantityPattern}\\s+(?:${explicitUnitPattern})\\s*$`,
    "iu",
  );
  const parenthesizedQuantityUnit = new RegExp(
    `\\(\\s*${quantityPattern}\\s*(?:${explicitUnitPattern})\\s*\\)`,
    "giu",
  );
  // A free count noun is accepted only at the end and only when it starts
  // uppercase. This keeps identifiers such as "Halle 2" intact.
  const structuralCountSuffix = new RegExp(
    `\\s+${quantityPattern}\\s+[A-ZÄÖÜ][\\p{L}'’.-]{1,30}\\s*$`,
    "u",
  );

  const leadingQuantity = new RegExp(
    `^${quantityPattern}\\s+(?=\\p{L})`,
    "iu",
  );
  const cleaned = original
    .replace(parenthesizedQuantityUnit, " ")
    .replace(explicitQuantityUnitAnywhere, " ")
    .replace(explicitUnitSuffix, "")
    .replace(structuralCountSuffix, "")
    .replace(/^\s*(?:(?:und|sowie|plus|danach|dann|noch|zusätzlich|zusaetzlich)\s+)+/i, "")
    .replace(leadingQuantity, "")
    .replace(/\s+/g, " ")
    .replace(/[,;:\s]+$/g, "")
    .trim();

  return cleaned.length >= 4 && /\p{L}/u.test(cleaned) ? cleaned : original;
}


// V17.90L200/L202: Prefer a clean, line-local German service label from
// the item's own evidence or the generated German working translation before
// the canonical lock. Exact quantity/unit/price identity is the boundary; no
// service-word mapping is used. Translated candidates outrank raw-language
// candidates, while ambiguous numeric collisions remain fail-closed.
function preferLineLocalGermanServiceNameV17_90L200(args: {
  rawServiceName: string;
  sourceText: string;
  translatedText?: string | null;
  quantity: number;
  unitPrice: number;
  unit: string;
}): string {
  const fallback = stripCanonicalAmountSuffixFromServiceNameV17_90L199({
    serviceName: args.rawServiceName,
    quantity: args.quantity,
  });
  if (!fallback) return fallback;

  const labelsAreStructurallyCompatible = (left: string, right: string) => {
    const normalize = (value: string) =>
      normalizeUnitText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    if (canonicalRoleEditSimilarityV17_90L201(a, b) >= 0.78) return true;

    const tokens = (value: string) =>
      value.split(/\s+/g).filter((token) => token.length >= 4);
    const aTokens = tokens(a);
    const bTokens = tokens(b);
    if (aTokens.length === 0 || bTokens.length === 0) return false;
    const shared = aTokens.filter((token) => bTokens.includes(token)).length;
    return shared / Math.min(aTokens.length, bTokens.length) >= 0.6;
  };

  const sourceCandidates: string[] = [];
  const translatedCandidates: string[] = [];
  const addCandidate = (value: string, origin: "source" | "translated") => {
    const explicitUnit = detectExplicitUnitFromEvidenceLineV17_90L3(value);
    if (
      explicitUnit &&
      getServiceUnitType(explicitUnit) !== getServiceUnitType(args.unit)
    ) {
      return;
    }

    const extracted = cleanTranslatedServiceLabelFromLineV17_90L(value);
    const withoutAmount = stripCanonicalAmountSuffixFromServiceNameV17_90L199({
      serviceName: extracted,
      quantity: args.quantity,
    });
    const candidate = normalizeVisibleServiceNameCasingV17_66(withoutAmount);
    if (
      !candidate ||
      candidate.length < 4 ||
      candidate.length > 120 ||
      isInternalReviewServiceNameV17_90L(candidate) ||
      /\b(?:CHF|EUR|USD|GBP)\b/i.test(candidate)
    ) {
      return;
    }

    if (
      origin === "source" &&
      !labelsAreStructurallyCompatible(fallback, candidate)
    ) {
      return;
    }

    if (
      origin === "translated" &&
      !isUsableGermanServiceLabelV17_90L(candidate) &&
      !labelsAreStructurallyCompatible(fallback, candidate)
    ) {
      return;
    }

    (origin === "translated" ? translatedCandidates : sourceCandidates).push(
      candidate,
    );
  };

  if (
    args.sourceText &&
    translatedLineMatchesItemNumbersV17_90L(args.sourceText, {
      quantity: args.quantity,
      unitPrice: args.unitPrice,
    })
  ) {
    addCandidate(args.sourceText, "source");
  }

  const translated = String(args.translatedText || "").trim();
  if (translated) {
    translated
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) =>
        translatedLineMatchesItemNumbersV17_90L(line, {
          quantity: args.quantity,
          unitPrice: args.unitPrice,
        }),
      )
      .forEach((line) => addCandidate(line, "translated"));

    extractTranslatedPricedServiceSegmentsV17_66(translated)
      .filter(
        (segment) =>
          Math.abs(segment.quantity - args.quantity) < 0.0001 &&
          Math.abs(segment.unitPrice - args.unitPrice) < 0.0001 &&
          getServiceUnitType(segment.unit) === getServiceUnitType(args.unit),
      )
      .forEach((segment) => addCandidate(segment.serviceName, "translated"));
  }

  const unique = (values: string[]) =>
    Array.from(
      new Map(values.map((candidate) => [normalizeUnitText(candidate), candidate]))
        .values(),
    );
  const uniqueTranslated = unique(translatedCandidates);
  if (uniqueTranslated.length === 1) return uniqueTranslated[0];
  if (uniqueTranslated.length > 1) return fallback;

  const uniqueSource = unique(sourceCandidates);
  return uniqueSource.length === 1 ? uniqueSource[0] : fallback;
}

function canonicalServiceActionV17_90L202(value: unknown): string | null {
  const key = normalizeUnitText(value);
  const match = key.match(
    /\b(reinigen|abstauben|abwischen|streichen|schleifen|schneiden|entsorgen|sortieren|putzen|montieren|ersetzen|reparieren|entkalken|verlegen|befestigen|pruefen|kontrollieren|erstellen)\b/,
  );
  return match?.[1] || null;
}

function completeCanonicalServiceNamesV17_90L202(
  items: CanonicalAiOrderItemV17_90L88[],
): CanonicalAiOrderItemV17_90L88[] {
  const cleanedNames = items.map((item) =>
    stripCanonicalAmountSuffixFromServiceNameV17_90L199({
      serviceName: String(item.serviceName || "")
        .replace(
          /^\s*(?:(?:und|sowie|plus|danach|dann|noch|zusätzlich|zusaetzlich)\s+)+/i,
          "",
        )
        .trim(),
      quantity: Number(item.quantity || 0),
    }),
  );

  const actionCounts = new Map<string, number>();
  cleanedNames.forEach((name) => {
    const action = canonicalServiceActionV17_90L202(name);
    if (action) actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
  });
  const rankedActions = [...actionCounts.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  const dominantAction =
    rankedActions.length > 0 &&
    rankedActions[0][1] >= 2 &&
    (rankedActions.length === 1 || rankedActions[0][1] > rankedActions[1][1])
      ? rankedActions[0][0]
      : null;

  return items.map((item, index) => {
    let serviceName = cleanedNames[index];
    const hasAction = Boolean(canonicalServiceActionV17_90L202(serviceName));
    const ownEvidenceIsPriced = translatedLineMatchesItemNumbersV17_90L(
      String(item.sourceText || item.evidence || item.description || ""),
      { quantity: item.quantity, unitPrice: item.unitPrice },
    );
    const canInheritDominantAction = Boolean(
      dominantAction &&
        !hasAction &&
        getServiceUnitType(item.unit) !== "flat" &&
        Number(item.quantity || 0) > 0 &&
        Number(item.unitPrice || 0) > 0 &&
        ownEvidenceIsPriced &&
        serviceName &&
        !isInternalReviewServiceNameV17_90L(serviceName),
    );
    if (canInheritDominantAction) {
      serviceName = `${serviceName} ${dominantAction}`.replace(/\s+/g, " ").trim();
    }

    return {
      ...item,
      serviceName: normalizeVisibleServiceNameCasingV17_66(serviceName),
    };
  });
}

function repairCanonicalServiceSpellingFromContextV17_90L202(
  items: CanonicalAiOrderItemV17_90L88[],
  contextText?: string | null,
): CanonicalAiOrderItemV17_90L88[] {
  const contextTokens = String(contextText || "").match(/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]{6,}/gu) || [];
  if (contextTokens.length === 0) return items;

  const normalizeToken = (value: string) => normalizeUnitText(value).replace(/[^a-z0-9]/g, "");
  const stop = new Set([
    "reinigen", "reinigung", "abstauben", "abwischen", "streichen",
    "schleifen", "schneiden", "entsorgen", "sortieren", "putzen",
    "montieren", "ersetzen", "reparieren", "entkalken", "verlegen",
    "befestigen", "pruefen", "kontrollieren", "erstellen",
  ]);

  return items.map((item) => {
    const words = String(item.serviceName || "").split(/(\s+)/);
    let changed = false;
    const repaired = words.map((word) => {
      const current = normalizeToken(word);
      if (current.length < 6 || stop.has(current)) return word;

      const matches = contextTokens
        .map((candidate) => {
          const normalizedCandidate = normalizeToken(candidate);
          const baseCandidate =
            normalizedCandidate.endsWith("s") && normalizedCandidate.length > 7
              ? normalizedCandidate.slice(0, -1)
              : normalizedCandidate;
          const score = canonicalRoleEditSimilarityV17_90L201(
            current,
            baseCandidate,
          );
          return { candidate, baseCandidate, score };
        })
        .filter(
          (entry) =>
            entry.baseCandidate !== current &&
            entry.baseCandidate.slice(0, 4) === current.slice(0, 4) &&
            Math.abs(entry.baseCandidate.length - current.length) <= 2 &&
            entry.score >= 0.9,
        )
        .sort((left, right) => right.score - left.score);

      if (matches.length !== 1 && matches[0]?.score === matches[1]?.score) return word;
      const best = matches[0];
      if (!best) return word;

      let replacement = best.candidate;
      if (normalizeToken(replacement).endsWith("s") && !current.endsWith("s")) {
        replacement = replacement.slice(0, -1);
      }
      if (/^[A-ZÄÖÜ]/u.test(word)) {
        replacement = `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
      } else {
        replacement = `${replacement.charAt(0).toLowerCase()}${replacement.slice(1)}`;
      }
      changed = true;
      return replacement;
    });

    return changed
      ? { ...item, serviceName: repaired.join("") }
      : item;
  });
}

function extractLeadingCountFromEvidenceV17_90L89(
  value: unknown,
): number {
  const source = compactText(value);
  const match = source.match(
    /^\s*[-•]?\s*(\d+(?:[.,]\d+)?)\s+(?=[\p{L}])/u,
  );
  return parsePositiveCanonicalNumberV17_90L89(match?.[1]);
}

function evidenceSupportsStructuralPieceUnitV17_90L89(
  sourceText: string,
  quantity: number,
): boolean {
  const leadingCount = extractLeadingCountFromEvidenceV17_90L89(sourceText);
  if (
    leadingCount <= 0 ||
    quantity <= 0 ||
    Math.abs(leadingCount - quantity) >= 0.0001
  ) {
    return false;
  }

  if (/\b(?:pauschal|fixpreis|festpreis|flat\s*fee)\b/i.test(sourceText)) {
    return false;
  }

  // A leading count plus its own price relation is a general count structure,
  // independent of the service vocabulary: "18 X à CHF 14", "6 Y je CHF 28".
  return /(?:\b(?:je|each|per|pro)\b|à)\s*(?:(?:CHF|EUR|USD|GBP|SFR|Fr\.?)\s*)?\d/i.test(
    sourceText,
  );
}

function evidenceSupportsStructuralFlatUnitV17_90L89(
  sourceText: string,
  quantity: number,
  unitPrice: number,
): boolean {
  if (quantity > 0 || unitPrice <= 0) return false;
  if (extractLeadingCountFromEvidenceV17_90L89(sourceText) > 0) return false;

  const moneyMatches = sourceText.match(
    /(?:CHF|EUR|USD|GBP|SFR|Fr\.?|€|\$)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:CHF|EUR|USD|GBP|SFR|Fr\.?|€|\$)/gi,
  );
  return (moneyMatches?.length || 0) === 1;
}


// V17.90L204: A number attached to a singular floor/location label is a
// location identifier (for example "6 Etage" = 6th floor), not a billable
// quantity. This guard is line-local and does not depend on service words.
type OrdinalLocationEvidenceV17_90L204 = {
  number: number;
  label: "Etage" | "Stockwerk" | "Geschoss" | "Floor" | "Piano";
};

function detectSingularOrdinalLocationEvidenceV17_90L204(
  value: unknown,
): OrdinalLocationEvidenceV17_90L204 | null {
  const source = compactText(value);
  if (!source) return null;

  const match = source.match(
    /\b(\d{1,2})(?:\.)?\s*(etage|stock(?:werk)?|geschoss|floor|storey|étage|piano)\b(?!\s*(?:n|s|e))/iu,
  );
  if (!match?.[1] || !match[2]) return null;

  // Explicit count/multiplication evidence still wins. The guard only handles
  // a singular location identifier without a count unit.
  const around = source.slice(
    Math.max(0, (match.index || 0) - 18),
    Math.min(source.length, (match.index || 0) + match[0].length + 18),
  );
  if (
    /\b(?:stueck|stück|stk\.?|pieces?|pcs\.?|unit(?:s|és)?|x|mal)\b/iu.test(
      around,
    )
  ) {
    return null;
  }

  const rawLabel = normalizeUnitText(match[2]);
  const label: OrdinalLocationEvidenceV17_90L204["label"] =
    rawLabel.startsWith("stock")
      ? "Stockwerk"
      : rawLabel === "geschoss"
        ? "Geschoss"
        : rawLabel === "floor" || rawLabel === "storey"
          ? "Floor"
          : rawLabel === "piano"
            ? "Piano"
            : "Etage";
  return { number: Number(match[1]), label };
}

function normalizeOrdinalLocationServiceNameV17_90L204(args: {
  serviceName: string;
  ordinal: OrdinalLocationEvidenceV17_90L204;
}): string {
  const original = compactText(args.serviceName);
  if (!original) return original;

  const number = String(args.ordinal.number);
  const locationPattern =
    args.ordinal.label === "Stockwerk"
      ? "Stockwerke?"
      : args.ordinal.label === "Geschoss"
        ? "Geschosse?"
        : args.ordinal.label === "Floor"
          ? "Floors?"
          : args.ordinal.label === "Piano"
            ? "Piani|Piano"
            : "Etagen?";

  let normalized = original.replace(
    new RegExp(`\\b${number}\\s*\\.?\\s*(?:${locationPattern})\\b`, "iu"),
    `${number}. ${args.ordinal.label === "Floor" || args.ordinal.label === "Piano" ? "Etage" : args.ordinal.label}`,
  );

  // If the model pluralized the immediately preceding German location/object
  // noun only because it misread the ordinal as a count, normalize the common
  // German plural suffix morphologically. This is not service classification.
  normalized = normalized.replace(
    new RegExp(
      `\\b([\\p{L}-]+?)(böden|boeden|räume|raeume|gänge|gaenge|flächen|flaechen|häuser|haeuser)\\s+${number}\\.`,
      "iu",
    ),
    (_match, prefix: string, suffix: string) => {
      const suffixKey = normalizeUnitText(suffix);
      const singular =
        suffixKey === "boeden"
          ? "boden"
          : suffixKey === "raeume"
            ? "raum"
            : suffixKey === "gaenge"
              ? "gang"
              : suffixKey === "flaechen"
                ? "fläche"
                : "haus";
      return `${prefix}${singular} ${number}.`;
    },
  );

  return normalized.replace(/\s+/g, " ").trim();
}


// V17.90L226: Evidence-bound structural completion before the canonical lock.
// This layer is deliberately service-agnostic: it does not classify trades or
// rely on customer-specific wording. It only interprets explicit billing
// structure inside the first AI row's own evidence. Clear total/flat prices are
// normalized to 1 × Pauschal. If total and per-unit interpretations conflict,
// the explicit count is retained while the price remains blocked for review.
type CanonicalEvidenceAmountV17_90L226 = {
  value: number;
  index: number;
  end: number;
};

type CanonicalEvidenceStructureV17_90L226 = {
  explicitFlatTotal: boolean;
  perUnitSignal: boolean;
  priceConflict: boolean;
  inferredQuantity: number;
  inferredUnit: string | null;
  inferredFlatPrice: number;
  inferredPerUnitPrice: number;
  consistentTotalAndPerUnit: boolean;
};

function parseCanonicalEvidenceNumberV17_90L226(value: unknown): number {
  const raw = String(value ?? "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return 0;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const decimalSeparator = raw[decimalIndex];
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = raw.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractCanonicalEvidenceAmountsV17_90L226(
  value: unknown,
): CanonicalEvidenceAmountV17_90L226[] {
  const source = String(value || "");
  if (!source.trim()) return [];

  const currency = String.raw`(?:CHF|SFR\.?|FR\.?|EUR|EURO|USD|DOLLAR|GBP|PFUND|€|\$|£)`;
  const number = String.raw`([0-9][0-9’'.,]*)`;
  const pattern = new RegExp(
    String.raw`(?:\b${currency}\s*${number}\b|\b${number}\s*${currency}\b)`,
    "giu",
  );
  const result: CanonicalEvidenceAmountV17_90L226[] = [];
  for (const match of source.matchAll(pattern)) {
    const rawNumber = match[1] || match[2] || "";
    const parsed = parseCanonicalEvidenceNumberV17_90L226(rawNumber);
    if (!parsed) continue;
    const index = match.index ?? -1;
    if (index < 0) continue;
    result.push({ value: parsed, index, end: index + match[0].length });
  }
  return result;
}

function nearestCanonicalEvidenceAmountV17_90L226(args: {
  markers: number[];
  amounts: CanonicalEvidenceAmountV17_90L226[];
  maxDistance: number;
}): number {
  let best: { value: number; distance: number } | null = null;
  for (const marker of args.markers) {
    for (const amount of args.amounts) {
      const distance = Math.min(
        Math.abs(amount.index - marker),
        Math.abs(amount.end - marker),
      );
      if (distance > args.maxDistance) continue;
      if (!best || distance < best.distance) {
        best = { value: amount.value, distance };
      }
    }
  }
  return best?.value || 0;
}

function canonicalMarkerIndexesV17_90L226(
  source: string,
  pattern: RegExp,
): number[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return Array.from(source.matchAll(globalPattern))
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);
}

function inferCanonicalCountFromOwnEvidenceV17_90L226(args: {
  sourceText: string;
  serviceName: string;
}): { quantity: number; unit: string | null } {
  const explicit = detectAllQuantityUnitsFromText(args.sourceText)[0];
  if (explicit?.value && explicit.value > 0) {
    return {
      quantity: explicit.value,
      unit: unitTypeToDisplayUnit(explicit.unit),
    };
  }

  const serviceTokens = new Set(
    canonicalServiceKeyV17_90L88(args.serviceName)
      .split(/\s+/g)
      .filter((token) => token.length >= 4),
  );
  if (serviceTokens.size === 0) return { quantity: 0, unit: null };

  const source = String(args.sourceText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const countPattern = /(?:^|[^\d])(\d+(?:[.,]\d+)?)\s+([\p{L}][\p{L}'’\-]{2,})/giu;
  for (const match of source.matchAll(countPattern)) {
    const quantity = parseCanonicalEvidenceNumberV17_90L226(match[1]);
    if (!quantity || quantity > 100000) continue;

    const nounKey = canonicalServiceKeyV17_90L88(match[2]);
    if (!nounKey || nounKey.length < 4) continue;

    // A singular floor/location number is an ordinal location, not a billing
    // quantity. Plural counts remain eligible.
    if (
      /^(?:etage|stock|stockwerk|geschoss|floor|storey|piano)$/i.test(
        nounKey,
      )
    ) {
      continue;
    }

    const overlapsService = [...serviceTokens].some(
      (token) => token === nounKey || token.includes(nounKey) || nounKey.includes(token),
    );
    if (!overlapsService) continue;
    return { quantity, unit: "Stück" };
  }

  return { quantity: 0, unit: null };
}

function analyzeCanonicalEvidenceStructureV17_90L226(args: {
  sourceText: string;
  serviceName: string;
}): CanonicalEvidenceStructureV17_90L226 {
  const source = String(args.sourceText || "");
  const amounts = extractCanonicalEvidenceAmountsV17_90L226(source);

  const flatMarkerPattern = /\b(?:gesamtpreis|totalpreis|endpreis|fixpreis|festpreis|pauschalpreis|pauschale|pauschal|insgesamt|total\s+price|total\s+amount|flat\s+rate|lump\s+sum|forfait(?:\s+total)?|prix\s+total|montant\s+total|prezzo\s+totale|importo\s+totale|a\s+corpo|precio\s+total|importe\s+total|tarifa\s+fija|pre[cç]o\s+total|valor\s+total|pre[cç]o\s+fixo)\b/giu;
  const perUnitPattern = /(?:\b(?:pro|je|per|each|par|por|cada)\b|(?:à|@)\s*(?:(?:CHF|SFR\.?|FR\.?|EUR|EURO|USD|GBP|€|\$|£)\s*)?\d)/giu;

  const flatMarkers = canonicalMarkerIndexesV17_90L226(
    source,
    flatMarkerPattern,
  );
  const perUnitMarkers = canonicalMarkerIndexesV17_90L226(
    source,
    perUnitPattern,
  );
  const flatAmount = nearestCanonicalEvidenceAmountV17_90L226({
    markers: flatMarkers,
    amounts,
    maxDistance: 140,
  });
  const perUnitAmount = nearestCanonicalEvidenceAmountV17_90L226({
    markers: perUnitMarkers,
    amounts,
    maxDistance: 100,
  });
  const inferred = inferCanonicalCountFromOwnEvidenceV17_90L226(args);
  const explicitFlatTotal = flatMarkers.length > 0 && flatAmount > 0;
  const perUnitSignal = perUnitMarkers.length > 0 && perUnitAmount > 0;

  let priceConflict = false;
  let consistentTotalAndPerUnit = false;
  if (explicitFlatTotal && perUnitSignal) {
    if (inferred.quantity > 0) {
      const calculatedTotal = roundIntakeMoney(
        perUnitAmount * inferred.quantity,
      );
      priceConflict =
        Math.abs(calculatedTotal - roundIntakeMoney(flatAmount)) >= 0.01;
      consistentTotalAndPerUnit = !priceConflict;
    } else {
      priceConflict = Math.abs(flatAmount - perUnitAmount) >= 0.01;
      consistentTotalAndPerUnit = !priceConflict;
    }
  }

  return {
    explicitFlatTotal,
    perUnitSignal,
    priceConflict,
    inferredQuantity: inferred.quantity,
    inferredUnit: inferred.unit,
    inferredFlatPrice: flatAmount,
    inferredPerUnitPrice: perUnitAmount,
    consistentTotalAndPerUnit,
  };
}


type SharedFlatPackageEvidenceV17_90L232 = {
  serviceName: string;
  sourceText: string;
  price: number;
  currency: string | null;
};

function rawAiItemEvidenceV17_90L232(raw: any): string {
  return String(
    raw?.sourceText ??
      raw?.source_text ??
      raw?.evidence ??
      raw?.raw ??
      raw?.description ??
      "",
  )
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rawAiItemServiceNameV17_90L232(raw: any): string {
  return String(
    raw?.serviceName ??
      raw?.name ??
      raw?.action_name ??
      raw?.service_name ??
      raw?.matched_service_name ??
      "",
  )
    .replace(/\s+/g, " ")
    .trim();
}

function sharedPackageEvidenceKeyV17_90L232(value: unknown): string {
  return normalizeSemanticText(String(value || ""))
    .replace(/\b(?:gesamtpreis|totalpreis|endpreis|fixpreis|festpreis|pauschalpreis|pauschale|pauschal|insgesamt|total price|total amount|flat rate|lump sum|forfait total|prix total|montant total|prezzo totale|importo totale|a corpo|precio total|importe total|tarifa fija|preco total|preço total|valor total|preco fixo|preço fixo)\b.*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sharedPackageEvidenceEquivalentV17_90L232(
  left: string,
  right: string,
): boolean {
  const leftKey = sharedPackageEvidenceKeyV17_90L232(left);
  const rightKey = sharedPackageEvidenceKeyV17_90L232(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;

  const leftTokens = new Set(
    leftKey.split(/\s+/g).filter((token) => token.length >= 3),
  );
  const rightTokens = new Set(
    rightKey.split(/\s+/g).filter((token) => token.length >= 3),
  );
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.9;
}

function stripSharedFlatPriceTailV17_90L232(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(
      /\s*[.,;:\-–—]*\s*\b(?:gesamtpreis|totalpreis|endpreis|fixpreis|festpreis|pauschalpreis|pauschale|pauschal|insgesamt|total\s+price|total\s+amount|flat\s+rate|lump\s+sum|forfait(?:\s+total)?|prix\s+total|montant\s+total|prezzo\s+totale|importo\s+totale|a\s+corpo|precio\s+total|importe\s+total|tarifa\s+fija|pre[cç]o\s+total|valor\s+total|pre[cç]o\s+fixo)\b.*$/iu,
      "",
    )
    .replace(/[.,;:\-–—]+$/g, "")
    .trim();
}

function explicitSharedFlatFragmentV17_90L232(value: unknown): string | null {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return null;

  const currency = String.raw`(?:CHF|SFR\.?|FR\.?|EUR|EURO|USD|DOLLAR|GBP|PFUND|€|\$|£)`;
  const amount = String.raw`[0-9][0-9’'.,]*`;
  const flat = String.raw`(?:gesamtpreis|totalpreis|endpreis|fixpreis|festpreis|pauschalpreis|pauschale|pauschal|insgesamt|total\s+price|total\s+amount|flat\s+rate|lump\s+sum|forfait(?:\s+total)?|prix\s+total|montant\s+total|prezzo\s+totale|importo\s+totale|a\s+corpo|precio\s+total|importe\s+total|tarifa\s+fija|pre[cç]o\s+total|valor\s+total|pre[cç]o\s+fixo)`;
  const forward = new RegExp(
    String.raw`\b${flat}\b[^.!?\n]{0,80}?(?:${currency}\s*${amount}|${amount}\s*${currency})`,
    "iu",
  );
  const reverse = new RegExp(
    String.raw`(?:${currency}\s*${amount}|${amount}\s*${currency})[^.!?\n]{0,50}?\b${flat}\b`,
    "iu",
  );
  return source.match(forward)?.[0] || source.match(reverse)?.[0] || null;
}

function findSharedFlatPackageEvidenceV17_90L232(args: {
  sharedEvidence: string;
  contextText?: string | null;
  translatedText?: string | null;
  serviceNames: string[];
}): SharedFlatPackageEvidenceV17_90L232 | null {
  const sourceEvidence = String(args.sharedEvidence || "").trim();
  if (!sourceEvidence) return null;

  const candidateTexts: string[] = [sourceEvidence];
  const evidenceKey = sharedPackageEvidenceKeyV17_90L232(sourceEvidence);

  for (const corpusValue of [args.contextText, args.translatedText]) {
    const corpus = String(corpusValue || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!corpus) continue;

    const lines = corpus
      .split(/\n+/g)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!sharedPackageEvidenceEquivalentV17_90L232(line, sourceEvidence)) {
        continue;
      }
      candidateTexts.push(line);
      if (lines[index + 1]) candidateTexts.push(`${line}\n${lines[index + 1]}`);
      if (lines[index - 1]) candidateTexts.push(`${lines[index - 1]}\n${line}`);
    }

    const exactIndex = corpus.toLocaleLowerCase("de-CH").indexOf(
      sourceEvidence.toLocaleLowerCase("de-CH"),
    );
    if (exactIndex >= 0) {
      const tail = corpus.slice(
        exactIndex + sourceEvidence.length,
        exactIndex + sourceEvidence.length + 220,
      );
      const flatFragment = explicitSharedFlatFragmentV17_90L232(tail);
      if (flatFragment) {
        candidateTexts.push(`${sourceEvidence}\n${flatFragment}`);
      }
    } else if (evidenceKey) {
      // Flattened WhatsApp text may differ only in punctuation/spacing. Search
      // for the first and last substantial evidence tokens and inspect only the
      // short local tail between the shared service and the next statement.
      const tokens = evidenceKey.split(/\s+/g).filter((token) => token.length >= 4);
      if (tokens.length >= 2) {
        const corpusKey = normalizeSemanticText(corpus);
        const firstIndex = corpusKey.indexOf(tokens[0]);
        const lastToken = tokens[tokens.length - 1];
        const lastIndex = firstIndex >= 0 ? corpusKey.indexOf(lastToken, firstIndex) : -1;
        if (firstIndex >= 0 && lastIndex >= firstIndex) {
          const approximateTail = corpusKey.slice(lastIndex + lastToken.length, lastIndex + lastToken.length + 180);
          const flatFragment = explicitSharedFlatFragmentV17_90L232(approximateTail);
          if (flatFragment) candidateTexts.push(`${sourceEvidence}\n${flatFragment}`);
        }
      }
    }
  }

  let best: SharedFlatPackageEvidenceV17_90L232 | null = null;
  for (const candidate of candidateTexts) {
    const structure = analyzeCanonicalEvidenceStructureV17_90L226({
      sourceText: candidate,
      serviceName: args.serviceNames.join(" "),
    });
    if (
      !structure.explicitFlatTotal ||
      structure.perUnitSignal ||
      structure.priceConflict ||
      structure.inferredFlatPrice <= 0
    ) {
      continue;
    }

    const amounts = extractCanonicalEvidenceAmountsV17_90L226(candidate);
    const distinctAmounts = Array.from(
      new Set(amounts.map((entry) => roundIntakeMoney(entry.value))),
    );
    if (distinctAmounts.length !== 1) continue;

    const serviceName = stripSharedFlatPriceTailV17_90L232(sourceEvidence);
    if (!serviceName || serviceName.length < 4 || serviceName.length > 220) {
      continue;
    }

    const price = structure.inferredFlatPrice;
    const currency = String(detectCurrencyFromText(candidate) || "")
      .trim()
      .toUpperCase() || null;
    const result = {
      serviceName,
      sourceText: `${serviceName}\n${explicitSharedFlatFragmentV17_90L232(candidate) || candidate}`
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      price,
      currency,
    };
    if (!best || result.sourceText.length < best.sourceText.length) best = result;
  }

  return best;
}

function mergeSharedFlatPackageRowsV17_90L232(
  rawItems: any[],
  translatedText?: string | null,
  contextText?: string | null,
): any[] {
  if (!Array.isArray(rawItems) || rawItems.length < 2) return rawItems;

  const consumed = new Set<number>();
  const mergedAt = new Map<number, any>();

  for (let index = 0; index < rawItems.length; index += 1) {
    if (consumed.has(index)) continue;
    const sourceText = rawAiItemEvidenceV17_90L232(rawItems[index]);
    if (!sourceText) continue;

    const groupIndexes = rawItems
      .map((raw, candidateIndex) => ({ raw, candidateIndex }))
      .filter(
        ({ candidateIndex, raw }) =>
          candidateIndex >= index &&
          !consumed.has(candidateIndex) &&
          sharedPackageEvidenceEquivalentV17_90L232(
            sourceText,
            rawAiItemEvidenceV17_90L232(raw),
          ),
      )
      .map(({ candidateIndex }) => candidateIndex);
    if (groupIndexes.length < 2) continue;

    const serviceNames = groupIndexes
      .map((candidateIndex) => rawAiItemServiceNameV17_90L232(rawItems[candidateIndex]))
      .filter(Boolean);
    if (new Set(serviceNames.map(canonicalServiceKeyV17_90L88)).size < 2) {
      continue;
    }

    const packageEvidence = findSharedFlatPackageEvidenceV17_90L232({
      sharedEvidence: sourceText,
      contextText,
      translatedText,
      serviceNames,
    });
    if (!packageEvidence) continue;

    const explicitRowPrices = Array.from(
      new Set(
        groupIndexes
          .map((candidateIndex) =>
            parsePositiveCanonicalNumberV17_90L89(
              rawItems[candidateIndex]?.unitPrice ??
                rawItems[candidateIndex]?.unit_price ??
                rawItems[candidateIndex]?.price,
            ),
          )
          .filter((price) => price > 0)
          .map(roundIntakeMoney),
      ),
    );
    if (
      explicitRowPrices.length > 1 ||
      (explicitRowPrices.length === 1 &&
        Math.abs(explicitRowPrices[0] - roundIntakeMoney(packageEvidence.price)) >= 0.01)
    ) {
      continue;
    }

    const firstRaw = rawItems[groupIndexes[0]];
    mergedAt.set(groupIndexes[0], {
      ...firstRaw,
      serviceName: packageEvidence.serviceName,
      name: packageEvidence.serviceName,
      action_name: packageEvidence.serviceName,
      service_name: packageEvidence.serviceName,
      quantity: 1,
      menge: 1,
      unit: "Pauschal",
      einheit: "Pauschal",
      unitPrice: packageEvidence.price,
      unit_price: packageEvidence.price,
      price: packageEvidence.price,
      currency:
        packageEvidence.currency || String(firstRaw?.currency || "CHF").toUpperCase(),
      sourceText: packageEvidence.sourceText,
      source_text: packageEvidence.sourceText,
      evidence: packageEvidence.sourceText,
      raw: packageEvidence.sourceText,
      needsReview: false,
      needs_review: false,
      reviewReason: "",
      review_reason: "",
    });
    for (const candidateIndex of groupIndexes) consumed.add(candidateIndex);

    console.log(
      `[FirstAiSharedFlatPackageV17_90L232] merged rows=${groupIndexes.length} service=${packageEvidence.serviceName} price=${packageEvidence.price}`,
    );
  }

  if (mergedAt.size === 0) return rawItems;
  const result: any[] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    if (mergedAt.has(index)) {
      result.push(mergedAt.get(index));
      continue;
    }
    if (consumed.has(index)) continue;
    result.push(rawItems[index]);
  }
  return result;
}


type PositionTypeGuardOutcomeV17_90L371AM = {
  positionType: string;
  confidence: "clear" | "unchanged" | "review";
  reviewReason?: string | null;
};

function normalizePositionTypeTokenV17_90L371AM(value: unknown): string | null {
  const key = normalizeUnitText(value || "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!key) return null;
  if (/\b(?:service|dienstleistung|leistung|arbeit|work|labor|labour)\b/.test(key)) return "service";
  if (/\b(?:material|materialien|produkt|product|verbrauchsmaterial|supplies?)\b/.test(key)) return "material";
  if (/\b(?:equipment|geraet|gerät|maschine|maschinen|werkzeug|tool|tools|machine|machines)\b/.test(key)) return "equipment";
  if (/\b(?:expense|kosten|zusatzkosten|spesen|fee|fees|charge|charges|anfahrt|fahrtkosten|entsorgung|disposal|flat\s*fee)\b/.test(key)) return "expense";
  return null;
}

function classifyPositionTypeBeforeCanonicalLockV17_90L371AM(args: {
  raw: any;
  serviceName: string;
  sourceText: string;
}): PositionTypeGuardOutcomeV17_90L371AM {
  const explicitToken = normalizePositionTypeTokenV17_90L371AM(
    args.raw?.positionType ?? args.raw?.position_type ?? args.raw?.type,
  );
  const normalizedExplicit = normalizePositionType(
    explicitToken || args.raw?.positionType || args.raw?.position_type || args.raw?.type,
  );
  const text = normalizeUnitText(
    [
      args.serviceName,
      args.sourceText,
      args.raw?.context,
      args.raw?.raw,
      args.raw?.evidence,
      args.raw?.source_text,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const hasExpenseSignal = /\b(?:anfahrt|fahrtkosten|wegkosten|reisekosten|transportkosten|einsatzpauschale|zusatzkosten|nebenkosten|spesen|gebuehr|gebuehren|gebühr|gebühren|parkgebuehr|parkgebühr|maut|deponie|entsorgung|entsorgungskosten|abfallentsorgung|schmutzwasser|abwasser|disposal|waste|dumping|travel\s+costs?|trip\s+charge|call\s*out|callout|delivery\s+fee)\b/.test(text);
  const hasEquipmentSignal = /\b(?:geraet|geraete|gerät|geräte|maschine|maschinen|einscheibenmaschine|scheuersaugmaschine|hochdruckreiniger|dampfreiniger|spezialmaschine|hubwagen|werkzeug|werkzeuge|geruest|gerueste|geruestbau|baugeruest|geruestmiete|gerueststandzeit|arbeitsbuehne|hebebuehne|bautrockner|poliermaschine|equipment|machine|machines|tool|tools|scaffold|scaffolding|apparat|apparatur|miete|mieten|rental)\b/.test(text) ||
    /\b(?:geruest\s+(?:aufbau|standzeit|benutzung|miete)|(?:aufbau|standzeit|benutzung|miete)\s+geruest)\b/.test(text) ||
    /\b[\p{L}0-9_-]*(?:maschine|maschinen|geraet|gerät|geraete|geräte|werkzeug|werkzeuge|geruest|buehne|trockner)\b/iu.test(text);
  const clearMaterialSignal = /\b(?:material|materialien|verbrauchsmaterial|reinigungsmittel|reinigungsmaterial|reiniger|spezialreiniger|chemie|chemikalie|chemikalien|produkt|produkte|ersatzteil|ersatzteile|zement|kartusche|kartuschen|gebinde|filter|soap|detergent|cleaner|solvent|cement)\b/.test(text);
  const localQuantityUnit = detectAllQuantityUnitsFromText(args.sourceText || "")[0]?.unit ||
    getServiceUnitType(args.raw?.unit ?? args.raw?.einheit ?? null);
  const materialIncompatibleUnit = ["square_meter", "cubic_meter", "meter", "hour", "day"].includes(localQuantityUnit);
  const hasMaterialSignal = clearMaterialSignal && !materialIncompatibleUnit;

  if (hasExpenseSignal) {
    return { positionType: normalizePositionType("expense"), confidence: "clear" };
  }
  if (hasEquipmentSignal) {
    return { positionType: normalizePositionType("equipment"), confidence: "clear" };
  }
  if (hasMaterialSignal) {
    return { positionType: normalizePositionType("material"), confidence: "clear" };
  }

  if (explicitToken) {
    return { positionType: normalizedExplicit, confidence: "unchanged" };
  }

  return { positionType: normalizePositionType("service"), confidence: "unchanged" };
}

function cleanLineLocalCostPositionNameV17_90L371AP(args: {
  positionType: string;
  sourceText: string;
  serviceName: string;
}): string {
  const positionType = normalizePositionType(args.positionType);
  if (!["expense", "disposal", "flat_fee"].includes(positionType)) {
    return args.serviceName;
  }

  const source = String(args.sourceText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = String(args.serviceName || "")
    .replace(/\s+/g, " ")
    .trim();
  const candidateSource = source || fallback;

  const cleaned = candidateSource
    .replace(/\s+\b(?:chf|eur|euro|sfr|fr)\.?\s*[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\b.*$/iu, "")
    .replace(/\s+\b[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\s*(?:chf|eur|euro|sfr|fr)\.?\b.*$/iu, "")
    .replace(/\s*[,;:–—-]\s*(?:pauschal|gesamt|total)?\s*$/iu, "")
    .replace(/[,:;–—.\s]+$/g, "")
    .replace(/^[-–—,:;.\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length >= 3 && cleaned.length <= 120) return cleaned;
  return fallback;
}



function cleanBillablePositionNameBeforeCanonicalLockV17_90L371AR(args: {
  serviceName: string;
  sourceText: string;
  quantity: number;
  unitPrice: number;
}): string {
  const original = String(args.serviceName || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!original) return original;

  const fromExistingName = stripCanonicalAmountSuffixFromServiceNameV17_90L199({
    serviceName: original,
    quantity: Number(args.quantity || 0),
  })
    .replace(/\s*(?:à|@|\b(?:je|pro|per|par|por|at|each)\b)\s*$/iu, "")
    .replace(/\s+\b(?:chf|eur|euro|sfr|fr)\.?\s*[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\b.*$/iu, "")
    .replace(/\s+\b[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\s*(?:chf|eur|euro|sfr|fr)\.?\b.*$/iu, "")
    .replace(/[,:;–—.\s]+$/g, "")
    .replace(/^[-–—,:;.\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const source = String(args.sourceText || "")
    .replace(/\s+/g, " ")
    .trim();
  const quantity = Number(args.quantity || 0);
  if (source && Number.isFinite(quantity) && quantity > 0) {
    const quantityPattern = (Number.isInteger(quantity)
      ? String(Math.trunc(quantity))
      : String(Number(quantity.toFixed(4))))
      .split(".")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[.,]");
    const sourceCandidate = source
      .replace(
        new RegExp(
          `\\s*[,;:–—-]?\\s+${quantityPattern}\\s+[\\p{L}0-9%/²³._-]+(?:\\s+[\\p{L}0-9%/²³._-]+){0,3}\\s*(?:à|@|\\b(?:je|pro|per|par|por|at|each)\\b|\\b(?:chf|eur|euro|sfr|fr)\\b).*?$`,
          "iu",
        ),
        "",
      )
      .replace(/\s+\b(?:chf|eur|euro|sfr|fr)\.?\s*[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\b.*$/iu, "")
      .replace(/\s+\b[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\s*(?:chf|eur|euro|sfr|fr)\.?\b.*$/iu, "")
      .replace(/[,:;–—.\s]+$/g, "")
      .replace(/^[-–—,:;.\s]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      sourceCandidate.length >= 3 &&
      sourceCandidate.length <= 120 &&
      normalizeUnitText(original).includes(normalizeUnitText(sourceCandidate))
    ) {
      return sourceCandidate;
    }
  }

  return fromExistingName.length >= 3 && /\p{L}/u.test(fromExistingName)
    ? fromExistingName
    : original;
}

function cleanLineLocalUnitLabelV17_90L371AQ(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[,:;–—.\s]+$/g, "")
    .replace(/\s*(?:à|@|\b(?:je|pro|per|par|por|at|each)\b)\s*$/iu, "")
    .replace(/\s*\b(?:chf|eur|euro|sfr|fr)\b\s*$/iu, "")
    .replace(/[,:;–—.\s]+$/g, "")
    .trim();
}

function extractLineLocalUnitLabelFromSourceV17_90L371AQ(
  sourceTextValue: unknown,
  quantityValue: number,
): string | null {
  const source = String(sourceTextValue || "").replace(/\s+/g, " ").trim();
  if (!source || !Number.isFinite(quantityValue) || quantityValue <= 0) return null;

  const quantityVariants = Array.from(
    new Set([
      String(quantityValue).replace(/\.0+$/, ""),
      String(quantityValue).replace(/\.0+$/, "").replace(".", ","),
      Number.isInteger(quantityValue) ? String(Math.trunc(quantityValue)) : "",
    ].filter(Boolean)),
  );

  for (const quantityText of quantityVariants) {
    const escapedQuantity = quantityText
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("\\.", "[.,]");
    const match = source.match(
      new RegExp(
        `\\b${escapedQuantity}\\s+([\\p{L}][\\p{L}0-9%/²³._-]*(?:\\s+[\\p{L}][\\p{L}0-9%/²³._-]*){0,2})\\s*(?=à|@|\\b(?:je|pro|per|par|por|at|each)\\b|\\b(?:chf|eur|euro|sfr|fr)\\b)`,
        "iu",
      ),
    );
    const label = cleanLineLocalUnitLabelV17_90L371AQ(match?.[1]);
    if (!label || /^\d/.test(label)) continue;
    if (/^(?:chf|eur|euro|sfr|fr|preis|betrag|kosten|à|a)$/iu.test(label)) continue;
    return label;
  }

  return null;
}

function shouldPreferLineLocalUnitV17_90L371AQ(args: {
  positionType: string;
  rawUnit: string;
  sourceUnit: string | null;
}): boolean {
  const sourceUnit = cleanLineLocalUnitLabelV17_90L371AQ(args.sourceUnit);
  if (!sourceUnit) return false;

  const positionType = normalizePositionType(args.positionType);
  const rawUnit = cleanLineLocalUnitLabelV17_90L371AQ(args.rawUnit);
  const rawKey = normalizeUnitText(rawUnit);
  const sourceKey = normalizeUnitText(sourceUnit);
  if (!sourceKey) return false;

  // SMARTFLOW_V17_90L371AR:
  // "Laufmeter" is an explicit business unit. getServiceUnitType() internally
  // groups it as "meter", but the persisted unit must keep the exact line-local
  // wording instead of collapsing to "Meter" / UI "m".
  if (positionType === "material") {
    const rawUnitType = getServiceUnitType(rawUnit);
    const normalizedDisplayKey = normalizeUnitText(
      rawUnitType !== "unknown" ? unitTypeToDisplayUnit(rawUnitType) : rawUnit,
    );
    return sourceKey !== normalizedDisplayKey || rawKey !== normalizedDisplayKey;
  }

  if (rawKey === sourceKey) return false;

  // For non-material rows only replace clearly broken labels that still contain
  // a price joiner. Normal service/equipment units such as Stunde stay as they are.
  return /(?:^|\s)(?:à|@|je|pro|per|par|por|at|each)(?:\s|$)/iu.test(rawUnit);
}

const normalizedLineKeyV17_90L371AP = (value: unknown): string =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function isSameLineLocalFactV17_90L371AP(left: unknown, right: unknown): boolean {
  const leftKey = normalizedLineKeyV17_90L371AP(left);
  const rightKey = normalizedLineKeyV17_90L371AP(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey ||
    (leftKey.length >= 8 && rightKey.includes(leftKey)) ||
    (rightKey.length >= 8 && leftKey.includes(rightKey));
}


function normalizedBillableCostFactKeyV17_90L371AR(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\b(?:chf|eur|euro|sfr|fr)\.?\s*[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\b/giu, " ")
    .replace(/\b[0-9][0-9'’]*(?:[.,][0-9]{1,2})?\s*(?:chf|eur|euro|sfr|fr)\.?\b/giu, " ")
    .replace(/\b(?:pauschal|pauschale|preis|betrag|kosten|gebuehr|gebuehren|gebühr|gebühren)\b/giu, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSameBillableCostFactV17_90L371AR(left: unknown, right: unknown): boolean {
  const leftKey = normalizedBillableCostFactKeyV17_90L371AR(left);
  const rightKey = normalizedBillableCostFactKeyV17_90L371AR(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.length >= 6 && rightKey.includes(leftKey)) return true;
  if (rightKey.length >= 6 && leftKey.includes(rightKey)) return true;

  const leftTokens = new Set(leftKey.split(/\s+/g).filter((token) => token.length >= 4));
  const rightTokens = rightKey.split(/\s+/g).filter((token) => token.length >= 4);
  if (leftTokens.size === 0 || rightTokens.length === 0) return false;
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap >= 2 && overlap / Math.min(leftTokens.size, rightTokens.length) >= 0.67;
}

function isLineLocalFlatCostCandidateV17_90L371AM(args: {
  positionType: string;
  sourceText: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}): boolean {
  if (normalizePositionType(args.positionType) !== "expense") return false;
  if (!Number.isFinite(args.unitPrice) || args.unitPrice <= 0) return false;
  const unitType = getServiceUnitType(args.unit || null);
  if (unitType === "flat") return true;

  const source = normalizeUnitText(args.sourceText || "");
  if (!source) return false;

  const hasExplicitPerUnitSignal = /(?:\b(?:pro|je|per|each|par|por)\b|\sà\s|@)/i.test(source);
  if (hasExplicitPerUnitSignal) return false;

  const hasExplicitQuantityUnit = detectAllQuantityUnitsFromText(args.sourceText || "").length > 0;
  return (!args.unit || isReviewUnitV17_90L(args.unit) || args.quantity <= 0) && !hasExplicitQuantityUnit;
}

function buildCanonicalAiOrderItemsV17_90L88(
  rawItems: any[],
  _translatedText?: string | null,
  _contextText?: string | null,
): CanonicalAiOrderItemV17_90L88[] {
  if (!Array.isArray(rawItems)) return [];

  // V17.90L252: Hard first-AI-only writer boundary. Every persisted row is a
  // direct normalization of exactly one structured first-AI workItem. No
  // merge, rescue, source-text inference or cross-row repair may add, remove,
  // rename or fill a business value here. Derived totals and review flags are
  // allowed because they do not replace an AI-selected field.
  return rawItems.map((raw, canonicalOrder) => {
    const sourceText = String(
      raw?.sourceText ??
        raw?.source_text ??
        raw?.evidence ??
        raw?.raw ??
        raw?.description ??
        "",
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const rawServiceName = String(
      raw?.serviceName ??
        raw?.name ??
        raw?.action_name ??
        raw?.service_name ??
        raw?.matched_service_name ??
        "",
    )
      .replace(/\s+/g, " ")
      .trim();
    let serviceName = rawServiceName || "Leistung prüfen";
    const positionTypeGuardV17_90L371AM =
      classifyPositionTypeBeforeCanonicalLockV17_90L371AM({
        raw,
        serviceName,
        sourceText,
      });
    const positionType = normalizePositionType(
      positionTypeGuardV17_90L371AM.positionType,
    );
    serviceName = cleanLineLocalCostPositionNameV17_90L371AP({
      positionType,
      sourceText,
      serviceName,
    });

    let quantity = parsePositiveCanonicalNumberV17_90L89(
      raw?.quantity ?? raw?.menge,
    );
    const unitPrice = parsePositiveCanonicalNumberV17_90L89(
      raw?.unitPrice ?? raw?.unit_price ?? raw?.price,
    );
    const rawUnit = cleanLineLocalUnitLabelV17_90L371AQ(
      String(raw?.unit ?? raw?.einheit ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const rawUnitType = getServiceUnitType(rawUnit);
    let unit = rawUnitType !== "unknown"
      ? unitTypeToDisplayUnit(rawUnitType)
      : rawUnit || "Einheit prüfen";
    let unitSource: CanonicalUnitSourceV17_90L89 = rawUnit
      ? "ai"
      : "missing";

    const lineLocalUnitV17_90L371AQ = extractLineLocalUnitLabelFromSourceV17_90L371AQ(
      sourceText,
      quantity,
    );
    if (
      shouldPreferLineLocalUnitV17_90L371AQ({
        positionType,
        rawUnit,
        sourceUnit: lineLocalUnitV17_90L371AQ,
      })
    ) {
      unit = cleanLineLocalUnitLabelV17_90L371AQ(lineLocalUnitV17_90L371AQ) || unit;
      unitSource = "ai";
    }

    serviceName = cleanBillablePositionNameBeforeCanonicalLockV17_90L371AR({
      serviceName,
      sourceText,
      quantity,
      unitPrice,
    });

    const explicitCurrency = String(raw?.currency || "")
      .trim()
      .toUpperCase();
    const detectedCurrency = explicitCurrency || null;

    const confidenceKey = normalizeUnitText(
      raw?.confidence ?? raw?.service_confidence ?? "",
    );
    const confidence =
      confidenceKey.includes("niedrig") || confidenceKey.includes("low")
        ? "niedrig"
        : confidenceKey.includes("mittel") || confidenceKey.includes("medium")
          ? "mittel"
          : "hoch";

    if (
      confidence !== "niedrig" &&
      isLineLocalFlatCostCandidateV17_90L371AM({
        positionType,
        sourceText,
        unit,
        quantity,
        unitPrice,
      })
    ) {
      quantity = 1;
      unit = "Pauschal";
      unitSource = rawUnit ? unitSource : "structural_flat";
    }

    const missingServiceName = !rawServiceName;
    const missingEvidence = !sourceText;
    const missingPrice = unitPrice <= 0;
    const missingQuantity = quantity <= 0;
    const missingUnit = !unit || isReviewUnitV17_90L(unit);
    const explicitNeedsReview = Boolean(
      raw?.needsReview ?? raw?.needs_review ?? false,
    );
    const positionTypeNeedsReview =
      positionTypeGuardV17_90L371AM.confidence === "review";
    const explicitReviewReason = String(
      raw?.reviewReason ?? raw?.review_reason ?? "",
    )
      .replace(/\s+/g, " ")
      .trim();

    const needsReview = Boolean(
      explicitNeedsReview ||
        positionTypeNeedsReview ||
        missingServiceName ||
        missingEvidence ||
        missingPrice ||
        missingQuantity ||
        missingUnit,
    );
    const reviewReason =
      explicitReviewReason ||
      (positionTypeNeedsReview
        ? `position_type_review:${serviceName}`
        : missingServiceName
        ? "service_name_missing"
        : missingEvidence
          ? `source_evidence_missing:${serviceName}`
          : missingPrice
            ? `price_unclear:${serviceName}`
            : missingQuantity
              ? `quantity_review:${serviceName}`
              : missingUnit
                ? `unit_missing_in_text:${serviceName}`
                : explicitNeedsReview
                  ? `ai_review_required:${serviceName}`
                  : null);

    return {
      serviceName,
      positionType,
      description: sourceText || serviceName,
      quantity,
      unit,
      unitPrice,
      totalPrice:
        !needsReview && quantity > 0 && unitPrice > 0
          ? roundIntakeMoney(quantity * unitPrice)
          : 0,
      needsReview,
      reviewReason,
      sourceText: sourceText || null,
      evidence: sourceText || null,
      detectedCurrency,
      canonicalOrder,
      confidence,
      unitSource,
    } as CanonicalAiOrderItemV17_90L88;
  });
}

function buildEvidenceBoundRescueCanonicalItemsV17_90L217(
  items: Array<{
    serviceName?: string | null;
    quantity?: number | null;
    unit?: string | null;
    unitPrice?: number | null;
    detectedCurrency?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
    description?: string | null;
    needsReview?: boolean | null;
  }>,
  originalText: string,
  translatedText?: string | null,
): CanonicalAiOrderItemV17_90L88[] {
  const sourceCorpus = normalizeSemanticText(
    [originalText, translatedText].filter(Boolean).join("\n"),
  );
  if (!sourceCorpus) return [];

  const rescueRows = items
    .filter((item) => item?.needsReview === false)
    .filter((item) => {
      const evidence = String(
        item.sourceText || item.evidence || item.description || "",
      )
        .replace(/\s+/g, " ")
        .trim();
      const evidenceKey = normalizeSemanticText(evidence);
      if (!evidence || !evidenceKey || !sourceCorpus.includes(evidenceKey)) {
        return false;
      }

      const serviceName = String(item.serviceName || "").trim();
      const serviceTokens = normalizeSemanticText(serviceName)
        .split(/\s+/g)
        .filter((token) => token.length >= 4);
      if (
        !serviceName ||
        serviceTokens.length === 0 ||
        !serviceTokens.some((token) => evidenceKey.includes(token))
      ) {
        return false;
      }

      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const unitType = getServiceUnitType(item.unit || null);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;
      if (/\b(?:preis\s+(?:offen|unklar|folgt)|ohne\s+preis)\b/i.test(evidence)) {
        return false;
      }
      if (
        quantity > 1 &&
        /\b(?:gesamt|total)\b/i.test(evidence) &&
        !/(?:\b(?:pro|per|je)\b|[à@])/i.test(evidence)
      ) {
        return false;
      }
      if (
        unitType !== "flat" &&
        (!Number.isFinite(quantity) || quantity <= 0)
      ) {
        return false;
      }

      const numericValues = Array.from(
        evidence.matchAll(/\b\d+(?:[.,]\d+)?\b/g),
        (match) => Number(String(match[0]).replace(",", ".")),
      ).filter((value) => Number.isFinite(value));
      const priceSupported = numericValues.some(
        (value) => Math.abs(value - unitPrice) < 0.0001,
      );
      const quantitySupported =
        unitType === "flat" ||
        numericValues.some((value) => Math.abs(value - quantity) < 0.0001);
      return priceSupported && quantitySupported;
    })
    .map((item) => ({
      serviceName: item.serviceName,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      currency: item.detectedCurrency || detectCurrencyFromText(item.sourceText || ""),
      sourceText: item.sourceText || item.evidence || item.description,
      confidence: "hoch",
    }));

  if (rescueRows.length === 0) return [];
  return buildCanonicalAiOrderItemsV17_90L88(
    rescueRows,
    translatedText,
    originalText,
  );
}

function canonicalItemMatchScoreV17_90L88(
  canonical: CanonicalAiOrderItemV17_90L88,
  candidate: StructuredOrderItemSnapshotV17_90L76,
  fallbackCurrency: string,
): number {
  const canonicalEvidence = canonicalEvidenceKeyV17_90L88(
    canonical.sourceText || canonical.evidence,
  );
  const candidateEvidence = canonicalEvidenceKeyV17_90L88(
    candidate.sourceText || candidate.evidence || candidate.description,
  );
  let score = 0;
  if (canonicalEvidence && candidateEvidence) {
    if (canonicalEvidence === candidateEvidence) score += 100;
    else if (
      canonicalEvidence.length >= 12 &&
      candidateEvidence.length >= 12 &&
      (canonicalEvidence.includes(candidateEvidence) ||
        candidateEvidence.includes(canonicalEvidence))
    ) {
      score += 55;
    }
  }

  const cq = Number(canonical.quantity || 0);
  const cp = Number(canonical.unitPrice || 0);
  const q = Number(candidate.quantity || 0);
  const p = Number(candidate.unitPrice || 0);
  if (cq > 0 && q > 0 && Math.abs(cq - q) < 0.0001) score += 16;
  if (cp > 0 && p > 0 && Math.abs(cp - p) < 0.0001) score += 18;

  const canonicalCurrency = String(
    canonical.detectedCurrency || fallbackCurrency || "",
  ).toUpperCase();
  const candidateCurrency = String(
    candidate.detectedCurrency || fallbackCurrency || "",
  ).toUpperCase();
  if (canonicalCurrency && candidateCurrency === canonicalCurrency) score += 6;

  const canonicalName = canonicalServiceKeyV17_90L88(canonical.serviceName);
  const candidateName = canonicalServiceKeyV17_90L88(candidate.serviceName);
  if (canonicalName && candidateName) {
    if (canonicalName === candidateName) score += 30;
    else {
      const left = new Set(canonicalName.split(/\s+/g).filter((v) => v.length >= 4));
      const right = new Set(candidateName.split(/\s+/g).filter((v) => v.length >= 4));
      const overlap = [...left].filter((token) => right.has(token)).length;
      if (overlap >= 1) score += overlap * 8;
    }
  }
  return score;
}


function findOwnSourceLineForServiceV17_90L88(
  serviceName: string,
  originalText: string,
): string | null {
  const stop = new Set([
    "reinigen", "pruefen", "prüfen", "kontrollieren", "warten", "einsetzen",
    "nach", "aufwand", "pauschal", "bitte", "separat", "leistung",
  ]);
  const tokens = canonicalServiceKeyV17_90L88(serviceName)
    .split(/\s+/g)
    .filter((token) => token.length >= 4 && !stop.has(token));
  if (!tokens.length) return null;

  const lines = splitSourceEvidenceLinesV17_90L3(originalText)
    .map((line) => compactText(line))
    .filter(Boolean);
  let best: string | null = null;
  let bestScore = 0;
  for (const line of lines) {
    const key = canonicalServiceKeyV17_90L88(line);
    const score = tokens.filter((token) => key.includes(token)).length;
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function reconcileWithCanonicalAiItemsV17_90L88(
  canonicalItems: CanonicalAiOrderItemV17_90L88[],
  currentItems: StructuredOrderItemSnapshotV17_90L76[],
  finalCurrency: string,
  originalText: string,
): StructuredOrderItemSnapshotV17_90L76[] {
  if (!canonicalItems.length) return [];

  const remaining = [...currentItems];
  const result: StructuredOrderItemSnapshotV17_90L76[] = [];

  for (const canonical of [...canonicalItems].sort(
    (a, b) => a.canonicalOrder - b.canonicalOrder,
  )) {
    // The legacy list is consulted only to consume duplicates. Its values and
    // review flags are never copied into the canonical row.
    let selectedIndex = -1;
    let selectedScore = -1;
    remaining.forEach((candidate, index) => {
      const score = canonicalItemMatchScoreV17_90L88(
        canonical,
        candidate,
        finalCurrency,
      );
      if (score > selectedScore) {
        selectedScore = score;
        selectedIndex = index;
      }
    });
    if (selectedScore >= 36 && selectedIndex >= 0) {
      remaining.splice(selectedIndex, 1);
    }

    const canonicalCurrency = String(
      canonical.detectedCurrency || finalCurrency || "",
    ).toUpperCase();
    const isForeignCurrency = Boolean(
      canonicalCurrency &&
        finalCurrency &&
        canonicalCurrency !== String(finalCurrency).toUpperCase(),
    );
    const quantity = Number(canonical.quantity || 0);
    const unit = canonical.unit || "Einheit prüfen";
    const unitPrice = Number(canonical.unitPrice || 0);
    const missingPrice = unitPrice <= 0;
    const missingQuantity = quantity <= 0;
    const missingUnit = !unit || isReviewUnitV17_90L(unit);
    const canonicalReviewReason = String(canonical.reviewReason || "").trim();
    const reviewReason = isForeignCurrency
      ? `item_currency_mismatch:${canonical.serviceName}:${canonicalCurrency}:${finalCurrency}`
      : canonicalReviewReason ||
        (missingPrice
          ? `price_unclear:${canonical.serviceName}`
          : missingQuantity
            ? `quantity_review:${canonical.serviceName}`
            : missingUnit
              ? `unit_missing_in_text:${canonical.serviceName}`
              : null);
    const needsReview = Boolean(
      canonical.needsReview ||
        canonicalReviewReason ||
        isForeignCurrency ||
        missingPrice ||
        missingQuantity ||
        missingUnit,
    );

    result.push({
      serviceName: canonical.serviceName,
      positionType: normalizePositionType(canonical.positionType),
      description: canonical.sourceText || canonical.description,
      quantity,
      unit,
      // V17.90L225: Keep the original foreign-currency amount visible. Only
      // the calculable line total is blocked until the target currency/price is
      // confirmed by the user.
      unitPrice,
      totalPrice:
        !needsReview && !isForeignCurrency
          ? roundIntakeMoney(quantity * unitPrice)
          : 0,
      needsReview,
      reviewReason,
      sourceText: canonical.sourceText,
      evidence: canonical.evidence || canonical.sourceText,
      detectedCurrency: canonicalCurrency || null,
    });

    const canonicalEvidence = canonicalEvidenceKeyV17_90L88(
      canonical.sourceText || canonical.evidence,
    );
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidateEvidence = canonicalEvidenceKeyV17_90L88(
        remaining[index].sourceText ||
          remaining[index].evidence ||
          remaining[index].description,
      );
      if (
        canonicalEvidence &&
        candidateEvidence &&
        (canonicalEvidence === candidateEvidence ||
          (canonicalEvidence.length >= 16 &&
            (canonicalEvidence.includes(candidateEvidence) ||
              candidateEvidence.includes(canonicalEvidence))))
      ) {
        remaining.splice(index, 1);
      }
    }
  }

  // V17.90L225: The canonical first-AI rows are the complete persisted item
  // set. Later parser/validator rows are diagnostics or proposals only and may
  // never be appended, removed, merged or reordered here.
  return result;

}

function canonicalItemsStableAfterValidationV17_90L89(
  canonicalItems: CanonicalAiOrderItemV17_90L88[],
  finalItems: StructuredOrderItemSnapshotV17_90L76[],
  finalCurrency: string,
): boolean {
  if (canonicalItems.length === 0) return finalItems.length === 0;
  if (canonicalItems.length !== finalItems.length) return false;

  const orderedCanonical = [...canonicalItems].sort(
    (left, right) => left.canonicalOrder - right.canonicalOrder,
  );

  return orderedCanonical.every((canonical, index) => {
    const item = finalItems[index];
    if (!item) return false;

    const expectedCurrency = String(
      canonical.detectedCurrency || finalCurrency || "",
    )
      .trim()
      .toUpperCase();
    const actualCurrency = String(
      item.detectedCurrency || finalCurrency || "",
    )
      .trim()
      .toUpperCase();
    const expectedEvidence = String(
      canonical.sourceText || canonical.evidence || canonical.description || "",
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    const actualEvidence = String(
      item.sourceText || item.evidence || item.description || "",
    )
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();

    const sameName =
      String(item.serviceName || "").trim() ===
      String(canonical.serviceName || "").trim();
    const samePositionType =
      normalizePositionType(item.positionType) ===
      normalizePositionType(canonical.positionType);
    const sameQuantity =
      Math.abs(Number(item.quantity || 0) - Number(canonical.quantity || 0)) <
      0.0001;
    const samePrice =
      Math.abs(Number(item.unitPrice || 0) - Number(canonical.unitPrice || 0)) <
      0.0001;
    const sameUnit =
      String(item.unit || "").trim() === String(canonical.unit || "").trim();
    const sameCurrency = actualCurrency === expectedCurrency;
    const sameEvidence = actualEvidence === expectedEvidence;

    return (
      sameName &&
      samePositionType &&
      sameQuantity &&
      samePrice &&
      sameUnit &&
      sameCurrency &&
      sameEvidence
    );
  });
}

function recognitionWarningCoveredByCanonicalV17_90L89(
  warning: string,
  finalItems: StructuredOrderItemSnapshotV17_90L76[],
): boolean {
  if (!warning.startsWith("recognition_review:")) return false;
  try {
    const raw = decodeURIComponent(warning.slice("recognition_review:".length));
    const payload = JSON.parse(raw) as {
      serviceName?: string;
      quantity?: number;
      unitPrice?: number;
      sourceText?: string;
    };
    const serviceKey = canonicalServiceKeyV17_90L88(payload.serviceName);
    const evidenceKey = canonicalEvidenceKeyV17_90L88(payload.sourceText);
    return finalItems.some((item) => {
      const itemServiceKey = canonicalServiceKeyV17_90L88(item.serviceName);
      const itemEvidenceKey = canonicalEvidenceKeyV17_90L88(
        item.sourceText || item.evidence || item.description,
      );
      const sameService =
        serviceKey &&
        itemServiceKey &&
        (serviceKey === itemServiceKey ||
          serviceKey.includes(itemServiceKey) ||
          itemServiceKey.includes(serviceKey));
      const sameEvidence =
        !evidenceKey ||
        !itemEvidenceKey ||
        evidenceKey === itemEvidenceKey ||
        evidenceKey.includes(itemEvidenceKey) ||
        itemEvidenceKey.includes(evidenceKey);
      const sameQuantity =
        Number(payload.quantity || 0) <= 0 ||
        Math.abs(
          Number(item.quantity || 0) - Number(payload.quantity || 0),
        ) < 0.0001;
      const samePrice =
        Number(payload.unitPrice || 0) <= 0 ||
        Math.abs(
          Number(item.unitPrice || 0) - Number(payload.unitPrice || 0),
        ) < 0.0001;
      return Boolean(
        sameService &&
          sameEvidence &&
          sameQuantity &&
          samePrice &&
          !isReviewUnitV17_90L(item.unit) &&
          Number(item.totalPrice || 0) > 0,
      );
    });
  } catch {
    return false;
  }
}

// V17.90L175: Review/status text is metadata, never a service.
function isRecognitionReviewStateOnlyNameV17_90L175(
  value?: string | null,
): boolean {
  const key = canonicalServiceKeyV17_90L88(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return true;
  const roleTokens = new Set([
    "preis", "preise", "price", "prices", "prix", "prezzo",
    "menge", "mengen", "quantity", "quantities", "quantite", "quantita",
    "einheit", "einheiten", "unit", "units", "unite", "unita",
    "offen", "unklar", "unbekannt", "pruefen", "prufen", "klaeren",
    "noch", "fehlt", "fehlend", "tbd", "open", "unclear", "unknown",
    "missing", "check", "verify", "pending", "ouvert", "incertain",
    "aperto", "verificare", "definire",
  ]);
  const tokens = key.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => roleTokens.has(token));
}

// V17.90L120: A later read-only validator must never create a second
// recognition proposal from the same evidence line when the canonical first-AI
// item already exists as an editable open-price position. The existing item is
// the only place where the missing price may be resolved.
function recognitionWarningCoveredByCanonicalOpenPriceV17_90L120(
  warning: string,
  canonicalItems: CanonicalAiOrderItemV17_90L88[],
): boolean {
  if (!warning.startsWith("recognition_review:")) return false;

  try {
    const raw = decodeURIComponent(warning.slice("recognition_review:".length));
    const payload = JSON.parse(raw) as {
      serviceName?: string;
      sourceText?: string;
      unitPrice?: number;
      quantity?: number;
      unit?: string;
    };
    const evidenceKey = canonicalEvidenceKeyV17_90L88(payload.sourceText);
    if (Number(payload.unitPrice || 0) > 0) return false;
    const statusOnlyName = isRecognitionReviewStateOnlyNameV17_90L175(
      payload.serviceName,
    );
    const payloadQuantity = Number(payload.quantity || 0);
    const payloadUnit = getServiceUnitType(payload.unit || "");

    return canonicalItems.some((canonical) => {
      const canonicalEvidenceKey = canonicalEvidenceKeyV17_90L88(
        canonical.sourceText || canonical.evidence || canonical.description,
      );
      const sameEvidence = Boolean(
        evidenceKey &&
          canonicalEvidenceKey &&
          (canonicalEvidenceKey === evidenceKey ||
            (canonicalEvidenceKey.length >= 8 &&
              evidenceKey.length >= 8 &&
              (canonicalEvidenceKey.includes(evidenceKey) ||
                evidenceKey.includes(canonicalEvidenceKey)))),
      );
      const sameQuantity =
        payloadQuantity <= 0 ||
        Number(canonical.quantity || 0) <= 0 ||
        Math.abs(Number(canonical.quantity || 0) - payloadQuantity) < 0.0001;
      const canonicalUnit = getServiceUnitType(canonical.unit || "");
      const sameUnit =
        !payloadUnit || !canonicalUnit || payloadUnit === canonicalUnit;
      const canonicalPriceOpen = Boolean(
        Number(canonical.unitPrice || 0) <= 0 &&
          String(canonical.reviewReason || "").startsWith("price_unclear:") &&
          canonical.serviceName &&
          !isInternalReviewServiceNameV17_90L(canonical.serviceName),
      );

      return Boolean(
        canonicalPriceOpen &&
          sameQuantity &&
          sameUnit &&
          (sameEvidence || statusOnlyName),
      );
    });
  } catch {
    return false;
  }
}

function filterReadOnlyRiskWarningsV17_90L89(
  warnings: string[],
  canonicalItems: CanonicalAiOrderItemV17_90L88[],
  finalItems: StructuredOrderItemSnapshotV17_90L76[],
  finalCurrency: string,
): string[] {
  const stable = canonicalItemsStableAfterValidationV17_90L89(
    canonicalItems,
    finalItems,
    finalCurrency,
  );
  const remainingRecognitionWarnings = warnings.filter(
    (warning) =>
      warning.startsWith("recognition_review:") &&
      !recognitionWarningCoveredByCanonicalV17_90L89(warning, finalItems) &&
      !recognitionWarningCoveredByCanonicalOpenPriceV17_90L120(
        warning,
        canonicalItems,
      ),
  );

  return warnings.filter((warning) => {
    // L98: shadow findings are log-only diagnostics and never become review
    // reasons, chips or document blockers.
    if (warning.startsWith("shadow_")) return false;
    if (warning.startsWith("recognition_review:")) {
      try {
        const payload = JSON.parse(
          decodeURIComponent(warning.slice("recognition_review:".length)),
        ) as { serviceName?: string };
        if (isRecognitionReviewStateOnlyNameV17_90L175(payload.serviceName)) {
          return false;
        }
      } catch {
        // Keep malformed warnings fail-closed; only valid status fragments are dropped.
      }
    }
    if (
      recognitionWarningCoveredByCanonicalOpenPriceV17_90L120(
        warning,
        canonicalItems,
      )
    ) {
      return false;
    }
    if (recognitionWarningCoveredByCanonicalV17_90L89(warning, finalItems)) {
      return false;
    }
    if (
      stable &&
      (warning === "item_evidence_not_line_local" ||
        warning === "priced_service_line_missing_or_mismatched")
    ) {
      return false;
    }
    if (
      stable &&
      warning === "recognition_review" &&
      remainingRecognitionWarnings.length === 0
    ) {
      return false;
    }
    return true;
  });
}

function filterLegacyValidationReviewReasonsV17_90L89(
  reasons: string[],
  finalItems: StructuredOrderItemSnapshotV17_90L76[],
  finalCurrency: string,
): string[] {
  const hasForeignCurrencyItem = finalItems.some((item) => {
    const detected = String(item.detectedCurrency || "").toUpperCase();
    return Boolean(
      detected &&
        finalCurrency &&
        detected !== String(finalCurrency).toUpperCase(),
    );
  });
  const hasOpenPrice = finalItems.some(
    (item) => Number(item.unitPrice || 0) <= 0,
  );
  const hasOpenQuantity = finalItems.some(
    (item) =>
      !isReviewUnitV17_90L(item.unit) &&
      getServiceUnitType(item.unit) !== "flat" &&
      Number(item.quantity || 0) <= 0,
  );

  const finalItemReasons = new Set(
    finalItems
      .map((item) => String(item.reviewReason || ""))
      .filter(Boolean),
  );

  return Array.from(new Set(reasons)).filter((reason) => {
    if (
      reason === "currency_review" ||
      reason === "currency_conflict" ||
      reason === "currency_unsupported"
    ) {
      return hasForeignCurrencyItem;
    }
    if (
      reason.startsWith("item_currency_mismatch:") ||
      reason.startsWith("currency_conflict_item:")
    ) {
      return hasForeignCurrencyItem && finalItemReasons.has(reason);
    }
    if (reason.startsWith("price_unclear:")) {
      return hasOpenPrice && finalItemReasons.has(reason);
    }
    if (
      reason.startsWith("quantity_range_review:") ||
      reason.startsWith("quantity_review:") ||
      reason.startsWith("unit_missing_in_text:")
    ) {
      return finalItemReasons.has(reason);
    }
    if (reason === "unit_price_review") return hasOpenPrice;
    if (reason === "quantity_review") return hasOpenQuantity;

    // All repair/canonicalization messages are internal diagnostics. They may
    // no longer create visible review chips after the canonical lock.
    return false;
  });
}

function preserveCanonicalStructuredRolesV17_90L88(args: {
  specialNotes: string | null;
  onsiteContact: OnsiteContactHint;
  appointmentHints: string[];
  structuredRoleHints: string[];
}): string | null {
  const parsed = splitSpecialNotes(args.specialNotes || "");
  const canonicalContactParts = [
    args.onsiteContact.contactName
      ? `Kontakt vor Ort: ${args.onsiteContact.contactName}`
      : args.onsiteContact.phone || args.onsiteContact.preferredChannel
        ? "Kontakt vor Ort"
        : "",
    args.onsiteContact.phone ? `Tel. ${args.onsiteContact.phone}` : "",
    args.onsiteContact.preferredChannel === "sms"
      ? "nur SMS"
      : args.onsiteContact.preferredChannel === "whatsapp"
        ? "nur WhatsApp"
        : args.onsiteContact.preferredChannel === "call"
          ? "anrufen"
          : "",
    args.onsiteContact.noPhoneCall &&
    args.onsiteContact.preferredChannel !== "call"
      ? "nicht telefonisch"
      : "",
  ].filter(Boolean);
  const canonicalContactHint = canonicalContactParts.join(", ");
  const protectedHints = dedupeSpecialNoteLines([
    canonicalContactHint || args.onsiteContact.hint || "",
    ...args.appointmentHints,
    ...args.structuredRoleHints,
  ]).filter((hint) => hint && hint !== "[object Object]");

  const safetyWarnings = parsed.safetyWarnings.filter(
    (line) =>
      !protectedHints.some((hint) => semanticRoleOverlapV17_90L87(line, hint)) &&
      !lineMatchesOnsiteContactIdentityV17_90L87(line, args.onsiteContact),
  );
  const ordinaryHints = parsed.jobHints.filter(
    (line) =>
      !protectedHints.some((hint) => semanticRoleOverlapV17_90L87(line, hint)) &&
      !lineMatchesOnsiteContactIdentityV17_90L87(line, args.onsiteContact),
  );

  const rebuiltBase = buildSpecialNotes({
    safetyWarnings,
    jobHints: ordinaryHints,
    preserveStructuredRoles: true,
  });
  const baseLines = String(rebuiltBase || "")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (!canonicalContactHint) return true;
      const cleaned = line.replace(/^\s*\[(?:HINWEIS|INFO|NOTIZ)\]\s*/i, "").trim();
      const role = classifySpecialNoteRoleV17_90L93(cleaned);
      if (role !== "communication") return true;
      return (
        semanticRoleOverlapV17_90L87(cleaned, canonicalContactHint) ||
        lineMatchesOnsiteContactIdentityV17_90L87(cleaned, args.onsiteContact)
      );
    });
  const protectedLines = protectedHints.map((hint) => `[HINWEIS] ${hint}`);
  return (
    // Canonical first-AI roles come first. This makes the verified on-site
    // contact the deterministic source for list chips and the info summary;
    // later appointment/channel fragments cannot outrank it.
    dedupeSpecialNoteLines([...protectedLines, ...baseLines])
      .filter((line) => !/\[object Object\]/i.test(line))
      .join("\n") || null
  );
}

function cleanVisibleReviewInstructionSuffixV17_90L76<
  T extends StructuredOrderItemSnapshotV17_90L76,
>(items: T[]): T[] {
  return items.map((item) => {
    const originalName = compactText(item.serviceName);
    if (isInternalReviewServiceNameV17_90L(originalName)) return item;
    const cleanedName = originalName
      .replace(
        /\s*[,;:\-–—]?\s*(?:bitte\s+)?(?:separat\s+)?(?:prüfen|pruefen|kontrollieren)\s*$/iu,
        "",
      )
      .replace(/[\s,;:\-–—]+$/g, "")
      .trim();
    if (!cleanedName || cleanedName === originalName) return item;

    const reason = String(item.reviewReason || "");
    const reviewReason = reason.includes(originalName)
      ? reason.replace(originalName, cleanedName)
      : item.reviewReason;
    return { ...item, serviceName: cleanedName, reviewReason } as T;
  });
}


// V17.90L77: A generated internal review row must not survive when the exact
// same source line, quantity and unit price are already represented by a real
// service row. This removes only proven duplicates and leaves genuinely
// unresolved review rows untouched.
function removeGeneratedReviewDuplicatesByEvidenceV17_90L77<
  T extends StructuredOrderItemSnapshotV17_90L76,
>(items: T[]): T[] {
  const normalizedEvidence = (item: T) =>
    normalizeServiceLineForMatchV17_90L(
      compactText(item.sourceText || item.evidence || item.description || ""),
    );

  const concreteItems = items.filter(
    (item) =>
      !isInternalReviewServiceNameV17_90L(item.serviceName || "") &&
      Number(item.quantity || 0) > 0 &&
      Number(item.unitPrice || 0) > 0,
  );

  return items.filter((item) => {
    if (!isInternalReviewServiceNameV17_90L(item.serviceName || "")) {
      return true;
    }

    const evidence = normalizedEvidence(item);
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    if (!evidence || quantity <= 0 || unitPrice <= 0) return true;

    const duplicatesConcreteItem = concreteItems.some((candidate) => {
      const candidateEvidence = normalizedEvidence(candidate);
      if (!candidateEvidence) return false;

      const sameNumbers =
        Math.abs(Number(candidate.quantity || 0) - quantity) < 0.0001 &&
        Math.abs(Number(candidate.unitPrice || 0) - unitPrice) < 0.0001;
      if (!sameNumbers) return false;

      return (
        candidateEvidence === evidence ||
        (candidateEvidence.length >= 18 && evidence.includes(candidateEvidence)) ||
        (evidence.length >= 18 && candidateEvidence.includes(evidence))
      );
    });

    return !duplicatesConcreteItem;
  });
}

// V17.90L: German-visible service name safety net.
// The AI/validator must write visible service names in German. If the intake
// has a visible automatic German translation block, we use that block as
// line-local evidence and replace raw-language service labels only when the
// translated line carries the same quantity and unit price. This is deliberately
// not a fixed service mapping: the translated customer line is the source of
// truth and prevents cross-line leakage.
function splitAutomaticGermanTranslationBlockV17_90L(
  value: string | null | undefined,
): string {
  const parts = String(value || "").split(
    /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
  );
  return parts.length > 1 ? parts.slice(1).join("\n") : "";
}

function normalizeServiceLineForMatchV17_90L(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decimalMatchPatternV17_90L(value: number): string {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) return "";
  if (Number.isInteger(rounded)) return String(rounded);
  const [intPart, decPart = ""] = String(rounded).split(".");
  return `${intPart}[.,]${decPart.replace(/0+$/g, "") || "0"}`;
}

function translatedLineMatchesItemNumbersV17_90L(
  line: string,
  item: { quantity?: number | null; unitPrice?: number | null },
): boolean {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;

  const quantityPattern = decimalMatchPatternV17_90L(quantity);
  const pricePattern = decimalMatchPatternV17_90L(unitPrice);
  if (!quantityPattern || !pricePattern) return false;

  const normalized = normalizeServiceLineForMatchV17_90L(line);
  return (
    new RegExp(`(^|[^0-9])${quantityPattern}([^0-9]|$)`).test(normalized) &&
    new RegExp(`(^|[^0-9])${pricePattern}([^0-9]|$)`).test(normalized) &&
    /\b(?:chf|eur|euro|franken|stutz)\b/.test(normalized)
  );
}

function cleanGermanServiceLabelGrammarV17_90L(value: string): string {
  return compactText(value)
    .replace(/\bBodens\b/gi, "Boden")
    .replace(/\bGeländers\b/gi, "Geländer")
    .replace(/\bGelaenders\b/gi, "Geländer")
    .replace(
      /^Reinigung\s+des\s+Bodens\s+(im|in\s+der|in\s+dem|am)\s+(.+)$/i,
      "Boden $1 $2 reinigen",
    )
    .replace(/^Reinigung\s+(.+)$/i, "$1 reinigen")
    .replace(/\bFensterreinigung\s+(.+)\s+reinigen\b/gi, "Fenster $1 reinigen")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTranslatedServiceLabelFromLineV17_90L(line: string): string {
  let label = compactText(line);
  if (!label) return "";

  label = label
    .replace(
      /^\s*(?:(?:und|sowie|plus|danach|dann|noch|zusätzlich|zusaetzlich)\s+)+/i,
      "",
    )
    // Visible labels must not start with the count. Quantity lives in its field.
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stücke?|stueck|stück|stk|pcs?|pieces?|pi[eè]ces?|pezzi|stunden?|std\.?)(?=\s|$|[,;:.])\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(
      /\s*(?:zu|à|a|pro|je|per|für|fuer)\s*(?:chf|eur|euro|fr\.?|sfr\.?)\s*\d+(?:[.,]\d{1,2})?.*$/i,
      "",
    )
    .replace(/\s*(?:chf|eur|euro|fr\.?|sfr\.?)\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    // L202: Quantity/unit may stand before the action in a translated line.
    // Remove only explicit measure phrases, not identifiers such as "5. Etage".
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stunden?|std\.?|h|stücke?|stueck|stück|stk|pcs?|pi[eè]ces?|pieces?|pezzi|s[aä]cke|saecke|kg|kilogramm|liter)(?=\s|$|[,;:.])/giu,
      " ",
    )
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleanGermanServiceLabelGrammarV17_90L(label);
}

// V17.90L66: A translated working line may contain several priced services in
// one physical line. Split those numeric segments generically and use the exact
// quantity/unit/price tuple as line-local evidence for a clean German name.
type TranslatedPricedServiceSegmentV17_66 = {
  serviceName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

function extractTranslatedPricedServiceSegmentsV17_66(
  translatedBlock: string,
): TranslatedPricedServiceSegmentV17_66[] {
  const unitPattern =
    String.raw`m²|m2|qm|quadratmeter|quadradmeter|laufmeter|lfm|meter|stunden?|std\.?|h|tage?|arbeitstage?|stücke?|stueck|stuck|stk|anzahl|einheiten?|räume?|raeume|raum|zimmer|rooms?|pieces?|piece|pcs|liter|ltr\.?|l|kilogramm|kg|tonnen?|to`;
  const currencyPattern = String.raw`CHF|Fr\.?|SFr\.?|EUR|Euro|€|USD|\$|GBP|£`;
  const numberPattern = String.raw`\d+(?:[.,]\d+)?`;
  const amountPattern = new RegExp(
    `(${numberPattern})\\s*(${unitPattern})\\s*(?:à|a|je|pro|per|zu|at)\\s*(?:(${currencyPattern})\\s*)?(${numberPattern})(?:\\s*(${currencyPattern}))?`,
    "gi",
  );
  const result: TranslatedPricedServiceSegmentV17_66[] = [];

  String(translatedBlock || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .forEach((rawLine) => {
      const line = compactText(rawLine);
      if (!line) return;
      let previousEnd = 0;
      amountPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = amountPattern.exec(line))) {
        const quantity = parseIntakeDecimalNumber(match[1]);
        const unit = displayUnitFromExplicitLineV17_90L60(match[2]);
        const price = parseIntakeDecimalNumber(match[4]);
        const labelSource = line
          .slice(previousEnd, match.index)
          .replace(/^\s*(?:(?:und|sowie|danach|dann|noch|plus|zusätzlich|zusaetzlich)\s+)+/i, "")
          .replace(/[,:;\-–—]+\s*$/g, "")
          .trim();
        const serviceName = cleanTranslatedServiceLabelFromLineV17_90L(labelSource);
        if (
          typeof quantity === "number" &&
          Number.isFinite(quantity) &&
          quantity > 0 &&
          typeof price === "number" &&
          Number.isFinite(price) &&
          price > 0 &&
          serviceName &&
          isUsableGermanServiceLabelV17_90L(serviceName)
        ) {
          result.push({ serviceName, quantity, unit, unitPrice: price });
        }
        previousEnd = amountPattern.lastIndex;
      }
    });

  return result;
}

function normalizeVisibleServiceNameCasingV17_66(value?: string | null): string {
  const countUnit =
    String.raw`(?:garnituren?|sets?|gruppen?|anlagen?|raeume|räume|zimmer|objekte?|einheiten?|stueck|stück|stk\.?|pcs?|pieces?|pi[eè]ces?|pezzi|meter|laufmeter|lfm|m2|m²|qm|quadratmeter|stunden?|std\.?|tage?|pauschalen?)`;
  const text = compactText(value)
    .replace(
      new RegExp(
        String.raw`\s*[,;:\-–—]?\s*\d+(?:[.,]\d+)?\s*${countUnit}\b(?:\s*(?:à|a|je|po|pro|per|x|mal)\s*(?:(?:CHF|EUR|Fr\.?|Franken|Euro)\s*)?\d+(?:[.,]\d{1,2})?)?.*$`,
        "iu",
      ),
      "",
    )
    .replace(/[\s,;:\-–—]+$/g, "")
    .trim();
  if (!text) return "";
  const index = text.search(/[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]/u);
  if (index < 0) return text;
  return `${text.slice(0, index)}${text.charAt(index).toUpperCase()}${text.slice(index + 1)}`;
}

function isUsableGermanServiceLabelV17_90L(label: string): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(label);
  if (!normalized || label.length < 5 || label.length > 90) return false;
  if (
    /^(?:rechnung|ausfuehrung|ausfuehrungsadresse|arbeitsort|kontakt|bitte|achtung|schluessel|schlussel|hund|leiter)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  // Generic German work-action signal. This validates that the translated
  // line is an actual service label, not an address or note. It is not a
  // service mapping and does not decide the service type.
  return /\b(?:reinigen|reinigung|abstauben|abwischen|streichen|schleifen|schneiden|entsorgen|sortieren|putzen)\b/.test(
    normalized,
  );
}

function isInternalReviewServiceNameV17_90L(value: string): boolean {
  const key = normalizeUnitText(value);
  return (
    !key ||
    key === "leistung pruefen" ||
    key === "leistung prüfen" ||
    key === "pruefen" ||
    key === "prüfen" ||
    key === "betrag pruefen" ||
    key === "betrag prüfen" ||
    key === "einheit pruefen" ||
    key === "einheit prüfen"
  );
}

function isReviewUnitV17_90L(value?: string | null): boolean {
  const key = normalizeUnitText(value || "");
  return (
    key === "pruefen" ||
    key === "prüfen" ||
    key === "einheit pruefen" ||
    key === "einheit prüfen"
  );
}

function hasRawForeignServiceLanguageSignalV17_90L(value: string): boolean {
  const key = normalizeServiceLineForMatchV17_90L(value);
  return /\b(?:limpiar|limpieza|suelo|garaje|ventanas|barandilla|desplazamiento|pulizia|pulire|pavimento|finestre|scaffali|trasferta|nettoyage|nettoyer|vitres|deplacement|déplacement)\b/.test(
    key,
  );
}

function isAlreadyGermanVisibleServiceNameV17_90L(value: string): boolean {
  const key = normalizeServiceLineForMatchV17_90L(value);
  if (hasRawForeignServiceLanguageSignalV17_90L(value)) return false;
  return /\b(?:reinigen|reinigung|abstauben|abwischen|streichen|schleifen|schneiden|entsorgen|sortieren|putzen)\b/.test(
    key,
  );
}

function stripMeasureAndPriceFromVisibleServiceNameV17_90L(
  value: string,
): string {
  let label = compactText(value);
  if (!label) return "";
  label = label
    // V17.90L26: visible labels must not start with the count. Quantity lives
    // in the Menge field, e.g. "18 Tische ..." -> "Tische ...".
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stücke?|stueck|stück|stk|pcs?|pieces?|pi[eè]ces?|pezzi|stunden?|std\.?)\b\s*/i, "")
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß])/u, "")
    .replace(
      /\s*(?:zu|à|a|pro|je|per|für|fuer)\s*(?:chf|eur|euro|fr\.?|sfr\.?)\s*\d+(?:[.,]\d{1,2})?.*$/i,
      "",
    )
    .replace(/\s*(?:chf|eur|euro|fr\.?|sfr\.?)\s*\d+(?:[.,]\d{1,2})?.*$/i, "")
    .replace(
      /\s*,?\s+\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stunden?|std\.?|h|stücke?|stueck|stück|stk|pcs?|pi[eè]ces?|s[aä]cke|saecke|kg|kilogramm|liter)\b.*$/i,
      "",
    )
    .replace(/\s*[,;:\-–—]?\s*(?:ca\.?|circa|ungefähr|ungefaehr|etwa|approx\.?)\s*$/iu, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:.\-–—]+$/g, "")
    .trim();
  return cleanGermanServiceLabelGrammarV17_90L(label);
}

function lineHasDecimalNumberV17_90L3(line: string, value: number): boolean {
  const pattern = decimalMatchPatternV17_90L(value);
  if (!pattern) return false;
  const normalized = normalizeServiceLineForMatchV17_90L(line).replace(
    /m\s*2/g,
    "m2",
  );
  return new RegExp(`(^|[^0-9])${pattern}([^0-9]|$)`).test(normalized);
}

function isRegressionMetaLineV17_90L3(line: string): boolean {
  return /^\s*regression\b/i.test(String(line || ""));
}

function splitSourceEvidenceLinesV17_90L3(
  value: string | null | undefined,
): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isRegressionMetaLineV17_90L3(line))
    .filter((line) => !isTechnicalIntakeMetaLineV17_90L17(line))
    .filter(
      (line) => !/^---\s*Übersetzung\s*\(automatisch\)\s*---$/i.test(line),
    );
}

function detectExplicitUnitFromEvidenceLineV17_90L3(
  line: string,
): string | null {
  const normalized = normalizeServiceLineForMatchV17_90L(line)
    .replace(/m\s*2/g, "m2")
    .replace(/m\s*²/g, "m2");

  if (/\b(?:m2|qm|quadratmeter|quadratmetern|sqm)\b/.test(normalized))
    return "Quadratmeter";
  if (
    /\b(?:stueck|stuck|stück|stk|pcs?|pieces?|piece|pi[eè]ces?|pezzi|piezas)\b/.test(
      normalized,
    )
  )
    return "Stück";
  if (/\b(?:laufmeter|lfm|meter|metres?|metri|metros)\b/.test(normalized))
    return "Meter";
  if (/\b(?:stunden?|std\.?|hours?|heures?|ore|horas?)\b/.test(normalized))
    return "Stunde";
  return null;
}

function matchingUnitEvidenceLineForItemV17_90L3(
  sourceText: string | null | undefined,
  item: { quantity?: any; unitPrice?: any },
): { line: string; unit: string } | null {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  const matches = splitSourceEvidenceLinesV17_90L3(sourceText)
    .map((line) => ({
      line,
      unit: detectExplicitUnitFromEvidenceLineV17_90L3(line),
    }))
    .filter((entry): entry is { line: string; unit: string } =>
      Boolean(entry.unit),
    )
    .filter((entry) => lineHasDecimalNumberV17_90L3(entry.line, quantity))
    .filter((entry) => lineHasDecimalNumberV17_90L3(entry.line, unitPrice))
    .filter((entry) =>
      /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€)\b/i.test(entry.line),
    );

  const uniqueByUnitAndLine = Array.from(
    new Map(
      matches.map((entry) => [
        `${entry.unit}:${normalizeUnitText(entry.line)}`,
        entry,
      ]),
    ).values(),
  );
  const uniqueUnits = Array.from(
    new Set(uniqueByUnitAndLine.map((entry) => entry.unit)),
  );
  if (uniqueUnits.length !== 1) return null;

  return (
    uniqueByUnitAndLine.sort((a, b) => a.line.length - b.line.length)[0] || null
  );
}

function originalCustomerEvidenceLinesV17_90L5(
  value: string | null | undefined,
): string[] {
  const originalOnly =
    String(value || "").split(
      /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
    )[0] || "";
  return splitSourceEvidenceLinesV17_90L3(originalOnly);
}

function hasExplicitWorkActionInEvidenceLineV17_90L5(line: string): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(line);
  return /\b(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean|cleaning|wash|washing|dust|dusting|wipe|wiping|polish|polishing|limpiar|limpieza|pulire|pulizia|nettoyer|nettoyage|abstauben|abwischen|streichen|schleifen|schneiden|entsorgen|sortieren)\b/.test(
    normalized,
  );
}

function hasFloorSurfaceSignalV17_90L5(value: string): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(value);
  return /(?:boden|bodenflaeche|bodenfläche|floor|sol|suelo|pavimento|lagerflaeche|lagerfläche|parkdeck|waschplatz)/.test(
    normalized,
  );
}

function hasExplicitAreaUnitSignalV17_90L17(value: string): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(value)
    .replace(/m\s*2/g, "m2")
    .replace(/m\s*²/g, "m2");
  return /\b(?:m2|qm|quadratmeter|sqm)\b/.test(normalized);
}

function isGenericFloorCleaningServiceNameV17_90L5(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(String(value || ""));
  if (!normalized) return false;
  return (
    hasFloorSurfaceSignalV17_90L5(normalized) &&
    /\b(?:reinigen|reinigung|clean|cleaning)\b/.test(normalized)
  );
}

function matchingOriginalEvidenceLineByNumbersV17_90L5(
  sourceText: string | null | undefined,
  item: { quantity?: any; unitPrice?: any },
): string | null {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  const matches = originalCustomerEvidenceLinesV17_90L5(sourceText)
    .filter((line) => lineHasDecimalNumberV17_90L3(line, quantity))
    .filter((line) => lineHasDecimalNumberV17_90L3(line, unitPrice))
    .filter((line) =>
      /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€)\b/i.test(line),
    );

  const unique = Array.from(
    new Map(matches.map((line) => [normalizeUnitText(line), line])).values(),
  );
  if (unique.length !== 1) return null;
  return unique[0] || null;
}

function blockGenericFloorRowsWithoutExplicitActionV17_90L5<
  T extends {
    serviceName?: string | null;
    quantity?: any;
    unit?: string | null;
    unitPrice?: any;
    totalPrice?: any;
    needsReview?: boolean;
    reviewReason?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  return items.map((item) => {
    if (!isGenericFloorCleaningServiceNameV17_90L5(item.serviceName))
      return item;

    const evidenceLine = matchingOriginalEvidenceLineByNumbersV17_90L5(
      sourceText,
      item,
    );
    if (!evidenceLine) return item;

    const evidenceHasFloor = hasFloorSurfaceSignalV17_90L5(evidenceLine);
    const evidenceHasExplicitAction =
      hasExplicitWorkActionInEvidenceLineV17_90L5(evidenceLine);

    // V17.90L8: If the AI invented a generic floor-cleaning name for a line
    // that does not even mention a floor (e.g. "Dort hinten alles machen"),
    // fail closed as well. No vocabulary-specific fix: the evidence line must
    // support both the object and the action.
    if (evidenceHasFloor && evidenceHasExplicitAction) return item;

    return {
      ...item,
      serviceName: "Leistung prüfen",
      unit: "Einheit prüfen",
      totalPrice: 0,
      needsReview: true,
      reviewReason:
        item.reviewReason ||
        `service_action_unclear:${compactText(item.serviceName) || "Boden"}`,
      description: item.description || evidenceLine,
      sourceText: item.sourceText || evidenceLine,
      evidence: item.evidence || evidenceLine,
    };
  });
}

type AmbiguousNoActionEvidenceLineV17_90L9 = {
  line: string;
  quantity: number;
  price: number;
  unit: string | null;
};

function parseQuantityPriceFromEvidenceLineV17_90L9(
  line: string,
): { quantity: number; price: number; unit: string | null } | null {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const unitWords = String.raw`(?:m2|m²|qm|quadratmeter|meter|laufmeter|lfm|stunden?|std\.?|h|stücke?|stueck|stück|stk|pcs?|pieces?|piece|pi[eè]ces?|pezzi|piezas|s[aä]cke|saecke|säcke)`;
  const currencyWords = String.raw`(?:CHF|Fr\.?|SFr\.?|EUR|Euro|€)`;
  const number = String.raw`(\d+(?:[.,]\d+)?)`;
  const patterns = [
    new RegExp(
      `${number}\\s*(?:${unitWords})?\\s*(?:à|a|at|zu|pro|je|per)\\s*(?:${currencyWords})?\\s*${number}`,
      "i",
    ),
    new RegExp(
      `${number}\\s*(?:${unitWords})?\\s*(?:à|a|at|zu|pro|je|per)\\s*${number}\\s*(?:${currencyWords})`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const quantity = parseIntakeDecimalNumber(match[1]);
    const price = parseIntakeDecimalNumber(match[2]);
    if (!quantity || !price) continue;
    return {
      quantity,
      price,
      unit: detectExplicitUnitFromEvidenceLineV17_90L3(raw),
    };
  }

  return null;
}

function isFlatFeeOrTravelEvidenceLineV17_90L9(line: string): boolean {
  return /\b(?:fahrt|anfahrt|fahrtkosten|reisekosten|fahrkosten|travel|travel\s+cost|déplacement|deplacement|trasferta|desplazamiento)\b/i.test(
    String(line || ""),
  );
}

function hasGenericAmbiguousObjectSignalV17_90L9(line: string): boolean {
  const normalized = normalizeServiceLineForMatchV17_90L(line);
  return /\b(?:alles|all|everything|dort|hinten|bereich|area|zone|sachen|gegenstaende|gegenstande|gegenstände|objekte|objects|items|things|kleine|kleinen|kleiner|small|diverses|diverse|sonstiges|machen)\b/.test(
    normalized,
  );
}

function ambiguousNoActionEvidenceLinesV17_90L9(
  sourceText: string | null | undefined,
): AmbiguousNoActionEvidenceLineV17_90L9[] {
  return (
    originalCustomerEvidenceLinesV17_90L5(sourceText)
      .filter((line) => !isFlatFeeOrTravelEvidenceLineV17_90L9(line))
      .filter((line) => !hasExplicitWorkActionInEvidenceLineV17_90L5(line))
      // V17.90L9 is intentionally narrow: not every object line without a verb
      // is blocked. Concrete object rows such as "Fenster Eingang 8 Stück à CHF 9"
      // may still be usable in a cleaning order. We fail closed only for floor/
      // surface rows or structurally vague rows like "alles machen" / "kleine Sachen".
      .filter(
        (line) =>
          hasExplicitAreaUnitSignalV17_90L17(line) ||
          hasFloorSurfaceSignalV17_90L5(line) ||
          hasGenericAmbiguousObjectSignalV17_90L9(line),
      )
      .map((line) => {
        const parsed = parseQuantityPriceFromEvidenceLineV17_90L9(line);
        return parsed ? { line, ...parsed } : null;
      })
      .filter((entry): entry is AmbiguousNoActionEvidenceLineV17_90L9 =>
        Boolean(entry),
      )
  );
}

const AMBIGUOUS_EVIDENCE_STOPWORDS_V17_90L9 = new Set([
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "im",
  "in",
  "am",
  "an",
  "auf",
  "beim",
  "bei",
  "und",
  "oder",
  "mit",
  "ohne",
  "zu",
  "zur",
  "zum",
  "the",
  "a",
  "an",
  "at",
  "and",
  "or",
  "in",
  "on",
  "near",
  "with",
  "without",
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "dans",
  "sur",
  "et",
  "ou",
  "avec",
  "sans",
  "il",
  "lo",
  "la",
  "gli",
  "le",
  "un",
  "una",
  "nel",
  "nella",
  "sul",
  "sulla",
  "e",
  "o",
  "con",
  "senza",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "en",
  "del",
  "de",
  "y",
  "o",
  "con",
  "sin",
  "reinigen",
  "reinigung",
  "putzen",
  "saeubern",
  "saubern",
  "clean",
  "cleaning",
  "limpiar",
  "limpieza",
  "pulire",
  "pulizia",
  "nettoyer",
  "nettoyage",
  "m2",
  "qm",
  "quadratmeter",
  "meter",
  "stueck",
  "stuck",
  "stück",
  "stk",
  "pcs",
  "pieces",
  "piece",
  "chf",
  "eur",
  "euro",
]);

function tokenSetForAmbiguousEvidenceMatchV17_90L9(value: string): Set<string> {
  const normalized = normalizeServiceLineForMatchV17_90L(value)
    .replace(/m\s*2/g, "m2")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ");
  const tokens = normalized
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !AMBIGUOUS_EVIDENCE_STOPWORDS_V17_90L9.has(token));
  return new Set(tokens);
}

function tokenOverlapCountV17_90L9(
  left: Set<string>,
  right: Set<string>,
): number {
  let count = 0;
  left.forEach((token) => {
    if (right.has(token)) count += 1;
  });
  return count;
}

function findAmbiguousNoActionEvidenceForItemV17_90L9(
  sourceText: string | null | undefined,
  item: {
    serviceName?: any;
    description?: any;
    evidence?: any;
    sourceText?: any;
    quantity?: any;
    unitPrice?: any;
  },
): AmbiguousNoActionEvidenceLineV17_90L9 | null {
  const lines = ambiguousNoActionEvidenceLinesV17_90L9(sourceText);
  if (lines.length === 0) return null;

  const quantity = Number(item.quantity || 0);
  const price = Number(item.unitPrice || 0);
  const exactNumberMatches = lines.filter((entry) => {
    const quantityMatches =
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Math.abs(entry.quantity - quantity) < 0.0001;
    const priceMatches =
      Number.isFinite(price) &&
      price > 0 &&
      Math.abs(entry.price - price) < 0.0001;
    return quantityMatches && priceMatches;
  });
  if (exactNumberMatches.length === 1) return exactNumberMatches[0];

  const itemText = [
    item.serviceName,
    item.description,
    item.evidence,
    item.sourceText,
  ]
    .filter(Boolean)
    .join(" ");
  const itemTokens = tokenSetForAmbiguousEvidenceMatchV17_90L9(itemText);
  const tokenMatches = lines
    .map((entry) => ({
      entry,
      overlap: tokenOverlapCountV17_90L9(
        itemTokens,
        tokenSetForAmbiguousEvidenceMatchV17_90L9(entry.line),
      ),
    }))
    .filter(({ overlap }) => overlap >= 2)
    .sort(
      (a, b) =>
        b.overlap - a.overlap || a.entry.line.length - b.entry.line.length,
    );
  if (
    tokenMatches.length === 1 ||
    (tokenMatches.length > 1 &&
      tokenMatches[0].overlap > tokenMatches[1].overlap)
  ) {
    return tokenMatches[0].entry;
  }

  const priceOnlyMatches = lines.filter(
    (entry) =>
      Number.isFinite(price) &&
      price > 0 &&
      Math.abs(entry.price - price) < 0.0001,
  );
  const itemLooksAlreadyBlocked =
    isInternalReviewServiceNameV17_90L(String(item.serviceName || "")) ||
    isReviewUnitV17_90L(String((item as any).unit || ""));
  if (itemLooksAlreadyBlocked && priceOnlyMatches.length === 1)
    return priceOnlyMatches[0];

  return null;
}

function blockAmbiguousRowsWithoutExplicitActionV17_90L9<
  T extends {
    serviceName?: string | null;
    quantity?: any;
    unit?: string | null;
    unitPrice?: any;
    totalPrice?: any;
    needsReview?: boolean;
    reviewReason?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  return items.map((item) => {
    const evidence = findAmbiguousNoActionEvidenceForItemV17_90L9(
      sourceText,
      item,
    );
    if (!evidence) return item;

    return {
      ...item,
      serviceName: "Leistung prüfen",
      unit: "Einheit prüfen",
      quantity: evidence.quantity,
      unitPrice: evidence.price,
      totalPrice: 0,
      needsReview: true,
      reviewReason:
        item.reviewReason ||
        `service_action_unclear:${compactText(item.serviceName) || "Leistung"}`,
      description: evidence.line,
      sourceText: evidence.line,
      evidence: evidence.line,
    };
  });
}

function repairReviewUnitsFromLineLocalEvidenceV17_90L3<
  T extends {
    serviceName?: string | null;
    quantity?: any;
    unit?: string | null;
    unitPrice?: any;
    totalPrice?: any;
    needsReview?: boolean;
    reviewReason?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  return items.map((item) => {
    const unitKey = normalizeUnitText(item.unit || "");
    const reviewReason = String(item.reviewReason || "");
    const unitLooksOpen =
      isReviewUnitV17_90L(item.unit) ||
      unitKey.includes("einheit pruefen") ||
      unitKey.includes("einheit prüfen") ||
      reviewReason.startsWith("unit_missing_in_text:") ||
      reviewReason.startsWith("unit_mismatch:");

    if (!unitLooksOpen) return item;

    const evidence = matchingUnitEvidenceLineForItemV17_90L3(sourceText, item);
    if (!evidence) return item;

    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const totalPrice =
      Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    const nextReason =
      reviewReason.startsWith("unit_missing_in_text:") ||
      reviewReason.startsWith("unit_mismatch:")
        ? null
        : item.reviewReason || null;

    return {
      ...item,
      unit: evidence.unit,
      totalPrice,
      needsReview: Boolean(nextReason) ? item.needsReview : false,
      reviewReason: nextReason,
      description: item.description || evidence.line,
      sourceText: item.sourceText || evidence.line,
      evidence: item.evidence || evidence.line,
    };
  });
}

function explicitCurrencyFromEvidenceLineV17_90L4(line: string): string | null {
  const raw = String(line || "");
  const normalized = normalizeServiceLineForMatchV17_90L(raw);
  if (!raw.trim()) return null;
  if (/\bchf\b|\bfranken\b|\bsfr\.?\b|\bfr\.?\b/i.test(raw)) return "CHF";
  if (/\b(?:eur|euro)\b|€/i.test(raw)) return "EUR";
  if (/\b(?:usd|dollar)\b|\$/i.test(raw)) return "USD";
  if (/\b(?:gbp|pfund)\b|£/i.test(raw)) return "GBP";
  if (/\bchf\b|\beur\b|\beuro\b/.test(normalized)) {
    if (/\bchf\b/.test(normalized)) return "CHF";
    if (/\b(?:eur|euro)\b/.test(normalized)) return "EUR";
  }
  return null;
}

function matchingCurrencyEvidenceLineForItemV17_90L4(
  sourceText: string | null | undefined,
  item: {
    quantity?: any;
    unitPrice?: any;
    serviceName?: string | null;
    unit?: string | null;
  },
): { line: string; currency: string } | null {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  const serviceKey = normalizeUnitText(item.serviceName || "");
  const unitKey = normalizeUnitText(item.unit || "");
  const matches = splitSourceEvidenceLinesV17_90L3(sourceText)
    .map((line) => ({
      line,
      currency: explicitCurrencyFromEvidenceLineV17_90L4(line),
    }))
    .filter((entry): entry is { line: string; currency: string } =>
      Boolean(entry.currency),
    )
    .filter((entry) => lineHasDecimalNumberV17_90L3(entry.line, quantity))
    .filter((entry) => lineHasDecimalNumberV17_90L3(entry.line, unitPrice))
    .filter((entry) => {
      const normalized = normalizeUnitText(entry.line);
      // Do not allow a pure metadata/title line to become evidence.
      if (/^regression\b/i.test(entry.line)) return false;
      // For flat fees, prefer travel/ride/fee evidence; this avoids stealing
      // a random same-price service line.
      if (unitKey === "pauschal" || serviceKey.includes("anfahrt")) {
        return /\b(?:travel|cost|fahrt|anfahrt|fahrtkosten|reisekosten|fahrkosten|déplacement|deplacement|trasferta|desplazamiento)\b/i.test(
          entry.line,
        );
      }
      return true;
    });

  const unique = Array.from(
    new Map(
      matches.map((entry) => [
        `${entry.currency}:${normalizeUnitText(entry.line)}`,
        entry,
      ]),
    ).values(),
  );
  const uniqueCurrencies = Array.from(
    new Set(unique.map((entry) => entry.currency)),
  );
  if (uniqueCurrencies.length !== 1) return null;

  return unique.sort((a, b) => a.line.length - b.line.length)[0] || null;
}

function applyLineLocalCurrenciesFromEvidenceV17_90L4<
  T extends {
    serviceName?: string | null;
    quantity?: any;
    unit?: string | null;
    unitPrice?: any;
    detectedCurrency?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  return items.map((item) => {
    if (item.detectedCurrency) return item;
    const evidence = matchingCurrencyEvidenceLineForItemV17_90L4(
      sourceText,
      item,
    );
    if (!evidence) return item;
    return {
      ...item,
      detectedCurrency: evidence.currency,
      description: item.description || evidence.line,
      sourceText: item.sourceText || evidence.line,
      evidence: item.evidence || evidence.line,
    };
  });
}

function extractBlockedForeignCurrencyLineV17_90L3(
  sourceText: string | null | undefined,
): string | null {
  const rawOriginal =
    String(sourceText || "").split(
      /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
    )[0] || String(sourceText || "");
  const explicitTravelLine = rawOriginal
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .find(
      (line) =>
        !/^regression\b/i.test(line) &&
        /\b(?:travel|cost|fahrt|anfahrt|fahrtkosten|reisekosten|fahrkosten|déplacement|deplacement|trasferta|desplazamiento)\b/i.test(
          line,
        ) &&
        /\b(?:eur|euro|usd|dollar|gbp|pfund)\b|[€$£]/i.test(line) &&
        /\d+(?:[.,]\d{1,2})?/.test(line),
    );
  if (explicitTravelLine) return explicitTravelLine;

  const candidates = splitSourceEvidenceLinesV17_90L3(sourceText).filter(
    (line) => {
      const normalized = normalizeServiceLineForMatchV17_90L(line);
      if (/^regression\b/i.test(line)) return false;
      if (!/\b(?:eur|euro|usd|dollar|gbp|pfund)\b|[€$£]/i.test(line))
        return false;
      if (/\bchf\b/i.test(line)) return false;
      if (!/\d+(?:[.,]\d{1,2})?/.test(normalized)) return false;
      if (
        /^(?:invoice|rechnung|facture|factura|fattura|work site|arbeitsort|ausfuehrung|ausführung)\b/i.test(
          line,
        )
      )
        return false;
      return true;
    },
  );

  const travelCandidates = candidates.filter((line) =>
    /\b(?:travel|cost|fahrt|anfahrt|fahrtkosten|reisekosten|fahrkosten|déplacement|deplacement|trasferta|desplazamiento)\b/i.test(
      line,
    ),
  );
  const pool = travelCandidates.length > 0 ? travelCandidates : candidates;
  if (pool.length === 0) return null;

  // Prefer the shortest concrete line, e.g. "Travel cost EUR 60" over a long
  // translated paragraph. Never return the regression title.
  return pool.sort((a, b) => a.length - b.length)[0] || null;
}


// V17.90L43: Letzte, formatierungsunabhängige Duplikatsicherung direkt vor
// dem Speichern. Eine konkrete Fremdwährungsquelle aus der ORIGINALNACHRICHT
// darf höchstens eine rote Prüfposition erzeugen. Die Zuordnung basiert nur
// auf Quell-Evidence, Betrag und Währung – nicht auf Leistungs-Wortlisten.
type ForeignCurrencySourceAnchorV17_90L43 = {
  currency: string;
  amount: number;
  evidence: string;
};

function normalizeCurrencyTokenV17_90L43(value?: string | null): string | null {
  const token = String(value || "").trim().toUpperCase();
  if (token === "CHF") return "CHF";
  if (token === "EUR" || token === "EURO" || token === "€") return "EUR";
  if (token === "USD" || token === "DOLLAR" || token === "$") return "USD";
  if (token === "GBP" || token === "PFUND" || token === "£") return "GBP";
  return null;
}

function parsePositiveMoneyV17_90L43(value?: string | null): number | null {
  const parsed = Number(String(value || "").replace(/'/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractForeignCurrencySourceAnchorsV17_90L43(
  originalMessageText: string | null | undefined,
  finalCurrency: string,
): ForeignCurrencySourceAnchorV17_90L43[] {
  const anchors: ForeignCurrencySourceAnchorV17_90L43[] = [];
  const lines = splitSourceEvidenceLinesV17_90L3(originalMessageText);
  const patterns = [
    /(?:^|[\s(])(?<currency>CHF|EUR|EURO|USD|DOLLAR|GBP|PFUND|€|\$|£)\s*(?<amount>\d+(?:[.,]\d{1,2})?)/giu,
    /(?<amount>\d+(?:[.,]\d{1,2})?)\s*(?<currency>CHF|EUR|EURO|USD|DOLLAR|GBP|PFUND|€|\$|£)(?=$|[\s,.;)])/giu,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const currency = normalizeCurrencyTokenV17_90L43(
          match.groups?.currency,
        );
        const amount = parsePositiveMoneyV17_90L43(match.groups?.amount);
        if (!currency || currency === finalCurrency || !amount) continue;
        anchors.push({ currency, amount, evidence: compactText(line) });
      }
    }
  }

  return anchors;
}

function foreignReviewCurrencyV17_90L43(
  item: {
    detectedCurrency?: string | null;
    reviewReason?: string | null;
  },
  finalCurrency: string,
): string | null {
  const detected = normalizeCurrencyTokenV17_90L43(item.detectedCurrency);
  if (detected && detected !== finalCurrency) return detected;

  const reason = String(item.reviewReason || "");
  const match = reason.match(
    /^(?:item_currency_mismatch|currency_conflict_item):[^:]*:([A-Za-z€$£]+):([A-Za-z€$£]+)/i,
  );
  const sourceCurrency = normalizeCurrencyTokenV17_90L43(match?.[1]);
  const targetCurrency = normalizeCurrencyTokenV17_90L43(match?.[2]);
  if (
    sourceCurrency &&
    sourceCurrency !== finalCurrency &&
    (!targetCurrency || targetCurrency === finalCurrency)
  ) {
    return sourceCurrency;
  }

  return null;
}

function dedupeForeignCurrencyReviewItemsByOriginalSourceV17_90L43<
  T extends {
    serviceName?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
    unitPrice?: any;
    totalPrice?: any;
    needsReview?: boolean;
    reviewReason?: string | null;
    detectedCurrency?: string | null;
  },
>(
  items: T[],
  originalMessageText: string | null | undefined,
  finalCurrencyValue: string,
): T[] {
  const finalCurrency = String(finalCurrencyValue || "CHF").toUpperCase();
  const anchors = extractForeignCurrencySourceAnchorsV17_90L43(
    originalMessageText,
    finalCurrency,
  );
  if (anchors.length === 0) return items;

  const anchorsByCurrency = new Map<string, ForeignCurrencySourceAnchorV17_90L43[]>();
  for (const anchor of anchors) {
    const list = anchorsByCurrency.get(anchor.currency) || [];
    list.push(anchor);
    anchorsByCurrency.set(anchor.currency, list);
  }

  const removeIndexes = new Set<number>();

  for (const [currency, currencyAnchors] of anchorsByCurrency.entries()) {
    const candidates = items
      .map((item, index) => {
        const itemCurrency = foreignReviewCurrencyV17_90L43(
          item,
          finalCurrency,
        );
        if (itemCurrency !== currency) return null;

        const rawEvidence = compactText(
          [item.sourceText, item.evidence, item.description]
            .filter(Boolean)
            .join(" "),
        );
        const evidence = normalizeUnitText(rawEvidence);
        let score = 0;

        for (const anchor of currencyAnchors) {
          const anchorEvidence = normalizeUnitText(anchor.evidence);
          if (evidence && anchorEvidence && evidence === anchorEvidence) {
            score = Math.max(score, 400);
          } else if (
            evidence &&
            anchorEvidence &&
            (evidence.includes(anchorEvidence) || anchorEvidence.includes(evidence))
          ) {
            score = Math.max(score, 300);
          }

          if (rawEvidence && lineHasDecimalNumberV17_90L3(rawEvidence, anchor.amount)) {
            score += 80;
          }
        }

        if (rawEvidence) score += 20;
        if (!isInternalReviewServiceNameV17_90L(item.serviceName || "")) {
          score += 15;
        }
        if (String(item.detectedCurrency || "").trim()) score += 10;
        if (String(item.reviewReason || "").startsWith("item_currency_mismatch:")) {
          score += 5;
        }

        return { index, score };
      })
      .filter((entry): entry is { index: number; score: number } =>
        Boolean(entry),
      )
      .sort((a, b) => b.score - a.score || a.index - b.index);

    // Anzahl der gespeicherten Prüfpositionen darf die Anzahl konkreter
    // Fremdwährungsangaben in der Originalnachricht nicht überschreiten.
    const allowedCount = currencyAnchors.length;
    candidates.slice(allowedCount).forEach((entry) => {
      removeIndexes.add(entry.index);
    });
  }

  if (removeIndexes.size === 0) return items;
  return items.filter((_item, index) => !removeIndexes.has(index));
}

function repairBlockedFlatFeeCurrencyRowsV17_90L3<
  T extends {
    serviceName?: string | null;
    quantity?: any;
    unit?: string | null;
    unitPrice?: any;
    totalPrice?: any;
    needsReview?: boolean;
    reviewReason?: string | null;
    description?: string | null;
    sourceText?: string | null;
    evidence?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  const currencyLine = extractBlockedForeignCurrencyLineV17_90L3(sourceText);

  return items.map((item) => {
    const serviceKey = normalizeUnitText(item.serviceName || "");
    const unitKey = normalizeUnitText(item.unit || "");
    const reviewKey = normalizeUnitText(
      [item.reviewReason, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const total = Number(item.totalPrice || 0);
    const price = Number(item.unitPrice || 0);
    const blockedByCurrencyReview =
      reviewKey.includes("currency_conflict") ||
      reviewKey.includes("currency mismatch") ||
      reviewKey.includes("waehrung") ||
      reviewKey.includes("wahrung") ||
      reviewKey.includes("währung") ||
      reviewKey.includes("preis fehlt") ||
      reviewKey.includes("preis unklar") ||
      reviewKey.includes("preis pruefen") ||
      reviewKey.includes("preis prüfen") ||
      reviewKey.includes("price unclear") ||
      reviewKey.includes("price missing");

    const isFlatFeeTravelRow =
      serviceKey.includes("anfahrt") ||
      unitKey === "pauschal" ||
      /\b(?:travel|cost|fahrt|anfahrt|fahrtkosten|reisekosten|fahrkosten|deplacement|déplacement|trasferta|desplazamiento)\b/i.test(
        [item.description, item.sourceText, item.evidence]
          .filter(Boolean)
          .join(" "),
      );

    const isBlockedCurrencyRow =
      total <= 0 &&
      isFlatFeeTravelRow &&
      (blockedByCurrencyReview || !Number.isFinite(price) || price <= 0);

    if (!isBlockedCurrencyRow) return item;

    // V17.90L7: This must be fail-closed but visually clean. A blocked foreign
    // currency flat fee must never inherit quantity/source text from another
    // line, and must never show the regression/title line as evidence.
    return {
      ...item,
      serviceName:
        serviceKey.includes("anfahrt") || unitKey === "pauschal"
          ? item.serviceName || "Anfahrt"
          : item.serviceName,
      quantity: 1,
      totalPrice: 0,
      needsReview: true,
      reviewReason:
        item.reviewReason || "currency_conflict_item:Anfahrt:EUR:CHF",
      description: currencyLine || item.description,
      sourceText: currencyLine || item.sourceText,
      evidence: currencyLine || item.evidence,
    };
  });
}

function repairGermanVisibleServiceNamesFromTranslationV17_90L<
  T extends {
    serviceName?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    unit?: string | null;
    totalPrice?: number | null;
    sourceText?: string | null;
    evidence?: string | null;
    description?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  const translatedBlock =
    splitAutomaticGermanTranslationBlockV17_90L(sourceText);
  if (!translatedBlock.trim()) return items;

  const translatedLines = translatedBlock
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter(
      (line) =>
        !/^\s*(?:rechnung|ausführung|ausfuehrung|arbeitsort|ausführungsadresse|ausfuehrungsadresse|kontakt|e-mail|tel\.?|telefon)\s*:/i.test(
          line,
        ),
    );

  if (translatedLines.length === 0) return items;
  const translatedSegments = extractTranslatedPricedServiceSegmentsV17_66(translatedBlock);

  return items.map((item) => {
    const currentName = compactText(item.serviceName);
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const totalPrice = Number(item.totalPrice || 0);
    if (!currentName || !Number.isFinite(quantity) || quantity <= 0)
      return item;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return item;

    // Do not turn hard-review placeholders or blocked unit-review rows into
    // guessed service names. Those rows must stay fail-closed and empty in the
    // editor until the user confirms them.
    if (
      isInternalReviewServiceNameV17_90L(currentName) ||
      isReviewUnitV17_90L(item.unit) ||
      totalPrice <= 0
    ) {
      return item;
    }

    const candidates = [
      ...translatedLines
        .filter((line) => translatedLineMatchesItemNumbersV17_90L(line, item))
        .map(cleanTranslatedServiceLabelFromLineV17_90L),
      ...translatedSegments
        .filter(
          (segment) =>
            Math.abs(segment.quantity - quantity) < 0.0001 &&
            Math.abs(segment.unitPrice - unitPrice) < 0.0001 &&
            getServiceUnitType(segment.unit) === getServiceUnitType(String(item.unit || "")),
        )
        .map((segment) => segment.serviceName),
    ]
      .map(normalizeVisibleServiceNameCasingV17_66)
      .filter(isUsableGermanServiceLabelV17_90L);

    const uniqueCandidates = Array.from(
      new Map(
        candidates.map((candidate) => [
          normalizeUnitText(candidate),
          candidate,
        ]),
      ).values(),
    );

    // Even a mixed-language line can already contain the German action word
    // "reinigen". In that case the old guard treated it as fully German and
    // preserved fragments such as "les tables dans la salle reinigen". A
    // unique translated quantity/price segment is stronger line-local evidence
    // and may normalize that visible name.
    if (isAlreadyGermanVisibleServiceNameV17_90L(currentName)) {
      const cleanedName = normalizeVisibleServiceNameCasingV17_66(
        stripMeasureAndPriceFromVisibleServiceNameV17_90L(currentName),
      );
      if (uniqueCandidates.length === 1) {
        const translatedCandidate = uniqueCandidates[0];
        if (
          normalizeUnitText(translatedCandidate) &&
          normalizeUnitText(translatedCandidate) !== normalizeUnitText(cleanedName)
        ) {
          return { ...item, serviceName: translatedCandidate };
        }
      }
      return cleanedName && cleanedName !== currentName
        ? { ...item, serviceName: cleanedName }
        : item;
    }

    if (uniqueCandidates.length !== 1) return item;

    const candidate = uniqueCandidates[0];
    const currentKey = normalizeUnitText(currentName);
    const candidateKey = normalizeUnitText(candidate);
    if (!candidateKey || candidateKey === currentKey) return item;

    return {
      ...item,
      serviceName: normalizeVisibleServiceNameCasingV17_66(candidate),
    };
  });
}

function findBestQuantityForService(
  serviceName: string,
  unitType: string,
  text: string,
  quantityMatches: Array<{ value: number; unit: string; raw: string }>,
): { value: number; unit: string; raw: string } | null {
  const relevant = quantityMatches.filter((q) => q.unit === unitType);
  if (relevant.length === 0) return null;
  if (relevant.length === 1) return relevant[0];

  const normalizedText = normalizeUnitText(text);
  const normalizedService = normalizeUnitText(serviceName);

  const serviceKeywords = normalizedService
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const keywordMap: Record<string, string[]> = {
    square_meter: [
      "streichen",
      "malen",
      "wand",
      "fassade",
      "flaeche",
      "fläche",
    ],
    cubic_meter: [
      "kubikmeter",
      "volumen",
      "entsorgung",
      "entsorgen",
      "gruenabfall",
      "grünabfall",
      "bauschutt",
      "aushub",
    ],
    ton: [
      "tonne",
      "tonnen",
      "entsorgung",
      "entsorgen",
      "bauschutt",
      "aushub",
      "abfall",
    ],
    liter: [
      "liter",
      "reiniger",
      "reinigungsmittel",
      "reinigung",
      "spezialreiniger",
    ],
    meter: ["meter", "hecke", "hecken", "schneiden", "stutzen", "rohr", "zaun"],
    hour: ["stunde", "stunden", "maehen", "mähen", "wiese", "rasen"],
    day: ["tag", "tage", "arbeitstag", "arbeitstage", "montage"],
    piece: ["stueck", "stück", "baum", "baeume", "bäume", "platten"],
    kilogram: ["kilogramm", "kilo", "kg", "kies", "material"],
  };

  const keywords = [...serviceKeywords, ...(keywordMap[unitType] || [])];

  const sentences = normalizedText
    .split(/[.!?\n;-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let best: {
    q: { value: number; unit: string; raw: string };
    score: number;
  } | null = null;

  for (const q of relevant) {
    const raw = normalizeUnitText(q.raw);
    let score = 0;

    for (const sentence of sentences) {
      if (!sentence.includes(raw)) continue;

      for (const keyword of keywords) {
        if (sentence.includes(keyword)) score += 10;
      }

      if (normalizedService && sentence.includes(normalizedService))
        score += 25;
    }

    const rawIndex = normalizedText.indexOf(raw);
    const serviceIndex = keywords
      .map((k) => normalizedText.indexOf(k))
      .filter((i) => i >= 0)
      .sort((a, b) => Math.abs(a - rawIndex) - Math.abs(b - rawIndex))[0];

    if (rawIndex >= 0 && serviceIndex >= 0) {
      score += Math.max(
        0,
        20 - Math.floor(Math.abs(rawIndex - serviceIndex) / 20),
      );
    }

    if (!best || score > best.score) {
      best = { q, score };
    }
  }

  return best?.q || relevant[0];
}
function findConflictingQuantityForService(
  serviceName: string,
  serviceUnitType: string,
  text: string,
  quantityMatches: Array<{ value: number; unit: string; raw: string }>,
): { value: number; unit: string; raw: string } | null {
  const otherUnits = quantityMatches.filter((q) => q.unit !== serviceUnitType);
  if (otherUnits.length === 0) return null;

  const normalizedText = normalizeUnitText(text);
  const normalizedService = normalizeUnitText(serviceName);

  const serviceKeywords = normalizedService
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const activityKeywords: Record<string, string[]> = {
    hour: [
      "maehen",
      "mähen",
      "wiese",
      "rasen",
      "arbeit",
      "nacharbeit",
      "reinigen",
      "montieren",
    ],
    day: ["arbeitstag", "arbeitstage", "montage", "montieren", "vorbereitung"],
    meter: [
      "hecke",
      "hecken",
      "schneiden",
      "stutzen",
      "rohr",
      "verlegen",
      "zaun",
    ],
    square_meter: ["streichen", "malen", "wand", "fassade", "decke", "farbe"],
    cubic_meter: [
      "aushub",
      "gruenabfall",
      "grünabfall",
      "volumen",
      "kubikmeter",
      "entsorgen",
    ],
    ton: ["tonne", "tonnen", "bauschutt", "aushub", "entsorgen", "entsorgung"],
    liter: ["liter", "reiniger", "reinigungsmittel", "spezialreiniger"],
    kilogram: ["kilogramm", "kilo", "kg", "kies", "material", "liefern"],
    piece: ["stueck", "stück", "baum", "baeume", "bäume", "platten", "setzen"],
    flat: ["pauschal", "fällen", "faellen", "baum"],
  };

  const keywords = [
    ...serviceKeywords,
    ...(activityKeywords[serviceUnitType] || []),
  ].filter(Boolean);

  const sentences = normalizedText
    .split(/[.!?\n;-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let best: {
    q: { value: number; unit: string; raw: string };
    score: number;
  } | null = null;

  for (const q of otherUnits) {
    const raw = normalizeUnitText(q.raw);
    let score = 0;

    for (const sentence of sentences) {
      if (!sentence.includes(raw)) continue;

      for (const keyword of keywords) {
        if (sentence.includes(keyword)) score += 10;
      }

      if (normalizedService && sentence.includes(normalizedService))
        score += 30;
    }

    if (!best || score > best.score) {
      best = { q, score };
    }
  }

  return best && best.score > 0 ? best.q : null;
}

/**
 * Strukturiertes Audit-Log für jede Intake-Verarbeitung.
 * Wird in stdout als kompakter JSON-Block ausgegeben:
 *   [INTAKE-AUDIT] {"source":"WhatsApp", ...}
 *
 * Telefonnummern sind maskiert (maskPhoneForLog).
 * Audio-Buffer / Bildinhalte werden NIE geloggt.
 */
function logIntakeAudit(payload: {
  source: string;
  userId: string | null;
  phoneMasked: string;
  senderName: string;
  mediaType: string | null;
  hasTranscript: boolean;
  transcriptLen: number;
  llmExtractedName: string | null;
  llmAbgleichStatus: string;
  selfIntroFallbackUsed: boolean;
  resolvedCustomerName: string | null;
  customerId: string | null;
  customerWasNewlyCreated: boolean;
  customerNameInDb: string | null;
  customerFallbackUsed: boolean;
  notes?: string;
}): void {
  try {
    console.log("[INTAKE-AUDIT]", JSON.stringify(payload));
  } catch {
    // never let logging break the intake
  }
}


// V17.90L60: Generic line-local reconciliation for long structured messages.
// Every explicitly priced service line remains its own position. This prevents
// the AI from merging separate work areas with equal unit prices and prevents
// quantity/price evidence from leaking from one line into another.
type ExplicitPricedServiceLineV17_90L60 = {
  index: number;
  raw: string;
  serviceName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  detectedCurrency: string | null;
};

function displayUnitFromExplicitLineV17_90L60(rawUnit: string): string {
  const unit = normalizeUnitText(rawUnit);
  if (["m2", "m²", "qm", "quadratmeter", "quadradmeter"].includes(unit))
    return "Quadratmeter";
  if (["laufmeter", "lfm", "meter", "m"].includes(unit)) return "Meter";
  if (["stunde", "stunden", "std", "h"].includes(unit)) return "Stunde";
  if (["tag", "tage", "arbeitstag", "arbeitstage"].includes(unit)) return "Tag";
  if (["liter", "ltr", "l"].includes(unit)) return "Liter";
  if (["kilogramm", "kg"].includes(unit)) return "Kilogramm";
  if (["tonne", "tonnen", "to", "t"].includes(unit)) return "Tonne";
  if (["raum", "raeume", "räume", "zimmer", "rooms", "room"].includes(unit))
    return /^r/i.test(rawUnit.trim()) ? "Räume" : "Zimmer";
  if (
    [
      "stueck",
      "stück",
      "stuck",
      "stk",
      "anzahl",
      "einheit",
      "einheiten",
      "piece",
      "pieces",
      "pcs",
    ].includes(unit)
  )
    return "Stück";
  return compactText(rawUnit) || "Einheit prüfen";
}

function cleanExplicitServiceLabelV17_90L60(value: string): string {
  const cleaned = compactText(value)
    .replace(/^[-–—•*]+\s*/, "")
    .replace(/^(?:folgende\s+arbeiten\s+ausf(?:ü|ue)hren|leistungen?)\s*:?\s*/i, "")
    .replace(/[,:;\-–—]+\s*$/, "")
    .trim();
  if (!cleaned) return "Leistung prüfen";

  // V17.90L62: Explicit priced source lines are contractual positions. Keep
  // the complete work area/object from the customer line instead of reducing
  // every floor/window row to a generic catalog label. Only the amount/unit
  // fragments are removed here; semantic area words remain intact.
  const lineLocalLabel = cleanGermanServiceLabelGrammarV17_90L(
    stripMeasureAndPriceFromVisibleServiceNameV17_90L(cleaned),
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!lineLocalLabel) return "Leistung prüfen";

  // Travel flat fees are the one structural category intentionally normalized
  // to the established visible document label.
  if (
    /^(?:anfahrt|anfahrt\s+pauschal|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|reisepauschale|travel(?:\s+(?:cost|fee|flat\s+fee))?|d[ée]placement|trasferta|viaje)\b/i.test(
      lineLocalLabel,
    )
  ) {
    return "Anfahrt";
  }

  return lineLocalLabel.charAt(0).toUpperCase() + lineLocalLabel.slice(1);
}

function parseExplicitPricedServiceLinesV17_90L60(
  sourceText: string | null | undefined,
): ExplicitPricedServiceLineV17_90L60[] {
  const originalPart = String(sourceText || "").split(
    /---\s*Übersetzung\s*\(automatisch\)\s*---/i,
  )[0];
  const lines = splitIntakeLines(originalPart);
  const unitPattern =
    String.raw`m²|m2|qm|quadratmeter|quadradmeter|laufmeter|lfm|meter|stunden?|std\.?|h|tage?|arbeitstage?|stücke?|stueck|stuck|stk|anzahl|einheiten?|räume?|raeume|raum|zimmer|rooms?|pieces?|piece|pcs|liter|ltr\.?|l|kilogramm|kg|tonnen?|to`;
  const currencyPattern = String.raw`CHF|Fr\.?|SFr\.?|EUR|Euro|€|USD|\$|GBP|£`;
  const numberPattern = String.raw`\d+(?:[.,]\d+)?`;
  const result: ExplicitPricedServiceLineV17_90L60[] = [];

  lines.forEach((rawLine, index) => {
    const raw = compactText(rawLine);
    if (!raw) return;

    const pricedPatterns = [
      new RegExp(
        `^(.*?)\\s*,?\\s*(${numberPattern})\\s*(${unitPattern})\\s*(?:à|a|je|pro|per|zu|at)\\s*(?:(${currencyPattern})\\s*)?(${numberPattern})(?:\\s*(${currencyPattern}))?\\s*$`,
        "i",
      ),
      new RegExp(
        `^(.*?)\\s*,?\\s*(${numberPattern})\\s*(${unitPattern})\\s*(?:à|a|je|pro|per|zu|at)\\s*(${numberPattern})\\s*(${currencyPattern})\\s*$`,
        "i",
      ),
    ];

    for (const pattern of pricedPatterns) {
      const match = raw.match(pattern);
      if (!match) continue;
      const quantity = parseIntakeDecimalNumber(match[2]);
      const unit = displayUnitFromExplicitLineV17_90L60(match[3]);
      const firstPattern = match.length >= 7;
      const price = parseIntakeDecimalNumber(firstPattern ? match[5] : match[4]);
      const currencyRaw = firstPattern ? match[4] || match[6] : match[5];
      if (!quantity || !price) return;
      result.push({
        index,
        raw,
        serviceName: cleanExplicitServiceLabelV17_90L60(match[1]),
        quantity,
        unit,
        unitPrice: price,
        detectedCurrency: currencyRaw
          ? normalizeCurrencyTokenV17_90L43(String(currencyRaw))
          : null,
      });
      return;
    }

    const flatMatch = raw.match(
      new RegExp(
        `^(.*?)\s*,?\s*(?:pauschal|pauschale|fixpreis|festpreis)\s*(?:(${currencyPattern})\s*)?(${numberPattern})(?:\s*(${currencyPattern}))?\s*$`,
        "i",
      ),
    );
    if (flatMatch) {
      const price = parseIntakeDecimalNumber(flatMatch[3]);
      if (!price) return;
      const currencyRaw = flatMatch[2] || flatMatch[4];
      result.push({
        index,
        raw,
        serviceName: cleanExplicitServiceLabelV17_90L60(flatMatch[1]),
        quantity: 1,
        unit: "Pauschal",
        unitPrice: price,
        detectedCurrency: currencyRaw
          ? normalizeCurrencyTokenV17_90L43(String(currencyRaw))
          : null,
      });
      return;
    }

    // SMARTFLOW_V17_90L371AR: eindeutige Zusatzkosten mit Betrag sind
    // abrechenbare Positionen, auch wenn kein Wort wie "pauschal" dabei steht:
    // "Parkgebühr Baustelle CHF 12", "Bewilligung CHF 30",
    // "Entsorgung Altmaterial CHF 40", "Anfahrt CHF 18".
    // Normale Leistungszeilen ohne Zusatzkosten-Semantik werden hier nicht
    // materialisiert.
    const amountOnlyCostMatch = raw.match(
      new RegExp(
        `^(.*?)\s+(?:(${currencyPattern})\s*)?(${numberPattern})(?:\s*(${currencyPattern}))?\s*$`,
        "i",
      ),
    );
    if (!amountOnlyCostMatch) return;
    const costLabel = cleanExplicitServiceLabelV17_90L60(amountOnlyCostMatch[1]);
    const costPrice = parseIntakeDecimalNumber(amountOnlyCostMatch[3]);
    const costCurrencyRaw = amountOnlyCostMatch[2] || amountOnlyCostMatch[4];
    if (!costPrice) return;
    const inferredType = normalizePositionType(
      classifyPositionTypeBeforeCanonicalLockV17_90L371AM({
        raw: { positionType: "expense" },
        serviceName: costLabel,
        sourceText: raw,
      }).positionType,
    );
    if (!["expense", "disposal", "flat_fee"].includes(inferredType)) return;
    result.push({
      index,
      raw,
      serviceName: costLabel,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: costPrice,
      detectedCurrency: costCurrencyRaw
        ? normalizeCurrencyTokenV17_90L43(String(costCurrencyRaw))
        : null,
    });
  });

  const translatedBlock = splitAutomaticGermanTranslationBlockV17_90L(sourceText);
  if (!translatedBlock.trim()) return result;
  const translatedSegments = extractTranslatedPricedServiceSegmentsV17_66(translatedBlock);
  if (translatedSegments.length === 0) return result;

  return result.map((entry) => {
    const matches = translatedSegments.filter(
      (segment) =>
        Math.abs(segment.quantity - entry.quantity) < 0.0001 &&
        Math.abs(segment.unitPrice - entry.unitPrice) < 0.0001 &&
        getServiceUnitType(segment.unit) === getServiceUnitType(entry.unit),
    );
    if (matches.length !== 1) return entry;
    return {
      ...entry,
      serviceName: normalizeVisibleServiceNameCasingV17_66(matches[0].serviceName),
    };
  });
}

function buildExplicitPricedExpenseFallbackRawItemsV17_90L371AR(
  sourceText: string | null | undefined,
  fallbackCurrency: string,
): any[] {
  return parseExplicitPricedServiceLinesV17_90L60(sourceText)
    .filter((entry) => {
      const inferredType = normalizePositionType(
        classifyPositionTypeBeforeCanonicalLockV17_90L371AM({
          raw: { positionType: "expense" },
          serviceName: entry.serviceName,
          sourceText: entry.raw,
        }).positionType,
      );
      return ["expense", "disposal", "flat_fee"].includes(inferredType);
    })
    .map((entry) => ({
      positionType: "expense",
      serviceName: entry.serviceName,
      name: entry.serviceName,
      action_name: entry.serviceName,
      service_name: entry.serviceName,
      quantity: entry.quantity,
      menge: entry.quantity,
      unit: entry.unit,
      einheit: entry.unit,
      unitPrice: entry.unitPrice,
      unit_price: entry.unitPrice,
      price: entry.unitPrice,
      totalPrice: roundIntakeMoney(entry.quantity * entry.unitPrice),
      currency: entry.detectedCurrency || fallbackCurrency || "CHF",
      sourceText: entry.raw,
      source_text: entry.raw,
      evidence: entry.raw,
      raw: entry.raw,
      confidence: "hoch",
      needsReview: false,
      needs_review: false,
      reviewReason: "",
      review_reason: "",
    }));
}

function explicitLineItemFingerprintV17_90L60(input: {
  quantity?: any;
  unitPrice?: any;
  unit?: any;
}): string {
  return [
    Number(input.quantity || 0).toFixed(4),
    Number(input.unitPrice || 0).toFixed(4),
    getServiceUnitType(String(input.unit || "")),
  ].join("|");
}

function evidenceTokenScoreV17_90L60(left: string, right: string): number {
  const stop = new Set([
    "reinigen",
    "reinigung",
    "komplett",
    "innen",
    "aussen",
    "außen",
    "und",
    "der",
    "die",
    "das",
  ]);
  const tokens = (value: string) =>
    normalizeUnitText(value)
      .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
      .split(/\s+/g)
      .filter((token) => token.length >= 4 && !stop.has(token));
  const rightSet = new Set(tokens(right));
  return tokens(left).filter((token) => rightSet.has(token)).length;
}

function findAggregateEntrySubsetV17_90L60(
  entries: ExplicitPricedServiceLineV17_90L60[],
  targetQuantity: number,
): ExplicitPricedServiceLineV17_90L60[] | null {
  // V17.90L62: Do not cap this search to the first twelve rows. In long
  // orders the second half of an accidental aggregate can be near the end of
  // the message (for example row 7 + row 18). The caller already prefilters
  // candidates to the same price and unit, so the complete set is safe here.
  const candidates = entries;
  let found: ExplicitPricedServiceLineV17_90L60[] | null = null;
  const walk = (
    start: number,
    current: ExplicitPricedServiceLineV17_90L60[],
    sum: number,
  ) => {
    if (found) return;
    if (current.length >= 2 && Math.abs(sum - targetQuantity) < 0.0001) {
      found = [...current];
      return;
    }
    if (sum >= targetQuantity || current.length >= 6) return;
    for (let index = start; index < candidates.length; index += 1) {
      walk(index + 1, [...current, candidates[index]], sum + candidates[index].quantity);
      if (found) return;
    }
  };
  walk(0, [], 0);
  return found;
}

function reconcileExplicitPricedServiceLinesV17_90L60<
  T extends {
    serviceName: string;
    positionType?: string | null;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    needsReview: boolean;
    reviewReason: string | null;
    sourceText?: string | null;
    evidence?: string | null;
    detectedCurrency?: string | null;
  },
>(items: T[], sourceText: string | null | undefined): T[] {
  const entries = parseExplicitPricedServiceLinesV17_90L60(sourceText);
  if (entries.length < 2) return items;

  const usedItemIndexes = new Set<number>();
  const removedAggregateIndexes = new Set<number>();
  const assigned = new Map<number, T>();

  const materialize = (entry: ExplicitPricedServiceLineV17_90L60, base?: T): T =>
    ({
      ...(base || ({} as T)),
      serviceName:
        base?.serviceName &&
        !isInternalReviewServiceNameV17_90L(base.serviceName)
          ? base.serviceName
          : entry.serviceName,
      description: entry.raw,
      quantity: entry.quantity,
      unit: entry.unit,
      unitPrice: entry.unitPrice,
      totalPrice: roundIntakeMoney(entry.quantity * entry.unitPrice),
      needsReview: base?.needsReview ?? true,
      reviewReason: base?.reviewReason || "line_local_service_reconciled",
      sourceText: entry.raw,
      evidence: entry.raw,
      detectedCurrency: entry.detectedCurrency || base?.detectedCurrency || null,
    }) as T;

  entries.forEach((entry, entryIndex) => {
    const fingerprint = explicitLineItemFingerprintV17_90L60(entry);
    const candidates = items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item, itemIndex }) =>
        !usedItemIndexes.has(itemIndex) &&
        explicitLineItemFingerprintV17_90L60(item) === fingerprint,
      )
      .map(({ item, itemIndex }) => ({
        item,
        itemIndex,
        score: evidenceTokenScoreV17_90L60(
          entry.serviceName,
          [item.serviceName, item.description, item.sourceText, item.evidence]
            .filter(Boolean)
            .join(" "),
        ),
      }))
      .sort((a, b) => b.score - a.score || a.itemIndex - b.itemIndex);
    const best = candidates[0];
    if (!best) return;
    usedItemIndexes.add(best.itemIndex);
    assigned.set(entryIndex, materialize(entry, best.item));
  });

  items.forEach((item, itemIndex) => {
    if (usedItemIndexes.has(itemIndex)) return;
    const targetQuantity = Number(item.quantity || 0);
    const targetPrice = Number(item.unitPrice || 0);
    const targetUnitType = getServiceUnitType(item.unit);
    if (!targetQuantity || !targetPrice || targetUnitType === "unknown") return;

    const unresolved = entries.filter((entry, entryIndex) =>
      !assigned.has(entryIndex) &&
      Math.abs(entry.unitPrice - targetPrice) < 0.0001 &&
      getServiceUnitType(entry.unit) === targetUnitType,
    );
    if (unresolved.length < 2) return;
    const subset = findAggregateEntrySubsetV17_90L60(unresolved, targetQuantity);
    if (!subset) return;
    removedAggregateIndexes.add(itemIndex);
    subset.forEach((entry) => {
      const entryIndex = entries.indexOf(entry);
      assigned.set(entryIndex, materialize(entry, item));
    });
  });

  entries.forEach((entry, entryIndex) => {
    if (!assigned.has(entryIndex)) assigned.set(entryIndex, materialize(entry));
  });

  const lineItems = entries
    .map((_entry, entryIndex) => assigned.get(entryIndex))
    .filter((item): item is T => Boolean(item));
  const remaining = items.filter(
    (_item, itemIndex) =>
      !usedItemIndexes.has(itemIndex) && !removedAggregateIndexes.has(itemIndex),
  );

  return [...lineItems, ...remaining];
}

// ---------- Types ----------
export interface IntakeResult {
  orderId: string;
  description: string;
  customerName: string;
  serviceName: string;
  kundeStatus: string;
  kundenabgleichStatus: string;
}

export interface IntakeInput {
  source: "Telegram" | "WhatsApp";
  senderName: string;
  /**
   * Block R — sender phone (E.164) for masked audit logging only.
   * NEVER used for customer matching. Optional: existing call sites may
   * omit this field; logIntakeAudit will then output phoneMasked='[redacted]'.
   */
  phoneNumber?: string | null;
  messageText: string;
  imageBase64?: string | null;
  imageMimeType?: string;
  savedMediaPath?: string | null;
  savedMediaType?: "audio" | "image" | null;
  optimizedPreviewPath?: string | null;
  optimizedThumbnailPath?: string | null;
  userId?: string | null;
  // Multi-image support
  allImageBase64s?: string[];
  allImageMimeTypes?: string[];
  allSavedMediaPaths?: string[];
  allOptimizedPreviewPaths?: string[];
  allOptimizedThumbnailPaths?: string[];
  // ─── Stage I: audio usage tracking (additive, optional) ───
  // Detected duration in seconds (may be fractional; will be rounded by the
  // intake before writing). NULL when duration parsing failed (Stage H
  // fail-open path) or when the order has no audio at all.
  audioDurationSec?: number | null;
  // Lifecycle marker — see Order.audioTranscriptionStatus comment in schema.prisma.
  // 'transcribed' | 'failed' | 'skipped_too_long' | 'skipped_uncheckable' | 'skipped_quota_exceeded' | null
  audioTranscriptionStatus?:
    | "transcribed"
    | "failed"
    | "skipped_too_long"
    | "skipped_uncheckable"
    | "skipped_quota_exceeded"
    | null;
  additionalReviewReasons?: string[];
  reviewNote?: string;
  forceReview?: boolean;
}

// ---------- Build system prompt ----------
function buildSystemPrompt(
  serviceListJson: string,
  customerListJson: string,
  senderName: string,
  branche: string = "Gartenbau",
  hauptsprache: string = "Deutsch",
  appointmentReferenceText: string = "",
): string {
  return `WICHTIG – ABSOLUT KRITISCH:

Gib NUR gültiges JSON zurück.
KEINE Markdown-Formatierung.
KEIN Text vor oder nach dem JSON.
KEINE Erklärungen.

--------------------------------------------------
ROLLE
--------------------------------------------------

Du bist eine KI für ein ${branche}-Unternehmen.

Deine Aufgaben:

1. Endkunden-Daten extrahieren
2. Kundenabgleich durchführen
3. Auftrag verstehen
4. Passende Leistung erkennen (Service-Matching)
5. Unsicherheiten markieren

--------------------------------------------------
WICHTIGER KONTEXT
--------------------------------------------------

- Nachrichten werden typischerweise vom Firmenkunden (A) weitergeleitet
- Der Absender ("${senderName}") ist STANDARDMÄSSIG Kunde A – NICHT der Endkunde
- Telefonnummer und E-Mail NICHT für Kundenabgleich verwenden
- Es geht in der Regel um Endkunde (B) – alle Daten aus dem Nachrichtentext extrahieren
- KEINE Daten erfinden

REFERENZZEIT FÜR RELATIVE TERMINE:
${appointmentReferenceText || "Nicht verfügbar – relative Termine ohne sichere Referenz nicht in ein Datum umrechnen."}
- Diese Referenz ist der Eingang der Kundennachricht in der Zeitzone Europe/Zurich.
- Eindeutige relative Datumsangaben wie „Donnerstag“, „nächsten Donnerstag“, „morgen“ oder „nächste Woche Montag“ dürfen anhand dieser Referenz in datum (YYYY-MM-DD) umgerechnet werden.
- Ist die Zuordnung mehrdeutig, insbesondere bei einem bloßen Wochentag, der auf denselben Kalendertag wie der Nachrichteneingang fällt, datum = null und zeitangabe_status = "unklar". Niemals ein Datum raten.

- WICHTIG: kunde.name MUSS aus dem eingehenden Nachrichtentext / Audio-Transkript / Bildinhalt extrahiert werden, wenn dort ein Personen- oder Firmenname eindeutig genannt wird.
- Das gilt für Selbstvorstellungen, Anreden, Weiterleitungen und normale Auftragstexte.
- Beispiele für gültige Namenssignale:
  "Mein Name ist Max Müller" → kunde.name = "Max Müller"
  "Hallo Frau Meier, Hecke geschnitten" → kunde.name = "Frau Meier"
  "Guten Tag Herr Keller, Terrasse reinigen" → kunde.name = "Herr Keller"
  "Bitte bei Max Müller Rasen mähen" → kunde.name = "Max Müller"
  "Kunde: Peter Schmid" → kunde.name = "Peter Schmid"
- Der Absendername ("${senderName}") darf NICHT automatisch als kunde.name übernommen werden.
- ABER: Wenn derselbe Name eindeutig im Nachrichtentext selbst steht, darf und soll er als kunde.name extrahiert werden.
- Namen dürfen NIEMALS aus bestehende_kunden kopiert werden. bestehende_kunden dient nur zum Abgleich, nicht zum Befüllen von kunde.name.
- Wenn im Nachrichtentext kein Name steht → kunde.name = null.

--------------------------------------------------
EINGABE
--------------------------------------------------

bestehende_kunden:
${customerListJson}

leistungen:
${serviceListJson}

--------------------------------------------------
ZIELE
--------------------------------------------------

1. Kunde extrahieren:
- name
- strasse
- hausnummer
- plz
- ort
- telefon
- email

2. Auftrag:
- titel (max 3 Wörter, IMMER auf ${hauptsprache})
- beschreibung (IMMER auf ${hauptsprache}, auch wenn die Nachricht in einer anderen Sprache ist)
- beschreibung enthält NUR die Arbeiten/Leistungen, kurz und sachlich.
- beschreibung darf KEINE Gefahren, Warnhinweise, organisatorischen Hinweise, Rückrufe, Zugangshinweise, Hund-/Öl-/Strom-Hinweise oder lange Kundenerklärungen enthalten.
- gefahren: JSON-Array mit echten Sicherheitsrisiken / Warnhinweisen, z.B. ["Hund läuft frei auf dem Grundstück", "Offene Stromkabel im Keller", "Rutschiger Boden wegen Öl"]
- besonderheiten: VERALTETES KOMPATIBILITÄTSFELD. Dieses Array MUSS immer leer bleiben: [].
- Alle organisatorischen Informationen ausschließlich in die strukturierten Zielfelder termine, kontakt_vor_ort, zugangshinweise, parkhinweise oder sonstige_hinweise schreiben.
  (GEFAHREN und strukturierte HINWEISROLLEN strikt trennen.)
  (Leiter allein ist KEINE Gefahr. Leiter nur dann als Gefahr werten, wenn zusätzlich ein echtes Risiko genannt wird, z.B. Absturzgefahr, instabiler Stand, Arbeiten in großer Höhe.)
  (PRODUKTREGEL HUND: Jede tatsächlich erwähnte Hundaussage genau einmal in gefahren ausgeben, damit der rote Hund-Chip erscheint. Den Zustand neutral und originalgetreu auf ${hauptsprache} wiedergeben. Niemals Gefährlichkeit, Freiheit oder Sicherung erfinden.)
  (Parkplatz/Zugang unterscheiden: alle Parkplatz- und Zufahrtsinformationen ausschließlich in parkhinweise; Zugang und Schlüssel ausschließlich in zugangshinweise.)
  (Neutrale oder unwichtige Erleichterungen NICHT als Außen-Hinweis erzwingen: "Parkplatz ist kein Thema", "man kann direkt halten", "Zugang frei", "Tür ist offen".)
  (Rückruf NUR aufnehmen, wenn der Kunde ausdrücklich einen TELEFONISCHEN Rückruf/Anruf verlangt. Klingeln, warten, an der Tür melden, Kunde ist vor Ort, Schlüsselübergabe an der Tür oder "nicht anrufen" sind KEIN Rückruf. Dann höchstens als normaler Hinweis formulieren, z.B. "Vor Arbeitsbeginn klingeln und warten".)
  (Verneinte oder nicht relevante Aussagen NICHT aufnehmen: "kein Hund", "kein Öl", "keine Scherben", "Leiter nicht benötigt", "Termin flexibel", "Parkplatz kein Thema".)
  (Keine Leistungen, Preise oder Mengen in gefahren oder Hinweisrollen schreiben.)
  (Kommunikationshinweise semantisch vollständig ausgeben: Kanal erlaubt/verboten/bevorzugt und Kontaktzeit sauber trennen. Wenn ein Kanal verboten ist, darf er nicht positiv formuliert werden. Beispiel: nicht über WhatsApp schreiben => "Kein WhatsApp; lieber Telefonkontakt". Beispiel: WhatsApp erst ab 18:00 => "WhatsApp-Kontakt erst ab 18:00 Uhr möglich".)
  (WICHTIG: Verneinungen immer semantisch an den richtigen Satzteil binden. "WhatsApp an 079..., nicht einfach kommen" bedeutet WhatsApp bevorzugt + nicht unangemeldet kommen. Es bedeutet NICHT "Keine WhatsApp".)
  (Kontaktzeiten wie SMS/WhatsApp/Mail/Telefon erst ab/nach Uhrzeit sind KEINE Ausführungstermine.)
  (KEINE Systemhinweise.)
  (IMMER auf ${hauptsprache} übersetzen, auch wenn die Nachricht in einer anderen Sprache ist.)
  (WICHTIG: Erkenne Gefahren, Rückruf, Zugang und Parken semantisch nach Bedeutung, NICHT nur über feste deutsche Wörter. Auch Englisch, Französisch, Spanisch, Italienisch, Portugiesisch, Schweizerdeutsch oder gemischte Nachrichten müssen in die passenden deutschen strukturierten Rollen übersetzt werden.)

2a. Strukturierte Rollen – verbindlich und sprachunabhängig:
- kontakt_vor_ort ist ausschließlich die Person, die für DIESEN Auftrag ausdrücklich kontaktiert werden soll.
- Eine Person, die nur bei Schlüssel, Empfang, Badge, Zugang oder Parkplatz erwähnt wird, ist dadurch KEINE Kontaktperson.
- Steht ausdrücklich "nicht Kontaktperson", "keine Kontaktperson" oder sinngleich, muss kontakt_vor_ort.vorhanden = false, name = null und telefon = null sein. Eine separate Kommunikationsanweisung bleibt ausschließlich im Termin-/Kommunikationsfeld erhalten.
- Eine reine Ausschlussaussage wie "X ist nicht die Kontaktperson" ist nur eine Negativregel für die Extraktion und darf nicht zusätzlich in gefahren, zugangshinweise, parkhinweise oder sonstige_hinweise ausgegeben werden.
- kontakt_vor_ort.name, telefon, kanal und evidence müssen aus derselben lokalen Textstelle stammen. Der Name braucht in dieser lokalen Stelle einen ausdrücklichen Kontaktbezug, eine direkt zugeordnete Telefonnummer oder eine direkte Anweisung wie "X anrufen / X per SMS / X per WhatsApp kontaktieren".
- kanal ist nur: "sms", "whatsapp", "anruf" oder null. Ein ausdrücklich verbotener Kanal darf niemals als ankuendigung_kanal oder kontakt_vor_ort.kanal ausgegeben werden. Bei "nur anrufen, keine SMS, kein WhatsApp" ist der Kanal zwingend "anruf".
- Wenn der Text ausdrücklich eine neue Vor-Ort-Nummer nennt, hat sie für diesen Auftrag Vorrang vor der gespeicherten Firmennummer. Die Kundentelefonnummer wird dadurch nicht geändert.
- Eine Aussage wie "nicht die normale Firmennummer anrufen, sondern Herr X unter 079..." bedeutet: Herr X / 079... ist der Auftragskontakt; nicht_anrufen = false, kanal = "anruf".
- Eine Aussage wie "nur SMS, nicht anrufen" bedeutet: kanal = "sms", nicht_anrufen = true.
- Name, Telefon und Kommunikationskanal dürfen niemals in die Ausführungsadresse gelangen.
- Wenn die Nachricht ausdrücklich verlangt, einen bereits gespeicherten/bestehenden Kunden wiederzuverwenden:
  kundenabgleich.reuse_requested = true und reuse_evidence = die konkrete lokale Textstelle.
- In diesem Fall die vollständige, im Nachrichtentext genannte Firma mit bestehende_kunden vergleichen.
  Nur bei genau einem eindeutigen vollständigen Namen bestehende_kunden_id setzen; niemals Stammdaten aus der Liste in kunde kopieren.
- termine enthält pro realem Ausführungstermin genau einen Eintrag mit:
  art = "ausfuehrung", datum, von, bis, tageszeit, zeitangabe_text, zeitangabe_status, ankuendigung_minuten, ankuendigung_kanal, evidence.
- zeitangabe_text ist die kurze, inhaltlich originalgetreue Termin-/Zeitformulierung in ${hauptsprache}. Fremdsprachige oder mundartliche Formulierungen semantisch sauber übersetzen, aber nicht präzisieren: "Thursday late in the day" → "Donnerstag später am Tag"; aus "später am Tag" niemals "nachmittags" oder "abends" machen. Keine Kontaktanweisung anhängen.
- zeitangabe_status ist ausschließlich "klar", "vage" oder "unklar": "klar" bei eindeutigem Datum/Uhrzeit/konventioneller Tageszeit, "vage" bei relativer oder offener Formulierung, "unklar" wenn ein Termin gemeint ist, aber keine brauchbare Zeitformulierung sicher erhalten werden kann.
- datum ist YYYY-MM-DD. Eindeutige relative Wochentage anhand der oben genannten Referenzzeit umrechnen. Bei Mehrdeutigkeit datum = null; niemals raten.
- evidence enthält die vollständige lokale ORIGINALSTELLE zum Termin einschließlich einer eventuell direkt zugehörigen Vorankündigung.
- tageszeit ist ausschließlich einer der deutschen kanonischen Werte "morgens", "vormittags", "mittags", "nachmittags", "abends", "nachts", "ganztägig" oder null. Nur eine im lokalen Originalsatz tatsächlich benannte, konventionelle Tageszeit darf einem dieser Werte zugeordnet werden.
- Relative, vage oder offene Zeitangaben beschreiben keine feste Tageszeit. Formulierungen mit der Bedeutung "später", "irgendwann", "im Laufe des Tages", "gegen später" oder vergleichbar dürfen NICHT als morgens, vormittags, mittags, nachmittags, abends oder nachts ausgegeben werden. In solchen Fällen: tageszeit = null und system.needs_review = true. Diese Beispiele definieren eine semantische Kategorie und sind keine abschließende Wortliste.
- Jede ausdrücklich und eindeutig benannte Tageszeit muss semantisch übersetzt und erhalten bleiben, auch bei Dialekt, Fremdsprache oder gemischtem Text. Sie darf nicht wegen einer Vorankündigung oder Kontaktangabe verloren gehen.
- Für die Terminbedeutung ist immer der lokale Originalsatz maßgeblich. Eine normalisierte Arbeitsfassung ist nur eine Sprachhilfe und darf eine Tageszeit aus dem Original niemals überschreiben oder in ihr Gegenteil verkehren.
- Verbindlicher Dreischritt vor der JSON-Ausgabe: (1) die lokale Originalstelle als "klar", "vage" oder "unklar" klassifizieren; (2) zeitangabe_text in ${hauptsprache} inhaltlich originalgetreu ausgeben; (3) nur bei "klar" eine kanonische tageszeit setzen. Relative/offene Zeitangaben bleiben vage und tageszeit = null.
- Vor der JSON-Ausgabe jeden Termin intern gegen seine eigene Original-Evidence prüfen: tageszeit muss semantisch exakt zu dieser Evidence passen. Nicht über Wortähnlichkeit, Wortbestandteile, Weltwissen oder die Übersetzung raten.
- Wenn Original und Arbeitsfassung widersprechen, die Zeitformulierung relativ/vage ist oder die Tageszeit aus dem Original nicht sicher verstanden wird: tageszeit = null und system.needs_review = true. Niemals die scheinbar plausiblere Tageszeit auswählen.
- Kontaktzeiten und Ressourcenzeiten (z.B. Lift erst ab 13 Uhr) sind KEINE Ausführungstermine. Dann art = "kontaktzeit" bzw. "ressourcenzeit" und sie dürfen keinen Terminchip erzeugen.
- zugangshinweise, parkhinweise und sonstige_hinweise müssen atomar sein: pro Array-Eintrag genau eine fachliche Aussage. Schlüssel und zugehöriger Code bleiben gemeinsam; Parkplatz, Lift/Ausrüstung und sonstige Hinweise sind getrennte Einträge.
- Zugang/Schlüssel/Code jeweils als kurze einzelne Einträge in zugangshinweise.
- Jeder Zutrittsnachweis und jeder Zugangscode gehört ausschließlich in zugangshinweise: Türcode, Torcode, Code Tor, PIN, Schlüsselbox-Code, Badge-Code oder vergleichbare alphanumerische Zugangsdaten. Solche Angaben niemals zusätzlich in besonderheiten, sonstige_hinweise oder parkhinweise ausgeben.
- Beispiel: "Code Tor 1122" => zugangshinweise: ["Code Tor 1122"], sonstige_hinweise: [].
- Parkplatz/Rampe/Anlieferung jeweils als kurze einzelne Einträge in parkhinweise.
- Normale Ruhe-, Bewohner-, Kunden- oder Ablaufhinweise ausschließlich in sonstige_hinweise.
- HARTE EXKLUSIVITÄTSREGEL: Jede fachliche Aussage darf in der gesamten JSON-Ausgabe genau einmal vorkommen und genau eine Rolle besitzen. Inhalte aus gefahren, kontakt_vor_ort, termine, zugangshinweise oder parkhinweise dürfen niemals zusätzlich in sonstige_hinweise oder besonderheiten gespiegelt werden.
- Vor der Ausgabe einen abschließenden internen Rollenabgleich durchführen: Für jede Aussage genau eine Zielrolle bestimmen; Dubletten aus allen anderen Arrays entfernen, bevor JSON ausgegeben wird. Original und Übersetzung derselben Aussage sind ebenfalls nur ein Sachverhalt.
- Höflichkeits- und Ruhehinweise wie Bewohner nicht stören, leise arbeiten oder Schlafzeiten beachten sind keine Gefahren.
- SEMANTISCHE ROLLENENTSCHEIDUNG: Gefahr nur dann, wenn die Nachricht ausdrücklich einen konkreten Zustand mit plausiblem körperlichem Verletzungs-, Gesundheits- oder Sachschadenrisiko beschreibt.
- Eine Arbeitsanweisung, Schonregel, Kommunikationsregel, Zugangsregel, Reihenfolge, Frist oder Fertigstellungszeit ohne ausdrücklich beschriebenen Gefahrzustand ist sonstige_hinweise, niemals gefahren.
- Aus einem Verbot, Imperativ oder Zeitdruck keine verborgene Gefahr ableiten. Die Aussage nur nach ihrem tatsächlich beschriebenen Inhalt einordnen.
- Vor der JSON-Ausgabe jede Rollen-Aussage einmal selbst prüfen: Würde der Text auch ohne Arbeitsanweisung einen konkreten Gefahrzustand beschreiben? Nur dann gefahren; andernfalls Hinweis.
- Jede Rolleninformation muss eine konkrete lokale Evidence haben. Keine komplette Nachricht als Evidence verwenden.

3. Service erkennen:
- passende Leistung aus "leistungen"
- KEIN Service erfinden
- wenn nichts passt → null

4. einfache Kalkulation:
- estimated_quantity (nur wenn klar erkennbar)
- unit (aus Leistung übernehmen)
- unit_price (aus Leistung übernehmen)

--------------------------------------------------
MATCHING-REGELN (STRENG – SICHERHEIT VOR FALSCHEM ABGLEICH)
--------------------------------------------------

ABSOLUT VERBOTEN:
- NIEMALS "gleicher_kunde" NUR aufgrund von Name setzen!
- NIEMALS bei Teilnamen (z.B. nur Vorname oder Nachname) als gleicher_kunde werten!
- NIEMALS bei ähnlichem/gleichem Namen OHNE mindestens ein starkes Signal!

STARKE SIGNALE (mindestens eines MUSS für "gleicher_kunde" vorhanden sein):
- Gleiche Telefonnummer
- Gleiche E-Mail-Adresse
- Gleiche Straße + Hausnummer + (PLZ oder Ort)
- Gleiche vollständige Adresse

SCHWACHE SIGNALE (reichen ALLEIN NICHT für "gleicher_kunde"):
- Gleicher/ähnlicher Name → NUR "moeglicher_treffer"
- Nur Nachname gleich → NUR "moeglicher_treffer"
- Nur Vorname gleich → NUR "moeglicher_treffer"
- Nur Ort gleich → NUR "moeglicher_treffer"
- Nur PLZ gleich → NUR "moeglicher_treffer"
- Teilname enthalten → NUR "moeglicher_treffer"

NAME-VARIANTEN:
- Schreibvarianten erkennen (ss=ß, Str.=Strasse=Straße, Reihenfolge egal)
- ABER Name allein = schwaches Signal!

ADRESSE:
- Straße + Hausnummer + PLZ/Ort → stark (zusammen mit Name = gleicher_kunde erlaubt)
- Straße ohne Nummer → mittel
- nur Ort → schwach

ENTSCHEIDUNGSLOGIK:
- Name + starkes Signal → "gleicher_kunde"
- Name allein (auch exakt) → "moeglicher_treffer" (NIEMALS gleicher_kunde!)
- Teilname/ähnlicher Name → "moeglicher_treffer"
- Kein relevanter Treffer → "kein_treffer"
- Widersprüchliche Daten → "konflikt"

--------------------------------------------------
STATUS
--------------------------------------------------

"gleicher_kunde" → NUR bei Name + mindestens einem starken Signal!
"moeglicher_treffer" → Bei Name-Ähnlichkeit OHNE starkes Signal
"konflikt" → Bei widersprüchlichen Daten
"kein_treffer" → Kein relevanter Treffer

--------------------------------------------------
SEMANTIC INTAKE ENGINE V12 – WICHTIG
--------------------------------------------------

Du liest IMMER den gesamten Kundentext als Bedeutung, nicht als Wortliste.
Du sollst wie ein vorsichtiger Sachbearbeiter entscheiden:

- Wer bekommt die Rechnung?
- Wo wird tatsächlich gearbeitet?
- Welche konkrete Arbeit wird gemacht?
- Was ist nur Ort/Kontext?
- Welche Menge gehört zu welcher Arbeit?
- Welcher Preis gehört zu welcher Arbeit?
- Welche Währung gehört zu welcher Arbeit?
- Was ist unsicher?

ABSOLUTE SICHERHEITSREGEL:
Wenn ein Wert nicht eindeutig aus dem Kundentext belegbar ist, setze ihn auf null.
Nicht raten. Nicht aus anderen Leistungen übernehmen. Nicht aus vorhandenen Kunden übernehmen.
Lieber leer lassen und prüfen lassen als falsch speichern.

FÜR JEDE ARBEITSPOSITION MUSST DU TRENNEN:
- action_name: die echte Arbeit, z.B. "Fenster reinigen", "Treppenhaus reinigen", "Garagenreinigung"
- context: Ort/Teilbereich, z.B. "EG", "Treppenhaus", "Keller", "Garage Haus Nord"
- service_id / service_name: nur dann aus der Liste "leistungen", wenn die Arbeit fachlich eindeutig passt.
  Wenn nicht eindeutig: service_id = null, service_name = null, confidence = "niedrig".

LEISTUNGSNAMEN / SICHTBARE ARBEITEN:
- Alle sichtbaren Leistungsnamen und action_name-Werte IMMER auf ${hauptsprache} zurückgeben.
- Nicht einfach Originalwörter abschreiben, wenn der Kundentext fremdsprachig, mundartlich oder unprofessionell formuliert ist.
- Erkenne die Bedeutung semantisch und formuliere daraus einen kurzen professionellen deutschen Leistungsnamen.
- Bei handwerklichen Neben-/Vorbereitungsleistungen die Form "...arbeiten" bevorzugen, wenn fachlich passend.
  Beispiele: "spachteln" / "Spachtel" / sinngleiche Formulierungen → "Spachtelarbeiten"; "abdecken" / Schutz abdecken → "Abdeckarbeiten"; "schleifen" → "Schleifarbeiten"; "vorbereiten" → "Vorbereitungsarbeiten".
- Bei bekannten Standardarbeiten kurze deutsche Fachnamen verwenden: "Nettoyer le sol" → "Boden reinigen", "Déplacement" → "Anfahrt", "Nettoyage des vitres"/"Nettoyage des vitrines" → "Fenster reinigen".
- Der Originaltext gehört nur in raw/evidence/sourceText, nicht als sichtbarer Leistungsname.
- Termin-, Kontakt-, Zugangs-, Adress- und Hinweis-Sätze dürfen NIEMALS in service_name/name/action_name stehen. Beispiele für verbotene sichtbare Leistungsnamen: "Bitte morgen Vormittag Boden reinigen", "vorher WhatsApp schreiben", "Torcode danach rechts", "Menge: ...", "pro m²". Wenn nur so ein Satz als Name möglich wäre: service_name/name/action_name = null und confidence = "niedrig".
- Leistungsnamen müssen aus der konkreten Preis-/Mengen-Leistungszeile entstehen. Gesamtbeschreibung, Terminwunsch und Hinweise bleiben nur in raw/evidence/sourceText beziehungsweise ihrer passenden strukturierten Rolle.
- Kundenname, Firmenname, separat angegebener Ausführungsort, Gebäude-/Objektname und Adresse sind eigenständige Entitäten. Kopiere oder ergänze sie NIEMALS automatisch in service_name/name/action_name.
- Ein Raum-/Bereichsbezug darf nur dann Teil des Leistungsnamens sein, wenn genau die eigene evidence/sourceText-Zeile diesen Bereich als Ort der konkreten Arbeit nennt. Ein separat im Adressblock genannter Objektname ist keine line-lokale Leistungsevidence.
- Beispielprinzip ohne feste Fachwortliste: Steht in der Leistungszeile nur „Boden reinigen, 38 Quadratmeter …“ und an anderer Stelle ein Objektname, lautet die Leistung „Boden reinigen“ und nicht „Boden [Objektname] reinigen“. Wenn du diese Trennung nicht sicher beherrschst, setze name/action_name auf null und confidence = „niedrig“.
- Arbeitsobjekt und Ort/Kontext dürfen nicht vertauscht werden. Wenn der Text z.B. Fenster, Tische, Vitrinen, Geländer oder Haken IN einem Raum/Bereich nennt, bleibt dieses Objekt Teil des sichtbaren Leistungsnamens. Der Name darf nicht zu einem allgemeinen Bereich verflachen.
- Beispiele semantisch: "Fenêtres couloir intérieur" = Fenster im Gang innen reinigen, nicht Gangbereich reinigen. "Tische im Sitzungszimmer reinigen" = Tische im Sitzungszimmer reinigen, nicht Besprechungsbereich reinigen.

WICHTIG:
Ein Ort oder Kontext ist nicht automatisch die Leistung.
Wenn eine Formulierung sagt, dass etwas IN einem Bereich gemacht wird, muss die Handlung die Leistung bestimmen.
Die Leistung darf nur übernommen werden, wenn die evidence genau diese Handlung belegt.

KONTEXT + ARBEITSOBJEKT IN EINER PREISZEILE:
- Eine kurze Preiszeile kann Ort/Teilbereich + Arbeitsobjekt + Menge/Preis enthalten.
- Wenn eine einzige Zeile nur EINE Menge, EINEN Preis und EINE Währung enthält, darf daraus grundsätzlich nur EINE Arbeitsposition entstehen.
- Der Orts-/Bereichsteil gehört dann in context; die eigentliche bearbeitete Sache/Tätigkeit gehört in action_name/name.
- Erzeuge NICHT zusätzlich eine zweite Leistung nur aus dem Orts-/Bereichsteil.
- Beispiele semantisch, nicht als Wortliste:
  - "Lagerraum Boden 42 à CHF 7" = eine Position; context = "Lagerraum", Arbeit = Boden/Fläche reinigen, Einheit unsicher wenn nicht genannt.
  - "Garage floor 80 sqm at EUR 5" = eine Position; context = Garage, Arbeit = Boden reinigen.
  - "Cave sol 30 m2 à CHF 6" = eine Position; context = Cave/Keller, Arbeit = Boden reinigen.
- Wenn zwei mögliche Positionen dieselbe evidence/raw-Zeile, dieselbe Menge, denselben Preis und dieselbe Währung hätten, ist das ein Split-Fehler: behalte nur die eine fachlich konkrete Arbeitsposition und verschiebe den Rest in context.

EVIDENCE-PFLICHT:
Jedes automatisch gesetzte Feld braucht eine konkrete evidence aus dem Originaltext.
Das gilt besonders für:
- kunde.name
- kunde.strasse / plz / ort
- ausfuehrungsadresse
- jede Arbeitsposition
- menge
- einheit
- unit_price
- currency

--------------------------------------------------
KI-VORSORTIERUNG – SEHR WICHTIG
--------------------------------------------------
Du bist die erste und wichtigste Sortierschicht. Der nachgelagerte Code verlässt
sich auf deine strukturierten Felder und validiert nur noch Plausibilität.

V17.09 STRUKTURVERTRAG:
- Du musst pro Arbeitsposition selbst entscheiden, welche Menge, Einheit, Einzelpreis
  und Währung wirklich zu genau dieser Position gehören.
- Der Code nach dir darf fehlende Werte nicht mehr still aus dem Katalog auffüllen.
- Wenn Menge fehlt oder unsicher ist: menge = null.
- Wenn Einheit fehlt oder unsicher ist: einheit = null.
- Wenn Einzelpreis fehlt oder unsicher ist: unit_price = null.
- Wenn Währung fehlt oder unsicher ist: currency = null.
- Wenn eine Zeile nur Menge + Preis enthält, aber keine Einheit, z. B.
  "Boden im Lager reinigen 42 à CHF 7", dann ist einheit = null.
  Du darfst NICHT aus dem Leistungskatalog "Stunde", "m2" oder "Stück" einsetzen.
- Wenn CHF und EUR oder andere Währungen gemischt vorkommen, ordne jede Währung
  nur der exakt belegten Position zu und setze unsichere Positionswährungen auf null.
- Wenn eine Position dadurch nicht vollständig abrechenbar ist, setze confidence = "niedrig"
  und schreibe in raw/evidence trotzdem die Originalzeile, damit der Validator rot prüfen kann.
- Kein Preis, keine Menge und keine Einheit dürfen von einer anderen Zeile oder
  einer anderen Leistung übernommen werden.

- Jede klar bepreiste Arbeits-/Kostenzeile muss als eigene arbeitsposition erscheinen.
  Das gilt auch für semantische Fahrt-, Reise-, Transport- oder Wegkosten: Wenn die Zeile genau eine Pauschalkosten-Angabe enthält, setze action_name/service_name sinngemäß auf "Anfahrt", einheit="Pauschal", menge=1.
  Wenn keine Währung in dieser Kostenzeile steht, aber der übrige Auftrag eindeutig in einer Währung geschrieben ist, darf diese Auftragswährung verwendet werden.
  Wenn eine andere Währung ausdrücklich in derselben Zeile steht, bleibt genau diese Positionswährung erhalten und wird nicht umgerechnet.
- Mehrsprachige Positionszeilen wie "Window inside 4 pcs at CHF 9" müssen line-local gelesen werden:
  Objekt/Tätigkeit, Menge, Einheit, Preis und Währung gehören aus genau dieser Zeile zusammen. "at CHF 9" ist ein Preisanker wie "à/je CHF 9", kein Hinweistext.

POSITIONSTYP – PFLICHTFELD PRO ARBEITSPOSITION:
- Setze bei jeder arbeitsposition position_type semantisch. Nicht pauschal "service" verwenden.
- "service" = echte Arbeitsleistung/Tätigkeit, z. B. reinigen, montieren, demontieren, streichen, schneiden, prüfen, warten.
- "material" = Verbrauchsmaterial, Produkt, Reiniger, Chemie, Ersatzteil, Farbe, Zement, Sackware oder sonstiges Material, das als Position verrechnet wird.
  Bei Material darf action_name/service_name nur das Material/Produkt selbst nennen; ergänze keine Tätigkeit wie bereitstellen, verwenden oder liefern, wenn diese nicht exakt in derselben Originalzeile steht.
- "equipment" = Gerät, Maschine, Werkzeug, Maschineneinsatz oder Gerätemiete, die als Position verrechnet wird.
- "expense" = Zusatzkosten, Anfahrt, Fahrt-/Wegkosten, Gebühren, Parkgebühren, Entsorgungskosten, Deponie, Schmutzwasser-/Abfallentsorgung oder sonstige Nebenkosten.
- Wenn eine Zusatzkosten-/Entsorgungs-/Anfahrtszeile nur einen Gesamtbetrag enthält, setze menge=1 und einheit="Pauschal". Beispiel: "Entsorgungskosten CHF 25" -> position_type="expense", menge=1, einheit="Pauschal", unit_price=25.
- Wenn der Typ trotz eigener Evidence nicht sicher bestimmbar ist, setze confidence="niedrig" und position_type="service" nur als Platzhalter; die Position muss dadurch prüfpflichtig bleiben.
- Nachträgliche Validatoren dürfen position_type nicht neu raten; deshalb muss diese erste KI-Ausgabe vollständig und line-local sein.

Sortiere nach Bedeutung, nicht nach einzelnen Signalwörtern:
- Wer/was bezahlt oder bekommt die Rechnung? → kunde
- Wo wird die Arbeit tatsächlich ausgeführt? → auftrag.ausfuehrungsadresse
- Welche einzelnen Arbeiten werden gemacht? → auftrag.arbeitspositionen
- Was ist nur Hinweis/Kommunikation/Termin/Zugang? → ausschließlich die passende strukturierte Rolle; übrige Hinweise → sonstige_hinweise

Wenn ein Wert nicht sicher ist: null setzen. Nicht raten.
Labels, Einleitungen, Arbeitsanweisungen, Kommunikationswünsche, Termine und
Satzreste dürfen niemals als kunde.name gespeichert werden. Ein Kundenname ist
nur ein echter Personenname oder ein echter Firmenname aus dem Originaltext.

Arbeitspositionen dürfen keine zusammengesetzten Satzreste sein.
Wenn konkrete Einzelpositionen mit Preis/Menge vorhanden sind, bilde nur diese
Einzelpositionen und keine zusätzliche Sammelposition aus dem Satz davor.
Beispiel: Aus einer Nachricht mit Wände streichen, Abdeckarbeiten und Anfahrt
müssen drei getrennte Positionen entstehen, nicht eine Sammelposition.
service/action_name muss die vollständige Tätigkeit enthalten; bei Kabelkanal
montieren darf action_name nicht nur "montieren" sein.

--------------------------------------------------
ADRESS-SORTIERUNG – AI-FIRST
--------------------------------------------------
kunde ist ausschließlich der Rechnungskunde / Rechnungsempfänger / Zahlende.
auftrag.ausfuehrungsadresse ist ausschließlich der Ort, an dem gearbeitet wird.

Regeln:
- Wenn Rechnungskunde ohne Namen, aber mit Straße/PLZ/Ort/E-Mail genannt ist:
  kunde.name = null, Adresse/Kontaktfelder übernehmen, system.needs_review = true.
- Wenn nur ein Arbeitsort genannt ist und kein Rechnungskunde erkennbar ist:
  kunde komplett leer lassen und nur auftrag.ausfuehrungsadresse setzen.
- Wenn Rechnungsadresse und Arbeitsort gleich sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = false.
- Eine gemeinsame Überschrift wie „Rechnungs- und Ausführungsadresse“, „Rechnungs-/Ausführungsadresse“ oder sinngleich bezeichnet genau EINEN gemeinsamen Adressblock. Schreibe Name/Firma, Straße, PLZ und Ort vollständig in kunde und setze auftrag.ausfuehrungsadresse.ist_abweichend = false. Behandle diesen Block niemals nur als Ausführungsadresse und erzeuge dafür keine Ausführungsadress-Prüfung.
- Wenn Rechnungsadresse und Arbeitsort unterschiedlich sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = true und vollständige Arbeitsadresse setzen.
- Wenn ein Text getrennte Blöcke für Rechnung/Kunde und Arbeitsort/Baustelle/Work Site/Job Site enthält, ist die Rollenverteilung klar:
  Rechnungsblock -> kunde; Arbeitsortblock -> auftrag.ausfuehrungsadresse.
  Dann KEINE Adressrollenprüfung erzwingen, solange beide Adressen vollständig und widerspruchsfrei sind.
- Wenn nur ein vollständiger Adressblock mit Name/Firma, Strasse, PLZ und Ort vorhanden ist und kein separater Arbeitsort genannt wird, ist das die Rechnungs-/Kundenadresse. Keine Adresse-prüfen-Warnung nötig.

- Bei auftrag.ausfuehrungsadresse.strasse nur den Straßennamen setzen und die Hausnummer separat in hausnummer setzen.
  Wenn du Straße und Hausnummer nicht sicher trennen kannst, schreibe beides vollständig in strasse.
- Wenn unklar ist, welche Adresse welche Rolle hat:
  keine Adresse in kunde schreiben; nur sichere Arbeitsadresse setzen oder alles leer lassen.
- Straße, PLZ und Ort dürfen nur aus echten Adressteilen bestehen, nicht aus
  Arbeitsanweisungen, Terminen oder Leistungstext.

CONFIDENCE:
- "hoch": eindeutig im Text belegt und keine Widersprüche.
- "mittel": wahrscheinlich, aber noch prüfbedürftig.
- "niedrig": unsicher. Werte bei niedrig möglichst null lassen.

--------------------------------------------------
FAIL-CLOSED-SICHERHEIT – KEINE WORTLISTEN-LOGIK
--------------------------------------------------
- Du musst die Rollen selbst semantisch erkennen.
- Der Code nach dir soll keine mehrsprachigen Rechnungs-/Arbeitsort-Wortlisten als Hauptlogik verwenden.
- Deshalb ist deine Strukturierung entscheidend:
  kunde = nur Rechnungskunde/Rechnungsadresse.
  auftrag.ausfuehrungsadresse = nur Arbeitsort/Baustelle/Objekt.
  kontakt vor Ort = nur Hinweis/Besonderheit, niemals Rechnungskunde.
- kunde.confidence MUSS "hoch", "mittel" oder "niedrig" sein.
- kunde.evidence MUSS die exakte Original-Textstelle enthalten, aus der die Kundendaten stammen.
- Wenn du keine exakte evidence hast: alle unsicheren kunde-Felder null lassen und kunde.confidence = "niedrig".
- Wenn nur eine namenlose Rechnungsadresse sicher vorhanden ist:
  kunde.name = null,
  Adresse/E-Mail setzen,
  kunde.confidence = "mittel" oder "hoch",
  kunde.evidence = exakter Rechnungsadressblock,
  system.needs_review = true.
- Wenn eine Adresse wahrscheinlich nur Arbeitsort ist:
  NICHT in kunde schreiben.
- Wenn du unsicher bist, welche Rolle eine Adresse hat:
  lieber kunde leer lassen und system.needs_review = true.

--------------------------------------------------
AUSGABEFORMAT
--------------------------------------------------

{
  "kunde": {
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null,
    "telefon": null,
    "email": null,
    "confidence": "niedrig",
    "evidence": null
  },
"auftrag": {
  "titel": null,
  "beschreibung": null,
  "gefahren": [],
  "besonderheiten": [],
  "kontakt_vor_ort": {
    "vorhanden": false,
    "name": null,
    "telefon": null,
    "kanal": null,
    "nicht_anrufen": false,
    "evidence": null
  },
  "termine": [],
  "zugangshinweise": [],
  "parkhinweise": [],
  "sonstige_hinweise": [],
  "ausfuehrungsadresse": {
    "ist_abweichend": false,
    "name": null,
    "strasse": null,
    "hausnummer": null,
    "plz": null,
    "ort": null,
    "confidence": "niedrig",
    "evidence": null
  },
  "arbeitspositionen": []
},
  "service": {
    "service_id": null,
    "service_name": null,
    "estimated_quantity": null,
    "unit": null,
    "unit_price": null
  },
  "kundenabgleich": {
    "status": null,
    "bestehende_kunden_id": null,
    "reuse_requested": false,
    "reuse_evidence": null,
    "confidence": 0,
    "unterschiede": [],
    "warnung": ""
  },
  "system": {
    "needs_review": false,
    "prioritaet": "normal"
  }
}

--------------------------------------------------
REGELN
--------------------------------------------------

1. KEINE DATEN ERFINDEN / KEIN ABSCHREIBEN VON BESTEHENDEN KUNDEN
- Felder unter "kunde" (name, strasse, hausnummer, plz, ort) dürfen AUSSCHLIESSLICH
  aus dem Nachrichtentext / Audio-Transkript / Bildinhalt stammen.
- NIEMALS Felder aus der Liste "bestehende_kunden" nach "kunde" kopieren.
- Wenn ein Feld nicht in der eingehenden Nachricht vorkommt → null setzen, nicht raten.
- PLZ nur setzen wenn im Text vorhanden; keine Rückschlüsse aus Ort.

2. E-Mail komplett ignorieren (KEINE Warnung, KEIN needs_review)

3. Telefonnummer:
- NICHT für Matching verwenden
- ABER wenn Telefon im Text vorhanden UND bestehender Kunde hat andere Telefonnummer:
  → status = "moeglicher_treffer"
  → needs_review = true
  → warnung = "Telefonnummer weicht ab – bitte prüfen"
- Wenn Telefon fehlt: komplett ignorieren

4. Service-Matching:
- nur beste Übereinstimmung wählen
- wenn unsicher → service = null

5. estimated_quantity:
- nur wenn Zahl UND Einheit eindeutig zur hinterlegten Leistungseinheit passen
- Stundenleistungen: NUR Mengen aus "Stunde", "Stunden", "Std", "h" übernehmen
- Tagesleistungen: NUR Mengen aus "Tag", "Tage", "Arbeitstag", "Arbeitstage" übernehmen
- Meterleistungen: NUR Mengen aus "Meter", "m", "Laufmeter", "lfm" übernehmen
- Quadratmeterleistungen: NUR Mengen aus "Quadratmeter", "m²", "m2", "qm" übernehmen
- Kubikmeterleistungen: NUR Mengen aus "Kubikmeter", "m³", "m3", "cbm" übernehmen
- Stückleistungen: NUR Mengen aus "Stück", "stk", "Anzahl", "Einheiten" übernehmen
- Kilogrammleistungen: NUR Mengen aus "Kilogramm", "kg" übernehmen
- Tonnenleistungen: NUR Mengen aus "Tonne", "Tonnen", "t" übernehmen
- Literleistungen: NUR Mengen aus "Liter", "l" übernehmen
- Pauschalleistungen: estimated_quantity immer null oder 1
- Fläche / m² / qm NIEMALS als Stunden-, Tages-, Meter-, Stück- oder Pauschalmenge übernehmen
- Meter / Laufmeter NIEMALS als Stunden-, Tages-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Stunden / Tage NIEMALS als Meter-, Quadratmeter-, Kubikmeter-, Stück-, Liter-, Kilo-, Tonnen- oder Pauschalmenge übernehmen
- Gewicht / kg / Tonnen NIEMALS als Stunden-, Meter-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Volumen / Liter / Kubikmeter NIEMALS als Stunden-, Meter-, Quadratmeter-, Stück- oder Pauschalmenge übernehmen
- Wenn Zahl und Einheit nicht zur Leistungseinheit passen → estimated_quantity = null und needs_review = true
- Mengenbereiche oder Näherungen wie "10 bis 12 Stück", "10–12", "ca. 10 bis 12" oder sprachgleiche Varianten sind niemals eine bestätigte Menge: estimated_quantity = null und needs_review = true. Niemals automatisch Unter- oder Obergrenze wählen.
- wenn unsicher → estimated_quantity = null
- sonst null

6. needs_review = true bei:
- moeglicher_treffer
- konflikt
- fehlende Adresse
- kein Service erkannt
- Telefonnummer weicht ab (siehe Regel 3)

7. WARNLOGIK:
moeglicher_treffer → "Möglicher Kundentreffer – bitte prüfen"
konflikt → "Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich"
Telefon abweichend → "Telefonnummer weicht ab – bitte prüfen"
sonst → ""

8. confidence:
- gleicher_kunde → 0.9–1.0
- moeglicher_treffer → 0.5–0.8
- konflikt → 0.2–0.5
- kein_treffer → 0–0.3

9. PRIORITÄT:
- "hoch" bei Wörtern wie: "dringend", "sofort", "heute"
- sonst "normal"

9a. GEFAHREN / BESONDERHEITEN:
- auftrag.gefahren enthält NUR echte Sicherheitsrisiken oder Warnhinweise.
- auftrag.besonderheiten bleibt immer ein leeres Array [].
- Gefahren semantisch erkennen: Es geht um Bedeutung und Arbeitsrisiko, nicht um feste Wörter.
- Auch wenn der Kunde in Englisch, Französisch, Spanisch, Italienisch, Portugiesisch, Schweizerdeutsch oder gemischt schreibt, müssen gefahren und alle strukturierten Hinweisrollen auf ${hauptsprache} ausgegeben werden.
- Beispiele für gefahren: offene Stromkabel, Rutschgefahr, Öl auf Boden, Schimmel/Asbest/Chemikalien, Absturzgefahr, instabiler Untergrund, Glasscherben, Brand-/Feuergefahr.
- PRODUKTREGEL HUND: Sobald ein Hund erwähnt wird, genau EINEN Eintrag in gefahren ausgeben, damit der rote Hund-Chip erscheint. Den tatsächlichen Inhalt originalgetreu und neutral auf ${hauptsprache} wiedergeben, z.B. "Hund ist angeleint", "Hund läuft frei", "Hund hinter Gitter". Niemals Verhalten oder Gefährlichkeit erfinden, verschärfen oder abschwächen. Aus "angeleint" darf niemals "frei oder ungesichert" werden.
- Organisatorische Hinweise ausschließlich strukturiert ausgeben: Rückruf in kontakt_vor_ort/termine, Zugang und Schlüssel in zugangshinweise, Parken und Zufahrt in parkhinweise, übrige Ablaufhinweise in sonstige_hinweise. besonderheiten bleibt immer [].
- Kommunikationshinweise immer nach Absicht ausgeben, nicht nur zusammenfassen: Kanal verboten / bevorzugt / erlaubt plus Kontaktzeit. Ein verbotener Kanal darf nie als bevorzugter Kanal erscheinen.
- Verneinungen müssen am richtigen Bezug hängen: "nicht einfach kommen" / "nicht eintreten" / "nicht ohne Rücksprache" sind Zugangs-/Ablaufhinweise und dürfen niemals als WhatsApp-/SMS-Verbot interpretiert werden, wenn WhatsApp/SMS in derselben Zeile positiv genannt ist.
- Kontaktzeiten für Mail/SMS/WhatsApp/Telefon sind keine Ausführungstermine und dürfen keinen Terminchip erzeugen.
- Reine Arbeits-, Ablauf- oder Schonhinweise ohne eigenes körperliches Sicherheitsrisiko gehören ausschließlich in sonstige_hinweise, nicht in gefahren. Die Rolle nach Bedeutung bestimmen, nicht anhand einzelner Wörter.
- Ein Verbot oder eine Handlungsanweisung ist für sich allein kein Gefahrzustand. Nur wenn die Nachricht zusätzlich den konkreten gefährlichen Zustand ausdrücklich beschreibt, gehört die Aussage in gefahren.
- Reine Schutz- oder Betriebsanweisungen für Geräte, Maschinen, Mobiliar, Dokumente oder Materialien bleiben normale Hinweise, solange kein konkreter gefährlicher Zustand ausdrücklich genannt ist. Die gewünschte Handlung darf nicht als versteckte Gefahr interpretiert werden.
- Eine Fertigstellungszeit, Öffnungszeit, Reihenfolge oder Priorität ist Termin/Ablaufhinweis und niemals allein eine Gefahr.
- Vor Ausgabe einen stillen Rollen-Selbstcheck durchführen und jede nicht eindeutig gefährliche Aussage aus gefahren in sonstige_hinweise einordnen. Textinhalt dabei nicht umformulieren.
- Ausführungsadresse strikt strukturiert ausgeben: Objekt-/Bereichsname ohne Satzanfang wie "Arbeiten müssen im"; Straße nur Straße/Hausnummer; Ort nur Ortsname. Keine Satzreste wie "ausgeführt werden" an Objekt oder Ort anhängen.
- Rückruf nur bei echter telefonischer Kontaktaufnahme ausgeben. "Klingeln und warten", "an der Tür melden", "Kunde ist vor Ort", "Schlüssel wird an der Tür übergeben" oder "nicht anrufen" sind KEIN Rückruf.
- Positive Arbeitserleichterungen nur in ihrer strukturierten Rolle aufnehmen, wenn sie wirklich planungsrelevant sind: Parkplatz reserviert/vorhanden in parkhinweise, Schlüssel liegt bereit in zugangshinweise. Rein neutrale Hinweise wie "Zugang frei", "Tür offen", "Parkplatz kein Thema" oder "direkt halten möglich" nicht als wichtigen Außen-Hinweis erzwingen.
- Wichtig: "Leiter benötigt" allein ist sonstige_hinweise, NICHT gefahr. "Leiter eventuell benötigt" ist nur Innen-Hinweis und darf keinen festen Außen-Chip erzwingen.
- Wichtig: Jede tatsächlich erwähnte Hundaussage kommt genau einmal in gefahren, ausschließlich wegen des roten Hund-Chips. Inhalt und Zustand des Hundes originalgetreu wiedergeben; niemals bewerten oder umdeuten.
- Wichtig: "Öl auf dem Boden", "rutschiger Boden", "offene Kabel", "freilaufender Hund", "Asbestverdacht", "Schimmel", "Chemikalien" sind gefahren, auch wenn sie in anderer Sprache beschrieben werden.
- Verneinte/nicht relevante Hinweise NICHT ausgeben: kein Hund, kein Öl, keine Scherben, keine Leiter nötig, Termin flexibel, Parkplatz kein Thema, kein Anruf / nicht anrufen.
- TERMINE: Jeder Termin-Eintrag enthält zusätzlich zeitangabe_text und zeitangabe_status. zeitangabe_text ist die kurze, inhaltlich originalgetreue Termin-/Zeitformulierung in ${hauptsprache}; evidence bleibt die exakte Originalstelle. Relative/offene Aussagen wie "später am Tag" bleiben inhaltlich unverändert und dürfen niemals zu "nachmittags" oder einer anderen Tageszeit umgedeutet werden. Bei "vage" oder "unklar" gilt tageszeit = null. Eindeutige relative Wochentage werden anhand der Referenzzeit in datum umgerechnet; bei Unsicherheit datum = null.
- Keine Doppelung: Eine Information darf genau einmal und nur in ihrer fachlich richtigen strukturierten Rolle stehen. Zugangscodes/PINs ausschließlich in zugangshinweise, Parkinformationen ausschließlich in parkhinweise, sonstige Ablaufhinweise ausschließlich in sonstige_hinweise. Kontakt und Vorankündigung ausschließlich in kontakt_vor_ort beziehungsweise termine. besonderheiten bleibt immer []. Originaltext und automatische Übersetzung derselben Aussage sind ein einziger Sachverhalt; gib nur die saubere ${hauptsprache}-Fassung aus.
- Jede Rollen-Aussage muss ihren Inhalt erhalten. Nicht umformulieren, verschärfen, abschwächen oder mit einer anderen Aussage zusammenführen.
- Keine Leistung als Gefahr/Besonderheit ausgeben.
- Keine Gefahren oder Besonderheiten in beschreibung schreiben. Dort nur die Arbeit selbst.

10. NUR-BILD-NACHRICHTEN (WICHTIG):
Wenn KEIN Text und KEINE Sprachnachricht vorhanden ist (nur Bild(er)):
- beschreibung: NUR beschreiben, was auf dem Bild SICHTBAR ist
- NICHT den gewünschten Auftrag erraten oder erfinden
- NICHT schreiben: "soll geschnitten werden", "muss gepflegt werden", "gewünscht"
- STATTDESSEN vorsichtig formulieren:
  - "Das Bild zeigt eine Hecke entlang der Straße und eine Rasenfläche davor."
  - "Genauer Auftrag ist ohne zusätzlichen Text nicht eindeutig erkennbar."
  - "Sichtbar: Hecke, Rasen, Baumbestand."
- titel: beschreibend, NICHT handlungsorientiert (z.B. "Hecke / Garten" statt "Hecke schneiden")
- needs_review = true (immer bei Nur-Bild ohne Text)

11. ARBEITSPOSITIONEN:
- Extrahiere jede einzelne Arbeit als eigenen Eintrag in auftrag.arbeitspositionen.
- Jede Position enthält:
  {
    "name": "kurze Arbeitsbeschreibung",
    "action_name": "eigentliche Tätigkeit ohne Orts-/Kontextwörter oder null",
    "context": "Ort/Teilbereich dieser Arbeit oder null",
    "service_id": "id aus leistungen oder null",
    "service_name": "exakter Name aus leistungen oder null",
    "service_confidence": "hoch" | "mittel" | "niedrig",
    "position_type": "service" | "material" | "equipment" | "expense",
    "menge": Zahl oder null,
    "einheit": "Quadratmeter" | "Kubikmeter" | "Meter" | "Stunde" | "Tag" | "Tonne" | "Kilogramm" | "Liter" | "Stück" | "Pauschal" | null,
    "unit_price": Zahl oder null,
    "currency": "CHF" | "EUR" | "USD" | "GBP" | andere erkannte Währung oder null,
    "raw": "Originalteil aus der Nachricht",
    "evidence": "exakte Textstelle, aus der Menge, Einheit, Preis und Währung dieser Position stammen",
    "confidence": "hoch" | "mittel" | "niedrig"
  }
- Jede Leistung braucht ihre eigene evidence/sourceText.
- Preis, Menge, Einheit und Währung dürfen NUR gesetzt werden, wenn sie in der evidence derselben Position stehen.
- Jede Arbeitsposition muss eine echte fachliche Tätigkeit oder Kostenposition sein. Reine Preis-/Rechenfragmente wie "à 6.50", "je 8.-", "mal 9", "CHF 35", "pro m2" sind NIEMALS eigene arbeitspositionen.
- service_name/name immer als sauberen deutschen Leistungsnamen ausgeben. Mundart, Französisch, Englisch oder Rohformulierungen nicht sichtbar speichern.
- Jeder sichtbare Leistungsname muss die eigentliche Tätigkeit enthalten. Reine Objekt-/Bereichsbezeichnungen wie „Fenster innen“ oder „Tische im Gemeinschaftsraum“ sind unvollständig; formuliere z. B. „Fenster innen reinigen“ bzw. „Tische im Gemeinschaftsraum reinigen“.
- Entferne Mengen, Einheiten, Preise und führende Verbindungswörter wie „und“ aus service_name/name. Diese Informationen gehören ausschließlich in die strukturierten Felder und die Evidence.
- Schreibe sichtbare Leistungsnamen orthografisch korrektes Standarddeutsch; übernimm keine Dialekt-Schreibfehler in den Leistungsnamen.
- Wenn die Kundenzeile in Mundart, Französisch, Englisch, Italienisch, Spanisch oder gemischt formuliert ist, übersetze die Bedeutung zuerst semantisch in professionelles Deutsch und speichere nur diese deutsche Form als name/action_name. Der Originalwortlaut bleibt ausschließlich in raw/evidence/sourceText.
- Fail-closed-Regel: Wenn du keinen kurzen professionellen deutschen Leistungsnamen aus genau derselben Mengen-/Preis-Zeile bilden kannst, lasse service_name/name/action_name leer/null. Speichere niemals einen ganzen Kundensatz, Terminwunsch, Zugangshinweis, Kommunikationshinweis oder Feldlabel als sichtbare Leistung.
- Sichtbare Leistungsnamen müssen eine echte Tätigkeit oder Kostenposition ausdrücken. Wenn eine Preiszeile nur Bereich + Objekt + Menge + Preis enthält, formuliere daraus eine einzige deutsche Leistung mit Objekt und Bereich, z. B. sinngemäß "Boden Gemeinschaftsraum reinigen" statt Rohsprache oder zwei Split-Positionen.
- Wenn du eine fremdsprachige/mundartliche Leistung nicht sicher auf Deutsch formulieren kannst, setze name/action_name lieber auf null und confidence = "niedrig", statt die Rohform sichtbar zu speichern.
- Zustand, Verschmutzungsgrad und Rechenwörter gehören nicht in den Leistungsnamen: "sehr dreckig", "stark verschmutzt", "mal", "je", "à", "pro" in sonstige_hinweise/evidence lassen, aber aus name/action_name entfernen.
- Strukturwörter aus einer Arbeitsfassung wie "Fläche:", "Anzahl:", "Menge:", "Preis:" oder "Einheit:" sind Feldlabels für Menge/Einheit/Preis und dürfen niemals Teil von service_name/name/action_name werden.
- Eine Kundenzeile mit Objekt + Menge + Preis ergibt genau eine Position. Nicht zusätzlich den Preisanker oder einen Teil der Zeile als zweite Position ausgeben.

- Preis aus einer anderen Zeile/anderen Leistung NIEMALS übernehmen.
- Pauschalpreise dürfen NIEMALS auf andere Positionen kopiert werden. Wenn eine Zeile "Eingangsbereich pauschal 120" sagt, gilt 120 nur für diese eine Position.
- Klare Gesamt-/Pauschalpreise strukturell korrekt ausgeben: Wenn eine Leistung ausdrücklich als Gesamtpreis, Pauschalpreis, Fixpreis, forfait total, total price oder gleichbedeutend für die gesamte Arbeit genannt wird und keine Pro-/Je-/Per-Angabe widerspricht, dann menge = 1, einheit = "Pauschal", unit_price = der Gesamtbetrag. Eine im Leistungstext genannte Anzahl von Räumen, Etagen, Objekten oder Bereichen beschreibt dann nur den Leistungsumfang und darf nicht mit dem Gesamtpreis multipliziert werden.
- Preiswidersprüche nie still entscheiden: Wenn für dieselbe Leistung sowohl ein Gesamtbetrag als auch ein abweichender Preis pro/je/per Einheit genannt wird, behalte eine ausdrücklich genannte Menge und ihre passende Einheit, setze unit_price = null, confidence = "niedrig" und verwende die zusammengehörigen Sätze als evidence. Die Position muss sichtbar erhalten bleiben und geprüft werden.
- Eine ausdrücklich genannte Anzahl darf bei einem Preiswiderspruch nicht verloren gehen. Beispielprinzip ohne feste Fachwörter: "7 [zählbare Objekte]" bleibt menge = 7 und einheit = "Stück"; nur der widersprüchliche Preis bleibt offen.
- Gesamtbetrag und Einzelpreis sind nur dann widersprüchlich, wenn sie rechnerisch nicht zusammenpassen. Stimmen Anzahl × Einzelpreis und Gesamtbetrag überein, dürfen die line-lokalen Werte normal übernommen werden.
- Rechnungsadresse/Billing address/Rechnung geht an ist NIE eine Arbeitsposition und darf keine generische Leistung wie "Reinigung" erzeugen.
- Fremdsprachige, mundartliche oder unprofessionell formulierte Leistungen semantisch auf deutsche professionelle Leistungsnamen übersetzen: "Nettoyage des vitres"/"Nettoyage des vitrines" = Fenster reinigen, "Nettoyage du sol du garage" = Garageboden reinigen, "Déplacement" = Anfahrt.
- Erkenne semantisch jede eigenständige Kostenposition für Weg/Fahrt/Einsatz beim Kunden als eigene Leistung "Anfahrt". Das gilt unabhängig von Sprache oder Formulierung. Speichere niemals die fremdsprachige Originalform als Leistungsnamen. Wenn der Kundentext dafür einen klaren Pauschalpreis nennt: name/action_name = "Anfahrt", einheit = "Pauschal", menge = 1, unit_price = Betrag, currency = erkannte Währung, evidence = exakte Preiszeile.
- Dieselbe Evidence-Zeile darf genau eine Leistung erzeugen. Original, Übersetzung und deutsches Arbeitslabel sind keine getrennten Leistungen, wenn sie dieselbe Kostenposition, denselben Betrag und dieselbe Währung beschreiben. Dann nur eine normalisierte deutsche Position ausgeben.
- Keine reine Wortlistenlogik: Entscheidend ist die Bedeutung der Kostenposition. Nicht als Anfahrt werten: Personen fahren irgendwohin, Tür öffnen, Parkplatz, Zugang, Bauleiter/Polier/Vorarbeiter oder normale Kontaktangaben ohne eigene Kostenposition.
- Bei handwerklichen Nebenleistungen bevorzugt professionelle "...arbeiten"-Namen verwenden, wenn fachlich passend: Spachteln → Spachtelarbeiten, Abdecken → Abdeckarbeiten, Schleifen → Schleifarbeiten.
- Nicht auf falsche Katalogleistung wie Kellerboden/Farbreste ausweichen.
- Wenn bei einer Position kein eigener Preis steht → unit_price = null.
- Wenn mehrere Preise/Währungen im Text stehen, jede Position separat zuordnen; bei Unsicherheit unit_price = null und confidence = "niedrig".
- Keine Leistungen erfinden.
- Interne Karten-/Auftragstitel, Betreff-/Überschriftszeilen und Zusammenfassungen sind keine Kundenleistung. Nutze sie höchstens als auftrag.titel, aber NIEMALS als eigene arbeitsposition, Preis-/Einheitsquelle, Adresse oder Besonderheit. Entscheide semantisch: Eine Arbeitsposition braucht echte Arbeitsaussage plus eigene Evidence aus dem Kundentext.
- Nicht versuchen, unbekannte Arbeiten einer bestehenden Leistung zuzuordnen.
- Wenn mehrere Arbeiten genannt werden, jede Arbeit separat ausgeben.
- Aber eine einzige Preis-/Mengenzeile mit nur einer Menge und nur einem Preis ist keine Mehrfacharbeit, nur weil sie aus Bereich + Objekt besteht.
- Klassifiziere semantisch: In einer Zeile können Orts-/Bereichswörter und Arbeitsobjekt zusammenstehen. Das ist trotzdem eine einzige Arbeitsposition, wenn nur ein Mengen-/Preisblock vorhanden ist. Beispielprinzip: "Raum/Bereich + Objekt + Menge + Preis" darf nicht in "Raum reinigen" plus "Objekt reinigen" zerlegt werden.
- Keine Doppelpositionen aus derselben evidence: Wenn zwei Arbeitspositionen dieselbe raw/evidence-Zeile und denselben Preis-/Mengen-/Währungsbeleg hätten, ist eine davon nur Kontext oder Zusammenfassung und muss entfallen.
- Wenn eine zweite Position nur aus einem Ort, Raum, Bereich, Stockwerk, Gebäude-Teil oder Titel der gleichen Zeile besteht, ist sie keine eigene Leistung. Die echte Leistung ist die semantische Arbeit aus dieser Zeile.
- Zweiter-Prüfer-Regel: Menge, Einheit, Preis und Währung müssen aus derselben Leistungszeile oder einem eindeutig verbundenen Satz stammen. Zahlen aus PLZ, Hausnummer, Telefonnummer, Uhrzeit, Adresse oder vorheriger/nächster Leistungszeile dürfen nie auf eine andere Leistung übertragen werden.
- Einheit und Menge gehören nur zu der Position, in deren Text sie stehen.
- Standortzahlen sind keine Mengen: Eine Zahl vor einem SINGULAREN Stockwerks-/Lagewort wie "6 Etage", "2 Stock", "3. Geschoss" oder "4 floor" bezeichnet die Lage/Ordnungszahl. Sie darf nicht als 6/2/3/4 Stück berechnet werden. Bei genau einem Preis für diese Zeile: Menge = 1, Einheit = Pauschal und die Lage bleibt im Leistungsnamen, z. B. "... 6. Etage reinigen". Nur eine ausdrücklich plurale Anzahl oder ein eigenes Zähl-/Multiplikationssignal darf als Menge gelten.

12. AUSFÜHRUNGSADRESSE / ARBEITSORT:
- Erkenne semantisch, ob neben der Rechnungsadresse ein anderer Ort genannt wird, an dem gearbeitet wird.
- Entscheidend ist ausschließlich die Rolle der Adresse im Text: Wer bezahlt die Rechnung ≠ wo wird gearbeitet.
- Arbeite nicht über feste Stichwortlisten. Verstehe den Satzinhalt, auch wenn der Text kurz, falsch geschrieben, mundartlich, gemischtsprachig oder unordentlich ist.
- Wenn zwei unterschiedliche Adressblöcke vorhanden sind, trenne sie nach Rolle:
  kunde/Rechnung = zahlende Stelle;
  ausfuehrungsadresse = Ort der Arbeit/Baustelle/Objekt/Wohnung/Lager/Büro.
- Wenn eindeutig anderer Arbeitsort vorhanden UND Strasse + PLZ + Ort dieses Arbeitsorts im Eingangstext vorhanden sind:
  auftrag.ausfuehrungsadresse.ist_abweichend = true
  name/strasse/plz/ort befüllen
  confidence = "hoch" oder "mittel"
  evidence = exakte Textstelle, die den Arbeitsort enthält
- Wenn die Rolle der Adresse unsicher ist, wenn Strasse/PLZ/Ort fehlen oder wenn du nur aus dem Titel/Leistungstext raten müsstest:
  ist_abweichend = false
  keine Ausführungsadresse speichern
  in sonstige_hinweise kurz "Ausführungsadresse prüfen" aufnehmen.
- Keine Leistungsbeschreibung, Preise, Hinweise oder Sätze wie "Bitte reinigen..." in die Adresse schreiben.
- Der name der Ausführungsadresse darf ausschließlich aus dem eigentlichen Arbeitsort-/Ausführungsadressblock stammen, normalerweise aus der Zeile direkt vor der Straßenzeile. Sobald die Straße/PLZ/Ort abgeschlossen sind, gehören die folgenden Zeilen zu Kommunikation, Termin, Zugang, Gefahr oder Besonderheiten und dürfen nicht mehr an den Ausführungsort angehängt werden.
- Wenn du nur durch Anhängen einer folgenden Hinweiszeile einen längeren Ausführungsort bilden könntest, ist das falsch: nutze nur die belegte Objektzeile vor der Adresse.
- Auftrags-/Karten-Titel wie "[Titel: ...]" sind nur Titel und dürfen NIEMALS als name der Ausführungsadresse gespeichert werden.
- name der Ausführungsadresse darf nur ein echter Objekt-/Ortsname sein, z.B. "Garage West", "Wohnung 3", "Lagerhalle Süd".
- name der Ausführungsadresse NIEMALS mit Leistungs-/Preiszeilen oder Leistungszusammenfassungen füllen, z.B. NICHT "Anfahrt CHF 45", NICHT "10 Fenster reinigen CHF 7 pro Stück", NICHT "Fenster reinigen und Anfahrt".`;
}

// ---------- Main intake function ----------

// V17.90L81: Final source-identity guard. It only collapses rows that carry the
// same local evidence, quantity, unit, price and currency and whose service
// names are semantically nested (for example "Messprotokoll" and
// "Messprotokoll erstellen"). It does not merge unrelated equal-priced rows.
function dedupeEquivalentSourceRowsV17_90L81<T extends Record<string, any>>(
  input: T[],
): T[] {
  const output: T[] = [];

  const normalizedUnit = (value: unknown) => normalizeSemanticText(value);
  const numberKey = (value: unknown, digits: number) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toFixed(digits) : "0";
  };
  const nameScore = (value: unknown) => {
    const name = normalizeSemanticText(value);
    const actionBonus = /\b(?:pruefen|erstellen|reinigen|montieren|ersetzen|absaugen|reparieren|entkalken|streichen|verlegen|befestigen)\b/.test(name)
      ? 100
      : 0;
    return actionBonus + name.length;
  };

  for (const item of input || []) {
    const source = normalizeSemanticText(
      item.sourceText || item.evidence || item.description || "",
    );
    const name = normalizeSemanticText(item.serviceName || "");
    const identity = [
      source,
      numberKey(item.quantity, 4),
      normalizedUnit(item.unit),
      numberKey(item.unitPrice, 4),
      normalizeSemanticText(item.currency || ""),
    ].join("|");

    const duplicateIndex = output.findIndex((existing) => {
      const existingSource = normalizeSemanticText(
        existing.sourceText || existing.evidence || existing.description || "",
      );
      const existingName = normalizeSemanticText(existing.serviceName || "");
      const existingIdentity = [
        existingSource,
        numberKey(existing.quantity, 4),
        normalizedUnit(existing.unit),
        numberKey(existing.unitPrice, 4),
        normalizeSemanticText(existing.currency || ""),
      ].join("|");
      const namesNested = Boolean(
        name &&
          existingName &&
          (name === existingName ||
            name.includes(existingName) ||
            existingName.includes(name)),
      );
      return identity === existingIdentity && namesNested;
    });

    if (duplicateIndex < 0) {
      output.push(item);
      continue;
    }

    const existing = output[duplicateIndex];
    const preferred =
      nameScore(item.serviceName) > nameScore(existing.serviceName)
        ? item
        : existing;
    const fallback = preferred === item ? existing : item;
    output[duplicateIndex] = {
      ...fallback,
      ...preferred,
      sourceText:
        preferred.sourceText || fallback.sourceText || preferred.description || fallback.description,
      evidence:
        preferred.evidence || fallback.evidence || preferred.sourceText || fallback.sourceText,
      description:
        preferred.description || fallback.description || preferred.sourceText || fallback.sourceText,
      needsReview: Boolean(preferred.needsReview && fallback.needsReview),
      reviewReason:
        preferred.reviewReason || fallback.reviewReason || null,
    } as T;
  }

  return output;
}

// Restore an explicit action that is still present in the item's own evidence
// but was shortened by a later label cleaner ("Verteilerschrank prüfen" must
// not become only "Verteilerschrank"). This uses the same source row only.
function restoreExplicitSourceActionV17_90L81<T extends Record<string, any>>(
  input: T[],
): T[] {
  return (input || []).map((item) => {
    const current = String(item.serviceName || "").trim();
    const source = String(
      item.sourceText || item.evidence || item.description || "",
    )
      .replace(/^[-•*]+\s*/, "")
      .replace(/^\d+(?:[.,]\d+)?\s+/, "")
      .trim();
    if (!current || !source) return item;

    const candidate = source
      .replace(
        /\s+\d+(?:[.,]\d+)?\s*(?:stunden?|std\.?|meter|m2|m²|qm|quadratmeter|stueck|stück|stk|pauschal)\b.*$/iu,
        "",
      )
      .replace(/\s+(?:chf|eur|franken|stutz)\b.*$/iu, "")
      .trim();
    const currentKey = normalizeSemanticText(current);
    const candidateKey = normalizeSemanticText(candidate);
    if (!candidateKey.startsWith(`${currentKey} `)) return item;

    const extra = candidateKey.slice(currentKey.length).trim().split(/\s+/g);
    if (
      extra.length < 1 ||
      extra.length > 2 ||
      !/\b(?:pruefen|erstellen|reinigen|montieren|ersetzen|absaugen|reparieren|entkalken|streichen|verlegen|befestigen)\b/.test(
        extra.join(" "),
      )
    ) {
      return item;
    }
    return { ...item, serviceName: candidate } as T;
  });
}

export async function processIncomingMessage(
  input: IntakeInput,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    messageText,
    imageBase64,
    imageMimeType,
    savedMediaPath,
    savedMediaType,
    optimizedPreviewPath,
    optimizedThumbnailPath,
    userId: inputUserId,
    allImageBase64s,
    allImageMimeTypes,
    allSavedMediaPaths,
    allOptimizedPreviewPaths,
    allOptimizedThumbnailPaths,
    audioDurationSec: inputAudioDurationSec,
    audioTranscriptionStatus: inputAudioTranscriptionStatus,
    additionalReviewReasons,
    reviewNote,
    forceReview,
  } = input;

  // Resolve userId: use provided userId ONLY. No fallbacks!
  // Webhooks must resolve userId via phone number BEFORE calling this function.
  const userId = inputUserId || null;
  if (!userId) {
    console.error(
      `[${source}] ❌ No userId provided — cannot process message. Webhook must resolve userId by phone number.`,
    );
    logAuditAsync({
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "no_userId", sender: senderName },
    });
    return null;
  }
  const dataScope = await getActiveDataScope(userId);
  const intakeDiagnosticTraceEnabled = dataScope === "TEST";
  const intakeDiagnosticTraceId = createIntakeDiagnosticTraceId();
  const intakePerfTraceEnabledV17_90L337 = source === "WhatsApp";
  const _intakeStartTime = Date.now();
  let _intakePerfLastMarkV17_90L337 = _intakeStartTime;
  const markIntakePerfV17_90L337 = (
    stage: string,
    payload: Record<string, unknown> = {},
  ): void => {
    const now = Date.now();
    logIntakePerfV17_90L337(
      intakePerfTraceEnabledV17_90L337,
      intakeDiagnosticTraceId,
      stage,
      {
        elapsedMs: now - _intakeStartTime,
        deltaMs: now - _intakePerfLastMarkV17_90L337,
        ...payload,
      },
    );
    _intakePerfLastMarkV17_90L337 = now;
  };
  markIntakePerfV17_90L337("01_start", {
    source,
    textLength: messageText.length,
    hasImage: Boolean(imageBase64),
    hasMedia: Boolean(savedMediaPath),
  });
  const intakeAppointmentReferenceV17_90L271 =
    buildIntakeAppointmentReferenceV17_90L271(
      new Date(_intakeStartTime),
    );
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "01_input",
    {
      source,
      textLength: messageText.length,
      originalText: redactIntakeDiagnosticText(messageText, 3200),
    },
  );
  console.log(
    `[${source}] Processing message for userId: ${userId} (textLength=${messageText.length}chars, hasImage=${!!imageBase64}, hasMedia=${!!savedMediaPath})`,
  );

  const userFilter = userId ? { userId } : {};

  // Load services
  const services = await prisma.service.findMany({ where: userFilter });
  const serviceListJson = JSON.stringify(
    services.map((s: any) => ({
      id: s.id,
      name: s.name,
      einheit: s.unit,
      standard_preis: Number(s.defaultPrice),
    })),
  );
  markIntakePerfV17_90L337("01a_services_loaded", {
    serviceCount: services.length,
  });

  // Load customers for matching (max 200).
  // Phase 2b: ONLY expose {id, name} to the LLM — never address/phone/email.
  // Rationale: the LLM previously copied address fields from a candidate's
  // master record into its own `kunde.*` output on name-only hits, which the
  // create-path then persisted into a *new* customer (silent partial-inheritance bug).
  // The authoritative customer match runs server-side in verifyCustomerMatch
  // (reads address/phone/email straight from the DB), so the LLM does not need
  // that information to decide "gleicher_kunde" / "moeglicher_treffer".
  const allCustomers = await prisma.customer.findMany({
    where: { deletedAt: null, dataScope, ...userFilter },
    select: {
      id: true,
      name: true,
      customerNumber: true,
      address: true,
      plz: true,
      city: true,
      phone: true,
      email: true,
      notes: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const customerListJson = JSON.stringify(
    allCustomers.map((c: any) => ({ id: c.id, name: c.name })),
  );
  markIntakePerfV17_90L337("01b_customers_loaded", {
    customerCount: allCustomers.length,
  });

  // Fetch branche + hauptsprache from company settings
  const companySettings = userId
    ? await prisma.companySettings.findFirst({ where: { userId } })
    : await prisma.companySettings.findFirst();
  const branche = companySettings?.branche || "Gartenbau";
  const detectedCurrency = detectCurrencyFromText(messageText);

  const intakeCurrency =
    detectedCurrency || (companySettings?.currency === "EUR" ? "EUR" : "CHF");
  const hauptsprache = (companySettings as any)?.hauptsprache || "Deutsch";
  markIntakePerfV17_90L337("01c_settings_loaded", {
    branche,
    intakeCurrency,
    hauptsprache,
  });

  // V17.46 SEMANTIC_NORMALIZATION_BEFORE_MAIN_LLM:
  // Fremdsprache/Dialekt darf gar nicht erst als sichtbarer Leistungsname,
  // Ausführungsort oder Hinweis in die Haupt-KI laufen. Die Normalisierung
  // bleibt beweisführend getrennt: Originaltext für Zahlen/Preise,
  // Arbeitsfassung für professionelle deutsche Namen und Rollen.
  const intakeNormalization = shouldSkipPaidNormalizationForCleanStandardGermanV17_90L99({
    text: messageText,
    targetLanguage: hauptsprache,
  })
    ? EMPTY_INTAKE_NORMALIZATION_V17_49
    : await createStandardGermanValidationTranslation({
        text: messageText,
        targetLanguage: hauptsprache,
        source,
      });
  const translationText = intakeNormalization.translationText;
  const showTranslationInCustomerMessage =
    intakeNormalization.showTranslationInCustomerMessage;
  markIntakePerfV17_90L337("02_normalization_done", {
    hasTranslation: Boolean(translationText),
    showTranslationInCustomerMessage,
  });
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "02_normalization",
    {
      hasTranslation: Boolean(translationText),
      showTranslationInCustomerMessage,
      translationText: redactIntakeDiagnosticText(translationText, 3200),
    },
  );

  // Resolve default VAT rate from CompanySettings.
  // If MwSt is active and a rate is configured → use that rate.
  // If MwSt is explicitly disabled → 0.
  // Otherwise fall back to schema default (8.1) for backwards compatibility.
  const intakeVatRate: number =
    companySettings?.mwstAktiv === true && companySettings?.mwstSatz != null
      ? Number(companySettings.mwstSatz)
      : companySettings?.mwstAktiv === false
        ? 0
        : 8.1;

  // Build prompt
  const systemPrompt = buildSystemPrompt(
    serviceListJson,
    customerListJson,
    senderName,
    branche,
    hauptsprache,
    `Nachrichteneingang: ${intakeAppointmentReferenceV17_90L271.displayDateTime} (Europe/Zurich; ISO-Datum ${intakeAppointmentReferenceV17_90L271.isoDate})`,
  );

  // Build user content (supports multi-image)
  const hasMultipleImages = allImageBase64s && allImageBase64s.length > 0;
  const hasAnyImage = hasMultipleImages || !!imageBase64;
  const userContent: any[] = [];
  const isImageOnly =
    !messageText.trim() && (hasMultipleImages || !!imageBase64);
  if (messageText.trim()) {
    const normalizedMessageForAi = translationText
      ? [
          `Nachricht Original:\n"${messageText}"`,
          `--- Semantisch normalisierte Arbeitsfassung (${hauptsprache}) ---\n${translationText}`,
          `Pflicht: Originaltext bleibt maßgeblich für Zahlen, Preise, Währungen, Codes, Strasse/PLZ/Ort und die semantische Bedeutung aller Terminangaben. Die Arbeitsfassung ist nur Sprachhilfe für professionelle ${hauptsprache}-Leistungsnamen und Hinweise; sie darf eine im Original genannte Tageszeit niemals überschreiben. Nur eine ausdrücklich benannte konventionelle Tageszeit darf als tageszeit gesetzt werden; relative oder vage Angaben dürfen nicht zu einer Tageszeit konkretisiert werden. Bei einem Widerspruch zwischen Original und Arbeitsfassung, einer relativen/vagen Zeitangabe oder unsicherer Originalbedeutung gilt: tageszeit=null und system.needs_review=true. Für Ausführungsort-Namen gilt: echte Eigennamen, Gebäudenamen, Straßennamen, Haus-/Trakt-/Raumnamen und Standortnamen exakt behalten; nur beschreibende Funktions-/Raumbegriffe normalisieren, wenn sie eindeutig keine Eigennamen sind. Speichere niemals Rohsprache/Dialekt als serviceName/name/action_name, wenn die Arbeitsfassung eine saubere ${hauptsprache}-Form liefert. Arbeitsobjekte nicht verflachen: Fenster/Tische/Vitrinen im Raum bleiben Fenster/Tische/Vitrinen, nicht nur der Raum.`,
        ].join("\n\n")
      : `Nachricht:\n"${messageText}"`;

    userContent.push({ type: "text", text: normalizedMessageForAi });
  }
  if (hasMultipleImages) {
    if (isImageOnly) {
      userContent.push({
        type: "text",
        text: `Der Kunde hat ${allImageBase64s.length} Bilder geschickt, aber KEINEN Text dazu. Beschreibe NUR was sichtbar ist. Erfinde KEINEN Auftrag. Setze needs_review=true.`,
      });
    } else {
      userContent.push({
        type: "text",
        text: `Der Kunde hat ${allImageBase64s.length} Bilder zusammen mit der Nachricht geschickt. Es handelt sich um EINEN Auftrag:`,
      });
    }
    for (let imgIdx = 0; imgIdx < allImageBase64s.length; imgIdx++) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${allImageMimeTypes?.[imgIdx] || "image/jpeg"};base64,${allImageBase64s[imgIdx]}`,
        },
      });
    }
  } else if (imageBase64) {
    if (isImageOnly) {
      userContent.push({
        type: "text",
        text: "Der Kunde hat NUR dieses Bild geschickt, OHNE Text. Beschreibe NUR was sichtbar ist. Erfinde KEINEN konkreten Auftrag. Setze needs_review=true.",
      });
    } else {
      userContent.push({
        type: "text",
        text: "Der Kunde hat auch dieses Bild geschickt:",
      });
    }
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}`,
      },
    });
  }
  if (userContent.length === 0) {
    console.log(`[${source}] No content to analyze, skipping`);
    return null;
  }

  // Call LLM
  // Long multi-service messages need substantially more output space than a
  // normal one- or two-position intake. A fixed 2600-token ceiling truncated
  // valid JSON for larger orders and immediately created an empty fallback.
  // Estimate the required budget from line-local price/quantity evidence and
  // retry once with a larger compact-output request before falling back.
  const likelyStructuredLineCount = messageText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        /\d/.test(line) &&
        /(?:CHF|EUR|USD|GBP|\b(?:m2|m²|qm|stk|stück|stueck|laufmeter|lfm|stunden?|std\.?|pauschal)\b|[à@])/i.test(
          line,
        ),
    ).length;
  const initialLlmMaxTokens =
    likelyStructuredLineCount >= 12 || messageText.length >= 1400
      ? 9000
      : likelyStructuredLineCount >= 7 || messageText.length >= 900
        ? 6000
        : 3600;
  const retryLlmMaxTokens = Math.max(14000, initialLlmMaxTokens + 5000);
  const baseLlmMessages: any[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        userContent.length === 1 && !hasAnyImage
          ? userContent[0].text
          : userContent,
    },
  ];
  const intakeLlmModelV17_90L337 = hasAnyImage ? "gpt-4.1" : "gpt-4.1-mini";
  const requestIntakeLlm = (maxTokens: number, compactRetry = false) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: intakeLlmModelV17_90L337,
        messages: compactRetry
          ? [
              ...baseLlmMessages,
              {
                role: "user",
                content:
                  "Der vorherige Ausgabeversuch war unvollständig oder abgeschnitten. Gib das vollständige gültige JSON erneut zurück. Halte Titel, Beschreibung, Gefahren und Besonderheiten kurz. Behalte jede echte Arbeitsposition. raw und evidence enthalten pro Position nur die exakt zugehörige kurze Quellzeile. Keine Erklärungen und kein Markdown.",
              },
            ]
          : baseLlmMessages,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
  const parseIntakeJsonObject = (rawContent: unknown): any | null => {
    const raw = String(rawContent || "").trim();
    if (!raw) return null;
    const withoutFence = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const firstBrace = withoutFence.indexOf("{");
    const lastBrace = withoutFence.lastIndexOf("}");
    const candidate =
      firstBrace >= 0 && lastBrace > firstBrace
        ? withoutFence.slice(firstBrace, lastBrace + 1)
        : withoutFence;
    try {
      const value = JSON.parse(candidate);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  };
  // If the LLM fails (credits exhausted, HTTP error, network/timeout, empty or
  // unparseable response), we fall back to creating a manual-review order so
  // no WhatsApp message gets silently dropped. See createFallbackOrderFromRawPayload.
  const _llmStartTime = Date.now();
  markIntakePerfV17_90L337("03_main_llm_start", {
    model: intakeLlmModelV17_90L337,
    systemPromptChars: systemPrompt.length,
    userContentChars: JSON.stringify(userContent).length,
    maxTokens: initialLlmMaxTokens,
  });
  console.log(
    `[${source}] 🤖 Starting LLM analysis (model=${intakeLlmModelV17_90L337}, systemPrompt=${systemPrompt.length}chars, userContent=${JSON.stringify(userContent).length}chars)`,
  );
  let llmResponse: Response;
  try {
    llmResponse = await requestIntakeLlm(initialLlmMaxTokens);
  } catch (netErr: any) {
    console.error(
      `[${source}] LLM network/timeout error:`,
      netErr?.message || netErr,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: "llm_network_error",
        sender: senderName,
        error: netErr?.message || String(netErr),
      },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_network_error");
  }

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => "");
    console.error(`[${source}] LLM API error:`, errText);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: "llm_api_error",
        sender: senderName,
        httpStatus: llmResponse.status,
      },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_api_error");
  }

  let llmResult: any;
  try {
    llmResult = await llmResponse.json();
  } catch (jsonErr: any) {
    console.error(
      `[${source}] LLM response JSON parse error:`,
      jsonErr?.message || jsonErr,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "llm_response_parse_error", sender: senderName },
    });
    return await createFallbackOrderFromRawPayload(
      input,
      "llm_response_parse_error",
    );
  }
  const mainLlmDurationMsV17_90L337 = Date.now() - _llmStartTime;
  console.log(
    `[${source}] 🤖 LLM analysis completed in ${mainLlmDurationMsV17_90L337}ms`,
  );
  markIntakePerfV17_90L337("03_main_llm_end", {
    model: intakeLlmModelV17_90L337,
    durationMs: mainLlmDurationMsV17_90L337,
    usage: summarizeOpenAiUsageV17_90L337(
      intakeLlmModelV17_90L337,
      llmResult?.usage,
    ),
  });
  let content = llmResult?.choices?.[0]?.message?.content;
  let finishReason = String(llmResult?.choices?.[0]?.finish_reason || "");
  let parsed: any | null = parseIntakeJsonObject(content);

  if (!content || !parsed || finishReason === "length") {
    console.warn(
      `[${source}] LLM output incomplete (finishReason=${finishReason || "unknown"}, chars=${String(content || "").length}); retrying once with max_tokens=${retryLlmMaxTokens}`,
    );
    try {
      const retryStartMsV17_90L337 = Date.now();
      markIntakePerfV17_90L337("03b_main_llm_retry_start", {
        model: intakeLlmModelV17_90L337,
        maxTokens: retryLlmMaxTokens,
      });
      const retryResponse = await requestIntakeLlm(retryLlmMaxTokens, true);
      if (retryResponse.ok) {
        const retryResult = await retryResponse.json();
        markIntakePerfV17_90L337("03b_main_llm_retry_end", {
          model: intakeLlmModelV17_90L337,
          durationMs: Date.now() - retryStartMsV17_90L337,
          usage: summarizeOpenAiUsageV17_90L337(
            intakeLlmModelV17_90L337,
            retryResult?.usage,
          ),
        });
        const retryContent = retryResult?.choices?.[0]?.message?.content;
        const retryParsed = parseIntakeJsonObject(retryContent);
        const retryFinishReason = String(
          retryResult?.choices?.[0]?.finish_reason || "",
        );
        if (retryContent && retryParsed && retryFinishReason !== "length") {
          content = retryContent;
          parsed = retryParsed;
          finishReason = retryFinishReason;
          console.log(
            `[${source}] ✅ LLM compact retry recovered complete JSON in ${Date.now() - _llmStartTime}ms total`,
          );
        } else {
          content = retryContent || content;
          finishReason = retryFinishReason || finishReason;
          parsed = retryParsed;
          console.error(
            `[${source}] LLM compact retry still incomplete (finishReason=${retryFinishReason || "unknown"}, chars=${String(retryContent || "").length})`,
          );
        }
      } else {
        const retryErrorText = await retryResponse.text().catch(() => "");
        console.error(
          `[${source}] LLM compact retry API error (${retryResponse.status}):`,
          retryErrorText.slice(0, 500),
        );
      }
    } catch (retryErr: any) {
      console.error(
        `[${source}] LLM compact retry network/parse error:`,
        retryErr?.message || retryErr,
      );
    }
  }

  if (!content) {
    console.error(`[${source}] LLM returned empty content`);
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: { reason: "llm_empty_response", sender: senderName },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_empty_response");
  }

  if (!parsed || finishReason === "length") {
    console.error(
      `[${source}] Failed to recover complete LLM JSON:`,
      `${String(content).slice(0, 350)} ... ${String(content).slice(-180)}`,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: "llm_parse_error",
        sender: senderName,
        finishReason: finishReason || null,
        outputChars: String(content).length,
        initialMaxTokens: initialLlmMaxTokens,
        retryMaxTokens: retryLlmMaxTokens,
      },
    });
    return await createFallbackOrderFromRawPayload(input, "llm_parse_error");
  }

  console.log(
    `[${source}] KI-Analyse:`,
    JSON.stringify({
      kunde: parsed.kunde?.name,
      titel: parsed.auftrag?.titel,
      service: parsed.service?.service_name,
      abgleich_status: parsed.kundenabgleich?.status,
      confidence: parsed.kundenabgleich?.confidence,
      treffer_id: parsed.kundenabgleich?.bestehende_kunden_id,
      prioritaet: parsed.system?.prioritaet,
      needs_review: parsed.system?.needs_review,
    }),
  );
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03_llm_structured",
    {
      title: redactIntakeDiagnosticText(parsed.auftrag?.titel, 220),
      description: redactIntakeDiagnosticText(
        parsed.auftrag?.beschreibung,
        700,
      ),
      workItems: summarizeIntakeDiagnosticItems(
        parsed.auftrag?.arbeitspositionen,
      ),
      onsiteContact: parsed.auftrag?.kontakt_vor_ort
        ? redactIntakeDiagnosticText(
            JSON.stringify(parsed.auftrag.kontakt_vor_ort),
            420,
          )
        : null,
      appointments: Array.isArray(parsed.auftrag?.termine)
        ? redactIntakeDiagnosticText(
            JSON.stringify(parsed.auftrag.termine),
            620,
          )
        : null,
    },
  );

  // V17.90L225: Capture the complete first structured AI business graph at
  // the exact 03_llm_structured boundary. Downstream logic may work on mutable
  // copies, but these originals are the only authoritative sources for
  // customer, execution address, on-site contact and appointments.
  const cloneFirstAiStructuredValueV17_90L225 = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value ?? null)) as T;
  const firstAiCustomerSnapshotV17_90L225 = Object.freeze(
    cloneFirstAiStructuredValueV17_90L225(parsed.kunde || {}),
  );
  const firstAiCustomerMatchSnapshotV17_90L225 = Object.freeze(
    cloneFirstAiStructuredValueV17_90L225(parsed.kundenabgleich || {}),
  );
  const firstAiExecutionAddressSnapshotV17_90L225 = parsed.auftrag
    ?.ausfuehrungsadresse
    ? Object.freeze(
        cloneFirstAiStructuredValueV17_90L225(
          parsed.auftrag.ausfuehrungsadresse,
        ),
      )
    : null;
  const normalizedFirstAiOnsiteContactV17_90L229 =
    normalizeAiOnsiteContactValueV17_90L229(
      parsed.auftrag?.kontakt_vor_ort,
    );
  const firstAiOnsiteContactSnapshotV17_90L225 =
    normalizedFirstAiOnsiteContactV17_90L229
      ? Object.freeze(
          cloneFirstAiStructuredValueV17_90L225(
            normalizedFirstAiOnsiteContactV17_90L229,
          ),
        )
      : null;
  const firstAiAppointmentsSnapshotV17_90L225 = Object.freeze(
    (Array.isArray(parsed.auftrag?.termine) ? parsed.auftrag.termine : []).map(
      (appointment: unknown) =>
        Object.freeze(cloneFirstAiStructuredValueV17_90L225(appointment)),
    ),
  );

  // V17.90L213: Capture the first structured AI service rows immediately.
  // Every later validator/repair path works on separate data; it can no longer
  // mutate the source that is used to build the canonical persistence rows.
  // JSON cloning is deliberate here because the LLM result is plain data and
  // undefined helper fields must not become part of the persisted contract.
  const firstAiWorkItemsSnapshotV17_90L213 = Object.freeze(
    (Array.isArray(parsed.auftrag?.arbeitspositionen)
      ? parsed.auftrag.arbeitspositionen
      : []
    ).map((item: unknown) =>
      Object.freeze(JSON.parse(JSON.stringify(item ?? {}))),
    ),
  );

  // V17.90L214: Seal every structured AI role immediately. The later role
  // builders may still run for diagnostics, but canonical persistence can only
  // consume these exact AI-selected lines. No raw-message/translation rescue is
  // allowed to create a new persisted fact after this boundary.
  const firstAiRoleSnapshotV17_90L214 = Object.freeze({
    safety: Object.freeze(
      extractRoleReviewLinesV17_90L106(
        parsed.auftrag?.gefahren ??
          parsed.auftrag?.warnhinweise ??
          parsed.auftrag?.sicherheitswarnungen,
      ),
    ),
    ordinary: Object.freeze(
      extractRoleReviewLinesV17_90L106(parsed.auftrag?.sonstige_hinweise),
    ),
    access: Object.freeze(
      extractRoleReviewLinesV17_90L106(parsed.auftrag?.zugangshinweise),
    ),
    parking: Object.freeze(
      extractRoleReviewLinesV17_90L106(parsed.auftrag?.parkhinweise),
    ),
    // V17.90L255: `sonstige_hinweise` is the single canonical ordinary-role
    // source. The legacy `besonderheiten` field is deliberately non-canonical
    // and must stay empty in the first-AI contract.
    other: Object.freeze([]),
  });

  // V17.90L251: A second semantic AI checks the complete first-AI business
  // graph before the canonical lock. It does not rewrite services. It may only
  // report a missing possible work statement or flag an unsupported service
  // label. Both outcomes are persisted only as separate red control findings.
  // Neither outcome may create, rename, block in place or duplicate a canonical
  // first-AI service row.
  // This is language-independent and intentionally contains no service/name
  // word lists.
  markIntakePerfV17_90L337("03c_work_coverage_start", {
    workItemCount: (firstAiWorkItemsSnapshotV17_90L213 as readonly any[]).length,
  });
  const workCoverageStartMsV17_90L337 = Date.now();
  const finalAiWorkCoverageV17_90L251 =
    await runReadOnlyWorkCoverageCheckerV17_90L251({
      originalText: messageText,
      translatedText: translationText || null,
      customerName: String(
        (firstAiCustomerSnapshotV17_90L225 as any)?.name || "",
      ),
      executionSiteName: String(
        (firstAiExecutionAddressSnapshotV17_90L225 as any)?.name ||
          (firstAiExecutionAddressSnapshotV17_90L225 as any)?.siteName ||
          "",
      ),
      workItems: (firstAiWorkItemsSnapshotV17_90L213 as readonly any[]).map(
        (item, index) => {
          const quantityValue = Number(item?.quantity ?? item?.menge);
          const priceValue = Number(
            item?.unitPrice ?? item?.unit_price ?? item?.price,
          );
          return {
            index: index + 1,
            serviceName: compactExactSourceTextV17_90L251(
              item?.serviceName ??
                item?.name ??
                item?.action_name ??
                item?.service_name ??
                item?.matched_service_name,
            ),
            sourceText: compactExactSourceTextV17_90L251(
              item?.sourceText ??
                item?.source_text ??
                item?.evidence ??
                item?.raw ??
                item?.description,
            ),
            quantity: Number.isFinite(quantityValue) ? quantityValue : null,
            unit: compactExactSourceTextV17_90L251(
              item?.unit ?? item?.einheit,
            ),
            unitPrice: Number.isFinite(priceValue) ? priceValue : null,
          };
        },
      ),
      roleEntries: (
        Object.entries(firstAiRoleSnapshotV17_90L214) as Array<
          [string, readonly string[]]
        >
      ).flatMap(([role, lines]) =>
        lines.map((text) => ({ role, text: String(text || "") })),
      ),
      // V17.90L268: Canonically structured non-work evidence is passed to the
      // second checker as hard counter-evidence. This is role/evidence based,
      // not a service-word list. It prevents customer/address/appointment/contact
      // statements from becoming missing-work findings while ordinary hints stay
      // eligible for semantic review.
      structuredNonWorkEvidence: [
        {
          role: "customer",
          text: compactExactSourceTextV17_90L251(
            (firstAiCustomerSnapshotV17_90L225 as any)?.evidence,
          ),
        },
        {
          role: "customer",
          text: [
            (firstAiCustomerSnapshotV17_90L225 as any)?.name,
            (firstAiCustomerSnapshotV17_90L225 as any)?.strasse,
            (firstAiCustomerSnapshotV17_90L225 as any)?.hausnummer,
            (firstAiCustomerSnapshotV17_90L225 as any)?.plz,
            (firstAiCustomerSnapshotV17_90L225 as any)?.ort,
          ]
            .map((value) => compactExactSourceTextV17_90L251(value))
            .filter(Boolean)
            .join(" "),
        },
        {
          role: "execution_address",
          text: compactExactSourceTextV17_90L251(
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.evidence,
          ),
        },
        {
          role: "execution_address",
          text: [
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.name,
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.siteName,
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.strasse,
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.hausnummer,
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.plz,
            (firstAiExecutionAddressSnapshotV17_90L225 as any)?.ort,
          ]
            .map((value) => compactExactSourceTextV17_90L251(value))
            .filter(Boolean)
            .join(" "),
        },
        ...firstAiAppointmentsSnapshotV17_90L225.map((appointment: any) => ({
          role: "appointment",
          text: compactExactSourceTextV17_90L251(
            appointment?.evidence || appointment?.raw || JSON.stringify(appointment),
          ),
        })),
        {
          role: "onsite_contact",
          text: compactExactSourceTextV17_90L251(
            (firstAiOnsiteContactSnapshotV17_90L225 as any)?.evidence,
          ),
        },
      ].filter((entry) => entry.text),
    });
  markIntakePerfV17_90L337("03c_work_coverage_end", {
    durationMs: Date.now() - workCoverageStartMsV17_90L337,
    missingWorkCount: finalAiWorkCoverageV17_90L251.missingWork.length,
    invalidItemCount: finalAiWorkCoverageV17_90L251.invalidItems.length,
  });

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03c0_work_coverage_review",
    {
      missingWork: finalAiWorkCoverageV17_90L251.missingWork.map((finding) => ({
        source: finding.source,
        quote: redactIntakeDiagnosticText(finding.quote, 420),
        reason: redactIntakeDiagnosticText(finding.reason, 220),
      })),
      invalidItems: finalAiWorkCoverageV17_90L251.invalidItems.map((finding) => ({
        itemIndex: finding.itemIndex,
        reason: redactIntakeDiagnosticText(finding.reason, 220),
      })),
    },
  );

  const firstAiDangerRoleLinesV17_90L106 = [
    ...firstAiRoleSnapshotV17_90L214.safety,
  ];
  const firstAiOrdinaryRoleLinesV17_90L106 = [
    ...firstAiRoleSnapshotV17_90L214.ordinary,
    ...firstAiRoleSnapshotV17_90L214.access,
    ...firstAiRoleSnapshotV17_90L214.parking,
    ...firstAiRoleSnapshotV17_90L214.other,
  ];

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03b_llm_structured_roles",
    {
      safetyWarnings: firstAiDangerRoleLinesV17_90L106.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      ordinaryHints: firstAiOrdinaryRoleLinesV17_90L106.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      accessHints: firstAiRoleSnapshotV17_90L214.access.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      parkingHints: firstAiRoleSnapshotV17_90L214.parking.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      otherHints: firstAiRoleSnapshotV17_90L214.other.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
    },
  );

  const firstAiCanonicalEvidenceSourceV17_90L229 = [
    messageText,
    translationText,
  ]
    .filter(Boolean)
    .join("\n");
  const firstAiOnsiteContactHintV17_90L229 =
    extractAiOnsiteContactHintV17_90L86(
      firstAiCanonicalEvidenceSourceV17_90L229,
      (firstAiCustomerSnapshotV17_90L225 as any)?.telefon || null,
      firstAiOnsiteContactSnapshotV17_90L225 || null,
    ) ||
    buildOnsiteContactHintV17_90L86({
      source: "",
      candidateCustomerPhone:
        (firstAiCustomerSnapshotV17_90L225 as any)?.telefon || null,
    });
  const firstAiCommunicationInstructionHintV17_90L265 =
    extractAiCommunicationInstructionHintV17_90L265(
      firstAiCanonicalEvidenceSourceV17_90L229,
      firstAiOnsiteContactSnapshotV17_90L225 || null,
    );

  const firstAiAppointmentHintsV17_90L216 =
    buildStructuredAppointmentHintsV17_90L86(
      firstAiAppointmentsSnapshotV17_90L225 as AiAppointmentV17_90L86[],
      messageText,
      intakeAppointmentReferenceV17_90L271,
    );
  const finalAiRoleReviewV17_90L216 =
    await runReadOnlySpecialNoteRoleCheckerV17_90L106({
      originalText: messageText,
      translatedText: translationText || null,
      appointments: firstAiAppointmentHintsV17_90L216,
      roles: {
        safety: [...firstAiRoleSnapshotV17_90L214.safety],
        access: [...firstAiRoleSnapshotV17_90L214.access],
        parking: [...firstAiRoleSnapshotV17_90L214.parking],
        other: [...firstAiRoleSnapshotV17_90L214.other],
        ordinary: [...firstAiRoleSnapshotV17_90L214.ordinary],
      },
    });
  const readOnlySpecialNoteRoleFindingsV17_90L106 =
    finalAiRoleReviewV17_90L216.findings;

  // V17.90L252: Hard first-AI-only role boundary. The second role checker is
  // diagnostics-only. No downstream parser, role mover, source-text rescue or
  // dedupe may add, remove, rename or re-role a canonical fact. The UI may
  // suppress a duplicate display while an active review finding exists, but
  // the sealed business graph remains exactly the first structured AI output.
  const finalAiRoleSnapshotV17_90L215 = Object.freeze({
    safety: Object.freeze([...firstAiRoleSnapshotV17_90L214.safety]),
    access: Object.freeze([...firstAiRoleSnapshotV17_90L214.access]),
    parking: Object.freeze([...firstAiRoleSnapshotV17_90L214.parking]),
    other: Object.freeze([...firstAiRoleSnapshotV17_90L214.other]),
    ordinary: Object.freeze([...firstAiRoleSnapshotV17_90L214.ordinary]),
  });

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03c_final_ai_role_review",
    {
      findings: readOnlySpecialNoteRoleFindingsV17_90L106.map((finding) => ({
        text: redactIntakeDiagnosticText(finding.text, 320),
        currentRole: finding.currentRole,
        expectedRole: finding.expectedRole,
        reason: redactIntakeDiagnosticText(finding.reason, 220),
      })),
      suppressions: finalAiRoleReviewV17_90L216.suppressions.map(
        (suppression) => ({
          text: redactIntakeDiagnosticText(suppression.text, 320),
          currentRole: suppression.currentRole,
          reason: redactIntakeDiagnosticText(suppression.reason, 220),
        }),
      ),
      additions: finalAiRoleReviewV17_90L216.additions.map((addition) => ({
        text: redactIntakeDiagnosticText(addition.text, 320),
        expectedRole: addition.expectedRole,
        source: addition.source,
        reason: redactIntakeDiagnosticText(addition.reason, 220),
      })),
      finalRoles: {
        safety: finalAiRoleSnapshotV17_90L215.safety.map((line) =>
          redactIntakeDiagnosticText(line, 320),
        ),
        access: finalAiRoleSnapshotV17_90L215.access.map((line) =>
          redactIntakeDiagnosticText(line, 320),
        ),
        parking: finalAiRoleSnapshotV17_90L215.parking.map((line) =>
          redactIntakeDiagnosticText(line, 320),
        ),
        other: finalAiRoleSnapshotV17_90L215.other.map((line) =>
          redactIntakeDiagnosticText(line, 320),
        ),
        ordinary: finalAiRoleSnapshotV17_90L215.ordinary.map((line) =>
          redactIntakeDiagnosticText(line, 320),
        ),
      },
    },
  );

  // After this final AI role review every downstream path is read-only.

  // --- Customer resolution based on kundenabgleich.status ---
  const abgleich = cloneFirstAiStructuredValueV17_90L225(
    firstAiCustomerMatchSnapshotV17_90L225,
  ) as any;
  let abgleichStatus = abgleich.status || "kein_treffer";
  let matchId = abgleich.bestehende_kunden_id || "";

  // Ensure address is split properly
  const kundeData = cloneFirstAiStructuredValueV17_90L225(
    firstAiCustomerSnapshotV17_90L225,
  ) as any;

  // V16.9: Telefonnummern aus "Kontakt vor Ort" dürfen nicht als normale
  // Kundentelefonnummer gespeichert oder für Matching verwendet werden.
  // Beispiel:
  // Kontakt vor Ort:
  // Hauswart Meier
  // Tel. 079 123 45 67
  // => bleibt als Hinweis erhalten, wird aber nicht zur Rechnungsadresse.
  let onsiteContactHint: OnsiteContactHint = {
    ...firstAiOnsiteContactHintV17_90L229,
  };
  if (onsiteContactHint.phoneBelongsToSiteContact) {
    console.log(
      `[${source}] 🛡️ onsite contact phone removed from customer data: ${maskPhoneForLog(kundeData.telefon || null)}`,
    );
    kundeData.telefon = null;
  }

  // V17.90L87: The model can occasionally omit kunde.name and matchId even
  // though the message explicitly asks to reuse one already stored customer.
  // Resolve only an exact, unique full customer-name mention. No master data is
  // copied and ambiguous/name-only messages without reuse intent stay fail-closed.
  if (
    !matchId &&
    hasExplicitStoredCustomerReuseIntentV17_90L87(
      messageText,
      abgleich.reuse_requested,
    )
  ) {
    const mentionedCustomer = findUniqueMentionedCustomerV17_90L87(
      messageText,
      allCustomers,
    );
    if (mentionedCustomer) {
      matchId = mentionedCustomer.id;
      abgleichStatus = "moeglicher_treffer";
      if (!String(kundeData.name || "").trim()) {
        kundeData.name = mentionedCustomer.name;
      }
      console.log(
        `[${source}] 🎯 EXPLICIT REUSE FALLBACK → candidate ${mentionedCustomer.name} (${mentionedCustomer.id})`,
      );
    }
  }


  // V17.90L88: A model-proposed customer id is never allowed to contradict
  // the structured customer name. Validate the pair before any reuse path.
  // If the message explicitly requests reuse and exactly one stored customer
  // has that exact full name, use that identity instead of the conflicting id.
  if (matchId) {
    const proposed = allCustomers.find(
      (customer: any) => String(customer?.id || "") === String(matchId),
    );
    const structuredNameKey = normalizeCustomerIdentityV17_90L87(
      kundeData.name || "",
    );
    const proposedNameKey = normalizeCustomerIdentityV17_90L87(
      proposed?.name || "",
    );
    if (
      structuredNameKey &&
      proposedNameKey &&
      structuredNameKey !== proposedNameKey
    ) {
      console.warn(
        `[${source}] 🛡️ CUSTOMER ID/NAME MISMATCH → discarded proposed id ${matchId} (${proposed?.name || "unknown"}) for ${kundeData.name}`,
      );
      matchId = "";
      abgleichStatus = "moeglicher_treffer";
    }
  }

  if (
    !matchId &&
    hasExplicitStoredCustomerReuseIntentV17_90L87(
      messageText,
      abgleich.reuse_requested,
    )
  ) {
    const mentionedCustomer = findUniqueMentionedCustomerV17_90L87(
      messageText,
      allCustomers,
    );
    if (mentionedCustomer) {
      matchId = mentionedCustomer.id;
      abgleichStatus = "moeglicher_treffer";
      kundeData.name = mentionedCustomer.name;
      console.log(
        `[${source}] 🎯 CANONICAL CUSTOMER REUSE → ${mentionedCustomer.name} (${mentionedCustomer.id})`,
      );
    }
  }

  if (
    hasExplicitStoredCustomerReuseIntentV17_90L87(
      messageText,
      abgleich.reuse_requested,
    )
  ) {
    const preferredStoredCustomerV17_90L88B =
      findPreferredStoredCustomerByExactNameV17_90L88B(
        kundeData.name,
        allCustomers,
      );
    if (
      preferredStoredCustomerV17_90L88B &&
      preferredStoredCustomerV17_90L88B.id !== matchId
    ) {
      matchId = preferredStoredCustomerV17_90L88B.id;
      abgleichStatus = "moeglicher_treffer";
      kundeData.name = preferredStoredCustomerV17_90L88B.name;
      console.log(
        `[${source}] 🎯 PREFERRED COMPLETE CUSTOMER REUSE → ${preferredStoredCustomerV17_90L88B.name} (${preferredStoredCustomerV17_90L88B.customerNumber || preferredStoredCustomerV17_90L88B.id})`,
      );
    }
  }

  // Block R — Safety-Net: Wenn die LLM keinen Namen extrahiert hat, aber der
  // Text eine eindeutige Selbstvorstellung enthält ("mein Name ist Aida",
  // "Ich heisse X", "Ich bin X" etc.), den Namen aus dem Text übernehmen.
  // Greift NUR bei leerem LLM-Namen — überschreibt NIE eine LLM-Extraktion.
  // Bug-Hintergrund: Wenn der WhatsApp-ProfileName mit dem Endkunden-Namen
  // identisch ist (z.B. Solo-Selbständige testen mit eigener Nummer), unterdrückt
  // die Prompt-Regel "Absender = Kunde A, NICHT Endkunde" die Namens-Extraktion.
  const llmExtractedName = (kundeData.name || "").trim();

  const invalidStandaloneCities = new Set([
    "form",
    "reinigen",
    "schneiden",
    "pflegen",
    "entsorgen",
    "ausraeumen",
    "ausräumen",
    "maehen",
    "mähen",
    "streichen",
    "bauen",
    "montieren",
  ]);

  const normalizedOrtCandidate = normalizeUnitText(kundeData.ort || "");

  const hasStrongCustomerData =
    !!String(kundeData.name || "").trim() ||
    !!String(kundeData.strasse || "").trim() ||
    !!String(kundeData.hausnummer || "").trim() ||
    !!String(kundeData.plz || "").trim();

  if (
    normalizedOrtCandidate &&
    invalidStandaloneCities.has(normalizedOrtCandidate) &&
    !hasStrongCustomerData
  ) {
    console.warn(
      `[${source}] ⚠ structured AI city looks like work text and remains unchanged for review: "${kundeData.ort}"`,
    );
  }

  // V17.90L211: Raw-text self-introduction parsing is diagnostic only. A
  // missing structured customer name remains missing and reviewable; it is not
  // silently written back after the AI result.
  const selfIntroFallbackUsed = false;

  // V16.39: no name rescue from raw wording. The AI must sort the billing
  // customer into structured fields; if it does not, the customer stays empty
  // and the order remains review-required.
  if (!String(kundeData.name || "").trim()) {
    kundeData.name = null;
  }

  const customerGuardReviewReasons: string[] = [];
  const legacyBillingFallbackEnabled =
    process.env.INTAKE_LEGACY_BILLING_FALLBACK === "1";
  const rawBillingEvidence = legacyBillingFallbackEnabled
    ? extractDeterministicBillingEvidence(messageText)
    : null;
  const billingEvidence = supplementAiBillingEvidence(
    extractAiStructuredBillingEvidence(kundeData, messageText),
    rawBillingEvidence,
  );
  const customerGuard = applySafeBillingCustomerGuard({
    kundeData,
    evidence: billingEvidence,
    allowSelfIntroName: selfIntroFallbackUsed,
  });
  if (customerGuard.changed) {
    console.log(
      `[${source}] 🛡️ Billing customer guard normalized customer data (source=${billingEvidence.source}, reliable=${billingEvidence.hasReliableCustomerBlock})`,
    );
  }
  if (customerGuard.reviewReason) {
    customerGuardReviewReasons.push(customerGuard.reviewReason);
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  // V17.90L195: Resolve the customer phone only inside the bounded billing
  // block. A verified named on-site phone is explicitly excluded. No fallback
  // from specialNotes, appointment text or the complete message is permitted.
  const canonicalBillingPhoneV17_90L195 = extractCanonicalBillingPhoneV17_90L195({
    rawText: messageText,
    aiBillingPhone: billingEvidence.phone || kundeData.telefon || null,
    onsitePhone: onsiteContactHint.phone,
    onsiteContactName: onsiteContactHint.contactName,
  });
  kundeData.telefon = canonicalBillingPhoneV17_90L195;
  billingEvidence.phone = canonicalBillingPhoneV17_90L195;

  const canonicalBillingEmailV17_90L196 = extractCanonicalBillingEmailV17_90L196({
    rawText: messageText,
    aiBillingEmail: billingEvidence.email || kundeData.email || null,
  });
  kundeData.email = canonicalBillingEmailV17_90L196;
  billingEvidence.email = canonicalBillingEmailV17_90L196;

  // A phone-only AI "on-site contact" that is identical to the bounded billing
  // phone is not an on-site person. Keller-style "bitte vorher anrufen" remains
  // an appointment/communication instruction, while the office number stays on
  // the billing customer.
  if (
    !onsiteContactHint.contactName &&
    normalizePhoneDigits(onsiteContactHint.phone) &&
    normalizePhoneDigits(onsiteContactHint.phone) ===
      normalizePhoneDigits(canonicalBillingPhoneV17_90L195)
  ) {
    onsiteContactHint = buildOnsiteContactHintV17_90L86({
      source: messageText,
      candidateCustomerPhone: canonicalBillingPhoneV17_90L195,
    });
  }

  function looksLikeWeakCityOnlyFromWorkText(
    kundeData: any,
    text: string,
  ): boolean {
    const cityNorm = normalizeUnitText(kundeData?.ort);
    const textNorm = normalizeUnitText(text);

    if (!cityNorm || !textNorm) return false;

    const hasName = !!String(kundeData?.name || "").trim();
    const hasStreet = !!String(kundeData?.strasse || "").trim();
    const hasHouseNumber = !!String(kundeData?.hausnummer || "").trim();
    const hasPlz = !!String(kundeData?.plz || "").trim();

    // Wenn echte Kundendaten vorhanden sind, Ort nicht blocken.
    if (hasName || hasStreet || hasHouseNumber || hasPlz) return false;

    const cityInText = new RegExp(`\\bin\\s+${cityNorm}\\b`, "i").test(
      textNorm,
    );

    // Ohne weitere Kundendaten ist "in X" zu unsicher:
    // kann Ort sein, kann aber auch Teil der Arbeit sein.
    return cityInText;
  }

  if (looksLikeWeakCityOnlyFromWorkText(kundeData, messageText)) {
    console.warn(
      `[${source}] ⚠ weak city evidence detected; structured AI city remains unchanged for review`,
    );
  }

  const addr = ensureAddressSplit({
    customerStreet: kundeData.strasse
      ? `${kundeData.strasse}${kundeData.hausnummer ? " " + kundeData.hausnummer : ""}`
      : null,
    customerPlz: kundeData.plz,
    customerCity: kundeData.ort,
  });

  if (
    hasExplicitExecutionNotBillingAddressDirectiveV17_51(messageText) &&
    billingEvidence.source !== "labeled"
  ) {
    const addressValidationSourceTextV17_51 = [
      messageText,
      translationText
        ? `--- Übersetzung (automatisch) ---\n${translationText}`
        : "",
    ]
      .filter((part) => String(part || "").trim())
      .join("\n");
    const executionBlock = extractExecutionBlockFromText(
      addressValidationSourceTextV17_51,
    );
    const executionStreet = executionBlock
      ? parseBillingStreetFromBlock(executionBlock)
      : null;
    const executionPlzCity = executionBlock
      ? parseBillingPlzCityFromBlock(executionBlock)
      : { plz: null, city: null };
    if (
      sameStructuredAddress({
        aStreet: addr.street,
        aPlz: addr.plz,
        aCity: addr.city,
        bStreet: executionStreet,
        bPlz: executionPlzCity.plz,
        bCity: executionPlzCity.city,
      })
    ) {
      // V17.90L211: A possible address-role conflict is a finding, not a
      // mutation. Preserve the prepared structured billing address.
      customerGuardReviewReasons.push(
        "customer_address_role_conflict_execution_site_v17_211",
      );
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
    }
  }

  if (
    normalizeUnitText(addr.city) === "form" &&
    /in\s+form\s+(bringen|schneiden|setzen|machen|pflegen)/i.test(
      normalizeUnitText(messageText),
    )
  ) {
    console.warn(
      `[${source}] ⚠ structured city may originate from a work phrase; value remains unchanged for review: "${addr.city}"`,
    );
    customerGuardReviewReasons.push("customer_city_evidence_uncertain_v17_211");
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  const addressRoleSafetyV17_61 = shouldQuarantineBillingAddressRoleV17_61({
    rawText: [
      messageText,
      translationText
        ? `--- Übersetzung (automatisch) ---\n${translationText}`
        : "",
    ]
      .filter((part) => String(part || "").trim())
      .join("\n"),
    billingEvidence,
    billingName: kundeData.name || null,
    billingStreet: addr.street,
    billingPlz: addr.plz,
    billingCity: addr.city,
  });

  const hasCompletePreparedBillingV17_90L211 = Boolean(
    cleanAiStructuredBillingName(kundeData.name || null) &&
      addr.street &&
      addr.plz &&
      addr.city,
  );

  if (addressRoleSafetyV17_61.quarantine) {
    console.warn(
      `[${source}] ⚠ ambiguous address role detected; prepared structured billing values remain unchanged`,
    );
  }

  if (addressRoleSafetyV17_61.reviewReasons.length > 0) {
    if (hasCompletePreparedBillingV17_90L211) {
      // V17.90L211: A complete prepared billing block is not deleted or blocked
      // by a second semantic interpretation. Findings remain diagnostic-only.
      console.info(
        `[${source}] 🔒 address-role findings suppressed from persistence because the prepared billing block is complete`,
      );
    } else {
      customerGuardReviewReasons.push(...addressRoleSafetyV17_61.reviewReasons);
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
    }
  }

  // V17.90L197 / Intake V2: this bounded customer object is immutable and is
  // the only source permitted for matching and new-customer persistence. No
  // on-site contact, appointment, access note or raw-text fallback may enter it.
  const canonicalBillingCustomerV2 = Object.freeze({
    name: cleanAiStructuredBillingName(kundeData.name || null) || null,
    street: addr.street || null,
    plz: addr.plz || null,
    city: addr.city || null,
    phone: canonicalBillingPhoneV17_90L195 || null,
    email: canonicalBillingEmailV17_90L196 || null,
    evidenceSource: billingEvidence.source || null,
  });

  // V17.90L281: Automatic customer reuse is allowed only for one complete,
  // exact billing identity: name + street + PLZ + city. Name-only, phone-only,
  // email-only and near-exact completion paths remain review/create paths.
  const normalizeStrictCustomerIdentityV17_90L281 = (value: unknown): string =>
    normalizeUnitText(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const hasCompleteStrictBillingIdentityV17_90L281 = Boolean(
    canonicalBillingCustomerV2.name &&
      canonicalBillingCustomerV2.street &&
      canonicalBillingCustomerV2.plz &&
      canonicalBillingCustomerV2.city,
  );
  const strictCustomerIdentityMatchesV17_90L281 = (candidate: {
    name?: string | null;
    address?: string | null;
    plz?: string | null;
    city?: string | null;
  } | null | undefined): boolean => {
    if (!hasCompleteStrictBillingIdentityV17_90L281 || !candidate) return false;
    if (
      !candidate.name ||
      !candidate.address ||
      !candidate.plz ||
      !candidate.city
    ) {
      return false;
    }
    return (
      normalizeStrictCustomerIdentityV17_90L281(candidate.name) ===
        normalizeStrictCustomerIdentityV17_90L281(
          canonicalBillingCustomerV2.name,
        ) &&
      normalizeStrictCustomerIdentityV17_90L281(candidate.address) ===
        normalizeStrictCustomerIdentityV17_90L281(
          canonicalBillingCustomerV2.street,
        ) &&
      String(candidate.plz).trim() ===
        String(canonicalBillingCustomerV2.plz).trim() &&
      normalizeStrictCustomerIdentityV17_90L281(candidate.city) ===
        normalizeStrictCustomerIdentityV17_90L281(
          canonicalBillingCustomerV2.city,
        )
    );
  };

  // A model-proposed id is only eligible when it already matches all four
  // protected billing identity fields. Otherwise the later exact matcher or
  // new-customer path decides; the name alone must never bind a customer.
  if (matchId) {
    const proposedStrictCandidateV17_90L281 = allCustomers.find(
      (customer: any) => String(customer?.id || "") === String(matchId),
    );
    if (
      !strictCustomerIdentityMatchesV17_90L281(
        proposedStrictCandidateV17_90L281,
      )
    ) {
      console.log(
        `[${source}] 🔒 strict customer identity rejected proposed match ${matchId}; exact name+street+PLZ+city required`,
      );
      matchId = "";
      abgleichStatus = hasCompleteStrictBillingIdentityV17_90L281
        ? "kein_treffer"
        : "moeglicher_treffer";
    }
  }

  let customerId: string | null = null;
  let duplicateWarning = "";
  let customerWasNewlyCreated = false;
  const autoReuseTags: string[] = [];

  // V17.90L91/L281: Explicit reuse intent is only a candidate signal. It may
  // never bind a customer without the complete exact billing identity required
  // by L281. The later exact matcher remains the authoritative auto-reuse path.
  const explicitReuseRequestedV17_90L91 =
    abgleichStatus === "reuse_requested" ||
    hasExplicitStoredCustomerReuseIntentV17_90L87(
      messageText,
      abgleich.reuse_requested,
    );
  if (abgleichStatus === "reuse_requested") {
    abgleichStatus = "moeglicher_treffer";
  }
  if (explicitReuseRequestedV17_90L91) {
    const preferredCustomerV17_90L91 =
      findPreferredStoredCustomerByExactNameV17_90L88B(
        kundeData.name,
        allCustomers,
      );
    if (
      preferredCustomerV17_90L91 &&
      strictCustomerIdentityMatchesV17_90L281(preferredCustomerV17_90L91)
    ) {
      matchId = preferredCustomerV17_90L91.id;
      abgleichStatus = "gleicher_kunde";
    } else if (!hasCompleteStrictBillingIdentityV17_90L281) {
      matchId = "";
      abgleichStatus = "moeglicher_treffer";
    }
  }

  // ═══ SERVER-SIDE CUSTOMER MATCHING (v2 — hardened) ═══
  // Uses centralized verifyCustomerMatch from lib/customer-matching.ts.
  // The LLM output is NEVER trusted for auto-assignment decisions.
  // Only phone or email matches allow auto-assignment.
  // Name + address requires confirmation (not auto-assign).
  // All other signals are review/suggestion only.

  if (customerId) {
    // Protected explicit reuse was already resolved above.
  } else if (abgleichStatus === "gleicher_kunde" && matchId) {
    const matchResult = await verifyCustomerMatch(matchId, {
      phone: kundeData.telefon || null,
      email: kundeData.email || null,
      street: addr.street,
      plz: addr.plz,
      city: addr.city,
      name: kundeData.name,
    }, userId, dataScope);

    if (matchResult.verdict === "auto_assign") {
      // ✅ Strong unique signal verified (phone or email) → safe to auto-assign
      customerId = matchId;
      const matchedCust = await prisma.customer.findFirst({
        where: { id: matchId, userId, dataScope },
        select: { address: true, plz: true, city: true },
      });
      if (
        !matchedCust?.address?.trim() ||
        !matchedCust?.plz?.trim() ||
        !matchedCust?.city?.trim()
      ) {
        parsed.system = parsed.system || {};
        parsed.system.needs_review = true;
        console.log(
          `[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) but address incomplete → needsReview=true`,
        );
      } else {
        console.log(
          `[${source}] ✅ AUTO-ASSIGN VERIFIED (${matchResult.reason}, conf ${abgleich.confidence}) → auto-assign to ${matchId}`,
        );
      }
    } else if (matchResult.verdict === "bestaetigungs_treffer") {
      // 🟡 Name + address match but no unique identifier → needs manual confirmation
      abgleichStatus = "bestaetigungs_treffer";
      duplicateWarning = `⚠️ Name und Adresse stimmen überein, aber kein eindeutiges Signal (Telefon/E-Mail). Manuelle Bestätigung erforderlich.`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(
        `[${source}] 🟡 CONFIRMATION REQUIRED (${matchResult.reason}) → bestaetigungs_treffer for ${matchId}`,
      );
    } else {
      // 🛡️ No strong signal → downgrade to moeglicher_treffer, NEVER auto-assign
      abgleichStatus = "moeglicher_treffer";
      const unterschiede = (abgleich.unterschiede || []).join(", ");
      duplicateWarning = `⚠️ KI-Treffer herabgestuft: Kein starkes Signal (${matchResult.reason}). Manuelle Prüfung erforderlich.${unterschiede ? ` (${unterschiede})` : ""}`;
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      console.log(
        `[${source}] 🛡️ DOWNGRADED → moeglicher_treffer (reason: ${matchResult.reason}, no strong signal for ${matchId})`,
      );
    }
  } else if (abgleichStatus === "gleicher_kunde" && !matchId) {
    console.log(`[${source}] ⚠ gleicher_kunde but no matchId, creating new`);
  } else if (abgleichStatus === "moeglicher_treffer") {
    const unterschiede = (abgleich.unterschiede || []).join(", ");
    duplicateWarning = `⚠️ ${abgleich.warnung || "Möglicher Kundentreffer – bitte prüfen"}${unterschiede ? ` (${unterschiede})` : ""}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(
      `[${source}] ⚠ moeglicher_treffer (confidence ${abgleich.confidence}) → new customer + warning`,
    );
  } else if (abgleichStatus === "konflikt") {
    duplicateWarning = `🚨 ${abgleich.warnung || "Konflikt bei Kundenzuordnung – manuelle Prüfung erforderlich"}. Confidence: ${abgleich.confidence}`;
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
    console.log(`[${source}] 🚨 konflikt → new customer + strong warning`);
  } else {
    console.log(`[${source}] ➕ kein_treffer → creating new customer`);
  }

  // ═══ PHASE 2c: EXACT DETERMINISTIC REUSE (before creating a new customer) ═══
  // Only if no customerId was assigned by strong-signal matching (phone/email),
  // AND the incoming record is fully addressed (name + street + plz + city),
  // AND exactly one active candidate under this user matches strictly, AND
  // there is no phone/email conflict — reuse that candidate.
  //
  // This is NOT a merge: no second record exists yet. We simply skip the
  // would-be duplicate create. For every other case (0 hits, >1 hits, any
  // conflict, archived candidate, incomplete incoming) fall through to the
  // existing create-new-customer path unchanged.
  // Phase 2d: accumulate tags for reviewReasons to surface in the UI banner.

  // V17.90L85: A message may intentionally reference an already stored
  // customer without repeating the billing address. If the model returns a
  // concrete candidate id, the exact stored customer name is present in the
  // incoming message, exactly one active customer has that name, and no
  // structured billing field conflicts, reuse the customer deterministically.
  // This is identity matching, not vocabulary matching, and it never changes
  // the stored customer master data.
  if (!customerId && matchId && abgleichStatus === "moeglicher_treffer") {
    const candidate = await prisma.customer.findFirst({
      where: {
        id: matchId,
        ...(userId ? { userId } : {}),
        dataScope,
        deletedAt: null,
      },
      select: {
        id: true,
        customerNumber: true,
        name: true,
        address: true,
        plz: true,
        city: true,
        phone: true,
        email: true,
      },
    });

    if (candidate?.name?.trim()) {
      const normalizeCustomerIdentityV17_90L85 = (value: unknown) =>
        normalizeUnitText(value)
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const candidateNameKey = normalizeCustomerIdentityV17_90L85(
        candidate.name,
      );
      const messageKey = ` ${normalizeCustomerIdentityV17_90L85(messageText)} `;
      const candidateNameMentioned = Boolean(
        candidateNameKey && messageKey.includes(` ${candidateNameKey} `),
      );
      const incomingNameKey = normalizeCustomerIdentityV17_90L85(
        kundeData.name || "",
      );
      const noNameConflict =
        !incomingNameKey || incomingNameKey === candidateNameKey;
      const billingPhoneDigits = normalizePhoneDigits(
        billingEvidence.phone || null,
      );
      const onsitePhoneDigits = normalizePhoneDigits(
        onsiteContactHint.phone || null,
      );
      const billingPhoneIsOnsiteContact = Boolean(
        billingPhoneDigits &&
          onsitePhoneDigits &&
          (billingPhoneDigits === onsitePhoneDigits ||
            billingPhoneDigits.endsWith(onsitePhoneDigits) ||
            onsitePhoneDigits.endsWith(billingPhoneDigits)),
      );
      const noPhoneConflict =
        !billingEvidence.phone ||
        billingPhoneIsOnsiteContact ||
        !candidate.phone ||
        billingPhoneDigits === normalizePhoneDigits(candidate.phone);
      const noEmailConflict =
        !billingEvidence.email ||
        !candidate.email ||
        String(billingEvidence.email).trim().toLowerCase() ===
          String(candidate.email).trim().toLowerCase();
      const noStreetConflict =
        !billingEvidence.street ||
        !candidate.address ||
        normalizeUnitText(billingEvidence.street) ===
          normalizeUnitText(candidate.address);
      const noPlzConflict =
        !billingEvidence.plz ||
        !candidate.plz ||
        String(billingEvidence.plz).trim() === String(candidate.plz).trim();
      const normalizedBillingCity = cleanIntakeCityCandidate(
        billingEvidence.city || null,
      );
      const noCityConflict =
        !normalizedBillingCity ||
        !candidate.city ||
        normalizeUnitText(normalizedBillingCity) ===
          normalizeUnitText(candidate.city);

      const sameNameCandidates = await prisma.customer.findMany({
        where: {
          ...(userId ? { userId } : {}),
          dataScope,
          deletedAt: null,
          name: { equals: candidate.name, mode: "insensitive" },
        },
        select: { id: true },
        take: 2,
      });

      if (
        candidateNameMentioned &&
        sameNameCandidates.length === 1 &&
        noNameConflict &&
        noPhoneConflict &&
        noEmailConflict &&
        noStreetConflict &&
        noPlzConflict &&
        noCityConflict
      ) {
        customerId = candidate.id;
        abgleichStatus = "gleicher_kunde";
        duplicateWarning = "";
        autoReuseTags.push(
          `AUTO_REUSED_EXPLICIT_NAME:${candidate.customerNumber || candidate.id}`,
        );
        console.log(
          `[${source}] 🎯 EXPLICIT-NAME REUSE → binding to existing ${candidate.customerNumber || candidate.id} (${candidate.id})`,
        );
      }
    }
  }

  if (!customerId) {
    const exact = await findExactDeterministicMatch(prisma, userId ?? null, {
      name: kundeData.name || null,
      street: canonicalBillingCustomerV2.street,
      plz: canonicalBillingCustomerV2.plz,
      city: canonicalBillingCustomerV2.city,
      phone: canonicalBillingCustomerV2.phone,
      email: canonicalBillingCustomerV2.email,
    }, dataScope);
    if (exact.match) {
      customerId = exact.match.id;
      abgleichStatus = "gleicher_kunde";
      duplicateWarning = "";
      autoReuseTags.push(`AUTO_REUSED:${exact.match.customerNumber}`);
      console.log(
        `[${source}] 🎯 EXACT REUSE → binding to existing ${exact.match.customerNumber} (${exact.match.id})`,
      );
      logAuditAsync({
        userId,
        action: "CUSTOMER_REUSE_EXACT",
        area: "CUSTOMERS",
        targetType: "Customer",
        targetId: exact.match.id,
        success: true,
        details: {
          source,
          matchedOn: ["name", "street", "plz", "city"],
          candidateCustomerNumber: exact.match.customerNumber,
        },
      });
      // Improve-only update: the existing `else` branch below
      // (`// Update existing customer with new data - only if it IMPROVES...`)
      // already runs protectCustomerData(existing, incoming) for any non-null
      // customerId — so we do nothing extra here and let that canonical path
      // handle address/plz/city fill-in.
    } else if (
      exact.reason === "multiple_candidates" &&
      matchId &&
      abgleichStatus === "bestaetigungs_treffer"
    ) {
      // V17.90L281: Even with all four identity fields present, multiple exact
      // customer records are ambiguous. Keep review/create handling; never
      // choose one automatically.
      console.log(
        `[${source}] strict exact reuse skipped: multiple exact customer candidates`,
      );
    } else if (
      exact.reason !== "incomplete_incoming" &&
      exact.reason !== "no_candidate"
    ) {
      // Useful trace for the other guarded cases (multi-match / conflict):
      console.log(
        `[${source}] exact-reuse skipped (${exact.reason}, count=${exact.candidateCount}) → normal create/duplicate path`,
      );
    }
  }

  // ═══ PHASE 2d: NEAR-EXACT DETERMINISTIC REUSE (strict) ═══
  // Triggers ONLY when: name+street exact, EXACTLY ONE of {plz, city} missing
  // on incoming, candidate has that field filled, exactly 1 active candidate,
  // no phone/email conflict. Completion is implicit (order binds to candidate
  // which already has the field). Never weakens exact-match. See spec in
  // lib/exact-customer-match.ts for full rules.
  if (!customerId) {
    const nearExact = await findNearExactDeterministicMatch(
      prisma,
      userId ?? null,
      {
        name: kundeData.name || null,
        street: addr.street,
        plz: addr.plz,
        city: addr.city,
        phone: kundeData.telefon || null,
        email: kundeData.email || null,
      },
      dataScope,
    );
    if (nearExact.match && nearExact.completedField) {
      // V17.90L281: Near-exact completion is intentionally not an automatic
      // customer assignment. All four fields must already be present and exact.
      console.log(
        `[${source}] strict customer reuse skipped near-exact candidate ${nearExact.match.customerNumber}; ${nearExact.completedField} missing in incoming identity`,
      );
    } else if (
      nearExact.reason !== "not_applicable" &&
      nearExact.reason !== "incomplete_incoming" &&
      nearExact.reason !== "no_candidate"
    ) {
      console.log(
        `[${source}] near-exact-reuse skipped (${nearExact.reason}, count=${nearExact.candidateCount}) → normal create/duplicate path`,
      );
    }
  }

  // Create new customer if not auto-assigned
  if (!customerId) {
    // ═══ DEFENSE-IN-DEPTH: only persist master data fields that are
    // demonstrably present in the raw incoming message (text + audio transcript).
    // This blocks silent partial inheritance of city/ZIP/street/phone/email from
    // any existing customer record, even if a future LLM/model regression tries
    // to copy fields from the `bestehende_kunden` prompt list into `kunde.*`.
    // Applies to the CREATE path only — improve-existing (auto_assign) goes
    // through protectCustomerData and is unchanged.
    // messageText already contains the audio transcript (transcription happens
    // in the webhook before processIncomingMessage is called). For image-only
    // messages messageText is empty → sanitize drops every auto-derived field.
    // Note: phone/email are NOT auto-persisted from webhook intake today
    // (historical conservative default). We still run them through the sanitizer
    // to keep the audit trail accurate about what the LLM tried to set.
    const sanitized = sanitizeNewCustomerFields({
      rawText: messageText,
      street: canonicalBillingCustomerV2.street,
      plz: canonicalBillingCustomerV2.plz,
      city: canonicalBillingCustomerV2.city,
      phone: canonicalBillingCustomerV2.phone,
      email: canonicalBillingCustomerV2.email,
    });
    if (sanitized.dropped.length > 0) {
      console.log(
        `[${source}] 🛡️ intake-sanitize dropped unverified fields on new-customer create: ${sanitized.dropped.join(", ")}`,
      );
    }

    // V16.20: Final create-path guard.
    // If the parser did not find a reliable billing/customer block, never let
    // sanitizeNewCustomerFields re-persist execution-site data from rawText as
    // customer master data. This specifically protects messages like:
    // "Arbeitsort: Objekt Alpha ... Kontakt vor Ort: Herr Frei ..."
    // where the customer should remain empty + needsReview.
    const hasPersistableCustomerName = Boolean(
      canonicalBillingCustomerV2.name,
    );

    const namelessBillingEvidence =
      !hasPersistableCustomerName &&
      billingEvidence.hasReliableCustomerBlock &&
      !billingEvidence.name
        ? billingEvidence
        : null;

    const hasNamelessBillingAddress = Boolean(
      namelessBillingEvidence &&
      (namelessBillingEvidence.street ||
        namelessBillingEvidence.plz ||
        namelessBillingEvidence.city ||
        namelessBillingEvidence.phone ||
        namelessBillingEvidence.email),
    );

    const hasReliableBillingForCreate =
      billingEvidence.hasReliableCustomerBlock ||
      Boolean(namelessBillingEvidence);

    const keepNewCustomerMasterEmpty =
      !hasReliableBillingForCreate ||
      (!hasPersistableCustomerName && !hasNamelessBillingAddress);

    const safeNewCustomerFields = keepNewCustomerMasterEmpty
      ? {
          ...sanitized,
          street: null,
          plz: null,
          city: null,
          phone: null,
          email: null,
        }
      : {
          ...sanitized,
          // AI-first: persist only structured billing fields that survived the
          // customer guard. The raw WhatsApp wording no longer decides the role.
          street: canonicalBillingCustomerV2.street,
          plz: canonicalBillingCustomerV2.plz,
          city: canonicalBillingCustomerV2.city,
          phone: canonicalBillingCustomerV2.phone,
          email: canonicalBillingCustomerV2.email,
        };

    const safeNewCustomerName = hasPersistableCustomerName
      ? canonicalBillingCustomerV2.name || ""
      : "";
    const safeNewCustomerCity =
      normalizeUnitText(safeNewCustomerFields.city) === "form"
        ? null
        : safeNewCustomerFields.city;
    const hasCompleteNewCustomerMasterForNumber = Boolean(
      safeNewCustomerName.trim() &&
      String(safeNewCustomerFields.street || "").trim() &&
      String(safeNewCustomerFields.plz || "").trim() &&
      String(safeNewCustomerCity || "").trim(),
    );

    if (keepNewCustomerMasterEmpty) {
      console.log(
        `[${source}] 🛡️ missing safe billing customer name/block → new customer master name/address/phone/email kept empty`,
      );
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      if (
        !customerGuardReviewReasons.includes(
          "customer_data_uncertain_no_billing_block",
        )
      ) {
        customerGuardReviewReasons.push(
          "customer_data_uncertain_no_billing_block",
        );
      }
    } else if (hasNamelessBillingAddress) {
      console.log(
        `[${source}] 🛡️ labeled billing address without name → persisted partial customer data with needsReview=true`,
      );
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      if (
        !customerGuardReviewReasons.includes(
          "customer_name_missing_billing_address_present",
        )
      ) {
        customerGuardReviewReasons.push(
          "customer_name_missing_billing_address_present",
        );
      }
    }

    let customerNumber: string | null = null;
    if (hasCompleteNewCustomerMasterForNumber) {
      const { generateCustomerNumber } = await import("@/lib/customer-number");
      customerNumber = await generateCustomerNumber(userId, dataScope);
    } else {
      // V17.87: Unvollständige Intake-Kunden bleiben Kundenentwurf ohne
      // sichtbare K-Nummer. Der Auftrag braucht technisch weiterhin eine
      // customerId, aber der Nummernkreis darf erst bei bestätigten
      // Hauptdaten verbraucht werden: Name/Firma + Strasse/Hausnummer + PLZ + Ort.
      parsed.system = parsed.system || {};
      parsed.system.needs_review = true;
      if (!customerGuardReviewReasons.includes("customer_draft_unconfirmed")) {
        customerGuardReviewReasons.push("customer_draft_unconfirmed");
      }
      console.log(
        `[${source}] 🧾 customer draft created without customerNumber until master data is complete`,
      );
    }

    const customer = await prisma.customer.create({
      data: {
        ...(customerNumber ? { customerNumber } : {}),
        name: safeNewCustomerName,
        // New customer master data is stored only after the AI-structured billing
        // evidence passed the customer guard. Execution-site data must never be
        // copied into the billing customer card.
        phone: safeNewCustomerFields.phone,
        email: safeNewCustomerFields.email,
        address: safeNewCustomerFields.street,
        plz: safeNewCustomerFields.plz,
        city: safeNewCustomerCity,
        notes: customerNumber ? `${source}-Kunde` : `${source}-Kundenentwurf`,
        ...(userId ? { userId } : {}),
        dataScope,
      },
    });

    // V16.39: No post-create raw-text rescue. Customer master fields were already
    // decided by the AI-structured billing evidence above.

    customerId = customer.id;
    customerWasNewlyCreated = true;
  } else {
    // V16.18: Existing customer master data is not changed by webhook/AI intake.
    // Corrections must happen manually via customer edit or customer merge.
    // The order can still bind to a verified customerId, but address/phone/email
    // fields on the customer record remain untouched.
    console.log(
      `[${source}] Customer ${customerId} reused; master data left unchanged by intake`,
    );
  }

  const resolvedCustomerMaster = customerId
    ? await prisma.customer.findFirst({
        where: {
          id: customerId,
          ...(userId ? { userId } : {}),
          dataScope,
          deletedAt: null,
        },
        select: {
          name: true,
          address: true,
          plz: true,
          city: true,
          phone: true,
          email: true,
        },
      })
    : null;

  // --- Build specialNotes (marker-based, NO language/keyword guessing in UI) ---
  // System hints (needsReview, duplicateWarning, confidence) are tracked via
  // needsReview boolean and shown dynamically in the UI — not stored in specialNotes.
  //
  // The parser stores semantic markers:
  // [GEFAHR] = red safety warning in the UI
  // [HINWEIS] = normal operational special note in the UI
  //
  // This avoids brittle language-specific keyword lists in the UI.
  const toNoteArray = (value: any): string[] =>
    extractProtectedStructuredRoleValuesV17_90L103(value)
      .flatMap((text) =>
        text
          .split(/\n+/g)
          .map((item) => item.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      )
      .filter((item) => item !== "[object Object]");

  const safetyMarkerRe = /^\s*\[(GEFAHR|WARNUNG|WARNHINWEIS)\]\s*/i;
  const hintMarkerRe = /^\s*\[(HINWEIS|INFO|NOTIZ)\]\s*/i;
  const stripSpecialMarker = (line: string) =>
    line.replace(safetyMarkerRe, "").replace(hintMarkerRe, "").trim();

  const rawGefahren =
    parsed.auftrag?.gefahren ??
    parsed.auftrag?.warnhinweise ??
    parsed.auftrag?.sicherheitswarnungen;
  // V17.90L255: `besonderheiten` is a deprecated compatibility field and is
  // never a canonical source. All first-AI operational facts come from the
  // exclusive structured role arrays captured above.
  const rawBesonderheiten: unknown[] = [];

  const rawGefahrenItems = toNoteArray(rawGefahren).filter(
    (line) => !isTechnicalIntakeMetaLineV17_90L17(line),
  );
  const rawBesonderheitenItems = toNoteArray(rawBesonderheiten).filter(
    (line) => !isTechnicalIntakeMetaLineV17_90L17(line),
  );

  const gefahrItemsFromBesonderheiten = rawBesonderheitenItems
    .filter((line) => safetyMarkerRe.test(line))
    .map(stripSpecialMarker)
    .filter(Boolean);

  const baseHinweisItems = rawBesonderheitenItems
    .filter((line) => !safetyMarkerRe.test(line))
    .map(stripSpecialMarker)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isTechnicalIntakeMetaLineV17_90L17(line))
    .filter(Boolean);

  const detectMultipleWorksiteReviewHint = (value: string): string | null => {
    const source = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const explicitNumberedSites =
      source.match(
        /^\s*(?:arbeitsort|ausführung|ausfuehrung|einsatzort|objekt)\s*\d+\s*:/gim,
      )?.length || 0;
    const genericSiteMarkers =
      source.match(
        /^\s*(?:arbeitsort|ausführung|ausfuehrung|einsatzort|objekt)\s*:/gim,
      )?.length || 0;

    if (explicitNumberedSites >= 2 || genericSiteMarkers >= 2) {
      return "Mehrere Arbeitsorte erkannt – bitte prüfen";
    }

    return null;
  };

  const structuredRoleHintsV17_90L86 = collectStructuredRoleHintsV17_90L86(
    parsed.auftrag,
  );
  const structuredAppointmentHintsV17_90L86 =
    buildStructuredAppointmentHintsV17_90L86(
      firstAiAppointmentsSnapshotV17_90L225 as AiAppointmentV17_90L86[],
      messageText,
      intakeAppointmentReferenceV17_90L271,
    );

  const semanticFallbackNotes = extractSemanticSpecialNotesFallback(
    [
      messageText,
      parsed.auftrag?.beschreibung,
      parsed.auftrag?.titel,
      Array.isArray(parsed.auftrag?.arbeitspositionen)
        ? parsed.auftrag.arbeitspositionen
            .map((item: any) =>
              [item?.name, item?.raw].filter(Boolean).join(" "),
            )
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    onsiteContactHint,
  );

  const hasStructuredSafetyRoles =
    rawGefahrenItems.length > 0 || gefahrItemsFromBesonderheiten.length > 0;
  const hasStructuredOrdinaryRoles =
    rawBesonderheitenItems.length > 0 ||
    structuredRoleHintsV17_90L86.length > 0 ||
    structuredAppointmentHintsV17_90L86.length > 0 ||
    Boolean(onsiteContactHint.hint) ||
    Boolean(firstAiCommunicationInstructionHintV17_90L265);
  const hasProtectedStructuredRolesV17_90L103 =
    hasStructuredSafetyRoles || hasStructuredOrdinaryRoles;

  // V17.90L104: Dedicated role arrays outrank the older general
  // `besonderheiten` array. If both contain the same business fact, keep the
  // dedicated role text once; do not serialize raw and translated variants.
  const protectedBaseHinweisItemsV17_90L104 =
    structuredRoleHintsV17_90L86.length > 0
      ? baseHinweisItems.filter(
          (line) =>
            !structuredRoleHintsV17_90L86.some((structuredLine) =>
              semanticRoleOverlapV17_90L87(line, structuredLine),
            ),
        )
      : baseHinweisItems;

  let gefahrItems: string[];
  let hinweisItems: string[];

  if (hasProtectedStructuredRolesV17_90L103) {
    // V17.90L103: First-AI role snapshot. No later classifier, cleaner or
    // keyword path may alter role assignment or wording.
    gefahrItems = dedupeProtectedStructuredRoleLinesV17_90L103([
      ...rawGefahrenItems.map(stripSpecialMarker),
      ...gefahrItemsFromBesonderheiten,
    ]);

    const dangerKeys = new Set(
      gefahrItems.map((line) => normalizeSemanticText(line)),
    );
    hinweisItems = dedupeProtectedStructuredRoleLinesV17_90L103([
      ...structuredRoleHintsV17_90L86,
      ...structuredAppointmentHintsV17_90L86,
      ...protectedBaseHinweisItemsV17_90L104,
      firstAiCommunicationInstructionHintV17_90L265 || "",
      onsiteContactHint.hint || "",
    ]).filter((line) => !dangerKeys.has(normalizeSemanticText(line)));
  } else {
    const structuredNonDangerRoleHintsV17_90L87 = dedupeSpecialNoteLines([
      ...structuredRoleHintsV17_90L86,
      firstAiCommunicationInstructionHintV17_90L265 || "",
      onsiteContactHint.hint || "",
    ]).filter(Boolean);

    gefahrItems = dedupeSpecialNoteLines([
      ...rawGefahrenItems.map(stripSpecialMarker),
      ...gefahrItemsFromBesonderheiten,
      ...semanticFallbackNotes.safetyWarnings,
    ])
      .map(cleanOperationalHintForwarderTailV17_90L70)
      .filter(Boolean)
      .filter((line) => !isTechnicalIntakeMetaLineV17_90L17(line))
      .filter((line) => !isNonActionableSpecialNoteCandidate(line))
      .filter(
        (line) =>
          !lineMatchesOnsiteContactIdentityV17_90L87(line, onsiteContactHint) &&
          !structuredNonDangerRoleHintsV17_90L87.some((normalRole) =>
            semanticRoleOverlapV17_90L87(line, normalRole),
          ),
      );

    hinweisItems = reconcileCommunicationSpecialNoteLines(
      dedupeSpecialNoteLines(
        [
          ...structuredRoleHintsV17_90L86,
          ...structuredAppointmentHintsV17_90L86,
          ...baseHinweisItems,
          ...semanticFallbackNotes.jobHints.map(canonicalizeSpecialNoteLine),
          firstAiCommunicationInstructionHintV17_90L265 || "",
          onsiteContactHint.hint || "",
        ]
          .map(canonicalizeSpecialNoteLine)
          .map(cleanOperationalHintForwarderTailV17_90L70)
          .filter(Boolean),
      ),
    )
      .filter((line) => !isTechnicalIntakeMetaLineV17_90L17(line))
      .filter((line) => !isNonActionableSpecialNoteCandidate(line))
      .filter((line) => !isNonActionablePlanningHint(line))
      .filter(
        (line) =>
          !gefahrItems.some(
            (danger) =>
              normalizeSemanticText(danger) === normalizeSemanticText(line),
          ),
      );

    const operationalLinesFromDangerV17_90L93 = gefahrItems.filter((line) => {
      const role = classifySpecialNoteRoleV17_90L93(line);
      return role !== "safety" && role !== "unknown";
    });
    gefahrItems = gefahrItems.filter((line) => {
      const role = classifySpecialNoteRoleV17_90L93(line);
      return role === "safety" || role === "unknown";
    });
    hinweisItems = dedupeSpecialNoteLines([
      ...hinweisItems,
      ...operationalLinesFromDangerV17_90L93,
    ]);

    if (!hasExplicitMailCommunicationInstructionV17_90L70(messageText)) {
      gefahrItems = gefahrItems.filter(
        (line) => !isGeneratedMailOnlyHintV17_90L70(line),
      );
      hinweisItems = hinweisItems.filter(
        (line) => !isGeneratedMailOnlyHintV17_90L70(line),
      );
    }

    gefahrItems = dedupeSpecialNoteLines(gefahrItems);
    hinweisItems = dedupeSpecialNoteLines(
      enrichParkingHintsV17_90L70(
        dedupeSpecialNoteLines(hinweisItems),
        messageText,
      ),
    );
  }

  // SMARTFLOW_V17_90L371AP: If the exact same line is already a cost position
  // (e.g. "Parkgebühr CHF 12"), it must not also be persisted as an operational
  // special note. Access/parking instructions without a cost position remain.
  const expensePositionSourceLinesV17_90L371AP = (
    firstAiWorkItemsSnapshotV17_90L213 as readonly any[]
  )
    .filter((item: any) => {
      const rawType = normalizePositionType(
        item?.positionType ?? item?.position_type ?? item?.type,
      );
      if (["expense", "disposal", "flat_fee"].includes(rawType)) return true;
      const source = String(item?.sourceText ?? item?.source_text ?? item?.evidence ?? "");
      const name = String(item?.serviceName ?? item?.name ?? item?.service_name ?? "");
      return normalizePositionType(
        classifyPositionTypeBeforeCanonicalLockV17_90L371AM({
          raw: item,
          serviceName: name,
          sourceText: source,
        }).positionType,
      ) === "expense";
    })
    .map((item: any) =>
      String(item?.sourceText ?? item?.source_text ?? item?.evidence ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  if (expensePositionSourceLinesV17_90L371AP.length > 0) {
    hinweisItems = hinweisItems.filter(
      (line) =>
        !expensePositionSourceLinesV17_90L371AP.some((sourceLine) =>
          isSameLineLocalFactV17_90L371AP(line, sourceLine) ||
          isSameBillableCostFactV17_90L371AR(line, sourceLine),
        ),
    );
  }

  // SMARTFLOW_V17_90L371AR: The onsite contact is persisted as its own
  // canonical field. Do not also serialize the same person as a second
  // operational hint, otherwise the UI shows "Kontakt" and "Kontakt vor Ort"
  // with the same name.
  if (onsiteContactHint?.contactName || onsiteContactHint?.hint) {
    hinweisItems = hinweisItems.filter(
      (line) => !lineMatchesOnsiteContactIdentityV17_90L87(line, onsiteContactHint),
    );
  }

  // V17.90L201: If original and normalized working text produced two
  // near-identical role statements, keep only one. Prefer the exact wording
  // present in the normalized German working text. No new fact is generated.
  hinweisItems = dedupeTranslatedRoleVariantsV17_90L201(
    hinweisItems,
    translationText,
  );

  // V17.90L202: The independent semantic checker may correct only the role of
  // an already existing, byte-preserved note before the canonical seal. It may
  // not rewrite text or invent a fact. Findings are already restricted to
  // high confidence; dogs remain protected by the checker itself.
  for (const finding of readOnlySpecialNoteRoleFindingsV17_90L106) {
    const findingKey = normalizeSemanticText(finding.text);
    if (!findingKey) continue;

    if (finding.expectedRole === "safety") {
      const index = hinweisItems.findIndex(
        (line) => normalizeSemanticText(line) === findingKey,
      );
      if (index >= 0) {
        const [line] = hinweisItems.splice(index, 1);
        gefahrItems = dedupeTranslatedRoleVariantsV17_90L201(
          [...gefahrItems, line],
          translationText,
        );
      }
    } else if (finding.currentRole === "safety") {
      const index = gefahrItems.findIndex(
        (line) => normalizeSemanticText(line) === findingKey,
      );
      if (index >= 0) {
        const [line] = gefahrItems.splice(index, 1);
        hinweisItems = dedupeTranslatedRoleVariantsV17_90L201(
          [...hinweisItems, line],
          translationText,
        );
      }
    }
  }

  const finalSpecialNotesText = buildSpecialNotes({
    safetyWarnings: gefahrItems,
    jobHints: hinweisItems,
    preserveStructuredRoles: hasProtectedStructuredRolesV17_90L103,
  });

  let finalSpecialNotes = hasProtectedStructuredRolesV17_90L103
    ? finalSpecialNotesText || null
    : preserveCanonicalStructuredRolesV17_90L88({
        specialNotes: finalSpecialNotesText || null,
        onsiteContact: onsiteContactHint,
        appointmentHints: structuredAppointmentHintsV17_90L86,
        structuredRoleHints: structuredRoleHintsV17_90L86,
      });

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03d_final_special_note_roles",
    {
      safetyWarnings: gefahrItems.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      ordinaryHints: hinweisItems.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      appointmentHints: structuredAppointmentHintsV17_90L86.map((line) =>
        redactIntakeDiagnosticText(line, 320),
      ),
      specialNotes: redactIntakeDiagnosticText(finalSpecialNotes, 1800),
    },
  );

  // --- Map services / AI work items, strict per-position matching ---

  type AiWorkItem = {
    serviceName?: string | null;
    name?: string | null;
    action_name?: string | null;
    context?: string | null;
    service_id?: string | null;
    service_name?: string | null;
    matched_service_id?: string | null;
    matched_service_name?: string | null;
    service_confidence?: "hoch" | "mittel" | "niedrig" | string | null;
    positionType?: string | null;
    position_type?: string | null;
    type?: string | null;
    quantity?: number | null;
    unit?: string | null;
    unitPrice?: number | string | null;
    price?: number | string | null;
    menge?: number | null;
    einheit?: string | null;
    unit_price?: number | string | null;
    currency?: string | null;
    raw?: string | null;
    evidence?: string | null;
    source_text?: string | null;
    confidence?: "hoch" | "mittel" | "niedrig" | string | null;
  };

  const normalizeServiceText = (value: any) =>
    String(value || "")
      .toLowerCase()
      .replace(/[ä]/g, "ae")
      .replace(/[ö]/g, "oe")
      .replace(/[ü]/g, "ue")
      .replace(/[ß]/g, "ss")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();


  const getFirstAiItemSourceTextV17_90L371AO = (rawItem: any): string =>
    compactExactSourceTextV17_90L251(
      rawItem?.sourceText ??
        rawItem?.source_text ??
        rawItem?.evidence ??
        rawItem?.raw ??
        rawItem?.description,
    );

  const getFirstAiItemNameV17_90L371AO = (rawItem: any): string =>
    compactExactSourceTextV17_90L251(
      rawItem?.serviceName ??
        rawItem?.name ??
        rawItem?.action_name ??
        rawItem?.service_name ??
        rawItem?.matched_service_name,
    );

  const getFirstAiItemPositionTypeV17_90L371AO = (rawItem: any): string =>
    normalizePositionType(
      rawItem?.positionType ?? rawItem?.position_type ?? rawItem?.type,
    );

  const hasOwnLinePriceEvidenceV17_90L371AO = (sourceTextValue: unknown, priceValue: number): boolean => {
    const source = compactExactSourceTextV17_90L251(sourceTextValue);
    if (!source || !Number.isFinite(priceValue) || priceValue <= 0) return false;
    const amounts = Array.from(
      source.matchAll(
        /(?:\b(?:chf|eur|euro|sfr|fr)\.?\s*([0-9][0-9'’]*(?:[.,][0-9]{1,2})?)\b|\b([0-9][0-9'’]*(?:[.,][0-9]{1,2})?)\s*(?:chf|eur|euro|sfr|fr)\.?\b)/giu,
      ),
    )
      .map((match) => Number(String(match[1] || match[2] || "").replace(/['’]/g, "").replace(",", ".")))
      .filter((value) => Number.isFinite(value) && value > 0);
    return amounts.some((amount) => Math.abs(amount - priceValue) < 0.01);
  };

  const extractLineLocalPositionNameFromSourceV17_90L371AO = (
    sourceTextValue: unknown,
    fallbackValue: unknown,
  ): string => {
    const source = compactExactSourceTextV17_90L251(sourceTextValue);
    const fallback = compactExactSourceTextV17_90L251(fallbackValue);
    if (!source) return fallback;

    const candidates = [
      source.replace(
        /\s*[,;:–—-]?\s+\d+(?:[.,]\d+)?\s+[\p{L}0-9%/²³._-]+(?:\s+[\p{L}0-9%/²³._-]+){0,3}\s*(?:à|@|\b(?:je|pro|per|par|por|at|each)\b|\b(?:chf|eur|euro|sfr|fr)\b).*$/iu,
        "",
      ),
      source.replace(/\s+\b(?:chf|eur|euro|sfr|fr)\.?\s*\d.*$/iu, ""),
      source.replace(/\s+\d+(?:[.,]\d+)?\s*\b(?:chf|eur|euro|sfr|fr)\.?\b.*$/iu, ""),
    ];

    const normalizedFallback = normalizeUnitText(fallback);
    const best = candidates
      .map((candidate) => candidate.replace(/[,:;–—.\s]+$/g, "").replace(/^[-–—,:;.\s]+/g, "").replace(/\s+/g, " ").trim())
      .filter((candidate) => candidate.length >= 3 && candidate.length <= 120)
      .find((candidate) => {
        const key = normalizeUnitText(candidate);
        return Boolean(key && (!normalizedFallback || normalizedFallback.includes(key) || key.includes(normalizedFallback) || source.toLocaleLowerCase("de-CH").includes(candidate.toLocaleLowerCase("de-CH"))));
      });

    return best || fallback;
  };

  const extractLineLocalUnitLabelFromSourceV17_90L371AO = (
    sourceTextValue: unknown,
    quantityValue: number,
  ): string | null => {
    const source = compactExactSourceTextV17_90L251(sourceTextValue);
    if (!source || !Number.isFinite(quantityValue) || quantityValue <= 0) return null;
    const quantityPattern = String(quantityValue).replace(/\.0+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\.", "[.,]");
    const match = source.match(
      new RegExp(
        `\\b${quantityPattern}\\s+([\\p{L}][\\p{L}0-9%/²³._-]*(?:\\s+[\\p{L}][\\p{L}0-9%/²³._-]*){0,2})\\s*(?:à|@|\\b(?:je|pro|per|par|por|at|each)\\b|\\b(?:chf|eur|euro|sfr|fr)\\b)`,
        "iu",
      ),
    );
    const label = cleanLineLocalUnitLabelV17_90L371AQ(match?.[1]);
    if (!label || /^\d/.test(label)) return null;
    if (/^(?:chf|eur|euro|sfr|fr|preis|betrag|kosten|à|a)$/iu.test(label)) return null;
    return label;
  };

  const sanitizeNonServiceFirstAiItemFromOwnSourceV17_90L371AO = (rawItem: AiWorkItem): AiWorkItem => {
    const positionType = getFirstAiItemPositionTypeV17_90L371AO(rawItem);
    if (!["material", "equipment", "expense", "disposal", "flat_fee", "other"].includes(positionType)) {
      return rawItem;
    }

    const sourceText = getFirstAiItemSourceTextV17_90L371AO(rawItem);
    const fallbackName = getFirstAiItemNameV17_90L371AO(rawItem);
    const quantity = Number((rawItem as any)?.quantity ?? (rawItem as any)?.menge ?? 0);
    const unitPrice = Number((rawItem as any)?.unitPrice ?? (rawItem as any)?.unit_price ?? (rawItem as any)?.price ?? 0);
    if (!sourceText || !fallbackName || !Number.isFinite(unitPrice) || unitPrice <= 0) return rawItem;

    const sourceName = extractLineLocalPositionNameFromSourceV17_90L371AO(sourceText, fallbackName);
    const cleanedName = cleanLineLocalCostPositionNameV17_90L371AP({
      positionType,
      sourceText,
      serviceName: sourceName,
    });
    const sourceUnit = extractLineLocalUnitLabelFromSourceV17_90L371AO(sourceText, quantity);

    const next: AiWorkItem = {
      ...rawItem,
      serviceName: cleanedName,
      name: cleanedName,
      action_name: cleanedName,
      service_name: cleanedName,
      matched_service_name: cleanedName,
    } as AiWorkItem;

    if (sourceUnit) {
      (next as any).unit = sourceUnit;
      next.einheit = sourceUnit;
    }

    return next;
  };

  const canKeepNonServiceFirstAiItemDespiteInvalidReviewV17_90L371AO = (
    rawItem: AiWorkItem | undefined,
    reasonValue: unknown,
  ): boolean => {
    if (!rawItem) return false;
    const positionType = getFirstAiItemPositionTypeV17_90L371AO(rawItem);
    if (!["material", "equipment", "expense", "disposal", "flat_fee", "other"].includes(positionType)) return false;

    const sourceText = getFirstAiItemSourceTextV17_90L371AO(rawItem);
    const serviceName = getFirstAiItemNameV17_90L371AO(rawItem);
    const quantity = Number((rawItem as any)?.quantity ?? (rawItem as any)?.menge ?? 0);
    const unitPrice = Number((rawItem as any)?.unitPrice ?? (rawItem as any)?.unit_price ?? (rawItem as any)?.price ?? 0);
    const reason = normalizeUnitText(reasonValue || "");

    if (!sourceText || !serviceName) return false;
    if (!Number.isFinite(quantity) || quantity <= 0) return false;
    if (!hasOwnLinePriceEvidenceV17_90L371AO(sourceText, unitPrice)) return false;
    if (!/(?:source text|sourcetext|evidence|belegt|beleg|quelle|quellzeile)/i.test(reason)) return false;
    if (/(?:kunde|customer|adresse|address|ausfuehrungsadresse|rechnungsadresse|firma|company)/i.test(reason)) return false;

    const cleanedName = extractLineLocalPositionNameFromSourceV17_90L371AO(sourceText, serviceName);
    const cleanedKey = normalizeUnitText(cleanedName);
    const sourceKey = normalizeUnitText(sourceText);
    return Boolean(cleanedKey && cleanedKey.length >= 3 && sourceKey.includes(cleanedKey));
  };

  const fullWorkText =
    parsed.auftrag?.beschreibung && String(parsed.auftrag.beschreibung).trim()
      ? String(parsed.auftrag.beschreibung)
      : messageText;

  const buildReviewServiceNameFromSourceV17_90L338 = (
    sourceTextValue: unknown,
    fallbackValue: unknown,
  ): string => {
    const sourceTextCompact = compactExactSourceTextV17_90L251(sourceTextValue);
    const fallbackCompact = compactExactSourceTextV17_90L251(fallbackValue);
    const withoutTrailingClarification = sourceTextCompact
      .replace(
        /\s*[,;–—-]\s*(?:preis|kosten|betrag|menge|anzahl|einheit|price|cost|amount|quantity|unit)\b.*$/iu,
        "",
      )
      .trim();
    const candidate = withoutTrailingClarification || sourceTextCompact || fallbackCompact;
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized.length >= 4 && normalized.length <= 140) return normalized;
    if (normalized.length > 140) return normalized.slice(0, 140).trim();
    return "Leistung prüfen";
  };

  // V17.90L252: The second AI is review-only. It may flag an existing first-AI
  // row, but it must never rename, replace or otherwise rewrite that row.
  const aiWorkItemsRaw: AiWorkItem[] = (
    firstAiWorkItemsSnapshotV17_90L213 as unknown as AiWorkItem[]
  ).map((item) => sanitizeNonServiceFirstAiItemFromOwnSourceV17_90L371AO({ ...item }));

  const invalidFindingReasonByIndexV17_90L371AO = new Map(
    finalAiWorkCoverageV17_90L251.invalidItems.map((finding) => [
      Number(finding.itemIndex),
      finding.reason,
    ]),
  );

  // V17.90L338: If the read-only coverage checker proves that a first-AI row
  // is not line-locally supported, that row must not enter the canonical
  // service list at all. It remains available only as an encoded red
  // recognition review below. This prevents invented labels such as
  // "Unbekannte Substanz entfernen" from being persisted as real work.
  const invalidFirstAiItemIndexesV17_90L338 = new Set(
    finalAiWorkCoverageV17_90L251.invalidItems
      .map((finding) => Number(finding.itemIndex))
      .filter((itemIndex) =>
        Number.isInteger(itemIndex) &&
        itemIndex >= 1 &&
        itemIndex <= aiWorkItemsRaw.length &&
        !canKeepNonServiceFirstAiItemDespiteInvalidReviewV17_90L371AO(
          aiWorkItemsRaw[itemIndex - 1],
          invalidFindingReasonByIndexV17_90L371AO.get(itemIndex),
        ),
      ),
  );

  // V17.90L361: A first-AI placeholder row is not a business service.
  // It is the same class of unresolved recognition as a missing-work finding:
  // keep the exact source text as a red "Leistung nicht erkannt" block, but
  // never persist placeholders such as "Leistung prüfen" as OrderItem rows.
  const isFirstAiReviewOnlyPlaceholderItemV17_90L361 = (rawItem: any): boolean => {
    const rawServiceName = compactExactSourceTextV17_90L251(
      rawItem?.serviceName ??
        rawItem?.name ??
        rawItem?.action_name ??
        rawItem?.service_name ??
        rawItem?.matched_service_name,
    );
    const serviceKey = normalizeUnitText(rawServiceName);
    const reviewReason = normalizeUnitText(
      rawItem?.reviewReason ?? rawItem?.review_reason ?? "",
    );
    const confidence = normalizeUnitText(
      rawItem?.confidence ?? rawItem?.service_confidence ?? "",
    );
    const rawUnit = compactExactSourceTextV17_90L251(
      rawItem?.unit ?? rawItem?.einheit,
    );
    const quantity = Number(rawItem?.quantity ?? rawItem?.menge ?? 0);
    const unitPrice = Number(
      rawItem?.unitPrice ?? rawItem?.unit_price ?? rawItem?.price ?? 0,
    );
    const sourceText = compactExactSourceTextV17_90L251(
      rawItem?.sourceText ??
        rawItem?.source_text ??
        rawItem?.evidence ??
        rawItem?.raw ??
        rawItem?.description,
    );

    const placeholderName =
      !rawServiceName ||
      isInternalReviewServiceNameV17_90L(rawServiceName) ||
      serviceKey === "unbekannte leistung" ||
      serviceKey === "unbekannt";
    const explicitPlaceholderReason =
      reviewReason === "service name missing" ||
      reviewReason === "service_name_missing" ||
      reviewReason === "unbekannte_leistung_pruefen" ||
      reviewReason === "unbekannte leistung pruefen" ||
      reviewReason === "unbekannte leistung prüfen";
    const valuesStillOpen =
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      !rawUnit ||
      isReviewUnitV17_90L(rawUnit) ||
      confidence === "niedrig" ||
      confidence === "low";

    return Boolean(
      sourceText &&
        (explicitPlaceholderReason || placeholderName) &&
        (placeholderName || valuesStillOpen),
    );
  };

  const reviewOnlyFirstAiItemIndexesV17_90L361 = new Set(
    aiWorkItemsRaw
      .map((rawItem, index) =>
        isFirstAiReviewOnlyPlaceholderItemV17_90L361(rawItem)
          ? index + 1
          : null,
      )
      .filter(
        (itemIndex): itemIndex is number =>
          Number.isInteger(itemIndex) &&
          itemIndex !== null &&
          itemIndex >= 1 &&
          itemIndex <= aiWorkItemsRaw.length,
      ),
  );

  const unsupportedFirstAiItemIndexesV17_90L361 = new Set([
    ...invalidFirstAiItemIndexesV17_90L338,
    ...reviewOnlyFirstAiItemIndexesV17_90L361,
  ]);

  // No parser fallback may manufacture workItems when the first AI returned
  // none. Unsupported first-AI rows are removed from the write path and kept
  // only as fail-closed recognition review findings until the user explicitly
  // accepts them in the editor.
  const aiWorkItems: AiWorkItem[] = aiWorkItemsRaw.filter(
    (_item, index) => !unsupportedFirstAiItemIndexesV17_90L361.has(index + 1),
  );

  // V17.90L252: The second AI and every rescue/validator after the first AI
  // are strictly review-only. Missing work becomes an encoded red control
  // finding in reviewReasons. It is NOT appended to the canonical item list.
  // Only a later explicit user action in the editor may create a new item.
  const semanticRecognitionReviewReasonsV17_90L252 =
    finalAiWorkCoverageV17_90L251.missingWork.map((finding) => {
      const payload = {
        kind: "missing_work",
        findingId: finding.semanticId,
        serviceName: "Leistung prüfen",
        quantity: 0,
        unit: "Einheit prüfen",
        unitPrice: 0,
        sourceText: finding.quote,
        relatedRoleText: finding.relatedRoleText,
      };
      return `${RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L252}${encodeURIComponent(
        JSON.stringify(payload),
      )}`;
    });

  const invalidFindingReasonByIndexV17_90L361 = new Map(
    finalAiWorkCoverageV17_90L251.invalidItems.map((finding) => [
      Number(finding.itemIndex),
      finding.reason,
    ]),
  );

  const invalidFirstAiItemReviewReasonsV17_90L252 =
    Array.from(unsupportedFirstAiItemIndexesV17_90L361)
      .sort((left, right) => left - right)
      .map((itemIndex) => {
        const rawItem = aiWorkItemsRaw[itemIndex - 1] as any;
        if (!rawItem) return null;
        const rawSourceText = compactExactSourceTextV17_90L251(
          rawItem?.sourceText ??
            rawItem?.source_text ??
            rawItem?.evidence ??
            rawItem?.raw ??
            rawItem?.description,
        );
        if (!rawSourceText) return null;
        const fallbackServiceName = compactExactSourceTextV17_90L251(
          rawItem?.serviceName ??
            rawItem?.name ??
            rawItem?.action_name ??
            rawItem?.service_name ??
            rawItem?.matched_service_name,
        );
        const serviceName = buildReviewServiceNameFromSourceV17_90L338(
          rawSourceText,
          fallbackServiceName,
        );
        const quantityValue = Number(rawItem?.quantity ?? rawItem?.menge ?? 0);
        const unitPriceValue = Number(
          rawItem?.unitPrice ?? rawItem?.unit_price ?? rawItem?.price ?? 0,
        );
        const wasInvalidItem = invalidFirstAiItemIndexesV17_90L338.has(itemIndex);
        const payload = {
          // Unsupported first-AI rows are presented as user-resolvable missing
          // work because the real persisted item was deliberately removed above.
          // The source quote stays exact; no invented service label is exposed
          // or used as the accept target.
          kind: "missing_work",
          originalKind: wasInvalidItem ? "invalid_item" : "placeholder_item",
          findingId: wasInvalidItem
            ? `invalid_item_${itemIndex}`
            : `placeholder_item_${itemIndex}`,
          serviceName,
          quantity: Number.isFinite(quantityValue) ? quantityValue : 0,
          unit: compactExactSourceTextV17_90L251(
            rawItem?.unit ?? rawItem?.einheit,
          ) || "Einheit prüfen",
          unitPrice: Number.isFinite(unitPriceValue) ? unitPriceValue : 0,
          sourceText: rawSourceText,
          relatedRoleText: null,
          reason:
            invalidFindingReasonByIndexV17_90L361.get(itemIndex) ||
            "First-AI-Platzhalter ist keine echte Leistung und wurde als Reviewblock gesichert.",
        };
        return `${RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L252}${encodeURIComponent(
          JSON.stringify(payload),
        )}`;
      })
      .filter((reason): reason is string => Boolean(reason));

  const genericEmptyFirstAiReviewReasonV17_90L252 =
    aiWorkItemsRaw.length === 0 &&
    semanticRecognitionReviewReasonsV17_90L252.length === 0
      ? ["intake_risk:priced_service_line_missing_or_mismatched"]
      : [];

  let canonicalAiOrderItemsBaseV17_90L234 =
    buildCanonicalAiOrderItemsV17_90L88(
      aiWorkItems,
      translationText,
      [messageText, parsed.auftrag?.beschreibung, parsed.auftrag?.titel]
        .filter(Boolean)
        .join("\n"),
    );

  if (canonicalAiOrderItemsBaseV17_90L234.length === 0) {
    const explicitExpenseFallbackRawItemsV17_90L371AR =
      buildExplicitPricedExpenseFallbackRawItemsV17_90L371AR(
        messageText,
        intakeCurrency,
      );
    if (explicitExpenseFallbackRawItemsV17_90L371AR.length > 0) {
      canonicalAiOrderItemsBaseV17_90L234 = buildCanonicalAiOrderItemsV17_90L88(
        explicitExpenseFallbackRawItemsV17_90L371AR,
        translationText,
        messageText,
      );
      console.info(
        `[${source}] ✅ explicit priced cost fallback kept ${canonicalAiOrderItemsBaseV17_90L234.length} billable cost item(s) before canonical lock`,
      );
    }
  }

  // V17.90L269: The price checker is strictly read-only and receives only
  // each item's own first-AI sourceText through the item object. It may create
  // separate review metadata, but it must never change the canonical service,
  // quantity, unit, price, currency, evidence, line total or item review state.
  const priceContradictionFindingsV17_90L234 =
    detectReadOnlyPriceContradictionsV17_90L234({
      originalText: "",
      translatedText: null,
      items: canonicalAiOrderItemsBaseV17_90L234,
    });
  const priceContradictionReviewReasonsV17_90L269 = Array.from(
    new Set(
      priceContradictionFindingsV17_90L234
        .map((finding) => String(finding.reason || "").trim())
        .filter(Boolean),
    ),
  );

  const canonicalAiOrderItemsV17_90L88 = Object.freeze(
    canonicalAiOrderItemsBaseV17_90L234.map((item) =>
      Object.freeze({ ...item }),
    ),
  ) as unknown as CanonicalAiOrderItemV17_90L88[];

  if (priceContradictionFindingsV17_90L234.length > 0) {
    console.warn(
      `[${source}] ⚠️ Read-only price contradiction review: ${priceContradictionFindingsV17_90L234
        .map(
          (finding) =>
            `${finding.serviceName}: total=${finding.totalAmount}, perUnit=${finding.perUnitAmount}, quantity=${finding.inferredQuantity ?? "unknown"}`,
        )
        .join(" | ")}`,
    );
  }

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03e_first_ai_structural_hydration",
    { items: summarizeIntakeDiagnosticItems(canonicalAiOrderItemsV17_90L88) },
  );
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "03f_readonly_price_contradiction_review",
    {
      findingCount: priceContradictionFindingsV17_90L234.length,
      findings: priceContradictionFindingsV17_90L234.map((finding) => ({
        itemIndex: finding.itemIndex + 1,
        serviceName: redactIntakeDiagnosticText(finding.serviceName, 180),
        totalAmount: finding.totalAmount,
        perUnitAmount: finding.perUnitAmount,
        inferredQuantity: finding.inferredQuantity,
        totalEvidence: redactIntakeDiagnosticText(finding.totalEvidence, 320),
        perUnitEvidence: redactIntakeDiagnosticText(
          finding.perUnitEvidence,
          320,
        ),
      })),
    },
  );

  const getWorkItemUnitType = (item: AiWorkItem): string => {
    const text = normalizeUnitText(
      [
        item.source_text,
        item.evidence,
        item.raw,
        item.name,
        item.context,
        item.einheit,
      ]
        .filter(Boolean)
        .join(" "),
    );

    if (
      /\b(pauschal|pauschale|pauschale abrechnung|fixpreis|festpreis)\b/i.test(
        text,
      )
    ) {
      return "flat";
    }

    const fromUnit = getServiceUnitType(item.einheit || null);
    if (fromUnit !== "unknown") return fromUnit;

    const q = detectAllQuantityUnitsFromText(
      [item.source_text, item.evidence, item.raw, item.name, item.context]
        .filter(Boolean)
        .join(" "),
    )[0];

    return q?.unit || "unknown";
  };

  const getWorkItemQuantity = (item: AiWorkItem): number => {
    if (
      typeof item.menge === "number" &&
      isFinite(item.menge) &&
      item.menge > 0
    ) {
      return item.menge;
    }

    const q = detectAllQuantityUnitsFromText(
      [item.source_text, item.evidence, item.raw, item.name, item.context]
        .filter(Boolean)
        .join(" "),
    )[0];

    return q?.value ?? 0;
  };

  const hasForbiddenServiceWorkConflict = (
    serviceName: string,
    workText: string,
  ): boolean => {
    const s = normalizeServiceText(serviceName);
    const w = normalizeServiceText(workText);

    const serviceIsHedge = /\b(hecke|hecken)\b/i.test(s);
    const workIsTree = /\b(baum|baeume|baume|bäume)\b/i.test(w);

    if (serviceIsHedge && workIsTree) return true;

    const serviceIsGreenWaste =
      /\b(gruenzeug|gruenabfall|gruengut|gartenabfall|grünzeug|grünabfall|grüngut)\b/i.test(
        s,
      );

    const workIsConstructionWaste =
      /\b(bauschutt|aushub|erde|beton|ziegel|steine|kies|schutt)\b/i.test(w);

    if (serviceIsGreenWaste && workIsConstructionWaste) return true;

    return false;
  };

  const serviceDomainMatchesWork = (
    serviceName: string,
    workText: string,
  ): boolean => {
    const s = normalizeServiceText(serviceName);
    const w = normalizeServiceText(workText);

    const domains = [
      {
        service: ["hecke", "hecken"],
        work: ["hecke", "hecken", "schneiden", "stutzen", "pflegen", "pflege"],
      },
      {
        service: ["wiese", "rasen"],
        work: ["wiese", "rasen", "maehen", "mahen", "mähen"],
      },
      {
        service: ["baum", "baeume"],
        work: ["baum", "baeume", "bäume", "faellen", "fällen", "schneiden"],
      },
      {
        service: ["entsorgung", "entsorgen", "abtransport", "aushub"],
        work: [
          "entsorgung",
          "entsorgen",
          "abtransport",
          "abtransportieren",
          "erde",
          "aushub",
          "bauschutt",
        ],
      },
      {
        service: ["fenster", "fensterreinigung"],
        work: [
          "fenster",
          "fensterreinigung",
          "vitre",
          "vitres",
          "fenetre",
          "fenetres",
          "window",
          "windows",
          "finestre",
          "ventanas",
          "reinigen",
          "reinigung",
          "clean",
          "cleaning",
          "nettoyage",
          "pulizia",
          "limpieza",
        ],
      },
      {
        service: ["boden", "garage", "garagenboden", "lagerboden"],
        work: [
          "boden",
          "floor",
          "sol",
          "pavimento",
          "suelo",
          "garage",
          "garagenboden",
          "lagerboden",
          "reinigen",
          "reinigung",
          "clean",
          "cleaning",
          "nettoyage",
          "pulizia",
          "limpieza",
        ],
      },
      {
        service: [
          "anfahrt",
          "fahrtkosten",
          "fahrkosten",
          "wegpauschale",
          "fahrpauschale",
        ],
        work: [
          "anfahrt",
          "fahrtkosten",
          "fahrkosten",
          "wegpauschale",
          "fahrpauschale",
          "deplacement",
          "déplacement",
          "travel",
          "travel fee",
          "trip",
          "transport",
          "trasferta",
          "transferta",
        ],
      },
    ];

    return domains.some((domain) => {
      const serviceHit = domain.service.some((token) => s.includes(token));
      const workHit = domain.work.some((token) => w.includes(token));
      return serviceHit && workHit;
    });
  };

  const normalizeAiConfidence = (value?: string | null) => {
    const normalized = normalizeServiceText(value || "");
    if (["hoch", "high", "sicher", "certain"].includes(normalized))
      return "hoch";
    if (["mittel", "medium", "wahrscheinlich", "probably"].includes(normalized))
      return "mittel";
    if (["niedrig", "low", "unsicher", "uncertain"].includes(normalized))
      return "niedrig";
    return "";
  };

  const findSemanticServiceForWorkItem = (
    item: AiWorkItem,
    services: any[],
  ) => {
    const confidence = normalizeAiConfidence(
      item.service_confidence || item.confidence || null,
    );

    // INTAKE_SEMANTIC_ENGINE_V12:
    // If the AI itself marks the service as uncertain, do not guess via token matching.
    if (confidence === "niedrig") return null;

    const explicitId = String(
      item.service_id || item.matched_service_id || "",
    ).trim();
    if (explicitId) {
      const byId = services.find(
        (service: any) => String(service.id) === explicitId,
      );
      if (byId) return byId;
    }

    const explicitName = String(
      item.service_name || item.matched_service_name || "",
    ).trim();

    if (explicitName) {
      const normalizedExplicitName = normalizeServiceText(explicitName);

      const exact = services.find(
        (service: any) =>
          normalizeServiceText(service.name) === normalizedExplicitName,
      );
      if (exact) return exact;

      // Allow a cautious near-exact match only when the AI is at least medium confident.
      const near = services.find((service: any) => {
        const serviceName = normalizeServiceText(service.name);
        return (
          serviceName.length >= 4 &&
          normalizedExplicitName.length >= 4 &&
          (serviceName.includes(normalizedExplicitName) ||
            normalizedExplicitName.includes(serviceName))
        );
      });

      if (near && confidence) return near;
    }

    return null;
  };

  const strictMatchServiceForWorkItem = (item: AiWorkItem, services: any[]) => {
    const workName = normalizeServiceText(
      item.action_name ||
        item.name ||
        item.service_name ||
        item.matched_service_name ||
        "",
    );
    const workRaw = normalizeServiceText(
      [item.raw, item.evidence, item.context].filter(Boolean).join(" "),
    );
    const workText = [workName, workRaw].filter(Boolean).join(" ");
    const workUnitType = getWorkItemUnitType(item);

    if (!workText || workText.length < 3) return null;

    const workTokens = workText
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 4 &&
          ![
            "eine",
            "einer",
            "eines",
            "einem",
            "einen",
            "mit",
            "der",
            "die",
            "das",
            "von",
            "ca",
            "circa",
            "etwa",
            "rund",
            "flaeche",
            "fläche",
            "gesamt",
            "gesamten",
            "test",
            "merge",
          ].includes(token),
      );

    let best: { service: any; score: number } | null = null;

    for (const service of services) {
      const serviceName = normalizeServiceText(service.name);
      const serviceUnitType = getServiceUnitType(service.unit);

      if (hasForbiddenServiceWorkConflict(service.name, workText)) {
        continue;
      }

      if (!serviceName) continue;

      const serviceTokens = serviceName
        .split(/\s+/)
        .filter((token: string) => token.length >= 4);

      // Schutz gegen kaputte Kurz-Leistungen wie "te".
      // Solche gespeicherten Alt-/Test-Leistungen dürfen nicht automatisch matchen.
      if (serviceName.length < 4 && serviceTokens.length === 0) continue;

      let score = 0;

      if (serviceName === workName) score += 100;

      // Enthalten-Matches nur bei ausreichend langen Begriffen.
      // Verhindert: serviceName "te" matcht auf "test merge".
      if (
        workName &&
        serviceName.length >= 4 &&
        workName.length >= 4 &&
        serviceName.includes(workName)
      ) {
        score += 75;
      }

      if (
        workName &&
        serviceName.length >= 4 &&
        workName.length >= 4 &&
        workName.includes(serviceName)
      ) {
        score += 75;
      }

      for (const token of serviceTokens) {
        if (workTokens.includes(token) || workText.includes(token)) {
          score += 30;
        }
      }

      if (serviceDomainMatchesWork(service.name, workText)) {
        score += 55;
      }

      // Einheit ist ein Sicherheits-Signal:
      // gleiche Einheit unterstützt, klare falsche Einheit blockiert eher.
      // So wird z.B. eine Stück-Position nicht nur wegen eines Ortswortes
      // auf eine Quadratmeter-/Stunden-Leistung gemappt.
      if (workUnitType !== "unknown") {
        if (workUnitType === serviceUnitType) {
          score += 25;
        } else if (serviceUnitType !== "unknown") {
          score -= 90;
        }
      }

      if (!best || score > best.score) {
        best = { service, score };
      }
    }

    if (!best || best.score < 60) return null;

    return best.service;
  };

  const mappedOrderItems = aiWorkItems
    .map((item) => {
      const raw = String(item.raw || item.name || "").trim();
      const detectedName = cleanDetectedWorkName(
        composeWorkNameSource(item, raw),
      );
      const structuredVisibleName = cleanStructuredAiServiceNameV17_90L76(
        item.name ||
          item.action_name ||
          item.service_name ||
          item.matched_service_name ||
          raw ||
          detectedName,
      );

      if (!detectedName || detectedName.length < 3) return null;

      const semanticMatchedService = findSemanticServiceForWorkItem(
        item,
        services,
      );
      const semanticConfidence = normalizeAiConfidence(item.confidence || null);
      const matchedServiceCandidate =
        semanticMatchedService ||
        (semanticConfidence === "niedrig"
          ? null
          : strictMatchServiceForWorkItem(item, services));
      // V17.90L76: Unit/price similarity is not semantic identity. Keep normal
      // catalog behavior only when the structured AI label and catalog label
      // share a concrete object/context token. Otherwise fail closed and leave
      // the correctly named row reviewable instead of linking a wrong service.
      const matchedService =
        matchedServiceCandidate &&
        structuredNameMatchesCatalogServiceV17_90L76(
          structuredVisibleName,
          String(matchedServiceCandidate.name || ""),
        )
          ? matchedServiceCandidate
          : null;
      const evidenceText = String(
        item.source_text || item.evidence || item.raw || "",
      ).trim();
      const originalLookupText = `${messageText}\n${fullWorkText}`;
      const matchedOriginalSegment =
        findOriginalSegmentForWorkItem(item, originalLookupText) ||
        findColonBlockForWorkItem(item, originalLookupText) ||
        "";
      const evidenceHasQuantityUnit =
        detectAllQuantityUnitsFromText(evidenceText).length > 0;
      const matchedSegmentHasQuantityUnit =
        detectAllQuantityUnitsFromText(matchedOriginalSegment).length > 0;

      const originalSegment =
        evidenceText && evidenceHasQuantityUnit
          ? evidenceText
          : matchedSegmentHasQuantityUnit
            ? matchedOriginalSegment
            : evidenceText || matchedOriginalSegment || "";

      const detectedUnitTypeFromItem = getWorkItemUnitType(item);
      const detectedQuantityFromItem = getWorkItemQuantity(item);
      const explicitQuantityRangeV17_90L121 =
        detectExplicitQuantityRangeV17_90L121(originalSegment);
      const originalQuantityMatch =
        detectAllQuantityUnitsFromText(originalSegment)[0] || null;

      const detectedUnitType =
        detectedUnitTypeFromItem !== "unknown"
          ? detectedUnitTypeFromItem
          : explicitQuantityRangeV17_90L121?.unit ||
            originalQuantityMatch?.unit ||
            "unknown";

      const detectedQuantity = explicitQuantityRangeV17_90L121
        ? 0
        : detectedQuantityFromItem > 0
          ? detectedQuantityFromItem
          : originalQuantityMatch?.value || 0;

      const detectedUnitPrice = detectUnitPriceForWorkItem(
        item,
        `${messageText}\n${fullWorkText}`,
      );

      if (matchedService) {
        const serviceUnit = String(matchedService.unit || "Stunde");
        const serviceUnitType = getServiceUnitType(serviceUnit);
        const hasExplicitDetectedUnit =
          detectedUnitType !== "unknown" && detectedQuantity > 0;

        const unit = hasExplicitDetectedUnit
          ? unitTypeToDisplayUnit(detectedUnitType)
          : serviceUnit;

        const unitType = getServiceUnitType(unit);
        const catalogUnitPrice = Number(matchedService.defaultPrice || 0);
        const priceSearchText = `${raw} ${originalSegment}`;

        const hasLooseCurrencyAmount =
          /\b\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€|usd|dollar|\$|gbp|pfund|£)\b/i.test(
            priceSearchText,
          ) ||
          /\b(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€|usd|dollar|\$|gbp|pfund|£)\s*\d+(?:[.,]\d{1,2})?\b/i.test(
            priceSearchText,
          );

        const hasAmbiguousLinePrice =
          hasAmbiguousCompactLinePrice(priceSearchText);
        const hasExplicitUnitPrice = Boolean(
          detectedUnitPrice && detectedUnitPrice > 0,
        );
        const hasNoPriceSignal =
          /\b(ohne\s+preis|ohne\s+preisangabe|kein\s+preis|keine\s+preisangabe|preis\s+offen|preis\s+folgt|preis\s+laut\s+offerte|laut\s+offerte|nach\s+aufwand)\b/i.test(
            priceSearchText,
          );

        const shouldBlockCatalogFallback =
          (hasLooseCurrencyAmount ||
            hasAmbiguousLinePrice ||
            hasNoPriceSignal) &&
          !hasExplicitUnitPrice;

        // V17.09 STRUCTURED_INTAKE_FAIL_CLOSED:
        // Die KI muss Menge/Einheit/Preis pro Arbeitsposition selbst
        // strukturiert liefern. Der Code darf nicht mehr still den
        // Katalogpreis oder die Katalogeinheit als sichere Kundentext-Daten
        // einsetzen, wenn die Position dafür keine eigene Evidence hat.
        const serviceNameForReview = String(
          matchedService.name || "Unbekannte Leistung",
        );
        const isFlatServiceUnit = serviceUnitType === "flat";
        const hasOwnQuantityEvidence = detectedQuantity > 0;
        const hasOwnUnitEvidence = detectedUnitType !== "unknown";
        const hasOwnPriceEvidence = hasExplicitUnitPrice;

        const unitPrice = hasOwnPriceEvidence ? Number(detectedUnitPrice) : 0;

        const priceOverrideDetected =
          hasOwnPriceEvidence &&
          catalogUnitPrice > 0 &&
          Math.abs(unitPrice - catalogUnitPrice) >= 0.01;

        const quantityValidation = validateQuantityAgainstServiceUnit({
          serviceUnit: unit,
          detectedValue: detectedQuantity,
          detectedUnit:
            detectedUnitType !== "unknown" ? detectedUnitType : null,
          serviceName: matchedService.name,
        });
        const mismatchDetected =
          hasExplicitDetectedUnit && serviceUnitType !== detectedUnitType;

        const structuredReviewReasons: string[] = [];

        if (mismatchDetected) {
          structuredReviewReasons.push(
            `unit_mismatch:${serviceNameForReview}:${serviceUnit}:${unit}:${detectedQuantity}`,
          );
        } else if (!isFlatServiceUnit && !hasOwnUnitEvidence) {
          structuredReviewReasons.push(
            `unit_mismatch:${serviceNameForReview}:Unklar:${serviceUnit}:0`,
          );
        }

        if (!isFlatServiceUnit && !hasOwnQuantityEvidence) {
          structuredReviewReasons.push(
            explicitQuantityRangeV17_90L121
              ? `quantity_range_review:${explicitQuantityRangeV17_90L121.min}:${explicitQuantityRangeV17_90L121.max}:${serviceNameForReview}`
              : "quantity_review",
          );
        }

        if (!hasOwnPriceEvidence) {
          structuredReviewReasons.push(
            `price_unclear:${serviceNameForReview}`,
            "unit_price_review",
          );
        } else if (priceOverrideDetected) {
          structuredReviewReasons.push(
            `price_override:${serviceNameForReview}:${catalogUnitPrice}:${unitPrice}`,
          );
        }

        if (shouldBlockCatalogFallback) {
          structuredReviewReasons.push(`price_unclear:${serviceNameForReview}`);
        }

        const reviewReason =
          structuredReviewReasons[0] || quantityValidation.reason || null;

        const explicitHourLineRepair = findExplicitHourLineRepairForMappedItem(
          {
            serviceName:
              structuredVisibleName !== "Unbekannte Leistung"
                ? structuredVisibleName
                : String(matchedService.name || "Unbekannte Leistung"),
            description: String(
              raw || detectedName || fullWorkText || `${source}-Auftrag`,
            ),
            quantity: quantityValidation.quantity,
            unit,
            unitPrice,
            totalPrice: unitPrice * quantityValidation.quantity,
            needsReview:
              structuredReviewReasons.length > 0 ||
              quantityValidation.needsReview,
            reviewReason,
            sourceText: originalSegment || raw || null,
            evidence: item.evidence || item.source_text || evidenceText || null,
            detectedCurrency: item.currency || null,
          },
          originalLookupText,
        );

        const finalMappedQuantity =
          explicitHourLineRepair?.quantity || quantityValidation.quantity;
        const finalMappedUnit = explicitHourLineRepair ? "Stunde" : unit;
        const finalMappedUnitPrice = explicitHourLineRepair?.price || unitPrice;
        const finalMappedSourceText =
          explicitHourLineRepair?.raw || originalSegment || raw || null;
        const finalMappedEvidence =
          explicitHourLineRepair?.raw ||
          item.evidence ||
          item.source_text ||
          null;
        const effectiveStructuredReviewReasons = explicitHourLineRepair
          ? structuredReviewReasons.filter(
              (reason) =>
                reason !== "quantity_review" &&
                reason !== "unit_price_review" &&
                !reason.startsWith("price_unclear:") &&
                !/^unit_mismatch:[^:]+:Unklar:/i.test(reason),
            )
          : structuredReviewReasons;
        const effectiveReviewReason =
          effectiveStructuredReviewReasons[0] ||
          (explicitHourLineRepair ? null : quantityValidation.reason) ||
          null;

        return {
          serviceName:
            structuredVisibleName !== "Unbekannte Leistung"
              ? structuredVisibleName
              : formatWorkNameForDisplay(
                  String(matchedService.name || "Unbekannte Leistung"),
                ),
          description: String(
            raw || detectedName || fullWorkText || `${source}-Auftrag`,
          ),

          quantity: finalMappedQuantity,
          unit: finalMappedUnit,
          unitPrice: finalMappedUnitPrice,
          totalPrice: roundIntakeMoney(
            finalMappedUnitPrice * finalMappedQuantity,
          ),
          needsReview:
            effectiveStructuredReviewReasons.length > 0 ||
            (!explicitHourLineRepair && quantityValidation.needsReview),
          reviewReason: effectiveReviewReason,
          sourceText: finalMappedSourceText,
          evidence: finalMappedEvidence,
          detectedCurrency: item.currency || null,
        };
      }

      const unit =
        detectedUnitType !== "unknown"
          ? unitTypeToDisplayUnit(detectedUnitType)
          : unitTypeToDisplayUnit(getServiceUnitType(item.einheit || null));

      const cleanedDetectedName =
        structuredVisibleName !== "Unbekannte Leistung"
          ? structuredVisibleName
          : formatWorkNameForDisplay(
              detectedName || "Unbekannte Leistung",
            );

      // V17.90L77: Do not reject a valid structured service name merely
      // because it contains more than six words. Longer room/context labels are
      // legitimate. Only empty/implausibly long labels fail closed.
      const finalServiceName =
        cleanedDetectedName.length < 4 || cleanedDetectedName.length > 120
          ? "Unbekannte Leistung"
          : cleanedDetectedName;

      const confidence = normalizeAiConfidence(item.confidence || null);
      const safeUnitPrice =
        confidence === "niedrig" ? 0 : detectedUnitPrice || 0;
      const safeQuantity =
        confidence === "niedrig" || explicitQuantityRangeV17_90L121
          ? 0
          : detectedQuantity || 0;

      return {
        serviceName: finalServiceName,
        description: String(
          raw || detectedName || fullWorkText || `${source}-Auftrag`,
        ),
        quantity: safeQuantity,
        unit: unit || "Pauschal",
        unitPrice: safeUnitPrice,
        totalPrice: safeUnitPrice * safeQuantity,
        needsReview: true,
        reviewReason: explicitQuantityRangeV17_90L121
          ? `quantity_range_review:${explicitQuantityRangeV17_90L121.min}:${explicitQuantityRangeV17_90L121.max}:${finalServiceName}`
          : "unbekannte_leistung_pruefen",
        sourceText: originalSegment || raw || null,
        evidence: item.evidence || item.source_text || null,
        detectedCurrency: item.currency || null,
      };
    })
    .filter(Boolean) as Array<{
    serviceName: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    needsReview: boolean;
    reviewReason: string | null;
    sourceText?: string | null;
    evidence?: string | null;
    detectedCurrency?: string | null;
  }>;
  const hasHourQuantityInText = detectAllQuantityUnitsFromText(
    messageText,
  ).some((q) => q.unit === "hour");

  const hasHourItemAlready = mappedOrderItems.some(
    (item) => getServiceUnitType(item.unit) === "hour",
  );

  const hasMaterialLiterItem = mappedOrderItems.some(
    (item) => getServiceUnitType(item.unit) === "liter",
  );

  const firstHourQuantity = detectAllQuantityUnitsFromText(messageText).find(
    (q) => q.unit === "hour",
  );

  const mappedOrderItemsWithHourSafety =
    hasHourQuantityInText &&
    !hasHourItemAlready &&
    hasMaterialLiterItem &&
    firstHourQuantity
      ? [
          {
            serviceName: "Reinigung",
            description: String(
              messageText || fullWorkText || `${source}-Auftrag`,
            ),
            quantity: firstHourQuantity.value,
            unit: "Stunde",
            unitPrice: 0,
            totalPrice: 0,
            needsReview: true,
            reviewReason: "stunden_arbeitsposition_pruefen",
          },
          ...mappedOrderItems,
        ]
      : mappedOrderItems;

  const messageHasCleaningMaterialSignal =
    /\b(liter|ltr\.?|reinigungsmittel|reiniger|spezialreiniger|produkt|mittel)\b/i.test(
      normalizeUnitText(messageText),
    );

  const cleanedMappedOrderItemsWithHourSafety =
    mappedOrderItemsWithHourSafety.filter((item) => {
      const name = normalizeUnitText(item.serviceName);
      const unitType = getServiceUnitType(item.unit);

      const isCleaningMaterial =
        unitType === "liter" &&
        /\b(reinigungsmittel|reiniger|spezialreiniger)\b/i.test(name);

      if (isCleaningMaterial && !messageHasCleaningMaterialSignal) {
        return false;
      }

      return true;
    });

  const allFirstAiRowsWereInvalidV17_90L338 =
    aiWorkItemsRaw.length > 0 &&
    aiWorkItems.length === 0 &&
    unsupportedFirstAiItemIndexesV17_90L361.size > 0;

  let finalOrderItems: Array<{
    serviceName: string;
    positionType?: string | null;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    needsReview: boolean;
    reviewReason: string | null;
    sourceText?: string | null;
    evidence?: string | null;
    detectedCurrency?: string | null;
  }> =
    cleanedMappedOrderItemsWithHourSafety.length > 0
      ? cleanedMappedOrderItemsWithHourSafety
      : allFirstAiRowsWereInvalidV17_90L338
        ? []
        : [
            {
              serviceName: formatWorkNameForDisplay(
                parsed.auftrag?.titel || "Unbekannte Leistung",
              ),
              description: String(fullWorkText || `${source}-Auftrag`),
              quantity: 0,
              unit: "Pauschal",
              unitPrice: 0,
              totalPrice: 0,
              needsReview: true,
              reviewReason: "unbekannte_leistung_pruefen",
            },
          ];

  const structuredOrderItemSnapshotsV17_90L76 = finalOrderItems.map(
    (item) => ({ ...item }),
  );

  // V17.90L60: Rebuild explicit priced service rows from their own source
  // lines before validation. This keeps every source line independent.
  finalOrderItems = reconcileExplicitPricedServiceLinesV17_90L60(
    finalOrderItems,
    messageText,
  );
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "04_pre_validation_items",
    { items: summarizeIntakeDiagnosticItems(finalOrderItems) },
  );

  const validationSourceText = [
    messageText,
    fullWorkText,
    translationText
      ? `--- Übersetzung (automatisch) ---\n${translationText}`
      : "",
  ]
    .filter((part) => String(part || "").trim())
    .join("\n");

  // V17.90L105: The legacy repair validator is now shadow-only.
  // It still runs on a detached copy so we can compare its findings in logs,
  // but none of its rewritten items or review reasons may enter the persisted
  // order. The first structured AI result plus deterministic technical guards
  // remain the only write path.
  const shadowValidationStartMsV17_90L337 = Date.now();
  const shadowIntakeValidationV17_90L105 = validateAndRepairParsedOrderItems({
    items: finalOrderItems.map((item) => ({ ...item })),
    originalText: validationSourceText,
    fallbackCurrency: intakeCurrency,
  });
  markIntakePerfV17_90L337("05_shadow_validation_done", {
    durationMs: Date.now() - shadowValidationStartMsV17_90L337,
    itemCount: shadowIntakeValidationV17_90L105.items.length,
    needsReview: shadowIntakeValidationV17_90L105.needsReview,
  });

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "05_shadow_validation_result",
    {
      finalCurrency: shadowIntakeValidationV17_90L105.finalCurrency,
      needsReview: shadowIntakeValidationV17_90L105.needsReview,
      reviewReasons: shadowIntakeValidationV17_90L105.reviewReasons.slice(0, 40),
      items: summarizeIntakeDiagnosticItems(
        shadowIntakeValidationV17_90L105.items,
      ),
    },
  );

  // V17.90L252: Empty first-AI workItems remain empty. No validator, parser
  // or rescue path may create canonical rows. A separate red recognition
  // review reason is persisted instead and only an explicit user action may
  // turn that finding into a real item.
  if (canonicalAiOrderItemsV17_90L88.length === 0) {
    console.warn(
      `[${source}] 🔒 First AI returned no workItems; canonical item list remains empty`,
    );
  }

  const normalizeAuthoritativeCurrencyV17_90L105 = (
    value: unknown,
  ): "CHF" | "EUR" | null => {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "CHF" || normalized === "EUR" ? normalized : null;
  };

  const explicitCurrencySourceV17_90L105 =
    stripNegatedCurrencyMentionsForIntake(validationSourceText);
  const authoritativeDetectedCurrenciesV17_90L105 = Array.from(
    new Set(
      [
        ...canonicalAiOrderItemsV17_90L88.map((item) =>
          normalizeAuthoritativeCurrencyV17_90L105(item.detectedCurrency),
        ),
        ...finalOrderItems.map((item) =>
          normalizeAuthoritativeCurrencyV17_90L105(item.detectedCurrency),
        ),
        hasExplicitCurrencyAmountForIntake(
          explicitCurrencySourceV17_90L105,
          INTAKE_CHF_WORDS_FOR_CURRENCY,
        )
          ? "CHF"
          : null,
        hasExplicitCurrencyAmountForIntake(
          explicitCurrencySourceV17_90L105,
          INTAKE_EUR_WORDS_FOR_CURRENCY,
        )
          ? "EUR"
          : null,
      ].filter((value): value is "CHF" | "EUR" => Boolean(value)),
    ),
  );

  if (authoritativeDetectedCurrenciesV17_90L105.length === 0) {
    authoritativeDetectedCurrenciesV17_90L105.push(intakeCurrency);
  }

  // Compatibility object for the existing deterministic guards below.
  // Important: items/reviewReasons come from the pre-validator write source,
  // never from the legacy repair validator.
  const intakeValidation = {
    items: finalOrderItems.map((item) => ({ ...item })),
    reviewReasons: [] as string[],
    needsReview: finalOrderItems.some((item) => Boolean(item.needsReview)),
    finalCurrency: intakeCurrency,
    detectedCurrencies: authoritativeDetectedCurrenciesV17_90L105,
  };

  console.info(
    `[${source}] 💤 Legacy repair validator shadow-only: ` +
      `inputItems=${finalOrderItems.length} ` +
      `shadowItems=${shadowIntakeValidationV17_90L105.items.length} ` +
      `shadowFindings=${shadowIntakeValidationV17_90L105.reviewReasons.length}`,
  );

  // V17.90L102: The normal validation pass supplies explicit unresolved
  // candidates. The read-only second checker may additionally compare strict,
  // line-local priced/open-price statements against the final canonical list,
  // but it has no write access to services, amounts or customer data.
  const secondaryRecognitionCandidatesV17_90L91 = Array.from(
    new Map(
      [
        ...intakeValidation.items,
        ...extractExplicitUnresolvedWorkRecognitionCandidatesV17_90L99(
          validationSourceText,
          intakeValidation.finalCurrency,
        ),
      ]
        .filter((item) => {
          const reason = String(item.reviewReason || "");
          const evidence = String(
            item.sourceText || item.evidence || item.description || "",
          )
            .replace(/\s+/g, " ")
            .trim();
          return (
            Number(item.unitPrice || 0) <= 0 &&
            reason.startsWith("price_unclear:") &&
            evidence.length > 0 &&
            evidence.length <= 240
          );
        })
        .filter((item) => {
          const candidateEvidenceKey = canonicalEvidenceKeyV17_90L88(
            item.sourceText || item.evidence || item.description,
          );
          if (!candidateEvidenceKey) return true;

          const coveredByCanonicalOpenPrice = canonicalAiOrderItemsV17_90L88.some(
            (canonical) => {
              const canonicalEvidenceKey = canonicalEvidenceKeyV17_90L88(
                canonical.sourceText || canonical.evidence || canonical.description,
              );
              const sameEvidence = Boolean(
                canonicalEvidenceKey &&
                  (canonicalEvidenceKey === candidateEvidenceKey ||
                    (canonicalEvidenceKey.length >= 12 &&
                      candidateEvidenceKey.length >= 12 &&
                      (canonicalEvidenceKey.includes(candidateEvidenceKey) ||
                        candidateEvidenceKey.includes(canonicalEvidenceKey)))),
              );
              const canonicalPriceOpen = Boolean(
                Number(canonical.unitPrice || 0) <= 0 &&
                  String(canonical.reviewReason || "").startsWith(
                    "price_unclear:",
                  ) &&
                  canonical.serviceName &&
                  !isInternalReviewServiceNameV17_90L(canonical.serviceName),
              );
              return sameEvidence && canonicalPriceOpen;
            },
          );

          return !coveredByCanonicalOpenPrice;
        })
        .map((item) => [
          [
            normalizeUnitText(item.serviceName),
            normalizeUnitText(
              item.sourceText || item.evidence || item.description || "",
            ),
          ].join("|"),
          { ...item },
        ] as const),
    ).values(),
  );

  const recognitionCandidateIdentityV17_90L101 = (item: any) =>
    [
      canonicalServiceKeyV17_90L88(item?.serviceName),
      canonicalEvidenceKeyV17_90L88(
        item?.sourceText || item?.evidence || item?.description,
      ),
    ].join("|");

  const validatorOnlyRecognitionKeysV17_90L101 = new Set(
    secondaryRecognitionCandidatesV17_90L91
      .filter((candidate) => {
        const candidateKey = recognitionCandidateIdentityV17_90L101(candidate);
        const cameFromValidation = intakeValidation.items.some(
          (item) => recognitionCandidateIdentityV17_90L101(item) === candidateKey,
        );
        if (!cameFromValidation) return false;

        // A complete first-AI position remains a real editable order item.
        // Only an open-price position invented by the later validator is moved
        // into the read-only Übernehmen/Verwerfen proposal channel.
        return !canonicalAiOrderItemsV17_90L88.some(
          (canonical) =>
            canonicalItemMatchScoreV17_90L88(
              canonical,
              candidate,
              intakeValidation.finalCurrency,
            ) >= 55,
        );
      })
      .map(recognitionCandidateIdentityV17_90L101),
  );

  const validationItemsForPersistV17_90L101 = intakeValidation.items.filter(
    (item) =>
      !validatorOnlyRecognitionKeysV17_90L101.has(
        recognitionCandidateIdentityV17_90L101(item),
      ),
  );

  finalOrderItems = repairExplicitHourQuantitiesFromOriginalText(
    validationItemsForPersistV17_90L101,
    validationSourceText,
  );

  // INTAKE_FLAT_TOTAL_LAST_GUARD_V8
  // Letzte Schutzschicht direkt vor Speichern: Pauschalpositionen haben
  // fachlich keine echte Menge, müssen aber mit Menge 1 gespeichert werden,
  // damit OrderItem.totalPrice und Order.totalPrice nicht fälschlich 0 bleiben.
  finalOrderItems = finalOrderItems.map((item) => {
    const unitType = getServiceUnitType(item.unit);
    const unitPriceValue = Number(item.unitPrice || 0);

    if (
      unitType !== "flat" ||
      !Number.isFinite(unitPriceValue) ||
      unitPriceValue <= 0
    ) {
      return item;
    }

    const reviewReason = item.reviewReason || null;
    const onlyQuantityReview =
      reviewReason &&
      /menge|quantity|leistung_ist_pauschal|pauschal|pruefen|prüfen/i.test(
        reviewReason,
      );

    return {
      ...item,
      quantity: 1,
      totalPrice: Math.round((unitPriceValue + Number.EPSILON) * 100) / 100,
      needsReview: onlyQuantityReview ? false : item.needsReview,
      reviewReason: onlyQuantityReview ? null : item.reviewReason,
    };
  });

  // V16.96: Run the explicit-hour repair once more as the final service-line
  // guard before totals are calculated. This catches remaining zero-quantity
  // hour rows after all validation and flat-item normalization steps.
  finalOrderItems = repairExplicitHourQuantitiesFromOriginalText(
    finalOrderItems,
    validationSourceText,
  );

  // V17.00: absolutely last explicit-hour repair before totals and persistence.
  // This fixes rows that still arrive as Stunde + price + quantity 0 directly
  // before OrderItem.create, after every parser/validation step has finished.
  finalOrderItems = repairExplicitHourQuantitiesBeforePersist(
    finalOrderItems,
    validationSourceText,
  );

  // V17.03: shared cross-route repair, same helper used by WhatsApp queue and
  // Orders API. This is the final in-memory correction before totals and
  // OrderItem.create, independent from shortened AI evidence like "Std. à CHF".
  finalOrderItems = repairZeroQuantityHourItemsFromText(
    finalOrderItems,
    validationSourceText,
    {
      logPrefix: "[INTAKE_HOUR_SHARED_FIX_V17_07]",
      // V17.43: Pauschal-/Anfahrtszeilen werden bereits line-local im
      // Validator aus dem normalisierten Leistungsteil erstellt. Die alte
      // Nachreparatur darf keine zweite "Anfahrts"-Position mehr anhängen.
      skipFlatFeeRepair: true,
    },
  ).items;

  // V17.10: Finaler KI-Struktur-Schutz direkt vor der Totalberechnung.
  // Wenn der Kundentext zwar Menge + Preis, aber keine Einheit enthält
  // (z. B. "42 à CHF 7"), darf keine KI-/Katalog-/Repair-Schicht daraus
  // still eine Stunde/m2/Stück-Position mit berechnetem Total machen.
  const unitlessQuantityGuardBeforePersist =
    applyUnitlessQuantityPriceLineGuard(finalOrderItems, validationSourceText);
  finalOrderItems = unitlessQuantityGuardBeforePersist.items;

  // V17.90L: sichtbare Leistungsnamen müssen deutsch sein. Wenn die automatische
  // Übersetzung eine eindeutige line-local Servicezeile mit gleicher Menge und
  // gleichem Preis enthält, ersetzt sie fremdsprachige Rohlabels vor Persistenz.
  finalOrderItems = repairGermanVisibleServiceNamesFromTranslationV17_90L(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L5: Fail-closed for generic floor rows. If the original customer
  // evidence line only says "Boden/floor/..." with quantity and price but no
  // explicit work action, do not silently turn it into "Boden reinigen".
  finalOrderItems = blockGenericFloorRowsWithoutExplicitActionV17_90L5(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L9: Any quantity/price row without an explicit work action in the
  // original customer line must stay fail-closed. This prevents invented
  // services like "Boden reinigen" or "Kleine Gegenstände reinigen" from
  // being priced when the customer only wrote "alles machen" / "kleine Sachen".
  finalOrderItems = blockAmbiguousRowsWithoutExplicitActionV17_90L9(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L2: final visible-name cleanup. Service names must not contain the
  // numeric quantity/unit/price fragment; those belong in the separate fields.
  finalOrderItems = finalOrderItems.map((item: any) => {
    const serviceName = compactText(item?.serviceName);
    const serviceKey = normalizeUnitText(serviceName);
    const unitKey = normalizeUnitText(item?.unit || "");
    const unitPriceNumber = Number(item?.unitPrice || 0);
    const totalPriceNumber = Number(item?.totalPrice || 0);
    let nextItem = item;

    // Blocked foreign-currency flat fees must not inherit quantity from a
    // neighboring service line. Keep them visibly blocked, but default a flat
    // fee quantity to 1 instead of an arbitrary leaked value such as 2.
    if (
      serviceKey.includes("anfahrt") &&
      unitKey === "pauschal" &&
      (!Number.isFinite(unitPriceNumber) || unitPriceNumber <= 0) &&
      (!Number.isFinite(totalPriceNumber) || totalPriceNumber <= 0)
    ) {
      nextItem = { ...nextItem, quantity: 1 };
    }

    if (!serviceName || isInternalReviewServiceNameV17_90L(serviceName))
      return nextItem;
    const cleanedName =
      stripMeasureAndPriceFromVisibleServiceNameV17_90L(serviceName);
    return cleanedName && cleanedName !== serviceName
      ? { ...nextItem, serviceName: cleanedName }
      : nextItem;
  });

  // V17.90L3: Restore units only from an explicit line-local unit+quantity+price evidence line.
  // This keeps "52 à CHF 7" blocked, but fixes explicit "48 m2 à CHF 6" rows.
  finalOrderItems = repairReviewUnitsFromLineLocalEvidenceV17_90L3(
    finalOrderItems,
    validationSourceText,
  );

  finalOrderItems = blockGenericFloorRowsWithoutExplicitActionV17_90L5(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L9: Any quantity/price row without an explicit work action in the
  // original customer line must stay fail-closed. This prevents invented
  // services like "Boden reinigen" or "Kleine Gegenstände reinigen" from
  // being priced when the customer only wrote "alles machen" / "kleine Sachen".
  finalOrderItems = blockAmbiguousRowsWithoutExplicitActionV17_90L9(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L4: In mixed-currency messages, explicit CHF service lines must stay
  // calculable while the foreign-currency line is blocked. If the AI did not
  // attach detectedCurrency to a row, infer it only from a same-line quantity
  // + price + currency evidence line. No cross-line fallback.
  finalOrderItems = applyLineLocalCurrenciesFromEvidenceV17_90L4(
    finalOrderItems,
    validationSourceText,
  );

  // V17.11: Allerletzter Summen-Blocker vor Order.create.
  // Rote Prüfpositionen dürfen zwar Menge/Preis als Hinweis behalten, aber
  // niemals in Order.totalPrice/OrderItem.totalPrice eingerechnet werden.
  finalOrderItems = applyFinalAmountBlockersBeforePersist(finalOrderItems, {
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });

  // V17.80: absolute letzte Absicherung nach allen Repair-/Validator-Pässen.
  // Wenn eine Einheit offen ist, bleibt Menge/Preis als Hinweis sichtbar, aber
  // die Position darf nicht in Netto/MwSt./Total laufen. Das verhindert Fälle
  // wie "Lagerraum Boden 42 à CHF 7" -> Total CHF 294 trotz Einheit prüfen.
  finalOrderItems = finalOrderItems.map((item) => {
    const unitKey = normalizeUnitText(item.unit || "");
    const reviewKey = normalizeUnitText(
      [
        item.unit,
        item.description,
        item.sourceText,
        item.evidence,
        item.reviewReason,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const serviceName =
      String(item.serviceName || "Unbekannte Leistung").trim() ||
      "Unbekannte Leistung";
    const unitStillOpen =
      unitKey === "pruefen" ||
      unitKey === "prufen" ||
      unitKey.includes("einheit pruefen") ||
      unitKey.includes("einheit prufen") ||
      reviewKey.includes("einheit fehlt") ||
      reviewKey.includes("unit missing") ||
      String(item.reviewReason || "").startsWith("unit_missing_in_text:") ||
      String(item.reviewReason || "").startsWith("unit_mismatch:");

    if (!unitStillOpen) return item;

    return {
      ...item,
      unit: "Einheit prüfen",
      totalPrice: 0,
      needsReview: true,
      reviewReason: item.reviewReason || `unit_missing_in_text:${serviceName}`,
    };
  });

  // V17.90L4: The final blockers may still see stale review text from an
  // earlier pass. Re-apply the strict same-line unit repair after them so an
  // explicit "48 m2 à CHF 6" line is counted, while "52 à CHF 7" stays blocked.
  finalOrderItems = repairReviewUnitsFromLineLocalEvidenceV17_90L3(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L5: Unit repair must not revive generic floor rows without an
  // explicit action in the original customer evidence line.
  finalOrderItems = blockGenericFloorRowsWithoutExplicitActionV17_90L5(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L9: Any quantity/price row without an explicit work action in the
  // original customer line must stay fail-closed. This prevents invented
  // services like "Boden reinigen" or "Kleine Gegenstände reinigen" from
  // being priced when the customer only wrote "alles machen" / "kleine Sachen".
  finalOrderItems = blockAmbiguousRowsWithoutExplicitActionV17_90L9(
    finalOrderItems,
    validationSourceText,
  );

  // Re-run final blockers after the late unit restoration. This keeps restored
  // explicit-unit rows calculable and keeps unresolved rows fail-closed.
  finalOrderItems = applyFinalAmountBlockersBeforePersist(finalOrderItems, {
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });

  // V17.90L3: Normalize blocked foreign-currency flat-fee display rows after
  // the final blockers so quantity/source cannot leak from a neighbouring line.
  finalOrderItems = repairBlockedFlatFeeCurrencyRowsV17_90L3(
    finalOrderItems,
    validationSourceText,
  );

  // V17.90L40: Letzte Persistenz-Sicherung gegen doppelte rote Felder.
  // Wenn eine konkrete Fremdwährungs-Prüfposition existiert, darf daneben
  // keine leere generische "Leistung prüfen"-Zeile aus demselben Evidence-
  // Fragment gespeichert werden. Eigenständige unklare Leistungen mit eigener
  // konkreter Evidence bleiben erhalten.
  const finalCurrencyForDuplicateGuard = intakeValidation.finalCurrency;
  const foreignReviewItemsForDuplicateGuard = finalOrderItems.filter((item) => {
    const detected = String(item.detectedCurrency || "")
      .trim()
      .toUpperCase();
    const reason = String(item.reviewReason || "");
    return Boolean(
      (detected && detected !== finalCurrencyForDuplicateGuard) ||
        reason.startsWith("item_currency_mismatch:") ||
        reason.startsWith("currency_conflict_item:"),
    );
  });

  if (foreignReviewItemsForDuplicateGuard.length > 0) {
    const foreignEvidence = foreignReviewItemsForDuplicateGuard
      .map((item) =>
        normalizeUnitText(
          [item.sourceText, item.evidence, item.description]
            .filter(Boolean)
            .join(" "),
        ),
      )
      .filter(Boolean);

    finalOrderItems = finalOrderItems.filter((item) => {
      if (foreignReviewItemsForDuplicateGuard.includes(item)) return true;
      if (!isInternalReviewServiceNameV17_90L(item.serviceName || ""))
        return true;
      if (Number(item.unitPrice || 0) > 0 || Number(item.totalPrice || 0) > 0)
        return true;

      const evidence = normalizeUnitText(
        [item.sourceText, item.evidence, item.description]
          .filter(Boolean)
          .join(" "),
      );
      const hasSpecificEvidence =
        evidence.length >= 18 &&
        !/^(?:leistung|einheit|preis|menge).*(?:unklar|pruefen|prüfen)$/.test(
          evidence,
        );
      const duplicatesForeignEvidence = foreignEvidence.some((foreign) =>
        Boolean(
          foreign &&
            evidence &&
            (evidence.includes(foreign) || foreign.includes(evidence)),
        ),
      );

      return hasSpecificEvidence && !duplicatesForeignEvidence;
    });
  }

  // V17.90L43: Nach ALLEN Repair-/Validator-Pfaden nochmals gegen die
  // Originalnachricht abgleichen. So kann ein späterer Repair-Pfad nicht aus
  // derselben EUR-/USD-/GBP-Quelle zusätzlich „Reisekosten“ UND „Anfahrt“
  // persistieren.
  finalOrderItems = dedupeForeignCurrencyReviewItemsByOriginalSourceV17_90L43(
    finalOrderItems,
    messageText,
    intakeValidation.finalCurrency,
  );

  // V17.90L61: Absolute line-local persistence guard. Some later validator
  // passes can still merge two explicit source rows with the same price or
  // transfer quantity/price evidence to a neighbouring service. Rebuild the
  // explicitly priced rows one final time immediately before totals and
  // persistence, then re-apply currency blockers. This guarantees one saved
  // position per explicit source line without reviving foreign-currency rows.
  finalOrderItems = reconcileExplicitPricedServiceLinesV17_90L60(
    finalOrderItems,
    messageText,
  ).map((item) => ({
    ...item,
    serviceName: normalizeVisibleServiceNameCasingV17_66(item.serviceName),
  }));
  finalOrderItems = applyLineLocalCurrenciesFromEvidenceV17_90L4(
    finalOrderItems,
    validationSourceText,
  );
  finalOrderItems = applyFinalAmountBlockersBeforePersist(finalOrderItems, {
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });
  finalOrderItems = dedupeForeignCurrencyReviewItemsByOriginalSourceV17_90L43(
    finalOrderItems,
    messageText,
    intakeValidation.finalCurrency,
  );

  // V17.90L76: Restore only uniquely identifiable, line-local structured AI
  // rows after all parser/validator passes. Exact unit+quantity+price+currency
  // identity prevents cross-line leakage and removes generated duplicates.
  finalOrderItems = restoreUniqueStructuredOrderItemsV17_90L76(
    structuredOrderItemSnapshotsV17_90L76,
    finalOrderItems,
    intakeValidation.finalCurrency,
  );
  finalOrderItems = cleanVisibleReviewInstructionSuffixV17_90L76(
    finalOrderItems,
  );
  finalOrderItems = removeGeneratedReviewDuplicatesByEvidenceV17_90L77(
    finalOrderItems,
  );
  finalOrderItems = restoreExplicitSourceActionV17_90L81(finalOrderItems);
  finalOrderItems = dedupeEquivalentSourceRowsV17_90L81(finalOrderItems);
  finalOrderItems = applyLineLocalCurrenciesFromEvidenceV17_90L4(
    finalOrderItems,
    validationSourceText,
  );
  finalOrderItems = applyFinalAmountBlockersBeforePersist(finalOrderItems, {
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
  });
  finalOrderItems = dedupeForeignCurrencyReviewItemsByOriginalSourceV17_90L43(
    finalOrderItems,
    messageText,
    intakeValidation.finalCurrency,
  );


  // V17.90L88: Absolute persistence boundary. Restore the validated semantic
  // LLM rows after every legacy repair/validator pass. The later pipeline may
  // keep review flags, but it may no longer silently delete Anfahrt, shorten
  // service actions or attach a neighbouring source line.
  finalOrderItems = reconcileWithCanonicalAiItemsV17_90L88(
    canonicalAiOrderItemsV17_90L88,
    finalOrderItems,
    intakeValidation.finalCurrency,
    messageText,
  );
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "05b_canonical_lock",
    {
      canonicalCount: canonicalAiOrderItemsV17_90L88.length,
      stable: canonicalItemsStableAfterValidationV17_90L89(
        canonicalAiOrderItemsV17_90L88,
        finalOrderItems,
        intakeValidation.finalCurrency,
      ),
      items: summarizeIntakeDiagnosticItems(finalOrderItems),
    },
  );
  // V17.90L252: No mutating helper runs after the first-AI item graph is
  // restored. Foreign-currency and missing-field blockers are already derived
  // inside reconcileWithCanonicalAiItemsV17_90L88 without changing any first-AI
  // business value. From here onward the graph is verification-only.

  // V17.90L98 / V17.90L235: Final source-of-truth invariant.
  // No step after the canonical lock may silently alter a first-AI row.
  //
  // L235 changes only the failure handling:
  // - the mutated post-lock candidate is discarded;
  // - the last safe canonical rows are restored unchanged;
  // - only the affected rows are blocked with total 0.00 and a visible review;
  // - the order is still created so the original customer message, customer,
  //   address, contact, appointment and operational facts remain available.
  // A still-unrecoverable invariant continues to throw and is caught by the
  // queue-level raw-review fallback, so no WhatsApp message disappears.
  let canonicalPersistenceViolationV17_90L98 = false;
  let canonicalMutationRecoveryReasonsV17_90L235: string[] = [];
  if (
    canonicalAiOrderItemsV17_90L88.length > 0 &&
    !canonicalItemsStableAfterValidationV17_90L89(
      canonicalAiOrderItemsV17_90L88,
      finalOrderItems,
      intakeValidation.finalCurrency,
    )
  ) {
    finalOrderItems = reconcileWithCanonicalAiItemsV17_90L88(
      canonicalAiOrderItemsV17_90L88,
      finalOrderItems,
      intakeValidation.finalCurrency,
      messageText,
    );
    canonicalPersistenceViolationV17_90L98 =
      !canonicalItemsStableAfterValidationV17_90L89(
        canonicalAiOrderItemsV17_90L88,
        finalOrderItems,
        intakeValidation.finalCurrency,
      );
  }

  if (
    canonicalPersistenceViolationV17_90L98 &&
    canonicalAiOrderItemsV17_90L88.length > 0
  ) {
    const unsafePostLockItemsV17_90L235 = finalOrderItems.map((item) => ({
      ...item,
    }));
    const orderedCanonicalItemsV17_90L235 = [
      ...canonicalAiOrderItemsV17_90L88,
    ].sort((left, right) => left.canonicalOrder - right.canonicalOrder);

    const canonicalMutationFindingsV17_90L235 =
      orderedCanonicalItemsV17_90L235.map((canonical, index) => {
        const candidate = unsafePostLockItemsV17_90L235[index];
        const fields: string[] = [];
        if (!candidate) {
          fields.push("missing_item");
        } else {
          const expectedCurrency = String(
            canonical.detectedCurrency || intakeValidation.finalCurrency || "",
          )
            .trim()
            .toUpperCase();
          const actualCurrency = String(
            candidate.detectedCurrency ||
              intakeValidation.finalCurrency ||
              "",
          )
            .trim()
            .toUpperCase();
          const expectedEvidence = String(
            canonical.sourceText ||
              canonical.evidence ||
              canonical.description ||
              "",
          )
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trim();
          const actualEvidence = String(
            candidate.sourceText ||
              candidate.evidence ||
              candidate.description ||
              "",
          )
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trim();

          if (
            String(candidate.serviceName || "").trim() !==
            String(canonical.serviceName || "").trim()
          ) {
            fields.push("service_name");
          }
          if (
            Math.abs(
              Number(candidate.quantity || 0) -
                Number(canonical.quantity || 0),
            ) >= 0.0001
          ) {
            fields.push("quantity");
          }
          if (
            String(candidate.unit || "").trim() !==
            String(canonical.unit || "").trim()
          ) {
            fields.push("unit");
          }
          if (
            Math.abs(
              Number(candidate.unitPrice || 0) -
                Number(canonical.unitPrice || 0),
            ) >= 0.0001
          ) {
            fields.push("unit_price");
          }
          if (actualCurrency !== expectedCurrency) {
            fields.push("currency");
          }
          if (actualEvidence !== expectedEvidence) {
            fields.push("source_text");
          }
        }

        return fields.length > 0
          ? {
              index,
              serviceName:
                String(canonical.serviceName || "").trim() ||
                `Leistung ${index + 1}`,
              fields,
            }
          : null;
      }).filter(Boolean) as Array<{
        index: number;
        serviceName: string;
        fields: string[];
      }>;

    if (
      unsafePostLockItemsV17_90L235.length >
      orderedCanonicalItemsV17_90L235.length
    ) {
      canonicalMutationFindingsV17_90L235.push({
        index: -1,
        serviceName: "Leistungsliste",
        fields: ["extra_item"],
      });
    }

    const mutationByIndexV17_90L235 = new Map(
      canonicalMutationFindingsV17_90L235.map((finding) => [
        finding.index,
        finding,
      ]),
    );

    // Restore directly from the safe canonical rows. Do not run any later
    // mutating amount/unit repair again on this recovery path.
    finalOrderItems = reconcileWithCanonicalAiItemsV17_90L88(
      canonicalAiOrderItemsV17_90L88,
      [],
      intakeValidation.finalCurrency,
      messageText,
    ).map((item, index) => {
      const finding = mutationByIndexV17_90L235.get(index);
      if (!finding) return item;

      const recoveryReason = `canonical_mutation_blocked:${finding.serviceName}`;
      canonicalMutationRecoveryReasonsV17_90L235.push(recoveryReason);
      return {
        ...item,
        totalPrice: 0,
        needsReview: true,
        // Preserve a concrete existing uncertainty reason (for example
        // unit_missing_in_text) and expose the blocked mutation globally.
        reviewReason: item.reviewReason || recoveryReason,
      };
    });

    for (const finding of canonicalMutationFindingsV17_90L235) {
      if (finding.index >= 0) continue;
      canonicalMutationRecoveryReasonsV17_90L235.push(
        `canonical_mutation_blocked:${finding.serviceName}`,
      );
    }
    canonicalMutationRecoveryReasonsV17_90L235 = Array.from(
      new Set(canonicalMutationRecoveryReasonsV17_90L235),
    );
    canonicalPersistenceViolationV17_90L98 =
      !canonicalItemsStableAfterValidationV17_90L89(
        canonicalAiOrderItemsV17_90L88,
        finalOrderItems,
        intakeValidation.finalCurrency,
      );

    logIntakeDiagnosticTrace(
      intakeDiagnosticTraceEnabled,
      intakeDiagnosticTraceId,
      "05d_canonical_mutation_recovered",
      {
        recovered: !canonicalPersistenceViolationV17_90L98,
        findings: canonicalMutationFindingsV17_90L235.map((finding) => ({
          itemIndex: finding.index + 1,
          serviceName: redactIntakeDiagnosticText(
            finding.serviceName,
            180,
          ),
          fields: finding.fields,
        })),
        items: summarizeIntakeDiagnosticItems(finalOrderItems),
      },
    );

    if (!canonicalPersistenceViolationV17_90L98) {
      console.error(
        `[${source}] 🛟 Canonical mutation blocked and recovered as review order: ${canonicalMutationFindingsV17_90L235
          .map(
            (finding) =>
              `${finding.serviceName}[${finding.fields.join(",")}]`,
          )
          .join(" | ")}`,
      );
    }
  }

  const canonicalPostLockActiveV17_90L209 = Boolean(
    !canonicalPersistenceViolationV17_90L98 &&
      canonicalItemsStableAfterValidationV17_90L89(
        canonicalAiOrderItemsV17_90L88,
        finalOrderItems,
        intakeValidation.finalCurrency,
      ),
  );

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "05c_final_source_of_truth",
    {
      canonicalCount: canonicalAiOrderItemsV17_90L88.length,
      stable: canonicalPostLockActiveV17_90L209,
      recoveredAsReview:
        canonicalMutationRecoveryReasonsV17_90L235.length > 0,
      items: summarizeIntakeDiagnosticItems(finalOrderItems),
    },
  );
  if (canonicalPersistenceViolationV17_90L98) {
    console.error(
      `[${source}] canonical persistence invariant unresolved after safe recovery`,
    );
  }
  if (!canonicalPostLockActiveV17_90L209) {
    throw new Error(
      "CANONICAL_FIRST_AI_MUTATION_BLOCK:service_items",
    );
  }

  // V17.90L209: Freeze the stable item graph immediately after 05c. From this
  // point onward only detached diagnostic copies may be inspected; the exact
  // canonical values used for the snapshot and database cannot be mutated.
  if (canonicalPostLockActiveV17_90L209) {
    finalOrderItems = Object.freeze(
      finalOrderItems.map((item) => Object.freeze({ ...item })),
    ) as unknown as typeof finalOrderItems;
  }

  const aiExecutionAddress = firstAiExecutionAddressSnapshotV17_90L225;
  const executionAddressCustomerContext = {
    customerAddress: addr.street || resolvedCustomerMaster?.address || null,
    customerPlz: addr.plz || resolvedCustomerMaster?.plz || null,
    customerCity: addr.city || resolvedCustomerMaster?.city || null,
  };

  const legacyAddressFallbackEnabled =
    process.env.INTAKE_LEGACY_ADDRESS_FALLBACK === "1";
  const aiStructuredExecutionAddress = extractAiStructuredExecutionAddress(
    aiExecutionAddress,
    executionAddressCustomerContext,
    validationSourceText,
  );
  const explicitPartialExecutionAddressFallback =
    legacyAddressFallbackEnabled
      ? extractExecutionAddressFromText(
          validationSourceText,
          executionAddressCustomerContext,
        )
      : null;
  // V17.90L194: The first-AI execution-address object is the protected
  // source of truth. Whole-message address recreation is disabled by default;
  // it is available only behind the explicit legacy environment switch.
  let protectedExecutionAddressCandidateV17_90L103 =
    aiStructuredExecutionAddress ||
    (legacyAddressFallbackEnabled
      ? explicitPartialExecutionAddressFallback
      : null);

  if (
    legacyAddressFallbackEnabled &&
    aiStructuredExecutionAddress &&
    explicitPartialExecutionAddressFallback
  ) {
    protectedExecutionAddressCandidateV17_90L103 = {
      siteName: preferOriginalExecutionSiteNameV17_90L199({
        aiAddress: aiStructuredExecutionAddress,
        originalAddress: explicitPartialExecutionAddressFallback,
      }),
      siteAddress:
        aiStructuredExecutionAddress.siteAddress ||
        explicitPartialExecutionAddressFallback.siteAddress ||
        null,
      sitePlz:
        aiStructuredExecutionAddress.sitePlz ||
        explicitPartialExecutionAddressFallback.sitePlz ||
        null,
      siteCity:
        aiStructuredExecutionAddress.siteCity ||
        explicitPartialExecutionAddressFallback.siteCity ||
        null,
      siteNote:
        aiStructuredExecutionAddress.siteNote ||
        explicitPartialExecutionAddressFallback.siteNote ||
        null,
    };
  }

  let extractedExecutionAddress = sanitizeExtractedExecutionAddress(
    protectedExecutionAddressCandidateV17_90L103,
    validationSourceText,
    { preservePopulatedAiFields: Boolean(aiStructuredExecutionAddress) },
  );

  // V17.90L229: Restore only a single leading Unicode letter that is present
  // on the exact source street line and was omitted by the structured AI value
  // (for example Überlandstrasse -> berlandstrasse). No broader address parser
  // may overwrite a populated first-AI street.
  if (extractedExecutionAddress?.siteAddress) {
    const restoredStreetV17_90L229 =
      restoreExecutionStreetLeadingCharacterV17_90L229({
        currentStreet: extractedExecutionAddress.siteAddress,
        originalText: messageText,
        translatedText: translationText,
      });
    if (restoredStreetV17_90L229) {
      extractedExecutionAddress = {
        ...extractedExecutionAddress,
        siteAddress: restoredStreetV17_90L229,
      };
    }
  }

  // V17.90L85: Complete only missing address fields from the verified reused
  // customer when street and city identify the same place. This keeps a real
  // work-area label such as "Treppenhaus Haus B" while preventing "in Baden"
  // and a missing PLZ from creating an artificial address review.
  if (
    legacyAddressFallbackEnabled &&
    !firstAiExecutionAddressSnapshotV17_90L225 &&
    extractedExecutionAddress &&
    resolvedCustomerMaster
  ) {
    const normalizedSiteCity = cleanIntakeCityCandidate(
      extractedExecutionAddress.siteCity,
    );
    const sameStreet = Boolean(
      extractedExecutionAddress.siteAddress &&
        resolvedCustomerMaster.address &&
        normalizeUnitText(extractedExecutionAddress.siteAddress) ===
          normalizeUnitText(resolvedCustomerMaster.address),
    );
    const cityCompatible = Boolean(
      !normalizedSiteCity ||
        !resolvedCustomerMaster.city ||
        normalizeUnitText(normalizedSiteCity) ===
          normalizeUnitText(resolvedCustomerMaster.city),
    );

    if (sameStreet && cityCompatible) {
      extractedExecutionAddress = {
        ...extractedExecutionAddress,
        sitePlz:
          extractedExecutionAddress.sitePlz ||
          resolvedCustomerMaster.plz ||
          null,
        siteCity:
          normalizedSiteCity || resolvedCustomerMaster.city || null,
      };
    }
  }

  // V17.90L60: Preserve the explicit object/site descriptor that appears
  // directly before the structured execution address. Generic placeholders
  // such as "Ausführungsadresse" must not replace a real property name.
  const explicitExecutionSiteDescriptor =
    originalExecutionSiteDescriptorFromTextV17_50(validationSourceText);
  if (
    legacyAddressFallbackEnabled &&
    !firstAiExecutionAddressSnapshotV17_90L225 &&
    extractedExecutionAddress &&
    explicitExecutionSiteDescriptor &&
    (!extractedExecutionAddress.siteName ||
      isBrokenExecutionSiteRoleFragmentV17_90L176(
        extractedExecutionAddress.siteName,
      ))
  ) {
    // V17.90L103: Original-text parsing may fill a missing object name, but it
    // may not replace the populated first-AI site name.
    extractedExecutionAddress = {
      ...extractedExecutionAddress,
      siteName: explicitExecutionSiteDescriptor,
    };
  }

  // V17.90L66: "gleiche Adresse" is authoritative. Keep an optional
  // work-area label, but always use the verified billing street/PLZ/city and
  // discard AI fragments such as greetings or e-mail words from the address.
  if (
    hasSameAddressInstructionV17_90L28(validationSourceText) &&
    executionAddressCustomerContext.customerAddress &&
    executionAddressCustomerContext.customerPlz &&
    executionAddressCustomerContext.customerCity
  ) {
    // V17.90L225: Same-address instructions may only retain a work-area name
    // that the first structured AI address object explicitly supplied. The raw
    // sentence is never reparsed into a site label; therefore phrases such as
    // "keine separate Ausführungsadresse anlegen" cannot create "anlegen".
    const firstAiSameAddressSiteNameV17_90L225 =
      cleanExecutionSiteNameCandidate(
        normalizeStructuredTextField(
          (firstAiExecutionAddressSnapshotV17_90L225 as any)?.name,
        ),
      );
    const billingIdentityNameV17_90L230 = cleanAiStructuredBillingName(
      (firstAiCustomerSnapshotV17_90L225 as any)?.name ||
        resolvedCustomerMaster?.name ||
        null,
    );
    const explicitWorkAreaV17_90L230 = sameAddressWorkAreaDescriptorV17_66(
      validationSourceText,
    );
    const firstAiSiteKeyV17_90L230 = normalizeUnitText(
      firstAiSameAddressSiteNameV17_90L225 || "",
    );
    const billingNameKeyV17_90L230 = normalizeUnitText(
      billingIdentityNameV17_90L230 || "",
    );
    const explicitWorkAreaKeyV17_90L230 = normalizeUnitText(
      explicitWorkAreaV17_90L230 || "",
    );
    const siteNameIsBillingIdentityV17_90L230 = Boolean(
      firstAiSiteKeyV17_90L230 &&
        billingNameKeyV17_90L230 &&
        firstAiSiteKeyV17_90L230 === billingNameKeyV17_90L230,
    );
    const siteNameHasExplicitWorkAreaEvidenceV17_90L230 = Boolean(
      firstAiSiteKeyV17_90L230 &&
        explicitWorkAreaKeyV17_90L230 &&
        (firstAiSiteKeyV17_90L230 === explicitWorkAreaKeyV17_90L230 ||
          firstAiSiteKeyV17_90L230.includes(explicitWorkAreaKeyV17_90L230) ||
          explicitWorkAreaKeyV17_90L230.includes(firstAiSiteKeyV17_90L230)),
    );
    extractedExecutionAddress =
      firstAiSameAddressSiteNameV17_90L225 &&
      !siteNameIsBillingIdentityV17_90L230 &&
      siteNameHasExplicitWorkAreaEvidenceV17_90L230
        ? {
            siteName: firstAiSameAddressSiteNameV17_90L225,
            siteAddress: executionAddressCustomerContext.customerAddress,
            sitePlz: executionAddressCustomerContext.customerPlz,
            siteCity: executionAddressCustomerContext.customerCity,
            siteNote: null,
          }
        : null;
  }

  if (
    extractedExecutionAddress &&
    legacyAddressFallbackEnabled &&
    !firstAiExecutionAddressSnapshotV17_90L225
  ) {
    const enrichedSiteNameV17_90L203 = enrichExecutionSiteNameFromEvidenceV17_90L203({
      currentName: extractedExecutionAddress.siteName,
      siteAddress: extractedExecutionAddress.siteAddress,
      originalText: messageText,
      translatedText: translationText,
    });
    extractedExecutionAddress = {
      ...extractedExecutionAddress,
      siteName: trimDanglingExecutionSiteConnectorV17_90L208({
        siteName: enrichedSiteNameV17_90L203,
        siteAddress: extractedExecutionAddress.siteAddress,
      }),
    };
  }

  if (
    extractedExecutionAddress &&
    !extractedExecutionAddress.siteName &&
    sameStructuredAddress({
      aStreet: extractedExecutionAddress.siteAddress,
      aPlz: extractedExecutionAddress.sitePlz,
      aCity: extractedExecutionAddress.siteCity,
      bStreet: executionAddressCustomerContext.customerAddress,
      bPlz: executionAddressCustomerContext.customerPlz,
      bCity: executionAddressCustomerContext.customerCity,
    })
  ) {
    extractedExecutionAddress = null;
  }

  // V17.90L361: A normal top billing block such as
  // "Neuer Auftrag für: Firma / Strasse / PLZ Ort" must not later become an
  // execution address just because the work text contains local area words
  // like Eingang, Archiv, Nebenraum or Lagerraum. Without an explicit execution
  // marker, a same-as-billing execution object is a false positive even when
  // the AI populated siteName with the customer name.
  const hasExplicitExecutionAddressMarkerV17_90L361 = Boolean(
    hasExecutionAddressDirectiveV17_61(validationSourceText) ||
      hasSameAddressInstructionV17_90L28(validationSourceText),
  );
  if (
    extractedExecutionAddress &&
    !hasExplicitExecutionAddressMarkerV17_90L361 &&
    sameStructuredAddress({
      aStreet: extractedExecutionAddress.siteAddress,
      aPlz: extractedExecutionAddress.sitePlz,
      aCity: extractedExecutionAddress.siteCity,
      bStreet: executionAddressCustomerContext.customerAddress,
      bPlz: executionAddressCustomerContext.customerPlz,
      bCity: executionAddressCustomerContext.customerCity,
    })
  ) {
    console.warn(
      `[${source}] 🔒 same-as-billing execution address without explicit marker suppressed`,
    );
    extractedExecutionAddress = null;
  }

  const totalPrice = finalOrderItems.reduce(
    (sum, item) => sum + Number(item.totalPrice || 0),
    0,
  );

  // V17.90L24b: globaler Prüfer braucht den bereits berechneten Totalwert.
  // V17.90L209: The final canonical service rows are now a runtime write
  // boundary, not only a comparison target. Every post-lock checker receives
  // detached copies, so an accidental mutation inside diagnostics can never
  // alter the rows that will be sealed and persisted.
  const postLockDiagnosticItemsV17_90L209 = finalOrderItems.map((item) => ({
    ...item,
  }));
  const postLockRecognitionCandidatesV17_90L209 =
    secondaryRecognitionCandidatesV17_90L91.map((item) => ({ ...item }));

  const readOnlyRiskValidator = runReadOnlyIntakeRiskValidator({
    originalText: validationSourceText,
    billingCustomer: {
      name: kundeData.name || null,
      street: addr.street || null,
      plz: addr.plz || null,
      city: addr.city || null,
      phone: kundeData.telefon || null,
      source: billingEvidence.source,
      hasReliableCustomerBlock: billingEvidence.hasReliableCustomerBlock,
    },
    executionAddress: extractedExecutionAddress || null,
    detectedCurrencies: intakeValidation.detectedCurrencies,
    finalCurrency: intakeValidation.finalCurrency,
    orderItems: postLockDiagnosticItemsV17_90L209,
    recognitionCandidates: postLockRecognitionCandidatesV17_90L209,
    specialNotes: finalSpecialNotes,
    finalTotal: totalPrice,
  });

  if (readOnlyRiskValidator.warnings.length > 0) {
    console.warn(
      `[${source}] 🧪 Intake risk validator (${readOnlyRiskValidator.riskLevel}): ${readOnlyRiskValidator.warnings.join(", ")}`,
      readOnlyRiskValidator.checks,
    );
  }

  const filteredReadOnlyRiskWarningsV17_90L89 =
    filterReadOnlyRiskWarningsV17_90L89(
      readOnlyRiskValidator.warnings,
      canonicalAiOrderItemsV17_90L88,
      finalOrderItems,
      intakeValidation.finalCurrency,
    );

  // V17.90L209: Once 05c is stable, every later risk/recognition result is
  // diagnostics-only. It must never create reviewReasons, chips, proposals or
  // document blockers. Genuine unresolved fields already live on the sealed
  // canonical items/customer/address/contact data and remain visible there.
  const persistedReadOnlyRiskWarningsV17_90L209 =
    canonicalPostLockActiveV17_90L209
      ? []
      : filteredReadOnlyRiskWarningsV17_90L89;

  if (
    canonicalPostLockActiveV17_90L209 &&
    filteredReadOnlyRiskWarningsV17_90L89.length > 0
  ) {
    console.info(
      `[${source}] 🔒 Post-canonical risk findings suppressed from persistence: ${filteredReadOnlyRiskWarningsV17_90L89.join(", ")}`,
    );
  }

  const structuralRiskReviewReasons =
    persistedReadOnlyRiskWarningsV17_90L209.map(
      (warning) => `intake_risk:${warning}`,
    );

  if (structuralRiskReviewReasons.length > 0) {
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  const primaryItem = finalOrderItems[0] || null;

  const serviceName = primaryItem?.serviceName || "";
  const unit = primaryItem?.unit || "Stunde";
  const unitPrice = primaryItem?.unitPrice || 0;
  const quantity = primaryItem?.quantity || 0;

  const quantityReviewReasons = finalOrderItems
    .filter((item) => item.needsReview && item.reviewReason)
    .map((item) => item.reviewReason as string);

  if (quantityReviewReasons.length > 0) {
    parsed.system = parsed.system || {};
    parsed.system.needs_review = true;
  }

  // --- UNIT MISMATCH CHECK ---
  const unitMismatchDiagnosticsV17_90L209: string[] = [];

  const normalizeUnitForReview = (value?: string | null) => {
    const v = normalizeUnitText(value || "");

    if (["stunde", "stunden", "std", "h"].includes(v)) return "Stunde";
    if (["tag", "tage", "arbeitstag", "arbeitstage"].includes(v)) return "Tag";
    if (["meter", "laufmeter", "lfm", "m"].includes(v)) return "Meter";
    if (["quadratmeter", "qm", "m2", "m²"].includes(v)) return "Quadratmeter";
    if (["kubikmeter", "cbm", "m3", "m³"].includes(v)) return "Kubikmeter";
    if (["stueck", "stück", "stk", "anzahl", "einheiten"].includes(v))
      return "Stück";
    if (["kilogramm", "kg"].includes(v)) return "Kilogramm";
    if (["tonne", "tonnen", "to", "t"].includes(v)) return "Tonne";
    if (["liter", "ltr", "l"].includes(v)) return "Liter";
    if (["pauschal", "pauschale", "fixpreis", "festpreis"].includes(v))
      return "Pauschal";

    return value || "";
  };

  const unitTypeToReviewUnit = (unitType?: string | null) => {
    switch (unitType) {
      case "hour":
        return "Stunde";
      case "day":
        return "Tag";
      case "meter":
        return "Meter";
      case "square_meter":
        return "Quadratmeter";
      case "cubic_meter":
        return "Kubikmeter";
      case "piece":
        return "Stück";
      case "kilogram":
        return "Kilogramm";
      case "ton":
        return "Tonne";
      case "liter":
        return "Liter";
      case "flat":
        return "Pauschal";
      default:
        return "";
    }
  };

  const detectUnitInsideOwnItemText = (text?: string | null) => {
    const matches = detectAllQuantityUnitsFromText(text || "");
    if (matches.length !== 1) return "";
    return unitTypeToReviewUnit(matches[0].unit);
  };

  const safeServiceMatchForReview = (itemServiceName: string) => {
    const itemName = normalizeServiceText(itemServiceName);
    if (!itemName || itemName.length < 4) return null;

    return (
      services.find((s: any) => {
        const serviceName = normalizeServiceText(s.name);
        if (!serviceName || serviceName.length < 4) return false;

        return serviceName === itemName;
      }) || null
    );
  };

  for (const item of finalOrderItems) {
    const itemServiceName = (item.serviceName || "").trim();
    if (!itemServiceName) continue;

    const matchingService = safeServiceMatchForReview(itemServiceName);
    const expectedUnit = normalizeUnitForReview(
      matchingService?.unit || item.unit,
    );

    const detectedUnit = detectUnitInsideOwnItemText(item.description);

    if (detectedUnit && expectedUnit && detectedUnit !== expectedUnit) {
      unitMismatchDiagnosticsV17_90L209.push(
        `unit_mismatch:${item.serviceName}:${detectedUnit}:${expectedUnit}`,
      );
    }
  }

  const unitMismatchReasons = canonicalPostLockActiveV17_90L209
    ? []
    : unitMismatchDiagnosticsV17_90L209;

  if (
    canonicalPostLockActiveV17_90L209 &&
    unitMismatchDiagnosticsV17_90L209.length > 0
  ) {
    console.info(
      `[${source}] 🔒 Post-canonical unit/catalog findings suppressed from persistence: ${unitMismatchDiagnosticsV17_90L209.join(", ")}`,
    );
  }

  // --- Description ---
  const description =
    parsed.auftrag?.beschreibung ||
    parsed.auftrag?.titel ||
    `${source}-Auftrag`;

  // translationText wurde absichtlich vor der Validator-Phase erzeugt, damit
  // Dialekt/Fremdsprache bereits dort für line-local Prüfung und sichtbare
  // Hochdeutsch-Leistungsnamen verfügbar ist.

  // --- Build notes ---
  // Der KI-Titel bleibt strukturierte Metainfo. Er darf nicht in den
  // Kundennachrichten landen, weil er sonst später wieder als Leistung gelesen
  // werden kann.
  const cleanMessageTextForNotes = stripInternalTitleLinesFromText(messageText);
  const notesParts: string[] = [`${source}:\n${cleanMessageTextForNotes}`];
  if (parsed.system?.prioritaet === "hoch")
    notesParts.push(`[Priorität: hoch]`);
  if (showTranslationInCustomerMessage)
    notesParts.push(`\n--- Übersetzung (automatisch) ---\n${translationText}`);
  if (reviewNote?.trim())
    notesParts.push(`\n[Review-Hinweis]\n${reviewNote.trim()}`);

  // --- Build reviewReasons from abgleich status + external intake hints ---
  const baseReviewReasons: string[] = [];
  if (
    abgleichStatus === "moeglicher_treffer" ||
    abgleichStatus === "konflikt" ||
    abgleichStatus === "bestaetigungs_treffer"
  ) {
    baseReviewReasons.push("uncertain_assignment");
  }
  // Image-only messages (no text, no audio) always need review — intent is unclear
  if (isImageOnly) {
    baseReviewReasons.push("image_only_no_text");
  }

  const filteredValidationReviewReasonsV17_90L89 =
    canonicalPostLockActiveV17_90L209
      ? []
      : filterLegacyValidationReviewReasonsV17_90L89(
          intakeValidation.reviewReasons,
          finalOrderItems,
          intakeValidation.finalCurrency,
        );

  const canonicalItemReviewReasonsV17_90L225 = finalOrderItems
    .filter((item) => Boolean(item.needsReview))
    .map((item) =>
      String(
        item.reviewReason ||
          `ai_review_required:${String(item.serviceName || "Leistung")}`,
      ).trim(),
    )
    .filter(Boolean);

  let allReviewReasons: string[] = Array.from(new Set([
    ...(additionalReviewReasons || []),
    ...baseReviewReasons,
    ...customerGuardReviewReasons,
    ...quantityReviewReasons,
    ...unitMismatchReasons,
    ...filteredValidationReviewReasonsV17_90L89,
    ...canonicalItemReviewReasonsV17_90L225,
    ...priceContradictionReviewReasonsV17_90L269,
    ...semanticRecognitionReviewReasonsV17_90L252,
    ...invalidFirstAiItemReviewReasonsV17_90L252,
    ...genericEmptyFirstAiReviewReasonV17_90L252,
    ...canonicalMutationRecoveryReasonsV17_90L235,
    ...(canonicalPostLockActiveV17_90L209
      ? []
      : unitlessQuantityGuardBeforePersist.reviewReasons),
    ...structuralRiskReviewReasons,
    ...(canonicalPersistenceViolationV17_90L98
      ? ["canonical_persistence_violation"]
      : []),
    ...(extractedExecutionAddress ? ["execution_address_detected"] : []),
  ]));

  if (autoReuseTags.length > 0) {
    for (const tag of autoReuseTags) {
      if (!allReviewReasons.includes(tag)) allReviewReasons.push(tag);
    }
  }

  // V17.90L216: Once an existing customer has been safely resolved and the
  // message explicitly says that execution uses the same address, earlier
  // fail-closed address-role findings are obsolete. Remove only those stale
  // findings; genuine customer, execution-site and service reviews remain.
  const confirmedExistingCustomerSameAddressV17_90L216 = Boolean(
    customerId &&
      !customerWasNewlyCreated &&
      resolvedCustomerMaster?.address &&
      resolvedCustomerMaster?.plz &&
      resolvedCustomerMaster?.city &&
      hasSameAddressInstructionV17_90L28(
        [messageText, translationText].filter(Boolean).join("\n"),
      ),
  );
  if (confirmedExistingCustomerSameAddressV17_90L216) {
    const obsoleteSameAddressReasonsV17_90L216 = new Set([
      "customer_data_uncertain_no_billing_block",
      "address_role_uncertain",
      "customer_address_quarantined_ambiguous_role_v17_61",
      "customer_address_role_conflict_execution_site_v17_211",
      "billing_customer_missing_or_uncertain",
    ]);
    const removedReasonsV17_90L216 = allReviewReasons.filter((reason) =>
      obsoleteSameAddressReasonsV17_90L216.has(reason),
    );
    if (removedReasonsV17_90L216.length > 0) {
      allReviewReasons = allReviewReasons.filter(
        (reason) => !obsoleteSameAddressReasonsV17_90L216.has(reason),
      );
      console.info(
        `[${source}] 🔒 Removed stale same-address review reasons after verified customer reuse: ${removedReasonsV17_90L216.join(", ")}`,
      );
    }
  }

  // V17.90L209 hard invariant: no post-lock diagnostic namespace may leak
  // into persisted review metadata. This final allow-boundary protects future
  // refactors even if another checker is accidentally appended above.
  if (canonicalPostLockActiveV17_90L209) {
    const forbiddenPostCanonicalReasonsV17_90L209 = allReviewReasons.filter(
      (reason) =>
        (reason.startsWith("intake_risk:") &&
          !reason.startsWith(RECOGNITION_REVIEW_DETAIL_PREFIX_V17_90L252) &&
          reason !== "intake_risk:priced_service_line_missing_or_mismatched") ||
        reason.startsWith("unit_mismatch:") ||
        reason.startsWith("recognition_review:") ||
        reason === "recognition_review" ||
        reason === "priced_service_line_missing_or_mismatched" ||
        reason === "item_evidence_not_line_local",
    );
    if (forbiddenPostCanonicalReasonsV17_90L209.length > 0) {
      console.error(
        `[${source}] 🔒 Removed forbidden post-canonical review metadata: ${forbiddenPostCanonicalReasonsV17_90L209.join(", ")}`,
      );
      const forbiddenSetV17_90L209 = new Set(
        forbiddenPostCanonicalReasonsV17_90L209,
      );
      allReviewReasons = allReviewReasons.filter(
        (reason) => !forbiddenSetV17_90L209.has(reason),
      );
    }
  }

  const needsReview = !!forceReview || allReviewReasons.length > 0;
  const hinweisLevel = allReviewReasons.some(
    (reason) =>
      ["multi_image_overflow", "image_only_no_text"].includes(reason) ||
      reason.startsWith("unit_mismatch:") ||
      reason.startsWith("currency_") ||
      reason.startsWith("item_currency_mismatch:") ||
      reason.startsWith("price_contradiction:") ||
      reason.startsWith("canonical_mutation_blocked:") ||
      reason.startsWith("intake_risk:") ||
      reason === "canonical_persistence_violation",
  )
    ? "warning"
    : needsReview
      ? "info"
      : parsed.system?.prioritaet === "hoch"
        ? "important"
        : finalSpecialNotes
          ? "info"
          : "none";

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "06_pre_persist",
    {
      needsReview,
      reviewReasons: allReviewReasons.slice(0, 60),
      items: summarizeIntakeDiagnosticItems(finalOrderItems),
    },
  );

  // V17.90L203: Build every operational fact once, across all role sources.
  // Earlier helpers only propose candidates. This assembler owns role
  // precedence, cross-role dedupe and the final text variant before sealing.
  const translatedAccessCandidatesV17_90L202 =
    extractTranslatedRoleCandidatesV17_90L202(translationText, "access");
  const translatedParkingCandidatesV17_90L202 =
    extractTranslatedRoleCandidatesV17_90L202(translationText, "parking");
  const translatedOtherCandidatesV17_90L202 =
    extractTranslatedRoleCandidatesV17_90L202(translationText, "other");

  const accessFactCandidatesV17_90L203 =
    preferCompleteTranslatedRoleVariantsV17_90L202(
      [
        ...canonicalizeStructuredRoleLinesV17_90L195(
          [parsed.auftrag?.zugangshinweise, ...translatedAccessCandidatesV17_90L202],
          "access",
        ),
        ...extractProtectedStructuredRoleValuesV17_90L103(
          parsed.auftrag?.zugangshinweise,
        ),
        ...translatedAccessCandidatesV17_90L202,
      ],
      translationText,
    );
  const parkingFactCandidatesV17_90L203 =
    preferCompleteTranslatedRoleVariantsV17_90L202(
      [
        ...canonicalizeStructuredRoleLinesV17_90L195(
          [parsed.auftrag?.parkhinweise, ...translatedParkingCandidatesV17_90L202],
          "parking",
        ),
        ...extractProtectedStructuredRoleValuesV17_90L103(
          parsed.auftrag?.parkhinweise,
        ),
        ...translatedParkingCandidatesV17_90L202,
      ],
      translationText,
    );
  const otherFactCandidatesV17_90L203 =
    preferCompleteTranslatedRoleVariantsV17_90L202(
      [
        ...canonicalizeStructuredRoleLinesV17_90L195(
          [parsed.auftrag?.sonstige_hinweise, ...translatedOtherCandidatesV17_90L202],
          "other",
        ),
        ...extractProtectedStructuredRoleValuesV17_90L103(
          parsed.auftrag?.sonstige_hinweise,
        ),
        ...translatedOtherCandidatesV17_90L202,
      ],
      translationText,
    );

  const ordinaryFactCandidatesV17_90L203 =
    dedupeTranslatedRoleVariantsV17_90L201(hinweisItems, translationText);

  // V17.90L214: Keep the previous post-AI/raw-text fact builder as a pure
  // shadow diagnostic. Its results are never allowed into specialNotes, roles,
  // the canonical snapshot or Prisma persistence.
  const postAiShadowFactAssemblyV17_90L214 = assembleCanonicalFactsV2({
    candidates: [
      ...gefahrItems.map((text) => ({
        role: "safety" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...accessFactCandidatesV17_90L203.map((text) => ({
        role: "access" as const,
        text,
        evidenceSource: translatedRoleEvidenceScoreV17_90L201(text, translationText) > 0
          ? ("normalized_translation" as const)
          : ("ai_structured" as const),
      })),
      ...parkingFactCandidatesV17_90L203.map((text) => ({
        role: "parking" as const,
        text,
        evidenceSource: translatedRoleEvidenceScoreV17_90L201(text, translationText) > 0
          ? ("normalized_translation" as const)
          : ("ai_structured" as const),
      })),
      ...otherFactCandidatesV17_90L203.map((text) => ({
        role: "other" as const,
        text,
        evidenceSource: translatedRoleEvidenceScoreV17_90L201(text, translationText) > 0
          ? ("normalized_translation" as const)
          : ("ai_structured" as const),
      })),
      ...ordinaryFactCandidatesV17_90L203.map((text) => ({
        role: "ordinary" as const,
        text,
        evidenceSource: translatedRoleEvidenceScoreV17_90L201(text, translationText) > 0
          ? ("normalized_translation" as const)
          : ("ai_structured" as const),
      })),
    ],
    context: {
      originalText: messageText,
      translationText,
      onsiteContact: onsiteContactHint.hint
        ? {
            name: onsiteContactHint.contactName || null,
            phone: onsiteContactHint.phone || null,
            channel: onsiteContactHint.preferredChannel || null,
            noPhoneCall: onsiteContactHint.noPhoneCall,
          }
        : null,
      appointments: structuredAppointmentHintsV17_90L86,
    },
  });

  // V17.90L252: Hard first-AI-only role boundary. The sealed role graph is
  // exactly the first structured AI output. Review findings may affect UI
  // visibility, but must never delete, split, rewrite or add canonical facts.
  const canonicalAiRoleSnapshotV17_90L250 = finalAiRoleSnapshotV17_90L215;

  // V17.90L266/L271: A channel-only instruction originates in the first AI's
  // structured onsiteContact evidence. Persist the concise German canonical
  // restriction summary so later documents do not reconstruct or invert
  // SMS/WhatsApp/call semantics.
  const firstAiCanonicalCommunicationFactsV17_90L266 =
    firstAiCommunicationInstructionHintV17_90L265
      ? [firstAiCommunicationInstructionHintV17_90L265]
      : [];

  const canonicalFactAssemblyV17_90L204 = assembleCanonicalFactsV2({
    candidates: [
      ...canonicalAiRoleSnapshotV17_90L250.safety.map((text) => ({
        role: "safety" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...canonicalAiRoleSnapshotV17_90L250.access.map((text) => ({
        role: "access" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...canonicalAiRoleSnapshotV17_90L250.parking.map((text) => ({
        role: "parking" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...canonicalAiRoleSnapshotV17_90L250.other.map((text) => ({
        role: "other" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...canonicalAiRoleSnapshotV17_90L250.ordinary.map((text) => ({
        role: "ordinary" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
      ...firstAiCanonicalCommunicationFactsV17_90L266.map((text) => ({
        role: "ordinary" as const,
        text,
        evidenceSource: "ai_structured" as const,
      })),
    ],
    context: {
      onsiteContact: onsiteContactHint.hint
        ? {
            name: onsiteContactHint.contactName || null,
            phone: onsiteContactHint.phone || null,
            channel: onsiteContactHint.preferredChannel || null,
            noPhoneCall: onsiteContactHint.noPhoneCall,
          }
        : null,
      appointments: structuredAppointmentHintsV17_90L86,
    },
    sourceLock: "ai_structured",
  });

  const sealedAiFactKeysV17_90L214 = new Set(
    [
      ...finalAiRoleSnapshotV17_90L215.safety.map((text) => ["safety", text] as const),
      ...finalAiRoleSnapshotV17_90L215.access.map((text) => ["access", text] as const),
      ...finalAiRoleSnapshotV17_90L215.parking.map((text) => ["parking", text] as const),
      ...finalAiRoleSnapshotV17_90L215.other.map((text) => ["other", text] as const),
      ...finalAiRoleSnapshotV17_90L215.ordinary.map((text) => ["ordinary", text] as const),
      ...firstAiCanonicalCommunicationFactsV17_90L266.map(
        (text) => ["ordinary", text] as const,
      ),
    ].map(
      ([role, text]) =>
        `${role}|${canonicalRoleVariantKeyV17_90L201(text)}`,
    ),
  );
  const nonAiCanonicalFactsV17_90L214 =
    canonicalFactAssemblyV17_90L204.facts.filter(
      (fact) =>
        fact.evidenceSource !== "ai_structured" ||
        !sealedAiFactKeysV17_90L214.has(
          `${fact.role}|${canonicalRoleVariantKeyV17_90L201(fact.text)}`,
        ),
    );
  if (nonAiCanonicalFactsV17_90L214.length > 0) {
    throw new Error(
      `CANONICAL_AI_FACT_SOURCE_VIOLATION:${nonAiCanonicalFactsV17_90L214
        .map((fact) => `${fact.role}:${fact.text}`)
        .join(" | ")}`,
    );
  }

  const canonicalFactKeySetV17_90L214 = new Set(
    canonicalFactAssemblyV17_90L204.facts.map(
      (fact) =>
        `${fact.role}|${canonicalRoleVariantKeyV17_90L201(fact.text)}`,
    ),
  );
  const shadowOnlyFactsV17_90L214 =
    postAiShadowFactAssemblyV17_90L214.facts.filter(
      (fact) =>
        !canonicalFactKeySetV17_90L214.has(
          `${fact.role}|${canonicalRoleVariantKeyV17_90L201(fact.text)}`,
        ),
    );
  if (shadowOnlyFactsV17_90L214.length > 0) {
    console.warn(
      `[${source}] 🔒 Post-AI fact candidates suppressed from persistence: ${shadowOnlyFactsV17_90L214
        .map((fact) => `${fact.role}:${redactIntakeDiagnosticText(fact.text, 180)}`)
        .join(" | ")}`,
    );
  }

  // V17.90L260: A possible-work statement that already has an active red
  // recognition review must not be shown a second time under Besonderheiten.
  // This is display-only suppression: the sealed canonical fact and the
  // encoded review finding remain unchanged for audit and user resolution.
  const originalAppointmentReviewSentencesV17_90L271 =
    splitWorkCoverageSentenceCandidatesV17_90L266(messageText, "original");
  const translatedAppointmentReviewSentencesV17_90L271 =
    splitWorkCoverageSentenceCandidatesV17_90L266(
      translationText,
      "translation",
    );
  const recognitionReviewDisplayTextsV17_90L271 =
    finalAiWorkCoverageV17_90L251.missingWork
      .flatMap((finding) => {
        const direct = [finding.relatedRoleText || "", finding.quote || ""];
        const sourceSentences =
          finding.source === "translation"
            ? translatedAppointmentReviewSentencesV17_90L271
            : originalAppointmentReviewSentencesV17_90L271;
        const counterpartSentences =
          finding.source === "translation"
            ? originalAppointmentReviewSentencesV17_90L271
            : translatedAppointmentReviewSentencesV17_90L271;
        const sourceIndex = sourceSentences.findIndex((sentence) =>
          exactQuoteExistsInSourceV17_90L251(
            sentence.text,
            finding.quote,
          ),
        );
        const counterpart =
          sourceIndex >= 0 ? counterpartSentences[sourceIndex]?.text || "" : "";
        return [...direct, counterpart];
      })
      .map((text) => compactExactSourceTextV17_90L251(text))
      .filter(Boolean);
  const canonicalSpecialNoteHintsV17_90L203 =
    dedupeTranslatedRoleVariantsV17_90L201(
      [
        onsiteContactHint.hint || "",
        firstAiCommunicationInstructionHintV17_90L265 || "",
        ...structuredAppointmentHintsV17_90L86,
        ...canonicalFactAssemblyV17_90L204.roles.access,
        ...canonicalFactAssemblyV17_90L204.roles.parking,
        ...canonicalFactAssemblyV17_90L204.roles.other,
        ...canonicalFactAssemblyV17_90L204.roles.ordinary,
      ].filter((text) => {
        const compact = compactExactSourceTextV17_90L251(text);
        if (!compact) return false;
        if (
          recognitionReviewDisplayTextsV17_90L271.some((reviewText) =>
            semanticRoleOverlapV17_90L87(compact, reviewText),
          )
        ) {
          return false;
        }
        if (
          structuredAppointmentHintsV17_90L86.some((appointment) =>
            ordinaryHintCoveredByAppointmentV17_90L217(compact, appointment),
          )
        ) {
          return false;
        }
        if (
          firstAiCommunicationInstructionHintV17_90L265 &&
          compact !== firstAiCommunicationInstructionHintV17_90L265 &&
          semanticRoleOverlapV17_90L87(
            compact,
            firstAiCommunicationInstructionHintV17_90L265,
          )
        ) {
          return false;
        }
        return true;
      }),
      translationText,
    );
  finalSpecialNotes =
    buildSpecialNotes({
      safetyWarnings: canonicalFactAssemblyV17_90L204.roles.safety,
      jobHints: canonicalSpecialNoteHintsV17_90L203,
      preserveStructuredRoles: true,
    }) || null;

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "06a_canonical_fact_assembler",
    {
      factCount: canonicalFactAssemblyV17_90L204.facts.length,
      suppressedPostAiFactCount: shadowOnlyFactsV17_90L214.length,
      facts: canonicalFactAssemblyV17_90L204.facts.map((fact) => ({
        factId: fact.factId,
        role: fact.role,
        text: redactIntakeDiagnosticText(fact.text, 320),
      })),
    },
  );

  // V17.90L195: Full canonical boundary for every business role, not only
  // service rows. Later UI/API code must use this snapshot and must not
  // reconstruct customer/contact/address/chip roles from the raw message.
  const canonicalIntakeSnapshotV2 = sealCanonicalIntakeV2({
    customer: {
      name: resolvedCustomerMaster?.name || canonicalBillingCustomerV2.name,
      street:
        resolvedCustomerMaster?.address || canonicalBillingCustomerV2.street,
      plz: resolvedCustomerMaster?.plz || canonicalBillingCustomerV2.plz,
      city: resolvedCustomerMaster?.city || canonicalBillingCustomerV2.city,
      phone:
        resolvedCustomerMaster?.phone || canonicalBillingCustomerV2.phone,
      email:
        resolvedCustomerMaster?.email || canonicalBillingCustomerV2.email,
      evidenceSource: canonicalBillingCustomerV2.evidenceSource,
    },
    executionAddress: extractedExecutionAddress
      ? {
          siteName: extractedExecutionAddress.siteName || null,
          siteAddress: extractedExecutionAddress.siteAddress || null,
          sitePlz: extractedExecutionAddress.sitePlz || null,
          siteCity: extractedExecutionAddress.siteCity || null,
          siteNote: extractedExecutionAddress.siteNote || null,
        }
      : null,
    onsiteContact: onsiteContactHint.hint
      ? {
          name: onsiteContactHint.contactName || null,
          phone: onsiteContactHint.phone || null,
          channel: onsiteContactHint.preferredChannel || null,
          noPhoneCall: onsiteContactHint.noPhoneCall,
          hint: onsiteContactHint.hint || null,
        }
      : null,
    appointments: structuredAppointmentHintsV17_90L86,
    roles: canonicalFactAssemblyV17_90L204.roles,
    facts: canonicalFactAssemblyV17_90L204.facts,
    items: finalOrderItems.map((item) => {
      const sourceText = String(
        (item as any).sourceText ||
          (item as any).evidence ||
          item.description ||
          "",
      ).trim();
      return {
        serviceName: item.serviceName,
        positionType: normalizePositionType((item as any).positionType),
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        currency:
          (item as any).detectedCurrency || intakeValidation.finalCurrency,
        needsReview: Boolean(item.needsReview),
        reviewReason: item.reviewReason || null,
        sourceText: sourceText || null,
        sourceFingerprint: createCanonicalSourceFingerprintV17_90L194(
          [
            sourceText,
            item.serviceName,
            normalizePositionType((item as any).positionType),
            item.quantity,
            item.unit,
            item.unitPrice,
            (item as any).detectedCurrency || intakeValidation.finalCurrency,
          ].join("|"),
        ),
      };
    }),
    specialNotes: finalSpecialNotes || null,
    reviewReasons: allReviewReasons,
  });

  // Strip every undefined value before handing the snapshot to Prisma JSON.
  // This keeps the persisted contract deterministic and avoids generated-client
  // type/runtime differences for optional nested AI fields.
  const canonicalIntakeSnapshotJsonV2 = JSON.parse(
    JSON.stringify(canonicalIntakeSnapshotV2),
  );
  const canonicalPrePersistCheckV2 = verifyCanonicalIntakeV2(
    canonicalIntakeSnapshotJsonV2,
  );
  if (!canonicalPrePersistCheckV2.valid) {
    throw new Error(
      `CANONICAL_INTAKE_V2_PRE_PERSIST_BLOCK:${canonicalPrePersistCheckV2.reason || "invalid"}`,
    );
  }

  // V17.90L213: The serialized canonical snapshot is the sole business-data
  // source for Prisma persistence. Do not persist from parallel mutable
  // variables after the lock. This closes the last path where correct AI data
  // could be represented one way in intakeSnapshot but differently in the
  // order columns or order-item rows.
  const canonicalPersistenceSourceV17_90L213 =
    canonicalIntakeSnapshotJsonV2 as typeof canonicalIntakeSnapshotV2;
  const canonicalPersistItemsV17_90L213 = Object.freeze(
    (canonicalPersistenceSourceV17_90L213.items || []).map((item) =>
      Object.freeze({ ...item }),
    ),
  );
  const canonicalPrimaryItemV17_90L213 =
    canonicalPersistItemsV17_90L213[0] || null;
  const canonicalTotalPriceV17_90L213 = canonicalPersistItemsV17_90L213.reduce(
    (sum, item) => sum + Number(item.totalPrice || 0),
    0,
  );
  const canonicalReviewReasonsV17_90L213: string[] = Array.from(
    new Set<string>(
      (canonicalPersistenceSourceV17_90L213.reviewReasons || []).map((reason) =>
        String(reason),
      ),
    ),
  );
  const canonicalNeedsReviewV17_90L213 = Boolean(
    forceReview || canonicalReviewReasonsV17_90L213.length > 0,
  );
  const canonicalHinweisLevelV17_90L213 = canonicalReviewReasonsV17_90L213.some(
    (reason) =>
      ["multi_image_overflow", "image_only_no_text"].includes(reason) ||
      reason.startsWith("unit_mismatch:") ||
      reason.startsWith("currency_") ||
      reason.startsWith("item_currency_mismatch:") ||
      reason.startsWith("canonical_mutation_blocked:") ||
      reason.startsWith("intake_risk:") ||
      reason === "canonical_persistence_violation",
  )
    ? "warning"
    : canonicalNeedsReviewV17_90L213
      ? "info"
      : parsed.system?.prioritaet === "hoch"
        ? "important"
        : canonicalPersistenceSourceV17_90L213.specialNotes
          ? "info"
          : "none";

  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "06b_full_canonical_lock",
    {
      version: canonicalIntakeSnapshotV2.pipelineVersion,
      boundary: "after_deterministic_hydration_v17_90L211",
      customer: canonicalIntakeSnapshotV2.customer,
      executionAddress: canonicalIntakeSnapshotV2.executionAddress,
      onsiteContact: canonicalIntakeSnapshotV2.onsiteContact,
      appointments: canonicalIntakeSnapshotV2.appointments,
      roleCounts: {
        safety: canonicalIntakeSnapshotV2.roles.safety.length,
        access: canonicalIntakeSnapshotV2.roles.access.length,
        parking: canonicalIntakeSnapshotV2.roles.parking.length,
        other: canonicalIntakeSnapshotV2.roles.other.length,
        ordinary: canonicalIntakeSnapshotV2.roles.ordinary.length,
      },
      itemCount: canonicalIntakeSnapshotV2.items.length,
    },
  );

  // --- Create order ---
  markIntakePerfV17_90L337("06_persist_start", {
    itemCount: finalOrderItems.length,
    needsReview,
  });
  const persistStartMsV17_90L337 = Date.now();
  let order = await prisma.order.create({
    data: {
      customerId,
      ...(userId ? { userId } : {}),
      dataScope,
      description,
      serviceName: canonicalPrimaryItemV17_90L213?.serviceName || serviceName,
      status: "Offen",
      priceType: canonicalPrimaryItemV17_90L213?.unit || unit,
      unitPrice: Number(canonicalPrimaryItemV17_90L213?.unitPrice || 0),
      quantity: Number(canonicalPrimaryItemV17_90L213?.quantity || 0),
      totalPrice: canonicalTotalPriceV17_90L213,
      currency: intakeValidation.finalCurrency,
      vatRate: intakeVatRate,
      date: new Date(),
      notes: stripInternalTitleLinesFromText(notesParts.join("\n")),
      specialNotes: canonicalPersistenceSourceV17_90L213.specialNotes || null,
      intakeSchemaVersion: INTAKE_V2_SCHEMA_VERSION,
      intakeSnapshot: canonicalIntakeSnapshotJsonV2,
      siteAddressDifferent: Boolean(
        canonicalPersistenceSourceV17_90L213.executionAddress,
      ),
      siteName:
        canonicalPersistenceSourceV17_90L213.executionAddress?.siteName || null,
      siteAddress:
        canonicalPersistenceSourceV17_90L213.executionAddress?.siteAddress ||
        null,
      sitePlz:
        canonicalPersistenceSourceV17_90L213.executionAddress?.sitePlz || null,
      siteCity:
        canonicalPersistenceSourceV17_90L213.executionAddress?.siteCity || null,
      siteNote:
        canonicalPersistenceSourceV17_90L213.executionAddress?.siteNote || null,
      needsReview: canonicalNeedsReviewV17_90L213,
      reviewReasons: canonicalReviewReasonsV17_90L213,
      hinweisLevel: canonicalHinweisLevelV17_90L213,
      mediaUrl: savedMediaPath || allSavedMediaPaths?.[0] || null,
      mediaType:
        savedMediaType ||
        (allSavedMediaPaths && allSavedMediaPaths.length > 0 ? "image" : null),
      imageUrls:
        allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0
          ? allOptimizedPreviewPaths
          : allSavedMediaPaths && allSavedMediaPaths.length > 0
            ? allSavedMediaPaths
            : savedMediaType === "image"
              ? ([optimizedPreviewPath || savedMediaPath].filter(
                  Boolean,
                ) as string[])
              : [],
      thumbnailUrls:
        allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0
          ? allOptimizedThumbnailPaths
          : allSavedMediaPaths && allSavedMediaPaths.length > 0
            ? allSavedMediaPaths
            : savedMediaType === "image"
              ? ([optimizedThumbnailPath || savedMediaPath].filter(
                  Boolean,
                ) as string[])
              : [],
      audioTranscript:
        savedMediaType === "audio" && messageText ? messageText : null,
      // Stage I — audio usage tracking (only set when this order carries an audio file)
      audioDurationSec:
        savedMediaType === "audio"
          ? typeof inputAudioDurationSec === "number" &&
            isFinite(inputAudioDurationSec)
            ? Math.max(0, Math.round(inputAudioDurationSec))
            : null
          : null,
      audioTranscriptionStatus:
        savedMediaType === "audio"
          ? inputAudioTranscriptionStatus || null
          : null,
      ...(canonicalPersistItemsV17_90L213.length > 0
        ? {
            items: {
              create: canonicalPersistItemsV17_90L213.map((item) => {
                const sourceText = String(item.sourceText || "").trim();
                const detectedCurrency = String(
                  item.currency || intakeValidation.finalCurrency,
                ).trim();
                return {
                  serviceName: item.serviceName,
                  positionType: normalizePositionType((item as any).positionType),
                  description: sourceText || item.serviceName,
                  quantity: item.quantity,
                  unit: item.unit,
                  unitPrice: item.unitPrice,
                  totalPrice: item.totalPrice,
                  sourceText: sourceText || null,
                  detectedCurrency: detectedCurrency || null,
                  needsReview: Boolean(item.needsReview),
                  reviewReason: item.reviewReason || null,
                  sourceFingerprint:
                    item.sourceFingerprint ||
                    createCanonicalSourceFingerprintV17_90L194(
                      [
                        sourceText,
                        item.serviceName,
                        normalizePositionType((item as any).positionType),
                        item.quantity,
                        item.unit,
                        item.unitPrice,
                        detectedCurrency,
                      ].join("|"),
                    ),
                };
              }),
            },
          }
        : {}),
    },
    include: { customer: true, items: true },
  });
  markIntakePerfV17_90L337("06_persist_order_created", {
    durationMs: Date.now() - persistStartMsV17_90L337,
    orderId: order.id,
    itemCount: order.items.length,
  });

  // V16.39: Final order path deliberately does not re-parse raw text for
  // billing data. If the AI-structured billing evidence failed validation, the
  // customer remains review-required instead of being rescued by marker words.

  const canonicalScalarV17_90L194 = (value: unknown) =>
    String(value ?? "").replace(/\s+/g, " ").trim();
  const canonicalNumberV17_90L213 = (value: unknown) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Number(number.toFixed(6)) : 0;
  };
  const canonicalItemPersistenceKeyV17_90L213 = (item: {
    serviceName?: unknown;
    quantity?: unknown;
    unit?: unknown;
    unitPrice?: unknown;
    totalPrice?: unknown;
    sourceText?: unknown;
    currency?: unknown;
    detectedCurrency?: unknown;
    needsReview?: unknown;
    reviewReason?: unknown;
    sourceFingerprint?: unknown;
  }) =>
    JSON.stringify({
      serviceName: canonicalScalarV17_90L194(item.serviceName),
      quantity: canonicalNumberV17_90L213(item.quantity),
      unit: canonicalScalarV17_90L194(item.unit),
      unitPrice: canonicalNumberV17_90L213(item.unitPrice),
      totalPrice: canonicalNumberV17_90L213(item.totalPrice),
      sourceText: canonicalScalarV17_90L194(item.sourceText),
      currency: canonicalScalarV17_90L194(
        item.currency || item.detectedCurrency,
      ).toUpperCase(),
      needsReview: Boolean(item.needsReview),
      reviewReason: canonicalScalarV17_90L194(item.reviewReason),
      sourceFingerprint: canonicalScalarV17_90L194(item.sourceFingerprint),
    });
  const expectedItemStateV17_90L213 = canonicalPersistItemsV17_90L213
    .map((item) => canonicalItemPersistenceKeyV17_90L213(item))
    .sort();
  const persistedItemStateV17_90L213 = order.items
    .map((item: any) => canonicalItemPersistenceKeyV17_90L213(item))
    .sort();
  const persistedItemsStableV17_90L194 =
    expectedItemStateV17_90L213.length === persistedItemStateV17_90L213.length &&
    expectedItemStateV17_90L213.every(
      (itemState, index) => itemState === persistedItemStateV17_90L213[index],
    );
  const expectedReviewReasonsV17_90L213 = JSON.stringify(
    [...canonicalReviewReasonsV17_90L213].sort(),
  );
  const persistedReviewReasonsV17_90L213 = JSON.stringify(
    [...(Array.isArray(order.reviewReasons) ? order.reviewReasons : [])].sort(),
  );
  const persistedCanonicalViolationV17_90L194 =
    canonicalScalarV17_90L194(order.customer?.name) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.name) ||
    canonicalScalarV17_90L194(order.customer?.address) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.street) ||
    canonicalScalarV17_90L194(order.customer?.plz) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.plz) ||
    canonicalScalarV17_90L194(order.customer?.city) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.city) ||
    canonicalScalarV17_90L194(order.customer?.phone) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.phone) ||
    canonicalScalarV17_90L194(order.customer?.email) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.customer.email) ||
    canonicalScalarV17_90L194(order.siteName) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.executionAddress?.siteName) ||
    canonicalScalarV17_90L194(order.siteAddress) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.executionAddress?.siteAddress) ||
    canonicalScalarV17_90L194(order.sitePlz) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.executionAddress?.sitePlz) ||
    canonicalScalarV17_90L194(order.siteCity) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.executionAddress?.siteCity) ||
    canonicalScalarV17_90L194(order.specialNotes) !==
      canonicalScalarV17_90L194(canonicalIntakeSnapshotV2.specialNotes) ||
    canonicalScalarV17_90L194((order as any).serviceName) !==
      canonicalScalarV17_90L194(
        canonicalPrimaryItemV17_90L213?.serviceName || serviceName,
      ) ||
    canonicalScalarV17_90L194((order as any).priceType) !==
      canonicalScalarV17_90L194(canonicalPrimaryItemV17_90L213?.unit || unit) ||
    canonicalNumberV17_90L213((order as any).unitPrice) !==
      canonicalNumberV17_90L213(canonicalPrimaryItemV17_90L213?.unitPrice) ||
    canonicalNumberV17_90L213((order as any).quantity) !==
      canonicalNumberV17_90L213(canonicalPrimaryItemV17_90L213?.quantity) ||
    canonicalNumberV17_90L213((order as any).totalPrice) !==
      canonicalNumberV17_90L213(canonicalTotalPriceV17_90L213) ||
    Boolean(order.needsReview) !== canonicalNeedsReviewV17_90L213 ||
    persistedReviewReasonsV17_90L213 !== expectedReviewReasonsV17_90L213 ||
    canonicalScalarV17_90L194((order as any).hinweisLevel) !==
      canonicalScalarV17_90L194(canonicalHinweisLevelV17_90L213) ||
    !persistedItemsStableV17_90L194;

  if (persistedCanonicalViolationV17_90L194) {
    const blockedReasons = Array.from(
      new Set([
        ...(Array.isArray(order.reviewReasons) ? order.reviewReasons : []),
        "canonical_full_persistence_violation",
      ]),
    );
    order = await prisma.order.update({
      where: { id: order.id },
      data: {
        needsReview: true,
        reviewReasons: { set: blockedReasons },
        hinweisLevel: "warning",
      },
      include: { customer: true, items: true },
    });
    console.error(
      `[${source}] full canonical persistence invariant failed; order ${order.id} blocked for manual review`,
    );
  }

  const canonicalPersistenceCheckV2 = verifyCanonicalIntakeV2(
    (order as any).intakeSnapshot,
  );
  if (!canonicalPersistenceCheckV2.valid) {
    const violation =
      canonicalPersistenceCheckV2.reason || "canonical_intake_v2_invalid";
    const nextReasons = Array.from(
      new Set([...(order.reviewReasons || []), violation]),
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { needsReview: true, reviewReasons: nextReasons },
    });
    order.needsReview = true;
    order.reviewReasons = nextReasons;
    console.error(
      `[${source}] CANONICAL_INTAKE_V2_VIOLATION orderId=${order.id} reason=${violation}`,
    );
  }

  const totalIntakeDurationMsV17_90L337 = Date.now() - _intakeStartTime;
  logIntakeDiagnosticTrace(
    intakeDiagnosticTraceEnabled,
    intakeDiagnosticTraceId,
    "07_persisted_order",
    {
      orderId: order.id,
      itemCount: order.items.length,
      items: summarizeIntakeDiagnosticItems(order.items),
      durationMs: totalIntakeDurationMsV17_90L337,
    },
  );
  markIntakePerfV17_90L337("07_done", {
    orderId: order.id,
    itemCount: order.items.length,
    totalDurationMs: totalIntakeDurationMsV17_90L337,
  });

  console.log(
    `[${source}] Order created: ${order.id} | Customer: ${order.customer?.name} (${order.customer?.customerNumber}) | Service: ${serviceName} | Abgleich: ${abgleichStatus} (confidence: ${abgleich.confidence || 0}) | Priorität: ${parsed.system?.prioritaet || "normal"}${duplicateWarning ? " | ⚠️ WARNING" : ""}`,
  );

  // Audit log: order created from webhook (technical webhook trail)
  logAuditAsync({
    userId,
    action: `ORDER_CREATED_FROM_${source.toUpperCase()}`,
    area: "WEBHOOK",
    targetType: "Order",
    targetId: order.id,
    success: true,
    details: {
      sender: senderName,
      customer: order.customer?.name || "Unbekannt",
      customerId,
      service: serviceName,
      abgleichStatus,
      confidence: abgleich.confidence || 0,
      needsReview: !!parsed.system?.needs_review,
      hasMedia: !!savedMediaPath,
      mediaType: savedMediaType || null,
    },
  });

  // Audit log: fachlicher Auftragseintrag unter ORDERS (damit Bereich-Filter ORDERS auch Webhook-Aufträge zeigt)
  logAuditAsync({
    userId,
    action: "ORDER_CREATE",
    area: "ORDERS",
    targetType: "Order",
    targetId: order.id,
    success: true,
    details: {
      source: source.toLowerCase(),
      sender: senderName,
      customer: order.customer?.name || "Unbekannt",
      customerId,
      service: serviceName,
    },
  });

  console.log(
    `[${source}] ✅ Order created in ${Date.now() - _intakeStartTime}ms total (orderId=${order.id}, desc="${description.slice(0, 60)}")`,
  );

  // Block R — strukturiertes Audit-Log für jede erfolgreiche Intake-Verarbeitung.
  // Macht es trivial zu finden, wo bei zukünftigen Issue-Reports der Name verloren geht.
  logIntakeAudit({
    source,
    userId,
    phoneMasked: maskPhoneForLog(input.phoneNumber || null),
    senderName: senderName || "",
    mediaType: savedMediaType || null,
    hasTranscript: !!(messageText && messageText.trim().length > 0),
    transcriptLen: (messageText || "").length,
    llmExtractedName: llmExtractedName || null,
    llmAbgleichStatus: abgleichStatus || "unknown",
    selfIntroFallbackUsed,
    resolvedCustomerName: kundeData.name || null,
    customerId,
    customerWasNewlyCreated,
    customerNameInDb: order.customer?.name || null,
    customerFallbackUsed: false,
  });

  return {
    orderId: order.id,
    description,
    customerName: order.customer?.name || "Unbekannt",
    serviceName,
    kundeStatus: parsed.system?.needs_review ? "unbestaetigt" : "bestaetigt",
    kundenabgleichStatus: abgleichStatus,
  };
}

// ---------- Fallback order creation (LLM failure) ----------
/**
 * Creates a manual-review fallback order from the raw incoming payload
 * when the LLM/AI analysis fails (credits exhausted, API error, network,
 * parse error, empty response, etc.).
 *
 * Rules:
 *   - Never invents customer data. Binds to a per-user placeholder customer.
 *   - Stores only the raw payload (text, images/thumbs, audio ref) + metadata.
 *   - Flags needsReview=true + hinweisLevel=warning so the UI shows the
 *     orange "Kundendaten unvollständig" badge on the order card.
 *   - Status stays 'Offen' so it appears in the default active orders view.
 *
 * @param input  The original IntakeInput that was being processed.
 * @param reason Machine-readable failure reason (e.g. 'llm_api_error',
 *               'llm_parse_error', 'llm_empty_response', 'llm_network_error').
 */
export async function createFallbackOrderFromRawPayload(
  input: IntakeInput,
  reason: string,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    messageText,
    savedMediaPath,
    savedMediaType,
    optimizedPreviewPath,
    optimizedThumbnailPath,
    userId: inputUserId,
    allOptimizedPreviewPaths,
    allOptimizedThumbnailPaths,
    audioDurationSec: inputAudioDurationSec,
    audioTranscriptionStatus: inputAudioTranscriptionStatus,
  } = input;
  const userId = inputUserId || null;
  if (!userId) {
    // No user → cannot create; already logged upstream. Do not invent anything.
    return null;
  }

  const FALLBACK_CUSTOMER_NAME = "⚠️ Unbekannt (WhatsApp)";

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const dataScope = await getActiveDataScope(userId);
  const fbSettings = await prisma.companySettings.findFirst({
    where: { userId },
  });
  const fbIntakeCurrency = fbSettings?.currency === "EUR" ? "EUR" : "CHF";
  const fbIntakeVatRate: number =
    fbSettings?.mwstAktiv === true && fbSettings?.mwstSatz != null
      ? Number(fbSettings.mwstSatz)
      : fbSettings?.mwstAktiv === false
        ? 0
        : 8.1;

  try {
    // Upsert per-user fallback customer (name-only; no guessed fields).
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, dataScope, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId, dataScope },
        select: { id: true, name: true },
      });
      console.log(
        `[${source}] 🆕 Fallback customer created: ${fallbackCustomer.id} for userId=${userId}`,
      );
    }

    // Assemble image arrays from whatever preprocessing already saved to S3.
    const imageUrls: string[] =
      allOptimizedPreviewPaths && allOptimizedPreviewPaths.length > 0
        ? (allOptimizedPreviewPaths.filter(Boolean) as string[])
        : optimizedPreviewPath
          ? [optimizedPreviewPath]
          : [];
    const thumbnailUrls: string[] =
      allOptimizedThumbnailPaths && allOptimizedThumbnailPaths.length > 0
        ? (allOptimizedThumbnailPaths.filter(Boolean) as string[])
        : optimizedThumbnailPath
          ? [optimizedThumbnailPath]
          : [];

    const rawText = (messageText || "").trim();
    // Description: raw text if present, otherwise neutral placeholder.
    const description =
      rawText.length > 0
        ? rawText
        : imageUrls.length > 0
          ? `(Nur Bild${imageUrls.length > 1 ? "er" : ""} erhalten – kein Text)`
          : "(Leere Nachricht)";

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Same rationale as createVoiceTooLongReviewOrder: every system-derived
    // metadata line gets a [META] prefix so the extract-from-notes heuristic
    // ignores it. Originaltext (the raw user message) is NOT prefixed —
    // that is genuine user content and may legitimately contain an address.
    const timestampIso = new Date().toISOString();
    const isLlmFailure = String(reason || "").startsWith("llm_");
    const notesParts = [
      isLlmFailure
        ? "⚠️ KI-Analyse fehlgeschlagen – bitte manuell prüfen."
        : "⚠️ Erfassung unvollständig – bitte kontrollieren und ergänzen.",
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || "Unbekannt"}`,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Grund: ${reason}`,
    ];
    if (rawText.length > 0) {
      notesParts.push(`Originaltext: ${rawText}`);
    }
    const notes = notesParts.join("\n");

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description,
        serviceName: null,
        status: "Offen",
        priceType: "Stundensatz",
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        currency: fbIntakeCurrency,
        vatRate: fbIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [reason],
        hinweisLevel: "warning",
        mediaUrl: savedMediaPath || null,
        mediaType: savedMediaType || null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        dataScope,
        // Stage I — even on LLM-fallback we still track audio usage if duration was detected
        audioDurationSec:
          savedMediaType === "audio"
            ? typeof inputAudioDurationSec === "number" &&
              isFinite(inputAudioDurationSec)
              ? Math.max(0, Math.round(inputAudioDurationSec))
              : null
            : null,
        // On LLM-fallback for audio messages, status defaults to 'failed' unless caller provided one
        audioTranscriptionStatus:
          savedMediaType === "audio"
            ? inputAudioTranscriptionStatus || "failed"
            : null,
      },
    });

    console.log(
      `[${source}] 🛟 Fallback order created: ${order.id} (reason=${reason}, sender=${senderName})`,
    );

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_FALLBACK`,
      area: "WEBHOOK",
      targetType: "Order",
      targetId: order.id,
      success: true,
      details: {
        reason,
        sender: senderName,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        rawTextLength: rawText.length,
        imageCount: imageUrls.length,
        hasAudio: savedMediaType === "audio",
      },
    });

    logIntakeAudit({
      source,
      userId,
      phoneMasked: maskPhoneForLog(input.phoneNumber || null),
      senderName: senderName || "",
      mediaType: savedMediaType || null,
      hasTranscript: !!(rawText && rawText.trim().length > 0),
      transcriptLen: (rawText || "").length,
      llmExtractedName: null,
      llmAbgleichStatus: "ki_fehler",
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `fallback: ${reason}`,
    });

    return {
      orderId: order.id,
      description,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: "",
      kundeStatus: "fallback_unknown",
      kundenabgleichStatus: "ki_fehler",
    };
  } catch (err: any) {
    console.error(
      `[${source}] ❌ Fallback order creation failed:`,
      err?.message || err,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_FALLBACK_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: `fallback_exception:${err?.message || "unknown"}`,
        originalReason: reason,
        sender: senderName,
      },
    });
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Stage H — Cost optimization: long voice messages (>60 s)
// ────────────────────────────────────────────────────────────────────────

export interface VoiceTooLongInput {
  /** 'WhatsApp' or 'Telegram'. */
  source: "Telegram" | "WhatsApp";
  /** WhatsApp ProfileName / Telegram first_name etc. */
  senderName: string;
  /** Sender phone (E.164) — only used for logging, not customer match. */
  phoneNumber?: string | null;
  /** S3 path of the original audio file (still archived/playable). */
  audioPath: string | null;
  /** Detected duration in seconds (rounded). null if duration parsing failed. */
  durationSec: number | null;
  /** Resolved owner of the message intake. */
  userId: string | null;
  /** Optional preview paths of images that came with the same message. */
  imagePreviewPaths?: string[];
  /** Optional thumbnail paths of images that came with the same message. */
  imageThumbnailPaths?: string[];
  /**
   * Why this review order is being created.
   *  - `'too_long'` (default): duration was reliably detected and exceeds the 60 s cap.
   *    Warning: "⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen".
   *  - `'uncheckable'`: duration could not be determined safely (parse failure,
   *    no metadata, FFmpeg probe failure). Audio was NOT transcribed in order to
   *    protect the cost cap — manual review is required.
   *    Warning: "⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen".
   *  - `'quota_exceeded'`: monthly audio-minute plan limit (e.g. 20 min on Standard)
   *    would be exceeded by transcribing this audio. Audio is saved + linked, but
   *    NOT transcribed — manual review required. Warning:
   *    "⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen".
   *  - `'transcription_failed'`: OpenAI transcription returned an error (400, timeout,
   *    corrupted file, etc.). Audio is saved + linked, but no transcript available.
   *    Warning: "⚠️ Transkription fehlgeschlagen – bitte manuell prüfen".
   */
  reason?:
    | "too_long"
    | "uncheckable"
    | "quota_exceeded"
    | "transcription_failed";
  /**
   * Optional usage snapshot for the audit log when reason='quota_exceeded'.
   * Omitted in other paths.
   */
  quotaUsedMinutes?: number;
  /** Optional plan limit snapshot for the audit log when reason='quota_exceeded'. */
  quotaIncludedMinutes?: number;
}

/**
 * Creates a visible review order for a voice message that exceeds the 60s
 * cost-control cap, WITHOUT calling the LLM (cost-saving short-circuit).
 *
 * Mirrors the customer-fallback pattern of {@link createFallbackOrderFromRawPayload}:
 * - Per-user "⚠️ Unbekannt (WhatsApp)" customer (created on first use).
 * - `needsReview = true`, `hinweisLevel = 'warning'`, `reviewReasons = ['voice_too_long']`.
 * - Original audio is still linked (`mediaUrl`) so it remains playable in the order detail view.
 * - No transcription, no AI vision, no service detection.
 *
 * Description is the exact German warning text required by the spec.
 */
export async function createVoiceTooLongReviewOrder(
  input: VoiceTooLongInput,
): Promise<IntakeResult | null> {
  const {
    source,
    senderName,
    phoneNumber,
    audioPath,
    durationSec,
    userId,
    imagePreviewPaths,
    imageThumbnailPaths,
  } = input;
  const reason:
    | "too_long"
    | "uncheckable"
    | "quota_exceeded"
    | "transcription_failed" = input.reason ?? "too_long";
  const quotaUsedMinutes = input.quotaUsedMinutes;
  const quotaIncludedMinutes = input.quotaIncludedMinutes;

  if (!userId) {
    console.warn(
      `[${source}] ❌ createVoiceTooLongReviewOrder: missing userId — cannot create order.`,
    );
    return null;
  }

  // Resolve default VAT rate from CompanySettings (same logic as main intake path)
  const dataScope = await getActiveDataScope(userId);
  const voiceSettings = await prisma.companySettings.findFirst({
    where: { userId },
  });
  const voiceIntakeCurrency = voiceSettings?.currency === "EUR" ? "EUR" : "CHF";
  const voiceIntakeVatRate: number =
    voiceSettings?.mwstAktiv === true && voiceSettings?.mwstSatz != null
      ? Number(voiceSettings.mwstSatz)
      : voiceSettings?.mwstAktiv === false
        ? 0
        : 8.1;

  const FALLBACK_CUSTOMER_NAME =
    source === "WhatsApp"
      ? "⚠️ Unbekannt (WhatsApp)"
      : "⚠️ Unbekannt (Telegram)";

  // Exact required German warning text — DO NOT change wording.
  const WARNING_DESCRIPTION =
    reason === "transcription_failed"
      ? "⚠️ Transkription fehlgeschlagen – bitte manuell prüfen"
      : reason === "quota_exceeded"
        ? "⚠️ Monatliches Audio-Limit erreicht – bitte manuell prüfen"
        : reason === "uncheckable"
          ? "⚠️ Sprachnachricht konnte zeitlich nicht geprüft werden – bitte manuell prüfen"
          : "⚠️ Sprachnachricht länger als 60 Sekunden – bitte manuell prüfen";

  // Lifecycle marker written to Order.audioTranscriptionStatus so usage and
  // CommunicationBlock chips can distinguish the cost-protection paths.
  const STATUS_VALUE:
    | "skipped_too_long"
    | "skipped_uncheckable"
    | "skipped_quota_exceeded"
    | "failed" =
    reason === "transcription_failed"
      ? "failed"
      : reason === "quota_exceeded"
        ? "skipped_quota_exceeded"
        : reason === "uncheckable"
          ? "skipped_uncheckable"
          : "skipped_too_long";

  // Tag in Order.reviewReasons array so dashboard filters can pick this up.
  const REVIEW_REASON_TAG:
    | "voice_too_long"
    | "voice_uncheckable"
    | "voice_quota_exceeded"
    | "voice_transcription_failed" =
    reason === "transcription_failed"
      ? "voice_transcription_failed"
      : reason === "quota_exceeded"
        ? "voice_quota_exceeded"
        : reason === "uncheckable"
          ? "voice_uncheckable"
          : "voice_too_long";

  // Audit suffix mirrors the existing `voice_too_long` events for traceability.
  const AUDIT_SUFFIX =
    reason === "transcription_failed"
      ? "VOICE_TRANSCRIPTION_FAILED"
      : reason === "quota_exceeded"
        ? "VOICE_QUOTA_EXCEEDED"
        : reason === "uncheckable"
          ? "VOICE_UNCHECKABLE"
          : "VOICE_TOO_LONG";

  try {
    // Upsert per-user fallback customer (same pattern as createFallbackOrderFromRawPayload)
    let fallbackCustomer = await prisma.customer.findFirst({
      where: { userId, dataScope, name: FALLBACK_CUSTOMER_NAME, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!fallbackCustomer) {
      fallbackCustomer = await prisma.customer.create({
        data: { name: FALLBACK_CUSTOMER_NAME, userId, dataScope },
        select: { id: true, name: true },
      });
      console.log(
        `[${source}] 🆕 Fallback customer created (${REVIEW_REASON_TAG}): ${fallbackCustomer.id} for userId=${userId}`,
      );
    }

    const timestampIso = new Date().toISOString();
    const durationLabel =
      typeof durationSec === "number" && isFinite(durationSec)
        ? `${Math.round(durationSec)}s`
        : "unbekannt";

    // ─── Layer 1 of three-layer customer-data-pollution defense ───
    // Every metadata line (sender phone, timestamp, audio duration, ...) is
    // prefixed with the [META] tag so that the auto-fill heuristic in
    // lib/extract-from-notes.ts can deterministically skip these lines and
    // never mistake e.g. a Twilio sandbox number for the customer's phone or
    // a year out of an ISO timestamp for a PLZ.
    //
    // The warning description and the user-facing "Hinweis:" lines stay
    // unprefixed because they contain no extractable address-like patterns.
    const notes = [
      WARNING_DESCRIPTION,
      `[META] Quelle: ${source}`,
      `[META] Absender (WhatsApp/Telegram-Profilname): ${senderName || "Unbekannt"}`,
      phoneNumber
        ? `[META] Telefon (Absender, NICHT Kunde): ${phoneNumber}`
        : null,
      `[META] Empfangen: ${timestampIso}`,
      `[META] Audiodauer: ${durationLabel}`,
      reason === "quota_exceeded" &&
      typeof quotaUsedMinutes === "number" &&
      typeof quotaIncludedMinutes === "number"
        ? `[META] Audio-Verbrauch diesen Monat: ${Number.isInteger(quotaUsedMinutes) ? quotaUsedMinutes : quotaUsedMinutes.toFixed(1)} / ${quotaIncludedMinutes} Min`
        : null,
      reason === "quota_exceeded"
        ? "Audio ist im Auftrag abrufbar – bitte manuell anhören."
        : "Audio ist im Auftrag abrufbar – bitte manuell anhören.",
    ]
      .filter(Boolean)
      .join("\n");

    const imageUrls: string[] = (imagePreviewPaths || []).filter(
      Boolean,
    ) as string[];
    const thumbnailUrls: string[] = (imageThumbnailPaths || []).filter(
      Boolean,
    ) as string[];

    const order = await prisma.order.create({
      data: {
        customerId: fallbackCustomer.id,
        description: "",
        serviceName: null,
        status: "Offen",
        priceType: "Stundensatz",
        unitPrice: 0,
        quantity: 0,
        totalPrice: 0,
        currency: voiceIntakeCurrency,
        vatRate: voiceIntakeVatRate,
        vatAmount: 0,
        total: 0,
        needsReview: true,
        reviewReasons: [REVIEW_REASON_TAG],
        hinweisLevel: "warning",
        mediaUrl: audioPath || null,
        mediaType: audioPath ? "audio" : null,
        imageUrls,
        thumbnailUrls,
        notes,
        userId,
        dataScope,
        // Stage I — audio usage tracking for the cost-cap path.
        // For 'uncheckable' we typically don't have a duration, so this stays null
        // (the order is intentionally excluded from the monthly minutes total).
        audioDurationSec:
          typeof durationSec === "number" && isFinite(durationSec)
            ? Math.max(0, Math.round(durationSec))
            : null,
        audioTranscriptionStatus: STATUS_VALUE,
      },
    });

    console.log(
      `[${source}] ⏱️ Voice review order created (reason=${reason}): orderId=${order.id} duration=${durationLabel} sender=${senderName} phone=${phoneNumber ?? "?"}`,
    );

    logAuditAsync({
      userId,
      action: `ORDER_CREATED_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}`,
      area: "WEBHOOK",
      targetType: "Order",
      targetId: order.id,
      success: true,
      details: {
        reason: REVIEW_REASON_TAG,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec:
          typeof durationSec === "number" ? Math.round(durationSec) : null,
        customerId: fallbackCustomer.id,
        customer: FALLBACK_CUSTOMER_NAME,
        transcriptionSkipped: true,
        hasAudio: !!audioPath,
        imageCount: imageUrls.length,
      },
    });

    logIntakeAudit({
      source,
      userId: userId ?? null,
      phoneMasked: maskPhoneForLog(phoneNumber || null),
      senderName: senderName || "",
      mediaType: "audio",
      hasTranscript: false,
      transcriptLen: 0,
      llmExtractedName: null,
      llmAbgleichStatus: REVIEW_REASON_TAG,
      selfIntroFallbackUsed: false,
      resolvedCustomerName: FALLBACK_CUSTOMER_NAME,
      customerId: fallbackCustomer.id,
      customerWasNewlyCreated: false,
      customerNameInDb: FALLBACK_CUSTOMER_NAME,
      customerFallbackUsed: true,
      notes: `voice_review: ${REVIEW_REASON_TAG} dur=${typeof durationSec === "number" ? Math.round(durationSec) : "null"}`,
    });

    return {
      orderId: order.id,
      description: WARNING_DESCRIPTION,
      customerName: FALLBACK_CUSTOMER_NAME,
      serviceName: "",
      kundeStatus: "fallback_unknown",
      kundenabgleichStatus: REVIEW_REASON_TAG,
    };
  } catch (err: any) {
    console.error(
      `[${source}] ❌ createVoiceTooLongReviewOrder failed (reason=${reason}):`,
      err?.message || err,
    );
    logAuditAsync({
      userId,
      action: `ORDER_CREATE_FROM_${source.toUpperCase()}_${AUDIT_SUFFIX}_FAILED`,
      area: "WEBHOOK",
      success: false,
      details: {
        reason: `${REVIEW_REASON_TAG}_exception:${err?.message || "unknown"}`,
        sender: senderName,
        phone: phoneNumber ?? null,
        durationSec:
          typeof durationSec === "number" ? Math.round(durationSec) : null,
      },
    });
    return null;
  }
}
