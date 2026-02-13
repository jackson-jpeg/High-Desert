"use client";

import { useOscilloscope } from "@/hooks/useOscilloscope";
import { cn } from "@/lib/utils/cn";

interface OscilloscopeProps {
  className?: string;
}

export function Oscilloscope({ className }: OscilloscopeProps) {
  const canvasRef = useOscilloscope();

  return (
    <div
      className={cn(
        "relative w98-inset-dark bg-black overflow-hidden crt-screen",
        className,
      )}
      role="img"
      aria-label="Audio waveform visualization"
    >
      {/* Scanline overlay */}
      <div className="absolute inset-0 crt-scanlines pointer-events-none" />

      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
