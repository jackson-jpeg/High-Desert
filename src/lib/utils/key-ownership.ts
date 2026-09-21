/**
 * Does the focused element own this key itself? (HD-011)
 *
 * Three window-level keydown handlers — the global shortcuts in
 * `(desktop)/layout.tsx`, the library's `useLibraryKeyboard`, and the radio's
 * `RadioDial` — bind Enter, Space, Backspace and the arrows. Only the layout's
 * guard knew about buttons; the other two skipped `INPUT`/`TEXTAREA` and
 * nothing else. So on /library, Enter on *any* focused button played the
 * selected episode instead of pressing the button — including the Delete
 * button in the delete-confirmation dialog — and on /radio Enter and Space
 * were captured everywhere. One guard, shared, so the three cannot drift apart
 * again.
 *
 * **Which elements own a key depends on the key.** Activation and editing
 * keys — Enter, Space, Backspace, Delete, and every other non-navigation key —
 * are owned by everything in the first list below. Navigation keys (arrows,
 * Home/End, PageUp/PageDown) are owned only by elements that *use* them
 * (second list). A button does nothing with ArrowRight, and Chromium focuses
 * a button on mouse click, so if buttons owned arrows then clicking "Scan
 * forward" would leave the dial untunable from the keyboard, and clicking a
 * row's star would stop Shift+Arrow in the library.
 *
 * Activation keys are owned when the target (or its closest ancestor) is:
 *
 * - **editable** — `input`, `textarea`, `select`, contenteditable. Typing.
 * - **a native control** — `button`, `a[href]`. Enter/Space activate them.
 *   An `<a>` without `href` is not focusable or activatable, so it owns nothing.
 * - **an ARIA widget that activates or edits on its own keys** — `button`,
 *   `link`, `checkbox`, `radio`, `switch`, `tab`, `menuitem*`, `combobox`,
 *   `textbox`, `searchbox`, `spinbutton`. Each of these has a defined keyboard
 *   contract (Space toggles a checkbox, arrows move between tabs, …) that a
 *   page shortcut would break.
 * - **inside a dialog or menu** — `dialog`, `[role=dialog|alertdialog|menu|
 *   menubar]`. A modal owns the keyboard while it is up: Enter in the delete
 *   confirmation must never reach the library's "play" behind it.
 *
 * Navigation keys are owned only by:
 *
 * - **editable fields** and `select` (a caret or a list to move through).
 * - **composite widgets whose ARIA contract is arrow navigation** —
 *   `spinbutton`, `combobox`, `radiogroup`, `tablist`, `menu`, `menubar`,
 *   `tree`, `treegrid`, `grid`, and so the radios/tabs/menuitems inside them.
 * - **anything inside a dialog.**
 *
 * `button`, `a[href]`, `role=button|link|checkbox|switch` do not own them.
 *
 * Deliberately **not** owned, for any key:
 *
 * - `role="option"` / `listbox`. The library's rows are `role="option"` and
 *   Enter on a focused row is exactly the library's own Enter — play it.
 * - `role="slider"` / `application`. The radio's tuning strip is a
 *   `role="slider"` canvas with no key handler of its own; its arrow keys
 *   *are* RadioDial's window handler. Owning them would make a focused dial
 *   untunable. The player's seek slider likewise relies on the layout's arrows.
 */

const ACTIVATION_OWNERS = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "combobox",
    "textbox",
    "searchbox",
    "spinbutton",
    "dialog",
    "alertdialog",
    "menu",
    "menubar",
  ].map((role) => `[role="${role}"]`),
  "dialog",
].join(", ");

/**
 * `slider` and `listbox` are absent on purpose even though ARIA gives them
 * arrow keys: in this app their arrows *are* the window handlers — the
 * radio's tuning strip and the player's seek bar are `role="slider"` with no
 * key handler of their own, and the library's rows live in a
 * `role="listbox"` whose Shift+Arrow is `useLibraryKeyboard`. Owning them
 * would switch those keys off.
 */
const NAVIGATION_OWNERS = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    "textbox",
    "searchbox",
    "spinbutton",
    "combobox",
    "radiogroup",
    "tablist",
    "menu",
    "menubar",
    "tree",
    "treegrid",
    "grid",
    "dialog",
    "alertdialog",
  ].map((role) => `[role="${role}"]`),
  "dialog",
].join(", ");

const NAVIGATION_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
]);

export function isKeyOwnedByTarget(e: Pick<KeyboardEvent, "target" | "key">): boolean {
  const target = e.target;
  // Window or document as the target: nothing is focused, the page owns it.
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const owners = NAVIGATION_KEYS.has(e.key) ? NAVIGATION_OWNERS : ACTIVATION_OWNERS;
  return target.closest(owners) !== null;
}
