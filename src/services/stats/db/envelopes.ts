/**
 * Two-pass Level's envelopes (`level_envelopes`, written by
 * scripts/level-envelopes.mjs). Read-only here: the route serves one.
 */
import { pool } from "./pool";

/** The stored int8 gains for one episode at `version`, or null when there are none yet. */
export async function readEnvelope(fileHash: string, version: number): Promise<Int8Array | null> {
  const { rows } = await pool().query<{ data: Buffer }>(
    `SELECT data FROM level_envelopes WHERE file_hash = $1 AND version = $2 AND data IS NOT NULL`,
    [fileHash, version],
  );
  const b = rows[0]?.data;
  return b ? new Int8Array(b.buffer, b.byteOffset, b.length) : null;
}
