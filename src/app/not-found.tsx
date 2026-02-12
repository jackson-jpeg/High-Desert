"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-midnight text-center px-8">
      <div className="text-[48px] text-desert-amber/40 font-bold mb-2">
        404
      </div>
      <div className="text-[13px] text-desktop-gray mb-2">
        Signal Lost
      </div>
      <div className="text-[11px] text-bevel-dark leading-relaxed max-w-[300px] mb-6">
        The frequency you&apos;re looking for doesn&apos;t exist on this dial.
      </div>
      <Link
        href="/library"
        className="text-[10px] text-desert-amber hover:text-desktop-gray transition-colors-fast"
      >
        Return to Library
      </Link>
    </div>
  );
}
