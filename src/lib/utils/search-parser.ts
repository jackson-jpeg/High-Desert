/**
 * Advanced search parser.
 *
 * Supports operators:
 *   guest:hoagland   — match guest name
 *   year:1997        — match air date year
 *   tag:ufo          — match AI tag
 *   show:coast       — match show type (coast, dreamland, special)
 *   cat:paranormal   — match AI category
 *   series:mel       — match series name
 *   has:favorite     — has been favorited
 *   has:bookmark     — has bookmarks
 *   has:summary      — has AI summary
 *   has:notable      — flagged as iconic/famous
 *
 * Everything else is treated as a free-text search term.
 */

export interface ComparisonOp {
  op: ">" | ">=" | "<" | "<=" | "=";
  value: number;
}

export interface ParsedSearch {
  text: string;         // Free-text portion
  guest?: string;       // guest: operator
  year?: string;        // year: operator
  tag?: string;         // tag: operator
  show?: string;        // show: operator
  cat?: string;         // cat: operator (category)
  series?: string;      // series: operator
  has?: string[];       // has: operators (multiple allowed)
  duration?: ComparisonOp;   // duration:>60 (minutes)
  rating?: ComparisonOp;     // rating:>=4
  favorited?: boolean;       // favorited:true
}

function parseComparison(value: string): ComparisonOp | undefined {
  const m = value.match(/^(>=?|<=?)?(\d+)$/);
  if (!m) return undefined;
  const op = (m[1] || "=") as ComparisonOp["op"];
  return { op, value: Number(m[2]) };
}

export function parseSearch(input: string): ParsedSearch {
  const result: ParsedSearch = { text: "", has: [] };

  // Extract operators — use replace with a fresh regex to avoid global state issues
  const remaining = input.replace(/\b(guest|year|tag|show|cat|series|has|duration|rating|favorited):(\S+)/gi, (_, op: string, value: string) => {
    const key = op.toLowerCase();
    switch (key) {
      case "guest":
        result.guest = value.toLowerCase();
        break;
      case "year":
        result.year = value;
        break;
      case "tag":
        result.tag = value.toLowerCase();
        break;
      case "show":
        result.show = value.toLowerCase();
        break;
      case "cat":
        result.cat = value.toLowerCase();
        break;
      case "series":
        result.series = value.toLowerCase();
        break;
      case "has":
        result.has!.push(value.toLowerCase());
        break;
      case "duration":
        result.duration = parseComparison(value);
        break;
      case "rating":
        result.rating = parseComparison(value);
        break;
      case "favorited":
        result.favorited = value.toLowerCase() === "true";
        break;
    }
    return ""; // Remove from text
  });

  result.text = remaining.trim();
  return result;
}

/**
 * Returns true if the search string contains any operators.
 */
export function hasOperators(input: string): boolean {
  // Use a fresh regex to avoid stateful global regex issues
  return /\b(guest|year|tag|show|cat|series|has|duration|rating|favorited):(\S+)/i.test(input);
}
