import { describe, expect, it } from "vitest";
import { callerLabel, chatRows, groupTuneins, isOwnCall, listRows, TUNEIN_PLACES_KEPT, type ChatRow } from "../chat-rows";
import { tuneinText, type ArchiveLine, type LiveMessage, type TuneinNotice } from "@/services/live/client";

const t = (min: number) => new Date(Date.UTC(2026, 9, 13, 6, min)).toISOString();
const call = (id: number, min: number, over: Partial<LiveMessage> = {}): LiveMessage => ({
  id,
  at: t(min),
  name: `Caller ${id}`,
  line: "Line 1",
  body: `call ${id}`,
  ...over,
});
const tunein = (min: number, count = 1, places: string[] = []): TuneinNotice => ({ at: t(min), count, places });
const moment = (min: number): ArchiveLine => ({
  id: `m${min}`,
  at: t(min),
  text: "Art signs on.",
  form: "moment",
  speaker: null,
  episode: null,
  reason: "archive",
});

const kinds = (rows: ChatRow[]) => rows.map((r) => r.kind);
const text = (r: ChatRow) => (r.kind === "tunein" ? tuneinText(r.n) : "");

describe("groupTuneins: several tune-ins in a row read as one line", () => {
  it("folds three single tune-ins into '3 new listeners tuned in'", () => {
    const rows = chatRows([call(1, 0)], [tunein(1), tunein(2), tunein(3)]);
    expect(kinds(rows)).toEqual(["call", "tunein"]);
    expect(text(rows[1])).toBe("3 new listeners tuned in");
    expect(rows[1]).toMatchObject({ merged: 3, key: t(1) });
  });

  it("adds the counts of batched notices", () => {
    const rows = chatRows([], [tunein(1, 2), tunein(2, 3)]);
    expect(rows).toHaveLength(1);
    expect(text(rows[0])).toBe("5 new listeners tuned in");
  });

  it("keeps each place once, and at most the few a batch names", () => {
    const rows = chatRows([], [tunein(1, 1, ["Ohio"]), tunein(2, 1, ["Ohio"]), tunein(3, 1, ["Reno"]), tunein(4, 1, ["Ely"]), tunein(5, 1, ["Bonn"])]);
    expect(rows).toHaveLength(1);
    const n = (rows[0] as Extract<ChatRow, { kind: "tunein" }>).n;
    expect(n.count).toBe(5);
    expect(n.places).toEqual(["Ohio", "Reno", "Ely"].slice(0, TUNEIN_PLACES_KEPT));
  });

  it("keeps tune-ins apart when a call or an archive moment comes between them (control)", () => {
    const rows = chatRows([call(1, 2)], [tunein(1), tunein(3), tunein(5)], [moment(4)]);
    expect(kinds(rows)).toEqual(["tunein", "call", "tunein", "archive", "tunein"]);
    for (const r of rows) if (r.kind === "tunein") expect(text(r)).toBe("A new listener tuned in");
  });

  it("leaves a single tune-in as it was", () => {
    const rows = listRows([], [tunein(1, 1, ["Ohio"])]);
    expect(groupTuneins(rows)).toEqual(rows);
    expect(text(rows[0])).toBe("A listener just tuned in from Ohio");
  });

  it("keeps the first notice's key, so a folding line holds its place in the list", () => {
    const one = chatRows([], [tunein(1)]);
    const two = chatRows([], [tunein(1), tunein(2)]);
    expect((one[0] as { key: string }).key).toBe((two[0] as { key: string }).key);
  });
});

describe("callerLabel", () => {
  it("reads 'Name, calling from Place'", () => {
    expect(callerLabel({ name: "Night Owl", place: "Asuncion" })).toBe("Night Owl, calling from Asuncion");
    expect(callerLabel({ name: "Night Owl", place: null })).toBe("Night Owl");
    expect(callerLabel({ name: "Night Owl" })).toBe("Night Owl");
  });
});

describe("isOwnCall", () => {
  it("is a call this browser posted, or one under the name it holds", () => {
    expect(isOwnCall({ id: 4, name: "Someone" }, [4], null)).toBe(true);
    expect(isOwnCall({ id: 5, name: "Night Owl" }, [], { name: "Night Owl" })).toBe(true);
  });
  it("is not anyone else's (control)", () => {
    expect(isOwnCall({ id: 5, name: "Desert Rat" }, [4], { name: "Night Owl" })).toBe(false);
    expect(isOwnCall({ id: 5, name: "Desert Rat" }, [], null)).toBe(false);
  });
});
