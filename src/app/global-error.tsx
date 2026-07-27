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
 * inline and dependency-free on purpose.
 */
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
          background: "#0A0E1A",
          color: "#C0C0C0",
          fontFamily: '"MS Sans Serif", Arial, sans-serif',
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#1A1F33",
            border: "2px solid",
            borderColor: "#2A3050 #060810 #060810 #2A3050",
          }}
        >
          <div
            style={{
              background: "linear-gradient(90deg, #000080 0%, #0A246A 55%, #3A6EA5 85%, #A6CAF0 100%)",
              color: "#FFFFFF",
              padding: "3px 8px",
              fontWeight: "bold",
              fontSize: 12,
              textShadow: "0 1px 2px rgba(0,0,0,0.75)",
            }}
          >
            High Desert — Fatal Error
          </div>
          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ fontSize: 14, color: "#C0C0C0", fontWeight: "bold" }}>
              The signal dropped out entirely.
            </div>
            <div style={{ fontSize: 12, color: "#9AA0AE", lineHeight: 1.5 }}>
              Something failed before the app could start. Reloading usually
              clears it. Your library is stored in this browser and is not
              affected.
            </div>
            {error.digest && (
              <div style={{ fontSize: 11, color: "#9AA0AE", fontFamily: "monospace" }}>
                Error ID: {error.digest}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "#1A1F33",
                  color: "#C0C0C0",
                  border: "2px solid",
                  borderColor: "#2A3050 #060810 #060810 #2A3050",
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
                  background: "#1A1F33",
                  color: "#C0C0C0",
                  border: "2px solid",
                  borderColor: "#2A3050 #060810 #060810 #2A3050",
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
