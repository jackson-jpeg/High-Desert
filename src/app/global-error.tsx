"use client";

/**
 * Last-resort boundary: the only thing that can catch an error thrown in the
 * root layout. Without it, such an error rendered Next's default white page —
 * `app/error.tsx` is a segment boundary and never sees them, despite having
 * been named `GlobalError`.
 *
 * It must render its own <html> and <body>, because the failing root layout is
 * exactly what has been replaced. That also means no Tailwind classes can be
 * relied on and no app component can be imported — if the root layout blew up,
 * the stylesheet and the store may be equally unavailable. Everything here is
 * inline and dependency-free on purpose. The one import is `@/lib/palette`,
 * a module of string constants with no imports of its own — the concrete
 * colours are needed precisely because globals.css may not have loaded.
 */
import { PALETTE as P } from "@/lib/palette";

/** Raised Win98 bevel on the dark surfaces: light top-left, dark bottom-right. */
const BEVEL = `${P.edge} ${P.void} ${P.void} ${P.edge}`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: P.midnight,
          color: P.chrome,
          fontFamily: '"MS Sans Serif", Arial, sans-serif',
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: P.raised,
            border: "2px solid",
            borderColor: BEVEL,
          }}
        >
          <div
            style={{
              background: `linear-gradient(90deg, ${P.navy} 0%, ${P.select} 55%, ${P.titlebarGlow} 85%, ${P.titlebarSky} 100%)`,
              color: P.chromeLighter,
              padding: "3px 8px",
              fontWeight: "bold",
              fontSize: 12,
              textShadow: "0 1px 2px rgba(0,0,0,0.75)",
            }}
          >
            High Desert · Fatal Error
          </div>
          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* The page's h1. No stylesheet here, so no preflight: the
                margin is zeroed by hand to keep it looking like the div it was. */}
            <h1 style={{ fontSize: 14, color: P.chrome, fontWeight: "bold", margin: 0 }}>
              The signal dropped out entirely.
            </h1>
            <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>
              Something failed before the app could start. Reloading usually
              clears it. Your library is stored in this browser and is not
              affected.
            </div>
            {error.digest && (
              <div style={{ fontSize: 11, color: P.muted, fontFamily: "monospace" }}>
                Error ID: {error.digest}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: P.raised,
                  color: P.chrome,
                  border: "2px solid",
                  borderColor: BEVEL,
                  padding: "4px 16px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Reload
              </button>
              <button
                onClick={reset}
                style={{
                  background: P.raised,
                  color: P.chrome,
                  border: "2px solid",
                  borderColor: BEVEL,
                  padding: "4px 16px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
