// @vitest-environment node
import { describe, it, expect } from "vitest";
import { hasLink, hasEmail, hasPhone, contactReason } from "../lib/moderation/contact.mjs";
import { createModerator } from "../lib/moderation/index.mjs";

/** Links, emails and phone numbers are refused — including the disguised ones — and ordinary talk is not. */

describe("links", () => {
  const LINKS = [
    "https://example.com", "http://bit.ly/x", "hxxps://evil.test/x", "check www.example.org", "www dot example dot com",
    "example.com", "go to Example.COM now", "sub.domain.co.uk", "discord.gg/abc", "t.me/channel", "my site: coolstuff.xyz",
    "example dot com", "example (dot) com", "example[dot]net", "example . com", "example .com", "example. org",
    "https : // example", "listen at artbell.io", "foo.onion",
  ];
  for (const s of LINKS) {
    it(`refuses ${JSON.stringify(s)}`, () => {
      expect(hasLink(s) || hasEmail(s)).toBe(true);
      expect(contactReason(s)).not.toBeNull();
    });
  }
});

describe("emails", () => {
  const EMAILS = [
    "bob@example.com", "write BOB.SMITH+x@mail.co.uk", "bob @ example.com", "bob at example dot com",
    "bob (at) example (dot) com", "bob[at]example[dot]net", "bob at gmail.com",
  ];
  for (const s of EMAILS) {
    it(`refuses ${JSON.stringify(s)}`, () => {
      expect(hasEmail(s)).toBe(true);
      expect(contactReason(s)).toBe("email");
    });
  }
});

describe("phone numbers", () => {
  const PHONES = [
    "call 555-123-4567", "(775) 555-1234", "775.555.1234", "7755551234", "+1 775 555 1234", "555 1234",
    "5 5 5 1 2 3 4", "7 7 5 5 5 5 1 2 3 4", "1-800-555-0199", "+44 20 7946 0958",
    "five five five one two three four", "seven seven five five five five one two one two",
  ];
  for (const s of PHONES) {
    it(`refuses ${JSON.stringify(s)}`, () => {
      expect(hasPhone(s)).toBe(true);
      expect(contactReason(s)).toBe("phone");
    });
  }
});

describe("ordinary Art Bell talk passes", () => {
  const FINE = [
    "Coast to Coast 1997-1998 was the peak", "the 1997 1998 1999 shows", "aired 9/25/2026", "aired 9.25.2026",
    "12 25 1999 was a great night", "Area 51 caller at 2:30", "Mr. Bell, e.g. the Mel's Hole episode",
    "that was great.it was", "I'll call. Me and my wife listened", "Coast.to.coast", "at 3 a.m. PT",
    "Ghost to Ghost 1999", "the 1-800 number", "I heard it at home", "we met at the diner dot",
    "he said 1 2 3", "episode 123456", "top 10 of 1998", "St. Louis", "U.S.A.", "look @ that", "@artbell fans",
  ];
  for (const s of FINE) {
    it(JSON.stringify(s), () => {
      expect(contactReason(s)).toBeNull();
    });
  }
});

describe("the moderator refuses contact details with the reason", () => {
  const mod = createModerator();
  it("link, email, phone", () => {
    expect(mod.message("see example.com")).toEqual({ ok: false, reason: "link" });
    expect(mod.message("bob@example.com")).toEqual({ ok: false, reason: "email" });
    expect(mod.message("775 555 1234")).toEqual({ ok: false, reason: "phone" });
  });
  it("names too", () => {
    expect(mod.name("example.com")).toEqual({ ok: false, reason: "link" });
    expect(mod.name("Call 7755551234")).toEqual({ ok: false, reason: "phone" });
  });
});
