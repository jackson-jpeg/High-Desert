// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * deploy/highdesert.service is the versioned copy of the production unit
 * (installed to /etc/systemd/system/; `highdesert-status` reports drift
 * between the two). These are the properties HD-026 bought, asserted on the
 * file that gets installed.
 */

const unit = readFileSync(path.resolve(__dirname, "../../deploy/highdesert.service"), "utf8");

function directive(name: string): string[] {
  return unit
    .split("\n")
    .filter((l) => l.startsWith(`${name}=`))
    .map((l) => l.slice(name.length + 1).trim());
}

describe("highdesert.service", () => {
  it("binds next start to loopback — nginx is the only client", () => {
    const [exec] = directive("ExecStart");
    expect(exec).toMatch(/\bnext start\b/);
    expect(exec).toMatch(/(^|\s)-H 127\.0\.0\.1(\s|$)/);
  });

  it("cannot gain privileges and cannot write outside .next", () => {
    expect(directive("NoNewPrivileges")).toEqual(["true"]);
    expect(directive("ProtectSystem")).toEqual(["strict"]);
    // strict alone leaves /root writable, and the app lives in /root.
    expect(directive("ProtectHome")).toEqual(["read-only"]);
    expect(directive("PrivateTmp")).toEqual(["true"]);
    expect(directive("ReadWritePaths")).toEqual(["/root/High-Desert/.next"]);
  });

  it("keeps secrets in the env file, not the unit", () => {
    expect(directive("EnvironmentFile")).toEqual(["/root/.high-desert.env"]);
    expect(unit).not.toMatch(/DATABASE_URL=|_SECRET=/);
  });
});

describe("highdesert-verify-live.service (the station's nightly pre-air walk)", () => {
  const u = readFileSync(path.resolve(__dirname, "../../deploy/highdesert-verify-live.service"), "utf8");
  const d = (name: string) => u.split("\n").filter((l) => l.startsWith(`${name}=`)).map((l) => l.slice(name.length + 1).trim());

  it("keeps to the 10% rule for High Desert background jobs: niced, idle IO, a quota", () => {
    expect(d("Nice")).toEqual(["19"]);
    expect(d("IOSchedulingClass")).toEqual(["idle"]);
    expect(Number(d("CPUQuota")[0]?.replace("%", ""))).toBeLessThanOrEqual(10);
  });

  it("runs the walk with a time budget and writes its status for the digest", () => {
    expect(d("ExecStart")[0]).toMatch(/verify-live-day\.mjs --budget-min \d+/);
    expect(d("Environment")).toContain("HD_VERIFY_STATUS=/var/lib/highdesert-verify-live/status.json");
    expect(d("EnvironmentFile")).toEqual(["/root/.high-desert.env"]);
  });
});
