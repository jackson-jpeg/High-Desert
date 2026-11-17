// @vitest-environment node
import { describe, expect, it } from "vitest";
import OGImage from "../opengraph-image";
import TwitterImage from "../twitter-image";
import { CARD_CACHE_CONTROL } from "@/components/shows/ShowCard";

/**
 * The site's default share card (every page without its own: /, /library,
 * /live, /shows...) is drawn per request at the edge, so clients must be
 * allowed to keep it, like every card. It was max-age=0, which check:seo
 * caught on /shows (2026-11-17).
 */
describe("the default share card", () => {
  it("is kept a week by clients, as Open Graph and Twitter card", async () => {
    for (const draw of [OGImage, TwitterImage]) {
      const res = draw() as Response;
      expect(res.headers.get("cache-control")).toBe(CARD_CACHE_CONTROL);
      await res.arrayBuffer();
    }
  });
});
