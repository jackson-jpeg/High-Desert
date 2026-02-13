import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "High Desert — Art Bell Radio Archive";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0A0E1A",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Stars */}
        {[
          { x: 120, y: 80, s: 2 },
          { x: 300, y: 140, s: 1.5 },
          { x: 480, y: 60, s: 1 },
          { x: 700, y: 120, s: 2.5 },
          { x: 900, y: 70, s: 1.5 },
          { x: 1050, y: 150, s: 2 },
          { x: 180, y: 200, s: 1 },
          { x: 850, y: 200, s: 1 },
          { x: 1100, y: 90, s: 1.5 },
          { x: 60, y: 160, s: 1 },
          { x: 550, y: 170, s: 1.5 },
          { x: 1000, y: 180, s: 1 },
        ].map((star, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: star.x,
              top: star.y,
              width: star.s,
              height: star.s,
              borderRadius: "50%",
              backgroundColor: "rgba(192, 192, 192, 0.4)",
            }}
          />
        ))}

        {/* Desert moon */}
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: "50%",
            backgroundColor: "#D4A843",
            marginBottom: 36,
            boxShadow: "0 0 60px rgba(212, 168, 67, 0.3), 0 0 120px rgba(212, 168, 67, 0.1)",
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: "#D4A843",
            letterSpacing: "0.15em",
            lineHeight: 1,
            marginBottom: 12,
          }}
        >
          HIGH DESERT
        </div>

        {/* Divider */}
        <div
          style={{
            width: 280,
            height: 1,
            background: "linear-gradient(to right, transparent, rgba(212, 168, 67, 0.4), transparent)",
            marginBottom: 16,
          }}
        />

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: "rgba(192, 192, 192, 0.7)",
            letterSpacing: "0.05em",
          }}
        >
          Art Bell Radio Archive
        </div>

        {/* Quote */}
        <div
          style={{
            fontSize: 16,
            color: "rgba(74, 222, 128, 0.45)",
            fontStyle: "italic",
            marginTop: 24,
          }}
        >
          From the Kingdom of Nye...
        </div>

        {/* Bottom horizon line */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 80,
            background: "linear-gradient(to top, rgba(212, 168, 67, 0.06), transparent)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
