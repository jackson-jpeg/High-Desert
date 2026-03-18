"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useOscilloscope } from "@/hooks/useOscilloscope";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { VISUALIZATIONS } from "@/audio/visualizations";
import { cn } from "@/lib/utils/cn";

interface OscilloscopeProps {
  className?: string;
}

export function Oscilloscope({ className }: OscilloscopeProps) {
  const { canvasRef, vizId, vizName, cycleViz, setVizMode } =
    useOscilloscope();
  const [labelVisible, setLabelVisible] = useState(false);
  const labelTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup label timer on unmount
  useEffect(() => () => clearTimeout(labelTimerRef.current), []);

  const showLabel = useCallback(() => {
    setLabelVisible(true);
    clearTimeout(labelTimerRef.current);
    labelTimerRef.current = setTimeout(() => setLabelVisible(false), 1500);
  }, []);

  const handleClick = useCallback(() => {
    cycleViz();
    showLabel();
  }, [cycleViz, showLabel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cycleViz();
        showLabel();
      }
    },
    [cycleViz, showLabel]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const items = VISUALIZATIONS.map((v) => ({
        label: v.name,
        checked: v.id === vizId,
        onClick: () => {
          setVizMode(v.id);
          showLabel();
        },
      }));
      useContextMenuStore.getState().show(e.clientX, e.clientY, items);
    },
    [vizId, setVizMode, showLabel]
  );

  return (
    <div
      className={cn(
        "relative w98-inset-dark bg-black overflow-hidden crt-screen cursor-pointer",
        className
      )}
      role="button"
      tabIndex={0}
      aria-label={`Audio visualization: ${vizName}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {/* Scanline overlay */}
      <div className="absolute inset-0 crt-scanlines pointer-events-none" />

      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "pixelated" }}
      />

      {/* Visualization name label */}
      <span
        className={cn(
          "absolute bottom-1 right-2 text-[10px] text-[#33FF33]/70 pointer-events-none transition-opacity duration-300",
          labelVisible ? "opacity-100" : "opacity-0"
        )}
      >
        {vizName}
      </span>
    </div>
  );
}
