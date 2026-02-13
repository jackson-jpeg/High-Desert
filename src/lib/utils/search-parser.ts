/**
 * Advanced search parser.
 *
 * Supports operators:
 *   guest:hoagland   — match guest name
 *   year:1997        — match air date year
 *   tag:ufo          — match AI tag
 *   show:coast       — match show type (coast, dreamland, special)
 *   has:favorite     — has been favorited
 *   has:bookmark     — has bookmarks
 *   has:summary      — has AI summary
 *
 * Everything else is treated as a free-text search term.
 */

export interface ParsedSearch {
  text: string;         // Free-text portion
  guest?: string;       // guest: operator
  year?: string;        // year: operator
  tag?: string;         // tag: operator
  show?: string;        // show: operator
  has?: string[];       // has: operators (multiple allowed)
}

const OPERATOR_RE = /\b(guest|year|tag|show|has):(\S+)/gi;

export function parseSearch(input: string): ParsedSearch {
  const result: ParsedSearch = { text: "", has: [] };

  // Extract operators
  const remaining = input.replace(OPERATOR_RE, (_, op: string, value: string) => {
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
      case "has":
        result.has!.push(value.toLowerCase());
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
  return OPERATOR_RE.test(input);
}
