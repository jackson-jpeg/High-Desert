/**
 * Which topics get a page, and which shows each one lists (docs/show-pages.md,
 * "Topic pages").
 *
 * No `@/` imports, on purpose: `scripts/gen-topic-slugs.mjs` imports this file
 * straight from Node (type stripping), like `src/lib/shows/slugify.ts`.
 *
 * THE RULE. A topic page exists for:
 *
 *   1. every catalog category (`aiCategory`) except "Other";
 *   2. every tag (`aiTags`) carried by at least TAG_MIN shows, counted after
 *      folding synonyms (TAG_SYNONYMS), unless the tag
 *        - names no subject (GENERIC_TAGS: "science", "investigation"...),
 *        - is what a category page already is (TAG_COVERED_BY_CATEGORY),
 *        - is a person, who has a guest page instead (PERSON_TAGS), or
 *        - is covered by a curated subject below (its `tags`);
 *   3. every curated subject in SUBJECTS: the famous ones a search names
 *      ("Mel's Hole", "Area 51"), matched by a phrase in the title, topic,
 *      guest, summary or tags, because the AI tags miss many of their shows
 *      (the "mels hole" tag is on 8 shows; the phrase finds 9).
 *
 * Every topic needs at least TOPIC_MIN shows. A tag that crosses TAG_MIN
 * must be given a name in TAG_NAMES before it gets a page:
 * src/lib/topics/__tests__/topics.test.ts fails until someone has decided it
 * is a subject (named) or not (GENERIC_TAGS).
 */

export interface TopicRow {
  fileHash: string;
  title?: string;
  topic?: string;
  guestName?: string;
  aiSummary?: string;
  aiTags?: string[];
  aiCategory?: string;
}

export type TopicKind = "category" | "tag" | "subject";

export interface TopicDef {
  /** Stable identity, the key of data/topic-slugs.json: "category:UFOs & Aliens", "tag:mars", "subject:mels-hole". */
  id: string;
  kind: TopicKind;
  /** As the page's heading names it. */
  name: string;
  /** The page's first line. Hand-written for categories and subjects. */
  intro: string;
  /** Member shows, catalog order. */
  fileHashes: string[];
}

/** A tag needs this many shows for a page of its own. */
export const TAG_MIN = 10;
/** No topic page lists fewer shows than this. */
export const TOPIC_MIN = 3;

/** Categories too broad to be a topic. */
export const NO_TOPIC_CATEGORIES = new Set(["Other"]);

/** Spellings of one tag, folded onto the one the page is named by. */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "near-death experience": "near death experience",
  nde: "near death experience",
  extraterrestrials: "extraterrestrial",
  aliens: "extraterrestrial",
  prediction: "predictions",
  abduction: "alien abduction",
  ufo: "ufos",
  "listener calls": "callers",
  "government cover-up": "cover-up",
  "richard hoagland": "hoagland",
  climate: "climate change",
  "end times": "apocalypse",
  esp: "psychic",
  parapsychology: "psychic",
  privacy: "surveillance",
};

/** Tags that name no subject a listener would look for. */
export const GENERIC_TAGS = new Set([
  "science", "technology", "future", "anomalies", "investigation", "mystery", "mysteries",
  "history", "research", "sightings", "supernatural", "contact", "current events", "energy",
  "discussion", "controversy", "communication", "entertainment", "culture", "survival",
  "death", "unexplained", "analysis", "security", "innovation", "philosophy", "catastrophe",
  "politics", "weather", "spirits", "hauntings", "evidence", "phenomena", "interview", "debate",
  "exploration", "listener stories", "government", "military",
]);

/** Tags that are what a category page already lists. */
export const TAG_COVERED_BY_CATEGORY: Readonly<Record<string, string>> = {
  paranormal: "Paranormal & Ghosts",
  ghosts: "Paranormal & Ghosts",
  ufos: "UFOs & Aliens",
  extraterrestrial: "UFOs & Aliens",
  conspiracy: "Conspiracy & Government",
  prophecy: "Prophecy & Predictions",
  predictions: "Prophecy & Predictions",
  physics: "Science & Physics",
  space: "Space & Astronomy",
  astronomy: "Space & Astronomy",
  consciousness: "Psychology & Consciousness",
  psychology: "Psychology & Consciousness",
  spirituality: "Religion & Spirituality",
  religion: "Religion & Spirituality",
  health: "Health & Medicine",
  medicine: "Health & Medicine",
  environment: "Earth Changes & Environment",
  "earth changes": "Earth Changes & Environment",
  cryptozoology: "Cryptozoology",
  "ancient mysteries": "Ancient Mysteries",
  "open lines": "Open Lines",
  callers: "Open Lines",
  crime: "Crime & Mystery",
};

/** Tags that are a person: their guest page is the list. */
export const PERSON_TAGS = new Set(["hoagland", "ed dames"]);

/** What a tag topic is called. A tag past TAG_MIN without a name here fails the topics test. */
export const TAG_NAMES: Readonly<Record<string, string>> = {
  psychic: "Psychics and ESP",
  mars: "Mars",
  afterlife: "The afterlife",
  nasa: "NASA",
  archaeology: "Archaeology",
  disclosure: "UFO disclosure",
  "ancient civilizations": "Ancient civilizations",
  "climate change": "Climate change",
  terrorism: "Terrorism",
  "cover-up": "Cover-ups",
  cosmology: "Cosmology",
  metaphysics: "Metaphysics",
  "native american": "Native American prophecy and lore",
  seti: "SETI",
  geology: "Geology",
  nanotechnology: "Nanotechnology",
  "weather control": "Weather control",
  aviation: "Aviation",
  "reverse speech": "Reverse speech",
  healing: "Healing",
  apocalypse: "The apocalypse and end times",
  egypt: "Egypt",
  evolution: "Evolution",
  geopolitics: "Geopolitics",
  moon: "The Moon",
  surveillance: "Surveillance and privacy",
};

export interface Subject {
  key: string;
  name: string;
  intro: string;
  /** Matched against the title, topic, guest, summary and tags, lowercased. */
  pattern: RegExp;
  /** Tags this subject replaces (no tag page of their own). */
  tags?: string[];
}

/** Curated subjects: the famous ones, found by phrase (rule 3). */
export const SUBJECTS: readonly Subject[] = [
  {
    key: "mels-hole",
    name: "Mel's Hole",
    intro: "Mel Waters called in 1997 about a bottomless hole on his land in Washington state, and listeners never forgot it. Every call and update.",
    pattern: /mel.?s hole|mel waters/,
    tags: ["mels hole"],
  },
  {
    key: "area-51",
    name: "Area 51",
    intro: "The secret base in the Nevada desert, from Bob Lazar and John Lear to the frightened caller of 1997.",
    pattern: /area 51|groom lake/,
    tags: ["area 51"],
  },
  {
    key: "roswell",
    name: "Roswell",
    intro: "The 1947 crash in New Mexico and the decades of witnesses, documents and arguments that followed.",
    pattern: /roswell/,
    tags: ["roswell"],
  },
  {
    key: "phoenix-lights",
    name: "The Phoenix Lights",
    intro: "The lights over Arizona on March 13, 1997, as the calls came in that night and the years after.",
    pattern: /phoenix lights/,
    tags: ["phoenix lights"],
  },
  {
    key: "remote-viewing",
    name: "Remote viewing",
    intro: "The Cold War program to see at a distance, and the viewers who brought it to the radio.",
    pattern: /remote view/,
    tags: ["remote viewing"],
  },
  {
    key: "crop-circles",
    name: "Crop circles",
    intro: "Formations in the fields of England and beyond: researchers, skeptics and the people who made them.",
    pattern: /crop circle/,
    tags: ["crop circles"],
  },
  {
    key: "bigfoot",
    name: "Bigfoot",
    intro: "Sasquatch, the yeti and the people who went looking, as told on the air.",
    pattern: /bigfoot|sasquatch|yeti/,
    tags: ["bigfoot"],
  },
  {
    key: "hale-bopp",
    name: "Hale-Bopp",
    intro: "The great comet of 1997 and the companion some said followed it.",
    pattern: /hale.?bopp/,
  },
  {
    key: "y2k",
    name: "Y2K",
    intro: "The year 2000 bug, from the warnings to the night itself.",
    pattern: /\by2k\b/,
    tags: ["y2k"],
  },
  {
    key: "nostradamus",
    name: "Nostradamus",
    intro: "The quatrains, their readers and what they were said to foretell.",
    pattern: /nostradamus/,
  },
  {
    key: "philadelphia-experiment",
    name: "The Philadelphia Experiment",
    intro: "The ship said to vanish in 1943, and the Montauk Project said to follow it.",
    pattern: /philadelphia experiment|montauk/,
  },
  {
    key: "chemtrails",
    name: "Chemtrails",
    intro: "The trails in the sky and the callers and guests who watched them.",
    pattern: /chemtrail/,
    tags: ["chemtrails"],
  },
  {
    key: "haarp",
    name: "HAARP",
    intro: "The antenna field in Alaska and the theories about what it does to the sky.",
    pattern: /\bhaarp\b/,
    tags: ["haarp"],
  },
  {
    key: "ghost-to-ghost",
    name: "Ghost to Ghost",
    intro: "The Halloween tradition: a night of listeners' ghost stories, year after year.",
    pattern: /ghost to ghost/,
    tags: ["halloween"],
  },
  {
    key: "near-death-experiences",
    name: "Near-death experiences",
    intro: "People who died, came back and described what they saw.",
    pattern: /near.?death|\bnde\b/,
    tags: ["near death experience"],
  },
  {
    key: "alien-abductions",
    name: "Alien abductions",
    intro: "Missing time, the visitors and the people who say they were taken.",
    pattern: /abduct/,
    tags: ["alien abduction"],
  },
  {
    key: "time-travel",
    name: "Time travel",
    intro: "Travelers, theories and the callers who said they had been somewhere else in time.",
    pattern: /time travel/,
    tags: ["time travel"],
  },
  {
    key: "evp",
    name: "EVP",
    intro: "Electronic voice phenomena: voices on tape that nobody in the room spoke.",
    pattern: /\bevp\b|electronic voice/,
    tags: ["evp"],
  },
  {
    key: "face-on-mars",
    name: "The Face on Mars",
    intro: "Cydonia, the Face and the structures some saw in the Viking photographs.",
    pattern: /face on mars|mars face|cydonia/,
  },
  {
    key: "shadow-people",
    name: "Shadow people",
    intro: "Dark figures at the edge of sight, in listeners' own words.",
    pattern: /shadow (people|beings)/,
  },
  {
    key: "exorcism",
    name: "Exorcism",
    intro: "Possession, the rite and the priests who performed it.",
    pattern: /exorcis/,
    tags: ["exorcism"],
  },
  {
    key: "animal-mutilations",
    name: "Animal mutilations",
    intro: "Cattle found cut with surgical precision, and who or what did it.",
    pattern: /mutilation/,
  },
  {
    key: "mind-control",
    name: "Mind control",
    intro: "MKUltra and the programs, real and rumored, to control the mind.",
    pattern: /mk.?ultra|mind control/,
  },
  {
    key: "ancient-astronauts",
    name: "Ancient astronauts",
    intro: "Visitors in the deep past: Sitchin, von Daniken and the ancient texts.",
    pattern: /ancient (alien|astronaut)/,
  },
  {
    key: "pyramids",
    name: "The pyramids",
    intro: "Giza, the Sphinx and the questions about who built them and when.",
    pattern: /pyramid|giza|sphinx/,
    tags: ["pyramids"],
  },
  {
    key: "reincarnation",
    name: "Reincarnation and past lives",
    intro: "Memories of other lives, and the people who study them.",
    pattern: /reincarnation|past li(fe|ves)/,
    tags: ["reincarnation", "past lives"],
  },
  {
    key: "astral-projection",
    name: "Astral projection",
    intro: "Leaving the body and travelling out of it, as guests and callers described it.",
    pattern: /astral/,
    tags: ["astral projection"],
  },
  {
    key: "free-energy",
    name: "Free energy and zero point",
    intro: "Zero point energy, cold fusion and antigravity: the machines that would change everything.",
    pattern: /zero.?point|free energy|cold fusion|antigravity|anti-gravity/,
  },
  {
    key: "demons",
    name: "Demons",
    intro: "Encounters with the demonic, and the people who fought them.",
    pattern: /demon/,
    tags: ["demons"],
  },
];

/** Hand-written first lines for category pages. */
export const CATEGORY_INTROS: Readonly<Record<string, string>> = {
  "UFOs & Aliens": "Sightings, crashes, contact and the people who chased them: the subject Art Bell's radio is most remembered for.",
  "Paranormal & Ghosts": "Hauntings, apparitions and the things that go bump at three in the morning.",
  "Psychology & Consciousness": "The mind and its edges: dreams, perception, memory and what consciousness might be.",
  "Open Lines": "No guest, just the phones: the nights the callers ran the show.",
  "Space & Astronomy": "Comets, Mars, the Moon and the search for life beyond Earth.",
  "Prophecy & Predictions": "Seers, forecasts and warnings about what was coming, heard before it came.",
  "Technology & Invention": "Inventors, new machines and the technology that was going to change the world.",
  "Religion & Spirituality": "Faith, scripture, angels and the search for meaning.",
  "Conspiracy & Government": "Secrets, cover-ups and what governments were said to be hiding.",
  "Science & Physics": "Physics, scientists and the frontier where science meets the strange.",
  "Earth Changes & Environment": "Earthquakes, pole shifts, weather and the changing planet.",
  "Ancient Mysteries": "Lost civilizations, ancient sites and puzzles from the deep past.",
  "Health & Medicine": "Medicine, healing and the body, mainstream and otherwise.",
  Cryptozoology: "Bigfoot, lake monsters and the creatures science has not catalogued.",
  "Crime & Mystery": "Crimes, disappearances and cases that were never solved.",
};

const fold = (tag: string) => TAG_SYNONYMS[tag] ?? tag;

/** Everything a subject's phrase is matched against, lowercased. */
export function matchText(row: TopicRow): string {
  return [row.title, row.topic, row.guestName, row.aiSummary, (row.aiTags ?? []).join(" | ")]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/** A tag topic's generated first line. */
export function tagIntro(name: string, count: number): string {
  return `Every show in the archive about ${name.toLowerCase()}: ${count} broadcasts from Art Bell's radio, free to play.`;
}

/** Tags at or past TAG_MIN, after folding, with their show counts. */
export function tagCounts(rows: readonly TopicRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows) {
    for (const tag of new Set((row.aiTags ?? []).map((t) => fold(t.toLowerCase())))) {
      const list = out.get(tag);
      if (list) list.push(row.fileHash);
      else out.set(tag, [row.fileHash]);
    }
  }
  return out;
}

/** Tags that the rule wants a page for (rule 2), named or not. */
export function candidateTags(rows: readonly TopicRow[]): string[] {
  const covered = new Set(SUBJECTS.flatMap((s) => s.tags ?? []));
  return [...tagCounts(rows).entries()]
    .filter(([tag, list]) =>
      list.length >= TAG_MIN &&
      !GENERIC_TAGS.has(tag) &&
      !(tag in TAG_COVERED_BY_CATEGORY) &&
      !PERSON_TAGS.has(tag) &&
      !covered.has(tag),
    )
    .map(([tag]) => tag)
    .sort();
}

/**
 * Every topic with a page, in a fixed order: subjects, categories, tags.
 * A candidate tag without a name in TAG_NAMES gets no page (the test fails).
 */
export function deriveTopics(rows: readonly TopicRow[]): TopicDef[] {
  const topics: TopicDef[] = [];

  for (const s of SUBJECTS) {
    const hashes = rows.filter((r) => s.pattern.test(matchText(r))).map((r) => r.fileHash);
    if (hashes.length >= TOPIC_MIN) topics.push({ id: `subject:${s.key}`, kind: "subject", name: s.name, intro: s.intro, fileHashes: hashes });
  }

  const byCategory = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.aiCategory || NO_TOPIC_CATEGORIES.has(r.aiCategory)) continue;
    const list = byCategory.get(r.aiCategory);
    if (list) list.push(r.fileHash);
    else byCategory.set(r.aiCategory, [r.fileHash]);
  }
  for (const [cat, hashes] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (hashes.length < TOPIC_MIN) continue;
    topics.push({
      id: `category:${cat}`,
      kind: "category",
      name: cat,
      intro: CATEGORY_INTROS[cat] ?? `Every show in the archive filed under ${cat}: ${hashes.length} broadcasts.`,
      fileHashes: hashes,
    });
  }

  const counts = tagCounts(rows);
  for (const tag of candidateTags(rows)) {
    const name = TAG_NAMES[tag];
    if (!name) continue;
    const hashes = counts.get(tag)!;
    topics.push({ id: `tag:${tag}`, kind: "tag", name, intro: tagIntro(name, hashes.length), fileHashes: hashes });
  }
  return topics;
}
