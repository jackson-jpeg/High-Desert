import { describe, it, expect } from "vitest";
import { classifyArrival, classifyHost, classifyUtm } from "../arrival";
import { ARRIVAL_SOURCES } from "../vocab";

/**
 * The arrival class is the only thing about where a session came from that
 * leaves the browser (docs/usage-tracking.md). These hold the classes to the
 * hosts the usage audit actually saw, and the result to the closed list.
 */

const OWN = "highdesert.space";
const arrive = (referrer: string, search = "") => classifyArrival(referrer, search, OWN);

describe("classifyArrival", () => {
  it.each([
    ["https://www.reddit.com/r/artbell/comments/abc/", "reddit"],
    ["https://old.reddit.com/", "reddit"],
    ["https://out.reddit.com/t3_x", "reddit"],
    ["android-app://com.reddit.frontpage/", "reddit"],
    ["https://www.google.com/", "google"],
    ["https://www.google.co.uk/", "google"],
    ["https://news.google.com/", "google"],
    ["android-app://com.google.android.googlequicksearchbox/", "google"],
    ["https://www.bing.com/", "other-search"],
    ["https://duckduckgo.com/", "other-search"],
    ["https://search.yahoo.com/", "other-search"],
    ["https://www.ecosia.org/", "other-search"],
    ["https://search.brave.com/", "other-search"],
    ["https://kagi.com/", "other-search"],
    ["https://yandex.ru/", "other-search"],
    ["https://www.startpage.com/", "other-search"],
    ["https://chatgpt.com/", "ai"],
    ["https://www.perplexity.ai/", "ai"],
    ["https://claude.ai/", "ai"],
    ["https://gemini.google.com/", "ai"],
    ["https://copilot.microsoft.com/", "ai"],
    ["https://l.facebook.com/", "social"],
    ["https://m.facebook.com/", "social"],
    ["https://www.instagram.com/", "social"],
    ["https://x.com/", "social"],
    ["https://t.co/abc", "social"],
    ["https://www.threads.net/", "social"],
    ["https://bsky.app/", "social"],
    ["https://mastodon.social/", "social"],
    ["https://www.youtube.com/", "social"],
    ["https://www.tiktok.com/", "social"],
    ["https://lemmy.world/", "social"],
    ["https://highdesert.space/library", "internal"],
    ["https://www.highdesert.space/", "internal"],
    ["https://coasttocoastam.com/", "other"],
    ["not a url", "other"],
    ["", "direct"],
  ])("%s is %s", (referrer, want) => {
    expect(arrive(referrer)).toBe(want);
  });

  it("a referrer from this site's own host is internal, whatever the host is called", () => {
    expect(classifyArrival("http://127.0.0.1:3003/stats", "", "127.0.0.1:3003")).toBe("internal");
  });

  it("utm_source wins when it names something known, even with no referrer", () => {
    expect(arrive("", "?utm_source=chatgpt.com")).toBe("ai");
    expect(arrive("https://www.google.com/", "?utm_source=reddit")).toBe("reddit");
    expect(arrive("", "?x=1&utm_source=Facebook")).toBe("social");
  });

  it("an unknown utm_source falls back to the referrer, or other without one", () => {
    expect(arrive("https://www.reddit.com/", "?utm_source=newsletter-42")).toBe("reddit");
    expect(arrive("", "?utm_source=newsletter-42")).toBe("other");
  });

  it("does not take a lookalike host for a known one", () => {
    expect(classifyHost("notreddit.com")).toBeNull();
    expect(classifyHost("reddit.com.evil.example")).toBeNull();
    expect(classifyHost("myx.com")).toBeNull();
    expect(classifyHost("googleusercontent.example")).toBeNull();
  });

  it("only ever answers one of the arrival classes", () => {
    const inputs = ["", "https://a.b/", "javascript:alert(1)", "https://reddit.com", "data:text/html,x"];
    for (const r of inputs) {
      for (const q of ["", "?utm_source=", "?utm_source=%00", "?utm_source=chatgpt.com"]) {
        expect(ARRIVAL_SOURCES).toContain(arrive(r, q));
      }
    }
  });
});

describe("classifyUtm", () => {
  it("knows hosts and plain words", () => {
    expect(classifyUtm("chatgpt.com")).toBe("ai");
    expect(classifyUtm("perplexity")).toBe("ai");
    expect(classifyUtm("bsky")).toBe("social");
    expect(classifyUtm("duckduckgo")).toBe("other-search");
    expect(classifyUtm("")).toBeNull();
    expect(classifyUtm(null)).toBeNull();
    expect(classifyUtm("spring-mailer")).toBeNull();
  });
});
