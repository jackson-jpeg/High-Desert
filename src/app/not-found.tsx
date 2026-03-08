"use client";

import Link from "next/link";
import { Starfield } from "@/components/desktop/Starfield";

export default function NotFound() {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-midnight text-center px-8">
      <Starfield />
      <div className="relative z-10 glass-heavy rounded-lg p-8 max-w-[340px] w-full animate-fade-in">
        <div className="text-hd-48 text-desert-amber/40 font-bold mb-2 w98-font crt-amber">
          404
        </div>
        <div className="text-hd-13 text-desktop-gray mb-2 w98-font">
          Signal Lost
        </div>
        <div className="text-hd-11 text-bevel-dark leading-relaxed max-w-[300px] mx-auto mb-2">
          The frequency you&apos;re looking for doesn&apos;t exist on this dial.
        </div>
        <div className="text-hd-9 text-static-green/40 italic mb-6" style={{ textShadow: "0 0 4px rgba(74, 222, 128, 0.15)" }}>
          &ldquo;East of the Rockies, you&apos;re on the air...&rdquo;
        </div>
        <Link
          href="/library"
          className="inline-block w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-2 text-hd-11 min-w-[75px] w98-font hover:text-desert-amber transition-colors-fast"
        >
          Return to Library
        </Link>
      </div>
    </div>
  );
}
