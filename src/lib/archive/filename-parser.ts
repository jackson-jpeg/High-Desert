/**
 * Parses Art Bell archive filenames into structured episode metadata.
 *
 * Common patterns:
 *   "1992-12-12 - Coast to Coast AM with Art Bell - Area 51 - John Lear - Bob Lazar.mp3"
 *   "1994-04-03 - Dreamland with Art Bell - Aliens, Abductions and More - Budd Hopkins.mp3"
 *   "2013-10-16 - Dark Matter with Art Bell - Tobias McGriff - James Fox - UFO Research.mp3"
 *   "2013-11-12 - Gabcast - Art Calls into the Gabcast.mp3"
 */

export interface ParsedEpisodeFilename {
  airDate: string;
  showType: "coast" | "dreamland" | "special";
  showName: string;
  guestName: string | undefined;
  topic: string | undefined;
  title: string;
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\s*-\s*/;

const SHOW_PATTERNS: [RegExp, "coast" | "dreamland" | "special", string][] = [
  [/Coast\s+to\s+Coast\s+AM/i, "coast", "Coast to Coast AM"],
  [/Dark\s+Matter/i, "coast", "Dark Matter"],
  [/Dreamland/i, "dreamland", "Dreamland"],
  [/Midnight\s+in\s+the\s+Desert/i, "special", "Midnight in the Desert"],
  [/Area\s+2000/i, "special", "Area 2000"],
  [/Gabcast/i, "special", "Gabcast"],
];

export function parseArtBellFilename(filename: string): ParsedEpisodeFilename | null {
  // Strip extension
  const name = filename.replace(/\.\w+$/, "");

  // Extract date
  const dateMatch = name.match(DATE_RE);
  if (!dateMatch) return null;

  const airDate = dateMatch[1];
  const rest = name.slice(dateMatch[0].length).trim();

  // Split by " - " to get segments
  const segments = rest.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  // Identify show name from first segment
  let showType: "coast" | "dreamland" | "special" = "special";
  let showName = segments[0];
  let topicStart = 1;

  for (const [pattern, type, label] of SHOW_PATTERNS) {
    if (pattern.test(segments[0])) {
      showType = type;
      showName = label;
      topicStart = 1;
      break;
    }
  }

  // Strip "with Art Bell" from show name if present
  showName = showName.replace(/\s+with\s+Art\s+Bell/i, "").trim();

  // Everything after the show name is guest/topic
  const topicSegments = segments.slice(topicStart);

  // Try to identify a guest name vs topic.
  // Heuristic: the first segment that looks like a person name is the guest,
  // everything else is the topic. For simplicity, treat first segment as guest
  // and join the rest as topic.
  let guestName: string | undefined;
  let topic: string | undefined;

  if (topicSegments.length === 1) {
    // Could be either guest or topic
    guestName = topicSegments[0];
  } else if (topicSegments.length >= 2) {
    // First is likely the guest, rest is topic
    guestName = topicSegments[0];
    topic = topicSegments.slice(1).join(" - ");
  }

  // Build a clean title
  const titleParts = [airDate, showName];
  if (guestName) titleParts.push(guestName);
  if (topic) titleParts.push(topic);
  const title = titleParts.join(" - ");

  return {
    airDate,
    showType,
    showName,
    guestName,
    topic,
    title,
  };
}

/**
 * Check if a filename looks like an Art Bell episode (has date prefix).
 */
export function isArtBellFilename(filename: string): boolean {
  return DATE_RE.test(filename);
}
