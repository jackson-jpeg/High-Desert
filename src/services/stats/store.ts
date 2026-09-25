/**
 * Server-side store for community stats (Postgres, self-hosted).
 *
 * API routes import from here — they never touch the database driver directly.
 * Replaced the Vercel KV (Upstash Redis) implementation; see scripts/schema.sql
 * for the key-layout mapping.
 *
 * Every function throws if DATABASE_URL is unset or the database is unreachable.
 * Routes catch that and return 503, and the client degrades to empty stats — the
 * app is fully usable without this subsystem.
 *
 * This file is only the public surface. The code lives in `./db/`, one module
 * per concern (HD-018): pool, presence, plays, ratings, traffic, failures,
 * export. The list below is explicit rather than `export *` so that helpers the
 * modules share with each other (the session cap's lock and admission test) do
 * not become part of what routes can import, and so that a name dropped from a
 * module fails here, at the seam, rather than in whichever route used it.
 * Routes and their tests mock this path — keep importing from here.
 */

export { STATEMENT_TIMEOUT_MS, getPool } from "./db/pool";

export {
  SESSIONS_PER_CLIENT,
  recordHeartbeat,
  clearListening,
  removeActiveSession,
  getPresence,
  getNowPlaying,
} from "./db/presence";
export type { Presence, OnAirEntry, RecentPlay, NowPlaying } from "./db/presence";

export {
  weekKey,
  PLAY_SOURCES,
  isPlaySource,
  recordPlay,
  getEpisodeCounts,
  getLeaderboard,
  pruneOldWeeks,
} from "./db/plays";
export type { PlaySource } from "./db/plays";

export {
  getHourlyActivity,
  recordSample,
  ROLLUP_TRAFFIC_SQL,
  rollUpTraffic,
  anonymizeOldSessions,
  getTraffic,
} from "./db/traffic";
export type { HourBucket, TrafficRange, TrafficPoint, Traffic } from "./db/traffic";

export {
  getPlayEvents,
  getDailyTraffic,
  getExportSummary,
  getEpisodeStats,
} from "./db/export";
export type { PlayEvent, DailyTraffic, ExportSummary, EpisodeStat } from "./db/export";

export {
  recordRating,
  removeRating,
  getRatings,
  getCommunityCatalog,
} from "./db/ratings";
export type { CommunityNumbers } from "./db/ratings";

export {
  recordPlaybackFailure,
  getFailureRates,
  getFailureWindow,
  getFailureSummary,
} from "./db/failures";
export type {
  PlaybackFailureInput,
  FailureRate,
  FailureSummary,
  FailureWindow,
} from "./db/failures";
