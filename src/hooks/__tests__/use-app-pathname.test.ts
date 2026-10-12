import { describe, expect, it } from "vitest";
import { appPathname } from "@/hooks/useAppPathname";

// The server prerenders /live as /win98/live (the rewrite in next.config.ts);
// the browser says /live. Both must read the same, or a branch on the path
// draws two different trees and React throws the page away (#418).
describe("appPathname", () => {
  it("takes the look segment off, in either look", () => {
    expect(appPathname("/win98/live")).toBe("/live");
    expect(appPathname("/night/library")).toBe("/library");
    expect(appPathname("/night/show/1992-12-12-area-51")).toBe("/show/1992-12-12-area-51");
  });

  it("the look's own root is the site's root", () => {
    expect(appPathname("/win98")).toBe("/");
    expect(appPathname("/night")).toBe("/");
  });

  it("leaves a path the browser already sees alone", () => {
    expect(appPathname("/live")).toBe("/live");
    expect(appPathname("/")).toBe("/");
  });

  it("only a whole segment is a look", () => {
    expect(appPathname("/nightly")).toBe("/nightly");
    expect(appPathname("/win98x/live")).toBe("/win98x/live");
  });
});
