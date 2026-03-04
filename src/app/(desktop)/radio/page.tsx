"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { RadioDial } from "@/components/radio/RadioDial";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";

export default function RadioPage() {
  const episodes = useLiveQuery(() =>
    db.episodes.orderBy("airDate").toArray(),
  );

  if (episodes === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[11px] text-bevel-dark" style={{ fontFamily: "W95FA, monospace" }}>
          Tuning radio dial...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2 md:p-3">
      <WidgetErrorBoundary>
        <RadioDial episodes={episodes} />
      </WidgetErrorBoundary>
    </div>
  );
}
