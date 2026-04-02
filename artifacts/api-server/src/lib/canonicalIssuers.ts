/**
 * Canonical issuer name normalization.
 *
 * Maps common AI-output variants → a single canonical display name.
 * All lookups are case-insensitive on the trimmed input.
 *
 * Add entries whenever new variant spellings appear in the data.
 */
const CANONICAL_MAP: Record<string, string> = {
  // Nike
  "nike": "Nike",
  "nike inc": "Nike",
  "nike inc.": "Nike",
  "nike, inc.": "Nike",
  "nike, inc": "Nike",
  "nike incorporated": "Nike",

  // Apple
  "apple": "Apple",
  "apple inc": "Apple",
  "apple inc.": "Apple",
  "apple, inc.": "Apple",
  "apple incorporated": "Apple",

  // Microsoft
  "microsoft": "Microsoft",
  "microsoft corp": "Microsoft",
  "microsoft corp.": "Microsoft",
  "microsoft corporation": "Microsoft",

  // Amazon
  "amazon": "Amazon",
  "amazon.com": "Amazon",
  "amazon.com inc": "Amazon",
  "amazon.com inc.": "Amazon",
  "amazon.com, inc.": "Amazon",
  "amazon web services": "Amazon",

  // Google / Alphabet
  "google": "Google",
  "alphabet": "Alphabet",
  "alphabet inc": "Alphabet",
  "alphabet inc.": "Alphabet",
  "alphabet, inc.": "Alphabet",

  // Meta
  "meta": "Meta",
  "meta platforms": "Meta",
  "meta platforms inc": "Meta",
  "meta platforms inc.": "Meta",
  "facebook": "Meta",

  // Tesla
  "tesla": "Tesla",
  "tesla inc": "Tesla",
  "tesla inc.": "Tesla",
  "tesla motors": "Tesla",

  // Pfizer
  "pfizer": "Pfizer",
  "pfizer inc": "Pfizer",
  "pfizer inc.": "Pfizer",

  // JPMorgan
  "jpmorgan": "JPMorgan",
  "jpmorgan chase": "JPMorgan",
  "jp morgan": "JPMorgan",
  "jp morgan chase": "JPMorgan",
  "jpmorgan chase & co": "JPMorgan",
  "jpmorgan chase & co.": "JPMorgan",

  // Goldman Sachs
  "goldman sachs": "Goldman Sachs",
  "goldman": "Goldman Sachs",
  "the goldman sachs group": "Goldman Sachs",
  "goldman sachs group": "Goldman Sachs",

  // Ford
  "ford": "Ford",
  "ford motor": "Ford",
  "ford motor company": "Ford",
  "ford motor co": "Ford",

  // General Motors
  "gm": "General Motors",
  "general motors": "General Motors",
  "general motors co": "General Motors",

  // AT&T
  "at&t": "AT&T",
  "att": "AT&T",
  "at & t": "AT&T",

  // Verizon
  "verizon": "Verizon",
  "verizon communications": "Verizon",

  // Walmart
  "walmart": "Walmart",
  "wal-mart": "Walmart",
  "wal mart": "Walmart",
  "walmart inc": "Walmart",
  "walmart inc.": "Walmart",

  // Disney
  "disney": "Disney",
  "the walt disney company": "Disney",
  "walt disney": "Disney",

  // Oracle
  "oracle": "Oracle",
  "oracle corp": "Oracle",
  "oracle corp.": "Oracle",
  "oracle corporation": "Oracle",

  // Adobe
  "adobe": "Adobe",
  "adobe inc": "Adobe",
  "adobe inc.": "Adobe",
  "adobe systems": "Adobe",

  // Ericsson
  "ericsson": "Ericsson",
  "telefonaktiebolaget ericsson": "Ericsson",
  "lm ericsson": "Ericsson",

  // McCormick
  "mccormick": "McCormick",
  "mccormick & company": "McCormick",
  "mccormick & co": "McCormick",

  // Vanke
  "vanke": "Vanke",
  "china vanke": "Vanke",
  "china vanke co": "Vanke",

  // KKR
  "kkr": "KKR",
  "kkr & co": "KKR",
  "kkr & co.": "KKR",
  "kkr & co. inc": "KKR",

  // Blue Owl
  "blue owl": "Blue Owl",
  "blue owl capital": "Blue Owl",
  "blue owl capital inc": "Blue Owl",

  // Invesco
  "invesco": "Invesco",
  "invesco ltd": "Invesco",
  "invesco ltd.": "Invesco",

  // QXO
  "qxo": "QXO",
  "qxo inc": "QXO",
  "qxo inc.": "QXO",

  // Rithm Capital
  "rithm capital": "Rithm Capital",
  "rithm": "Rithm Capital",

  // Opendoor
  "opendoor": "Opendoor",
  "opendoor technologies": "Opendoor",
  "opendoor technologies inc": "Opendoor",

  // Canada Post
  "canada post": "Canada Post",
  "canada post corp": "Canada Post",
  "canada post corporation": "Canada Post",

  // Silgan
  "silgan": "Silgan",
  "silgan holdings": "Silgan",
  "silgan holdings inc": "Silgan",
  "silgan holdings inc.": "Silgan",

  // CorMedix
  "cormedix": "CorMedix",
  "cormedix inc": "CorMedix",
  "cormedix inc.": "CorMedix",

  // SpaceX
  "spacex": "SpaceX",
  "space exploration technologies": "SpaceX",
  "space exploration technologies corp": "SpaceX",
};

/**
 * Returns the canonical form of an issuer name, or the input unchanged
 * if no mapping is found. Returns null if the input is null/empty.
 */
export function canonicalizeIssuer(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;

  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  return CANONICAL_MAP[key] ?? trimmed;
}
