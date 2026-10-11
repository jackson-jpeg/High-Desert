import type { ScheduleContext } from "@/services/live/days";
import { archiveVerdictPrompt } from "@/services/archive/server-verdict";
import { mirrorManifest } from "@/services/live/manifest";

/**
 * What the published schedule depends on besides the frozen day: whether
 * archive.org is down and, if so, the mirror's manifest (the outage swap).
 * Shared by `/api/live/schedule` and the station's breaker, so a trip is
 * judged against exactly the program listeners were given.
 */
export async function scheduleContext(): Promise<ScheduleContext> {
  const verdict = await archiveVerdictPrompt();
  const archiveDown = verdict ? !verdict.up : false;
  return { archiveDown, manifest: archiveDown ? await mirrorManifest() : null };
}
