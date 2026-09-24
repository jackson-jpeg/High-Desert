import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Mean hypervisor steal (%) over the last `minutes`, from sysstat's 10-minute
 * samples — the same source and arithmetic as /usr/local/bin/vps-cpu-alert.
 * null when sysstat has nothing (no data is not "zero steal").
 */
export function meanSteal(sarText, minutes = 30) {
  const rows = Math.max(1, Math.floor(minutes / 10));
  // sar -u: time CPU %user %nice %system %iowait %steal %idle
  const vals = sarText
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[1] === "all" && /^\d\d:\d\d/.test(f[0]) && f.length >= 8)
    .map((f) => Number(f[6]))
    .filter((n) => Number.isFinite(n))
    .slice(-rows);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function currentSteal(minutes = 30) {
  try {
    const { stdout } = await execFileP("sar", ["-u"], { env: { ...process.env, LC_ALL: "C" } });
    return meanSteal(stdout, minutes);
  } catch {
    return null;
  }
}
