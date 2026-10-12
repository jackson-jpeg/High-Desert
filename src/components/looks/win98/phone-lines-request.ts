/**
 * "Phone Lines" in the Win98 Start menu: a request the Live screen takes when
 * it is (or next becomes) mounted, and opens the lines for. On a phone that
 * is the chat sheet; on a desktop the lines are already on screen.
 */
let pending = false;
const listeners = new Set<() => void>();

export function requestPhoneLines(): void {
  pending = true;
  for (const fn of listeners) fn();
}

/** True once per request. */
export function takePhoneLinesRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function onPhoneLinesRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
