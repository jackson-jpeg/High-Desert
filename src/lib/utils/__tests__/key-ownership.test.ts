import { describe, it, expect, afterEach } from "vitest";
import { isKeyOwnedByTarget } from "../key-ownership";

/**
 * HD-011. Each case builds real DOM and dispatches a real keydown on it, so
 * `e.target` is whatever the browser would report — not a hand-built object.
 * The negatives matter as much as the positives: a guard that owned
 * everything would pass every positive case and silently kill every shortcut,
 * including Enter on a library row, which *is* the library's play key.
 */

function ownedAt(html: string, selector = "#t"): boolean {
  document.body.innerHTML = html;
  const target = document.querySelector(selector) as HTMLElement;
  let owned: boolean | undefined;
  const listener = (e: KeyboardEvent) => { owned = isKeyOwnedByTarget(e); };
  window.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  window.removeEventListener("keydown", listener);
  if (owned === undefined) throw new Error("keydown never reached window");
  return owned;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("isKeyOwnedByTarget — owned", () => {
  it.each([
    ["input", '<input id="t">'],
    ["textarea", '<textarea id="t"></textarea>'],
    ["select", '<select id="t"><option>a</option></select>'],
    ["contenteditable", '<div id="t" contenteditable="true">x</div>'],
    ["inside contenteditable", '<div contenteditable=""><span id="t" tabindex="0">x</span></div>'],
    ["button", '<button id="t">Go</button>'],
    ["a[href]", '<a id="t" href="/library">Library</a>'],
    ['role="button"', '<div id="t" role="button" tabindex="0">Guest</div>'],
    ['role="link"', '<span id="t" role="link" tabindex="0">x</span>'],
    ['role="checkbox"', '<div id="t" role="checkbox" tabindex="0"></div>'],
    ['role="tab"', '<div role="tablist"><div id="t" role="tab" tabindex="0">1997</div></div>'],
    ['role="menuitem"', '<div id="t" role="menuitem" tabindex="0">Play</div>'],
    ['role="combobox"', '<div id="t" role="combobox" tabindex="0"></div>'],
    ["inside a dialog", '<div role="dialog"><div id="t" tabindex="0">body</div></div>'],
    ["inside an alertdialog", '<div role="alertdialog"><p id="t" tabindex="-1">x</p></div>'],
    ["inside <dialog>", '<dialog open><div id="t" tabindex="0">x</div></dialog>'],
    ["the dialog itself", '<div id="t" role="dialog" tabindex="-1"></div>'],
    ["inside a menu", '<div role="menu"><div id="t" tabindex="0">x</div></div>'],
    ["inside a menubar", '<div role="menubar"><div id="t" tabindex="0">File</div></div>'],
  ])("%s", (_name, html) => {
    expect(ownedAt(html)).toBe(true);
  });
});

describe("isKeyOwnedByTarget — not owned", () => {
  it.each([
    ["the body (nothing focused)", "<div></div>", "body"],
    ["a plain div", '<div id="t" tabindex="0">x</div>', "#t"],
    // The library's rows. Enter on a focused row is the library's play key.
    ["a list row that is not a button", '<div role="listbox"><div id="t" role="option" tabindex="-1">Men in Black</div></div>', "#t"],
    ["<a> without href (not focusable, activates nothing)", '<a id="t" tabindex="0">x</a>', "#t"],
    ['contenteditable="false"', '<div id="t" contenteditable="false" tabindex="0">x</div>', "#t"],
    // The radio's tuning strip: its arrows are RadioDial's window handler.
    ['role="slider"', '<canvas id="t" role="slider" tabindex="0"></canvas>', "#t"],
    ['role="application"', '<div role="application"><div id="t" tabindex="0">x</div></div>', "#t"],
  ])("%s", (_name, html, selector) => {
    expect(ownedAt(html, selector)).toBe(false);
  });

  it("window as the target", () => {
    expect(isKeyOwnedByTarget({ target: window })).toBe(false);
  });
});
