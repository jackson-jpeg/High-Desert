/**
 * The privacy page's words (/privacy, docs/privacy.md). Every sentence is held
 * to the code it describes; the file each one was checked against is in
 * docs/privacy.md. Change the code, change this, and move EFFECTIVE.
 *
 * Plain strings, not JSX, so the page, the About dialog's link and the test
 * read one copy. No em dashes (user-facing copy, /root/CLAUDE.md).
 */

export const PRIVACY_PATH = "/privacy";

/** The day this version took effect (ISO, UTC). */
export const PRIVACY_EFFECTIVE = "2026-11-19";
export const PRIVACY_EFFECTIVE_LABEL = "19 November 2026";

export const PRIVACY_TITLE = "Privacy";
export const PRIVACY_DESCRIPTION =
  "What High Desert keeps about you, where, and for how long: your library stays in your browser, visitors are counted with one random id, and nothing is sold or shared.";

export const PRIVACY_INTRO =
  "High Desert is a free player for the Art Bell radio archive. There are no accounts, so we never ask for your name or email. This page says what the site keeps, where it keeps it, and why.";

export interface PrivacySection {
  id: string;
  heading: string;
  paragraphs: string[];
}

/** The Do Not Track sentence (CalOPPA asks a site to say how it answers the signal). */
export const DNT_SENTENCE =
  "High Desert's own counting does not follow you to other sites and shares nothing with anyone, so the site treats every visitor the same way whether or not your browser sends a Do Not Track signal.";

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "browser",
    heading: "What stays in your browser",
    paragraphs: [
      "Your library, favorites, playlists, bookmarks, listening history and the place you stopped in each show are kept in this browser's own database (IndexedDB), not on our server. Audio the site saves for offline play is kept in this browser too.",
      "The site also keeps small settings in this browser's storage (localStorage and sessionStorage), such as the look you picked, your recent searches and whether you have seen the welcome screen.",
      "Clearing this site's data in your browser removes all of it.",
    ],
  },
  {
    id: "counting",
    heading: "How we count visitors",
    paragraphs: [
      "To count each browser once, the site makes a random id on your first visit and keeps it in this browser's storage, under the name hd-visitor. It is not a cookie. Once per page load it is sent to our server with the kind of device (phone or desktop) and the look you use. The id is not tied to your name, your address or the phone lines.",
      "Our own server looks up an approximate country and state or region from your connection and keeps that with the id. Your IP address is not kept with it.",
      "The site also counts page views, time spent on each part of the site, plays of each show, and where visits come from in broad groups such as a search engine or Reddit. These are kept as daily totals.",
      "While a page is open it checks in about once a minute with a random id for that page load, so the site can show how many people are here right now. That record is deleted a few minutes after you leave.",
      "When you tune in to the station, your approximate place is added, with no id, to the public Tuning in from list on the Stats page, and kept for 7 days.",
      "If you rate a show, the server keeps your rating with a one-way code made from your network address, so each connection rates a show once. The address itself is not kept with it.",
    ],
  },
  {
    id: "cookies",
    heading: "Cookies",
    paragraphs: [
      "hd_look remembers the look you chose (Win98 or Night) for up to 400 days. From 18 November to 1 December 2026, a phone visiting for the first time may be given one of the two looks at random, so we can compare them, and this cookie remembers which.",
      "hd_live_caller is set when you open Live or the Request Line, before you call in. It holds a random number signed by our server and lasts 400 days. It is how the phone lines tell one browser from another: your caller name and line, the place you give, the limit on renaming, and any reports, mutes or bans.",
      "hd_live_admin is set only for the station's own admin, when signed in.",
      "None of these cookies is used for advertising or sent to anyone else.",
    ],
  },
  {
    id: "phone-lines",
    heading: "The phone lines and the Request Line",
    paragraphs: [
      "What you post on the phone lines is public, and so are the shows you nominate on the Request Line and any note with them. Phone line messages are deleted after 7 days, and a caller name not used for 30 days is deleted.",
      "To limit abuse, the server keeps a one-way code made from your network address beside your messages, caller name and reports. The address itself is not kept there.",
    ],
  },
  {
    id: "logs",
    heading: "Server logs",
    paragraphs: [
      "Like most websites, our web server writes a line for each request it answers: the IP address it came from, the time, the page asked for, the page that linked to it, and your browser's name and version. These logs are kept for 13 months and then deleted. We use them to run the site, fix problems and keep it safe.",
    ],
  },
  {
    id: "others",
    heading: "Other companies",
    paragraphs: [
      "High Desert runs on its own server and loads no analytics, advertising or tracking scripts from anyone else. We do not sell or share what we keep.",
      "The shows themselves come from the Internet Archive. When you play a show, your browser usually fetches the audio straight from archive.org, and the Library loads show listings from there too, so archive.org sees those requests the way any website would, under its own privacy policy.",
    ],
  },
  {
    id: "dnt",
    heading: "Do Not Track",
    paragraphs: [DNT_SENTENCE],
  },
  {
    id: "changes",
    heading: "Changes",
    paragraphs: [
      "If what the site keeps changes, this page will change with it and show a new effective date.",
    ],
  },
];
