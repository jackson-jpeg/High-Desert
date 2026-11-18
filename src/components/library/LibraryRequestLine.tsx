"use client";

import { useLook } from "@/hooks/useLook";
import { useLiveSchedule, useStationClock } from "@/hooks/useLiveStation";
import { TonightsRequestNote } from "@/components/live/TonightsRequestNote";

/**
 * One line above a desktop Library's list (2026-11-18), for every visitor:
 * "Tonight's request at 8 PM. 3 shows in the running, vote by 6 PM Pacific.",
 * a link to the Request Line. Desktops came back 7% of first visits against
 * phones' 23%; the nightly request is the reason to come back, and on a
 * desktop it was one link on Live, which most desktop visitors never open.
 * The same words as Live's note (`tonightsRequestText`), the same program, a
 * slow clock (the words change at 6 PM and when the request ends). Nothing
 * before the program arrives, and nothing once tonight's request has aired.
 */
export function LibraryRequestLine() {
  const schedule = useLiveSchedule();
  const now = useStationClock(60_000);
  const look = useLook();
  if (!schedule) return null;
  return <TonightsRequestNote schedule={schedule} now={now} look={look} testId="library-request-note" />;
}
