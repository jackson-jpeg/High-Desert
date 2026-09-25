/**
 * An EventSource that connects to nothing. jsdom has none, and the Live screen
 * mounts the phone lines (LiveChat), which opens one on mount. Tests of the
 * screen's layout and program use this so the chat mounts and sits quietly
 * "connecting"; the chat's own behaviour is src/components/live/__tests__/
 * live-chat.test.tsx, against a fake that emits.
 */
export class SilentEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static opened: string[] = [];
  readyState = 0;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    SilentEventSource.opened.push(url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}
