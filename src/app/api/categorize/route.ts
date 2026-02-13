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

  const prompt = `You are an expert on Art Bell's radio career and shows: Coast to Coast AM (1988–2003, briefly 2013–2015), Dreamland (1993–2003), and various specials. Art Bell passed away in 2018.

CRITICAL: The "airDate" field provided is often WRONG — especially for archive.org uploads where the date is the upload/digitization date (often 2010s-2020s), NOT the original broadcast date. You MUST determine the actual original air date using:
1. The fileName — often contains the real date (e.g. "Art_Bell_1995-03-14.mp3", "c2c_970415.mp3", "ctc-am-2001-12-25.mp3")
2. The archiveIdentifier — often encodes the date (e.g. "coast-to-coast-am-1997-04-07")
3. The title — may reference a date or year
4. The description — may mention when the show originally aired
5. The guest name — cross-reference with your knowledge of when specific guests appeared on Art Bell's shows
6. Your knowledge of Art Bell's broadcast history

If the provided airDate looks like an upload date (2010+) but other signals suggest a 1990s-2000s broadcast, trust the other signals.

For each episode, return a JSON array with one object per episode containing:
- "airDate": the actual original broadcast date in YYYY-MM-DD format (best estimate; use your knowledge of Art Bell's show history; null if truly unknown)
- "showType": one of "coast", "dreamland", "special", or "unknown"
- "summary": 1-2 sentence description of the episode's content
- "tags": array of 3-5 relevant tags (e.g. "UFOs", "paranormal", "science", "conspiracy", "ghosts", "time travel", "remote viewing", "Area 51")
- "topic": main topic in 2-4 words
- "guestName": the guest's full name (use your knowledge of Art Bell's guest history to identify or correct; null if open lines/no guest)

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
