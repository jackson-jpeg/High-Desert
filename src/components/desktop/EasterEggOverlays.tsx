"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Dialog, Button } from "@/components/win98";

export type EasterEgg = "area51" | "ghostToGhost" | "w6obb" | "kingdomOfNye" | "melsHole" | "konamiCode" | "titor" | null;

interface OverlayProps {
  onDismiss: () => void;
}

interface GhostOverlayProps extends OverlayProps {
  onGhostToggle: () => void;
}

// ---------------------------------------------------------------------------
// Area 51 — Signal Drop
// ---------------------------------------------------------------------------

function Area51Overlay({ onDismiss }: OverlayProps) {
  const [phase, setPhase] = useState<"static" | "dialog" | "restoring">("static");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("dialog"), 2000);
    const t2 = setTimeout(() => setPhase("restoring"), 8000);
    const t3 = setTimeout(() => onDismiss(), 9500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDismiss]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] pointer-events-none transition-opacity duration-1000",
        phase === "restoring" ? "opacity-0" : "opacity-100",
      )}
    >
      {phase === "static" && (
        <div className="absolute inset-0 bg-black/80 animate-pulse" />
      )}
      {phase === "dialog" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="w98-raised-dark bg-raised-surface p-4 max-w-[340px] text-center">
            <div className="text-hd-14 text-red-400 font-bold mb-2 tracking-wider">
              SIGNAL LOST
            </div>
            <div className="text-hd-11 text-desktop-gray/80 italic leading-relaxed">
              &ldquo;We have just lost our uplink&hellip; I&rsquo;ll be right back.&rdquo;
            </div>
            <div className="text-hd-9 text-bevel-dark/50 mt-3">
              September 11, 1997 &mdash; Area 51 Caller
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// W6OBB — Ham Radio
// ---------------------------------------------------------------------------

function W6OBBOverlay({ onDismiss }: OverlayProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 pointer-events-auto">
      <Dialog open onClose={onDismiss} title="W6OBB — Pahrump, NV" className="max-w-[380px]">
        <div className="p-3 flex flex-col gap-3">
          <div className="text-hd-11 text-desert-amber text-center tracking-widest">
            50,000 WATTS CLEAR CHANNEL
          </div>
          <div className="text-hd-11 text-desktop-gray/80 leading-relaxed space-y-2">
            <p>
              <span className="text-static-green">Art Bell</span> &mdash; licensed at age 13,
              Amateur Extra Class operator. Call sign{" "}
              <span className="text-desert-amber font-bold">W6OBB</span>.
            </p>
            <p>
              Built a massive double-loop rhombic antenna on his Pahrump, Nevada property.
              Worked every continent from the High Desert.
            </p>
            <p className="text-hd-10 text-bevel-dark/60 italic">
              &ldquo;W6OBB, SK&rdquo; &mdash; ARRL, 2018
            </p>
          </div>
          <div className="flex justify-center mt-1">
            <Button size="sm" variant="dark" onClick={onDismiss}>
              73
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kingdom of Nye — Show Intro Sweep
// ---------------------------------------------------------------------------

function KingdomOfNyeOverlay({ onDismiss }: OverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => onDismiss(), 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-start justify-center pt-16">
      <div
        className={cn(
          "text-center transition-all duration-1000 ease-out",
          visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4",
        )}
      >
        <div className="text-hd-20 md:text-hd-28 text-desert-amber/90 tracking-widest leading-relaxed drop-shadow-[0_0_12px_rgba(255,160,0,0.4)]">
          From the High Desert
        </div>
        <div className="text-hd-14 md:text-hd-18 text-desktop-gray/60 tracking-wider mt-1">
          and the Great American Southwest&hellip;
        </div>
        <div className="text-hd-12 md:text-hd-14 text-bevel-dark/40 tracking-wider mt-3">
          this is High Desert
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mel's Hole — Bottomless Void
// ---------------------------------------------------------------------------

function MelsHoleOverlay({ onDismiss }: OverlayProps) {
  const [phase, setPhase] = useState(0); // 0=growing, 1=text, 2=clickable
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1500);
    const t2 = setTimeout(() => setPhase(2), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleClick = useCallback(() => {
    if (phase < 2) return;
    if (!clicked) {
      setClicked(true);
      setTimeout(() => onDismiss(), 2500);
    }
  }, [phase, clicked, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center cursor-pointer bg-black/70 transition-colors duration-1500"
      onClick={handleClick}
    >
      <div className="relative flex items-center justify-center">
        <div
          className="rounded-full bg-black border border-bevel-dark/20 transition-all duration-1500 ease-out shadow-[0_0_60px_rgba(0,0,0,0.8),inset_0_0_40px_rgba(0,0,0,1)]"
          style={{
            width: phase >= 1 ? 280 : 40,
            height: phase >= 1 ? 280 : 40,
          }}
        />
        {phase >= 1 && !clicked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <div className="text-hd-12 md:text-hd-14 text-bevel-dark/50 tracking-wider leading-relaxed">
              9 miles west of Ellensburg
            </div>
            <div className="text-hd-11 md:text-hd-12 text-bevel-dark/35 mt-1">
              9 feet across. 80,000 feet of fishing line.
            </div>
            <div className="text-hd-14 md:text-hd-16 text-desktop-gray/40 mt-2 tracking-widest">
              No bottom.
            </div>
            {phase >= 2 && (
              <div className="text-hd-9 text-bevel-dark/25 mt-4 animate-pulse">
                Dogs won&rsquo;t come within 100 feet.
              </div>
            )}
          </div>
        )}
        {clicked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-hd-12 text-bevel-dark/40 italic">
              You threw a refrigerator in. You heard nothing.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Konami Code — East of the Rockies Switchboard
// ---------------------------------------------------------------------------

const LINES = [
  { name: "East of the Rockies", greeting: "East of the Rockies, you\u2019re on the air. Hello?" },
  { name: "West of the Rockies", greeting: "West of the Rockies, you\u2019re on the air." },
  { name: "First Time Caller", greeting: "First time caller? Welcome to the show." },
  { name: "Wild Card Line", greeting: "Wild card line, go ahead." },
  { name: "International", greeting: "International, where are you calling from?" },
];

const FRANTIC_CALLER = "I don\u2019t have a whole lot of time\u2026 um\u2026 OK\u2026 what I\u2019m\u2026 what we\u2019re thinking of as\u2026 as aliens\u2026 they\u2019re extra-dimensional beings\u2026 that an earlier precursor of the\u2026 space program made contact with\u2026 they\u2019re not what they claim to be\u2014";

function KonamiOverlay({ onDismiss }: OverlayProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [typing, setTyping] = useState("");
  const [crashed, setCrashed] = useState(false);

  const handleLine = useCallback((line: typeof LINES[0]) => {
    if (line.name === "Wild Card Line" && Math.random() < 0.2) {
      setSelected("frantic");
      let i = 0;
      const id = setInterval(() => {
        i += 2;
        setTyping(FRANTIC_CALLER.slice(0, i));
        if (i >= FRANTIC_CALLER.length) {
          clearInterval(id);
          setTimeout(() => setCrashed(true), 500);
          setTimeout(() => onDismiss(), 3000);
        }
      }, 30);
      return () => clearInterval(id);
    }
    setSelected(line.greeting);
  }, [onDismiss]);

  if (crashed) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 pointer-events-auto">
        <div className="w98-raised-dark bg-raised-surface p-4 max-w-[300px] text-center">
          <div className="text-hd-12 text-red-400 font-bold">SIGNAL LOST</div>
          <div className="text-hd-10 text-bevel-dark/50 mt-2">Connection terminated</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 pointer-events-auto">
      <Dialog open onClose={onDismiss} title="Coast to Coast AM — Phone Lines" className="max-w-[340px]">
        <div className="p-3 flex flex-col gap-2">
          {!selected ? (
            <>
              <div className="text-hd-10 text-bevel-dark/60 mb-1">Select a line:</div>
              {LINES.map((line) => (
                <Button
                  key={line.name}
                  size="sm"
                  variant="dark"
                  onClick={() => handleLine(line)}
                  className="w-full text-left"
                >
                  {line.name}
                </Button>
              ))}
            </>
          ) : (
            <div className="min-h-[80px]">
              <div className="text-hd-11 text-desktop-gray/80 italic leading-relaxed">
                {selected === "frantic" ? typing : `"${selected}"`}
              </div>
              {selected !== "frantic" && (
                <div className="flex justify-end mt-3">
                  <Button size="sm" variant="dark" onClick={onDismiss}>
                    Hang Up
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// John Titor — Time Traveler BBS Post
// ---------------------------------------------------------------------------

function TitorOverlay({ onDismiss }: OverlayProps) {
  const [glitching, setGlitching] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setGlitching(false), 1500);
    return () => clearTimeout(t);
  }, []);

  if (glitching) {
    return (
      <div className="fixed inset-0 z-[200] pointer-events-none flex items-end justify-end p-2">
        <div className="text-hd-14 text-static-green/80 tabular-nums animate-pulse">
          2001 &rarr; 2015 &rarr; 2036
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 pointer-events-auto">
      <Dialog open onClose={onDismiss} title="Post-2-Post BBS — Art Bell Forum" className="max-w-[400px]">
        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-hd-11 text-static-green font-bold">TimeTravel_0</span>
            <span className="text-hd-9 text-bevel-dark/40">Posted from: 2036</span>
          </div>
          <div className="w98-inset-dark bg-inset-well p-2 text-hd-11 text-desktop-gray/80 leading-relaxed">
            <p>I was sent back to 1975 to retrieve an IBM 5100.</p>
            <p className="mt-2">The divergence in your timeline is 2.5%. Good luck.</p>
            <p className="mt-2 text-bevel-dark/50 text-hd-9">
              — John Titor, November 2000
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button size="sm" variant="dark" onClick={onDismiss}>
              Report Post
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghost to Ghost — Theme Banner
// ---------------------------------------------------------------------------

function GhostToGhostOverlay({ onDismiss, onGhostToggle }: GhostOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => onDismiss(), 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  // Activate persistent ghost mode on mount
  useEffect(() => {
    onGhostToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-start justify-center pt-16">
      <div
        className={cn(
          "text-center transition-all duration-1000 ease-out",
          visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4",
        )}
      >
        <div className="text-hd-20 md:text-hd-28 tracking-widest" style={{ color: "#7eb8ff" }}>
          Ghost to Ghost AM
        </div>
        <div className="text-hd-12 md:text-hd-14 text-desktop-gray/50 mt-2 italic">
          It&rsquo;s that time of year&hellip; the lines are open for your ghost stories.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

interface EasterEggOverlaysProps {
  active: EasterEgg;
  onDismiss: () => void;
  onGhostToggle: () => void;
}

export function EasterEggOverlays({ active, onDismiss, onGhostToggle }: EasterEggOverlaysProps) {
  if (!active) return null;

  switch (active) {
    case "area51":
      return <Area51Overlay onDismiss={onDismiss} />;
    case "w6obb":
      return <W6OBBOverlay onDismiss={onDismiss} />;
    case "kingdomOfNye":
      return <KingdomOfNyeOverlay onDismiss={onDismiss} />;
    case "melsHole":
      return <MelsHoleOverlay onDismiss={onDismiss} />;
    case "konamiCode":
      return <KonamiOverlay onDismiss={onDismiss} />;
    case "titor":
      return <TitorOverlay onDismiss={onDismiss} />;
    case "ghostToGhost":
      return <GhostToGhostOverlay onDismiss={onDismiss} onGhostToggle={onGhostToggle} />;
    default:
      return null;
  }
}
