import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Supporters } from "@/components/library/Supporters";
import { SUPPORTERS, VENMO_URL } from "@/lib/support/supporters";

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

const thanks = (c: HTMLElement) => c.querySelector('ul[aria-label="Thank you"]');
const link = (c: HTMLElement) => c.querySelector("a")!;
describe("Supporters", () => {
  it("thanks each listener by first name and last initial, with the gift", () => {
    const c = render(<Supporters />);
    const items = [...thanks(c)!.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Rachel B. $10", "Craig A. $5"]);
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

  it("no em dash in its copy", () => {
    expect(render(<Supporters />).textContent).not.toContain("—");
  });

  it("with nobody yet, the thanks list is not drawn but the link is", () => {
    const c = render(<Supporters supporters={[]} />);
    expect(thanks(c)).toBeNull();
    expect(link(c).getAttribute("href")).toBe(VENMO_URL);
  });
});
