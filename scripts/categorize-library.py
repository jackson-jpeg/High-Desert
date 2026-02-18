#!/usr/bin/env python3
"""
Batch AI Categorization for High Desert Library
=================================================
Reads library.json, sends batches to Gemini for categorization,
writes results back. Resumes from where it left off.

Usage:
  python3 scripts/categorize-library.py
  python3 scripts/categorize-library.py --dry-run   # Preview batches only
"""

import json
import os
import sys
import time
import re
from pathlib import Path

LIBRARY_PATH = Path(__file__).parent.parent / "public" / "seed" / "library.json"
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
BATCH_SIZE = 40  # Episodes per API call
RATE_DELAY = 2   # Seconds between batches

CATEGORIES = [
    "UFOs & Aliens",
    "Paranormal & Ghosts",
    "Conspiracy & Government",
    "Science & Physics",
    "Prophecy & Predictions",
    "Cryptozoology",
    "Ancient Mysteries",
    "Health & Medicine",
    "Technology & Invention",
    "Religion & Spirituality",
    "Crime & Mystery",
    "Earth Changes & Environment",
    "Space & Astronomy",
    "Psychology & Consciousness",
    "Open Lines",
    "Other",
]

SYSTEM_PROMPT = f"""You are categorizing Art Bell radio episodes for a searchable archive.

Given a list of episodes (title, guest, topic, summary), assign each ONE category from this list:
{json.dumps(CATEGORIES)}

Rules:
- Use ONLY categories from the list above
- Pick the MOST specific matching category
- "Open Lines" is for call-in episodes with no specific guest topic
- "Other" only when nothing else fits
- Ghost to Ghost specials → "Paranormal & Ghosts"

Respond with a JSON array of objects: [{{"index": 0, "category": "..."}}, ...]
No markdown, no explanation — just the JSON array."""


def load_library():
    with open(LIBRARY_PATH) as f:
        data = json.load(f)
    return data


def save_library(data):
    with open(LIBRARY_PATH, "w") as f:
        json.dump(data, f, separators=(",", ":"))


def call_gemini(prompt: str) -> str:
    """Call Gemini API with a prompt, return text response."""
    import urllib.request

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    text = result["candidates"][0]["content"]["parts"][0]["text"]
    return text


def categorize_batch(episodes: list[dict], start_idx: int) -> dict[int, str]:
    """Send a batch to Gemini and return {index: category}."""
    lines = []
    for i, ep in enumerate(episodes):
        lines.append(
            f'{{"index":{i},"title":{json.dumps(ep.get("title",""))},'
            f'"guest":{json.dumps(ep.get("guestName",""))},'
            f'"topic":{json.dumps(ep.get("topic",""))},'
            f'"summary":{json.dumps((ep.get("aiSummary","") or "")[:120])}}}'
        )

    prompt = "Categorize these episodes:\n" + "\n".join(lines)

    try:
        response = call_gemini(prompt)
        # Parse JSON response
        results = json.loads(response)
        mapping = {}
        for item in results:
            idx = item.get("index", -1)
            cat = item.get("category", "")
            if 0 <= idx < len(episodes) and cat in CATEGORIES:
                mapping[start_idx + idx] = cat
        return mapping
    except Exception as e:
        print(f"  ERROR: {e}")
        return {}


def main():
    dry_run = "--dry-run" in sys.argv

    global GEMINI_KEY
    if not GEMINI_KEY and not dry_run:
        env_path = Path(__file__).parent.parent / ".env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    GEMINI_KEY = line.split("=", 1)[1].strip()
                    break

    if not GEMINI_KEY and not dry_run:
        print("ERROR: Set GEMINI_API_KEY env var or add to .env.local")
        sys.exit(1)

    data = load_library()
    eps = data if isinstance(data, list) else data

    print(f"Loaded {len(eps)} episodes")

    # Find uncategorized episodes
    uncategorized = [(i, ep) for i, ep in enumerate(eps) if not ep.get("aiCategory")]
    print(f"Uncategorized: {len(uncategorized)}")

    if not uncategorized:
        print("All episodes already categorized!")
        return

    batches = [uncategorized[i:i + BATCH_SIZE] for i in range(0, len(uncategorized), BATCH_SIZE)]
    print(f"Batches: {len(batches)} × {BATCH_SIZE}")

    if dry_run:
        print("\nDry run — showing first batch:")
        for i, ep in batches[0][:5]:
            print(f"  [{i}] {ep.get('title', '')[:50]}  |  {ep.get('guestName', '')}")
        return

    total_done = 0
    for batch_idx, batch in enumerate(batches):
        indices = [i for i, _ in batch]
        batch_eps = [ep for _, ep in batch]

        print(f"\nBatch {batch_idx + 1}/{len(batches)} ({len(batch)} episodes)...")
        results = categorize_batch(batch_eps, indices[0])

        for global_idx, cat in results.items():
            # Map back to actual index in the uncategorized list
            actual_idx = indices[global_idx - indices[0]]
            eps[actual_idx]["aiCategory"] = cat
            total_done += 1

        print(f"  Categorized: {len(results)}/{len(batch)}")

        # Save progress after each batch
        save_library(data)
        print(f"  Saved. Total progress: {total_done}/{len(uncategorized)}")

        if batch_idx < len(batches) - 1:
            time.sleep(RATE_DELAY)

    print(f"\nDone! Categorized {total_done} episodes.")

    # Summary
    from collections import Counter
    cats = Counter(ep.get("aiCategory", "(none)") for ep in eps)
    print("\nCategory distribution:")
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
