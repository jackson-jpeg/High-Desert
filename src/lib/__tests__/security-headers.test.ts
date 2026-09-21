// @vitest-environment node
import path from "node:path";
import { describe, it, expect } from "vitest";
import { contentSecurityPolicy } from "../csp";
import nextConfig from "../../../next.config";

/**
 * The security headers the server actually sends, read from the real
 * next.config.ts rather than restated here.
 *
 * `scripts/csp-check.mjs` proves the policy does not break any page in a real
 * browser; this proves the policy is the one intended.
 */

function directive(policy: string[], name: string): string | undefined {
  return policy.find((d) => d.split(" ")[0] === name);
}

describe("Content-Security-Policy", () => {
  it("does not allow eval in production", () => {
    const prod = contentSecurityPolicy(false);
    expect(directive(prod, "script-src")).toBeDefined();
    expect(directive(prod, "script-src")).not.toContain("unsafe-eval");
  });

  it("still allows eval in development, where React's dev build needs it", () => {
    expect(directive(contentSecurityPolicy(true), "script-src")).toContain("'unsafe-eval'");
  });

  it("locks down base-uri, form-action and plugins", () => {
    const prod = contentSecurityPolicy(false);
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
  });

  it("is the policy next.config.ts sends on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/(.*)");
    const csp = all?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    // vitest runs with NODE_ENV=test, i.e. not production → the dev policy.
    expect(csp).toBe(contentSecurityPolicy(process.env.NODE_ENV !== "production").join("; "));
  });
});

describe("next.config.ts", () => {
  it("disables the image optimizer, which nothing uses", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("pins Turbopack's workspace root to this project, not /root", () => {
    expect(nextConfig.turbopack?.root).toBe(path.resolve(__dirname, "../../.."));
  });

  it("does not advertise X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
