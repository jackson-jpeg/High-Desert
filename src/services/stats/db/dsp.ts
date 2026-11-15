/**
 * Level and Clean up: daily counters in `dsp_daily`, nothing else
 * (src/lib/audio/dsp-events.ts).
 */
import { pool } from "./pool";
import { DSP_EVENTS, type DspEvent } from "@/lib/audio/dsp-events";

export async function recordDspEvent(event: DspEvent): Promise<void> {
  await pool().query(
    `INSERT INTO dsp_daily (day, event, n) VALUES ((now() AT TIME ZONE 'UTC')::date, $1, 1)
     ON CONFLICT (day, event) DO UPDATE SET n = dsp_daily.n + 1`,
    [event],
  );
}

/** The last `days` UTC days, today included: every event, zeros included. */
export async function dspTotals(days: number): Promise<Record<DspEvent, number>> {
  const { rows } = await pool().query<{ event: DspEvent; n: string }>(
    `SELECT event, sum(n)::bigint AS n FROM dsp_daily
      WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
      GROUP BY event`,
    [days],
  );
  return Object.fromEntries(DSP_EVENTS.map((e) => [e, Number(rows.find((r) => r.event === e)?.n ?? 0)])) as Record<DspEvent, number>;
}
