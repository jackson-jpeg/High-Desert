#!/usr/bin/env node
/**
 * A preview look for a development or e2e server (docs/looks.md).
 *
 *   node scripts/look-cookie.mjs win98
 *
 * prints two lines: `HD_LOOK_KEY=<hex>` to start the server with, and
 * `hd_look=<value>` to put in the browser. The token is a fixed development
 * one (never production's): production cookies come only from
 * /live-api/admin/look, signed under the real LIVE_ADMIN_TOKEN.
 */
import { lookKeyHex, lookValue, PREVIEW_LOOKS } from "../services/live/lib/look.mjs";

export const DEV_LOOK_TOKEN = "0d".repeat(32);

const look = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!PREVIEW_LOOKS.includes(look)) {
    console.error(`usage: node scripts/look-cookie.mjs ${PREVIEW_LOOKS.join("|")}`);
    process.exit(2);
  }
  console.log(`HD_LOOK_KEY=${lookKeyHex(DEV_LOOK_TOKEN)}`);
  console.log(`hd_look=${lookValue(DEV_LOOK_TOKEN, look)}`);
}
