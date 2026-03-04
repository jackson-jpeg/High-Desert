"use client";

import { Dialog, Button } from "@/components/win98";
import { useEffect, useRef } from "react";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  episodeCount?: number;
  showCounts?: { coastToCoast?: number; dreamland?: number; specials?: number };
}

export function AboutDialog({
  open,
  onClose,
  isAdmin,
  episodeCount = 0,
  showCounts,
}: AboutDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mini starfield animation inside the dialog
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 80;
    canvas.height = 120;
    const stars = Array.from({ length: 30 }, () => ({
      x: Math.random() * 80,
      y: Math.random() * 120,
      r: Math.random() * 1.2 + 0.3,
      speed: Math.random() * 0.003 + 0.001,
      phase: Math.random() * Math.PI * 2,
    }));

    let animId: number;
    const render = (t: number) => {
      ctx.clearRect(0, 0, 80, 120);
      for (const s of stars) {
        const a = 0.2 + Math.sin(t * s.speed + s.phase) * 0.15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(170, 195, 235, ${a})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="About High Desert" width="440px">
      <div className="flex flex-col md:flex-row bg-midnight/90 p-0">
        {/* Left: icon/starfield area */}
        <div className="hidden md:block w-[80px] flex-shrink-0 relative overflow-hidden border-r border-bevel-dark/20">
          <canvas ref={canvasRef} className="absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[28px] leading-none" style={{ textShadow: "0 0 12px rgba(212,168,67,0.5)" }}>
              📡
            </div>
          </div>
        </div>

        {/* Right: content */}
        <div className="flex-1 p-4 flex flex-col gap-3">
          {/* Header */}
          <div>
            <pre className="text-[7px] text-desert-amber/60 leading-[1.1] font-mono select-none" aria-hidden="true">
{`  ╦ ╦╦╔═╗╦ ╦  ╔╦╗╔═╗╔═╗╔═╗╦═╗╔╦╗
  ╠═╣║║ ╦╠═╣   ║║║╣ ╚═╗║╣ ╠╦╝ ║ 
  ╩ ╩╩╚═╝╩ ╩  ═╩╝╚═╝╚═╝╚═╝╩╚═ ╩ `}
            </pre>
          </div>

          <div className="text-[10px] text-desktop-gray/60">
            v0.5.0 <span className="text-desert-amber/50">&ldquo;Kingdom of Nye&rdquo;</span>
            {isAdmin && <span className="text-static-green/40 ml-1">(Admin)</span>}
          </div>

          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-desert-amber/20 to-transparent" />

          {/* Dedication */}
          <div className="flex flex-col gap-1">
            <div className="text-[10px] text-desktop-gray/80 font-bold">
              Dedicated to Art Bell (1945–2018)
            </div>
            <div className="text-[9px] text-desktop-gray/50 italic leading-relaxed">
              Pioneer of late-night talk radio. For over two decades, Art brought the strange,
              the unexplained, and the wonderful into millions of homes from his studio
              in the high desert of Pahrump, Nevada.
            </div>
          </div>

          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-bevel-dark/20 to-transparent" />

          {/* Fun facts */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] text-desert-amber/70 font-bold uppercase tracking-wider">
              Archive Statistics
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
              <span className="text-bevel-dark">Total Episodes:</span>
              <span className="text-desktop-gray tabular-nums">{episodeCount.toLocaleString()}</span>
              {showCounts?.coastToCoast != null && (
                <>
                  <span className="text-bevel-dark">Coast to Coast AM:</span>
                  <span className="text-desktop-gray tabular-nums">{showCounts.coastToCoast.toLocaleString()}</span>
                </>
              )}
              {showCounts?.dreamland != null && (
                <>
                  <span className="text-bevel-dark">Dreamland:</span>
                  <span className="text-desktop-gray tabular-nums">{showCounts.dreamland.toLocaleString()}</span>
                </>
              )}
              {showCounts?.specials != null && (
                <>
                  <span className="text-bevel-dark">Specials/Other:</span>
                  <span className="text-desktop-gray tabular-nums">{showCounts.specials.toLocaleString()}</span>
                </>
              )}
              <span className="text-bevel-dark">Year Range:</span>
              <span className="text-desktop-gray">1993–2018</span>
            </div>
          </div>

          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-bevel-dark/20 to-transparent" />

          {/* Quote */}
          <div
            className="text-[9px] text-static-green/50 italic"
            style={{ textShadow: "0 0 4px rgba(74, 222, 128, 0.15)" }}
          >
            &ldquo;I have seen things that I cannot explain...&rdquo;
          </div>

          {/* Attribution */}
          <div className="text-[9px] text-desktop-gray/40">
            A{" "}
            <a href="https://sang3r.com" target="_blank" rel="noopener noreferrer" className="text-desert-amber/50 hover:text-desert-amber">
              Sang3r.com
            </a>
            {" "}production
          </div>

          {/* Links & button */}
          <div className="flex items-center justify-between mt-1">
            <a
              href="https://archive.org/details/artaborneradio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-desert-amber/50 hover:text-desert-amber underline underline-offset-2"
            >
              Source: archive.org
            </a>
            <Button onClick={onClose}>OK</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
