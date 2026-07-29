import { describe, it, expect, beforeEach } from "vitest";
import { useAdminStore } from "../admin-store";

/**
 * Admin mode gates the Scanner and Search tabs and the destructive Library menu.
 *
 * **This is UI gating, not a security boundary** — the hash is a client-side
 * constant and anyone can set the localStorage key. So these tests do not
 * pretend to test authentication. What they pin is the part that has actually
 * caused a bug: `isAdmin` must start `false` even when localStorage says
 * otherwise, because reading it during render produced a hydration mismatch and
 * React threw away the server HTML for that subtree.
 *
 * The correct password is not in this repo and is not recoverable from the
 * hash, so the positive login path is covered by `enable()` (the easter-egg
 * entry point, which is the same state transition) rather than by guessing.
 */

const s = () => useAdminStore.getState();

beforeEach(() => {
  localStorage.clear();
  useAdminStore.setState({ isAdmin: false });
});

describe("hydration safety", () => {
  it("starts false even when localStorage already says admin", () => {
    localStorage.setItem("hd-admin", "1");
    // The module is already imported; what matters is that nothing reads
    // storage until hydrate() is called, so the initial value is unchanged.
    expect(s().isAdmin).toBe(false);
  });

  it("hydrate promotes to admin only when the key is exactly '1'", () => {
    localStorage.setItem("hd-admin", "1");
    s().hydrate();
    expect(s().isAdmin).toBe(true);
  });

  it("hydrate leaves a non-admin alone", () => {
    s().hydrate();
    expect(s().isAdmin).toBe(false);

    localStorage.setItem("hd-admin", "true");
    s().hydrate();
    expect(s().isAdmin).toBe(false);
  });

  it("hydrate never demotes — it only ever turns admin on", () => {
    // Called after mount while the easter egg may already have enabled it.
    s().enable();
    localStorage.removeItem("hd-admin");
    s().hydrate();
    expect(s().isAdmin).toBe(true);
  });
});

describe("login", () => {
  it("refuses a wrong password and changes nothing", async () => {
    await expect(s().login("hunter2")).resolves.toBe(false);
    expect(s().isAdmin).toBe(false);
    expect(localStorage.getItem("hd-admin")).toBeNull();
  });

  it("refuses an empty password", async () => {
    await expect(s().login("")).resolves.toBe(false);
    expect(s().isAdmin).toBe(false);
  });

  it("does not grant admin for the stored hash typed as the password", async () => {
    // The hash is a client-side constant sitting in the bundle. Pasting it in
    // must not work — it is compared against the digest of the input, not the
    // input itself, and this is the one login assertion that can be made
    // without knowing the password.
    await expect(
      s().login("7740185e7b5e8ec29b31a918cd2b8d0d491c864072ed360e48999355974280d4"),
    ).resolves.toBe(false);
    expect(s().isAdmin).toBe(false);
  });
});

describe("enable and logout", () => {
  it("enable turns admin on and persists it", () => {
    s().enable();
    expect(s().isAdmin).toBe(true);
    expect(localStorage.getItem("hd-admin")).toBe("1");
  });

  it("logout clears both the flag and the stored key", () => {
    s().enable();
    s().logout();
    expect(s().isAdmin).toBe(false);
    // If only the flag cleared, the next page load would hydrate straight back
    // into admin and logout would look broken.
    expect(localStorage.getItem("hd-admin")).toBeNull();
  });
});
