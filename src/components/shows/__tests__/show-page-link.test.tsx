import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodeManageBar } from "@/components/library/EpisodeActions";
import type { Episode } from "@/db/schema";

/**
 * The library's way to a show's page (docs/show-pages.md): the episode
 * panel's "Show page" link, through /show/key/<communityKey>, which redirects
 * to the slug. Only catalog shows have a page.
 */

const render = (ep: Partial<Episode>) =>
  renderToStaticMarkup(createElement(EpisodeManageBar, { episode: { id: 1, fileSize: 1, filePath: "", ...ep } as Episode }));

describe("EpisodeManageBar's Show page link", () => {
  it("links a catalog show to its page by community key, in a new tab", () => {
    const html = render({
      fileHash: "archive:coll:1999-01-02 - Show 2.mp3",
      fileName: "1999-01-02 - Show 2.mp3",
      archiveIdentifier: "coll",
    });
    expect(html).toContain('href="/show/key/coll--1999-01-02_-_Show_2"');
    expect(html).toMatch(/data-testid="show-page-link"[^>]*>Show page/);
    expect(html).toMatch(/target="_blank"/);
  });

  it("offers nothing for a local file", () => {
    expect(render({ fileHash: "0123abcd", fileName: "tape.mp3" })).not.toContain("show-page-link");
  });
});
