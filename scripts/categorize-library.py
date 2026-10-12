#!/usr/bin/env python3
"""
Batch AI Categorization for High Desert Library
=================================================
Reads library.json, sends batches to Claude for categorization,
writes results back. Resumes from where it left off: only rows with no
aiCategory are sent.

Usage:
  python3 scripts/categorize-library.py
  python3 scripts/categorize-library.py --dry-run   # Preview batches only

The model is Claude Sonnet 5.5 (2026-10-11; it was Gemini 2.0 Flash for the
first 1,312 rows). ANTHROPIC_API_KEY comes from the environment or
.env.local; HD_CATEGORIZE_MODEL overrides the model id.
"""

import json
import os
import sys
import time
import re
from pathlib import Path

LIBRARY_PATH = Path(__file__).parent.parent / "public" / "seed" / "library.json"
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("HD_CATEGORIZE_MODEL", "claude-sonnet-5-5")
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
    # The seed's own format (2-space JSON, raw UTF-8, trailing newline), so a
    # run changes only the rows it categorized.
    with open(LIBRARY_PATH, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def call_claude(prompt: str) -> str:
    """Call the Anthropic Messages API, return the text of the reply."""
    import urllib.request

    payload = {
        "model": MODEL,
        "max_tokens": 4096,
        "temperature": 0.1,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    # A fenced reply is still the array.
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())


def categorize_batch(episodes: list[dict], start_idx: int) -> dict[int, str]:
    """Send a batch to Claude and return {index: category}."""
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
        response = call_claude(prompt)
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

    global API_KEY
    if not API_KEY and not dry_run:
        env_path = Path(__file__).parent.parent / ".env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    API_KEY = line.split("=", 1)[1].strip().strip('"')
                    break

    if not API_KEY and not dry_run:
        print("ERROR: Set ANTHROPIC_API_KEY env var or add to .env.local")
        sys.exit(1)
    print(f"Model: {MODEL}")

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
