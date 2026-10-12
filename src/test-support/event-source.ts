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

/**
 * An EventSource a test can speak through: `EmittingEventSource.last()?.emit(
 * "hello", {...})` delivers a server event to whatever opened it. For tests
 * of screens that hold the phone lines' stream (the phone's Live screen
 * shares one between its preview and its sheet).
 */
export class EmittingEventSource extends SilentEventSource {
  static instances: EmittingEventSource[] = [];
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(url: string) {
    super(url);
    EmittingEventSource.instances.push(this);
  }
  static last(): EmittingEventSource | undefined {
    return EmittingEventSource.instances[EmittingEventSource.instances.length - 1];
  }
  override addEventListener(name?: string, fn?: (e: MessageEvent) => void) {
    if (!name || !fn) return;
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string, data: unknown, id?: number) {
    this.readyState = 1;
    const e = new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id === undefined ? "" : String(id) });
    for (const fn of this.listeners.get(name) ?? []) fn(e);
  }
}
