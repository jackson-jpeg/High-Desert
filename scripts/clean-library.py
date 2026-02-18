#!/usr/bin/env python3
"""
High Desert Library Cleaner
============================
Cleans, deduplicates, and normalizes the seed library.json.

Steps:
1. Normalize guest names (Dr./Mr. consistency)
2. Remove exact and near-duplicates (same date + overlapping guest/title)
3. Standardize title format: "Show Name - Topic" (remove guest from title)
4. Fill missing aiCategory via batch AI pass
5. Validate and report

Usage:
  python3 scripts/clean-library.py                    # Dry-run (report only)
  python3 scripts/clean-library.py --fix              # Apply fixes, write output
  python3 scripts/clean-library.py --fix --categorize # Also run AI categorization
"""

import json
import sys
import re
from collections import Counter, defaultdict
from pathlib import Path

LIBRARY_PATH = Path(__file__).parent.parent / "public" / "seed" / "library.json"
OUTPUT_PATH = Path(__file__).parent.parent / "public" / "seed" / "library.json"

# ─── Guest Name Normalization ─────────────────────────────────────────────────

# Preferred form → variants to normalize
GUEST_ALIASES = {
    "Dr. Nick Begich": ["Nick Begich"],
    "Ed Dames": ["Dr. Ed Dames"],
    "Albert Taylor": ["Dr. Albert Taylor"],
    "Dr. Barry Taff": ["Barry Taff"],
    "Dr. Eugene Mallove": ["Eugene Mallove"],
    "Evelyn Paglini": ["Dr. Evelyn Paglini"],
    "Seth Shostak": ["Dr. Seth Shostak"],
    "Dr. Jeffrey Long": ["Jeffrey Long"],
    "Brian Greene": ["Dr. Brian Greene"],
    "Dr. Colm Kelleher": ["Colm Kelleher"],
}

def build_guest_map():
    """Build a lookup: variant → preferred name."""
    m = {}
    for preferred, variants in GUEST_ALIASES.items():
        for v in variants:
            m[v] = preferred
    return m

GUEST_MAP = build_guest_map()

def normalize_guest(name: str) -> str:
    if not name:
        return name
    return GUEST_MAP.get(name, name)


# ─── Title Normalization ──────────────────────────────────────────────────────

SHOW_PREFIXES = [
    "Coast to Coast AM with Art Bell - ",
    "Coast to Coast AM - ",
    "Dreamland with Art Bell - ",
    "Dreamland - ",
    "Dark Matter - ",
]

def normalize_title(title: str, guest: str, show_type: str) -> str:
    """Standardize to 'Show Name - Topic/Description'.
    
    Rules:
    - Strip "with Art Bell" from show prefix
    - Remove trailing " with GuestName" (redundant — guest is a separate field)
    - Keep "GuestName on Topic" intact (informative)
    - Keep titles that ARE just the guest name (e.g. Open Lines, Ghost to Ghost)
    """
    if not title:
        return title

    # Determine show prefix
    show_name = {
        "coast": "Coast to Coast AM",
        "dreamland": "Dreamland",
        "special": "Special",
    }.get(show_type, "Coast to Coast AM")

    # Strip existing show prefix (including "with Art Bell" variants)
    body = title
    for prefix in SHOW_PREFIXES:
        if body.startswith(prefix):
            body = body[len(prefix):]
            break

    # Remove trailing " with GuestName" — the guest field already has this
    if guest:
        # Handle multi-guest: escape each name for regex
        for g in [guest] + guest.split(" and ") + guest.split(" & "):
            g = g.strip()
            if not g:
                continue
            pattern = re.compile(r'\s+with\s+' + re.escape(g) + r'\s*$', re.IGNORECASE)
            body = pattern.sub('', body)

    body = body.strip()
    if not body:
        body = guest or "Unknown"

    return f"{show_name} - {body}"


# ─── Deduplication ────────────────────────────────────────────────────────────

def similarity(a: str, b: str) -> float:
    """Simple word-overlap Jaccard similarity."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0
    return len(wa & wb) / len(wa | wb)

def find_duplicates(episodes: list) -> list[tuple[int, int]]:
    """Find pairs that are likely duplicates (same date + similar content)."""
    by_date = defaultdict(list)
    for i, ep in enumerate(episodes):
        d = ep.get("airDate")
        if d:
            by_date[d].append(i)

    dupes = []
    for d, indices in by_date.items():
        if len(indices) < 2:
            continue
        for a in range(len(indices)):
            for b in range(a + 1, len(indices)):
                i, j = indices[a], indices[b]
                ep1, ep2 = episodes[i], episodes[j]

                g1 = (ep1.get("guestName") or "").lower()
                g2 = (ep2.get("guestName") or "").lower()
                t1 = (ep1.get("title") or "").lower()
                t2 = (ep2.get("title") or "").lower()

                # Same guest (or one contains the other)
                guest_match = g1 and g2 and (g1 in g2 or g2 in g1)
                # Very similar titles
                title_sim = similarity(t1, t2)

                if guest_match and title_sim > 0.5:
                    dupes.append((i, j))
                elif title_sim > 0.8:
                    dupes.append((i, j))

    return dupes

def pick_keeper(ep1: dict, ep2: dict) -> tuple[dict, dict]:
    """Pick the better episode to keep. Returns (keeper, dupe)."""
    score1 = 0
    score2 = 0

    # Prefer longer title (more descriptive)
    if len(ep1.get("title", "")) > len(ep2.get("title", "")):
        score1 += 1
    else:
        score2 += 1

    # Prefer one with duration
    if ep1.get("duration") and not ep2.get("duration"):
        score1 += 2
    elif ep2.get("duration") and not ep1.get("duration"):
        score2 += 2

    # Prefer longer duration (more complete recording)
    d1 = ep1.get("duration", 0) or 0
    d2 = ep2.get("duration", 0) or 0
    if d1 > d2:
        score1 += 1
    elif d2 > d1:
        score2 += 1

    # Prefer one with more AI data
    if ep1.get("aiSummary") and not ep2.get("aiSummary"):
        score1 += 1
    elif ep2.get("aiSummary") and not ep1.get("aiSummary"):
        score2 += 1

    # Prefer larger file (likely higher quality)
    if ep1.get("fileSize", 0) > ep2.get("fileSize", 0):
        score1 += 1
    elif ep2.get("fileSize", 0) > ep1.get("fileSize", 0):
        score2 += 1

    if score1 >= score2:
        return ep1, ep2
    return ep2, ep1


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    fix_mode = "--fix" in sys.argv
    categorize = "--categorize" in sys.argv

    with open(LIBRARY_PATH) as f:
        data = json.load(f)

    # Handle both array and envelope formats
    if isinstance(data, dict):
        eps = data.get("episodes", [])
        envelope = data
    else:
        eps = data
        envelope = None

    print(f"Loaded {len(eps)} episodes from {LIBRARY_PATH}")
    print()

    # ─── Step 1: Guest name normalization ───
    guest_fixes = 0
    for ep in eps:
        g = ep.get("guestName", "")
        normalized = normalize_guest(g)
        if normalized != g:
            guest_fixes += 1
            if not fix_mode:
                print(f"  GUEST: '{g}' → '{normalized}'")
            ep["guestName"] = normalized

    print(f"Step 1: Guest normalization — {guest_fixes} fixes")
    print()

    # ─── Step 2: Find and remove duplicates ───
    dupe_pairs = find_duplicates(eps)
    remove_indices = set()
    for i, j in dupe_pairs:
        if i in remove_indices or j in remove_indices:
            continue
        keeper, dupe = pick_keeper(eps[i], eps[j])
        dupe_idx = i if eps[i] is dupe else j
        remove_indices.add(dupe_idx)
        print(f"  DUPE: [{eps[dupe_idx].get('airDate')}] removing: {eps[dupe_idx].get('title', '')[:60]}")
        print(f"         keeping:  {keeper.get('title', '')[:60]}")

    if remove_indices:
        eps = [ep for i, ep in enumerate(eps) if i not in remove_indices]
    print(f"Step 2: Deduplication — removed {len(remove_indices)}, {len(eps)} remain")
    print()

    # ─── Step 3: Title normalization ───
    title_fixes = 0
    for ep in eps:
        old_title = ep.get("title", "")
        new_title = normalize_title(old_title, ep.get("guestName", ""), ep.get("showType", "unknown"))
        if new_title != old_title:
            title_fixes += 1
            if not fix_mode and title_fixes <= 20:
                print(f"  TITLE: '{old_title[:55]}' → '{new_title[:55]}'")
            ep["title"] = new_title

    print(f"Step 3: Title normalization — {title_fixes} fixes")
    print()

    # ─── Step 4: Validate ───
    issues = []
    for i, ep in enumerate(eps):
        if not ep.get("title"):
            issues.append(f"  [{i}] Missing title")
        if not ep.get("airDate"):
            issues.append(f"  [{i}] Missing airDate: {ep.get('title','?')[:40]}")
        if not ep.get("guestName"):
            issues.append(f"  [{i}] Missing guestName: {ep.get('title','?')[:40]}")
        if not ep.get("sourceUrl"):
            issues.append(f"  [{i}] Missing sourceUrl: {ep.get('title','?')[:40]}")
        if not ep.get("duration"):
            issues.append(f"  [{i}] Missing duration: {ep.get('title','?')[:40]}")

    no_cat = sum(1 for e in eps if not e.get("aiCategory"))
    print(f"Step 4: Validation — {len(issues)} issues, {no_cat} missing aiCategory")
    for issue in issues[:20]:
        print(issue)
    print()

    # ─── Step 5: Report ───
    guests = Counter(ep.get("guestName", "") for ep in eps if ep.get("guestName"))
    shows = Counter(ep.get("showType", "unknown") for ep in eps)
    years = Counter(ep.get("airDate", "????")[:4] for ep in eps)

    print(f"Summary:")
    print(f"  Episodes: {len(eps)}")
    print(f"  Unique guests: {len(guests)}")
    print(f"  Shows: {dict(shows)}")
    print(f"  Year range: {min(years.keys())} - {max(years.keys())}")
    print(f"  Top guests: {', '.join(f'{g} ({c})' for g,c in guests.most_common(5))}")
    print()

    # ─── Write output ───
    if fix_mode:
        if envelope:
            envelope["episodes"] = eps
            out = envelope
        else:
            out = eps

        # Write compact JSON
        with open(OUTPUT_PATH, "w") as f:
            json.dump(out, f, separators=(",", ":"))

        size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
        print(f"Wrote {len(eps)} episodes to {OUTPUT_PATH} ({size_mb:.1f} MB)")
    else:
        print("Dry run — no changes written. Use --fix to apply.")


if __name__ == "__main__":
    main()
