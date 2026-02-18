"use client";

import { usePlayerStore } from "@/stores/player-store";

interface CassetteTapeProps {
  className?: string;
}

/**
 * Tiny decorative cassette tape SVG with spinning reels.
 * Left reel spins faster at start, right reel faster near end.
 */
export function CassetteTape({ className }: CassetteTapeProps) {
  const playing = usePlayerStore((s) => s.playing);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);

  const progress = duration > 0 ? position / duration : 0;
  // Left reel: fast at start, slow at end. Right reel: opposite.
  const leftSpeed = 1.5 + (1 - progress) * 2; // 3.5s → 1.5s
  const rightSpeed = 1.5 + progress * 2;       // 1.5s → 3.5s

  return (
    <svg
      viewBox="0 0 60 40"
      className={className}
      style={{ width: 60, height: 40 }}
      aria-hidden="true"
    >
      {/* Body */}
      <rect x="2" y="2" width="56" height="36" rx="3" fill="#1a1a2e" stroke="#808080" strokeWidth="1" />
      <rect x="5" y="5" width="50" height="20" rx="2" fill="#0A0E1A" stroke="#808080" strokeWidth="0.5" />

      {/* Label area */}
      <rect x="14" y="7" width="32" height="8" rx="1" fill="#1a1a2e" stroke="#D4A843" strokeWidth="0.3" opacity="0.6" />
      <text x="30" y="13" textAnchor="middle" fill="#D4A843" fontSize="4" fontFamily="monospace" opacity="0.7">
        HIGH DESERT
      </text>

      {/* Left reel */}
      <circle cx="18" cy="20" r="6" fill="none" stroke="#808080" strokeWidth="0.5" />
      <g style={playing ? {
        animation: `hd-spin ${leftSpeed}s linear infinite`,
        transformOrigin: '18px 20px',
      } : undefined}>
        <circle cx="18" cy="20" r="4" fill="#0A0E1A" stroke="#D4A843" strokeWidth="0.5" />
        <line x1="18" y1="16" x2="18" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
        <line x1="14.5" y1="21.5" x2="18" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
        <line x1="21.5" y1="21.5" x2="18" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
      </g>

      {/* Right reel */}
      <circle cx="42" cy="20" r="6" fill="none" stroke="#808080" strokeWidth="0.5" />
      <g style={playing ? {
        animation: `hd-spin ${rightSpeed}s linear infinite`,
        transformOrigin: '42px 20px',
      } : undefined}>
        <circle cx="42" cy="20" r="4" fill="#0A0E1A" stroke="#D4A843" strokeWidth="0.5" />
        <line x1="42" y1="16" x2="42" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
        <line x1="38.5" y1="21.5" x2="42" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
        <line x1="45.5" y1="21.5" x2="42" y2="20" stroke="#D4A843" strokeWidth="0.3" opacity="0.5" />
      </g>

      {/* Tape path */}
      <path d="M 18 26 Q 30 30 42 26" fill="none" stroke="#808080" strokeWidth="0.4" opacity="0.4" />

      {/* Bottom screws */}
      <circle cx="10" cy="34" r="1.5" fill="none" stroke="#808080" strokeWidth="0.4" />
      <circle cx="50" cy="34" r="1.5" fill="none" stroke="#808080" strokeWidth="0.4" />

      <style>{`
        @keyframes hd-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          g[style] { animation: none !important; }
        }
      `}</style>
    </svg>
  );
}
