/**
 * A schema.org check for the structured data on show and guest pages
 * (docs/show-pages.md). Used by the unit tests (src/lib/shows/__tests__) and
 * by scripts/seo-check.mjs on the pages a running server actually sends.
 *
 * Two rules, per node, recursively:
 *   - every property must belong to the node's type in the schema.org
 *     vocabulary (its own and its ancestors': Thing > CreativeWork > Episode >
 *     PodcastEpisode, and so on), so a typo or an invented property fails;
 *   - the properties Google and this site require must be present and well
 *     formed (REQUIRED below).
 *
 * The vocabulary here is the subset of schema.org these pages can use, copied
 * from schema.org's type pages. A type not listed is an error, not a pass.
 */

const THING = [
  "@context", "@type", "@id",
  "name", "url", "description", "image", "identifier", "sameAs", "alternateName",
  "mainEntityOfPage", "subjectOf", "additionalType", "disambiguatingDescription", "potentialAction",
];

const CREATIVE_WORK = [
  ...THING,
  "about", "abstract", "accessMode", "associatedMedia", "audio", "author", "creator", "contributor",
  "copyrightHolder", "copyrightYear", "dateCreated", "dateModified", "datePublished", "encoding",
  "genre", "hasPart", "headline", "inLanguage", "isAccessibleForFree", "isPartOf", "keywords",
  "license", "mentions", "publisher", "producer", "thumbnailUrl", "timeRequired", "text",
  "character", "contentLocation", "locationCreated", "position", "sourceOrganization",
];

const EPISODE = [
  ...CREATIVE_WORK,
  "actor", "actors", "director", "directors", "duration", "episodeNumber", "musicBy",
  "partOfSeason", "partOfSeries", "productionCompany", "trailer",
];

const CREATIVE_WORK_SERIES = [...CREATIVE_WORK, "startDate", "endDate", "issn"];

const MEDIA_OBJECT = [
  ...CREATIVE_WORK,
  "contentUrl", "embedUrl", "encodingFormat", "duration", "contentSize", "bitrate", "uploadDate",
  "height", "width", "playerType", "requiresSubscription",
];

const WEB_PAGE = [
  ...CREATIVE_WORK,
  "breadcrumb", "mainEntity", "primaryImageOfPage", "relatedLink", "significantLink", "lastReviewed", "speakable",
];

export const VOCABULARY = {
  PodcastEpisode: EPISODE,
  PodcastSeries: [...CREATIVE_WORK_SERIES, "actor", "webFeed"],
  AudioObject: [...MEDIA_OBJECT, "caption", "transcript", "embeddedTextCaption"],
  Person: [...THING, "birthDate", "deathDate", "jobTitle", "affiliation", "givenName", "familyName", "knowsAbout"],
  Organization: [...THING, "logo", "email", "address"],
  BreadcrumbList: [...THING, "itemListElement", "numberOfItems", "itemListOrder"],
  ItemList: [...THING, "itemListElement", "numberOfItems", "itemListOrder"],
  ListItem: [...THING, "position", "item", "nextItem", "previousItem"],
  CollectionPage: WEB_PAGE,
  WebApplication: [...CREATIVE_WORK, "applicationCategory", "operatingSystem", "offers"],
  Offer: [...THING, "price", "priceCurrency", "availability"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DURATION = /^P(?!$)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
const ABSOLUTE_URL = /^https?:\/\/[^\s/]+\/?\S*$/;

const text = (v) => typeof v === "string" && v.trim().length > 0;
const absoluteUrl = (v) => typeof v === "string" && ABSOLUTE_URL.test(v);

/** Per type: property → a check of its value. Absent or failing is an error. */
const REQUIRED = {
  PodcastEpisode: {
    name: text,
    url: absoluteUrl,
    description: text,
    datePublished: (v) => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)),
    partOfSeries: (v) => v && typeof v === "object" && v["@type"] === "PodcastSeries",
    associatedMedia: (v) => v && typeof v === "object" && v["@type"] === "AudioObject",
    creator: (v) => v && typeof v === "object",
  },
  PodcastSeries: { name: text },
  AudioObject: {
    contentUrl: (v) => typeof v === "string" && /^https:\/\//.test(v),
    encodingFormat: (v) => v === "audio/mpeg",
  },
  Person: { name: text },
  Organization: { name: text },
  BreadcrumbList: {
    itemListElement: (v) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((li, i) => li && li["@type"] === "ListItem" && li.position === i + 1 && text(li.name)) &&
      // Every crumb but the last must say where it goes.
      v.slice(0, -1).every((li) => absoluteUrl(li.item)),
  },
  ItemList: { itemListElement: (v) => Array.isArray(v) && v.length > 0 },
  ListItem: { position: (v) => Number.isInteger(v) && v >= 1 },
  CollectionPage: { name: text, url: absoluteUrl },
};

/** Properties whose value, wherever it appears, must be well formed. */
const FORMATS = {
  duration: (v) => typeof v === "string" && ISO_DURATION.test(v),
  url: absoluteUrl,
  item: absoluteUrl,
  sameAs: absoluteUrl,
  image: absoluteUrl,
  contentUrl: absoluteUrl,
};

/**
 * Every problem with `node` and everything inside it, as readable strings.
 * Empty means valid.
 *
 * @param {unknown} node
 * @param {string} [at]
 * @returns {string[]}
 */
export function validateJsonLd(node, at = "$") {
  const errors = [];
  if (Array.isArray(node)) {
    node.forEach((n, i) => errors.push(...validateJsonLd(n, `${at}[${i}]`)));
    return errors;
  }
  if (!node || typeof node !== "object") return [`${at}: not an object`];
  const type = node["@type"];
  if (typeof type !== "string") return [`${at}: no @type`];
  const allowed = VOCABULARY[type];
  if (!allowed) return [`${at}: @type ${type} is not one this check knows`];
  if (at === "$" && node["@context"] !== "https://schema.org") errors.push(`${at}: @context must be https://schema.org`);

  for (const [key, value] of Object.entries(node)) {
    if (!allowed.includes(key)) errors.push(`${at}: ${type} has no property "${key}"`);
    if (value === undefined || value === null || value === "") errors.push(`${at}.${key}: empty`);
    const format = FORMATS[key];
    if (format && value != null && !(Array.isArray(value) ? value.every(format) : typeof value === "object" || format(value))) {
      errors.push(`${at}.${key}: malformed ${JSON.stringify(value).slice(0, 80)}`);
    }
    if (value && typeof value === "object") {
      const children = Array.isArray(value) ? value : [value];
      children.forEach((child, i) => {
        if (child && typeof child === "object") {
          errors.push(...validateJsonLd(child, `${at}.${key}${Array.isArray(value) ? `[${i}]` : ""}`));
        }
      });
    }
  }
  for (const [key, check] of Object.entries(REQUIRED[type] ?? {})) {
    if (!(key in node)) errors.push(`${at}: ${type} is missing "${key}"`);
    else if (!check(node[key])) errors.push(`${at}.${key}: invalid for ${type}`);
  }
  return errors;
}
