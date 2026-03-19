"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/win98";

export default function WelcomePage() {
  const router = useRouter();
  const [isReturning, setIsReturning] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check if returning visitor — fade out then redirect
  useEffect(() => {
    const visited = localStorage.getItem("hd-visited");
    if (visited) {
      setIsReturning(true);
      // Brief pause so they see the splash, then fade out
      const fadeTimer = setTimeout(() => setFadeOut(true), 400);
      const navTimer = setTimeout(() => router.push("/library"), 900);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(navTimer);
      };
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
    setFadeOut(true);
    setTimeout(() => router.push("/library"), 500);
  };

  return (
    <div
      className={cn(
        "min-h-screen bg-midnight flex flex-col items-center justify-center relative overflow-hidden transition-opacity duration-500",
        fadeOut && "opacity-0",
      )}
      data-hydrated=""
    >
      {/* Gradient fallback visible while canvas JS loads */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 40%, #0a1628 0%, #060d1a 50%, #000000 100%)" }}
        aria-hidden="true"
      />
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
          <h1 className="text-hd-36 md:text-hd-48 font-bold tracking-[6px] leading-none font-[family-name:var(--font-w95)] text-desert-amber [text-shadow:0_0_20px_rgba(212,168,67,0.4),0_0_40px_rgba(212,168,67,0.15)]">
            HIGH DESERT
          </h1>
          <div className="text-hd-13 md:text-hd-15 mt-3 tracking-[3px] font-[family-name:var(--font-w95)] text-bevel-dark">
            ART BELL RADIO ARCHIVE
          </div>
        </div>

        {/* Divider */}
        <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-desert-amber/30 to-transparent" />

        {/* Description */}
        <p className="text-hd-11 md:text-hd-12 leading-relaxed max-w-sm font-[family-name:var(--font-w95)] text-bevel-dark">
          Stream thousands of episodes from the golden age of late-night talk radio.
          Coast to Coast AM, Dreamland, and rare specials — all from Art Bell&apos;s
          legendary studio in Pahrump, Nevada.
        </p>

        {/* Quote */}
        <div className="text-hd-10 md:text-hd-11 italic max-w-xs font-[family-name:var(--font-w95)] text-static-green/70 [text-shadow:0_0_6px_rgba(74,222,128,0.2)]">
          &ldquo;I have seen things that I cannot explain...&rdquo;
        </div>

        {/* Stats */}
        {episodeCount && (
          <div className="text-hd-10 tracking-wider font-[family-name:var(--font-w95)] text-bevel-dark animate-fade-in">
            {episodeCount.toLocaleString()} EPISODES IN ARCHIVE
          </div>
        )}

        {/* Enter button */}
        <Button
          variant="dark"
          onClick={handleEnter}
          disabled={isReturning}
          className="px-10 py-3 tracking-[2px] text-hd-12"
        >
          {isReturning ? "REDIRECTING..." : "ENTER THE ARCHIVE"}
        </Button>

        {/* Footer */}
        <div className="text-hd-8 mt-4 font-[family-name:var(--font-w95)] text-bevel-dark/40">
          Art Bell &middot; 1945–2018 &middot; From the Kingdom of Nye
        </div>
      </div>
    </div>
  );
}
