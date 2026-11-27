/**
 * The data behind the Win98 Start menu's programs (docs/UI-PLAN.md, push 5), held
 * here so the client never loads the catalog for a menu. Generated from the
 * catalog; start-programs.test.ts recomputes both from the catalog and fails
 * when either drifts (after a catalog change, copy what it prints).
 */

/** Every year with shows on /shows/<year>, oldest first. */
export const SHOW_YEARS: readonly number[] = [1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2013, 2015];

/** The 20 guests with the most shows (Art Bell, the host, aside), A to Z. */
export const TOP_GUESTS: readonly { name: string; slug: string }[] = [
  { name: "Albert Taylor", slug: "albert-taylor" },
  { name: "Barbara McBeath", slug: "barbara-mcbeath" },
  { name: "Brendan Cook", slug: "brendan-cook" },
  { name: "Dannion Brinkley", slug: "dannion-brinkley" },
  { name: "David John Oates", slug: "david-john-oates" },
  { name: "Dr. Michio Kaku", slug: "michio-kaku" },
  { name: "Dr. Nick Begich", slug: "nick-begich" },
  { name: "Dr. Roger Leir", slug: "roger-leir" },
  { name: "Dr. Steven Greer", slug: "steven-greer" },
  { name: "Evelyn Paglini", slug: "evelyn-paglini" },
  { name: "Gordon Michael Scallion", slug: "gordon-michael-scallion" },
  { name: "Graham Hancock", slug: "graham-hancock" },
  { name: "Linda Moulton Howe", slug: "linda-moulton-howe" },
  { name: "Major Ed Dames", slug: "major-ed-dames" },
  { name: "Peter Davenport", slug: "peter-davenport" },
  { name: "Richard C. Hoagland", slug: "richard-c-hoagland" },
  { name: "Robert Ghost Wolf", slug: "robert-ghost-wolf" },
  { name: "Sean David Morton", slug: "sean-david-morton" },
  { name: "Whitley Strieber", slug: "whitley-strieber" },
  { name: "William Thomas", slug: "william-thomas" },
];
