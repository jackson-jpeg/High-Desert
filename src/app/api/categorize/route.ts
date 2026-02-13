import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface EpisodeInput {
  title?: string;
  fileName?: string;
  airDate?: string;
  guestName?: string;
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

  const prompt = `You are an expert on Art Bell's radio shows (Coast to Coast AM, Dreamland).
For each episode below, provide a JSON array with one object per episode containing:
- "summary": 1-2 sentence description of the episode topic
- "tags": array of 3-5 relevant tags (e.g. "UFOs", "paranormal", "science", "conspiracy", "ghosts")
- "topic": main topic in 2-4 words
- "guestName": best guess at the guest name if not provided (or null)

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
