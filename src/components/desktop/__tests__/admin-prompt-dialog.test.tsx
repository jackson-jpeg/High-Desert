import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emit } from "@/lib/events";

/**
 * <AdminPromptDialog>, extracted from DesktopShell (HD-018).
 *
 * Its only way in is `hd:admin-prompt`, dispatched by the library search box
 * on a secret input — there is no menu item — so if the listener goes missing
 * the prompt is simply unreachable, with nothing on screen to say so.
 *
 * `login` is replaced on the real store: the password's hash is a constant and
 * its plaintext is deliberately not in this repo (see admin-store.test.ts).
 * What is under test is that the dialog asks the store, and acts on the answer.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { AdminPromptDialog } = await import("@/components/desktop/AdminPromptDialog");
const { useAdminStore } = await import("@/stores/admin-store");

let root: Root;
let container: HTMLDivElement;
const login = vi.fn(async (pw: string) => pw === "right");

beforeEach(() => {
  login.mockClear();
  useAdminStore.setState({ login });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(AdminPromptDialog));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const input = () => container.querySelector<HTMLInputElement>('input[type="password"]');

function type(value: string) {
  const el = input()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("AdminPromptDialog", () => {
  it('is closed until "admin-prompt", then opens', () => {
    expect(input()).toBeNull();
    act(() => {
      emit("admin-prompt");
    });
    expect(input()).not.toBeNull();
    expect(container.textContent).toContain("Admin Access");
  });

  it("says so on a wrong password and stays open", async () => {
    act(() => {
      emit("admin-prompt");
    });
    type("wrong");
    await submit();
    expect(login).toHaveBeenCalledWith("wrong");
    expect(container.textContent).toContain("Wrong password");
    expect(input()).not.toBeNull();
  });

  it("closes on the right password, and clears it for next time", async () => {
    act(() => {
      emit("admin-prompt");
    });
    type("right");
    await submit();
    expect(login).toHaveBeenCalledWith("right");
    expect(input()).toBeNull();

    act(() => {
      emit("admin-prompt");
    });
    expect(input()!.value).toBe("");
  });
});
