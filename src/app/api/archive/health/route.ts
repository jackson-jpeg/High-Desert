import { NextResponse } from "next/server";
import {
  archiveVerdict,
  resetArchiveVerdictForTests,
} from "@/services/archive/server-verdict";

/**
 * archive.org reachability, for every open tab (useOutageMonitor polls it).
 *
 * The probe and its memo live in src/services/archive/server-verdict.ts, which
 * `/api/live/schedule` shares, so the outage swap and the outage banner are
 * driven by the same verdict.
 */
export { UP_MEMO_MS, DOWN_MEMO_MS } from "@/services/archive/server-verdict";

export async function GET() {
  const v = await archiveVerdict();
  return NextResponse.json(v, {
    headers: {
      "Cache-Control": v.up
        ? "public, s-maxage=300, stale-while-revalidate=60"
        : "public, s-maxage=60, stale-while-revalidate=30",
    },
  });
}

export const __testing = {
  reset() {
    resetArchiveVerdictForTests();
  },
};
