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
 * A key is owned by the target when the target (or its closest ancestor) is:
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
 * Deliberately **not** owned:
 *
 * - `role="option"` / `listbox`. The library's rows are `role="option"` and
 *   Enter on a focused row is exactly the library's own Enter — play it.
 * - `role="slider"` / `application`. The radio's tuning strip is a
 *   `role="slider"` canvas with no key handler of its own; its arrow keys
 *   *are* RadioDial's window handler. Owning them would make a focused dial
 *   untunable. The player's seek slider likewise relies on the layout's arrows.
 */

const OWNING_SELECTOR = [
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

export function isKeyOwnedByTarget(e: Pick<KeyboardEvent, "target">): boolean {
  const target = e.target;
  // Window or document as the target: nothing is focused, the page owns it.
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(OWNING_SELECTOR) !== null;
}
