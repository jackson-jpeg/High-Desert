import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import manifest from "../../../public/manifest.json";

/**
 * The web app manifest is what makes "Install" and "Add to Home Screen"
 * possible (src/components/install/InstallPrompt.tsx): Chromium offers to
 * install only with a name, a start URL, a standalone display and icons of
 * 192 and 512 px.
 */
const PUBLIC = path.resolve(import.meta.dirname, "../../../public");

describe("public/manifest.json", () => {
  it("has what a browser needs to install the app", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toMatch(/^\//);
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.filter((i) => (i.purpose ?? "any").includes("any")).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("every icon it names is in public/", () => {
    const srcs = [...manifest.icons, ...manifest.shortcuts.flatMap((s) => s.icons)].map((i) => i.src);
    for (const src of srcs) expect(existsSync(path.join(PUBLIC, src)), src).toBe(true);
  });

  it("its shortcuts go to places that exist: no Radio (a redirect now), and the Phone Lines", () => {
    const urls = manifest.shortcuts.map((s) => s.url);
    expect(urls).not.toContain("/radio");
    expect(urls).toEqual(expect.arrayContaining(["/library", "/live", "/live?lines=1"]));
  });
});
