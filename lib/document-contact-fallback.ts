export type DocumentContactChannel = "call" | "whatsapp" | "sms" | "email" | null;

export type DocumentContactFallback = {
  name: string;
  phone: string;
  email: string;
  channel: DocumentContactChannel;
  minutesBefore: number | null;
  notCall: boolean;
  noSms: boolean;
  noWhatsapp: boolean;
  title: string;
};

const compact = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

const normalize = (value: unknown) =>
  compact(value)
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9@+._\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const phoneCandidates = (value: unknown): string[] =>
  Array.from(
    new Set(
      Array.from(
        String(value ?? "").matchAll(/(?:\+?\d[\d\s()./-]{6,}\d)/g),
      )
        .map((match) => compact(match[0]))
        .filter((candidate) => {
          const digits = candidate.replace(/\D/g, "");
          return digits.length >= 9 && digits.length <= 15;
        }),
    ),
  );

const emailCandidates = (value: unknown): string[] =>
  Array.from(
    new Set(
      Array.from(
        String(value ?? "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
      ).map((match) => compact(match[0])),
    ),
  );

const cleanName = (value: unknown): string => {
  const candidate = compact(value)
    .replace(/^[\s:.,;\-–—]+|[\s:.,;\-–—]+$/g, "")
    .replace(/^(?:ist|heisst|heißt)\s+/i, "")
    .replace(/\s+(?:zustaendig|zuständig|erreichbar|vor ort)$/i, "")
    .trim();
  if (!candidate || /\d|@/.test(candidate)) return "";
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return "";
  if (
    words.some(
      (word) =>
        !/^[\p{Lu}ÄÖÜÀ-Ý][\p{L}'’.-]+$/u.test(word) &&
        !/^(?:Herr|Frau|Mr\.?|Mrs\.?|Ms\.?|Mme\.?)$/u.test(word),
    )
  ) {
    return "";
  }
  return candidate;
};

const contactMarker =
  /\b(?:kontaktperson(?:\s+vor\s+ort)?|kontakt\s+vor\s+ort|ansprechperson(?:\s+vor\s+ort)?|ansprechpartner(?:in)?(?:\s+vor\s+ort)?|vor\s+ort\s+(?:ist|zustaendig|zuständig)|on[-\s]?site\s+contact|contact\s+sur\s+place|contatto\s+sul\s+posto|contacto\s+en\s+sitio)\b/i;

function extractScopedContact(source: string): {
  scope: string;
  name: string;
  phone: string;
  email: string;
} {
  const matches = Array.from(source.matchAll(new RegExp(contactMarker.source, "gi")));
  if (matches.length === 0) {
    return { scope: "", name: "", phone: "", email: "" };
  }

  const candidates = matches.map((marker) => {
    const markerIndex = Number(marker.index || 0);
    const scope = source.slice(markerIndex, markerIndex + 560);
    const lines = scope
      .split(/\n+/)
      .map((line) => compact(line))
      .filter(Boolean);

    let name = "";
    const markerLine = lines[0] || "";
    const inlineAfterMarker = markerLine
      .replace(contactMarker, "")
      .replace(/^\s*[:.,;\-–—]*\s*/, "");
    name = cleanName(inlineAfterMarker);

    if (!name) {
      for (const line of lines.slice(1, 5)) {
        const candidate = cleanName(line);
        if (candidate) {
          name = candidate;
          break;
        }
      }
    }

    if (!name) {
      const inlineMatch = scope.match(
        /\b(?:vor\s+ort\s+(?:ist|zustaendig|zuständig)|kontaktperson(?:\s+vor\s+ort)?|kontakt\s+vor\s+ort|ansprechperson(?:\s+vor\s+ort)?)\s*:?\s*(?:ist\s+)?((?:[A-ZÄÖÜÀ-Ý][\p{L}'’.-]+\s+){1,3}[A-ZÄÖÜÀ-Ý][\p{L}'’.-]+)/u,
      );
      name = cleanName(inlineMatch?.[1]);
    }

    const phone = phoneCandidates(scope)[0] || "";
    const email = emailCandidates(scope)[0] || "";
    const score = (name ? 20 : 0) + (phone ? 30 : 0) + (email ? 30 : 0);
    return { scope, name, phone, email, score };
  });

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  return {
    scope: best?.scope || "",
    name: best?.name || "",
    phone: best?.phone || "",
    email: best?.email || "",
  };
}

function detectPositiveChannel(source: string, name: string): {
  channel: DocumentContactChannel;
  line: string;
} {
  const lines = source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compact(line))
    .filter(Boolean);
  const normalizedName = normalize(name);
  const weighted = lines
    .map((line) => {
      const text = normalize(line);
      let score = 0;
      if (normalizedName && text.includes(normalizedName)) score += 30;
      if (/\b(?:ausschliesslich|nur|only|exclusively|uniquement|solo)\b/.test(text)) score += 20;
      if (/\b\d{1,3}\s*minuten?\s*(?:vorher|vor)\b/.test(text)) score += 8;
      return { line, text, score };
    })
    .sort((left, right) => right.score - left.score);

  for (const entry of weighted) {
    const text = entry.text;
    const negated = (token: string) =>
      new RegExp(
        `\\b(?:nicht|kein|keine|ohne|no|not|never)\\b.{0,30}\\b(?:${token})\\b`,
        "i",
      ).test(text);
    if (/\bwhatsapp\b/.test(text) && !negated("whatsapp")) {
      return { channel: "whatsapp", line: entry.line };
    }
    if (/\bsms\b/.test(text) && !negated("sms")) {
      return { channel: "sms", line: entry.line };
    }
    if (/\b(?:e mail|email|mail|courriel)\b/.test(text) && !negated("e mail|email|mail|courriel")) {
      return { channel: "email", line: entry.line };
    }
    if (/\b(?:anrufen|telefonisch\s+melden|rueckruf|zurueckrufen|call)\b/.test(text) && !negated("anrufen|telefon|rueckruf|call")) {
      return { channel: "call", line: entry.line };
    }
  }
  return { channel: null, line: "" };
}

export function extractDocumentContactFallback(
  ...values: Array<string | null | undefined>
): DocumentContactFallback {
  const source = values.map(compact).filter(Boolean).join("\n");
  if (!source) {
    return {
      name: "",
      phone: "",
      email: "",
      channel: null,
      minutesBefore: null,
      notCall: false,
      noSms: false,
      noWhatsapp: false,
      title: "",
    };
  }

  const scoped = extractScopedContact(source);
  const positive = detectPositiveChannel(source, scoped.name);
  const minutesMatch = (positive.line || source).match(
    /\b(\d{1,3})\s*Min(?:ute)?n?\s*(?:vorher|vor)\b/i,
  );
  const notCall = /\b(?:nicht|kein|keine|ohne|no|not|never)\b.{0,45}\b(?:anrufen|telefon|telefonisch|rueckruf|rückruf|call)\b/i.test(
    source,
  );
  const noSms = /\b(?:nicht|kein|keine|ohne|no|not|never)\b.{0,30}\bsms\b/i.test(
    source,
  );
  const noWhatsapp = /\b(?:nicht|kein|keine|ohne|no|not|never)\b.{0,30}\bwhatsapp\b/i.test(
    source,
  );

  const channelLabel =
    positive.channel === "whatsapp"
      ? "nur WhatsApp"
      : positive.channel === "sms"
        ? "nur SMS"
        : positive.channel === "email"
          ? "nur E-Mail"
          : positive.channel === "call"
            ? "anrufen"
            : "";
  const target = positive.channel === "email" ? scoped.email : scoped.phone;
  const parts = [
    scoped.name,
    target,
    channelLabel,
    minutesMatch ? `${Number(minutesMatch[1])} Minuten vorher` : "",
    notCall && positive.channel !== "call" ? "nicht anrufen" : "",
    noSms && positive.channel !== "sms" ? "keine SMS" : "",
    noWhatsapp && positive.channel !== "whatsapp" ? "kein WhatsApp" : "",
  ].filter(Boolean);

  return {
    name: scoped.name,
    phone: scoped.phone,
    email: scoped.email,
    channel: positive.channel,
    minutesBefore: minutesMatch ? Number(minutesMatch[1]) : null,
    notCall,
    noSms,
    noWhatsapp,
    title: parts.length > 0 ? `Kontakt vor Ort: ${parts.join(" · ")}` : "",
  };
}
