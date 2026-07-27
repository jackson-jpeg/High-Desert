"use client";

import { useState, useEffect } from "react";
import { Dialog, Button } from "@/components/win98";
import { db } from "@/db";

const MILESTONES_HOURS = [2, 10, 100];
const STORAGE_KEY = "hd-milestones-seen";

const MILESTONE_MESSAGES: Record<number, { title: string; body: string }> = {
  2: {
    title: "2 Hours in the High Desert",
    body: "You've spent 2 hours exploring the archive. The desert night is just getting started.",
  },
  10: {
    title: "10 Hours Deep",
    body: "A true night owl. You've logged 10 hours with Art Bell — the lines are open.",
  },
  100: {
    title: "100 Hours — Welcome Home",
    body: "100 hours. You're officially a resident of the High Desert. Art would be proud.",
  },
};

function getSeenMilestones(): number[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function markMilestoneSeen(hours: number) {
  const seen = getSeenMilestones();
  if (!seen.includes(hours)) {
    seen.push(hours);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  }
}

export function MilestoneDialog() {
  const [milestone, setMilestone] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // `playbackPosition` is not an index — see the stores() declarations in
      // src/db/index.ts. This was `.where("playbackPosition").above(0)`, which
      // Dexie rejects with `SchemaError`, so the promise rejected unhandled
      // three seconds after every single page load and no milestone was ever
      // shown. The feature has never once fired.
      //
      // filter() is a full scan rather than an index range, which is fine here:
      // it runs once, on a timer, over ~1,300 rows. Adding the index instead
      // would mean a schema version bump, and src/db/ changes carry real risk.
      const episodes = await db.episodes
        .filter((e) => (e.playbackPosition ?? 0) > 0)
        .toArray();
      const totalSeconds = episodes.reduce(
        (sum, e) => sum + (e.playbackPosition ?? 0),
        0
      );
      const totalHours = totalSeconds / 3600;
      const seen = getSeenMilestones();

      // Find the highest unseen milestone that's been reached
      const unseen = MILESTONES_HOURS.filter(
        (h) => totalHours >= h && !seen.includes(h)
      );
      if (unseen.length > 0 && !cancelled) {
        // Show the highest reached milestone
        setMilestone(unseen[unseen.length - 1]);
      }
    };

    // Check after a short delay to avoid blocking initial render.
    // The catch matters: an unhandled rejection here is exactly what hid the
    // bug above — it surfaced only as a bare `SchemaError` in the console.
    const timer = setTimeout(() => {
      check().catch((err) => {
        console.warn("[milestone] check failed:", err);
      });
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!milestone) return null;

  const msg = MILESTONE_MESSAGES[milestone];

  const handleClose = () => {
    markMilestoneSeen(milestone);
    setMilestone(null);
  };

  return (
    <Dialog open onClose={handleClose} title="Milestone Reached" width="380px">
      <div className="p-5 flex flex-col gap-4 bg-midnight/90">
        <div className="text-center">
          <div className="text-hd-32 leading-none mb-2 select-none">
            {milestone >= 100 ? "🏜️" : milestone >= 10 ? "🌙" : "📻"}
          </div>
          <div className="text-hd-13 text-desktop-gray font-bold">
            {msg.title}
          </div>
          <div className="text-hd-10 text-desktop-gray/85 mt-2 leading-relaxed">
            {msg.body}
          </div>
        </div>

        <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-desert-amber/20 to-transparent" />

        <div className="text-center">
          <div className="text-hd-9 text-bevel-dark/85 mb-2">
            If you&apos;re enjoying High Desert, consider buying the developer a coffee.
          </div>
          <a
            href="https://venmo.com/sanger"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-hd-11 text-desert-amber hover:text-desert-amber/85 underline underline-offset-2 transition-colors-fast"
          >
            @sanger on Venmo
          </a>
        </div>

        <div className="flex justify-center mt-1">
          <Button onClick={handleClose}>Continue Listening</Button>
        </div>
      </div>
    </Dialog>
  );
}
