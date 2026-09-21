import { describe, it, expect, afterEach } from "vitest";
import { isKeyOwnedByTarget } from "../key-ownership";

/**
 * HD-011. Each case builds real DOM and dispatches a real keydown on it, so
 * `e.target` is whatever the browser would report — not a hand-built object.
 * The negatives matter as much as the positives: a guard that owned
 * everything would pass every positive case and silently kill every shortcut,
 * including Enter on a library row, which *is* the library's play key.
 */

function ownedAt(html: string, selector = "#t", key = "Enter"): boolean {
  document.body.innerHTML = html;
  const target = document.querySelector(selector) as HTMLElement;
  let owned: boolean | undefined;
  const listener = (e: KeyboardEvent) => { owned = isKeyOwnedByTarget(e); };
  window.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : key, bubbles: true }));
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
    expect(isKeyOwnedByTarget({ target: window, key: "Enter" })).toBe(false);
  });
});

/**
 * The key × element matrix. Activation keys go to every interactive element;
 * navigation keys only to elements that navigate with them. A button does
 * nothing with an arrow, and Chromium focuses buttons on click, so a button
 * that owned arrows would leave the dial untunable after clicking "Scan".
 */
const ACTIVATION = ["Enter", " ", "Backspace", "Delete"];
const NAVIGATION = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];

const MATRIX: [name: string, html: string, activation: boolean, navigation: boolean][] = [
  // Owns both.
  ["input", '<input id="t">', true, true],
  ["textarea", '<textarea id="t"></textarea>', true, true],
  ["select", '<select id="t"><option>a</option></select>', true, true],
  ["contenteditable", '<div id="t" contenteditable="true">x</div>', true, true],
  ['role="combobox"', '<div id="t" role="combobox" tabindex="0"></div>', true, true],
  ['role="spinbutton"', '<div id="t" role="spinbutton" tabindex="0"></div>', true, true],
  ["tab inside a tablist", '<div role="tablist"><button id="t" role="tab">1997</button></div>', true, true],
  ["radio inside a radiogroup", '<div role="radiogroup"><div id="t" role="radio" tabindex="0"></div></div>', true, true],
  ["menuitem inside a menu", '<div role="menu"><div id="t" role="menuitem" tabindex="0">Play</div></div>', true, true],
  ["menuitem inside a menubar", '<div role="menubar"><div id="t" role="menuitem" tabindex="0">File</div></div>', true, true],
  ["cell inside a grid", '<div role="grid"><div role="row"><div id="t" role="gridcell" tabindex="0"></div></div></div>', false, true],
  ["treeitem inside a tree", '<div role="tree"><div id="t" role="treeitem" tabindex="0"></div></div>', false, true],
  ["a button inside a dialog", '<div role="dialog"><button id="t">Delete</button></div>', true, true],
  ["plain content inside an alertdialog", '<div role="alertdialog"><p id="t" tabindex="-1">x</p></div>', true, true],
  ["inside <dialog>", '<dialog open><div id="t" tabindex="0">x</div></dialog>', true, true],
  // Activation only.
  ["button", '<button id="t">Scan forward</button>', true, false],
  ["a[href]", '<a id="t" href="/library">Library</a>', true, false],
  ['role="button"', '<div id="t" role="button" tabindex="0">Guest</div>', true, false],
  ['role="link"', '<span id="t" role="link" tabindex="0">x</span>', true, false],
  ['role="checkbox"', '<div id="t" role="checkbox" tabindex="0"></div>', true, false],
  ['role="switch"', '<div id="t" role="switch" tabindex="0"></div>', true, false],
  // The library's row star: a button inside a row inside the listbox.
  ["a button inside a list row", '<div role="listbox"><div role="option"><button id="t" tabindex="-1">☆</button></div></div>', true, false],
  // Neither.
  ["a plain div", '<div id="t" tabindex="0">x</div>', false, false],
  ["a list row", '<div role="listbox"><div id="t" role="option" tabindex="-1">Men in Black</div></div>', false, false],
  ['role="slider" (the radio strip)', '<canvas id="t" role="slider" tabindex="0"></canvas>', false, false],
  ["<a> without href", '<a id="t" tabindex="0">x</a>', false, false],
];

describe("isKeyOwnedByTarget — key × element", () => {
  for (const [name, html, activation, navigation] of MATRIX) {
    it(`${name}: activation keys ${activation ? "owned" : "not owned"}, navigation keys ${navigation ? "owned" : "not owned"}`, () => {
      for (const key of ACTIVATION) {
        expect(ownedAt(html, "#t", key), `${JSON.stringify(key)}`).toBe(activation);
      }
      for (const key of NAVIGATION) {
        expect(ownedAt(html, "#t", key), key).toBe(navigation);
      }
    });
  }
});
