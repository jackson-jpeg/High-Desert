/**
 * filename-parser.ts
 *
 * Parses Art Bell radio archive filenames to extract structured metadata.
 * Handles multiple common naming conventions found across archive collections.
 */

export interface ParsedFilename {
  airDate?: string;    // ISO format YYYY-MM-DD
  guestName?: string;
  showType?: "coast" | "dreamland" | "special" | "unknown";
  topic?: string;
}

// ── Show-type detection ────────────────────────────────────────────────

const SHOW_TYPE_PATTERNS: Array<{ pattern: RegExp; type: ParsedFilename["showType"] }> = [
  { pattern: /coast\s*to\s*coast/i, type: "coast" },
  { pattern: /\bc2c\b/i, type: "coast" },
  { pattern: /\bctcam?\b/i, type: "coast" },
  { pattern: /dreamland/i, type: "dreamland" },
  { pattern: /\bdl[\s_]/i, type: "dreamland" },
  { pattern: /special/i, type: "special" },
  { pattern: /\bart\s*bell\b/i, type: "coast" },
  { pattern: /^ab[_\s]/i, type: "coast" },
];

function detectShowType(filename: string): ParsedFilename["showType"] {
  for (const { pattern, type } of SHOW_TYPE_PATTERNS) {
    if (pattern.test(filename)) return type;
  }
  return "unknown";
}

// ── Date parsing helpers ───────────────────────────────────────────────

/** Converts a 2-digit year to 4-digit. Art Bell era = 1988-2018. */
function expandYear(yy: string): string {
  const num = parseInt(yy, 10);
  return num >= 88 ? `19${yy}` : `20${yy.padStart(2, "0")}`;
}

/** Validates and returns an ISO date string, or undefined if invalid. */
function toISODate(year: string, month: string, day: string): string | undefined {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);

  if (y < 1988 || y > 2018) return undefined;
  if (m < 1 || m > 12) return undefined;
  if (d < 1 || d > 31) return undefined;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// ── Guest / topic cleaning ─────────────────────────────────────────────

/** Strip noise words and formatting artifacts from guest/topic strings. */
function cleanName(raw: string): string {
  return raw
    .replace(/[_]+/g, " ")              // underscores → spaces
    .replace(/[-]{2,}/g, " ")           // multiple dashes → space
    .replace(/\s+/g, " ")              // collapse whitespace
    .replace(/^\s*[-–—]\s*/, "")        // leading dashes
    .replace(/\s*[-–—]\s*$/, "")        // trailing dashes
    .trim();
}

/** Title-case a cleaned name string. */
function titleCase(str: string): string {
  return str
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// ── Known topics that are not guest names ──────────────────────────────

const TOPIC_KEYWORDS = [
  "open lines",
  "ghost to ghost",
  "best of",
  "replay",
  "rebroadcast",
  "special edition",
  "news",
  "predictions",
  "bumper music",
  "somewhere in time",
];

function isTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return TOPIC_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Filename patterns ──────────────────────────────────────────────────

type PatternExtractor = (filename: string) => ParsedFilename | null;

/**
 * Pattern 1: "Art Bell YYYY-MM-DD Guest Name.mp3"
 * Also matches: "Art Bell - YYYY-MM-DD - Guest Name.mp3"
 */
const parseArtBellLong: PatternExtractor = (filename) => {
  const match = filename.match(
    /art\s*bell\s*[-–—]?\s*(\d{4})[-.](\d{2})[-.](\d{2})\s*[-–—]?\s*(.*)/i
  );
  if (!match) return null;

  const [, year, month, day, rest] = match;
  const airDate = toISODate(year, month, day);
  const rawName = rest.replace(/\.\w{2,4}$/, "").trim();

  const result: ParsedFilename = { airDate, showType: "coast" };

  if (rawName) {
    const cleaned = cleanName(rawName);
    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
  }

  return result;
};

/**
 * Pattern 2: "ab_YYMMDD.mp3" (compact Art Bell format)
 * Also matches: "ab-YYMMDD.mp3", "ab YYMMDD.mp3"
 */
const parseAbCompact: PatternExtractor = (filename) => {
  const match = filename.match(
    /^ab[_\s-](\d{2})(\d{2})(\d{2})(?:[_\s-](.+))?\.\w{2,4}$/i
  );
  if (!match) return null;

  const [, yy, mm, dd, rest] = match;
  const year = expandYear(yy);
  const airDate = toISODate(year, mm, dd);

  const result: ParsedFilename = { airDate, showType: "coast" };

  if (rest) {
    const cleaned = cleanName(rest);
    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
  }

  return result;
};

/**
 * Pattern 3: "Coast to Coast AM - YYYY-MM-DD - Guest Name.mp3"
 * Also matches without "AM", with various separators
 */
const parseCoastToCoast: PatternExtractor = (filename) => {
  const match = filename.match(
    /coast\s*to\s*coast(?:\s*am)?\s*[-–—]\s*(\d{4})[-.](\d{2})[-.](\d{2})\s*[-–—]\s*(.*)/i
  );
  if (!match) return null;

  const [, year, month, day, rest] = match;
  const airDate = toISODate(year, month, day);
  const rawName = rest.replace(/\.\w{2,4}$/, "").trim();

  const result: ParsedFilename = { airDate, showType: "coast" };

  if (rawName) {
    const cleaned = cleanName(rawName);
    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
  }

  return result;
};

/**
 * Pattern 4: "dreamland_YYYYMMDD_guest_name.mp3"
 * Also matches: "dreamland-YYYY-MM-DD-guest-name.mp3"
 */
const parseDreamland: PatternExtractor = (filename) => {
  // With compact date YYYYMMDD
  const compactMatch = filename.match(
    /dreamland[_\s-](\d{4})(\d{2})(\d{2})[_\s-](.*)\.\w{2,4}$/i
  );
  if (compactMatch) {
    const [, year, month, day, rest] = compactMatch;
    const airDate = toISODate(year, month, day);
    const cleaned = cleanName(rest);
    const result: ParsedFilename = { airDate, showType: "dreamland" };

    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
    return result;
  }

  // With separated date YYYY-MM-DD
  const separatedMatch = filename.match(
    /dreamland[_\s-](\d{4})[-.](\d{2})[-.](\d{2})[_\s-](.*)\.\w{2,4}$/i
  );
  if (separatedMatch) {
    const [, year, month, day, rest] = separatedMatch;
    const airDate = toISODate(year, month, day);
    const cleaned = cleanName(rest);
    const result: ParsedFilename = { airDate, showType: "dreamland" };

    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
    return result;
  }

  // Dreamland with date only, no guest
  const dateOnlyMatch = filename.match(
    /dreamland[_\s-](\d{4})(\d{2})(\d{2})\.\w{2,4}$/i
  );
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const airDate = toISODate(year, month, day);
    return { airDate, showType: "dreamland" };
  }

  return null;
};

/**
 * Pattern 5: "YYYY-MM-DD Guest Name.mp3" (date-first, no show prefix)
 * Also matches: "YYYY.MM.DD Guest Name.mp3"
 */
const parseDateFirst: PatternExtractor = (filename) => {
  const match = filename.match(
    /^(\d{4})[-.](\d{2})[-.](\d{2})\s+(.*)\.\w{2,4}$/i
  );
  if (!match) return null;

  const [, year, month, day, rest] = match;
  const airDate = toISODate(year, month, day);
  const cleaned = cleanName(rest);

  const showType = detectShowType(rest);
  const result: ParsedFilename = { airDate, showType };

  // Remove show-type text from the rest to get guest/topic
  const guestText = cleaned
    .replace(/coast\s*to\s*coast(?:\s*am)?/i, "")
    .replace(/dreamland/i, "")
    .replace(/art\s*bell/i, "")
    .replace(/^\s*[-–—]\s*/, "")
    .trim();

  if (guestText) {
    if (isTopic(guestText)) {
      result.topic = titleCase(guestText);
    } else {
      result.guestName = titleCase(guestText);
    }
  }

  return result;
};

/**
 * Pattern 6: "YYMMDD_guest.mp3" or "YYMMDD guest.mp3" (short date, no prefix)
 */
const parseShortDate: PatternExtractor = (filename) => {
  const match = filename.match(
    /^(\d{2})(\d{2})(\d{2})[_\s-]+(.*)\.\w{2,4}$/i
  );
  if (!match) return null;

  const [, yy, mm, dd, rest] = match;
  const year = expandYear(yy);
  const airDate = toISODate(year, mm, dd);

  if (!airDate) return null;

  const cleaned = cleanName(rest);
  const showType = detectShowType(rest);
  const result: ParsedFilename = { airDate, showType };

  if (cleaned) {
    if (isTopic(cleaned)) {
      result.topic = titleCase(cleaned);
    } else {
      result.guestName = titleCase(cleaned);
    }
  }

  return result;
};

// ── Ordered pattern list (most specific first) ─────────────────────────

const PATTERN_EXTRACTORS: PatternExtractor[] = [
  parseCoastToCoast,
  parseDreamland,
  parseArtBellLong,
  parseAbCompact,
  parseDateFirst,
  parseShortDate,
];

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Parse an Art Bell archive filename and extract structured metadata.
 *
 * @param filename - The filename (with extension) to parse
 * @returns Parsed metadata with any fields that could be extracted
 *
 * @example
 * parseFilename("Art Bell 1997-01-15 Richard Hoagland.mp3")
 * // { airDate: "1997-01-15", guestName: "Richard Hoagland", showType: "coast" }
 *
 * parseFilename("dreamland_19980523_whitley_strieber.mp3")
 * // { airDate: "1998-05-23", guestName: "Whitley Strieber", showType: "dreamland" }
 */
export function parseFilename(filename: string): ParsedFilename {
  // Strip any directory path, work with filename only
  const baseName = filename.replace(/^.*[\\/]/, "");

  for (const extractor of PATTERN_EXTRACTORS) {
    const result = extractor(baseName);
    if (result) return result;
  }

  // Fallback: try to at least detect show type from filename
  const showType = detectShowType(baseName);

  // Last resort: try to find any date pattern anywhere in the filename
  const looseDate = baseName.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (looseDate) {
    const [, year, month, day] = looseDate;
    const airDate = toISODate(year, month, day);
    return { airDate, showType };
  }

  return { showType };
}
