"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { RadioDial } from "@/components/radio/RadioDial";

export default function RadioPage() {
  const episodes = useLiveQuery(() =>
    db.episodes.orderBy("airDate").toArray(),
  );

  return (
    <div className="h-full flex flex-col p-2 md:p-3">
      <RadioDial episodes={episodes} />
    </div>
  );
}
