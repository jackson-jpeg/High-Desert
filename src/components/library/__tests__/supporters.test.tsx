import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Supporters } from "@/components/library/Supporters";
import { PAYPAL_URL, SUPPORTERS, TIERS, VENMO_URL, groupByTier, tierLine, tierOf, totalOf } from "@/lib/support/supporters";

/** The thank-you panel on /stats (2026-10-09). */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const thanks = (c: HTMLElement) => c.querySelector('[data-testid="supporter-tiers"]');
const groups = (c: HTMLElement) =>
  [...c.querySelectorAll("[data-tier]")].map((sec) => ({
    tier: sec.getAttribute("data-tier"),
    heading: sec.querySelector("h3")?.textContent,
    people: [...sec.querySelectorAll("li")].map((li) => li.textContent),
  }));
const link = (c: HTMLElement) => c.querySelector("a")!;
const links = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="donate-links"] a')];
describe("Supporters", () => {
  it("thanks each listener by name and total, grouped by tier, highest first, newest first inside a tier", () => {
    expect(groups(render(<Supporters />))).toEqual([
      { tier: "owner", heading: "Station Owner", people: ["Joseph K. $50"] },
      { tier: "night-owl", heading: "Night Owl", people: ["Alexandra M. $15"] },
      { tier: "regular", heading: "Regular Caller", people: ["Rachel B. $10"] },
      { tier: "caller", heading: "Caller", people: ["Austin M. $5", "Craig A. $5"] },
    ]);
  });

  it("a tier comes from the sum of a person's gifts, at each floor exactly", () => {
    const at = (gifts: number[]) => tierOf({ name: "A B.", gifts }).id;
    expect(at([50])).toBe("owner");
    expect(at([25, 25])).toBe("owner");
    expect(at([49])).toBe("night-owl");
    expect(at([10, 5])).toBe("night-owl");
    expect(at([14])).toBe("regular");
    expect(at([5, 5])).toBe("regular");
    expect(at([9])).toBe("caller");
    expect(at([1])).toBe("caller");
    expect(totalOf({ name: "A B.", gifts: [5, 10, 20] })).toBe(35);
    expect(TIERS.map((t) => [t.id, t.min])).toEqual([["owner", 50], ["night-owl", 15], ["regular", 10], ["caller", 0]]);
  });

  it("a second gift moves a person up and the panel shows the total", () => {
    const c = render(<Supporters supporters={[{ name: "Ann B.", gifts: [5] }, { name: "Cal D.", gifts: [10, 40] }]} />);
    expect(groups(c)).toEqual([
      { tier: "owner", heading: "Station Owner", people: ["Cal D. $50"] },
      { tier: "caller", heading: "Caller", people: ["Ann B. $5"] },
    ]);
  });

  it("empty tiers are left out, and grouping keeps every person once", () => {
    const g = groupByTier(SUPPORTERS);
    expect(g.flatMap((x) => x.supporters).length).toBe(SUPPORTERS.length);
    expect(groupByTier([{ name: "Ann B.", gifts: [15] }]).map((x) => x.tier.id)).toEqual(["night-owl"]);
  });

  it("names the tiers and their amounts in one line under the links", () => {
    const c = render(<Supporters />);
    const line = c.querySelector('[data-testid="supporter-tier-line"]')!;
    expect(tierLine()).toBe("Station Owner, $50 or more. Night Owl, $15 or more. Regular Caller, $10 or more. Caller, any amount.");
    expect(line.textContent).toContain(tierLine());
    // After the links.
    const links = c.querySelector('[data-testid="donate-links"]')!;
    expect(links.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("every name is a first name and an initial, never a full name", () => {
    for (const s of SUPPORTERS) expect(s.name, s.name).toMatch(/^[A-Z][a-z'-]+ [A-Z]\.$/);
  });

  it("no full surname is anywhere in src/", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !p.includes("__tests__") && /\b(Bess|Anstett)\b/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("links to the Venmo, in a new tab", () => {
    const a = link(render(<Supporters />));
    expect(a.textContent).toBe("Chip in on Venmo: @sanger");
    expect(a.getAttribute("href")).toBe(VENMO_URL);
    expect(VENMO_URL).toBe("https://venmo.com/u/sanger");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("offers PayPal beside Venmo, for listeners outside the US, in a new tab", () => {
    const [venmo, paypal] = links(render(<Supporters />));
    expect(venmo.getAttribute("href")).toBe(VENMO_URL);
    expect(paypal.textContent).toBe("PayPal: paypal.me/JacksonSanger");
    expect(paypal.getAttribute("href")).toBe(PAYPAL_URL);
    expect(PAYPAL_URL).toBe("https://www.paypal.me/JacksonSanger");
    expect(paypal.getAttribute("target")).toBe("_blank");
    expect(paypal.getAttribute("rel")).toContain("noopener");
  });

  it("no em dash in its copy", () => {
    expect(render(<Supporters />).textContent).not.toContain("—");
  });

  it("with nobody yet, the thanks list is not drawn but the link is", () => {
    const c = render(<Supporters supporters={[]} />);
    expect(thanks(c)).toBeNull();
    expect(links(c).map((a) => a.getAttribute("href"))).toEqual([VENMO_URL, PAYPAL_URL]);
  });
});
