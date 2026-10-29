import { PIXEL_FILL, spriteRuns, type Sprite } from "@/lib/season/pixel-art";

/**
 * A pixel-art sprite (src/lib/season/pixel-art.ts) as crisp SVG: one rect
 * per run of a colour, no smoothing, sized by CSS so it scales in whole
 * looks without blurring.
 */
export function PixelSprite({ sprite, className, title, ...rest }: { sprite: Sprite; className?: string; title?: string } & Record<`data-${string}`, string>) {
  const w = Math.max(...sprite.map((r) => r.length));
  const h = sprite.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {spriteRuns(sprite).map(([x, y, width, c]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={width} height={1} fill={PIXEL_FILL[c]} />
      ))}
    </svg>
  );
}
