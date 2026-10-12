# What the full update should do, ranked by what the numbers say

The site tripled its daily plays at the Reddit launch and is holding there
(about 150 a day, against 49 before). Almost all of that came from one Reddit
post and word of mouth. Search sends almost nothing, two thirds of new
visitors are on a phone, and Live is the front door. The ranking follows from
that.

## 1. Let Google send people (biggest untapped source)

Google brought 34 people in 15 days, because there was nothing to find: the
archive lived inside the app. This PR gives every show and every repeat guest
a real page (1,413 shows, 175 guests). The update should build on that:

- **Verify Search Console and submit the sitemap** (your one step, in the
  handoff). Without it we are blind to what people search for.
- **Make show pages the thing people land on and share.** Search for "Bob
  Lazar Art Bell" should open a page that plays the show in one tap and leads
  into the station and the Library. Treat the show page as a first-class screen
  in the redesign, not an export.
- **Topic pages** next (UFOs, Area 51, remote viewing, Mel's Hole...): the
  catalog already has categories and tags. This is where "Art Bell UFO
  episodes" searches go.
- Watch Search Console for four weeks before judging; new pages are crawled
  slowly.

## 2. Make every share a landing page (the one channel that works)

Reddit sent 118 tracked arrivals and certainly more through its in-app browser.
People share what they are hearing. Today the share button sends an app link
with one generic card; it should send the show page, which now has its own
card image with the show's title, date and guests. Add **"Share this moment"**
(the show page at a time offset) for the clip people actually want to post.
And give Reddit a reason to come back: **"Tonight on High Desert"**, the
station's on-this-date shows, as one shareable page a day.

## 3. Fix the step where phone visitors drop off: Live to tune in

Of new visitors in the last 30 days, nine in ten phone visitors saw Live, but
only half tuned in (49%), and 6% called in. Live already carries 58% of all
plays, so every point here is worth more than anything elsewhere.
The redesign of the Live screen on a phone is the single most valuable screen:
one obvious Listen button, what is on and why it is good (guest, year, the
one-line hook), and the phone lines visible without hunting.

## 4. Give people a reason to come back

19% of browsers came back on a second day; 40 on seven or more days. The
regulars exist but are few. Cheap, on-brand reasons to return:

- **Install to home screen**, prompted after a second visit (the app is already
  a PWA): an icon on the phone is a return visit.
- **Continue listening** front and centre: a three-hour show is rarely finished
  in one sitting, and the Library already knows where you stopped.
- **The day's program** as a habit: "on this date" is different every day.

## 5. Use the freed tab for something that earns it

Radio carried 2% of plays and 4% of browsers ever opened it, almost all in the
launch week. Both looks fold it into the Library as a Dial mode. The freed
slot should go to what grows the site: **the phone lines** on a phone (6 to 8%
of new visitors call in, the most distinctive thing here), or **Shows** (the
browsable, searchable catalog from item 1).

## 6. Keep an eye on AI assistants

ChatGPT already sent ten visitors with its own tag. The show pages, with their
structured data and plain text, are exactly what assistants cite. Nothing to
build; measure it (the new tracking counts "ai" arrivals).

## On choosing the look

Choose by using both on a phone first: that is where two thirds of new people
arrive and press play. Whichever wins, the redesign should start with Live on a
phone, then the show page, then the Library.

## What to measure after the update

All from `/api/stats/usage` and the funnel, compared with this report: arrivals
by source (Google should rise from about 2 a day), Live to tune-in on phones
(from 49%), plays per day (from about 150), and second-day returns (from 19%).
