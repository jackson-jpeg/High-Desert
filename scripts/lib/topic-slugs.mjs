/**
 * Topic slugs: minting and the add-only rule (docs/show-pages.md, "Topic pages").
 *
 * `data/topic-slugs.json` maps each topic's id (src/lib/topics/rules.ts:
 * "category:UFOs & Aliens", "tag:mars", "subject:mels-hole") to the slug of
 * its page, `/topic/<slug>`. Like show slugs, a topic slug is minted once and
 * never changes or is reused: a topic renamed in rules.ts keeps its URL, and a
 * topic that drops under the rule's threshold keeps its slug (its page goes
 * away; the slug is never given to another).
 */

import { slugify } from "../../src/lib/shows/slugify.ts";

/** `ufos-aliens`, `mels-hole`: lowercase words. */
export const TOPIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The map with a slug for every topic: existing entries untouched, in their
 * order; new topics appended in the order given. A collision takes `-2`, `-3`...
 *
 * @param {Record<string, string>} existing topic id to slug, as committed
 * @param {{id: string, name: string}[]} topics
 * @returns {{map: Record<string, string>, added: string[]}}
 */
export function assignTopicSlugs(existing, topics) {
  const map = { ...existing };
  const taken = new Set(Object.values(existing));
  const added = [];
  for (const t of topics) {
    if (map[t.id]) continue;
    // "The Phoenix Lights" is phoenix-lights: a leading article adds nothing to a URL.
    const base = slugify(t.name.replace(/^the\s+/i, ""), 60) || "topic";
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    map[t.id] = slug;
    taken.add(slug);
    added.push(t.id);
  }
  return { map, added };
}
