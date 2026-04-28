/**
 * Robustes Adress-Parsing für Schweizer Adressen
 * Erkennt Muster wie:
 * - "Landstr. 5, 5430 Wettingen"
 * - "Bahnhofstrasse 15 5430 Wettingen"
 * - "5430 Wettingen, Hauptstr. 3"
 * - "Schartenstrasse 127, Wettingen"
 */

export interface ParsedAddress {
  street: string | null;
  plz: string | null;
  city: string | null;
}

// Swiss PLZ (4 digits) or German PLZ (5 digits) starting with 1-9
const PLZ_PATTERN = /\b([1-9]\d{3,4})\b/;

// Common Swiss street suffixes
const STREET_INDICATORS = /(?:str(?:asse|\.)?|weg|gasse|platz|rain|acher?|matt(?:e)?|feld|berg|bühl|halde|graben|ring|allee|promenade)/i;

/**
 * Parse a combined address string into street, PLZ, and city components
 */
export function parseSwissAddress(combined: string | null | undefined): ParsedAddress {
  if (!combined || !combined.trim()) {
    return { street: null, plz: null, city: null };
  }

  const input = combined.trim();
  let street: string | null = null;
  let plz: string | null = null;
  let city: string | null = null;

  // Try to extract PLZ (4-digit Swiss postal code)
  const plzMatch = input.match(PLZ_PATTERN);
  if (plzMatch) {
    plz = plzMatch[1];
    
    // Get the text after PLZ — that's likely the city
    const afterPlz = input.substring(input.indexOf(plzMatch[0]) + plzMatch[0].length).trim();
    // Get the text before PLZ — could be street or "street, "
    const beforePlz = input.substring(0, input.indexOf(plzMatch[0])).trim();
    
    // City is typically right after PLZ
    if (afterPlz) {
      // City might be followed by more text separated by comma
      const cityPart = afterPlz.split(/[,;]/)[0].trim();
      if (cityPart && !STREET_INDICATORS.test(cityPart)) {
        city = cityPart;
      } else if (cityPart && STREET_INDICATORS.test(cityPart)) {
        // Rare: street after PLZ+city
        street = cityPart;
      }
      
      // If there's more after the city (after comma), could be street
      const afterCity = afterPlz.includes(',') ? afterPlz.split(',').slice(1).join(',').trim() : null;
      if (afterCity && STREET_INDICATORS.test(afterCity)) {
        street = afterCity;
      }
    }
    
    // Before PLZ is typically the street
    if (beforePlz) {
      const cleanBefore = beforePlz.replace(/[,;]+$/, '').trim();
      if (cleanBefore) {
        if (!street) {
          street = cleanBefore;
        } else if (!city) {
          city = cleanBefore;
        }
      }
    }
  } else {
    // No PLZ found — try to split by comma
    const parts = input.split(/[,;]/).map(p => p.trim()).filter(Boolean);
    
    if (parts.length >= 2) {
      // Check which part looks like a street vs city
      for (const part of parts) {
        if (STREET_INDICATORS.test(part) || /\d+[a-z]?$/i.test(part)) {
          if (!street) street = part;
        } else {
          if (!city) city = part;
        }
      }
      // If nothing matched as street, take the first part
      if (!street && !city) {
        street = parts[0];
        city = parts.length > 1 ? parts[1] : null;
      } else if (!street) {
        // All parts looked like cities — first is probably street
        street = parts[0];
      }
    } else {
      // Single part, no PLZ — check if it looks like a street or city
      if (STREET_INDICATORS.test(input) || /\d+[a-z]?$/i.test(input)) {
        street = input;
      } else {
        city = input;
      }
    }
  }

  return {
    street: street || null,
    plz: plz || null,
    city: city || null,
  };
}

/**
 * Ensure address fields are properly split.
 * If street/plz/city are all null but a combined address exists, parse it.
 * If street contains PLZ or city info, extract and split.
 */
export function ensureAddressSplit(data: {
  customerStreet?: string | null;
  customerPlz?: string | null;
  customerCity?: string | null;
  customerAddress?: string | null;
}): { street: string | null; plz: string | null; city: string | null } {
  let street = (data.customerStreet || '').trim() || null;
  let plz = (data.customerPlz || '').trim() || null;
  let city = (data.customerCity || '').trim() || null;
  const combinedAddress = (data.customerAddress || '').trim() || null;

  // Case 1: LLM returned a combined customerAddress field
  if (combinedAddress && !street && !plz && !city) {
    const parsed = parseSwissAddress(combinedAddress);
    return parsed;
  }

  // Case 2: LLM put everything into customerStreet
  if (street && !plz && !city) {
    // Check if street contains PLZ or city info
    if (PLZ_PATTERN.test(street) || street.includes(',')) {
      const parsed = parseSwissAddress(street);
      if (parsed.plz || parsed.city) {
        return parsed;
      }
    }
  }

  // Case 3: PLZ might be embedded in city ("5430 Wettingen")
  if (!plz && city) {
    const plzInCity = city.match(PLZ_PATTERN);
    if (plzInCity) {
      plz = plzInCity[1];
      city = city.replace(plzInCity[0], '').trim() || null;
    }
  }

  // Case 4: City might be embedded in street
  if (street && !city) {
    const parts = street.split(',').map(p => p.trim());
    if (parts.length > 1) {
      street = parts[0];
      const rest = parts.slice(1).join(', ');
      const parsed = parseSwissAddress(rest);
      if (parsed.city) city = parsed.city;
      if (parsed.plz && !plz) plz = parsed.plz;
    }
  }

  // Validate PLZ format (4-5 digits, Swiss or German)
  if (plz && !/^[1-9]\d{3,4}$/.test(plz)) {
    // Try to extract valid PLZ
    const plzExtract = plz.match(/([1-9]\d{3,4})/);
    plz = plzExtract ? plzExtract[1] : null;
  }

  return { street, plz, city };
}
