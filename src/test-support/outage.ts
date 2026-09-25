import { useOutageStore } from "@/stores/outage-store";

/**
 * The two states outage mode is tested in. Every outage test starts from one
 * of these rather than poking the store by hand, so "up" and "down" mean the
 * same thing in the hook tests, the component tests and the e2e spec's
 * assertions.
 *
 *   up    a probe has said archive.org is up. The manifest is irrelevant and
 *         deliberately present: nothing may be marked or refused while
 *         archive.org is up, even with a manifest in hand.
 *   down  a probe has said archive.org is down, and the mirror's manifest lists
 *         exactly `pinned`.
 */

export function archiveUpFixture(pinned: readonly string[] = []): void {
  useOutageStore.setState({
    archiveUp: true,
    manifest: { version: "fixture-up", fileHashes: new Set(pinned) },
    unavailable: null,
  });
}

export function archiveDownFixture(pinned: readonly string[]): void {
  useOutageStore.setState({
    archiveUp: false,
    manifest: { version: "fixture-down", fileHashes: new Set(pinned) },
    unavailable: null,
  });
}

/** Neither verdict yet — the store as a fresh page load has it. */
export function resetOutage(): void {
  useOutageStore.setState({ archiveUp: null, manifest: null, unavailable: null });
}
