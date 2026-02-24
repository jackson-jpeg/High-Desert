"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export default function WelcomePage() {
  const router = useRouter();
  const [isReturning, setIsReturning] = useState(false);
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check if returning visitor
  useEffect(() => {
    const visited = localStorage.getItem("hd-visited");
    if (visited) {
      setIsReturning(true);
      const timer = setTimeout(() => router.push("/library"), 1000);
      return () => clearTimeout(timer);
    }
  }, [router]);

  // Try to get episode count from IndexedDB
  useEffect(() => {
    (async () => {
      try {
        const { db } = await import("@/db");
        const count = await db.episodes.count();
        if (count > 0) setEpisodeCount(count);
      } catch {
        // DB not ready
      }
    })();
  }, []);

  // Starfield
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2,
      alpha: Math.random() * 0.3 + 0.05,
      speed: Math.random() * 0.002 + 0.0005,
      phase: Math.random() * Math.PI * 2,
    }));

    let animId: number;
    const render = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const a = s.alpha + Math.sin(t * s.speed + s.phase) * s.alpha * 0.6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(170, 195, 235, ${Math.max(0.02, a)})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handleEnter = () => {
    localStorage.setItem("hd-visited", "1");
    router.push("/library");
  };

  return (
    <div
      className="min-h-screen bg-midnight flex flex-col items-center justify-center relative overflow-hidden"
      data-hydrated=""
    >
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" aria-hidden="true" />

      {/* Scanline overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-20 flex flex-col items-center gap-8 px-6 text-center max-w-lg">
        {/* Title */}
        <div>
          <h1
            className="text-[36px] md:text-[48px] font-bold tracking-[6px] leading-none"
            style={{
              color: "#D4A843",
              fontFamily: "W95FA, monospace",
              textShadow: "0 0 20px rgba(212,168,67,0.4), 0 0 40px rgba(212,168,67,0.15)",
            }}
          >
            HIGH DESERT
          </h1>
          <div
            className="text-[13px] md:text-[15px] mt-3 tracking-[3px]"
            style={{
              color: "#808080",
              fontFamily: "W95FA, monospace",
            }}
          >
            ART BELL RADIO ARCHIVE
          </div>
        </div>

        {/* Divider */}
        <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-desert-amber/30 to-transparent" />

        {/* Description */}
        <p
          className="text-[11px] md:text-[12px] leading-relaxed max-w-sm"
          style={{ color: "#808080", fontFamily: "W95FA, monospace" }}
        >
          Stream thousands of episodes from the golden age of late-night talk radio.
          Coast to Coast AM, Dreamland, and rare specials — all from Art Bell&apos;s
          legendary studio in Pahrump, Nevada.
        </p>

        {/* Quote */}
        <div
          className="text-[10px] md:text-[11px] italic max-w-xs"
          style={{
            color: "#4ADE80",
            fontFamily: "W95FA, monospace",
            textShadow: "0 0 6px rgba(74, 222, 128, 0.2)",
            opacity: 0.7,
          }}
        >
          &ldquo;I have seen things that I cannot explain...&rdquo;
        </div>

        {/* Stats */}
        {episodeCount && (
          <div
            className="text-[10px] tracking-wider"
            style={{ color: "#808080", fontFamily: "W95FA, monospace" }}
          >
            {episodeCount.toLocaleString()} EPISODES IN ARCHIVE
          </div>
        )}

        {/* Enter button */}
        <button
          onClick={handleEnter}
          disabled={isReturning}
          className={cn("cursor-pointer select-none transition-all", isReturning && "opacity-50 pointer-events-none")}
          style={{
            fontFamily: "W95FA, monospace",
            fontSize: "12px",
            color: "#C0C0C0",
            background: "#1a1a2e",
            border: "2px outset #808080",
            padding: "12px 40px",
            letterSpacing: "2px",
          }}
          onMouseDown={(e) => {
            (e.target as HTMLElement).style.borderStyle = "inset";
          }}
          onMouseUp={(e) => {
            (e.target as HTMLElement).style.borderStyle = "outset";
          }}
        >
          {isReturning ? "REDIRECTING..." : "ENTER THE ARCHIVE"}
        </button>

        {/* Footer */}
        <div className="text-[8px] mt-4" style={{ color: "#808080", fontFamily: "W95FA, monospace", opacity: 0.4 }}>
          Art Bell &middot; 1945–2018 &middot; From the Kingdom of Nye
        </div>
      </div>
    </div>
  );
}
