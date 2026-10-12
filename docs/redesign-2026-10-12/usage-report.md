# High Desert usage report, 2026-10-12

Written for the redesign. Plain numbers, where they came from, and what they
can and cannot say.

## Where the numbers come from

- **Postgres** (the site's own stats database). Plays go back to 2026-07-28;
  the arrival funnel to 2026-09-27; daily traffic peaks to before the launch.
  This is where the "since the Reddit launch" and "last 30 days" totals come from.
- **nginx access logs** on the VPS. They are kept 14 days, so they cover
  **2026-09-28 to 2026-10-12** only. The launch weekend itself (09-26, 09-27)
  has already rotated out. Bots, crawlers and this server's own checks are
  removed.
- The app did **not** record which tab someone was on, how long they stayed or
  where a play was started. I reconstructed those from the logs: every open tab
  sends a heartbeat once a minute, and every play is a request. Both carry the
  page they came from. That gives open time per tab and plays per tab. Page
  "visits" from the logs are not usable on their own, because the app's
  offline worker fetches every tab in the background, so each tab looks
  visited the same number of times.
- **This PR adds direct tracking** (page views, time per tab while on screen,
  arrival source, where each play started), aggregate only, first party, with
  no addresses, IDs or raw referrers stored. The next audit reads it straight
  from `/api/stats/usage`.

A "browser" below is one address plus one browser make. Phones change
addresses often, so phone counts of browsers run high. Device shares use the
funnel instead, which counts each browser once.

## The headline

- **Plays since the launch (2026-09-26): 3,604**, across 548 different shows.
- **Last 30 days: 4,277 plays.**
- **Before the launch the site did about 49 plays a day** (2026-09-12 to 09-25).
  **The last full week did 152 a day: three times the old level**, after a
  launch-weekend peak of 567 on 2026-09-27. The level is holding, slowly
  easing (from about 230 a day in the first week after launch).
- **Most people online at once: 38**, most listening at once: 26 (launch
  weekend). A normal evening now: about 20 online, 11 listening.
- **About two thirds of new visitors are on a phone**: 633 phone first visits
  against 296 desktop in the last 30 days.

## How much each tab is used (2026-09-28 to 10-12)

| Tab | Share of plays started | Share of open time | Browsers that opened it | Phone share of its plays |
|---|---|---|---|---|
| **Live** | **58%** (1,577) | **50%** (152,000 min) | about 74% | 67% |
| **Library** | **36%** (985) | **44%** (133,000 min) | about 32% | 66% |
| **Stats** | 3% (87) | 3% (7,900 min) | about 5% | 74% |
| **Radio** | **2%** (53) | **3%** (10,000 min) | **4%** (99 of 2,492) | 87% |

What that says:

- **Live is the front door.** Most people who come never leave it: about 1,580
  of 2,490 browsers only ever had Live open. It carries more than half of all
  plays, mostly because the station starts the next show for you.
- **The Library is the second home** and where people choose a show
  themselves. A third of browsers use it, and they stay: its open time is
  close to Live's.
- **Stats** is a page people glance at. Low, but it does its job (it is where
  the leaderboard and "who is listening" live).
- **Radio is quiet.** See the verdict below.

**Phone vs desktop.** Phones start two thirds of the plays (68%). Desktops hold
two thirds of the open time (68%), because a desktop tab is left open for
hours. So the phone is how people arrive and press play; the desktop is where
the station runs in the background.

**Time per visit.** On a day someone uses a tab, it is open for an average of
about 59 minutes on Live, 106 on the Library, 45 on Stats and 77 on Radio.
These are averages, and desktops left open for hours pull them up.

**The phone lines** (the chat on Live): 249 calls in 15 days from 89
browsers, 44 on the busiest day after launch, now 5 to 11 a day. 1,087
tune-in announcements. Of new visitors in the last 30 days, about 6% on a
phone and 8% on a desktop went on to call in; about half tuned in to the
station.

**Coming back.** 484 of 2,492 browsers (19%) came back on a second day, 226
on three or more days, 40 on seven or more. Desktops come back more often
(36%) than phones appear to (15%; phones changing address undercounts them).

## Is Radio pulling its weight? No.

- 4% of browsers ever opened it. Only 27 browsers used Radio and nothing else.
- 2% of plays (53 in 15 days, two to four a day lately, some days zero).
- 3% of open time, and almost all of it in the first three days after launch
  (about 3,000 minutes a day on 09-28 and 09-29, about 100 a day since 10-01).
  It was a novelty, not a habit.
- Nobody arrives on it from outside: 30 of about 1,250 arrivals landed on
  /radio, all with no referrer.

**Verdict: Radio should not be its own tab.** The dial is a lovely way to
browse, so both new looks keep it as a **Dial** mode inside the Library ("spin
the dial through the catalog") and free the tab for something that earns it.
Old links to /radio keep working.

## Where new visitors come from (first arrival, 2026-09-28 to 10-12)

About 1,250 new browsers arrived from outside in these 15 days.

| Source | Arrivals | Share |
|---|---|---|
| No referrer (typed, bookmarks, apps, shared links in messages, in-app browsers) | 1,091 | 87% |
| Reddit | 118 | 9% |
| Google | 34 | 3% |
| Other search (DuckDuckGo 16, Bing 9, Yahoo 2) | 27 | 2% |
| Facebook | 9 | under 1% |
| ChatGPT (`utm_source=chatgpt.com`) | 10 | under 1% |

- **Reddit is the only real outside source**, and it is larger than it looks:
  the Reddit app sends a referrer only sometimes (71 of 118 came from the app),
  and visits opened in its in-app browser or copied into a message show up as
  "no referrer". The launch weekend itself is gone from the logs.
- **Search sends almost nothing.** Google brought 34 people in 15 days, and 21
  of them landed on the home page: there was no page for any individual show to
  rank. That is what the new show pages fix.
- **ChatGPT is already recommending the site** (10 arrivals tagged by
  ChatGPT itself). Small, but free and growing everywhere.

**Landing pages** (where those arrivals first landed): Live 735, Home 254,
Library 253, Radio 30, Stats 9. Reddit visitors land on Live (98 of 118)
because that is what the launch post linked. Search visitors land on the home
page.

## What the next audit will have

From this PR on, directly in the database (aggregate counts per day, nothing
personal): page views and on-screen minutes per tab, phone or desktop; the
arrival source class and landing page of each new session; where each play was
started (library, live, radio dial, stats, a show page, the queue, the
command palette, a restored show). Read it with
`GET /api/stats/usage?days=30`.
