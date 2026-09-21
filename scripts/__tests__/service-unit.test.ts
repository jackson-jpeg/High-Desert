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
