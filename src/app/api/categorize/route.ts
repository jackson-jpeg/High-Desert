import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface EpisodeInput {
  title?: string;
  fileName?: string;
  airDate?: string;
  guestName?: string;
  description?: string;
  archiveIdentifier?: string;
  source?: string;
  artist?: string;
  topic?: string;
  showType?: string;
}

const MAX_BATCH_SIZE = 10;

export async function POST(request: NextRequest) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const { episodes } = (await request.json()) as { episodes: EpisodeInput[] };

  if (!episodes?.length) {
    return NextResponse.json({ error: "No episodes provided" }, { status: 400 });
  }

  if (episodes.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` },
      { status: 400 },
    );
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const prompt = `You are an expert on Art Bell's radio career and shows: Coast to Coast AM (1988–2003, briefly 2013–2015), Dreamland (1993–2003), Dark Matter (2013), Midnight in the Desert (2015–2016), and various specials. Art Bell passed away in 2018.

YOUR JOB: Make every episode's metadata clean, uniform, and accurate for use in a searchable archive player. Standardize everything.

CRITICAL — DATES: The "airDate" field provided is often WRONG — especially for archive.org uploads where the date is the upload/digitization date (often 2010s-2020s), NOT the original broadcast date. Determine the ACTUAL original air date using:
1. The fileName — often contains the real date (e.g. "Art_Bell_1995-03-14.mp3", "c2c_970415.mp3")
2. The archiveIdentifier — often encodes the date (e.g. "coast-to-coast-am-1997-04-07")
3. The title or description — may reference when the show originally aired
4. The guest name — cross-reference with your knowledge of when specific guests appeared
5. Your knowledge of Art Bell's broadcast history
If the provided airDate looks like an upload date (2010+) but other signals suggest a 1990s-2000s broadcast, trust the other signals.

CRITICAL — TITLES: Many titles are raw filenames or inconsistently formatted. You MUST return a clean, human-readable title. Rules:
- Format: "Coast to Coast AM - [Topic/Guest]" or "Dreamland - [Topic/Guest]" or "Art Bell - [Topic/Guest]"
- Remove file extensions (.mp3, .ogg, etc.), underscores, dashes used as separators
- Remove redundant dates from the title (the airDate field handles dating)
- Remove "Art Bell" from the middle of titles if it's already implied by the show name
- If the title is already clean and descriptive, keep it as-is
- Examples of good titles: "Coast to Coast AM - Mel's Hole with Mel Waters", "Dreamland - Remote Viewing with Ed Dames", "Art Bell - Open Lines"

CRITICAL — GUEST NAMES: Standardize to full proper names. Fix common misspellings. Examples:
- "Dr. Michio Kaku" not "Michio Kaku" or "M. Kaku" or "kaku"
- "Richard C. Hoagland" not "Hoagland" or "richard hoagland"
- "Linda Moulton Howe" not "LMH" or "linda howe"
- Use null for Open Lines, best-of compilations, or no-guest episodes

For each episode, return a JSON array with one object per episode:
- "title": clean, standardized title (see rules above)
- "airDate": original broadcast date as YYYY-MM-DD (null if truly unknown)
- "showType": one of "coast", "dreamland", "special", or "unknown"
- "guestName": full proper name of the guest (null if none/open lines)
- "topic": main topic in 2-5 words (e.g. "UFOs and Government Cover-ups", "Shadow People", "Time Travel Theory")
- "summary": 1-2 sentence description of the episode content
- "tags": array of 3-5 relevant lowercase tags (e.g. ["ufos", "paranormal", "science", "conspiracy", "ghosts", "remote viewing", "area 51", "prophecy", "cryptozoology"])

Episodes:
${JSON.stringify(episodes, null, 2)}

Respond ONLY with a valid JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "[]";
    const results = JSON.parse(text);

    // Validate response shape
    if (!Array.isArray(results) || results.length !== episodes.length) {
      return NextResponse.json(
        { error: "AI returned malformed response" },
        { status: 502 },
      );
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error("[categorize] Gemini error:", err);
    return NextResponse.json({ error: "AI categorization failed" }, { status: 500 });
  }
}
