import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
  // Auth: require valid admin token
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || token !== adminToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 req/min per IP
  const ip = getClientIp(request);
  const rl = rateLimit(`categorize:${ip}`, { maxRequests: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  // Guard against oversized payloads
  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > 1_000_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
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

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are an expert on Art Bell's radio career and shows: Coast to Coast AM (1988–2003, briefly 2013–2015), Dreamland (1993–2003), Dark Matter (2013), Midnight in the Desert (2015–2016), and various specials. Art Bell passed away in 2018.

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

CRITICAL — CATEGORY: Assign exactly ONE primary category from this list:
- "UFOs & Aliens" — UFO sightings, alien abductions, Area 51, Roswell, disclosure, extraterrestrial contact
- "Paranormal" — ghosts, hauntings, shadow people, poltergeists, near-death experiences, afterlife
- "Conspiracy" — government cover-ups, JFK, NWO, secret societies, black projects, surveillance
- "Science & Space" — physics, astronomy, Mars, comets, space exploration, quantum mechanics
- "Prophecy & Predictions" — Nostradamus, remote viewing predictions, psychic forecasts, millennium, Y2K
- "Cryptozoology" — Bigfoot, chupacabra, Mothman, Loch Ness, unknown creatures
- "Earth Changes" — earthquakes, weather anomalies, pole shift, climate, volcanic activity, solar cycles
- "Health & Medicine" — alternative medicine, nutrition, disease, consciousness, mind-body
- "Time Travel & Physics" — time travel, parallel universes, wormholes, dimensional portals, Philadelphia Experiment
- "Remote Viewing & Psychic" — remote viewing, ESP, psychic ability, astral projection, consciousness
- "Open Lines" — open phone lines with callers, no specific guest topic
- "Best Of & Replay" — best-of compilations, replays, retrospectives
- "Other" — does not fit above categories
Pick the BEST match. If an episode spans multiple topics, pick the dominant one.

CRITICAL — SERIES DETECTION: Many episodes are multi-part series or recurring segments. Detect these:
- "series": name of the series (e.g. "Mel's Hole", "Area 51: The Caller", "Shadow People", "JC Webster") or null if standalone
- "seriesPart": part number (1, 2, 3...) or null if standalone
- Look for patterns like "Part 1", "Part 2", "pt. 1", "pt. 2", "Night 1 of 3", Roman numerals (I, II, III), or sequential episodes with the same guest on consecutive dates discussing the same topic
- Recurring guests who appear many times (like Richard C. Hoagland, Linda Moulton Howe, Ed Dames) do NOT count as a series — only multi-part connected episodes do

NOTABLE EPISODES: Flag truly iconic/famous episodes. These include:
- The Area 51 caller (frantic caller claiming to be ex-employee, Sept 1997)
- Mel's Hole episodes (Mel Waters, first appearing Feb 1997)
- The Art Bell / Hale-Bopp controversy
- The Shadow People episode that coined the term
- First appearances of major recurring guests
- Any episode widely considered a "classic" by the Art Bell community
- Set "notable" to true for these, false for ordinary episodes. Be selective — only ~5-10% of episodes should be notable.

For each episode, return a JSON array with one object per episode:
- "title": clean, standardized title (see rules above)
- "airDate": original broadcast date as YYYY-MM-DD (null if truly unknown)
- "showType": one of "coast", "dreamland", "special", or "unknown"
- "guestName": full proper name of the guest (null if none/open lines)
- "topic": main topic in 2-5 words (e.g. "UFOs and Government Cover-ups", "Shadow People", "Time Travel Theory")
- "summary": 1-2 sentence description of the episode content
- "tags": array of 3-5 relevant lowercase tags (e.g. ["ufos", "paranormal", "science", "conspiracy", "ghosts", "remote viewing", "area 51", "prophecy", "cryptozoology"])
- "category": exactly one category from the list above (e.g. "UFOs & Aliens", "Paranormal", "Open Lines")
- "series": series name if multi-part, null if standalone
- "seriesPart": part number if multi-part, null if standalone
- "notable": true if iconic/famous, false otherwise

Respond ONLY with a valid JSON array.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: `Categorize these episodes:\n${JSON.stringify(episodes, null, 2)}` }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock?.text ?? "[]";

    // Extract JSON from potential markdown code fences
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
    const jsonStr = jsonMatch[1]?.trim() ?? text.trim();

    const results = JSON.parse(jsonStr);

    // Validate response shape
    if (!Array.isArray(results) || results.length !== episodes.length) {
      return NextResponse.json(
        { error: "AI returned malformed response" },
        { status: 502 },
      );
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error("[categorize] Claude error:", err);
    const message = err instanceof Error ? err.message : String(err);
    
    // Check if it's a rate limit error
    if (message.includes("429") || message.toLowerCase().includes("rate") || message.toLowerCase().includes("quota")) {
      return NextResponse.json(
        { error: "Rate limited by AI provider" },
        { status: 429, headers: { "Retry-After": "10" } },
      );
    }

    // Try Gemini API as fallback
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error("[categorize] GEMINI_API_KEY not configured");
      return NextResponse.json(
        { error: "AI categorization failed", details: "Claude failed and Gemini key missing" },
        { status: 500 }
      );
    }

    console.log("[categorize] Attempting Gemini fallback...");
    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `Categorize these episodes:
${JSON.stringify(episodes, null, 2)}` }]
            }],
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!geminiResponse.ok) {
        const geminiError = await geminiResponse.text();
        console.error("[categorize] Gemini API error:", {
          status: geminiResponse.status,
          error: geminiError
        });
        
        if (geminiResponse.status === 429) {
          return NextResponse.json(
            { error: "Both AI providers rate limited" },
            { status: 429, headers: { "Retry-After": "30" } },
          );
        }
        
        return NextResponse.json(
          { error: "Both AI providers unavailable", details: `Claude failed; Gemini returned ${geminiResponse.status}` },
          { status: 503 }
        );
      }

      const geminiData = await geminiResponse.json();
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      
      // Extract JSON from potential markdown code fences
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
      const jsonStr = jsonMatch[1]?.trim() ?? text.trim();
      
      const results = JSON.parse(jsonStr);

      // Validate response shape
      if (!Array.isArray(results) || results.length !== episodes.length) {
        console.error("[categorize] Gemini returned malformed response:", results);
        return NextResponse.json(
          { error: "AI categorization failed", details: "Malformed Gemini response" },
          { status: 500 }
        );
      }

      return NextResponse.json({ results });
    } catch (geminiErr) {
      console.error("[categorize] Gemini fallback error:", geminiErr);
      return NextResponse.json(
        { error: "AI categorization failed", details: "Both Claude and Gemini failed" },
        { status: 500 }
      );
    } "AI returned malformed response", details: "Invalid response format from Gemini" },
          { status: 502 },
        );
      }

      console.log("[categorize] Successfully used Gemini fallback");
      return NextResponse.json(results);
      
    } catch (geminiErr) {
      console.error("[categorize] Gemini fallback error:", geminiErr);
      const geminiMessage = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      
      if (geminiMessage.includes("fetch") || geminiMessage.includes("network")) {
        return NextResponse.json(
          { error: "Network error contacting AI providers", details: "Both Claude and Gemini APIs unreachable" },
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { error: "AI categorization failed", details: "Both Claude and Gemini APIs failed" },
        { status: 500 }
      );
    }
  }
}
